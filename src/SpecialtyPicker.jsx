import { useEffect, useState } from 'react'
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

// ═══ اختيارٌ متعدّد لاختصاصات الإجراء، مع «عام» ═══
export function ProcedureSpecialties({ isGeneral, specialtyIds, onChange, canAdd }) {
  const [list, setList] = useState(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.clinic.specialties().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const toggle = (id) => {
    const next = new Set(specialtyIds.map(String))
    if (next.has(String(id))) next.delete(String(id)); else next.add(String(id))
    onChange({ isGeneral: false, specialtyIds: [...next] })
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setNote(null)
    try {
      const r = await api.clinic.addSpecialty(name)
      await load()
      onChange({ isGeneral: false, specialtyIds: [...new Set([...specialtyIds.map(String), String(r.id)])] })
      setNote(r.already_existed ? `موجود: ${r.name} — اختير` : `أُضيف: ${r.name}`)
      setAdding(false); setNewName('')
    } catch (e) { setNote(e.message) }
    finally { setBusy(false) }
  }

  const shown = (list || []).filter((s) => matchesAr(s.name, query))

  return (
    <div className="field">
      <label>الاختصاصات</label>
      <label className="spec-general">
        <input type="checkbox" checked={isGeneral}
          onChange={(e) => onChange({ isGeneral: e.target.checked, specialtyIds: e.target.checked ? [] : specialtyIds })} />
        <span>عام — متاح لكل الاختصاصات</span>
      </label>
      {!isGeneral && (
        <>
          <input className="spec-search" type="search" value={query} placeholder="ابحث عن اختصاص…"
            onChange={(e) => setQuery(e.target.value)} />
          <div className="spec-list">
            {!list ? <p className="empty">جارٍ التحميل…</p>
              : shown.length === 0 ? <p className="empty">لا اختصاص بهذا الاسم.</p>
              : shown.map((s) => (
                <label key={s.id} className="spec-item">
                  <input type="checkbox" checked={specialtyIds.map(String).includes(String(s.id))}
                    onChange={() => toggle(s.id)} />
                  <span>{s.name}</span>
                </label>
              ))}
          </div>
          {canAdd && !adding && (
            <button type="button" className="ghost spec-add" style={{ marginTop: 6 }}
              onClick={() => setAdding(true)}>+ إضافة اختصاص</button>
          )}
          {adding && (
            <div className="spec-row" style={{ marginTop: 6 }}>
              <input value={newName} autoFocus placeholder="اسم الاختصاص الجديد"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
              <button type="button" disabled={busy || !newName.trim()} onClick={create}>
                {busy ? '…' : 'إضافة'}
              </button>
              <button type="button" className="ghost"
                onClick={() => { setAdding(false); setNewName('') }}>إلغاء</button>
            </div>
          )}
          {specialtyIds.length === 0 && (
            <span className="hint spec-warn">⚠ اختر «عام» أو اختصاصاً — وإلا لم يظهر لأحد</span>
          )}
        </>
      )}
      {note && <span className="hint">{note}</span>}
    </div>
  )
}
