import { useEffect, useState } from 'react'
import { api, fmtTime, todayLocal } from '../api.js'

export default function DoctorScreen() {
  const [sessions, setSessions] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [queue, setQueue] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadSessions = () => api.clinic.mySessions(todayLocal()).then((rows) => {
    setSessions(rows)
    if (!sessionId && rows.length) setSessionId(rows[0].id)
  }).catch((e) => setErr(e.message))

  useEffect(() => { loadSessions() }, [])

  const loadQueue = () => {
    if (!sessionId) return
    api.clinic.queue(sessionId).then(setQueue).catch((e) => setErr(e.message))
  }
  useEffect(() => { loadQueue() }, [sessionId])

  const act = async (fn, apptId) => {
    setBusy(true); setErr(null)
    try { await fn(apptId); loadQueue() }
    catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  if (err) return <p className="error">{err}</p>
  if (!sessions) return <p className="empty">جارٍ التحميل…</p>
  if (sessions.length === 0) return <p className="empty">لا جلسات لك اليوم.</p>

  const current = queue?.appointments.find((a) => a.status === 'in_service')
  const arrivedWaiting = queue?.appointments.filter((a) => a.status === 'arrived') || []
  const stillWaiting = queue?.appointments.filter((a) => a.status === 'waiting') || []
  const nextUp = arrivedWaiting[0]

  return (
    <>
      <h2>شاشة الدكتور</h2>
      <p className="subtitle">جلستك الحالية، مَن يُخدَم الآن، ومَن ينتظر دوره</p>

      {sessions.length > 1 && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 16 }}>
          <label>الجلسة</label>
          <select value={sessionId || ''} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</option>
            ))}
          </select>
        </div>
      )}

      {!queue ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <div className="card highlight">
            <h3>قيد الكشف الآن</h3>
            {current ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--primary)' }}>الدور {current.queue_number}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>{current.full_name}</div>
                  {current.reason && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>سبب الزيارة: {current.reason}</div>}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {/* المريض لم يسمع النداء أو لم يصل بعد — يُعاد بثّه على شاشة الصالة بلا تغيير حالته */}
                  <button className="ghost" disabled={busy} onClick={() => act(api.clinic.recall, current.id)} style={{ padding: '14px 20px', fontSize: 15 }}>
                    🔊 إعادة النداء
                  </button>
                  <button disabled={busy} onClick={() => act(api.clinic.done, current.id)} style={{ padding: '14px 28px', fontSize: 15 }}>
                    إنهاء الكشف
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty">لا أحد قيد الكشف حالياً.</p>
            )}
          </div>

          <div className="card">
            <h3>التالي في الطابور</h3>
            {nextUp ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>الدور {nextUp.queue_number} — {nextUp.full_name}</div>
                  {nextUp.reason && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{nextUp.reason}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy || !!current} onClick={() => act(api.clinic.call, nextUp.id)} style={{ padding: '10px 22px' }}>
                    نادِ التالي
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => act(api.clinic.noShow, nextUp.id)} style={{ padding: '10px 16px' }}>
                    لم يحضر
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty">لا أحد حاضر بانتظار الدور بعد.</p>
            )}
            {current && nextUp && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>أنهِ الكشف الحالي أولاً قبل استدعاء التالي.</p>
            )}
          </div>

          {/* الطابور كامل: مَن وصل ومَن لم يصل في مكان واحد، بالترتيب */}
          <div className="card">
            <h3>
              الطابور كامل ({arrivedWaiting.length + stillWaiting.length})
              <span className="doc-queue-legend">
                <span className="doc-dot doc-dot-here" /> وصل ({arrivedWaiting.length})
                <span className="doc-dot doc-dot-away" /> لم يصل ({stillWaiting.length})
              </span>
            </h3>
            {arrivedWaiting.length + stillWaiting.length === 0 ? (
              <p className="empty">لا أحد بانتظار الدور — الجميع انتهى أو لم يُحجز بعد.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>الدور</th><th>الاسم</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {/* الحاضرون أولاً — هم مَن يُنادى منهم فعلياً */}
                  {arrivedWaiting.map((a) => (
                    <tr key={a.id} className={a.id === nextUp?.id ? 'doc-row-next' : undefined}>
                      <td className="num">{a.queue_number}</td>
                      <td>{a.full_name}</td>
                      <td>
                        <span className="badge good">وصل</span>
                        {a.id === nextUp?.id && <span className="doc-next-tag">التالي</span>}
                      </td>
                    </tr>
                  ))}
                  {stillWaiting.map((a) => (
                    <tr key={a.id} className="doc-row-away">
                      <td className="num">{a.queue_number}</td>
                      <td>{a.full_name}</td>
                      <td><span className="badge">لم يصل بعد</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  )
}
