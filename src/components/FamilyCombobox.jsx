import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

// بحث حيّ عن عائلة بدل قائمة منسدلة بآلاف العائلات.
// يبحث بالسيرفر (اسم/رقم ملف/هاتف) مع debounce، ويدعم لوحة المفاتيح وRTL.
// value = { id, file_number, head_name } أو null. onChange يستقبل نفس الشكل.
export default function FamilyCombobox({ value, onChange, autoFocus }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const timer = useRef(null)

  // إن مُرّرت عائلة مختارة مسبقاً (?family=)، نعرض اسمها في الحقل
  useEffect(() => {
    if (value && value.head_name) setText(`${value.file_number} — ${value.head_name}`)
  }, [value?.id]) // eslint-disable-line

  // بحث مؤجَّل 300ms — لا نُرهق السيرفر بكل حرف
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = text.trim()
    if (q.length < 2 || (value && `${value.file_number} — ${value.head_name}` === text)) {
      setResults([]); return
    }
    timer.current = setTimeout(() => {
      setLoading(true)
      api.familyLookup(q).then((r) => { setResults(r); setOpen(true); setActive(-1) })
        .catch(() => setResults([])).finally(() => setLoading(false))
    }, 300)
    return () => timer.current && clearTimeout(timer.current)
  }, [text]) // eslint-disable-line

  // إغلاق عند النقر خارج المكوّن
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (fam) => {
    onChange(fam)
    setText(`${fam.file_number} — ${fam.head_name}`)
    setOpen(false); setActive(-1)
  }

  const onKey = (e) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(results[active]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const badge = (state) =>
    state === 'suspended' ? <span className="standing-badge suspended sm">اعتماد معلّق</span>
    : state === 'active' ? <span className="standing-badge sm">معتمدة دائماً</span>
    : null

  return (
    <div className="combobox" ref={boxRef}>
      <input
        value={text} autoFocus={autoFocus} autoComplete="off" dir="rtl"
        onChange={(e) => { setText(e.target.value); if (value) onChange(null) }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
        placeholder="ابحث بالاسم أو رقم الملف أو الهاتف…"
        role="combobox" aria-expanded={open} aria-autocomplete="list" />
      {open && (
        <ul className="combobox-list" role="listbox">
          {loading && <li className="empty">جارٍ البحث…</li>}
          {!loading && results.length === 0 && <li className="empty">لا نتائج</li>}
          {results.map((fam, i) => (
            <li key={fam.id} role="option" aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(fam) }}
                onMouseEnter={() => setActive(i)}>
              <span className="cb-main">{fam.file_number} — {fam.head_name}</span>
              <span className="cb-meta">
                {fam.mobile && <span dir="ltr" className="muted">{fam.mobile}</span>}
                {badge(fam.standing_state)}
                {fam.has_block_issue && <span className="badge bad sm">مشكلة بيانات</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
