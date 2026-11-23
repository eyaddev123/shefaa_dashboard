import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { canOperateQueue } from '../permissions.js'
import { Modal } from './inventory/shared.jsx'

// ═══ رسالة واتساب لمن «لم يحضر» (طلب المستخدم 2026-11-23) ═══
// بعد «لم يحضر» تُفتح هذه النافذة: نصّ الرسالة (من الخادم — مصدرٌ واحد) وزرّ يفتح واتساب على
// رقم المريض والرسالة مكتوبة. الموظفة تراجع في واتساب وتضغط «إرسال» بنفسها — لا إرسال آليّ.
//
// ★ لماذا مضيفٌ واحد لا نافذةٌ داخل كلّ زرّ: زرّ «ما حضر» في صفّ الطابور يُعيد تحميل الطابور،
//   فينتقل الصفّ لتبويبٍ آخر ويختفي الزرّ ومعه أيّ نافذة يملكها. المضيف في التطبيق يبقى.
// ★ ولماذا زرٌّ لا فتحٌ تلقائي: المتصفّح يمنع فتح نافذةٍ بعد انتظار الخادم (ليس بكبسة مباشرة)،
//   والزرّ يحمي من «لم يحضر» بالغلط ثمّ التراجع عنه.

const listeners = new Set()
/** يفتح النافذة لحجزٍ أو أكثر (الإغلاق الكانس يعلّم عدّة مرضى دفعةً واحدة) */
export function openNoShowWhatsApp(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (list.length) listeners.forEach((fn) => fn(list))
}

/** يُركَّب مرّةً واحدة في التطبيق */
export function NoShowWhatsAppHost() {
  const { clinicRole } = useRole()
  const [ids, setIds] = useState(null)
  useEffect(() => {
    const fn = (list) => setIds(list)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  // الرسالة للاستقبال والمشرفة وحدهما (الخادم يحرس أيضاً)
  if (!ids || !canOperateQueue(clinicRole)) return null
  return <NoShowWhatsAppDialog key={ids.join(',')} ids={ids} onClose={() => setIds(null)} />
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" />
    </svg>
  )
}

// صفٌّ لمريضٍ واحد: الاسم، والسبب إن تعذّر، وزرّ واتساب
function MessageRow({ m, opened, onOpened, showText }) {
  if (m.error) return <div className="nsw-row"><b>{m.full_name || `الحجز ${m.appointment_id}`}</b><p className="error">{m.error}</p></div>
  return (
    <div className="nsw-row">
      <div className="nsw-who">
        <b>{m.full_name}</b>
        {m.mobile ? <bdi dir="ltr" className="nsw-mobile">{m.mobile}</bdi> : null}
      </div>
      {showText && m.available && <pre className="nsw-text" dir="rtl">{m.text}</pre>}
      {m.available ? (
        <a className={`nsw-btn${opened ? ' is-opened' : ''}`} href={m.url} target="_blank" rel="noopener noreferrer"
          onClick={() => onOpened(m.appointment_id)}>
          <WhatsAppIcon /> {opened ? 'فُتحت — افتحها مرّة أخرى' : 'فتح واتساب بالرسالة'}
        </a>
      ) : (
        <p className="nsw-unavailable">{m.reason} — لا يمكن إرسال رسالة.</p>
      )}
    </div>
  )
}

export default function NoShowWhatsAppDialog({ ids, onClose }) {
  const [messages, setMessages] = useState(null)
  const [opened, setOpened] = useState(() => new Set())

  useEffect(() => {
    let live = true
    Promise.all(ids.map((id) => api.clinic.noShowMessage(id)
      .catch((ex) => ({ appointment_id: id, error: ex.message }))))
      .then((list) => { if (live) setMessages(list) })
    return () => { live = false }
  }, [ids])

  const onOpened = (id) => {
    setOpened((s) => new Set(s).add(id))
    // الأثر في الخط الزمني — لا يعطّل شيئاً إن فشل
    api.clinic.noShowMessageOpened(id).catch(() => {})
  }

  const single = ids.length === 1
  const sendable = (messages || []).filter((m) => m.available).length
  return (
    <Modal sheet title={single ? 'رسالة واتساب لمن لم يحضر' : `رسائل واتساب لمن لم يحضر (${ids.length})`} onClose={onClose}
      subtitle={single
        ? 'يفتح واتساب العيادة على رقم المريض والرسالة مكتوبة — راجعها واضغط «إرسال» هناك.'
        : 'لكلّ مريض زرّه: يفتح واتساب العيادة على رقمه والرسالة مكتوبة — راجعها واضغط «إرسال» هناك.'}>
      <div className="nsw-body">
        {!messages && <p className="empty">جارٍ تحضير الرسالة…</p>}
        {messages && messages.map((m) => (
          <MessageRow key={m.appointment_id} m={m} showText={single}
            opened={opened.has(m.appointment_id)} onOpened={onOpened} />
        ))}
        {messages && !single && sendable > 0 && (
          <details className="nsw-preview">
            <summary>نصّ الرسالة</summary>
            <pre className="nsw-text" dir="rtl">{messages.find((m) => m.available)?.text}</pre>
          </details>
        )}
        <div className="nsw-actions">
          <button type="button" className="ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </Modal>
  )
}

// ═══ «غاب سابقاً» — شارةٌ بجانب الاسم في الطابور ═══
// للعلم وحده: كم حجزاً آخر لهذا المريض انتهى بـ«لم يحضر» (الحالي مستثنى).
export function NoShowHistoryBadge({ count }) {
  const n = Number(count) || 0
  if (n <= 0) return null
  return (
    <span className="badge bad sm nsw-badge" title={`لم يحضر في ${n === 1 ? 'حجزٍ سابق' : n === 2 ? 'حجزين سابقين'
      : n <= 10 ? `${n} حجوزات سابقة` : `${n} حجزاً سابقاً`}`}>
      غاب {n === 1 ? 'مرّة' : n === 2 ? 'مرّتين' : n <= 10 ? `${n} مرّات` : `${n} مرّة`}
    </span>
  )
}
