import { useEffect, useRef } from 'react'
import { cleanMobile } from '../api.js'

// ═══ خانة رقم موبايل المريض — واحدة لكل الخانات الستّ ═══
// كيبورد أرقام، وحدٌّ أقصى 10 خانات للكتابة، وتنظيفٌ فوريّ: الأرقام العربية ⇒ لاتينية،
// والمسافات والشحطات تُنزع (فلا تأكل من الخانات العشر).
//
// ★ الإدخال دفعةً واحدة يُنظَّف **قبل** حدّ الطول: المتصفّح يقصّ عند maxLength أولاً، فرقمٌ
// ملصوق أو مقترَح من الكيبورد «0933 123-456» كان يُقصّ إلى «0933 123-4» فيُخزَّن رقمٌ آخر.
// فاللصق والسحب وإدراج نصٍّ بأكثر من حرف (اقتراح الكيبورد، الإكمال) نلتقطها قبل المتصفّح.
// ولا نقصّ ما زاد بعد التنظيف: قصّ ١٢ رقماً إلى ١٠ يصنع رقماً صحيح الشكل غلطاً —
// فيبقى كاملاً وتظهر رسالة الشكل.
export default function MobileInput({ value, onChange, ...rest }) {
  const ref = useRef(null)
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }

  // يُدرج نصّاً مكان التحديد الحالي ثمّ ينظّف الكلّ
  const insert = (el, text) => {
    const cur = String(latest.current.value ?? '')
    const start = el.selectionStart ?? cur.length
    const end = el.selectionEnd ?? cur.length
    latest.current.onChange(cleanMobile(cur.slice(0, start) + text + cur.slice(end)))
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // beforeinput أصيلٌ لا React: يسبق قصّ maxLength. الحرف الواحد يُترك للمتصفّح (والحدّ يعمل)
    const onBeforeInput = (e) => {
      const multi = typeof e.data === 'string' && e.data.length > 1
      if (!multi && e.inputType !== 'insertReplacementText') return
      const text = e.data ?? e.dataTransfer?.getData('text') ?? null
      if (text == null) return
      e.preventDefault()
      insert(el, text)
    }
    el.addEventListener('beforeinput', onBeforeInput)
    return () => el.removeEventListener('beforeinput', onBeforeInput)
  }, [])

  const onPaste = (e) => {
    const pasted = e.clipboardData?.getData('text')
    if (pasted == null) return
    e.preventDefault()
    insert(e.currentTarget, pasted)
  }
  const onDrop = (e) => {
    const dropped = e.dataTransfer?.getData('text')
    if (dropped == null) return
    e.preventDefault()
    insert(e.currentTarget, dropped)
  }
  return (
    <input ref={ref} dir="ltr" inputMode="numeric" maxLength={10} autoComplete="off" placeholder="09XXXXXXXX"
      {...rest} value={value ?? ''} onPaste={onPaste} onDrop={onDrop}
      onChange={(e) => onChange(cleanMobile(e.target.value))} />
  )
}
