import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════
// نوافذ التأكيد والإدخال — من داخل النظام لا من المتصفّح
//
// window.confirm/alert/prompt تكتب «localhost:5173 says» (واسم النطاق على
// الإنتاج)، وأزرارها إنكليزية، وخطّها خطّ النظام، ولا تعرف الثيم الداكن.
// ناشزةٌ عن كل شاشة، وتكشف عنوان الموقع لمن يقف أمام الشاشة.
//
// ═══ لماذا واجهةٌ بالوعد (await) لا مكوّنٌ لكل موضع ═══
// ٢٦ موضعاً في ١١ ملفاً تستعمل الصيغة `if (!confirm(...)) return`. وبالوعد
// يصير البديل سطراً واحداً: `if (!await confirm({...})) return` — فلا يُعاد
// بناء منطق كل شاشة، ولا يُنسى موضعٌ في التحويل.
// ═══════════════════════════════════════════════════════════════════

const DialogContext = createContext(null)

/** يُغلّف التطبيق مرّةً واحدة في App.jsx */
export function DialogProvider({ children }) {
  const [state, setState] = useState(null)   // { kind, title, body, ... , resolve }
  const resolveRef = useRef(null)

  const open = useCallback((cfg) => new Promise((resolve) => {
    resolveRef.current = resolve
    setState(cfg)
  }), [])

  const finish = useCallback((value) => {
    setState(null)
    const r = resolveRef.current
    resolveRef.current = null
    if (r) r(value)
  }, [])

  const api = useRef({
    confirm: (cfg) => open({ kind: 'confirm', ...normalize(cfg) }),
    alert: (cfg) => open({ kind: 'alert', ...normalize(cfg) }),
    prompt: (cfg) => open({ kind: 'prompt', ...normalize(cfg) }),
  }).current

  return (
    <DialogContext.Provider value={api}>
      {children}
      {state && <Dialog {...state} onFinish={finish} />}
    </DialogContext.Provider>
  )
}

// نصٌّ وحده أو كائنٌ كامل — فالمواضع البسيطة تبقى سطراً واحداً
const normalize = (cfg) => (typeof cfg === 'string' ? { body: cfg } : cfg)

export function useDialogs() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialogs خارج DialogProvider')
  return ctx
}

function Dialog({
  kind, title, body, confirmLabel, cancelLabel, danger, placeholder,
  defaultValue = '', required, onFinish,
}) {
  const [value, setValue] = useState(defaultValue)
  const cardRef = useRef(null)
  const inputRef = useRef(null)
  const confirmRef = useRef(null)

  // التركيز يدخل النافذة: لوحة المفاتيح تعمل، وقارئ الشاشة يقرأ العنوان
  useEffect(() => {
    const t = setTimeout(() => {
      if (kind === 'prompt' && inputRef.current) inputRef.current.focus()
      else if (confirmRef.current) confirmRef.current.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [kind])

  // Esc يُلغي، وEnter يؤكّد — ومحاصرة Tab داخل النافذة فلا يتسرّب التركيز خلفها
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onFinish(kind === 'confirm' || kind === 'prompt' ? (kind === 'prompt' ? null : false) : true) }
      else if (e.key === 'Enter' && kind !== 'prompt') { e.preventDefault(); accept() }
      else if (e.key === 'Tab' && cardRef.current) {
        const f = cardRef.current.querySelectorAll('button, input, textarea, select, a[href]')
        if (f.length === 0) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const accept = () => {
    if (kind === 'prompt') {
      const v = value.trim()
      if (required && !v) { inputRef.current?.focus(); return }
      onFinish(v)
    } else onFinish(true)
  }
  const cancel = () => onFinish(kind === 'prompt' ? null : kind === 'alert' ? true : false)

  const okLabel = confirmLabel || (kind === 'alert' ? 'حسناً' : 'تأكيد')

  return (
    <div className="modal-backdrop dlg-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel() }}>
      <div className="modal-card dlg-card" ref={cardRef} dir="rtl"
        role={kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-labelledby={title ? 'dlg-title' : undefined}
        aria-describedby="dlg-body">
        {title && <h3 id="dlg-title" className="dlg-title">{title}</h3>}
        {/* النصّ قد يحمل أسطراً — نحترمها بـ white-space لا بوسوم */}
        <p id="dlg-body" className="dlg-body">{body}</p>

        {kind === 'prompt' && (
          <input ref={inputRef} className="dlg-input" value={value} placeholder={placeholder || ''}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); accept() } }} />
        )}

        <div className="dlg-actions">
          {kind !== 'alert' && (
            <button type="button" className="ghost" onClick={cancel}>
              {cancelLabel || 'إلغاء'}
            </button>
          )}
          <button type="button" ref={confirmRef}
            className={danger ? 'danger' : ''}
            disabled={kind === 'prompt' && required && !value.trim()}
            onClick={accept}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
