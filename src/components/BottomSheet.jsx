import { useEffect, useId, useRef, useState } from 'react'

// ═══ ورقةٌ سفلية على الجوال، ونافذةٌ في وسط الشاشة على التابلت واللابتوب (≥٦٤٠px) ═══
// (ملاحظة المستخدم 2026-11-15: الورقة من أسفل شاشةٍ عريضة «المنظر ببكي — خليه dialog») — الشكل بالـCSS وحده.
// تُسحب لتحت فتُغلق (من المقبض أو الرأس — لا من المحتوى كي لا يتعارك السحب مع التمرير)،
// والخلفية وEsc يُغلقانها. على الشاشة الواسعة تبقى ورقةً سفلية بعرضٍ محدود في الوسط.
const CLOSE_DRAG = 90   // بكسل سحبٍ لتحت يكفي للإغلاق

export default function BottomSheet({ title, subtitle, onClose, children, footer }) {
  const id = useId()
  const [drag, setDrag] = useState(0)
  const start = useRef(null)
  const cardRef = useRef(null)

  // ★ (2026-11-19) كان التأثير يتبع onClose — دالّةٌ جديدة مع كلّ رسم عند الأب — فيُعاد مع كلّ حرف
  //   ويسحب التركيز إلى الورقة: «نحذف حرفاً فيقف، ونكبس على الخانة من جديد». الآن: Esc عبر ref،
  //   والتركيز مرّةً واحدة عند الفتح وحده، ولا يُنتزع من خانةٍ داخل الورقة (autoFocus).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    if (!cardRef.current?.contains(document.activeElement)) cardRef.current?.focus()
  }, [])

  // ★ (2026-11-22، آيفون الدكتورة) الكيبورد على الآيفون لا يُنقص 100vh ولا innerHeight — يُنقص المنطقة
  //   المرئية وحدها (visualViewport) وقد يزيحها. فكانت الورقة تبقى بطولها وزرّ «إضافة» والمجموع خلف
  //   الكيبورد، والصفحة تحتها تتمرّر معها. الآن الخلفية تأخذ المنطقة المرئية نفسها (موضعاً وطولاً)،
  //   والصفحة تحت الورقة لا تتمرّر ما دامت مفتوحة.
  const backRef = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport
    const fit = () => {
      const b = backRef.current
      if (!b || !vv) return
      b.style.top = `${vv.offsetTop}px`
      b.style.height = `${vv.height}px`
      b.style.bottom = 'auto'
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    const html = document.documentElement
    const prev = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'
    return () => {
      vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit)
      ;[html.style.overflow, document.body.style.overflow] = prev
    }
  }, [])

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
    <div ref={backRef} className="bs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
