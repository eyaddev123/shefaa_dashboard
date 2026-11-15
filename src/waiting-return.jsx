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
const ms = (t) => (t ? Date.parse(t) : NaN)
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

// عدٌّ تنازلي «07:45» حتى الرجوع التلقائي
function Countdown({ until, offset }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="wr-elapsed" dir="ltr">{fmtElapsed(until - (Date.now() + offset))}</span>
}

const clock = (t) => new Date(t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })

// ═══ حال الخروج بسطرٍ واحد — للطبيب والاستقبال ═══
//   رجع (الاستقبال)        ⇒ «رجع ١١:٢٠ — على الدور»
//   رجع تلقائياً           ⇒ «رجع على الدور تلقائياً»
//   ينتظر وقته             ⇒ «يرجع على الدور بعد 07:45»
//   بإخبار الاستقبال       ⇒ «خارج منذ 1:20:05»
export function ReturnState({ appt, offset = 0 }) {
  const [, tick] = useState(0)
  const due = ms(appt.return_due_at)
  // يتحدّث وحده لحظة حلول الوقت (العدّ التنازلي يتحوّل إلى «رجع»)
  useEffect(() => {
    if (!Number.isFinite(due) || appt.returned_at) return undefined
    const left = due - (Date.now() + offset)
    if (left <= 0) return undefined
    const id = setTimeout(() => tick((x) => x + 1), left + 250)
    return () => clearTimeout(id)
  }, [due, appt.returned_at, offset])
  const now = Date.now() + offset
  if (appt.returned_at) return <span className="wr-state is-back">رجع {clock(appt.returned_at)} — على الدور</span>
  if (Number.isFinite(due) && due <= now) return <span className="wr-state is-back">رجع على الدور تلقائياً</span>
  if (Number.isFinite(due)) return <span className="wr-state">يرجع على الدور بعد <Countdown until={due} offset={offset} /></span>
  if (appt.late_at) return (
    <span className="wr-state">نودي ولم يدخل منذ <Elapsed since={appt.stepped_out_at} offset={offset} />
      <small className="wr-state-hint"> · يرجع بإخبار الاستقبال</small></span>
  )
  return (
    <span className="wr-state">خارج منذ <Elapsed since={appt.stepped_out_at} offset={offset} />
      <small className="wr-state-hint"> · يرجع بإخبار الاستقبال</small></span>
  )
}

// ═══ إعداد الخروج المؤقت — حقلٌ واحد لبروفايل الدكتور (المشرفة) وإعدادات شاشته (الدكتور) ═══
// value = { mode: 'reception' | 'auto', minutes: '' }. لا مدّة افتراضية: من يختار «تلقائياً»
// يكتب الدقائق بنفسه (قرار المستخدم: ٣٠ أو ٤٠ — ليست ربع ساعةٍ نفرضها).
export const returnModeOf = (minutes) => (minutes == null
  ? { mode: 'reception', minutes: '' } : { mode: 'auto', minutes: String(minutes) })
// للحفظ: null أو الدقائق نصّاً (الخادم يتحقّق 1–240 ويقبل الهندية)؛ undefined = ناقص
export const returnModeValue = (v) => (v.mode === 'reception' ? null : (String(v.minutes).trim() || undefined))

export function ReturnModeField({ value, onChange, disabled = false, name = 'return_mode' }) {
  const minRef = useRef(null)
  return (
    <div className="pf-return" role="radiogroup" aria-labelledby={`${name}-h`}>
      <div id={`${name}-h`} className="pf-return-title"><strong>الخروج المؤقت</strong>
        <small>متى يرجع المريض على الدور بعد «خروج مؤقت»؟ (يُطبَّق على الخروج التالي لا الجاري)</small></div>
      <label className="pf-toggle">
        <input type="radio" name={name} checked={value.mode === 'reception'} disabled={disabled}
          onChange={() => onChange({ ...value, mode: 'reception' })} />
        <span><strong>لحين ما تخبّر الاستقبال</strong>
          <small>للصور والأشعّة والتحاليل: يبقى خارجاً حتى تكبس الاستقبال «رجع»، فيدخل أوّل واحد برقمه.</small></span>
      </label>
      <label className="pf-toggle">
        <input type="radio" name={name} checked={value.mode === 'auto'} disabled={disabled}
          onChange={() => { onChange({ ...value, mode: 'auto' }); setTimeout(() => minRef.current?.focus(), 0) }} />
        <span><strong>يرجع على الدور تلقائياً بعد
          <input ref={minRef} className="pf-return-min" inputMode="numeric" aria-label="دقائق الرجوع التلقائي"
            placeholder="—" value={value.minutes} disabled={disabled || value.mode !== 'auto'}
            onChange={(e) => onChange({ ...value, minutes: e.target.value })} /> دقيقة</strong>
          <small>للقطرات: اكتب المدّة التي تحتاجها (٣٠، ٤٠…) — يرجع وحده بعدها أوّل واحد برقمه، والاستقبال تستطيع «رجع» قبلها.</small></span>
      </label>
      {value.mode === 'auto' && !String(value.minutes).trim() && (
        <p className="pf-return-need" role="alert">اكتب عدد الدقائق (من ١ إلى ٢٤٠).</p>
      )}
    </div>
  )
}
