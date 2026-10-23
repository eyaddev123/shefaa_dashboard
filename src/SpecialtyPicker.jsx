import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api.js'
import { matchesAr } from './arabic-search.js'

// ═══════════════════════════════════════════════════════════════════
// اختيار الاختصاص — قائمةٌ ببحثٍ وزرّ «+ إضافة اختصاص» بجانبها
//
// لا صفحة إدارةٍ منفصلة: من يضيف دكتوراً أو إجراءً هو من يكتشف أنّ الاختصاص
// ناقص، وإرساله إلى شاشةٍ أخرى يقطع عمله ويدفعه لكتابة أقرب اسمٍ موجود.
//
// وكشف التكرار قبل الإنشاء: الخادم يُعيد الموجود بدل أن يُنشئ ثانياً، فنقول
// «موجود: عظمية» ونختاره — لا رسالة خطأٍ غامضة عن تفرّد.
// ═══════════════════════════════════════════════════════════════════

export function SpecialtyPicker({ value, onChange, canAdd, label = 'الاختصاص', required }) {
  const [list, setList] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.clinic.specialties().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setNote(null)
    try {
      const r = await api.clinic.addSpecialty(name)
      await load()
      onChange(String(r.id))
      setNote(r.already_existed ? `موجود: ${r.name} — اختير` : `أُضيف: ${r.name}`)
      setAdding(false); setNewName('')
    } catch (e) { setNote(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="spec-row">
        <select value={value || ''} required={required}
          onChange={(e) => { onChange(e.target.value); setNote(null) }}>
          <option value="">— بلا اختصاص —</option>
          {(list || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {canAdd && !adding && (
          <button type="button" className="ghost spec-add"
            onClick={() => { setAdding(true); setNote(null) }}>+ إضافة اختصاص</button>
        )}
      </div>
      {adding && (
        <div className="spec-row" style={{ marginTop: 6 }}>
          <input value={newName} autoFocus placeholder="اسم الاختصاص الجديد"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
          <button type="button" disabled={busy || !newName.trim()} onClick={create}>
            {busy ? '…' : 'إضافة'}
          </button>
          <button type="button" className="ghost"
            onClick={() => { setAdding(false); setNewName(''); setNote(null) }}>إلغاء</button>
        </div>
      )}
      {note && <span className="hint">{note}</span>}
      {!value && <span className="hint spec-warn">⚠ بلا اختصاص — سيرى الإجراءات العامّة وحدها</span>}
    </div>
  )
}

// ═══ اختصاصات الإجراء: قائمةٌ منسدلة متعدّدة الاختيار، و«عام» أوّلها ═══
//
// حقلٌ بارتفاع بقيّة الحقول: المختار شاراتٌ صغيرة داخله («عظمية ×»)، وبالضغط
// تنفتح قائمةٌ ببحث. «عام» هو الافتراض، واختيار أيّ اختصاصٍ يُلغيه، وإزالة آخر
// اختصاصٍ تُعيده — فلا حالة «لا عام ولا اختصاص» أصلاً، ولا يختفي إجراءٌ عن الجميع.
//
// اللوحة تُرسم في document.body بموضعٍ ثابت: البطاقة تقصّ ما يفيض منها
// (overflow-x: auto يجعل المحور الرأسيّ auto أيضاً)، فلوحةٌ داخلها تُقطع.
const PANEL_MIN_W = 260
const PANEL_MAX_H = 320
const MAX_CHIPS = 2      // ما يتّسع في سطرٍ واحد؛ والباقي «+N»

export function ProcedureSpecialties({ isGeneral, specialtyIds, onChange, canAdd, id, label = 'الاختصاصات', hideLabel }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState(null)
  const fieldRef = useRef(null)
  const panelRef = useRef(null)

  const load = () => api.clinic.specialties().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const ids = specialtyIds.map(String)
  const general = isGeneral || ids.length === 0
  const byId = new Map((list || []).map((s) => [String(s.id), s]))
  const chosen = ids.map((x) => byId.get(x)).filter(Boolean)

  // القاعدة كلّها هنا: «عام» ⇐ لا اختصاص، واختصاصٌ ⇐ لا «عام»
  const setIds = (next) => onChange(next.length ? { isGeneral: false, specialtyIds: next } : { isGeneral: true, specialtyIds: [] })
  const toggle = (sid) => setIds(ids.includes(String(sid)) ? ids.filter((x) => x !== String(sid)) : [...ids, String(sid)])
  const pickGeneral = () => onChange({ isGeneral: true, specialtyIds: [] })

  // ═══ موضع اللوحة: تحت الحقل، أو فوقه إن ضاق ما تحته ═══
  const place = () => {
    const el = fieldRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(Math.max(r.width, PANEL_MIN_W), window.innerWidth - 16)
    // RTL: الحافّة اليمنى للّوحة على حافّة الحقل اليمنى
    let left = r.right - width
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    const below = window.innerHeight - r.bottom - 8
    const up = below < 220 && r.top > below
    setPos({ left, width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(PANEL_MAX_H, (up ? r.top : below) - 8) })
  }
  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (fieldRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      close()
    }
    const onKey = (e) => { if (e.key === 'Escape') { close(); fieldRef.current?.focus() } }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  const close = () => { setOpen(false); setQuery(''); setAdding(false); setNewName('') }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setNote(null)
    try {
      // الخادم يكشف التكرار ويُعيد الموجود — فنقول «موجود: …» ونختاره
      const r = await api.clinic.addSpecialty(name)
      await load()
      if (!ids.includes(String(r.id))) setIds([...ids, String(r.id)])
      setNote(r.already_existed ? `موجود: ${r.name} — اختير` : `أُضيف: ${r.name}`)
      setAdding(false); setNewName('')
    } catch (e) { setNote(e.message) }
    finally { setBusy(false) }
  }

  const shown = (list || []).filter((s) => matchesAr(s.name, query))
  const extra = chosen.length - MAX_CHIPS

  return (
    <div className="field spec-ms">
      {!hideLabel && <label htmlFor={id}>{label}</label>}
      <div ref={fieldRef} id={id} className={`spec-ms-field${open ? ' is-open' : ''}`} role="combobox" tabIndex={0}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && !open) { e.preventDefault(); setOpen(true) } }}>
        {general ? (
          <span className="spec-ms-general">عام — لكل الاختصاصات</span>
        ) : (
          <span className="spec-ms-chips">
            {chosen.slice(0, MAX_CHIPS).map((s) => (
              <span key={s.id} className="spec-chip">
                {s.name}
                <button type="button" className="spec-chip-x" aria-label={`إزالة ${s.name}`}
                  onClick={(e) => { e.stopPropagation(); toggle(s.id) }}>×</button>
              </span>
            ))}
            {extra > 0 && <span className="spec-chip spec-chip-more" title={chosen.slice(MAX_CHIPS).map((s) => s.name).join('، ')}>+{extra}</span>}
          </span>
        )}
      </div>

      {open && pos && createPortal(
        <div ref={panelRef} className="spec-ms-panel" dir="rtl" role="listbox" aria-multiselectable="true"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}>
          <input className="spec-ms-search" type="search" value={query} autoFocus placeholder="ابحث عن اختصاص…"
            aria-label="ابحث عن اختصاص" onChange={(e) => setQuery(e.target.value)} />
          <div className="spec-ms-options">
            {query.trim() === '' && (
              <label className={`spec-ms-opt is-general${general ? ' is-on' : ''}`} role="option" aria-selected={general}>
                <input type="checkbox" checked={general} onChange={pickGeneral} />
                <span>عام — متاح لكل الاختصاصات</span>
              </label>
            )}
            {!list ? <p className="spec-ms-empty">جارٍ التحميل…</p>
              : shown.length === 0 ? <p className="spec-ms-empty">لا اختصاص بهذا الاسم.</p>
              : shown.map((s) => {
                const on = !general && ids.includes(String(s.id))
                return (
                  <label key={s.id} className={`spec-ms-opt${on ? ' is-on' : ''}`} role="option" aria-selected={on}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                    <span>{s.name}</span>
                  </label>
                )
              })}
          </div>
          {canAdd && (
            <div className="spec-ms-foot">
              {adding ? (
                <div className="spec-ms-addrow">
                  <input value={newName} autoFocus placeholder="اسم الاختصاص الجديد" aria-label="اسم الاختصاص الجديد"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
                  <button type="button" disabled={busy || !newName.trim()} onClick={create}>{busy ? '…' : 'إضافة'}</button>
                  <button type="button" className="ghost" onClick={() => { setAdding(false); setNewName('') }}>إلغاء</button>
                </div>
              ) : (
                <button type="button" className="ghost spec-ms-addbtn"
                  onClick={() => { setAdding(true); setNewName(query.trim()); setNote(null) }}>+ إضافة اختصاص</button>
              )}
              {note && <span className="spec-ms-note">{note}</span>}
            </div>
          )}
        </div>,
        document.body)}
    </div>
  )
}

// للعرض في الجدول: «عام» أو أسماء الاختصاصات
export function specialtiesText(proc) {
  if (proc.is_general || !(proc.specialties || []).length) return 'عام'
  return proc.specialties.map((s) => s.name).join('، ')
}
