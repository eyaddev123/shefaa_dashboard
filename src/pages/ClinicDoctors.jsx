import { useEffect, useId, useRef, useState } from 'react'
import { SpecialtyPicker } from '../SpecialtyPicker.jsx'
import { useDialogs } from '../dialogs.jsx'
import { Link } from 'react-router-dom'
import { api, WEEKDAYS, fmtMoney, fmtTime, fmtDateTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { doctorMatches } from '../doctor-search.js'
import { canSeeDoctorDashboard } from '../permissions.js'
import { Modal, EmptyState } from '../components/inventory/shared.jsx'

// ═══ إضافة دكتور — نافذةٌ فوق الصفحة، والحقول والتحقّق والمسار كما كانت في النموذج المضمَّن ═══
// الخطأ يبقى داخلها بقيمه. والإغلاق (Esc، النقر خارجها، «إلغاء») يسأل أولاً إن كُتب شيء.
const BLANK_DOCTOR = { name: '', specialty_id: '', phone: '', consultation_fee: '', followup_fee: '',
                       followup_window_days: '7', expected_visit_minutes: '15', room: '',
                       accepts_urgent: true }
function NewDoctorDialog({ onClose, onCreated }) {
  const dlg = useDialogs()
  const [form, setForm] = useState(BLANK_DOCTOR)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const asking = useRef(false)   // Esc يصل نافذة التأكيد وهذه معاً — سؤالٌ واحد لا اثنان
  const uid = useId()             // يربط كل عنوانٍ بحقله (النقر عليه، وقارئ الشاشة)
  const fid = (k) => `${uid}-${k}`
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }))
  const dirty = Object.keys(BLANK_DOCTOR).some((k) => form[k] !== BLANK_DOCTOR[k])
  const close = async () => {
    if (asking.current) return
    if (dirty) {
      asking.current = true
      const ok = await dlg.confirm({ title: 'تجاهل التغييرات؟', body: 'القيم المكتوبة لهذا الدكتور لن تُحفظ.',
        confirmLabel: 'تجاهل', cancelLabel: 'متابعة الكتابة', danger: true })
      asking.current = false
      if (!ok) return
    }
    onClose()
  }
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      await api.clinic.addDoctor({
        ...form,
        consultation_fee: Number(form.consultation_fee) || 0,
        followup_fee: Number(form.followup_fee) || 0,
        followup_window_days: Number(form.followup_window_days) || 7,
        expected_visit_minutes: Number(form.expected_visit_minutes) || 15,
      })
      onCreated(form.name.trim())
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <Modal title="إضافة دكتور" onClose={close} busy={busy} sheet>
    <form className="inline new-doctor-form" onSubmit={submit}>
      <div className="field"><label htmlFor={fid('name')}>اسم الدكتور</label><input id={fid('name')} value={form.name} onChange={set('name')} required autoFocus /></div>
      <SpecialtyPicker value={form.specialty_id} canAdd
        onChange={(v) => setForm((f) => ({ ...f, specialty_id: v }))} />
      <div className="field"><label htmlFor={fid('phone')}>الجوال</label><input id={fid('phone')} value={form.phone} onChange={set('phone')} dir="ltr" /></div>
      {/* رقم الغرفة يُشتقّ منه اسم المقطع الصوتي (room-3.mp3) — الخادم يطبّع
          الأرقام العربية والمسافات، والتنويه هنا يمنع المشكلة من أصلها (AUDIO.md) */}
      <div className="field"><label htmlFor={fid('room')}>الغرفة</label><input id={fid('room')} value={form.room} onChange={set('room')} placeholder="مثال: 3" />
        <small className="hint">بالأرقام اللاتينية (3 لا ٣) — يُنطق على شاشة النداء</small></div>
      <div className="field"><label htmlFor={fid('consultation_fee')}>سعر المعاينة (ل.س)</label><input id={fid('consultation_fee')} type="number" min="0" value={form.consultation_fee} onChange={set('consultation_fee')} required /></div>
      <div className="field"><label htmlFor={fid('followup_fee')}>سعر المراجعة (ل.س)</label><input id={fid('followup_fee')} type="number" min="0" value={form.followup_fee} onChange={set('followup_fee')} required /></div>
      <div className="field"><label htmlFor={fid('followup_window_days')}>صلاحية المراجعة (يوم)</label><input id={fid('followup_window_days')} type="number" min="1" value={form.followup_window_days} onChange={set('followup_window_days')} required /></div>
      <div className="field"><label htmlFor={fid('expected_visit_minutes')}>مدة الكشف المتوقعة (دقيقة)</label><input id={fid('expected_visit_minutes')} type="number" min="1" value={form.expected_visit_minutes} onChange={set('expected_visit_minutes')} required /></div>
      {/* اختصاصات كالتخاطب والعلاج الفيزيائي لا تأتيها حالات إسعافية — إطفاء العلم
          يُخفي زرّي الحجز الفوري والترقية عند هذا الدكتور، والخادم يرفضهما كذلك */}
      <div className="field field-check">
        <label>
          <input type="checkbox" checked={form.accepts_urgent} onChange={setBool('accepts_urgent')} />
          يقبل الحالات الإسعافية
        </label>
        <small className="hint">أطفئه للاختصاصات التي لا تأتيها حالات إسعافية (تخاطب، علاج فيزيائي)</small>
      </div>
      {/* الخطأ فوق الزرّين داخل الشريط الثابت: على الجوال يبقى ظاهراً حيث نُقر «إضافة» مهما طالت الورقة */}
      <div className="new-doctor-actions">
        {err && <p className="error" role="alert">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة دكتور'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={close}>إلغاء</button>
      </div>
    </form>
    </Modal>
  )
}

