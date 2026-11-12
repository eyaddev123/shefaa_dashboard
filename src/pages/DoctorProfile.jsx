import { useEffect, useState } from 'react'
import { SpecialtyPicker } from '../SpecialtyPicker.jsx'
import { useParams, Link } from 'react-router-dom'
import { api, WEEKDAYS, fmtMoney, fmtTime, fmtDateTime } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import DoctorShareRules from '../components/DoctorShareRules.jsx'
import DoctorPayCard from '../components/DoctorPayCard.jsx'
import { canSeeClinicFunds, canWriteClinicFunds, canSeeDoctorDashboard } from '../permissions.js'
import { useToast } from '../action-feedback.jsx'
import { pricingText } from '../share-rule.js'

// من يرى حصص الإجراءات — يطابق SETTLEMENT_VIEWERS في الخادم، ومشرف العيادات وحده يكتب
const SHARE_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']

// بروفايل الدكتور: تعديل معلوماته وتسعيرتيه (معاينة/مراجعة) ومدة الكشف المتوقعة،
// وهي التي يُقسَّم على أساسها دوامه إلى خانات زمنية.
function ProfileForm({ doctor, globalBuffer, onSaved, readOnly = false }) {
  const [form, setForm] = useState({
    hourly_buffer_minutes: doctor.hourly_buffer_minutes ?? '',
    name: doctor.name,
    specialty_id: doctor.specialty_id ? String(doctor.specialty_id) : '',
    phone: doctor.phone || '',
    room: doctor.room || '',
    consultation_fee: doctor.consultation_fee,
    followup_fee: doctor.followup_fee,
    followup_window_days: doctor.followup_window_days,
    expected_visit_minutes: doctor.expected_visit_minutes,
    notes: doctor.notes || '',
    accepts_urgent: doctor.accepts_urgent !== false,
    appointments_based: doctor.appointments_based === true,
  })
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false) }
  const setBool = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.checked })); setSaved(false) }

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
    <form onSubmit={submit} className="pf-form">
      {/* المطالِع (المجلس، المشرف العام، المدير) يرى الحقول معطَّلة بلا زرّ حفظ */}
      <fieldset className="ro-fieldset" disabled={readOnly}>
        <div className="pf-group">
          <div className="pf-group-head"><h4>البيانات الأساسية</h4></div>
          <div className="pf-grid">
            <div className="field"><label>اسم الدكتور</label><input value={form.name} onChange={set('name')} required /></div>
            <SpecialtyPicker value={form.specialty_id} canAdd={!readOnly}
              onChange={(v) => setForm((f) => ({ ...f, specialty_id: v }))} />
            <div className="field"><label>الجوال</label><input value={form.phone} onChange={set('phone')} dir="ltr" /></div>
            {/* رقم الغرفة يظهر ويُنطَق على شاشة الصالة، ويُشتقّ منه اسم المقطع الصوتي
                (room-3.mp3) — الخادم يطبّع الأرقام العربية والمسافات (AUDIO.md) */}
            <div className="field"><label>الغرفة</label><input value={form.room} onChange={set('room')} placeholder="مثال: 3" />
              <small className="hint">بالأرقام اللاتينية (3 لا ٣) — يُنطق على شاشة النداء</small></div>
          </div>
        </div>

        <div className="pf-group" id="pf-pricing">
          <div className="pf-group-head">
            <h4>التسعيرة</h4>
            <p>المعاينة للزيارة الأولى، والمراجعة خلال المدة المسموحة بعدها. السعر يُنسخ على كل حجز، فتعديله لا يغيّر الحجوزات السابقة.</p>
          </div>
          <div className="pf-grid">
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
              <small className="hint">بعد هذه المدة تلزم معاينة جديدة</small>
            </div>
          </div>
        </div>

        <div className="pf-group">
          <div className="pf-group-head">
            <h4>الكشف والخانات</h4>
            <p>على مدة الكشف يُقسَّم الدوام خاناتٍ متساوية من بدايته، وعليها يُحسب انتظار كل مريض.</p>
          </div>
          <div className="pf-grid">
            <div className="field">
              <label>مدة الكشف المتوقعة (دقيقة)</label>
              <input type="number" min="1" value={form.expected_visit_minutes} onChange={set('expected_visit_minutes')} required />
            </div>
            <div className="field">
              <label>فراغ آخر الساعة (دقيقة)</label>
              <input type="number" min="0" step={form.expected_visit_minutes || 1}
                value={form.hourly_buffer_minutes} onChange={set('hourly_buffer_minutes')}
                placeholder={`عام: ${globalBuffer ?? '—'}`} />
              <small className="hint">فارغ = الإعداد العام. يُقرَّب لأقرب مضاعف لمدة الكشف.</small>
            </div>
          </div>
          {/* الفراغ الفعلي بعد التقريب — يوضّح للمستخدم أن 10 د مع كشف 15 د تصير 15 د */}
          {effectiveBuffer > 0 && (
            <p className="pf-note">
              الفراغ المطبَّق فعلياً: <strong>{effectiveBuffer} دقيقة</strong> آخر كل ساعة
              {effectiveBuffer !== Number(form.hourly_buffer_minutes || globalBuffer) &&
                ' (مقرَّب لمضاعف مدة الكشف حتى لا تضيع دقائق لا تكفي مريضاً)'}
            </p>
          )}
        </div>

        <div className="pf-group">
          <div className="pf-group-head"><h4>خيارات</h4></div>
          <div className="pf-toggles">
            {/* إطفاؤه يُخفي زرّي الحجز الفوري والترقية عند هذا الدكتور، والخادم يرفضهما أيضاً.
                الحجوزات الإسعافية القائمة عنده لا تتأثر — العلم يمنع الجديد فقط. */}
            <label className="pf-toggle">
              <input type="checkbox" checked={form.accepts_urgent} onChange={setBool('accepts_urgent')} />
              <span><strong>يقبل الحالات الإسعافية</strong>
                <small>أطفئه للاختصاصات التي لا تأتيها حالات إسعافية (تخاطب، علاج فيزيائي)</small></span>
            </label>
            {/* مسؤول العيادات وحده يكتبه (الخادم 403 لغيره). بأثرٍ رجعي: التأخير يُحسب لحظة العرض لا يُخزَّن،
                فالتقارير القديمة تتبع القيمة الحالية. «وصل الطبيب» والحضور واليومية لا تتأثّر. */}
            <label className="pf-toggle">
              <input type="checkbox" checked={form.appointments_based} onChange={setBool('appointments_based')} />
              <span><strong>بمواعيد خاصة</strong>
                <small>يعطي مرضاه مواعيد بنفسه: لا يُحسب عليه تأخير ولا نسبة التزام — حتى في التقارير السابقة.
                  يوم حضوره يُحسب كالمعتاد بـ«وصل الطبيب».</small></span>
            </label>
          </div>
          <div className="field pf-notes">
            <label>ملاحظات</label>
            <input value={form.notes} onChange={set('notes')} />
          </div>
        </div>
      </fieldset>
      {!readOnly && <div className="pf-savebar">
        {err ? <p className="error">{err}</p> : saved ? <span className="badge good">تم الحفظ</span> : <span className="muted">التعديلات لا تُحفظ إلا بالزرّ</span>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button>
      </div>}
      {readOnly && err && <p className="error">{err}</p>}
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
    <span className="pf-slots" title={slots.length ? `تبدأ ${slots[0]} وتنتهي ${slots[slots.length - 1]}` : undefined}>
      {slots.length} خانة × {minutes} د
    </span>
  )
}

