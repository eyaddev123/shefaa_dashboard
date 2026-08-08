import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, WEEKDAYS, fmtMoney, fmtTime } from '../api.js'

// بروفايل الدكتور: تعديل معلوماته وتسعيرتيه (معاينة/مراجعة) ومدة الكشف المتوقعة،
// وهي التي يُقسَّم على أساسها دوامه إلى خانات زمنية.
function ProfileForm({ doctor, globalBuffer, onSaved }) {
  const [form, setForm] = useState({
    hourly_buffer_minutes: doctor.hourly_buffer_minutes ?? '',
    name: doctor.name,
    specialty: doctor.specialty || '',
    phone: doctor.phone || '',
    room: doctor.room || '',
    consultation_fee: doctor.consultation_fee,
    followup_fee: doctor.followup_fee,
    followup_window_days: doctor.followup_window_days,
    expected_visit_minutes: doctor.expected_visit_minutes,
    notes: doctor.notes || '',
  })
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false) }

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      await api.clinic.updateDoctor(doctor.id, {
        ...form,
        consultation_fee: Number(form.consultation_fee) || 0,
        followup_fee: Number(form.followup_fee) || 0,
        followup_window_days: Number(form.followup_window_days) || 7,
        expected_visit_minutes: Number(form.expected_visit_minutes) || 15,
        // فارغ = احذف التخصيص وعُد للإعداد العام (يُرسل null صريحاً)
        hourly_buffer_minutes: form.hourly_buffer_minutes === ''
          ? null : Number(form.hourly_buffer_minutes),
      })
      setSaved(true); onSaved()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  // الفراغ الفعلي = المطلوب مقرَّباً لأعلى لمضاعف مدة الكشف (نفس معادلة السيرفر)
  const visitMinutes = Number(form.expected_visit_minutes) || 0
  const wantBuffer = form.hourly_buffer_minutes === ''
    ? Number(globalBuffer) || 0 : Number(form.hourly_buffer_minutes) || 0
  const effectiveBuffer = wantBuffer > 0 && visitMinutes > 0
    ? Math.ceil(wantBuffer / visitMinutes) * visitMinutes : 0

  return (
    <form onSubmit={submit}>
      <div className="inline" style={{ flexWrap: 'wrap' }}>
        <div className="field"><label>اسم الدكتور</label><input value={form.name} onChange={set('name')} required /></div>
        <div className="field"><label>الاختصاص</label><input value={form.specialty} onChange={set('specialty')} /></div>
        <div className="field"><label>الجوال</label><input value={form.phone} onChange={set('phone')} dir="ltr" /></div>
        {/* يظهر ويُنطَق على شاشة الصالة ضمن النداء */}
        <div className="field"><label>الغرفة</label><input value={form.room} onChange={set('room')} placeholder="مثال: 3" /></div>
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 0 }}>التسعيرة</h4>
      <p className="subtitle" style={{ marginTop: 4 }}>
        سعران مستقلان: المعاينة (الزيارة الأولى) والمراجعة (خلال المدة المسموحة بعدها).
        السعر يُنسخ نسخة ثابتة على كل حجز، فتعديله هنا لا يؤثر على الحجوزات السابقة.
      </p>
      <div className="inline" style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label>سعر المعاينة (ل.س)</label>
          <input type="number" min="0" value={form.consultation_fee} onChange={set('consultation_fee')} required />
        </div>
        <div className="field">
          <label>سعر المراجعة (ل.س)</label>
          <input type="number" min="0" value={form.followup_fee} onChange={set('followup_fee')} required />
        </div>
        <div className="field">
          <label>مدة صلاحية المراجعة (يوم)</label>
          <input type="number" min="1" value={form.followup_window_days} onChange={set('followup_window_days')} required />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            بعد هذه المدة تلزم معاينة جديدة
          </span>
        </div>
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 0 }}>مدة الكشف</h4>
      <p className="subtitle" style={{ marginTop: 4 }}>
        على أساسها يُقسَّم دوام الدكتور إلى خانات زمنية متساوية ابتداءً من بداية الدوام،
        وعليها يُحسب الانتظار المتوقع لكل مريض.
      </p>
      <div className="inline">
        <div className="field">
          <label>مدة الكشف المتوقعة (دقيقة)</label>
          <input type="number" min="1" value={form.expected_visit_minutes} onChange={set('expected_visit_minutes')} required />
        </div>
        <div className="field">
          <label>فراغ آخر الساعة (دقيقة)</label>
          <input type="number" min="0" step={form.expected_visit_minutes || 1}
            value={form.hourly_buffer_minutes} onChange={set('hourly_buffer_minutes')}
            placeholder={`عام: ${globalBuffer ?? '—'}`} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            اتركه فارغاً لاتّباع الإعداد العام. يُقرَّب لأقرب مضاعف لمدة الكشف.
          </span>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label>ملاحظات</label>
          <input value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      {/* الفراغ الفعلي بعد التقريب — يوضّح للمستخدم أن 10 د مع كشف 15 د تصير 15 د */}
      {effectiveBuffer > 0 && (
        <p className="subtitle" style={{ marginTop: 6 }}>
          الفراغ المطبَّق فعلياً: <strong>{effectiveBuffer} دقيقة</strong> آخر كل ساعة
          {effectiveBuffer !== Number(form.hourly_buffer_minutes || globalBuffer) &&
            ' (مقرَّب لمضاعف مدة الكشف حتى لا تضيع دقائق لا تكفي مريضاً)'}
        </p>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button>
        {saved && <span className="badge good">تم الحفظ</span>}
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// معاينة الخانات الزمنية الناتجة عن (الدوام + مدة الكشف + الاستراحة) — تُحسب هنا كما يحسبها السيرفر
function SlotPreview({ schedule, minutes }) {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const toStr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const slots = []
  const bs = schedule.break_start ? toMin(schedule.break_start) : null
  const be = schedule.break_end ? toMin(schedule.break_end) : null
  for (let t = toMin(schedule.start_time); t + minutes <= toMin(schedule.end_time); t += minutes) {
    if (bs != null && t >= bs && t < be) continue
    slots.push(toStr(t))
  }
  return (
    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
      {slots.length} خانة ({minutes} د لكل خانة)
      {slots.length > 0 && <> · تبدأ {slots[0]} وتنتهي {slots[slots.length - 1]}</>}
    </span>
  )
}

export default function DoctorProfile() {
  const { id } = useParams()
  const [doctor, setDoctor] = useState(null)
  const [globalBuffer, setGlobalBuffer] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => api.clinic.doctor(id).then(setDoctor).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id])
  // الإعداد العام للفراغ — يُعرض كقيمة افتراضية عند ترك حقل الدكتور فارغاً
  useEffect(() => {
    api.settings()
      .then((rows) => setGlobalBuffer(rows.find((s) => s.key === 'clinic_hourly_buffer_minutes')?.value))
      .catch(() => {})
  }, [])

  if (err) return <p className="error">{err}</p>
  if (!doctor) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <p className="subtitle"><Link to="/clinic/doctors">← كل الدكاترة</Link></p>
      <h2>{doctor.name}</h2>
      <p className="subtitle">
        {doctor.specialty || 'بلا اختصاص محدد'} ·
        معاينة {fmtMoney(doctor.consultation_fee)} · مراجعة {fmtMoney(doctor.followup_fee)} ·
        كشف {doctor.expected_visit_minutes} د ·{' '}
        {doctor.is_active ? <span className="badge good">فعّال</span> : <span className="badge">موقوف</span>}
      </p>

      <div className="card">
        <h3>معلومات الدكتور والتسعيرة</h3>
        <ProfileForm doctor={doctor} globalBuffer={globalBuffer} onSaved={load} />
      </div>

      <div className="card">
        <h3>جدول الدوام الأسبوعي</h3>
        <p className="subtitle" style={{ marginTop: -6 }}>
          الخانات تُحسب تلقائياً من مدة الكشف ({doctor.expected_visit_minutes} دقيقة) — تعديل المدة أعلاه يعيد تقسيم كل الخانات.
        </p>
        {doctor.schedules.length === 0
          ? <p className="empty">لا يوجد جدول دوام بعد — أضفه من صفحة الدكاترة.</p>
          : (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>اليوم</th><th>من</th><th>إلى</th><th>الاستراحة</th><th>الخانات الناتجة</th></tr></thead>
              <tbody>
                {doctor.schedules.map((s) => (
                  <tr key={s.id}>
                    <td>{WEEKDAYS[s.weekday]}</td>
                    <td>{fmtTime(s.start_time)}</td>
                    <td>{fmtTime(s.end_time)}</td>
                    <td>{s.break_start ? `${fmtTime(s.break_start)} – ${fmtTime(s.break_end)}` : '—'}</td>
                    <td><SlotPreview schedule={s} minutes={doctor.expected_visit_minutes} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  )
}
