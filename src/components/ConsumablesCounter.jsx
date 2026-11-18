import { fmtMoney } from '../api.js'

// ═══ عدّاد المستهلكات — «أجرة + مواد» (طلب المستخدم 2026-11-17) ═══
// المستهلكات تقديرٌ لكلّ إجراء لا قيمةٌ ثابتة: إجراءٌ يأخذ أكثر مرّةً وأقلّ مرّة. تقدّرها الاستقبال أو
// الدكتور بـ [➖] المبلغ [➕] بخطوة 10 من 10 إلى 100، و0 = لا مستهلكات. تُضاف على المريض فوق الأجرة.
// الحدود نفسها في الخادم (parseConsumablesInput) — الواجهة لا تحرس وحدها.
export const CONS_STEP = 10
export const CONS_MAX = 100
export const CONSUMABLES_HINT = 'المستهلكات: ما يُستهلك ولا يُعدّ — بوفيدون، قطن، شاش، كفوف، لاصق. قيمتها تقديرية حسب الإجراء (من 10 إلى 100)، وتُضاف على المريض فوق الأجرة.'

export default function ConsumablesCounter({ value, onChange, disabled, hint = true, label = 'المستهلكات' }) {
  const v = Number(value) || 0
  return (
    <div className="cons-counter">
      <div className="cons-row">
        <span className="cons-label">{label}</span>
        <span className="mat-step">
          <button type="button" className="mat-minus" disabled={disabled || v <= 0}
            aria-label="إنقاص المستهلكات" onClick={() => onChange(Math.max(0, v - CONS_STEP))}>−</button>
          <output className="cons-value" aria-live="polite">{v === 0 ? 'لا شيء' : fmtMoney(v)}</output>
          <button type="button" className="mat-plus" disabled={disabled || v >= CONS_MAX}
            aria-label="زيادة المستهلكات" title={v >= CONS_MAX ? `الأعلى ${CONS_MAX}` : undefined}
            onClick={() => onChange(Math.min(CONS_MAX, v + CONS_STEP))}>+</button>
        </span>
      </div>
      {hint && <p className="cons-hint">{CONSUMABLES_HINT}</p>}
    </div>
  )
}