// ═══ نموذج سطر الدوام — للإضافة، وللتعديل معبّأً بقيم السطر (schedule) ═══
// التعديل يغيّر السطر نفسه (نفس id). الجلسات المولَّدة قبله نُسخٌ ثابتة فلا تتأثر — فإن كان
// منه جلسة اليوم (أو جلساتٌ قادمة وُلِّدت سلفاً) قيل ذلك صراحةً قبل الحفظ.
function ScheduleForm({ doctorId, schedule, onSaved, onCancel }) {
  const editing = !!schedule
  const blank = editing
    ? { weekday: String(schedule.weekday), start_time: fmtTime(schedule.start_time),
        end_time: fmtTime(schedule.end_time), capacity: schedule.capacity ? String(schedule.capacity) : '',
        repeat_weeks: String(schedule.repeat_weeks || 1), anchor_date: schedule.anchor_ymd || '' }
    : { weekday: '3', start_time: '16:00', end_time: '19:00', capacity: '', repeat_weeks: '1', anchor_date: '' }
  const [form, setForm] = useState(blank)
  const [hasBreak, setHasBreak] = useState(editing && !!schedule.break_start)
  const [breakTimes, setBreakTimes] = useState(editing && schedule.break_start
    ? { break_start: fmtTime(schedule.break_start), break_end: fmtTime(schedule.break_end) }
    : { break_start: '17:00', break_end: '17:30' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setBreak = (k) => (e) => setBreakTimes((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const biweekly = form.repeat_weeks === '2'
      const body = {
        ...form,
        weekday: Number(form.weekday),
        capacity: form.capacity ? Number(form.capacity) : null,
        break_start: hasBreak ? breakTimes.break_start : null,
        break_end: hasBreak ? breakTimes.break_end : null,
        repeat_weeks: biweekly ? 2 : 1,
        // المرساة للثنائي وحده — القاعدة ترفض مرساةً على قالبٍ أسبوعي
        anchor_date: biweekly ? form.anchor_date : null,
      }
      if (editing) await api.clinic.updateSchedule(schedule.id, body)
      else { await api.clinic.addSchedule(doctorId, body); setForm(blank); setHasBreak(false) }
      onSaved()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  const today = todayLocal()
  const upcoming = editing ? (schedule.upcoming_sessions || []) : []
  const todaySession = upcoming.find((x) => x.date === today)
  const later = upcoming.filter((x) => x.date !== today)
  return (
    <form className={`inline sched-form${editing ? ' editing' : ''}`} onSubmit={submit}
      style={{ marginTop: 10, flexWrap: 'wrap' }}>
      {editing && (
        <div className="sched-form-head">
          <strong>تعديل دوام {WEEKDAYS[schedule.weekday]} <bdi dir="ltr">{fmtTime(schedule.start_time)}–{fmtTime(schedule.end_time)}</bdi></strong>
          {(todaySession || later.length > 0) && (
            <p className="sched-form-note" role="note">
              {todaySession && <>جلسة اليوم قائمة على الوقت القديم (<bdi dir="ltr">{todaySession.start_time}–{todaySession.end_time}</bdi>) ولن تتغير. </>}
              {later.length > 0 && <>{later.length === 1 ? 'وجلسة' : 'وجلسات'} {later.map((x) => x.date).join('، ')} مولَّدة مسبقاً وتبقى كما هي. </>}
              التعديل يسري من التوليد القادم.
            </p>
          )}
        </div>
      )}
      <div className="field">
        <label>اليوم</label>
        <select value={form.weekday} onChange={set('weekday')}>
          {Object.entries(WEEKDAYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>من</label><input type="time" value={form.start_time} onChange={set('start_time')} required /></div>
      <div className="field"><label>إلى</label><input type="time" value={form.end_time} onChange={set('end_time')} required /></div>
      <div className="field"><label>السعة (اختياري)</label><input type="number" min="1" value={form.capacity} onChange={set('capacity')} /></div>
      {/* ═══ التكرار: دكتوران يتناوبان على السبت يأخذ كلٌّ منهما مرساةً تبعد أسبوعاً ═══ */}
      <div className="field">
        <label>التكرار</label>
        <select value={form.repeat_weeks} onChange={set('repeat_weeks')}>
          <option value="1">كل أسبوع</option>
          <option value="2">كل أسبوعين</option>
        </select>
      </div>
      {form.repeat_weeks === '2' && (
        <div className="field">
          <label>أول تاريخ عمل</label>
          <input type="date" value={form.anchor_date} onChange={set('anchor_date')} required />
          <span className="hint">يجب أن يقع في {WEEKDAYS[form.weekday]}</span>
        </div>
      )}
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
      <div className="sched-form-actions">
        <button type="submit" disabled={busy} style={{ padding: '6px 14px', fontSize: 12.5 }}>
          {busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'إضافة موعد دوام'}
        </button>
        {editing && (
          <button type="button" className="ghost" style={{ padding: '6px 14px', fontSize: 12.5 }} onClick={onCancel}>إلغاء</button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// ═══ أسبوع الدكتور: سبعة أيام من السبت، والمضيء يوم دوام (week من قائمة الدكاترة) ═══
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]
const DAY_SHORT = { 0: 'أحد', 1: 'اثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت' }
const initialOf = (name) => String(name || '').replace(/^د\.?\s*/, '').trim().charAt(0) || '؟'
function WeekStrip({ week }) {
  const byDay = {}
  for (const w of week || []) (byDay[w.weekday] ||= []).push(w)
  const days = Object.keys(byDay).length
  return (
    <div className="dc-week" aria-label={days ? `أيام الدوام: ${WEEK_ORDER.filter((d) => byDay[d]).map((d) => WEEKDAYS[d]).join('، ')}` : 'بلا دوام'}>
      {WEEK_ORDER.map((d) => {
        const lines = byDay[d]
        const title = lines ? lines.map((l) => `${l.start}–${l.end}${l.repeat === 2 ? ' (كل أسبوعين)' : ''}`).join(' · ') : 'لا دوام'
        return (
          <span key={d} className={`dc-day${lines ? ' on' : ''}${lines?.every((l) => l.repeat === 2) ? ' alt' : ''}`}
            title={`${WEEKDAYS[d]}: ${title}`} aria-hidden="true">
            <b>{DAY_SHORT[d]}</b>
            {lines && <small dir="ltr">{lines[0].start}</small>}
          </span>
        )
      })}
    </div>
  )
}

function DoctorCard({ doctor, onChanged, onSchedulesChanged }) {
  const dlg = useDialogs()
  const { clinicRole: role } = useRole()
  const canEdit = role === 'clinic_admin'
  const [expanded, setExpanded] = useState(false)
  const [schedules, setSchedules] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const loadSchedules = () => api.clinic.schedules(doctor.id).then(setSchedules)
  const toggle = () => {
    setExpanded((v) => !v)
    if (!schedules) loadSchedules()
  }

  const toggleActive = async () => {
    if (doctor.is_active) {
      const ok = await dlg.confirm({ title: `إيقاف ${doctor.name}؟`,
        body: 'لا تُولَّد له جلساتٌ جديدة ولا يظهر للحجز، وكلّ ما سبق يبقى. تقدرين تفعّليه متى شئتِ.',
        confirmLabel: 'إيقاف', danger: true })
      if (!ok) return
    }
    try { await api.clinic.updateDoctor(doctor.id, { is_active: !doctor.is_active }); onChanged() }
    catch (ex) { await dlg.alert({ title: 'تعذّر التنفيذ', body: ex.message }) }
  }

  // التأكيد يسمّي السطر بتكراره: سطران بنفس اليوم والساعة (أسبوعي وكل أسبوعين)
  // لا يُميَّزان إلا به، والحذف نفسه بالـ id وحده.
  const removeSchedule = async (s) => {
    const ok = await dlg.confirm({
      title: 'حذف موعد الدوام',
      body: `حذف دوام ${WEEKDAYS[s.weekday]} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)} (${
        s.repeat_weeks === 2 ? 'كل أسبوعين' : 'كل أسبوع'})؟ لن تُولَّد منه جلساتٌ بعد اليوم، والجلسات السابقة تبقى.`,
      confirmLabel: 'حذف', danger: true,
    })
    if (!ok) return
    try { await api.clinic.deleteSchedule(s.id) }
    catch (ex) {
      // الرفض لحجوزاتٍ قادمة يحمل أصحابها: المشرف يرى من سيتأثر لا رقماً فقط
      const list = (ex.data?.appointments || [])
        .map((a) => `${a.session_date}${a.slot_time ? ` ${a.slot_time}` : ''} — ${a.full_name}`)
      await dlg.alert({ title: 'تعذّر حذف الدوام', body: [ex.message, ...list].join('\n') })
    }
    loadSchedules(); onSchedulesChanged()
  }

  // ═══ إيقاف/تفعيل السطر بلا حذف ═══
  // دكتورٌ يغيب فترة: يُوقَف يومه ويُفعَّل يوم بديله، وحين يعود يُعكَس. الموقوف لا تُولَّد
  // منه جلسات — والمولَّدة قبله تبقى (إلغاؤها اعتذارٌ أو إلغاءٌ عاديّ، لا أثرٌ لمفتاح).
  const toggleSchedule = async (s) => {
    setToggling(s.id)
    try { await api.clinic.setScheduleActive(s.id, !s.is_active) }
    catch (ex) { await dlg.alert({ title: 'تعذّر التنفيذ', body: ex.message }) }
    setToggling(null)
    loadSchedules(); onSchedulesChanged()
  }

  const editing = schedules?.find((s) => s.id === editingId)
  const afterSave = () => { setEditingId(null); loadSchedules(); onSchedulesChanged() }
  const spec = doctor.specialty_name || doctor.specialty
  const profile = `/clinic/doctors/${doctor.id}`

  return (
    <article className={`dc-card${doctor.is_active ? '' : ' off'}${expanded ? ' open' : ''}`}>
      <header className="dc-card-head">
        <Link to={profile} className="dc-avatar" aria-hidden="true" tabIndex={-1}>{initialOf(doctor.name)}</Link>
        <div className="dc-who">
          <Link to={profile} className="dc-name">{doctor.name}</Link>
          <div className="dc-spec">
            {spec || <span className="muted">بلا اختصاص</span>}
            {doctor.room && <span className="dc-room">العيادة {doctor.room}</span>}
          </div>
        </div>
        <div className="dc-state">
          {doctor.is_active ? <span className="badge good sm">فعّال</span> : <span className="badge sm">موقوف</span>}
          {/* المطالِع (المجلس، المشرف العام، المدير) يرى الحالة بلا زرّ */}
          {canEdit && <button type="button" className="dc-state-btn" onClick={toggleActive}>
            {doctor.is_active ? 'إيقاف' : 'تفعيل'}
          </button>}
        </div>
      </header>

      {(!doctor.specialty_id || doctor.appointments_based || doctor.accepts_urgent === false) && (
        <div className="dc-flags">
          {/* بلا اختصاص ⇒ يرى الإجراءات العامّة وحدها — تحذيرٌ ظاهر لا صمت */}
          {!doctor.specialty_id && (
            <span className="badge warn sm" title="سيرى الإجراءات العامّة وحدها حتى يُختار اختصاصه">بلا اختصاص</span>
          )}
          {doctor.appointments_based && (
            <span className="badge blue sm" title="يعطي مرضاه مواعيد بنفسه — لا يُحسب عليه تأخير ولا يدخل نسبة الالتزام">بمواعيد خاصة</span>
          )}
          {doctor.accepts_urgent === false && <span className="badge sm">لا يقبل الإسعافي</span>}
        </div>
      )}

      <WeekStrip week={doctor.week} />

      <dl className="dc-facts">
        <div><dt>المعاينة</dt><dd>{fmtMoney(doctor.consultation_fee)}</dd></div>
        <div><dt>المراجعة</dt><dd>{fmtMoney(doctor.followup_fee)}</dd></div>
        <div><dt>الكشف</dt><dd>{doctor.expected_visit_minutes} د</dd></div>
      </dl>
      {doctor.phone && <div className="dc-phone" dir="ltr">{doctor.phone}</div>}

      <footer className="dc-actions">
        <Link to={profile} className="dc-btn primary">البروفايل</Link>
        {canSeeDoctorDashboard(role) && <Link to={`${profile}/dashboard`} className="dc-btn">لوحة التحكم</Link>}
        <button type="button" className="dc-btn" aria-expanded={expanded} onClick={toggle}>
          {expanded ? 'إخفاء الدوام' : 'جدول الدوام'}
        </button>
      </footer>

      {expanded && (
        <section className="dc-sched" aria-label={`دوام ${doctor.name}`}>
          {!schedules ? <p className="empty">جارٍ التحميل…</p> : (
            <>
              {schedules.length === 0
                ? <p className="empty">لا يوجد جدول دوام بعد لهذا الدكتور.</p>
                : (
                  <ul className="dc-sched-list">
                    {schedules.map((s) => (
                      <li key={s.id} className={['dc-sched-row', s.is_active ? '' : 'sched-off', s.id === editingId ? 'sched-editing' : '']
                        .filter(Boolean).join(' ')}>
                        <div className="dc-sched-main">
                          <span className="sched-day">{WEEKDAYS[s.weekday]}</span>
                          <bdi className="dc-sched-time" dir="ltr">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</bdi>
                          {s.repeat_weeks === 2 && <span className="badge warn sm">كل أسبوعين</span>}
                          {s.break_start && <span className="dc-sched-meta">استراحة <bdi dir="ltr">{fmtTime(s.break_start)}–{fmtTime(s.break_end)}</bdi></span>}
                          {s.capacity && <span className="dc-sched-meta">السعة {s.capacity}</span>}
                          {!s.is_active && (
                            <span className="badge sm"
                              title={s.toggled_by_name ? `أوقفه ${s.toggled_by_name} — ${fmtDateTime(s.toggled_at)}` : undefined}>
                              موقوف
                            </span>
                          )}
                        </div>
                        {canEdit && (
                          <div className="dc-sched-actions">
                            <label className="sched-switch"
                              title={s.is_active ? 'إيقاف مؤقّت: لا تُولَّد منه جلسات حتى يُفعَّل' : 'تفعيل: تُولَّد منه الجلسات من جديد'}>
                              <input type="checkbox" role="switch" checked={s.is_active}
                                disabled={toggling === s.id} onChange={() => toggleSchedule(s)}
                                aria-label={`${WEEKDAYS[s.weekday]} ${fmtTime(s.start_time)} — ${s.is_active ? 'مفعّل' : 'موقوف'}`} />
                              {s.is_active ? 'مفعّل' : 'موقوف'}
                            </label>
                            <button type="button" className="ghost sm-btn" aria-pressed={s.id === editingId}
                              aria-label={`تعديل دوام ${WEEKDAYS[s.weekday]} ${fmtTime(s.start_time)}`}
                              onClick={() => setEditingId(s.id === editingId ? null : s.id)}>تعديل</button>
                            <button type="button" className="ghost sm-btn danger-text" onClick={() => removeSchedule(s)}>حذف</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              {/* التعديل يحلّ محلّ نموذج الإضافة (نفس الحقول معبّأة) حتى يُحفظ أو يُلغى */}
              {!canEdit ? null : editing
                ? <ScheduleForm key={editing.id} schedule={editing} onSaved={afterSave} onCancel={() => setEditingId(null)} />
                : <ScheduleForm doctorId={doctor.id} onSaved={afterSave} />}
              <p className="dc-sched-note">
                التسعيرة ومدة الكشف وحصّة الإجراءات والراتب: <Link to={profile}>في بروفايله</Link>
              </p>
            </>
          )}
        </section>
      )}
    </article>
  )
}

// ═══ معاينة التواريخ القادمة ═══
// مشرفٌ يضبط دكتورَين متناوبَين لا يملك طريقةً ليتأكّد إلا الانتظار أسبوعين.
// هذه تعرض من يعمل في كل تاريخ قادم — فيُكتشف خطأ المرساة قبل أن يراه المرضى.
// version: يتغيّر مع كل إضافة/حذف/إيقاف لسطر — فتُعاد المعاينة المفتوحة لا تبقى قديمة
function SchedulePreview({ version }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => { setData(null) }, [version])
  useEffect(() => {
    if (!open || data) return
    api.clinic.schedulePreview(todayLocal(), 6).then(setData).catch((e) => setErr(e.message))
  }, [open, data])

  return (
    <section className="card dc-preview">
      <header className="dc-preview-head">
        <div>
          <h3>معاينة الأيام القادمة</h3>
          <p>من يعمل في كل تاريخ — يكشف خطأ التناوب كل أسبوعين وتشارك الغرف قبل أن يراه المرضى.</p>
        </div>
        <button type="button" className="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'إخفاء' : 'عرض من يعمل في كل تاريخ'}
        </button>
      </header>
      {open && (
        err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.days.length === 0 ? <p className="empty">لا دوامات مُعرَّفة بعد.</p>
        : (
          <ol className="dc-days">
            {data.days.map((d) => (
              <li key={d.date} className={d.doctors.length ? undefined : 'none'}>
                <div className="dc-days-date">
                  <strong>{WEEKDAYS[d.weekday]}</strong>
                  <span dir="ltr">{d.date}</span>
                </div>
                <div className="dc-days-docs">
                  {d.doctors.length === 0
                    ? <span className="muted">لا أحد</span>
                    : d.doctors.map((x) => (
                      <span key={x.doctor_id} className="dc-chip">
                        {x.doctor_name}
                        {x.room && <small>غرفة {x.room}</small>}
                        {x.repeat_weeks === 2 && <small className="alt">كل أسبوعين</small>}
                      </span>
                    ))}
                  {/* تحذيرٌ لا منع: قد يكون التشارك مقصوداً (دوامان متتاليان) */}
                  {d.room_clashes.length > 0 && (
                    <span className="badge bad">⚠ غرفة مشتركة: {d.room_clashes.join('، ')}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  )
}

const FILTERS = [['all', 'الكل'], ['active', 'فعّال'], ['off', 'موقوف']]

export default function ClinicDoctors() {
  const { clinicRole: role } = useRole()
  const [doctors, setDoctors] = useState(null)
  const [err, setErr] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [toast, showToast] = useToast()
  const [schedVersion, setSchedVersion] = useState(0)

  const load = () => api.clinic.doctors().then(setDoctors).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  // تغيّر سطر دوام ⇒ تُعاد المعاينة المفتوحة، ويُعاد أسبوع البطاقة (week من القائمة)
  const bumpSchedules = () => { setSchedVersion((v) => v + 1); load() }

  if (err) return <p className="error">{err}</p>
  if (!doctors) return <p className="empty">جارٍ التحميل…</p>
  const active = doctors.filter((d) => d.is_active)
  const noSpec = active.filter((d) => !d.specialty_id).length
  const noWeek = active.filter((d) => Array.isArray(d.week) && d.week.length === 0).length
  const byFilter = doctors.filter((d) => filter === 'all' || (filter === 'active' ? d.is_active : !d.is_active))
  const shown = byFilter.filter((d) => doctorMatches(d, query))
  const searching = query.trim() !== ''
  const narrowed = searching || filter !== 'all'

  return (
    <div className="dc-page">
      <header className="dc-head">
        <div>
          <h2>الدكاترة والدوام</h2>
          <p className="subtitle">كل دكتور ببطاقة: أيام دوامه وأسعاره، ومنها بروفايله وجدول دوامه.</p>
        </div>
        {/* الإضافة لمشرف العيادات وحده — الخادم يرفضها لغيره أصلاً */}
        {role === 'clinic_admin' && <button type="button" className="dc-add" onClick={() => setAdding(true)}>+ إضافة دكتور</button>}
      </header>

      {toast}
      <div className="dc-summary">
        <div className="dc-stat"><strong>{active.length}</strong><span>دكتور فعّال</span></div>
        <div className="dc-stat"><strong>{doctors.length - active.length}</strong><span>موقوف</span></div>
        <div className={`dc-stat${noWeek ? ' warn' : ''}`}><strong>{noWeek}</strong><span>فعّال بلا دوام</span></div>
        <div className={`dc-stat${noSpec ? ' warn' : ''}`}><strong>{noSpec}</strong><span>بلا اختصاص</span></div>
      </div>

      {doctors.length > 0 && (
        <div className="dc-toolbar">
          <div className="doctors-search" role="search">
            <div className="doctors-search-box">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالاسم أو الاختصاص أو الجوال…" aria-label="ابحث في الدكاترة" />
              {searching && (
                <button type="button" className="doctors-search-clear" aria-label="مسح البحث"
                  onClick={() => setQuery('')}>×</button>
              )}
            </div>
          </div>
          <div className="seg dc-filter" role="radiogroup" aria-label="الحالة">
            {FILTERS.map(([k, label]) => (
              <label key={k} className={filter === k ? 'on' : undefined}>
                <input type="radio" name="dc-filter" checked={filter === k} onChange={() => setFilter(k)} />{label}
              </label>
            ))}
          </div>
          <span className="doctors-count" aria-live="polite">
            {narrowed ? `${shown.length} من ${doctors.length} دكتور` : `${doctors.length} دكتور`}
          </span>
        </div>
      )}

      {shown.length === 0 && narrowed ? (
        <div className="card">
          <EmptyState text="ما في دكتور بهالاسم" hint={searching ? `لا نتائج لـ «${query.trim()}» في الاسم ولا الاختصاص ولا الجوال.` : 'لا دكاترة بهذه الحالة.'}>
            <button type="button" className="ghost" onClick={() => { setQuery(''); setFilter('all') }}>مسح البحث</button>
          </EmptyState>
        </div>
      ) : doctors.length === 0 ? (
        <div className="card"><p className="empty">لا دكاترة بعد{role === 'clinic_admin' ? ' — أضيفي أوّلهم من «+ إضافة دكتور».' : '.'}</p></div>
      ) : (
        <div className="dc-grid">
          {shown.map((d) => <DoctorCard key={d.id} doctor={d} onChanged={load} onSchedulesChanged={bumpSchedules} />)}
        </div>
      )}
      {adding && (
        <NewDoctorDialog onClose={() => setAdding(false)}
          onCreated={(name) => { setAdding(false); load(); showToast(`أُضيف ${name}`, 'success', 3500) }} />
      )}

      <SchedulePreview version={schedVersion} />
    </div>
  )
}
