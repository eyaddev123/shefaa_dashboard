import { useId } from 'react'
import { toLatinDigits, fmtMoney } from '../api.js'
import { ComboAdd } from './Combobox.jsx'

// ═══ محرّر مواد سطر إجراء ═══
// قائمةٌ منسدلة من كتالوج المواد **كاملاً** (لا ربط بين الإجراء وموادّه: الإجراء نفسه
// قد يستهلك مواد مختلفة كلّ مرّة)، ولكلّ مادة كمّيتها. الكبسة تعرضها كلّها والكتابة تفلترها
// — في كلّ مكان (طلب المستخدم 2026-11-16: «دروب داون، يعرضون ويبحث نفس الوقت»؛ كان البحث
// الأعمى في صفحة الزيارة وأداة المراجعة).
// الاستقبال لا يرى سعر مادة (الخادم لا يرسله لها). withPrice: الطبيب يرى سعر **البيع** لكلّ مادة
// ومبلغ السطر (unit_price من الكتالوج — طلب المستخدم 2026-11-16)، وسعر الشراء لا يصله أصلاً.
//
// value: [{material_id, name, unit, qty}] — qty نصٌّ كما كُتب، يُتحقَّق منه بـ qtyValid.
// والمادّة المعطَّلة القائمة على سطرٍ تبقى في value وإن غابت عن البحث.
// ومع كلّ مادة الرصيد إن وصل مع الكتالوج (الاستقبال، ومخزون المشرفة في الحديد).
//
// ★ الكمّية: [➖] الرقم [➕] — كبسةٌ = ±1، والكتابة باليد باقية احتياطاً (للكميات الكبيرة).
//   الأدنى 1: ➖ معطّل عنده (الحذف بزرّ ×). الأعلى: الرصيد المتوفر إن وصل مع الكتالوج (الاستقبال؛ ومخزون
//   المشرفة في الحديد) — وعند تعديل سطرٍ محفوظ يُضاف إليه ما صُرف عليه أصلاً (saved). ➕ يتوقّف عنده
//   مع «الرصيد المتوفر: N». الكتابة باليد فوقه تبقى ممكنة: الخادم لا يمنع بالرصيد (يحذّر وحده) — لا قاعدة
//   جديدة هنا. وبلا رصيدٍ في الكتالوج (الطبيب، المراجعة) الأعلى حدّ الخادم وحده.
//   الأزرار تغيّر الحالة المحلّية وحدها: الحفظ بزرّ الشاشة كما كان، بطلبٍ واحد بالكمّية النهائية.

export const MAX_QTY = 9999999999.99   // NUMERIC(12,2) — حدّ الخادم (parseQty)
const round2 = (n) => Math.round(n * 100) / 100

export const parseQtyInput = (v) => {
  const t = toLatinDigits(String(v ?? '')).replace(/[٫,]/g, '.').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}
export const qtyValid = (items) => items.every((m) => parseQtyInput(m.qty) !== null)
export const toPayload = (items) => items.map((m) => ({ material_id: m.material_id, qty: parseQtyInput(m.qty) }))
export const fmtQty = (q) => String(Number(q))
export const materialsSummary = (items) =>
  (items || []).map((m) => `${m.name} ×${fmtQty(m.qty)} ${m.unit}`).join('، ')

const fmtBalance = (n) => Number(n).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const hasPrice = (m) => m && m.unit_price !== undefined && m.unit_price !== null
const materialOption = (m, withPrice) => ({
  value: String(m.id), label: m.name, m,
  meta: [m.unit, withPrice && hasPrice(m) && fmtMoney(m.unit_price),
    m.balance !== undefined && `الرصيد ${fmtBalance(m.balance)}`].filter(Boolean).join(' — '),
  warn: m.balance !== undefined && Number(m.balance) <= 0,
})

/** قيمة المواد بسعر البيع: Σ الكمّية × unit_price من الكتالوج (الكمّية غير الصالحة لا تُحسب) */
export function materialsValue(items, catalog) {
  const byId = new Map((catalog || []).map((m) => [String(m.id), m]))
  return round2((items || []).reduce((t, it) => {
    const c = byId.get(String(it.material_id))
    const q = parseQtyInput(it.qty)
    return hasPrice(c) && q !== null ? t + Number(c.unit_price) * q : t
  }, 0))
}

/**
 * الحدّ الأعلى لكمّية مادة: الرصيد المتوفر (+ ما صُرف عليها في السطر المحفوظ) إن عُرف، وإلا حدّ الخادم.
 * @returns {{max:number, available:number|null}}
 */
export function qtyLimit(material, catalog, saved) {
  const c = (catalog || []).find((m) => String(m.id) === String(material.material_id))
  if (!c || c.balance === undefined || c.balance === null) return { max: MAX_QTY, available: null }
  const already = (saved || []).filter((m) => String(m.material_id) === String(material.material_id))
    .reduce((t, m) => t + Number(m.qty || 0), 0)
  const available = round2(Number(c.balance) + already)
  return { max: Math.max(available, 0), available }
}

