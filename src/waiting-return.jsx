// ═══ «خروج مؤقت» — أدوات تشترك فيها شاشتا الطبيب والاستقبال ═══
// المريض يخرج من الغرفة (قطرة تحتاج ربع ساعة، صورة، تحليل) والطبيب يكشف على من بعده.
// الحالة waiting_return: رقم دوره كما هو، ولا يُعدّ في الطابور — حتى «يرجع على الدور»:
//   • الاستقبال تكبس «رجع» (returned_at)، أو
//   • يحلّ وقت الرجوع التلقائي (return_due_at — لقطة إعداد الدكتور لحظة الخروج).
// حينها يصير «التالي» برقمه الأصلي بعد الإسعافي، ويناديه الطبيب من الزرّ العلوي كأيّ مريض.
// و«تأخّر المريض» (late_at) — بدل «لم يحضر»: نودي ولم يدخل، فيبقى بانتظار الاستقبال وحدها.
// «رجع على الدور» محسوبٌ هنا لحظة العرض (لا مؤقّت في الخادم)، بساعة الخادم (offset).
// يعمل في النمطين (الحضور والخانات): الرقم المعروض يأتي من الشاشة المستدعية.
import { useEffect, useRef, useState } from 'react'
import { openStaffStream } from './api.js'

export const WAITING_RETURN = 'waiting_return'

// «بانتظار العودة» بترتيب الخروج: الأقدم خروجاً أولاً — غالباً أوّل من يجهز.
// الترتيب هنا لا في الخادم: الاستعلام المشترك لا يذكر stepped_out_at بالاسم.
export const waitingReturnOf = (appointments) => (appointments || [])
  .filter((a) => a.status === WAITING_RETURN)
  .sort((x, y) => String(x.stepped_out_at || '').localeCompare(String(y.stepped_out_at || '')))

// ═══ فرق ساعة الجهاز عن ساعة الخادم ═══
// العدّاد يُحسب من stepped_out_at (طابع الخادم)، فجهازٌ ساعته متأخّرة دقيقتين يُظهر
// «-01:40» أو يزيد دقيقتين. الطابور يحمل server_now فنطرح الفرق — يُحسب عند كل تحميل.
export const serverOffsetOf = (data) => {
  const t = data?.server_now ? Date.parse(data.server_now) : NaN
  return Number.isFinite(t) ? t - Date.now() : 0
}

const two = (n) => String(n).padStart(2, '0')
export const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`
}

// عدّادٌ يعدّ لقدّام من لحظة الخروج: «05:12». من القاعدة لا من ضغطة الزرّ، فيضبط
// بعد تحديث الصفحة أو فتحها من جهازٍ آخر.
export function Elapsed({ since, offset = 0, className = 'wr-elapsed' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const t = since ? Date.parse(since) : NaN
  if (!Number.isFinite(t)) return null
  return (
    <span className={className} dir="ltr" title="منذ الخروج المؤقت">
      {fmtElapsed(Date.now() + offset - t)}
    </span>
  )
}

// ═══ تحديثٌ فوريّ من بثّ الموظفين ═══
// أي حدثٍ يخصّ هذه الجلسة (أو اليوم كلّه — اعتذار طبيب) يُعيد تحميل الطابور. الأحداث
// تتلاحق أحياناً (نداء ثمّ تحديث)، فنجمعها في تحميلٍ واحد بعد مهلةٍ قصيرة.
export function useStaffEvents(sessionIds, onChange, enabled = true) {
  const ref = useRef(onChange)
  ref.current = onChange
  const key = [].concat(sessionIds || []).filter((x) => x != null).map(String).sort().join(',')
  useEffect(() => {
    if (!enabled || !key) return undefined
    const ids = new Set(key.split(','))
    let timer = null
    const close = openStaffStream((_name, data) => {
      const sid = data?.session_id
      if (sid != null && !ids.has(String(sid))) return
      clearTimeout(timer)
      timer = setTimeout(() => { if (!document.hidden) ref.current() }, 250)
    })
    return () => { clearTimeout(timer); close() }
  }, [key, enabled])
}

// ═══ رجع على الدور؟ ═══
// لحظة الرجوع (ms بساعة الخادم) أو null إن ما زال خارجاً. now = Date.now() + offset.
export const ms = (t) => (t ? Date.parse(t) : NaN)
export function backInQueueAt(a, now) {
  if (a?.status !== WAITING_RETURN) return null
  const marked = ms(a.returned_at)
  const due = ms(a.return_due_at)
  const auto = Number.isFinite(due) && due <= now ? due : NaN
  const t = [marked, auto].filter(Number.isFinite)
  return t.length ? Math.min(...t) : null
}
export const isBackInQueue = (a, now) => backInQueueAt(a, now) != null
// نودي ولم يدخل الغرفة (بدل «لم يحضر» — من قطع بطاقته حاضرٌ حتماً)
export const isLate = (a) => a?.status === WAITING_RETURN && a.late_at != null

// الدور الفعلي كما يراه الطبيب: الإسعافي الحاضر أولاً، ثمّ العائدون (أوّلهم رجوعاً أولاً)،
// ثمّ بقية الحاضرين بترتيب الخادم. العائد باقي كشفه قصير (قراءة تحليل) — قرار المستخدم.
export function queueWithReturnees(arrived, appointments, now) {
  const back = (appointments || []).filter((a) => isBackInQueue(a, now))
    .sort((x, y) => backInQueueAt(x, now) - backInQueueAt(y, now) || x.queue_number - y.queue_number)
  if (back.length === 0) return arrived
  const i = arrived.findIndex((a) => a.priority !== 'urgent')
  const at = i < 0 ? arrived.length : i
  return [...arrived.slice(0, at), ...back, ...arrived.slice(at)]
}

// ساعةٌ بساعة الخادم تتحدّث لحظة أقرب رجوعٍ تلقائي (ونصف دقيقة احتياطاً): فيظهر مريض
// القطرة «التالي» عند الدقيقة ١٥ بلا تحديثٍ للصفحة.
export function useServerNow(appointments, offset = 0) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const cur = Date.now() + offset
    const upcoming = (appointments || [])
      .filter((a) => a.status === WAITING_RETURN && !a.returned_at)
      .map((a) => ms(a.return_due_at)).filter((t) => Number.isFinite(t) && t > cur)
    const wait = upcoming.length ? Math.min(...upcoming) - cur + 250 : 30000
    const id = setTimeout(() => setNow(Date.now() + offset), Math.max(250, Math.min(wait, 30000)))
    return () => clearTimeout(id)
  }, [appointments, offset, now])
  return now
}