// ═══ سجلّ التعديلات: الغرفة، وتفعيل/إيقاف سطور الدوام وتعديلها — من ومتى ═══
// يُعاد تحميله مع البروفايل (reloadKey)، فتغيير الغرفة من النموذج أعلاه يظهر فوراً.
const roomLabel = (r) => (r ? `العيادة ${r}` : 'بلا غرفة')
// مدى الوقت معزولاً من اليسار لليمين (LRI…PDI): في سطرٍ عربيّ يُقرأ «12:00–09:00» مقلوباً
const ltr = (x) => `\u2066${x}\u2069`
// تعديل السطر: القيمتان JSON بحقول السطر — يُكتب السطر القديم كاملاً ثمّ ما تغيّر وحده
const schedLine = (v) => `${WEEKDAYS[v.weekday]} ${ltr(`${v.start_time}–${v.end_time}`)}`
const SCHED_DIFF = [
  ['weekday', 'اليوم', (v) => WEEKDAYS[v.weekday]],
  ['time', 'الوقت', (v) => ltr(`${v.start_time}–${v.end_time}`)],
  ['break', 'الاستراحة', (v) => (v.break_start ? ltr(`${v.break_start}–${v.break_end}`) : 'بلا')],
  ['capacity', 'السعة', (v) => (v.capacity ? String(v.capacity) : 'بلا')],
  ['repeat', 'التكرار', (v) => (v.repeat_weeks === 2 ? `كل أسبوعين من ${v.anchor_date}` : 'كل أسبوع')],
]
function scheduleEditText(h) {
  let a, b
  try { a = JSON.parse(h.old_value); b = JSON.parse(h.new_value) } catch { return 'عُدِّل سطر دوام' }
  const diffs = SCHED_DIFF.map(([, label, f]) => [label, f(a), f(b)]).filter(([, x, y]) => x !== y)
    .map(([label, x, y]) => `${label}: ${x} ← ${y}`)
  return `عُدِّل دوام ${schedLine(a)} — ${diffs.join('، ')}`
}
function changeText(h) {
  if (h.field === 'pricing') return pricingText(h, 'doctor')
  if (h.field === 'room') return `الغرفة: ${roomLabel(h.old_value)} ← ${roomLabel(h.new_value)}`
  if (h.field === 'schedule') return scheduleEditText(h)
  if (h.field === 'appointments_based')
    return h.new_value === 'true' ? 'فُعِّل «بمواعيد خاصة» — لا تأخير يُحسب عليه' : 'أُطفئ «بمواعيد خاصة» — عاد حساب التأخير'
  const line = h.weekday == null ? 'سطر دوامٍ حُذف لاحقاً'
    : `دوام ${WEEKDAYS[h.weekday]} ${ltr(`${h.start_time}–${h.end_time}`)}${h.repeat_weeks === 2 ? ' (كل أسبوعين)' : ''}`
  return `${h.new_value === 'true' ? 'فُعِّل' : 'أُوقف'} ${line}`
}
function ChangeLog({ doctorId, reloadKey }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.clinic.doctorHistory(doctorId).then(setRows).catch((e) => setErr(e.message))
  }, [doctorId, reloadKey])
  if (err) return <section className="card pf-card" id="pf-log"><h3>سجلّ التعديلات</h3><p className="error">{err}</p></section>
  if (!rows) return null
  return (
    <section className="card pf-card" id="pf-log" aria-labelledby="pf-log-h">
      <header className="pf-card-head">
        <div>
          <h3 id="pf-log-h">سجلّ التعديلات</h3>
          <p className="pf-card-sub">الغرفة والتسعيرة وسطور الدوام وقواعد الحصّة — من عدّلها ومتى.</p>
        </div>
        {rows.length > 0 && <span className="badge">{rows.length}</span>}
      </header>
      {rows.length === 0
        ? <p className="empty">لا تعديلات مسجَّلة على الغرفة أو سطور الدوام أو قواعد الحصّة بعد.</p>
        : (
          <ul className="change-log">
            {rows.map((h) => (
              <li key={h.id}>
                <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
                <span>{changeText(h)}</span>
                <span className="muted">— {h.changed_by_name || 'غير معروف'}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

const initialOf = (name) => String(name || '').replace(/^د\.?\s*/, '').trim().charAt(0) || '؟'
const shiftMinutes = (s) => {
  const m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm }
  const br = s.break_start ? m(s.break_end) - m(s.break_start) : 0
  return m(s.end_time) - m(s.start_time) - br
}
const hoursText = (min) => { const h = Math.floor(min / 60), r = min % 60; return r ? `${h}:${String(r).padStart(2, '0')} س` : `${h} س` }

export default function DoctorProfile() {
  const { id } = useParams()
  const { clinicRole: role } = useRole()
  const [doctor, setDoctor] = useState(null)
  const [globalBuffer, setGlobalBuffer] = useState(null)
  const [err, setErr] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, showToast] = useToast()

  const load = () => api.clinic.doctor(id).then((d) => { setDoctor(d); setReloadKey((k) => k + 1) })
    .catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id])
  // الإعداد العام للفراغ — يُعرض كقيمة افتراضية عند ترك حقل الدكتور فارغاً
  useEffect(() => {
    api.settings()
      .then((rows) => setGlobalBuffer(rows.find((s) => s.key === 'clinic_hourly_buffer_minutes')?.value))
      .catch(() => {})
  }, [])

  if (err) return <p className="error">{err}</p>
  if (!doctor) return <p className="empty">جارٍ التحميل…</p>

  const active = doctor.schedules.filter((x) => x.is_active)
  const weekDays = new Set(active.map((x) => x.weekday)).size
  const weekMinutes = active.reduce((t, x) => t + (x.repeat_weeks === 2 ? shiftMinutes(x) / 2 : shiftMinutes(x)), 0)
  const canPay = canSeeClinicFunds(role)
  const canShares = SHARE_VIEWERS.includes(role)
  const sections = [
    ['pf-info', 'المعلومات'], ['pf-sched', 'الدوام'],
    ...(canShares ? [['pf-shares', 'الحصص']] : []), ...(canPay ? [['pf-pay', 'الراتب']] : []),
    ...(canShares ? [['pf-log', 'السجلّ']] : []),
  ]

  return (
    <div className="pf-page">
      <p className="subtitle pf-crumbs"><Link to="/clinic/doctors">← كل الدكاترة</Link></p>
      {toast}
      <section className="pf-hero" aria-label="الدكتور">
        <div className="pf-hero-top">
          <div className="pf-avatar" aria-hidden="true">{initialOf(doctor.name)}</div>
          <div className="pf-id">
            <h2>{doctor.name}</h2>
            <div className="pf-spec">{doctor.specialty || 'بلا اختصاص محدد'}</div>
            <div className="pf-badges">
              {doctor.is_active ? <span className="badge good">فعّال</span> : <span className="badge">موقوف</span>}
              <span className="badge blue">{doctor.room ? `العيادة ${doctor.room}` : 'بلا غرفة'}</span>
              {doctor.appointments_based && <span className="badge">بمواعيد خاصة</span>}
              {doctor.accepts_urgent === false && <span className="badge">لا يقبل الإسعافي</span>}
            </div>
          </div>
          {canSeeDoctorDashboard(role) && (
            <Link className="pf-hero-link" to={`/clinic/doctors/${doctor.id}/dashboard`}>لوحة التحكم ←</Link>
          )}
        </div>
        <dl className="pf-stats">
          <div><dt>المعاينة</dt><dd>{fmtMoney(doctor.consultation_fee)}</dd></div>
          <div><dt>المراجعة</dt><dd>{fmtMoney(doctor.followup_fee)}</dd><small>خلال {doctor.followup_window_days} يوم</small></div>
          <div><dt>مدة الكشف</dt><dd>{doctor.expected_visit_minutes} د</dd></div>
          <div><dt>الدوام الأسبوعي</dt><dd>{weekDays ? `${weekDays} ${weekDays >= 3 && weekDays <= 10 ? 'أيام' : weekDays === 2 ? 'يومان' : 'يوم'}` : '—'}</dd>
            {weekMinutes > 0 && <small>{hoursText(Math.round(weekMinutes))} بالأسبوع</small>}</div>
        </dl>
      </section>

      <nav className="pf-nav" aria-label="أقسام البروفايل">
        {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section className="card pf-card" id="pf-info" aria-labelledby="pf-info-h">
        <header className="pf-card-head">
          <div>
            <h3 id="pf-info-h">معلومات الدكتور والتسعيرة</h3>
            <p className="pf-card-sub">{role === 'clinic_admin' ? 'كل ما في هذه البطاقة يُحفظ معاً بزرّ «حفظ التعديلات».' : 'اطّلاعٌ فقط — مشرفة العيادات تعدّلها.'}</p>
          </div>
        </header>
        <ProfileForm doctor={doctor} globalBuffer={globalBuffer} onSaved={load} readOnly={role !== 'clinic_admin'} />
      </section>

      <section className="card pf-card" id="pf-sched" aria-labelledby="pf-sched-h">
        <header className="pf-card-head">
          <div>
            <h3 id="pf-sched-h">جدول الدوام الأسبوعي</h3>
            <p className="pf-card-sub">الخانات تُحسب تلقائياً من مدة الكشف ({doctor.expected_visit_minutes} دقيقة) — تعديل المدة يعيد تقسيمها كلّها.</p>
          </div>
          {role === 'clinic_admin' && <Link className="pf-head-link" to="/clinic/doctors">تعديل الدوام ←</Link>}
        </header>
        {doctor.schedules.length === 0
          ? <p className="empty">لا يوجد جدول دوام بعد — أضفه من صفحة الدكاترة.</p>
          : (
            <div className="pf-shifts">
              {doctor.schedules.map((s) => (
                <article key={s.id} className={`pf-shift${s.is_active ? '' : ' sched-off'}`}>
                  <header>
                    <span className="sched-day">{WEEKDAYS[s.weekday]}</span>
                    {s.repeat_weeks === 2 && <span className="badge sm">كل أسبوعين</span>}
                    {!s.is_active && (
                      <span className="badge sm"
                        title={s.toggled_by_name ? `أوقفه ${s.toggled_by_name} — ${fmtDateTime(s.toggled_at)}` : undefined}>
                        موقوف
                      </span>
                    )}
                  </header>
                  <div className="pf-shift-time" dir="ltr">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</div>
                  <div className="pf-shift-meta">
                    {s.break_start ? <span>استراحة {ltr(`${fmtTime(s.break_start)}–${fmtTime(s.break_end)}`)}</span> : <span>بلا استراحة</span>}
                    <SlotPreview schedule={s} minutes={doctor.expected_visit_minutes} />
                  </div>
                </article>
              ))}
            </div>
          )}
      </section>

      {canShares && (
        <div id="pf-shares" className="pf-anchor">
          <DoctorShareRules doctor={doctor} canEdit={role === 'clinic_admin'} onSaved={load} showToast={showToast} />
        </div>
      )}

      {/* الراتب: المشرفة والمدير والمشرف العام وحدهم (FUND_* بالخادم) — لا المجلس ولا الطبيب */}
      {canPay && <DoctorPayCard doctorId={doctor.id} canEdit={canWriteClinicFunds(role)} showToast={showToast} />}

      {/* نفس من يرى «دكاترة اليوم» (APOLOGY_VIEWERS بالخادم) — والخادم يردّ غيرهم 403 */}
      {canShares && <ChangeLog doctorId={doctor.id} reloadKey={reloadKey} />}
    </div>
  )
}
