import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtDateTime } from '../api.js'

// ═══ الإشعارات داخل النظام ═══
// زرٌّ في بطاقة المستخدم بعدد غير المقروء، ولوحةٌ من داخل النظام بآخر الإشعارات.
// أوّل مصدر: مادةٌ وصلت حدّها الأدنى (يُرسَل مرّةً عند العبور، لا مع كلّ حركة).
// التحديث كلّ دقيقة وعند الرجوع للنافذة — لا بثّ حيّ: الإشعار ليس نداء مريض.
const POLL_MS = 60000

export default function NotificationsBell() {
  const [data, setData] = useState({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(() => api.notifications.list().then(setData).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [load])
  useEffect(() => {
    if (!open) return undefined
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])

  const follow = async (n) => {
    setOpen(false)
    if (!n.read_at) await api.notifications.read(n.id).catch(() => {})
    load()
    if (n.link) navigate(n.link)
  }
  const readAll = async () => { await api.notifications.readAll().catch(() => {}); load() }

  return (
    <>
      <button type="button" className="notif-btn" onClick={() => { setOpen(true); load() }}
        aria-label={`الإشعارات${data.unread ? ` — ${data.unread} غير مقروء` : ''}`}>
        الإشعارات
        {data.unread > 0 && <span className="notif-count">{data.unread.toLocaleString('ar-SY')}</span>}
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal-card notif-panel" role="dialog" aria-modal="true" aria-labelledby="notif-title">
            <div className="notif-head">
              <h3 id="notif-title">الإشعارات</h3>
              {data.unread > 0 && <button type="button" className="link-btn" onClick={readAll}>تعليم الكل مقروءاً</button>}
            </div>
            {data.items.length === 0 ? <p className="empty">لا إشعارات.</p> : (
              <ul className="notif-list">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`notif-item${n.read_at ? '' : ' is-unread'}`} onClick={() => follow(n)}>
                      <span className="notif-title">{n.title}</span>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="notif-time">{fmtDateTime(n.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="bf-actions inv-actions">
              <button type="button" className="ghost" onClick={() => setOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
