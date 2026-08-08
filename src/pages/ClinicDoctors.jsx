import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, WEEKDAYS, fmtMoney, fmtTime } from '../api.js'

function NewDoctorForm({ onCreated }) {
  const blank = { name: '', specialty: '', phone: '', consultation_fee: '', followup_fee: '',
                  followup_window_days: '7', expected_visit_minutes: '15', room: '' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.clinic.addDoctor({
        ...form,
        consultation_fee: Number(form.consultation_fee) || 0,
        followup_fee: Number(form.followup_fee) || 0,
        followup_window_days: Number(form.followup_window_days) || 7,
        expected_visit_minutes: Number(form.expected_visit_minutes) || 15,
      })
      setForm(blank); onCreated()
    } catch (ex) { setErr(ex.message) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field"><label>اسم الدكتور</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="field"><label>الاختصاص</label><input value={form.specialty} onChange={set('specialty')} /></div>
      <div className="field"><label>الجوال</label><input value={form.phone} onChange={set('phone')} /></div>
      <div className="field"><label>الغرفة</label><input value={form.room} onChange={set('room')} placeholder="مثال: 3" /></div>
      <div className="field"><label>سعر المعاينة (ل.س)</label><input type="number" min="0" value={form.consultation_fee} onChange={set('consultation_fee')} required /></div>
      <div className="field"><label>سعر المراجعة (ل.س)</label><input type="number" min="0" value={form.followup_fee} onChange={set('followup_fee')} required /></div>
      <div className="field"><label>صلاحية المراجعة (يوم)</label><input type="number" min="1" value={form.followup_window_days} onChange={set('followup_window_days')} required /></div>
      <div className="field"><label>مدة الكشف المتوقعة (دقيقة)</label><input type="number" min="1" value={form.expected_visit_minutes} onChange={set('expected_visit_minutes')} required /></div>
      <button type="submit">إضافة دكتور</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function NewScheduleForm({ doctorId, onCreated }) {
  const blank = { weekday: '3', start_time: '16:00', end_time: '19:00', capacity: '' }
  const [form, setForm] = useState(blank)
  const [hasBreak, setHasBreak] = useState(false)
  const [breakTimes, setBreakTimes] = useState({ break_start: '17:00', break_end: '17:30' })
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setBreak = (k) => (e) => setBreakTimes((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.clinic.addSchedule(doctorId, {
        ...form,
        weekday: Number(form.weekday),
        capacity: form.capacity ? Number(form.capacity) : null,
        break_start: hasBreak ? breakTimes.break_start : null,
        break_end: hasBreak ? breakTimes.break_end : null,
      })
      setForm(blank); setHasBreak(false); onCreated()
    } catch (ex) { setErr(ex.message) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 10, flexWrap: 'wrap' }}>
      <div className="field">
        <label>اليوم</label>
        <select value={form.weekday} onChange={set('weekday')}>
          {Object.entries(WEEKDAYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>من</label><input type="time" value={form.start_time} onChange={set('start_time')} required /></div>
      <div className="field"><label>إلى</label><input type="time" value={form.end_time} onChange={set('end_time')} required /></div>
      <div className="field"><label>السعة (اختياري)</label><input type="number" min="1" value={form.capacity} onChange={set('capacity')} /></div>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
          <input type="checkbox" checked={hasBreak} onChange={(e) => setHasBreak(e.target.checked)} style={{ width: 'auto' }} />
          استراحة ضمن الدوام
        </label>
      </div>
      {hasBreak && (
        <>
          <div className="field"><label>من (استراحة)</label><input type="time" value={breakTimes.break_start} onChange={setBreak('break_start')} required /></div>
          <div className="field"><label>إلى (استراحة)</label><input type="time" value={breakTimes.break_end} onChange={setBreak('break_end')} required /></div>
        </>
      )}
      <button type="submit" style={{ padding: '6px 14px', fontSize: 12.5 }}>إضافة موعد دوام</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function DoctorRow({ doctor, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [schedules, setSchedules] = useState(null)

  const loadSchedules = () => api.clinic.schedules(doctor.id).then(setSchedules)
  const toggle = () => {
    setExpanded((v) => !v)
    if (!schedules) loadSchedules()
  }

  const toggleActive = async () => {
    try { await api.clinic.updateDoctor(doctor.id, { is_active: !doctor.is_active }); onChanged() }
    catch (ex) { alert(ex.message) }
  }

  const removeSchedule = async (id) => {
    if (!confirm('حذف موعد الدوام هذا؟')) return
    try { await api.clinic.deleteSchedule(id); loadSchedules() }
    catch (ex) { alert(ex.message) }
  }

  return (
    <>
      <tr style={doctor.is_active ? undefined : { opacity: 0.5 }}>
        <td><Link to={`/clinic/doctors/${doctor.id}`}>{doctor.name}</Link></td>
        <td>{doctor.specialty || '—'}</td>
        <td>{doctor.phone || '—'}</td>
        <td className="num">{fmtMoney(doctor.consultation_fee)}</td>
        <td className="num">{fmtMoney(doctor.followup_fee)}</td>
        <td className="num">{doctor.expected_visit_minutes} د</td>
        <td>
          {doctor.is_active ? <span className="badge good">فعّال</span> : <span className="badge">موقوف</span>}
        </td>
        <td>
          <Link to={`/clinic/doctors/${doctor.id}`} className="ghost"
            style={{ padding: '3px 10px', fontSize: 11.5, display: 'inline-block' }}>البروفايل</Link>{' '}
          <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={toggle}>
            {expanded ? 'إخفاء الدوام' : 'جدول الدوام'}
          </button>{' '}
          <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={toggleActive}>
            {doctor.is_active ? 'إيقاف' : 'تفعيل'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--bg-soft, rgba(0,0,0,0.02))' }}>
            {!schedules ? (
              <p className="empty">جارٍ التحميل…</p>
            ) : (
              <>
                {schedules.length === 0
                  ? <p className="empty">لا يوجد جدول دوام بعد لهذا الدكتور.</p>
                  : (
                    <table style={{ marginTop: 6 }}>
                      <thead><tr><th>اليوم</th><th>من</th><th>إلى</th><th>السعة</th><th></th></tr></thead>
                      <tbody>
                        {schedules.map((s) => (
                          <tr key={s.id}>
                            <td>{WEEKDAYS[s.weekday]}</td>
                            <td>{fmtTime(s.start_time)}</td>
                            <td>{fmtTime(s.end_time)}</td>
                            <td className="num">{s.capacity || '—'}</td>
                            <td>
                              <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => removeSchedule(s.id)}>حذف</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                <NewScheduleForm doctorId={doctor.id} onCreated={loadSchedules} />
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function ClinicDoctors() {
  const [doctors, setDoctors] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => api.clinic.doctors().then(setDoctors).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <p className="error">{err}</p>
  if (!doctors) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <h2>قسم العيادات — الدكاترة والدوام</h2>
      <p className="subtitle">
        إضافة الدكاترة الزائرين وتسعيرة كل منهم ومدة الكشف المتوقعة، وجدول دوامهم الأسبوعي
        الذي تُولَّد منه جلسات كل يوم.
      </p>

      <div className="card">
        <h3>الدكاترة ({doctors.length})</h3>
        <NewDoctorForm onCreated={load} />
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>الاسم</th><th>الاختصاص</th><th>الجوال</th><th>سعر المعاينة</th><th>سعر المراجعة</th><th>مدة الكشف</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {doctors.map((d) => <DoctorRow key={d.id} doctor={d} onChanged={load} />)}
          </tbody>
        </table>
      </div>
    </>
  )
}
