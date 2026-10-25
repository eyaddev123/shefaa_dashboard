import { useEffect, useId, useState } from 'react'
import { toLatinDigits } from '../../api.js'

// ═══ أدوات صفحة المخزون المشتركة ═══
// الأرقام بفواصل الآلاف وأرقامٍ عربية كبقية النظام (ar-SY)، والتواريخ بصيغته.

export const fmtQty = (q) => (q === null || q === undefined ? '—'
  : Number(q).toLocaleString('ar-SY', { maximumFractionDigits: 2 }))
// «+٢٠» و«−٣» — علامة الطرح الحقيقية لا الشرطة
export const fmtSigned = (q) => (Number(q) > 0 ? '+' : Number(q) < 0 ? '−' : '') + fmtQty(Math.abs(Number(q)))
// يومٌ «YYYY-MM-DD» بتوقيت الجهاز (لا UTC) — بصيغة fmtDate في النظام
export const fmtDay = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString('ar-SY', { year: 'numeric', month: 'long', day: 'numeric' }) : '—')
export const fmtPct = (n) => `${Number(n).toLocaleString('ar-SY', { maximumFractionDigits: 1 })}٪`

// «مادة واحدة» · «مادتان» · «٣ مواد» · «١١ مادة»
export function materialsCount(n) {
  if (n === 1) return 'مادة واحدة'
  if (n === 2) return 'مادتان'
  const k = Number(n).toLocaleString('ar-SY')
  return n >= 3 && n <= 10 ? `${k} مواد` : `${k} مادة`
}

export const TYPE_LABELS = { purchase: 'شراء', consumption: 'استهلاك', adjustment: 'تسوية', opening: 'افتتاحي' }
// الشراء والافتتاحي دخولٌ (أزرق هادئ)، والباقي محايد — الألوان للحالات لا للزينة
export const TYPE_BADGE = { purchase: 'blue', opening: 'blue', consumption: '', adjustment: '' }
export const REASONS = [
  ['damaged', 'تالف'], ['expired', 'منتهي الصلاحية'], ['lost', 'ضائع'], ['entry_error', 'غلط تسجيل'], ['other', 'أخرى'],
]

// حالة المخزون: كلمةٌ ونقطةٌ ملوّنة — البرتقالي للشراء، والأحمر للسالب، والباقي محايد
export function stockStatus(m) {
  if (!m.is_active) return { cls: '', label: 'غير مفعّلة' }
  if (m.balance < 0) return { cls: 'bad', label: 'رصيد سالب' }
  if (m.needs_purchase) return { cls: 'warn', label: 'تحتاج شراء' }
  return { cls: '', label: 'متوفّرة' }
}

// رقمٌ من حقل نصّ (أرقام عربية وفواصل آلاف) — للعرض والتحقّق الخفيف؛ الخادم هو الحَكَم
export function parseNum(v) {
  let t = toLatinDigits(String(v ?? '')).replace(/[\s٬]/g, '')
  if (t === '') return null
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  t = t.replace(/[٫,]/g, '.')
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

/** نافذة داخل النظام: Esc والنقر خارجها يُغلقانها (إلا أثناء الحفظ) */
export function Modal({ title, subtitle, onClose, busy, wide, children }) {
  const id = useId()
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [busy, onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className={`modal-card inv-modal${wide ? ' inv-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <h3 id={id} className="inv-modal-title">{title}</h3>
        {subtitle && <p className="inv-modal-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

/**
 * قائمة الوحدات وفي آخرها «+ وحدة جديدة» تفتح حقل نصٍّ مكانها.
 * value: {unit_id, unit} — unit_id لوحدةٍ قائمة، أو unit نصّاً لوحدةٍ جديدة يُنشئها الخادم.
 */
export function UnitSelect({ id, units, value, onChange, disabled }) {
  const [adding, setAdding] = useState(false)
  if (adding) {
    return (
      <div className="inv-unit-new">
        <input id={id} autoFocus value={value.unit} maxLength={30} placeholder="اسم الوحدة الجديدة (مثال: بكرة)"
          disabled={disabled} onChange={(e) => onChange({ unit_id: '', unit: e.target.value })} />
        <button type="button" className="link-btn" disabled={disabled}
          onClick={() => { setAdding(false); onChange({ unit_id: '', unit: '' }) }}>من القائمة</button>
      </div>
    )
  }
  return (
    <select id={id} value={value.unit_id} disabled={disabled}
      onChange={(e) => {
        if (e.target.value === '__new') { setAdding(true); onChange({ unit_id: '', unit: '' }) }
        else onChange({ unit_id: e.target.value, unit: '' })
      }}>
      <option value="">اختر الوحدة…</option>
      {(units || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      <option value="__new">+ وحدة جديدة…</option>
    </select>
  )
}

export const unitPayload = (u) => (u.unit_id ? { unit_id: Number(u.unit_id) } : { unit: u.unit })
export const unitChosen = (u) => !!(u.unit_id || u.unit.trim())

/** حالةٌ فارغة مصمَّمة: سطرٌ قصير وزرّ الخطوة المنطقية — لا جدولٌ فارغ */
export function EmptyState({ text, hint, children }) {
  return (
    <div className="inv-empty">
      <p className="inv-empty-text">{text}</p>
      {hint && <p className="inv-empty-hint">{hint}</p>}
      {children && <div className="inv-empty-actions">{children}</div>}
    </div>
  )
}
