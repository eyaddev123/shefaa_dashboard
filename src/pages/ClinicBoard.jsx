import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, api, dayLabel, SESSION_STATUSES, fmtTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function sessionBadge(status) {
  const cls = status === 'in_progress' ? 'good' : status === 'cancelled' ? 'bad' : status === 'closed' ? '' : 'warn'
  return <span className={`badge ${cls}`}>{SESSION_STATUSES[status] || status}</span>
}

export default function ClinicBoard() {
  const today = todayLocal()
  const [date, setDate] = useState(today)
  // أول يوم في الشريط المعروض — يتحرك أسبوعاً كاملاً بأزرار ‹ ›
  const [weekStart, setWeekStart] = useState(today)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
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
      <div className="page-head">
        <div>
          <h2>لوحة العيادات</h2>
          <p className="subtitle">جلسات الدكاترة لليوم المحدد وطول طابور كل منها — تنقّل بالأيام للحجز المسبق</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {role === 'clinic_admin' && (
            <button onClick={generate} disabled={busy}>{busy ? 'جارٍ التوليد…' : 'توليد جلسات هذا اليوم'}</button>
          )}
        </div>
      </div>

      {/* شريط الأيام: الماضي للاطّلاع، القادم للحجز المسبق */}
      <div className="day-strip">
        <button className="day-nav" onClick={() => setWeekStart(addDays(weekStart, -7))} title="الأسبوع السابق">‹</button>
        <div className="day-strip-days">
          {days.map((d) => {
            const { weekday, day, month } = dayLabel(d)
            return (
              <button
                key={d}
                className={`day-chip ${d === date ? 'day-chip-on' : ''} ${d === today ? 'day-chip-today' : ''} ${d < today ? 'day-chip-past' : ''}`}
                onClick={() => setDate(d)}
              >
                <span className="day-chip-wd">{weekday}</span>
                <span className="day-chip-num">{day}/{month}</span>
                {d === today && <span className="day-chip-tag">اليوم</span>}
              </button>
            )
          })}
        </div>
        <button className="day-nav" onClick={() => setWeekStart(addDays(weekStart, 7))} title="الأسبوع التالي">›</button>
        {date !== today && (
          <button className="ghost day-back" onClick={() => { setDate(today); setWeekStart(today) }}>ارجع لليوم</button>
        )}
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
