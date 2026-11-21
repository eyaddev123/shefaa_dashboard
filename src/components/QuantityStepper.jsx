import { useEffect, useState } from 'react'
import { fmtMoney } from '../api.js'

// ═══ العدد على الإجراء (طلب المستخدم 2026-11-22: «تخطيط أعصاب طرف × 4») ═══
// [−] العدد [+] ويُكتب باليد أيضاً، من 1 إلى QTY_MAX (حارس غلطة كتابة لا حدٌّ عمليّ — «خليك فلكسبل»).
// unitPrice: يُعرض «75,000 × 4 = 300,000» حين يكبر العدد. الحدود نفسها في الخادم (parseQuantityInput).
export const QTY_MAX = 100
const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

export default function QuantityStepper({ value, onChange, disabled, unitPrice, label = 'العدد' }) {
  const v = Math.max(1, Number(value) || 1)
  const [text, setText] = useState(String(v))
  useEffect(() => { setText(String(v)) }, [v])
  const commit = (raw) => {
    const n = Number(toLatin(raw).trim())
    if (Number.isInteger(n) && n >= 1 && n <= QTY_MAX) { if (n !== v) onChange(n) } else setText(String(v))
  }
  return (
    <div className="qty-stepper">
      <span className="cons-label">{label}</span>
      <span className="mat-step">
        <button type="button" className="mat-minus" disabled={disabled || v <= 1}
          aria-label="إنقاص العدد" onClick={() => onChange(v - 1)}>−</button>
        <input className="qty-value" inputMode="numeric" aria-label={label} value={text} disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(toLatin(e.target.value).trim())
            if (Number.isInteger(n) && n >= 1 && n <= QTY_MAX && n !== v) onChange(n)
          }}
          onBlur={(e) => commit(e.target.value)}
          onFocus={(e) => e.target.select()} />
        <button type="button" className="mat-plus" disabled={disabled || v >= QTY_MAX}
          aria-label="زيادة العدد" onClick={() => onChange(v + 1)}>+</button>
      </span>
      {unitPrice != null && v > 1 && (
        <span className="qty-calc">{fmtMoney(unitPrice)} × {v} = <strong>{fmtMoney(unitPrice * v)}</strong></span>
      )}
    </div>
  )
}
