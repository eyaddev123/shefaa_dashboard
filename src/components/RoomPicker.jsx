import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RECORDED_ROOMS } from '../audio-clips.js'
import { occupantLabel } from '../room-occupancy.js'

// ═══ تعديل الغرفة بنقرة — من لوحة العيادات اليومية ═══
// الشارة نفسها (RoomBadge) لكنها زرّ: نقرةٌ تفتح قائمة الغرف و«بلا غرفة»، والاختيار
// يُرسَل فوراً (onPick) — التأكيد والإشعار عند صاحب الصفحة، فهو من يعرف الجلسة.
//
// القائمة position: fixed لا absolute: البطاقة overflow-x: auto فتقصّ ما يتدلّى منها.
// وتُغلق بالتمرير وتغيير الحجم بدل أن تلاحق زرّاً تحرّك من تحتها.
//
// الغرف = المسجَّلة صوتياً (RECORDED_ROOMS) ∪ ما على الدكاترة فعلاً (rooms). غرفةٌ بلا
// تسجيل تبقى قابلةً للاختيار لكنها موسومة: النداء إليها بصوت المتصفّح الآلي.
// occupants: غرفة ← [{name, live, hours}] من فيها اليوم غير هذا الدكتور (roomOccupants):
// «الآن» بلونٍ تحذيريّ هادئ (تسحبها من دكتورٍ شغّال)، وغيره باهتٌ بأوقات دوامه (متاحةٌ
// عملياً لوقتٍ آخر). والاختيار مسموحٌ في الحالتين.
const roomSort = (a, b) => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na !== nb) return na ? -1 : 1
  return a.localeCompare(b, 'ar')
}

export default function RoomPicker({ room, rooms = [], occupants = {}, disabled, onPick }) {
  const current = String(room ?? '').trim()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const pop = useRef(null)

  const options = [...new Set([...RECORDED_ROOMS, ...rooms.map((r) => String(r ?? '').trim()).filter(Boolean)])]
    .sort(roomSort)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    // RTL: حافّة القائمة اليمنى على حافّة الزرّ اليمنى، ولا تخرج من الشاشة يساراً
    const width = 320
    const right = Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - width - 8))
    const below = window.innerHeight - r.bottom
    setPos(below < 260 && r.top > below
      ? { bottom: window.innerHeight - r.top + 6, right, width }
      : { top: r.bottom + 6, right, width })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    const onDown = (e) => {
      if (pop.current?.contains(e.target) || btn.current?.contains(e.target)) return
      close()
    }
    const onKey = (e) => { if (e.key === 'Escape') { close(); btn.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useEffect(() => { if (open) pop.current?.querySelector('[aria-checked="true"], button')?.focus() }, [pos])

  const pick = (value) => {
    setOpen(false)
    if ((value ?? '') !== current) onPick(value)
  }

  return (
    <>
      <button type="button" ref={btn} disabled={disabled}
        className={`room-badge editable${current ? '' : ' none'}`}
        aria-haspopup="menu" aria-expanded={open}
        title="تغيير الغرفة — تنتقل الشاشة والنداء والبطاقات الجديدة فوراً"
        onClick={() => setOpen((v) => !v)}>
        {current ? `العيادة ${current}` : 'بلا عيادة'}
        <svg className="room-badge-edit" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos && (
        <div ref={pop} className="room-pop" role="menu" aria-label="اختر الغرفة"
          style={{ top: pos.top, bottom: pos.bottom, right: pos.right, width: pos.width }}>
          <div className="room-pop-grid">
            {options.map((r) => {
              const taken = occupants[r] || []
              const first = taken[0]
              const recorded = RECORDED_ROOMS.includes(r)
              const label = [...taken.map((o) => occupantLabel(r, o)),
                recorded ? '' : 'لا تسجيل صوتي لهذه الغرفة — يُنطق بالصوت الآلي'].filter(Boolean).join(' · ')
              return (
                <button key={r} type="button" role="menuitemradio" aria-checked={r === current}
                  className={`room-pop-item${r === current ? ' on' : ''}${first ? (first.live ? ' live' : ' later') : ''}`}
                  title={label || undefined} aria-label={label ? `العيادة ${r} — ${label}` : `العيادة ${r}`}
                  onClick={() => pick(r)}>
                  <span className="room-pop-num">{r}</span>
                  <span className="room-pop-text">
                    {first && (
                      <span className="room-pop-who">{first.name}{taken.length > 1 ? ` +${taken.length - 1}` : ''}</span>
                    )}
                    {first && (
                      <span className="room-pop-when">{first.live ? 'الآن' : first.hours || '—'}</span>
                    )}
                    {!first && !recorded && <span className="room-pop-when">بلا صوت</span>}
                  </span>
                </button>
              )
            })}
          </div>
          <button type="button" role="menuitemradio" aria-checked={!current}
            className={`room-pop-none${current ? '' : ' on'}`} onClick={() => pick(null)}>
            بلا غرفة
          </button>
        </div>
      )}
    </>
  )
}
