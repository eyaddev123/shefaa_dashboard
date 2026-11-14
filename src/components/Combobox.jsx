import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { matchesAr } from '../arabic-search.js'

// ═══ قائمة منسدلة بثيم النظام — بديل <select> حيث يلزم بحث ═══
// Combobox    اختيار قيمة: زرٌّ بشكل الحقل، وبالضغط تنفتح القائمة كاملةً وفيها حقل فلترة.
// ComboAdd    إضافة عناصر: الحقل نفسه يفتح القائمة كاملةً ويفلترها، والاختيار يفرّغه للتالي.
// options: [{value, label, meta?, warn?}] · meta نصٌّ ثانويّ بجانب الاسم · warn يلوّنه تحذيراً.
// اللوحة تُرسم في document.body بموضعٍ ثابت (كلوحة الاختصاصات): النافذة تقصّ ما يفيض منها.
// الأسهم تتنقّل، وEnter يختار، وEsc يغلق القائمة وحدها لا النافذة التي تحتها.

const PANEL_MIN_W = 240
const PANEL_MAX_H = 340

export const byNameAr = (a, b) => a.name.localeCompare(b.name, 'ar')

// مُصدَّرة لقائمة المرضى وهي تكتب (PatientPicker) — النتائج من الخادم لا من options، واللوحة نفسها
export function ComboPanel({ anchorRef, onClose, children }) {
  const [pos, setPos] = useState(null)
  const panelRef = useRef(null)
  const place = () => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(Math.max(r.width, PANEL_MIN_W), window.innerWidth - 16)
    // RTL: الحافّة اليمنى للّوحة على حافّة الحقل اليمنى
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    const below = window.innerHeight - r.bottom - 8
    const up = below < 220 && r.top > below
    setPos({ left, width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(PANEL_MAX_H, (up ? r.top : below) - 8) })
  }
  useLayoutEffect(place, [])
  useEffect(() => {
    const onDoc = (e) => {
      if (anchorRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDoc)
    // تتبع الحقل كلّ إطار: حركة دخول النافذة وتمريرها وتغيّر ارتفاعها لا تُطلق كلّها حدثاً نسمعه
    let raf, last = ''
    const follow = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      const at = r ? `${r.top},${r.bottom},${r.left},${r.width},${window.innerHeight}` : ''
      if (at !== last) { last = at; place() }
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => { window.removeEventListener('mousedown', onDoc); cancelAnimationFrame(raf) }
  }, [])
  return createPortal(
    <div className="combo-panel" ref={panelRef} dir="rtl" style={pos || { visibility: 'hidden' }}>{children}</div>,
    document.body)
}

function ComboList({ id, options, active, selected, setActive, onPick, emptyText }) {
  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.querySelector('li.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <ul className="combobox-list combo-list" role="listbox" id={id} ref={listRef}>
      {options.length === 0 && <li className="empty">{emptyText}</li>}
      {options.map((o, i) => (
        <li key={o.value} role="option" aria-selected={o.value === selected} id={`${id}-${i}`}
          className={i === active ? 'active' : undefined}
          onMouseDown={(e) => { e.preventDefault(); onPick(o) }} onMouseEnter={() => setActive(i)}>
          <span className="cb-main">{o.label}</span>
          {o.meta && <span className={`cb-meta combo-meta${o.warn ? ' is-warn' : ''}`}>{o.meta}</span>}
          {o.value === selected && <span className="combo-check" aria-hidden="true">✓</span>}
        </li>
      ))}
    </ul>
  )
}

const filterOptions = (options, query) => (query.trim() ? options.filter((o) => matchesAr(o.label, query)) : options)

/** مفاتيح القائمة المفتوحة، وحقل الفلترة أو حقل الإضافة يمرّرها إليها */
function listKeys(e, { list, active, setActive, onPick, onClose }) {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, list.length - 1)) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)) }
  else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) onPick(list[active]) }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  else if (e.key === 'Tab') onClose()
}

export default function Combobox({ id, options, value, onChange, placeholder, emptyText = 'لا خيارات', invalid, describedBy }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef(null)
  const list = filterOptions(options, query)
  const current = options.find((o) => o.value === value)
  const listId = `${id}-list`

  const show = () => { setQuery(''); setActive(Math.max(options.findIndex((o) => o.value === value), 0)); setOpen(true) }
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  const pick = (o) => { onChange(o.value); close() }

  return (
    <div className="combo">
      <button type="button" id={id} ref={triggerRef} className="combo-trigger" role="combobox" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={listId} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); show() } }}>
        <span className={`combo-value${current ? '' : ' is-empty'}`}>{current ? current.label : placeholder}</span>
        <span className="combo-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ComboPanel anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <input className="combo-filter" autoFocus autoComplete="off" value={query} placeholder="اكتب للفلترة…"
            aria-label="فلترة القائمة" aria-controls={listId} aria-activedescendant={list[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={(e) => listKeys(e, { list, active, setActive, onPick: pick, onClose: close })} />
          <ComboList id={listId} options={list} active={active} selected={value} setActive={setActive} onPick={pick}
            emptyText={options.length === 0 ? emptyText : 'لا نتيجة بهذا الاسم'} />
        </ComboPanel>
      )}
    </div>
  )
}

export function ComboAdd({ id, options, onPick, placeholder, emptyText = 'لا خيارات', disabled, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const list = filterOptions(options, query)
  const listId = `${id}-list`
  const pick = (o) => { onPick(o); setQuery(''); setActive(0); setOpen(false); inputRef.current?.focus() }

  return (
    <div className="combo combo-add">
      <input id={id} ref={inputRef} type="search" autoComplete="off" value={query} disabled={disabled} placeholder={placeholder}
        role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && list[active] ? `${listId}-${active}` : undefined}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (open) { listKeys(e, { list, active, setActive, onPick: pick, onClose: () => setOpen(false) }); return }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
        }} />
      {open && (
        <ComboPanel anchorRef={inputRef} onClose={() => setOpen(false)}>
          <ComboList id={listId} options={list} active={active} setActive={setActive} onPick={pick}
            emptyText={options.length === 0 ? emptyText : 'لا مادة بهذا الاسم'} />
        </ComboPanel>
      )}
    </div>
  )
}
