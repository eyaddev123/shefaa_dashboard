import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, SESSION_STATUSES, fmtTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function sessionBadge(status) {
  const cls = status === 'in_progress' ? 'good' : status === 'cancelled' ? 'bad' : status === 'closed' ? '' : 'warn'
  return <span className={`badge ${cls}`}>{SESSION_STATUSES[status] || status}</span>
}

export default function ClinicBoard() {
  const [date, setDate] = useState(todayLocal())
  const [sessions, setSessions] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const { role } = useRole()
  const navigate = useNavigate()

  const load = () => api.clinic.sessions(date).then(setSessions).catch((e) => setErr(e.message))
  useEffect(() => { setSessions(null); load() }, [date])

  const generate = async () => {
    setBusy(true); setErr(null)
    try { await api.clinic.generateSessions(date); await load() }
    catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2>لوحة العيادات اليومية</h2>
          <p className="subtitle">جلسات الدكاترة لليوم المحدد وطول طابور كل منها</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {role === 'clinic_admin' && (
            <button onClick={generate} disabled={busy}>{busy ? 'جارٍ التوليد…' : 'توليد جلسات هذا اليوم'}</button>
          )}
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      <div className="card">
        {!sessions ? (
          <p className="empty">جارٍ التحميل…</p>
        ) : sessions.length === 0 ? (
          <p className="empty">
            لا جلسات في هذا اليوم.
            {role === 'clinic_admin' && ' اضغط «توليد جلسات هذا اليوم» إن وُجد دوام مطابق في جداول الدكاترة.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>الدكتور</th><th>الاختصاص</th><th>الوقت</th><th>الحالة</th><th>الطابور</th><th></th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => navigate(`/clinic/session/${s.id}`)}>
                  <td>{s.doctor_name}</td>
                  <td>{s.specialty || '—'}</td>
                  <td className="num">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</td>
                  <td>{sessionBadge(s.status)}</td>
                  <td className="num">{s.active_count} نشِط / {s.total_count} إجمالي</td>
                  <td><button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}>فتح الطابور</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
