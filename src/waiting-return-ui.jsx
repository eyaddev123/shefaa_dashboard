// ═══ «خروج مؤقت» — مكوّنات الموظفين (الطبيب والاستقبال والبروفايل) ═══
// منفصلة عن waiting-return.jsx عمداً: ذاك مصدرٌ يفحصه test:board لشاشة الصالة (Chrome 66)،
// وهذه أصنافها للموظفين وحدهم (gap في flex وغيره) فلا تدخل فحص التلفاز.
import { useEffect, useRef, useState } from 'react'
import { Elapsed, fmtElapsed, ms } from './waiting-return.jsx'

// عدٌّ تنازلي «07:45» حتى الرجوع التلقائي
function Countdown({ until, offset }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="wr-elapsed" dir="ltr">{fmtElapsed(until - (Date.now() + offset))}</span>
}

const clock = (t) => new Date(t).toLocaleTimeString('ar-SY-u-nu-latn', { hour: '2-digit', minute: '2-digit' })

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
          <small>للقطرات: اكتب المدّة التي تحتاجها (30، 40…) — يرجع وحده بعدها أوّل واحد برقمه، والاستقبال تستطيع «رجع» قبلها.</small></span>
      </label>
      {value.mode === 'auto' && !String(value.minutes).trim() && (
        <p className="pf-return-need" role="alert">اكتب عدد الدقائق (من 1 إلى 240).</p>
      )}
    </div>
  )
}
