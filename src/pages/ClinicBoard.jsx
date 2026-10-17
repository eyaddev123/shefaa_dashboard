import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, api, dayLabel, SESSION_STATUSES, fmtTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { FlowModeTag } from '../attendance-ui.jsx'

// من يرى قسم «دكاترة اليوم» والاعتذارات — يطابق APOLOGY_VIEWERS في الخادم.
// الاستقبال غائبٌ عمداً: المعتذر لا وجود له عنده ذلك اليوم.
const APOLOGY_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']

function sessionBadge(status) {
  const cls = status === 'in_progress' ? 'good' : status === 'cancelled' ? 'bad' : status === 'closed' ? '' : 'warn'
  return <span className={`badge ${cls}`}>{SESSION_STATUSES[status] || status}</span>
}

// ═══ دكاترة اليوم — لمشرف العيادات (والمدير/المجلس اطّلاعاً) ═══
//
// تُبنى من **القوالب** لا من الجلسات: الدكتور يعتذر فجراً قبل التوليد، فلو بُنيت
// على الجلسات لما ظهر من لم تُولَّد جلسته — وهو بالضبط من نحتاج تعليمه.
//
// والاستقبال لا يراها إطلاقاً: المعتذر ببساطة غير موجود ذلك اليوم، لا سطرَ
// معلومةٍ ولا سبب. القرار قرار المشرف.
function DayDoctors({ date, canEdit, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () => api.clinic.dayDoctors(date).then(setData).catch((e) => setErr(e.message))
  useEffect(() => { setData(null); setErr(null); load() }, [date])

  const apologize = async (d) => {
    const reason = prompt(`سبب اعتذار ${d.doctor_name} (اختياري):`)
    if (reason === null) return            // أُلغي
    setBusy(d.doctor_id); setErr(null)
    try {
      await api.clinic.apologize({ doctor_id: d.doctor_id, date, reason: reason || null })
    } catch (ex) {
      // حجوزات قائمة: نعرض المرضى وهواتفهم ثم نطلب تأكيداً صريحاً.
      // ولا يُلغى ولا يُنقل شيءٌ تلقائياً — من يتّصل بالمرضى بشرٌ يقرّر.
      if (ex.data?.code === 'HAS_BOOKINGS') {
        const list = ex.data.bookings
          .map((b) => `• ${b.full_name}${b.mobile ? ` — ${b.mobile}` : ''}`).join('\n')
        if (!confirm(`${ex.message}\n\n${list}\n\nتأكيد تعليم «معتذر»؟`)) { setBusy(null); return }
        try {
          await api.clinic.apologize({ doctor_id: d.doctor_id, date, reason: reason || null, confirm: true })
        } catch (e2) { setErr(e2.message); setBusy(null); return }
      } else { setErr(ex.message); setBusy(null); return }
    }
    setBusy(null); await load(); onChanged()
  }

  const undo = async (d) => {
    setBusy(d.doctor_id); setErr(null)
    try { await api.clinic.undoApology(d.doctor_id, date) }
    catch (ex) { setErr(ex.message) }
    setBusy(null); await load(); onChanged()
  }

  // تبديلٌ استثنائي: جلسةٌ يدوية لدكتورٍ خارج دوره، بأوقات قالبه إن وُجدت
  const makeSession = async (d) => {
    setBusy(d.doctor_id); setErr(null)
    try {
      const r = await api.clinic.addSession({
        doctor_id: d.doctor_id, session_date: date,
        start_time: d.start_time || '09:00', end_time: d.end_time || '13:00',
      })
      // الاعتذار **يبقى** مانعاً — لا يُلغى ضمناً بإنشاء الجلسة
      if (r.warning_code === 'DOCTOR_APOLOGIZED'
          && confirm(`${r.warning}\n\nإلغاء الاعتذار الآن؟`)) {
        await api.clinic.undoApology(d.doctor_id, date)
      }
    } catch (ex) { setErr(ex.message) }
    setBusy(null); await load(); onChanged()
  }

  if (err && !data) return <p className="error">{err}</p>
  if (!data) return null
  if (data.doctors.length === 0) return null

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>دكاترة اليوم ({data.doctors.length})</h3>
      <p className="subtitle" style={{ marginTop: -4 }}>
        المتوقَّعون حسب جداول الدوام — حتى لو لم تُولَّد جلساتهم بعد.
      </p>
      {err && <p className="error">{err}</p>}
      <table>
        <thead>
          <tr><th>الدكتور</th><th>الاختصاص</th><th>الوقت</th><th>الغرفة</th><th>الحالة</th><th></th></tr>
        </thead>
        <tbody>
          {data.doctors.map((d) => (
            <tr key={d.doctor_id} className={d.off_week || d.apologized ? 'row-faded' : ''}>
              <td>{d.doctor_name}</td>
              <td>{d.specialty || '—'}</td>
              <td className="num">
                {d.start_time ? `${d.start_time} – ${d.end_time}` : <span className="muted">جلسة يدوية</span>}
              </td>
              <td className="num">{d.room || '—'}</td>
              <td>
                {d.apologized
                  ? <span className="badge bad" title={d.apology_reason || ''}>معتذر</span>
                  : d.off_week
                    ? <span className="badge" title="قالبه كل أسبوعين وهذا أسبوع عطلته">خارج دوره</span>
                    : d.session_id
                      ? <span className="badge good">جلسته جاهزة</span>
                      : <span className="badge warn">لم تُولَّد بعد</span>}
                {d.apologized && d.apology_reason && (
                  <span className="muted" style={{ marginInlineStart: 6 }}>{d.apology_reason}</span>
                )}
              </td>
              <td>
                {canEdit && (d.apologized ? (
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    disabled={busy === d.doctor_id} onClick={() => undo(d)}>تراجع</button>
                ) : (
                  <>
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      disabled={busy === d.doctor_id} onClick={() => apologize(d)}>معتذر</button>
                    {d.off_week && !d.session_id && (
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5, marginInlineStart: 6 }}
                        disabled={busy === d.doctor_id} onClick={() => makeSession(d)}>إنشاء جلسة</button>
                    )}
                  </>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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

      {/* الاستقبال لا يرى هذا القسم إطلاقاً — ولا الخادم يُجيبه عليه */}
      {APOLOGY_VIEWERS.includes(role) && (
        <DayDoctors date={date} canEdit={role === 'clinic_admin'} onChanged={load} />
      )}

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
              <tr><th>الدكتور</th><th>الاختصاص</th><th>الوقت</th><th>النمط</th><th>الحالة</th><th>الطابور</th><th></th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => navigate(`/clinic/session/${s.id}`)}>
                  <td>{s.doctor_name}</td>
                  <td>{s.specialty || '—'}</td>
                  <td className="num">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</td>
                  {/* نمط الجلسة يُثبَّت عند توليدها — يُعرض كي لا يُفاجأ أحد يوم التبديل */}
                  <td><FlowModeTag mode={s.flow_mode} /></td>
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
