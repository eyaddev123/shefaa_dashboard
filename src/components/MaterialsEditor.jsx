import { useState } from 'react'
import { matchesAr } from '../arabic-search.js'
import { toLatinDigits } from '../api.js'

// ═══ محرّر مواد سطر إجراء ═══
// بحثٌ في كتالوج المواد **كاملاً** (لا ربط بين الإجراء وموادّه: الإجراء نفسه
// قد يستهلك مواد مختلفة كلّ مرّة)، ولكلّ مادة كمّيتها. بلا أسعار إطلاقاً:
// الاستقبال لا يرى سعر مادة، والخادم لا يرسله له أصلاً.
//
// value: [{material_id, name, unit, qty}] — qty نصٌّ كما كُتب، يُتحقَّق منه بـ qtyValid.
// والمادّة المعطَّلة القائمة على سطرٍ تبقى في value وإن غابت عن البحث.

const MAX_RESULTS = 8

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

export default function MaterialsEditor({ catalog, value, onChange, disabled }) {
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
            const bad = parseQtyInput(m.qty) === null
            return (
              <li key={m.material_id}>
                <span className="mat-name">{m.name}</span>
                <input className={`mat-qty${bad ? ' is-bad' : ''}`} value={m.qty} inputMode="decimal"
                  disabled={disabled} aria-label={`كمّية ${m.name}`} aria-invalid={bad}
                  onChange={(e) => setQty(m.material_id, e.target.value)} />
                <span className="mat-unit">{m.unit}</span>
                <button type="button" className="mat-x" disabled={disabled}
                  aria-label={`إزالة ${m.name}`} title={`إزالة ${m.name}`}
                  onClick={() => remove(m.material_id)}>×</button>
              </li>
            )
          })}
        </ul>
      )}
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
    </div>
  )
}