// comboHint: نصّ خانة القائمة المنسدلة — الافتراضيّ للاستقبال (مؤنّث)، وشاشة الطبيب تمرّر نصّاً محايداً
export default function MaterialsEditor({ catalog, value, onChange, disabled, saved, withPrice = false, comboHint = 'اكبسي لعرض المواد، أو اكتبي للفلترة…' }) {
  const comboId = `mat-combo-${useId().replace(/:/g, '')}`   // أكثر من محرّر في الصفحة (ورقة الطبيب، الزيارة)
  const chosen = new Set(value.map((m) => String(m.material_id)))
  const priceOf = (id) => {
    const c = (catalog || []).find((x) => String(x.id) === String(id))
    return withPrice && hasPrice(c) ? Number(c.unit_price) : null
  }

  const add = (m) => {
    onChange([...value, { material_id: m.id, name: m.name, unit: m.unit, qty: '1' }])
  }
  const setQty = (id, qty) => onChange(value.map((m) => (String(m.material_id) === String(id) ? { ...m, qty } : m)))
  const remove = (id) => onChange(value.filter((m) => String(m.material_id) !== String(id)))

  // ★ سطرٌ مضغوط لكلّ مادة (طلب المستخدم 2026-11-18، «كل مادة سطرين والبحث بينزل لتحت»): الاسم وتحته
  //   «الوحدة · المبلغ»، وبجانبه العدّاد وزرّ الحذف. والبحث **فوق** القائمة فلا ينزل مع كلّ مادة تُضاف.
  const search = (
    <div className="mat-search">
      <ComboAdd id={comboId} ariaLabel="ابحث عن مادة" disabled={disabled || !catalog}
        placeholder={catalog ? comboHint : 'جارٍ تحميل المواد…'}
        options={(catalog || []).filter((m) => !chosen.has(String(m.id))).map((m) => materialOption(m, withPrice))}
        emptyText="لا مواد متاحة" onPick={(o) => add(o.m)} />
    </div>
  )
  return (
    <div className="mat-editor">
      {search}
      {value.length > 0 && (
        <ul className="mat-chosen">
          {value.map((m) => {
            const q = parseQtyInput(m.qty)
            const bad = q === null
            const { max, available } = qtyLimit(m, catalog, saved)
            const atMax = !bad && q >= max
            const hint = available === null ? '' : `الرصيد المتوفر: ${fmtBalance(available)}`
            // الكسر يُكمَّل بالكبسة: 1.5 ➖ ⇒ 1 · 2.5 ➕ (والأعلى 3) ⇒ 3
            const minus = () => setQty(m.material_id, String(Math.max(1, Number.isInteger(q) ? q - 1 : Math.floor(q))))
            const plus = () => setQty(m.material_id, String(Math.min(max, bad ? 1 : Math.floor(q) + 1)))
            return (
              <li key={m.material_id}>
                <span className="mat-name">{m.name}</span>
                <span className="mat-meta">
                  <span className="mat-unit">{m.unit}</span>
                  {priceOf(m.material_id) !== null && (
                    <span className="mat-price" title={`سعر البيع ${fmtMoney(priceOf(m.material_id))} للـ${m.unit}`}>
                      {fmtMoney(bad ? priceOf(m.material_id) : round2(priceOf(m.material_id) * q))}
                    </span>
                  )}
                </span>
                <span className="mat-step">
                  <button type="button" className="mat-minus" disabled={disabled || bad || q <= 1}
                    aria-label={`إنقاص كمّية ${m.name}`} title={q <= 1 ? 'الأقلّ 1 — للحذف زرّ ×' : `إنقاص ${m.name}`}
                    onClick={minus}>−</button>
                  <input className={`mat-qty${bad ? ' is-bad' : ''}`} value={m.qty} inputMode="decimal"
                    disabled={disabled} aria-label={`كمّية ${m.name}`} aria-invalid={bad}
                    onChange={(e) => setQty(m.material_id, e.target.value)} />
                  <button type="button" className="mat-plus" disabled={disabled || atMax}
                    aria-label={`زيادة كمّية ${m.name}`} title={atMax && hint ? hint : `زيادة ${m.name}`}
                    onClick={plus}>+</button>
                </span>
                <button type="button" className="mat-x" disabled={disabled}
                  aria-label={`إزالة ${m.name}`} title={`إزالة ${m.name}`}
                  onClick={() => remove(m.material_id)}>×</button>
                {/* اللمس لا يُظهر title: التلميح نصٌّ ظاهر عند بلوغ الرصيد */}
                {atMax && hint && <small className="mat-limit" role="status">{hint}</small>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
