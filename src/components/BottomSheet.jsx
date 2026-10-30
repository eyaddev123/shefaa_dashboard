import { useEffect, useId, useRef, useState } from 'react'

// ═══ ورقةٌ سفلية — لمس أولاً ═══
// تُسحب لتحت فتُغلق (من المقبض أو الرأس — لا من المحتوى كي لا يتعارك السحب مع التمرير)،
// والخلفية وEsc يُغلقانها. على الشاشة الواسعة تبقى ورقةً سفلية بعرضٍ محدود في الوسط.
const CLOSE_DRAG = 90   // بكسل سحبٍ لتحت يكفي للإغلاق

export default function BottomSheet({ title, subtitle, onClose, children, footer }) {
  const id = useId()
  const [drag, setDrag] = useState(0)
  const start = useRef(null)
  const cardRef = useRef(null)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    cardRef.current?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  // زرّ الإغلاق داخل منطقة السحب: لا يُلتقط مؤشّره وإلا ابتلع الالتقاطُ نقرته
  const down = (e) => {
    if (e.target.closest('button')) return
    start.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => { if (start.current != null) setDrag(Math.max(0, e.clientY - start.current)) }
  const up = () => {
    if (start.current == null) return
    start.current = null
    if (drag > CLOSE_DRAG) onClose()
    else setDrag(0)
  }

  return (
    <div className="bs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={cardRef} tabIndex={-1} className={`bs-card${drag ? ' is-dragging' : ''}`} role="dialog"
        aria-modal="true" aria-labelledby={id}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}>
        <div className="bs-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className="bs-handle" aria-hidden="true" />
          <div className="bs-head">
            <div>
              <h3 id={id} className="bs-title">{title}</h3>
              {subtitle && <p className="bs-sub">{subtitle}</p>}
            </div>
            <button type="button" className="ghost bs-x" aria-label="إغلاق" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="bs-body">{children}</div>
        {footer && <div className="bs-foot">{footer}</div>}
      </div>
    </div>
  )
}
