import { useState } from 'react'
import { matchesAr } from '../arabic-search.js'
import { toLatinDigits } from '../api.js'
import { ComboAdd } from './Combobox.jsx'

// ═══ محرّر مواد سطر إجراء ═══
// بحثٌ في كتالوج المواد **كاملاً** (لا ربط بين الإجراء وموادّه: الإجراء نفسه
// قد يستهلك مواد مختلفة كلّ مرّة)، ولكلّ مادة كمّيتها. بلا أسعار إطلاقاً:
// الاستقبال لا يرى سعر مادة، والخادم لا يرسله له أصلاً.
//
// value: [{material_id, name, unit, qty}] — qty نصٌّ كما كُتب، يُتحقَّق منه بـ qtyValid.
// والمادّة المعطَّلة القائمة على سطرٍ تبقى في value وإن غابت عن البحث.
// combo: الكبسة تفتح القائمة كاملةً بدل البحث وحده (ComboAdd)، ومعها الرصيد إن وصل مع الكتالوج.
//
// ★ الكمّية: [➖] الرقم [➕] — كبسةٌ = ±1، والكتابة باليد باقية احتياطاً (للكميات الكبيرة).
//   الأدنى 1: ➖ معطّل عنده (الحذف بزرّ ×). الأعلى: الرصيد المتوفر إن وصل مع الكتالوج (الاستقبال؛ ومخزون
//   المشرفة في الحديد) — وعند تعديل سطرٍ محفوظ يُضاف إليه ما صُرف عليه أصلاً (saved). ➕ يتوقّف عنده
//   مع «الرصيد المتوفر: N». الكتابة باليد فوقه تبقى ممكنة: الخادم لا يمنع بالرصيد (يحذّر وحده) — لا قاعدة
//   جديدة هنا. وبلا رصيدٍ في الكتالوج (الطبيب، المراجعة) الأعلى حدّ الخادم وحده.
//   الأزرار تغيّر الحالة المحلّية وحدها: الحفظ بزرّ الشاشة كما كان، بطلبٍ واحد بالكمّية النهائية.

const MAX_RESULTS = 8
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

const fmtBalance = (n) => Number(n).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const materialOption = (m) => ({
  value: String(m.id), label: m.name, m,
  meta: m.balance === undefined ? m.unit : `${m.unit} — الرصيد ${fmtBalance(m.balance)}`,
  warn: m.balance !== undefined && Number(m.balance) <= 0,
})

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

export default function MaterialsEditor({ catalog, value, onChange, disabled, combo, saved }) {
  const [query, setQuery] = useState('')
  const chosen = new Set(value.map((m) => String(m.material_id)))
  const results = query.trim() === '' ? [] : (catalog || [])
    .filter((m) => !chosen.has(String(m.id)) && matchesAr(m.name, query))
    .slice(0, MAX_RESULTS)

  const add = (m) => {
    onChange([...value, { material_id: m.id, name: m.name, unit: m.unit, qty: '1' }])
    setQuery('')
  }
  const setQty = (id, qty) => onChange(value.map((m) => (String(m.material_id) === String(id) ? { ...m, qty } : m)))
  const remove = (id) => onChange(value.filter((m) => String(m.material_id) !== String(id)))

  return (
    <div className="mat-editor">
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
                <span className="mat-step">
                  <button type="button" className="mat-minus" disabled={disabled || bad || q <= 1}
                    aria-label={`إنقاص كمّية ${m.name}`} title={q <= 1 ? 'الأقلّ ١ — للحذف زرّ ×' : `إنقاص ${m.name}`}
                    onClick={minus}>−</button>
                  <input className={`mat-qty${bad ? ' is-bad' : ''}`} value={m.qty} inputMode="decimal"
                    disabled={disabled} aria-label={`كمّية ${m.name}`} aria-invalid={bad}
                    onChange={(e) => setQty(m.material_id, e.target.value)} />
                  <button type="button" className="mat-plus" disabled={disabled || atMax}
                    aria-label={`زيادة كمّية ${m.name}`} title={atMax && hint ? hint : `زيادة ${m.name}`}
                    onClick={plus}>+</button>
                </span>
                <span className="mat-unit">{m.unit}</span>
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
      {combo ? (
        <div className="mat-search">
          <ComboAdd id="mat-combo" ariaLabel="ابحث عن مادة" disabled={disabled || !catalog}
            placeholder={catalog ? 'اكبسي لعرض المواد، أو اكتبي للفلترة…' : 'جارٍ تحميل المواد…'}
            options={(catalog || []).filter((m) => !chosen.has(String(m.id))).map(materialOption)}
            emptyText="لا مواد متاحة" onPick={(o) => add(o.m)} />
        </div>
      ) : (
      <div className="mat-search">
        <input type="search" value={query} disabled={disabled || !catalog}
          placeholder={catalog ? 'ابحث عن مادة لإضافتها… (شاش، جبس…)' : 'جارٍ تحميل المواد…'}
          aria-label="ابحث عن مادة"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter يضيف أوّل نتيجة — الاستقبال يكتب بسرعة وهو يسمع الممرّضة
            if (e.key === 'Enter') { e.preventDefault(); if (results[0]) add(results[0]) }
            if (e.key === 'Escape') setQuery('')
          }} />
        {query.trim() !== '' && (
          <ul className="mat-results" role="listbox">
            {results.length === 0
              ? <li className="mat-none">لا مادة بهذا الاسم{chosen.size ? ' (أو مضافة مسبقاً)' : ''}.</li>
              : results.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => add(m)}>
                    {m.name} <span className="mat-unit">— {m.unit}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      )}
    </div>
  )
}
