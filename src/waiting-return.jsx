// ═══ «خروج مؤقت» — أدوات تشترك فيها شاشتا الطبيب والاستقبال ═══
// المريض يخرج من الغرفة (قطرة تحتاج ربع ساعة، صورة، مفعول بنج) والطبيب يكشف على من
// بعده، ثمّ يناديه ليُكمل. الحالة waiting_return: رقم دوره كما هو، ولا يُعدّ في الطابور.
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
