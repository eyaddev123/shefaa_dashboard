import { Fragment, useEffect, useRef, useState } from 'react'
import { useDialogs } from '../dialogs.jsx'
import { loadPrinter, ticketFrom } from '../ticket-print.js'
import { printViaHelper } from '../print-helper.js'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, APPOINTMENT_STATUSES, BOOKING_TYPES, VISIT_TYPES, PRIORITIES, DELAY_CAUSES, WEEKDAYS, addDays, todayLocal, fmtMoney, fmtTime, toLatinDigits } from '../api.js'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock, FlowModeTag, FLOW_MODE_LABELS,
  AttendanceNumber, turnLabel, fmtTimeOfDay } from '../attendance-ui.jsx'
import { attendanceBookedMessage } from '../booking-message.js'
import { QUEUE_TABS, DEFAULT_TAB, isTab, rowsOfTab, matchesQuery, tabCounts, tabLabel, liveProcedures, extraTotals } from '../queue-tabs.js'
import { useRole } from '../RoleContext.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'
import { canStepOutAsSupervisor } from '../permissions.js'
import { WAITING_RETURN, waitingReturnOf, serverOffsetOf, Elapsed, useStaffEvents } from '../waiting-return.jsx'
import ReferralsEditor from '../components/ReferralFields.jsx'
import { referralPayload, referralReady, referralSummary } from '../referral.js'
import RoomBadge from '../components/RoomBadge.jsx'

// شارة الأولوية — تُبرز من يتقدّم الطابور وسببه
export function priorityBadge(priority) {
  if (!priority || priority === 'normal') return null
  const cls = priority === 'urgent' ? 'bad' : 'warn'
  return <span className={`badge ${cls}`} style={{ marginInlineStart: 6 }}>{PRIORITIES[priority]}</span>
}

// عمود الموعد: الوقت الأساسي المتفق عليه ← الوقت الحالي بعد الانزياح، مع تفصيل الأسباب
function SlotCell({ appt }) {
  const orig = fmtTime(appt.original_slot_time)
  const now = fmtTime(appt.slot_time)
  if (!appt.original_slot_time && !appt.slot_time) return <span className="muted">—</span>
  // ★ من تجاوز الدوام: خانته NULL فـ fmtTime تعطي «—»، فيقرأ الموظف «12:15 ← —»
  // ولا يفهم شيئاً. نكتبها صراحةً: الموعد لم يُلغَ، بل صار بعد انتهاء الدوام.
  if (!appt.slot_time && (appt.delays || []).some((d) => d.cause === 'session_overflow')) {
    return (
      <span title="انزاح موعده إلى ما بعد نهاية الدوام — ما زال في قائمة الدور">
        <s style={{ opacity: 0.55 }} dir="ltr">{orig}</s>{' → '}
        <strong className="after-hours">بعد انتهاء الدوام</strong>
      </span>
    )
  }
  if (!appt.delay_minutes) return <span dir="ltr">{now}</span>
  const detail = (appt.delays || [])
    .map((d) => `${DELAY_CAUSES[d.cause] || d.cause}: ${d.minutes} د${d.times > 1 ? ` (${d.times} مرات)` : ''}`)
    .join('، ')
  return (
    <span title={detail}>
      <s style={{ opacity: 0.55 }} dir="ltr">{orig}</s>{' → '}
      <strong dir="ltr">{now}</strong>
      <span className="badge warn" style={{ marginInlineStart: 6 }}>+{appt.delay_minutes} د</span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{detail}</span>
    </span>
  )
}

export function appointmentBadge(status, small = false) {
  const cls = status === 'in_service' ? 'good' : status === 'no_show' || status === 'cancelled' ? 'bad'
    : status === 'postponed' ? 'warn'
    : status === 'arrived' ? 'warn' : status === WAITING_RETURN ? 'blue' : ''
  // «مؤجَّل» ليس في قائمة الحالات القابلة للاختيار، فكان يظهر بالاسم الإنكليزي في «ما حضر»
  const label = APPOINTMENT_STATUSES[status] || (status === 'postponed' ? 'مؤجَّل' : status)
  return <span className={`badge ${cls}${small ? ' sm' : ''}`}>{label}</span>
}

// ═══ خانة الحالة في الطابور ═══
// «بانتظار العودة» (خروج مؤقت) شارةٌ زرقاء هادئة ومعها كم صار له خارجاً — لا «غائب»:
// المريض في الصالة ينتظر أن يناديه الطبيب ليُكمل، ورقم دوره كما هو.
export function StatusCell({ appt, offset }) {
  if (appt.status !== WAITING_RETURN) return appointmentBadge(appt.status)
  return (
    <span className="wr-status">
      {appointmentBadge(appt.status)}
      <Elapsed since={appt.stepped_out_at} offset={offset} />
    </span>
  )
}

// ═══ أزرار الطوارئ لمشرف العيادات ═══
// الطبيب يفعلها من شاشته؛ وهنا للمشرف وحده (طبيبٌ غادر ومريضه «خارج»). والعودة
// يرفضها الخادم والطبيب في منتصف كشف مريضٍ آخر — والرسالة تقول ماذا يُفعل.
export function SupervisorReturnActions({ appt, onDone, onError }) {
  const { role } = useRole()
  const [busy, setBusy] = useState(false)
  if (!canStepOutAsSupervisor(role)) return null
  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(appt.id); onDone(okMsg) } catch (ex) { onError(ex.message) } finally { setBusy(false) }
  }
  const btn = { padding: '3px 10px', fontSize: 11.5 }
  if (appt.status === 'in_service') return (
    <button className="ghost" style={btn} disabled={busy}
      onClick={() => run(api.clinic.stepOut, 'خرج مؤقتاً — ويبقى دوره')}>خروج مؤقت</button>
  )
  if (appt.status === WAITING_RETURN) return (
    <button className="ghost" style={btn} disabled={busy}
      onClick={() => run(api.clinic.returnCall, 'نودي للعودة على شاشة الصالة')}>نداء العودة</button>
  )
  return null
}

function TicketPrint({ appt, doctorName, attendance = false, onDone }) {
  const printed = useRef(false)
  useEffect(() => {
    if (printed.current) return
    printed.current = true
    setTimeout(() => window.print(), 200)
  }, [])
  return (
    <div className="ticket-print">
      <div className="ticket-card">
        <h2>{attendance ? 'بطاقة الحجز' : 'بطاقة الدور'}</h2>
        <p className="ticket-doctor">{doctorName}</p>
        {attendance ? (
          // نمط الحضور: لا رقم دور عند الحجز — يُعطى عند الحضور. رقم الحجز مرجعٌ
          // للاستقبال. (الوقت التقريبي للاستقبال وحده: لا يُطبع على أي بطاقة.)
          <>
            <p className="ticket-number">{appt.queue_number}</p>
            <p className="ticket-hint">رقم الحجز — رقم الدور يُعطى عند الحضور، والنداء بترتيب الحضور.</p>
          </>
        ) : (
          <p className="ticket-number">{appt.queue_number}</p>
        )}
        {/* رمز الوصول هو مفتاح صفحة «دوري» العامة — يُطبع بارزاً لأن المريض
            سيكتبه على موبايله. رمز البطاقة الداخلي لم يعد يفتح شيئاً علناً. */}
        <p className="ticket-access-code">رمز الوصول: <strong>{appt.access_code}</strong></p>
        <p className="ticket-hint">
          احتفظ بهذه البطاقة. لمتابعة دورك: افتح صفحة «دوري» وأدخل رقم موبايلك مع رمز الوصول.
        </p>
        <button className="no-print" onClick={onDone} style={{ marginTop: 16 }}>إغلاق</button>
      </div>
    </div>
  )
}

function BookingForm({ sessionId, slotTime, fees, onBooked, onCancel, urgent = false, attendance = false }) {
  // نمط الحضور: الحجز العادي غالباً هاتفي (المريض يحضر لاحقاً فيُعلَّم حضوره) — فهو الافتراضي.
  // والفوري يبقى «حضر شخصياً»: الإسعافي الحضوري يُسجَّل حاضراً فوراً، والهاتفي ينتظر.
  // ونمط الخانات كما كان: حقل الطريقة يُخفى عند اختيار خانة وتُرسَل القيمة الافتراضية.
  const defaultBookingType = attendance && !urgent ? 'phone' : 'walk_in'
  const blank = { mobile: '', full_name: '', gender: '', birth_year: '', booking_type: defaultBookingType,
                  reason: '', visit_type: 'consultation', priority: urgent ? 'urgent' : 'normal' }
  const [form, setForm] = useState(blank)
  const [lookupState, setLookupState] = useState(null) // null | 'checking' | 'found' | 'new'
  const [followup, setFollowup] = useState(null)       // أهليّة المراجعة للمريض الحالي
  const [override, setOverride] = useState(null)       // سبب تجاوز شرط المراجعة (يملؤه المشرف)
  const [referrals, setReferrals] = useState([])   // أوراق الإحالة — حتى اثنتين ([] = مطويّة)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // ═══ الوقت التقريبي — معاينةٌ حيّة (نمط الحضور) ═══
  // ما سيأخذه الحجز لو حُفظ الآن، من الخادم بقواعده نفسها (قراءةٌ بلا قفل). يُحدَّث عند
  // الفتح، وكل ١٠ ث، وعند تغيّر الأولوية أو الطريقة (الإسعافي الحضوري بلا وقت)، وقبل الإرسال.
  // الحقيقيّ يُعطى عند الحفظ تحت قفل الجلسة — إن حجز غيرُك بينهما تقول رسالة النجاح «تغيّر من».
  const [preview, setPreview] = useState(null)   // 'HH:MM' | null
  const fetchPreview = async () => {
    if (!attendance) return
    try {
      const r = await api.clinic.estimatePreview(sessionId, { priority: form.priority, booking_type: form.booking_type })
      setPreview(fmtTimeOfDay(r?.estimated_time))
    } catch { /* المعاينة إرشاد — فشلها لا يمنع الحجز */ }
  }
  useEffect(() => { fetchPreview() }, [attendance, sessionId, form.priority, form.booking_type]) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(fetchPreview, attendance, 10000)

  // ═══ البحث بالاسم هو المدخل الأساسي ═══
  // الموبايل صار اختيارياً عند الحجز، فالبحث به وحده يترك من لا موبايل له بلا
  // طريق للتعرّف عليه — صفٌّ جديد في كل زيارة وتاريخٌ مقطوع. والاسم متاح دائماً.
  const [candidates, setCandidates] = useState(null)
  const [picked, setPicked] = useState(null)       // من اختير (أو مُلئ تلقائياً) — لإظهاره وللتراجع
  const [beforePick, setBeforePick] = useState(null) // لقطة النموذج قبل الملء، للتراجع

  const applyPatient = (patient, auto = false) => {
    setBeforePick((prev) => prev ?? form)          // أول ملء فقط: لا نطمس لقطة التراجع
    setForm((f) => ({ ...f, full_name: patient.full_name, mobile: patient.mobile || f.mobile,
      gender: patient.gender || '', birth_year: patient.birth_year || '' }))
    setLookupState('found')
    setFollowup(patient.followup || null)
    setCandidates(null)
    setPicked({ ...patient, auto })
  }

  // التراجع: يُعيد النموذج لما كان قبل الملء — الموظف قد يكتشف أنه ليس نفسه
  const undoPick = () => {
    if (beforePick) setForm(beforePick)
    setPicked(null); setBeforePick(null)
    setLookupState(null); setFollowup(null); setCandidates(null)
  }

  const handleLookup = (r) => {
    const list = r?.candidates
    if (list?.length === 1) { applyPatient(list[0], true); return }   // نتيجة واحدة ⇒ ملء مباشر
    if (list?.length > 1) { setCandidates(list); setLookupState('candidates'); return }
    if (r?.id) { applyPatient(r); return }                            // مطابقة موبايل قاطعة
    setLookupState('new'); setFollowup(null); setCandidates(null)
  }

  // ★ المدخل الأساسي: يبحث فور اكتمال ثلاث كلمات
  const checkName = async (name) => {
    if (picked) return                      // اختيارٌ قائم — لا نبحث فوقه
    const words = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (words.length < 3) { setCandidates(null); setLookupState(null); return }
    setLookupState('checking')
    try { handleLookup(await api.clinic.lookupPatientBy({ full_name: name, session_id: sessionId })) }
    catch { setLookupState(null) }
  }

  // خيار ثانوي: الموبايل معرّفٌ قاطع حين يعرفه الموظف
  const checkMobile = async (mobile) => {
    if (picked) return
    if (String(mobile).trim().length < 8) { setFollowup(null); return }
    setLookupState('checking')
    try { handleLookup(await api.clinic.lookupPatientBy({ mobile, session_id: sessionId })) }
    catch { setLookupState(null) }
  }

  const isFollowup = form.visit_type === 'followup'
  // تحذير عند اختيار «مراجعة» لمريض لا تنطبق عليه الشروط — يُسمح بالمتابعة بسبب صريح
  const followupBlocked = isFollowup && followup && !followup.eligible
  const needsOverride = isFollowup && (followupBlocked || (lookupState === 'new'))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    // ما رآه الموظف (وربما قاله للمتّصل) لحظة الضغط — هو ما تُقارَن به رسالة النجاح.
    // والتحديث قبل الإرسال يُري الوقت الأحدث إن فشل الحجز وبقي النموذج مفتوحاً.
    const shownAtClick = preview
    await fetchPreview()
    try {
      const appt = await api.clinic.book(sessionId, {
        ...form,
        birth_year: form.birth_year ? Number(form.birth_year) : null,
        slot_time: slotTime || undefined,
        followup_override_reason: needsOverride ? (override || null) : undefined,
        referrals: referrals.length ? referrals.map(referralPayload) : undefined,
      })
      onBooked(attendance ? { ...appt, preview_estimated_time: shownAtClick } : appt)
    } catch (ex) {
      setErr(ex.message)
      // السيرفر يعيد تفاصيل عدم الأهلية — نعرضها ونفتح خانة سبب التجاوز
      if (ex.data?.code === 'FOLLOWUP_NOT_ELIGIBLE') {
        setFollowup(ex.data.followup || { eligible: false, message: ex.message })
        if (override === null) setOverride('')
      }
    }
    finally { setBusy(false) }
  }

  const fee = isFollowup ? fees?.followup_fee : fees?.consultation_fee

  return (
    <form className="booking-form" onSubmit={submit}>
      {attendance && preview && (
        <p className="bf-estimate" aria-live="polite">الوقت التقريبي: <strong dir="ltr">{preview}</strong></p>
      )}
      {/* ═══ صفّ الهوية: الاسم هو المدخل الأساسي فيأخذ عرضاً أكبر ═══ */}
      <div className="bf-row bf-row-identity">
        <div className="field bf-name">
          <label>الاسم الثلاثي</label>
          <input value={form.full_name}
            onChange={(e) => { set('full_name')(e); checkName(e.target.value) }}
            required autoFocus placeholder="الاسم واسم الأب والكنية" />
          <small className="hint">
            {lookupState === 'checking' ? 'جارٍ البحث…'
              : lookupState === 'new' ? 'مريض جديد'
              : 'ثلاث كلمات على الأقل — نبحث بها عن المريض السابق'}
          </small>
        </div>
        <div className="field bf-mobile">
          <label>رقم الموبايل <span className="opt">(اختياري)</span></label>
          {/* ★ الأرقام العربية تُحوَّل فور الكتابة ليرى الموظف ما سيُخزَّن — والخادم
              يطبّع أيضاً، فالواجهة عرضٌ لا حراسة. */}
          <input value={form.mobile}
            onChange={(e) => { const v = toLatinDigits(e.target.value)
              setForm((f) => ({ ...f, mobile: v })); checkMobile(v) }}
            dir="ltr" inputMode="numeric" placeholder="09XXXXXXXX" />
          <small className={`hint ${form.mobile.trim() ? '' : 'warn-hint'}`}>
            {form.mobile.trim() ? '\u00A0' : 'بلا موبايل لا يتابع المريض دوره في «دوري»'}
          </small>
        </div>
      </div>

      {/* من اختير: يظهر صراحةً مع إمكانية التراجع — الملء التلقائي بلا إظهار
          يجعل الموظف يحجز لمريضٍ لم يقصده وهو لا يدري */}
      {picked && (
        <div className="picked-box">
          <div>
            <strong>{picked.auto ? 'مريض سابق — مُلئت بياناته' : 'اختير المريض'}:</strong>{' '}
            {picked.full_name}
            <span className="candidate-meta">
              {picked.mobile ? <span dir="ltr">{picked.mobile}</span> : 'بلا موبايل'}
              {picked.visits_count > 0 && ` · ${picked.visits_count} زيارة`}
              {picked.last_visit && ` · آخرها ${picked.last_visit}`}
            </span>
          </div>
          <button type="button" className="ghost" onClick={undoPick}>تراجع — ليس هو</button>
        </div>
      )}

      {/* مرشّحون بالاسم: الاسم ليس معرّفاً قاطعاً، فيقرّر الموظف لا النظام */}
      {candidates?.length > 0 && (
        <div className="candidates-box">
          <div className="candidates-title">
            وُجد {candidates.length} مرضى بهذا الاسم — اختر الصحيح أو تابع كمريض جديد
          </div>
          {candidates.map((c) => (
            <div key={c.id} className="candidate-row">
              <div>
                <strong>{c.full_name}</strong>
                <span className="candidate-meta">
                  {c.mobile ? <span dir="ltr">{c.mobile}</span> : 'بلا موبايل'}
                  {c.visits_count > 0 && ` · ${c.visits_count} زيارة`}
                  {c.last_visit && ` · آخرها ${c.last_visit}`}
                </span>
              </div>
              <button type="button" className="ghost" onClick={() => applyPatient(c)}>هو نفسه</button>
            </div>
          ))}
          <button type="button" className="ghost candidate-new" onClick={() => { setCandidates(null); setLookupState('new') }}>
            لا — مريض جديد
          </button>
        </div>
      )}
      {/* ═══ صفّ التفاصيل: حقول ضيّقة متساوية العرض ═══ */}
      <div className="bf-row bf-row-details">
        <div className="field">
          <label>الجنس</label>
          <select value={form.gender} onChange={set('gender')}>
            <option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option>
          </select>
        </div>
        {/* نصّ لا number: حقل الرقم لا يقبل الأرقام العربية أصلاً فتُبتلع الكتابة */}
        <div className="field">
          <label>سنة الميلاد</label>
          <input value={form.birth_year} inputMode="numeric" placeholder="1990"
            onChange={(e) => setForm((f) => ({ ...f, birth_year: toLatinDigits(e.target.value) }))} />
        </div>
        {!slotTime && (
          <div className="field">
            <label>طريقة الحجز</label>
            <select value={form.booking_type} onChange={set('booking_type')}>
              {Object.entries(BOOKING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>نوع الزيارة</label>
          <select value={form.visit_type} onChange={set('visit_type')}>
            {Object.entries(VISIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {fee != null && <small className="hint">السعر: {fmtMoney(fee)}</small>}
        </div>
        <div className="field">
          <label>الأولوية</label>
          <select value={form.priority} onChange={set('priority')}>
            {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field bf-reason">
          <label>ملاحظة الحجز <span className="opt">(اختيارية)</span></label>
          <input value={form.reason} onChange={set('reason')} />
        </div>
      </div>

      {/* تحذير الأولوية: سطرٌ كامل تحت الصفّ لا داخل خانة ضيّقة تكسر محاذاتها */}
      {form.priority !== 'normal' && (
        <p className={`bf-note ${form.priority === 'urgent' ? 'bf-note-urgent' : 'bf-note-warn'}`}>
          {/* نمط الحضور لا إزاحة فيه — النصّ القديم («مواعيدهم تتأجل») يكذب هناك */}
          {attendance
            ? (form.priority === 'urgent'
              ? (form.booking_type === 'phone'
                ? '⚠ إسعافي هاتفي — لا يتقدّم قبل حضوره، ثم يتصدّر الحاضرين'
                : '⚠ يُسجَّل حاضراً ويتصدّر الحاضرين — يُنادى بعد المريض الحالي')
              : 'شارة تنبيه فقط — مكانه بترتيب حضوره كغيره')
            : form.priority === 'urgent'
              ? '⚠ يتصدّر قائمة الدور — يُنادى بعد المريض الحالي مباشرة، ومواعيد المنتظرين تتأجل'
              : '⚠ يتقدّم كل المنتظرين، ومواعيدهم تتأجل'}
        </p>
      )}

      {/* حالة المراجعة: مؤهَّل (أخضر) أو تحذير مع خانة سبب تجاوز للمشرف */}
      {isFollowup && followup && (
        <div className="bf-followup">
          <p className={`bf-note ${followup.eligible ? 'bf-note-ok' : 'bf-note-urgent'}`}>
            {followup.eligible ? '✓ ' : '⚠ '}{followup.message}
          </p>
          {followupBlocked && (
            <div className="field" style={{ maxWidth: 460 }}>
              <label>سبب تجاوز شرط المراجعة (موافقة المشرف)</label>
              <input value={override || ''} onChange={(e) => setOverride(e.target.value)}
                placeholder="مثال: بموافقة مسؤول العيادات — حالة خاصة" required />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                يُسجَّل السبب واسمك على الحجز
              </span>
            </div>
          )}
        </div>
      )}

      {/* الإحالة: خانةٌ واحدة في الحالة العادية — تنفتح لمن معه ورقة */}
      <ReferralsEditor value={referrals} onChange={setReferrals} amounts={{ fee, lines: [] }} disabled={busy} />

      <div className="bf-actions">
        <button type="submit" disabled={busy || !referrals.every(referralReady)}>{busy ? 'جارٍ الحجز…' : 'حجز دور'}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>إلغاء</button>}
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// ═══ نموذج استكمال معلومات المريض عند الحضور ═══
// يُفتح تلقائياً حين يرفض الخادم الحضور لنقص المعلومات. يعرض الحقول الناقصة
// وحدها ويُرسلها مع تعليم الحضور في طلب واحد — فلا حضورٌ بمعلومات نصف مكتملة.
function CompletePatientForm({ appt, missing, patient, attendance = false, onCancel, onSubmit }) {
  const [form, setForm] = useState({
    mobile: patient.mobile || '', gender: patient.gender || '',
    birth_year: patient.birth_year || '',
  })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const need = (k) => missing.includes(k)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      // نُرسل ما كُتب فقط: إرسال null يمحو قيمةً مسجَّلة مسبقاً
      const patch = {}
      if (form.mobile.trim()) patch.mobile = form.mobile.trim()
      if (form.gender) patch.gender = form.gender
      if (form.birth_year) patch.birth_year = Number(form.birth_year)
      await onSubmit(patch)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="card highlight">
      <h3>معلومات المريض (اختيارية) — {appt?.full_name}</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        {appt && turnLabel(appt, attendance)} · أكملها إن تيسّر، أو علّم الحضور بدونها —
        لا شيء منها يمنع الحضور.
      </p>
      {/* بنية نموذج الحجز نفسها (booking-form + bf-row): صفٌّ محاذى من الأعلى، وكل حقل
          عمودٌ ثابت (تسمية، مُدخَل، تلميح) — فتلميح الموبايل لا يرفع مُدخَله عن جاريه. */}
      <form className="booking-form cpf-form" onSubmit={submit}>
        <div className="bf-row cpf-row">
          {need('mobile') && (
            <div className="field">
              <label>رقم الموبايل</label>
              <input value={form.mobile} dir="ltr" inputMode="numeric" autoFocus placeholder="09XXXXXXXX"
                onChange={(e) => setForm((f) => ({ ...f, mobile: toLatinDigits(e.target.value) }))} />
              <small className="hint">به يتابع المريض دوره في «دوري»</small>
            </div>
          )}
          {need('gender') && (
            <div className="field">
              <label>الجنس</label>
              <select value={form.gender} onChange={set('gender')}>
                <option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option>
              </select>
            </div>
          )}
          {need('birth_year') && (
            <div className="field">
              <label>سنة الميلاد</label>
              <input value={form.birth_year} inputMode="numeric" placeholder="1990"
                onChange={(e) => setForm((f) => ({ ...f, birth_year: toLatinDigits(e.target.value) }))} />
            </div>
          )}
        </div>
        <div className="bf-actions">
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ وحضر'}</button>
          <button type="button" className="ghost" disabled={busy}
            onClick={async () => {
              setErr(null); setBusy(true)
              // بلا تعديل: يمرّ الحضور وتبقى الشارة «بيانات ناقصة» تذكيراً
              try { await onSubmit({}) } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
            }}>حضر بدون إكمال</button>
          <button type="button" className="ghost" onClick={onCancel}>إلغاء</button>
        </div>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  )
}

// ═══ نافذة تأجيل الموعد ═══
// تختار الجلسة الهدف (نفس الدكتور أو غيره) وتكتب السبب. الخادم ينشئ الحجز الجديد
// بنفس قواعد الحجز — فرفضُه (جلسة ممتلئة أو ليوم مضى) يظهر كما هو بلا تفسير محلي.
// showTicket: إعداد «عرض بطاقة الحجز بعد الحجز». معطّلاً تُغلق النافذة فور النجاح برسالة
// قصيرة بدل بطاقة الرمز الجديد — والرمز يبقى ظاهراً في تفاصيل الحجز الجديد.
function PostponeDialog({ appt, currentSessionId, showTicket, attendance = false, onClose, onDone, onSuccessToast }) {
  // الغد افتراضاً: التأجيل يعني «ليس اليوم» في أغلب الحالات.
  // ⚠️ من أجزاء التاريخ المحلية لا toISOString(): تلك بتوقيت UTC، فبين منتصف الليل
  // والثالثة فجراً بتوقيت دمشق كانت تعطي تاريخ اليوم بدل الغد.
  const [date, setDate] = useState(() => addDays(todayLocal(), 1))
  const [sessions, setSessions] = useState(null)
  // تاريخٌ بلا جلسات أخرى: لماذا؟ { kind: 'only_current' | 'not_generated' | 'no_schedule', doctors }
  const [emptyWhy, setEmptyWhy] = useState(null)
  const { role } = useRole()
  const [targetId, setTargetId] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    setSessions(null); setTargetId(''); setEmptyWhy(null)
    let stale = false   // تاريخٌ غُيّر قبل وصول الرد: لا نكتب فوق التاريخ الجديد
    api.clinic.sessions(date)
      .then(async (rows) => {
        const others = rows.filter((r) => String(r.id) !== String(currentSessionId))
        let why = null
        if (others.length === 0) {
          // ★ «لا جلسات» كانت رسالةً واحدة لثلاث حالات، فيظن الموظف أن الدكتور لا يعمل يومها
          // بينما جلساتها لم تُولَّد بعد. التوليد يبقى قرار مشرف العيادات — نقول الحقيقة فقط.
          if (rows.length > 0) why = { kind: 'only_current' }
          else {
            const { schedules } = await api.clinic.schedulesForDate(date)
            const doctors = [...new Set(schedules.map((x) => x.doctor_name))]
            why = doctors.length ? { kind: 'not_generated', doctors } : { kind: 'no_schedule' }
          }
        }
        if (!stale) { setSessions(others); setEmptyWhy(why) }
      })
      .catch((e) => { if (!stale) setErr(e.message) })
    return () => { stale = true }
  }, [date, currentSessionId])

  const dayName = WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const r = await api.clinic.postpone(appt.id, { target_session_id: targetId, reason: reason.trim() })
      // الجلسة الهدف بنمط الحضور ⇒ الحجز الجديد يحمل وقتاً تقريبياً ولا رقم دور بعد
      if (!showTicket) {
        onSuccessToast(r.estimated_time
          ? `تم التأجيل — رقم الحجز ${r.queue_number} · الوقت التقريبي: ${fmtTimeOfDay(r.estimated_time)}`
          : `تم التأجيل — الدور ${r.queue_number}`)
        onDone(); return
      }
      setDone(r)   // نعرض رمز الوصول الجديد ليُعطى للمريض قبل إغلاق النافذة
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  if (done) return (
    <div className="card highlight">
      <h3>✔ تم التأجيل</h3>
      <p>
        {done.estimated_time ? (
          <>{appt.full_name} — رقم الحجز الجديد <strong>{done.queue_number}</strong>
            {' '}· الوقت التقريبي <strong dir="ltr">{fmtTimeOfDay(done.estimated_time)}</strong></>
        ) : (
          <>{appt.full_name} — الدور الجديد <strong>{done.queue_number}</strong></>
        )}
        {done.slot_time && <> الساعة <strong dir="ltr">{fmtTime(done.slot_time)}</strong></>}
      </p>
      {/* رمز الوصول الجديد: بلا إعطائه للمريض لا يستطيع متابعة دوره في «دوري» */}
      <p className="ptr-code-line">
        رمز الوصول الجديد: <strong className="ptr-code">{done.access_code}</strong>
        <small> — أعطِه للمريض، والرمز القديم لم يعد يعمل</small>
      </p>
      <button onClick={onDone}>تمّ</button>
    </div>
  )

  return (
    <div className="card highlight">
      <h3>تأجيل موعد — {appt.full_name} ({turnLabel(appt, attendance)})</h3>
      <form onSubmit={submit}>
        <div className="inline" style={{ flexWrap: 'wrap' }}>
          <div className="field">
            <label>تاريخ الجلسة الجديدة</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="field" style={{ minWidth: 280 }}>
            <label>الجلسة</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">— اختر —</option>
              {(sessions || []).map((sn) => (
                <option key={sn.id} value={sn.id}>
                  {sn.doctor_name} · {fmtTime(sn.start_time)}–{fmtTime(sn.end_time)} ({sn.active_count} على الدور)
                </option>
              ))}
            </select>
            {emptyWhy?.kind === 'only_current' && (
              <small className="hint">لا جلسات أخرى في هذا التاريخ غير الجلسة الحالية — جرّب تاريخاً آخر</small>
            )}
            {emptyWhy?.kind === 'not_generated' && (
              <small className="hint warn-hint">
                عند {emptyWhy.doctors.join('، ')} دوام يوم {dayName}، لكن جلسات هذا التاريخ لم تُولَّد بعد —{' '}
                {role === 'clinic_admin'
                  ? 'ولّدها من «لوحة العيادات اليومية» ثم عُد إلى هنا'
                  : 'اطلب من مشرف العيادات توليدها من لوحة العيادات'}
              </small>
            )}
            {emptyWhy?.kind === 'no_schedule' && (
              <small className="hint">لا دوام لأي دكتور يوم {dayName} — اختر تاريخاً آخر</small>
            )}
          </div>
          <div className="field" style={{ minWidth: 260 }}>
            <label>سبب التأجيل</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: الدكتور غائب / تجاوز الدوام" required />
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !targetId || !reason.trim()}>
            {busy ? 'جارٍ التأجيل…' : 'تأكيد التأجيل'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>إلغاء</button>
        </div>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  )
}

function SlotList({ sessionId, fees, onBooked, acceptsUrgent = true }) {
  const [slots, setSlots] = useState(null)
  const [err, setErr] = useState(null)
  const [openSlot, setOpenSlot] = useState(null) // slot_time currently showing the booking form, or 'walkin' | 'urgent'
  const urgentFormRef = useRef(null)

  const load = () => api.clinic.slots(sessionId).then(setSlots).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [sessionId])

  // نموذج الحالة الفورية أعلى الصفحة — نُحضره أمام العين فور فتحه بدل أن يبحث عنه الموظف وقت الطوارئ
  useEffect(() => {
    if (openSlot === 'urgent')
      urgentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [openSlot])

  if (err) return <p className="error">{err}</p>
  if (!slots) return <p className="empty">جارٍ التحميل…</p>

  return (
    <div className="slot-list">
      {/* الحالة الإسعافية أولاً وفوق كل شيء: زر بارز في الأعلى لا يحتاج بحثاً وقت الضغط.
          ويختفي كلياً عند دكتور لا تأتيه حالات إسعافية — الإخفاء تجميل، والخادم هو الحارس. */}
      {acceptsUrgent && (
        <div className="urgent-bar">
          <div className="urgent-bar-text">
            <strong>🚨 حالة فورية (إسعافية)</strong>
            <span>تُنادى مباشرة بعد المريض الحالي — أو فوراً إن لم يكن أحد قيد الكشف</span>
          </div>
          {openSlot !== 'urgent' && (
            <button className="urgent-btn" onClick={() => setOpenSlot('urgent')}>حجز فوري</button>
          )}
        </div>
      )}
      {openSlot === 'urgent' && (
        <div className="slot-booking-form" ref={urgentFormRef}>
          <BookingForm
            sessionId={sessionId}
            slotTime={null}
            fees={fees}
            urgent
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}

      {slots.slots.length === 0 && (
        <p className="empty">لا خانات محددة لهذه الجلسة — استخدم «حجز بلا وقت محدد» أدناه.</p>
      )}
      {slots.buffer_minutes > 0 && (
        <p className="subtitle" style={{ marginTop: 0, marginBottom: 10 }}>
          الخانات المخطّطة آخر كل ساعة هي <strong>فراغ احتياطي ({slots.buffer_minutes} د)</strong> —
          لا تُحجز لمريض عادي، وتُستخدم لاستيعاب الحالات الفورية فلا تتأخر بقية المواعيد.
        </p>
      )}
      {slots.slots.map((s) => (
        <div key={s.slot_time}
          className={`slot-row ${s.available ? 'available' : 'booked'} ${s.is_buffer ? 'buffer' : ''} ${s.is_past ? 'past' : ''} ${s.priority && s.priority !== 'normal' ? 'priority' : ''}`}>
          <span className="slot-time" dir="ltr">{s.slot_time}</span>
          {s.is_past && !s.full_name ? (
            <span className="slot-label">مضى وقتها</span>
          ) : s.available ? (
            <span className="slot-label">
              {s.is_buffer ? 'فراغ احتياطي — للحالات الفورية فقط' : 'متاحة'}
            </span>
          ) : (
            <span className="slot-label">
              الدور {s.queue_number} — {s.full_name}
              {/* شارة الأولوية أولاً: الموظف يميّز الحالة الإسعافية من نظرة واحدة */}
              {priorityBadge(s.priority)}
              {' '}<span className="badge" style={{ marginInlineStart: 6 }}>{APPOINTMENT_STATUSES[s.status]}</span>
              {s.used_buffer && <span className="badge warn" style={{ marginInlineStart: 6 }}>استُخدم الفراغ</span>}
              {/* سطر الانزياح: «06:30 ← 06:45» مع السبب. بلا هذا يرى المريض خانته
                  الحالية بلا تفسير لتغيّرها عمّا اتُّفق عليه. */}
              {s.delay_minutes > 0 && (
                <span style={{ display: 'block', marginTop: 3 }}>
                  <SlotCell appt={s} />
                </span>
              )}
            </span>
          )}
          {/* خانة الفراغ لا تُعرض للحجز العادي — تُملأ تلقائياً بأول حالة فورية */}
          {s.available && !s.is_buffer && openSlot !== s.slot_time && (
            <button className="ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setOpenSlot(s.slot_time)}>
              احجز
            </button>
          )}
        </div>
      ))}
      {openSlot && openSlot !== 'walkin' && openSlot !== 'urgent' && (
        <div className="slot-booking-form">
          <p className="subtitle" style={{ marginBottom: 0 }}>حجز خانة <strong dir="ltr">{openSlot}</strong></p>
          <BookingForm
            sessionId={sessionId}
            slotTime={openSlot}
            fees={fees}
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}

      <div className="slot-row walkin-row">
        <span className="slot-label">حضر بلا موعد محدد (يُعطى الدور التالي مباشرة)</span>
        {openSlot !== 'walkin' && (
          <button className="ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setOpenSlot('walkin')}>
            حجز بلا وقت محدد
          </button>
        )}
      </div>
      {openSlot === 'walkin' && (
        <div className="slot-booking-form">
          <BookingForm
            sessionId={sessionId}
            slotTime={null}
            fees={fees}
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}
    </div>
  )
}

// ═══ نافذة تقديم حجز إلى أولوية ═══
// ثلاثة أزرار بدل كتابة النوع باليد. والشرح تحت كل زر يتبع نمط الجلسة: في الخانات
// تُزاح مواعيد المنتظرين، وفي الحضور لا إزاحة (الإسعافي وحده يتقدّم). النتيجة تُعرض
// داخل النافذة لا في alert. الخادم هو الحارس (DOCTOR_NO_URGENT وغيره) — رسالته تُعرض كما هي.
function PriorityPicker({ appt, attendance, onClose, onDone, onArrived }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])
  const choices = [
    ['urgent', 'إسعافي', 'bad', attendance
      ? 'يُسجَّل حاضراً ويتصدّر الحاضرين — يُنادى بعد المريض الحالي'
      : 'يتصدّر قائمة الدور، ومواعيد المنتظرين بعده تتأجل'],
    ['elderly', 'كبير السن', 'warn', attendance
      ? 'شارة تنبيه فقط — مكانه بترتيب حضوره'
      : 'يتقدّم المنتظرين، ومواعيدهم تتأجل'],
    ['infant', 'رضيع', 'warn', attendance
      ? 'شارة تنبيه فقط — مكانه بترتيب حضوره'
      : 'يتقدّم المنتظرين، ومواعيدهم تتأجل'],
  ]
  const pick = async (priority) => {
    setBusy(true); setErr(null)
    try {
      const r = await api.clinic.prioritize(appt.id, priority)
      // الترقية إلى «إسعافي» تُسجّل المنتظر حاضراً — فهي مسار حضورٍ يطبع بطاقته
      if (r?.was_first_arrival && onArrived) onArrived({ ...appt, ...(r || {}) }, r)
      setResult(attendance
        ? (priority === 'urgent' ? 'تم — سُجّل حاضراً ويتصدّر الحاضرين.' : 'تم — أُضيفت الشارة، ومكانه بترتيب حضوره.')
        : `تم التقديم — تأجّل ${r.delayed_count} موعداً بمقدار مدة كشف واحدة.`)
      onDone()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="prio-title">
        <h3 id="prio-title">تقديم {turnLabel(appt, attendance)} — {appt.full_name}</h3>
        {result ? (
          <>
            <p className="bf-note bf-note-ok" style={{ marginTop: 10 }}>{result}</p>
            <div className="bf-actions" style={{ marginTop: 16 }}>
              <button autoFocus onClick={onClose}>حسناً</button>
            </div>
          </>
        ) : (
          <>
            <p className="subtitle" style={{ marginTop: 4 }}>اختر نوع الأولوية:</p>
            <div className="prio-choices">
              {choices.map(([key, label, cls, hint]) => (
                <button key={key} type="button" className={`prio-choice prio-${cls}`}
                  disabled={busy} onClick={() => pick(key)}>
                  <span className="prio-label">{label}</span>
                  <span className="prio-hint">{hint}</span>
                </button>
              ))}
            </div>
            {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
            <div className="bf-actions" style={{ marginTop: 14 }}>
              <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════ نمط الحضور ═══════════════
// مكوّنات منفصلة لا تفرّعات داخل مكوّنات نمط الخانات — فيبقى ذاك كما كان حرفياً.

// ═══ لافتة: الجلسة بنمطٍ غير الإعداد الحالي ═══
// يوم التبديل: الإعداد صار «الحضور» وجلسة اليوم وُلدت بالخانات قبله، فلا يتغيّر شيء
// ويظن الموظف التبديل معطّلاً. اللافتة تقول السبب، والتحويل لمشرف العيادات وللجلسة
// الفارغة وحدها — الخادم هو الحارس (403 لغيره، 409 لجلسة فيها حجز)، والإخفاء تجميل.
function FlowModeMismatch({ data, onChanged, onError }) {
  const dlg = useDialogs()
  const { role } = useRole()
  const [busy, setBusy] = useState(false)
  if (!data.flow_mode_setting || data.flow_mode_setting === data.flow_mode) return null
  const born = FLOW_MODE_LABELS[data.flow_mode], now = FLOW_MODE_LABELS[data.flow_mode_setting]
  const empty = data.appointments.length === 0
  const convert = async () => {
    const ok = await dlg.confirm({
      title: 'تحويل نمط الجلسة',
      body: `تحويل هذه الجلسة إلى ${now}؟`,
      confirmLabel: 'حوّل',
    })
    if (!ok) return
    setBusy(true)
    try { await api.clinic.switchSessionMode(data.id, data.flow_mode_setting); onChanged() }
    catch (ex) { onError(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="attn-mismatch" role="status">
      <div>
        هذه الجلسة وُلدت بـ<strong>{born}</strong>، والإعداد الحالي «{now}» — التبديل يسري على الجلسات الجديدة.
        {!empty && <> ولهذه الجلسة حجوزات، فتبقى على نمطها.</>}
      </div>
      {empty && role === 'clinic_admin' && (
        <button disabled={busy} onClick={convert}>تحويل هذه الجلسة إلى {now}</button>
      )}
      {empty && role !== 'clinic_admin' && <span className="muted">تحويلها لمشرف العيادات.</span>}
    </div>
  )
}

// الحجز في نمط الحضور: نفس نموذج الحجز تماماً، بلا اختيار وقت (لا خانات أصلاً)
// ═══ صفّ البطاقات الثلاث (نمط الحضور) ═══
// «حجز دور» ثم «قيد الكشف الآن» ثم «وصول الطبيب» في صفٍّ واحد مضغوط (من اليمين)، فيظهر
// جدول الطابور بلا تمرير على شاشة ١٣٦٦×٧٦٨. نموذج الحجز نفسه أكبر من بطاقة صغيرة، فيُفتح
// بعرض الصفحة **تحت** الصفّ (AttendanceBookingForm) — نفس النموذج بلا تغيير.

// بطاقة الحجز: الزرّان فقط
function AttendanceBookingCard({ acceptsUrgent, open, onOpen }) {
  return (
    <div className="card attn-compact">
      <h3>حجز دور</h3>
      <p className="attn-compact-hint">حجزُ مكانٍ لا وقت — الدور بترتيب الحضور</p>
      <div className="attn-compact-actions">
        <button disabled={!!open} onClick={() => onOpen('normal')}>+ حجز جديد</button>
        {/* الخادم هو الحارس (DOCTOR_NO_URGENT) — الإخفاء تجميل */}
        {acceptsUrgent && <button className="urgent-btn" disabled={!!open} onClick={() => onOpen('urgent')}>حجز فوري</button>}
      </div>
    </div>
  )
}

// نموذج الحجز بعرض الصفحة تحت الصفّ — BookingForm نفسه حرفياً
function AttendanceBookingForm({ sessionId, fees, open, onClose, onBooked }) {
  if (!open) return null
  return (
    <div className="card">
      <h3>{open === 'urgent' ? 'حجز فوري' : 'حجز جديد'}</h3>
      <div className="slot-booking-form">
        <BookingForm
          key={open}
          sessionId={sessionId}
          slotTime={null}
          fees={fees}
          urgent={open === 'urgent'}
          attendance
          onBooked={(appt) => { onClose(); onBooked(appt) }}
          onCancel={onClose}
        />
      </div>
    </div>
  )
}

// قيد الكشف الآن — مضغوط، ورقم الدور كبير يُقرأ بلمحة. فارغٌ بنفس الارتفاع (الشبكة تمدّ الثلاث).
function AttendanceCurrentCard({ current, returning = [], recalled, onRecalled, onError }) {
  return (
    <div className={`card attn-compact ${current ? 'highlight' : ''}`}>
      <h3>قيد الكشف الآن</h3>
      {current ? (
        <div className="attn-current">
          <div className="attn-current-who">
            <div className="attn-current-num">{turnLabel(current, true)}<AttendanceBadge priority={current.priority} /></div>
            <div className="attn-current-name">{current.full_name}</div>
          </div>
          <div className="attn-current-recall">
            <RecallButton apptId={current.id} onError={onError} onDone={onRecalled} />
            {recalled && (
              <div className="attn-compact-hint">
                أُعيد النداء {new Date(recalled).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      ) : <p className="attn-compact-empty">لا أحد قيد الكشف</p>}
      {/* خرجوا مؤقتاً وسيُنادَون ليُكملوا — سطرٌ صغير لا يزاحم «قيد الكشف» */}
      {returning.length > 0 && (
        <div className="wr-inline">
          بانتظار العودة:
          {returning.map((a) => (
            <span key={a.id} className="wr-inline-num">{turnLabel(a, true)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// وصول الطبيب: زرٌّ مرة واحدة، ثم الوقت مع «تصحيح» يترك أثراً يُعرض تحته
function DoctorArrivalCard({ data, onChanged, onError }) {
  const dlg = useDialogs()
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try { await fn(); onChanged() } catch (ex) { onError(ex.message) } finally { setBusy(false) }
  }
  const fix = async () => {
    const t = await dlg.prompt({
      title: 'تصحيح وقت وصول الطبيب',
      body: 'الوقت الصحيح (ساعة:دقيقة، مثل 09:40) — ويُحفظ الوقت السابق في الأثر.',
      defaultValue: fmtClock(data.doctor_arrived_at),
      placeholder: '09:40',
      confirmLabel: 'صحّح', required: true,
    })
    if (t) run(() => api.clinic.fixDoctorArrival(data.id, toLatinDigits(t).trim()))
  }
  const history = data.doctor_arrival_history || []
  // الأثر لا يضيع حين تنطوي البطاقة: كل تصحيح بقيمته السابقة ومن صحّحه ومتى — في تلميح السطر
  const trail = history.map((h) =>
    `صُحّح من ${fmtClock(h.previous_value)} إلى ${fmtClock(h.new_value)} — ${h.changed_by_name || '—'} عند ${fmtClock(h.changed_at)}`).join('\n')
  return (
    <div className="card attn-compact">
      <h3>وصول الطبيب</h3>
      {data.doctor_arrived_at ? (
        // بعد التسجيل: سطرٌ واحد — الوقت ورابط «تصحيح»
        <div className="attn-arrival-line" title={[
          `بداية الدوام ${fmtTime(data.start_time)}`,
          data.doctor_arrived_by_name && `سجّله ${data.doctor_arrived_by_name}`,
          trail,
        ].filter(Boolean).join('\n')}>
          <span className="attn-arrival-time" dir="ltr">{fmtClock(data.doctor_arrived_at)}</span>
          {history.length > 0 && <span className="attn-compact-hint">صُحّح {history.length === 1 ? 'مرة' : `${history.length} مرات`}</span>}
          <button className="link-btn" disabled={busy} onClick={fix}>تصحيح</button>
        </div>
      ) : (
        <>
          <p className="attn-compact-hint">لم يُسجَّل بعد · بداية الدوام <span dir="ltr">{fmtTime(data.start_time)}</span></p>
          <div className="attn-compact-actions">
            <button disabled={busy} onClick={() => run(() => api.clinic.doctorArrived(data.id))}>وصل الطبيب</button>
          </div>
        </>
      )}
    </div>
  )
}

// ═══ السعر في صفّ الطابور ═══
// بلا إجراءات: سعر الزيارة كما كان. ومعها ثلاثة أسطر: المعاينة، الإجراءات، الإجمالي.
// كلماتٌ لا «+» و«=»: الرمز المحايد في أول سطرٍ عربي ينقلب موضعه بخوارزمية الاتجاه.
// للعرض وحده — لا شيء يُكتب في الخزينة.
// الإحالة: الأصل مشطوباً ← المطلوب بعد الخصم، وشارة «إحالة» باسم الجهة — فالموظف يستوفي
// ما بعد الخصم لا السعر الأصلي. (الطبيب لا يتسلّم حقل الإحالة أصلاً فلا يرى شيئاً منها.)
function ReferralBadge({ appt }) {
  const list = appt.referrals || []
  if (!list.length) return null
  return (
    <span className="badge sm ref-badge" title={list.map((r) => `${r.source_name} · ${referralSummary(r)}`).join('\n')}>
      {list.length > 1 ? 'إحالتان' : 'إحالة'}
    </span>
  )
}
function FeeCell({ appt }) {
  const r = (appt.referrals || []).length > 0
  if (!appt.procedures_total) {
    if (!r) return <>{fmtMoney(appt.fee)}</>
    return (
      <span className="fee-breakdown">
        <span>{appt.referral_discount > 0 && <><s className="muted">{fmtMoney(appt.fee)}</s> ← </>}
          <strong>{fmtMoney(appt.patient_total)}</strong></span>
        <ReferralBadge appt={appt} />
      </span>
    )
  }
  // ═══ سطر العمل للاستقبال ═══
  // المبالغ وحدها تقول «كم»، ولا تقول «افعل». والموظف يحتاج جملةً صريحة:
  // أيّ إجراءٍ أُضيف وكم يُستوفى زيادةً — وإلا مرّ المريض بلا دفع الفرق.
  const live = (appt.procedures || []).filter((l) => !l.removed_at)
  const names = live.map((l) => l.name).join('، ')
  return (
    <span className="fee-breakdown">
      <span>{VISIT_TYPES[appt.visit_type] || 'زيارة'} {fmtMoney(appt.fee)}</span>
      <span>إجراءات {fmtMoney(appt.procedures_total)}</span>
      {/* سطران لا سطرٌ واحد: الأصل مشطوباً ثمّ المطلوب — فلا يتّسع العمود فيضيق الاسم */}
      {r && appt.referral_discount > 0 ? (
        <>
          <span><s>الإجمالي {fmtMoney(appt.total)}</s></span>
          <strong>المطلوب {fmtMoney(appt.patient_total)}</strong>
        </>
      ) : <strong>الإجمالي {fmtMoney(appt.total)}</strong>}
      {r && <ReferralBadge appt={appt} />}
      {names && (
        <span className="fee-action">
          {/* بعد خصم الإحالة على الإجراءات (إن شملها النطاق) — ما يُستوفى فعلاً */}
          إجراء: {names} — خذي {fmtMoney(r ? appt.patient_total - appt.patient_fee : appt.procedures_total)} زيادة
        </span>
      )}
    </span>
  )
}

// ═══ تفاصيل الحجز — سطرٌ ينفتح تحت صفّ الطابور ═══
// رمز الوصول هنا دائماً: حين تُعطَّل بطاقة الحجز لا يُعرض الرمز في أي مكان آخر،
// والمريض قد يطلبه لاحقاً لمتابعة دوره من «دوري».
// المعلومات المؤجَّلة: اختيارية عند الحجز والحضور معاً، وتُستكمل متى تيسّر.
// الاسم الثلاثي وحده إلزاميّ — عند الحجز.
const MISSING_FIELDS = [
  { key: 'mobile', label: 'رقم الموبايل' },
  { key: 'gender', label: 'الجنس' },
  { key: 'birth_year', label: 'سنة الميلاد' },
]
export const missingOf = (appt) => MISSING_FIELDS.filter((f) => !appt[f.key])

// شارة «بيانات ناقصة» على صفّ الطابور — تُفصح عن الناقص في tooltip فلا يحتاج
// الموظف فتح التفاصيل ليعرف ما ينقص.
export function MissingBadge({ appt }) {
  const m = missingOf(appt)
  if (m.length === 0) return null
  return <span className="badge warn sm" title={`ينقص: ${m.map((f) => f.label).join('، ')}`}>بيانات ناقصة</span>
}

// ملاحظة الحجز تحت الاسم في صفّ الطابور: سطرٌ صغير يُقصّ إن طال، وكاملها في tooltip
function QueueNote({ appt }) {
  if (!appt.reason) return null
  return <div className="queue-note" title={appt.reason}>{appt.reason}</div>
}

// طابور نمط الحضور: بترتيب الخادم (قيد الكشف، ثم الحاضرون — الإسعافي أولاً ثم الأقدم
// حضوراً — ثم من لم يحضر). لا عمود موعد ولا انتظار متوقَّع: لا خانات ولا تقدير هنا.
function AttendanceQueueTable({ data, rows, tab, actions }) {
  const { reload, toast } = actions
  const offset = serverOffsetOf(data)
  return (
      <table className="rtable">
        <thead>
          <tr>
            <th>الدور</th><th>الاسم</th><th>الموبايل</th><th>نوع الزيارة</th><th>السعر</th>
            <th>وقت الحضور</th><th>الحالة</th><th>قبله</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <Fragment key={a.id}>
            <tr className={urgentRowClass(a)}>
              <td className="num" data-label="الدور"><AttendanceNumber appt={a} /><AttendanceBadge priority={a.priority} /></td>
              <td className="rt-title"><VisitLink appt={a} /> <MissingBadge appt={a} /><QueueNote appt={a} /></td>
              <td data-label="الموبايل"><bdi dir="ltr">{a.mobile || '—'}</bdi></td>
              <td data-label="نوع الزيارة">
                {VISIT_TYPES[a.visit_type] || a.visit_type}
                {a.followup_override_by && (
                  <span className="badge warn" style={{ marginInlineStart: 6 }}
                    title={a.followup_override_reason || ''}>تجاوز</span>
                )}
              </td>
              <td className="num" data-label="السعر" style={{ whiteSpace: 'nowrap' }}><FeeCell appt={a} /></td>
              <td data-label="وقت الحضور"><bdi dir="ltr">{a.arrived_at ? fmtClock(a.arrived_at) : '—'}</bdi></td>
              <td className="rt-badge"><StatusCell appt={a} offset={offset} /></td>
              <td className="num" data-label="قبله">{a.ahead_count ?? '—'}</td>
              <td className="queue-row-actions rt-actions">
                <VisitActions appt={a} data={data} actions={actions}
                  onDone={(msg) => { toast(msg, 'success'); reload() }} onError={(msg) => { toast(msg); reload() }} />{' '}
                {a.status === 'waiting' && <><NoShowButton appt={a} onChanged={reload} onError={toast} />{' '}</>}
                <OpenVisit appt={a} />
              </td>
            </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
  )
}

// زرّ «ما حضر» لمن لم يحضر (نمط الحضور) — كان في بطاقة «لسا بانتظار» وصار في تبويب
// «بانتظار الحضور». لا إلغاء ولا عدم حضور تلقائي: الإنسان يقرّر لكل واحد.
function NoShowButton({ appt: a, onChanged, onError }) {
  const dlg = useDialogs()
  const noShow = async () => {
    const ok = await dlg.confirm({
      title: 'تعليم «ما حضر»',
      body: `تعليم ${turnLabel(a, true)} (${a.full_name}) «ما حضر»؟`,
      confirmLabel: 'ما حضر', cancelLabel: 'تراجع', danger: true,
    })
    if (!ok) return
    try { await api.clinic.noShow(a.id); onChanged() } catch (ex) { onError(ex.message) }
  }
  return <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={noShow}>ما حضر</button>
}

// جدول نمط الخانات — صفوف التبويب
function SlotsQueueTable({ data, rows, actions, onDone, onError }) {
  return (
    <table className="rtable">
      <thead>
        <tr>
          <th>الدور</th><th>الاسم</th><th>الموبايل</th><th>نوع الزيارة</th><th>السعر</th>
          <th>الموعد (الأصلي ← الحالي)</th><th>الحالة</th><th>الانتظار المتوقع</th><th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="num" data-label="الدور">{a.queue_number}{priorityBadge(a.priority)}</td>
            <td className="rt-title"><VisitLink appt={a} /><QueueNote appt={a} /></td>
            <td data-label="الموبايل"><bdi dir="ltr">{a.mobile}</bdi></td>
            <td data-label="نوع الزيارة">
              {VISIT_TYPES[a.visit_type] || a.visit_type}
              {a.followup_override_by && (
                <span className="badge warn" style={{ marginInlineStart: 6 }}
                  title={a.followup_override_reason || ''}>تجاوز</span>
              )}
            </td>
            <td className="num" data-label="السعر"><FeeCell appt={a} /></td>
            <td data-label="الموعد"><SlotCell appt={a} /></td>
            <td className="rt-badge"><StatusCell appt={a} offset={serverOffsetOf(data)} /></td>
            <td className="num" data-label="الانتظار المتوقع">
              {['waiting', 'arrived', 'in_service'].includes(a.status) ? `~${a.wait_minutes} د` : '—'}
            </td>
            <td className="queue-row-actions rt-actions">
              <VisitActions appt={a} data={data} actions={actions} onDone={onDone} onError={onError} />{' '}
              <OpenVisit appt={a} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ═══ تبويبا «الإجراءات» و«الإحالات» — تجميعٌ عرضيّ لا حالة ═══
// من ردّ /queue نفسه، وبما يراه الاستقبال أصلاً: أسعار المريض وخصم الإحالة — لا حصص ولا مواد
// ولا أسعار شراء. الصفّ كلّه يفتح صفحة الزيارة. والمجموع تحته لليوم كلّه (لا لنتائج البحث)،
// والملغى ومن لم يحضر والمؤجَّل يُعرضون ولا يُجمَعون.
function TurnCell({ appt: a, attendance }) {
  return attendance ? <AttendanceNumber appt={a} /> : <>{a.queue_number}</>
}
function ExtraRow({ appt, children }) {
  const open = useOpenVisit()
  return (
    <tr className="clickable" onClick={(e) => { if (!e.target.closest('a,button')) open(appt) }}>
      {children}
    </tr>
  )
}
function ExcludedNote({ n }) {
  return n > 0 ? <span className="muted"> (بلا {n} ملغى/لم يحضر)</span> : null
}
function ProceduresTable({ data, rows, all, attendance }) {
  const t = extraTotals(all)
  return (
    <>
      <table className="rtable">
        <thead><tr><th>الدور</th><th>الاسم</th><th>الدكتور</th><th>الإجراءات</th><th>المبلغ</th><th>الحالة</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <ExtraRow key={a.id} appt={a}>
              <td className="num" data-label="الدور"><TurnCell appt={a} attendance={attendance} /></td>
              <td className="rt-title"><VisitLink appt={a} /></td>
              <td data-label="الدكتور">{data.doctor_name}</td>
              <td className="rt-full" data-label="الإجراءات">{liveProcedures(a).map((l) => l.name).join('، ')}</td>
              <td className="num" data-label="المبلغ" style={{ whiteSpace: 'nowrap' }}>{fmtMoney(a.procedures_total)}</td>
              <td className="rt-badge">{appointmentBadge(a.status, true)}</td>
            </ExtraRow>
          ))}
        </tbody>
      </table>
      <p className="queue-extra-total">إجمالي الإجراءات اليوم: <strong>{fmtMoney(t.procedures)}</strong><ExcludedNote n={t.excluded} /></p>
    </>
  )
}
function ReferralsTable({ rows, all, attendance }) {
  const t = extraTotals(all)
  return (
    <>
      <table className="rtable">
        <thead><tr><th>الدور</th><th>الاسم</th><th>الجهة</th><th>الخصم</th><th>المطلوب من المريض</th><th>الحالة</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <ExtraRow key={a.id} appt={a}>
              <td className="num" data-label="الدور"><TurnCell appt={a} attendance={attendance} /></td>
              <td className="rt-title"><VisitLink appt={a} /></td>
              <td data-label="الجهة">{(a.referrals || []).map((r) => r.source_name).join('، ')}</td>
              <td className="num" data-label="الخصم" style={{ whiteSpace: 'nowrap' }}>{fmtMoney(a.referral_discount)}</td>
              <td className="num" data-label="المطلوب من المريض" style={{ whiteSpace: 'nowrap' }}><strong>{fmtMoney(a.patient_total)}</strong></td>
              <td className="rt-badge">{appointmentBadge(a.status, true)}</td>
            </ExtraRow>
          ))}
        </tbody>
      </table>
      <p className="queue-extra-total">إجمالي خصومات الإحالات اليوم: <strong>{fmtMoney(t.discounts)}</strong><ExcludedNote n={t.excluded} /></p>
    </>
  )
}

// ═══ قائمة الدور بتبويبات: الحضور · بانتظار الحضور · انتهى · ما حضر ═══
// التبويب والبحث في العنوان (?tab=&q=) لا في حالةٍ محلّية: الرجوع من صفحة الزيارة يعيدهما
// كما كانا (والموضع من useRestoreScroll)، ورابطٌ منسوخ يفتح على التبويب نفسه.
const TAB_HINTS = {
  attendance: {
    present: <>رقم الدور يُعطى عند <strong>الحضور</strong> (١، ٢، ٣…) ولا يتغيّر، والنداء بترتيبه —
      الإسعافي الحاضر أولاً. تحته صغيراً: رقم الحجز والوقت التقريبي.</>,
    pending: <>محجوزون لم يحضروا بعد، بترتيب وقت الحجز. لا يظهرون للطبيب ولا يوقفون أحداً —
      وعند الإقفال يقرّر الاستقبال لكلٍّ منهم.</>,
  },
  slots: {
    present: <>مرتَّب بترتيب الخدمة الفعلي: أصحاب الأولوية أولاً ثم بقية الأدوار.
      <strong> رقم الدور لا يتغير</strong> عند دخول حالة فورية — يتغيّر الوقت فقط، ويظهر أدناه أصله ومقدار انزياحه.</>,
    pending: <>محجوزون لم يحضروا بعد، بترتيب مواعيدهم.</>,
  },
}
const EXTRA_HINTS = {
  procedures: <>كل من عليه إجراءٌ قائم أياً كانت حالته، برقم الدور. المبلغ سعر الإجراءات للمريض قبل خصم الإحالة.</>,
  referrals: <>كل من عليه إحالة أياً كانت حالته، برقم الدور. الخصم الفعليّ لكل الجهات، والمطلوب بعده.</>,
}
function QueueTabsCard({ data, attendance, actions, reload, toast }) {
  const [params, setParams] = useSearchParams()
  const tab = isTab(params.get('tab')) ? params.get('tab') : DEFAULT_TAB
  const query = params.get('q') || ''
  const searching = query.trim() !== ''
  const update = (patch) => setParams((p) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    if (n.get('tab') === DEFAULT_TAB) n.delete('tab')
    return n
  }, { replace: true })

  const counts = tabCounts(data.appointments, query)
  const tabRows = rowsOfTab(data.appointments, tab, attendance)
  const rows = tabRows.filter((a) => matchesQuery(a, query))
  const current = QUEUE_TABS.find((t) => t.key === tab)
  // البحث لم يجد شيئاً هنا لكنّه وجد في تبويبٍ آخر — نقول أين
  const elsewhere = searching && rows.length === 0
    ? QUEUE_TABS.filter((t) => t.key !== tab && t.key !== 'all' && counts[t.key].matched > 0) : []
  const hint = EXTRA_HINTS[tab] || TAB_HINTS[attendance ? 'attendance' : 'slots'][tab]

  return (
    <div className="card queue-tabs-card">
      <div className="queue-tabs-head">
        <div className="queue-tabs" role="tablist" aria-label="حالات الدور">
          {QUEUE_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab} data-tab={t.key}
              className={`queue-tab${t.key === tab ? ' on' : ''}${searching && counts[t.key].matched > 0 ? ' hit' : ''}`}
              onClick={() => update({ tab: t.key })}>
              {tabLabel(t, counts[t.key], searching)}
            </button>
          ))}
        </div>
        <div className="queue-search">
          <input type="search" value={query} aria-label="بحث في قائمة الدور"
            placeholder="بحث: الاسم أو الهاتف أو رقم الدور"
            onChange={(e) => update({ q: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') update({ q: '' }) }} />
          {searching && <button className="queue-search-clear" aria-label="مسح البحث" onClick={() => update({ q: '' })}>×</button>}
        </div>
      </div>
      {hint && !searching && <p className="subtitle queue-tab-hint">{hint}</p>}

      {rows.length === 0 ? (
        <div className="queue-tab-empty">
          {searching ? (
            <>
              <p>ما في نتائج لـ «{query.trim()}» بتبويب «{current.label}».</p>
              {elsewhere.length > 0 && (
                <p>موجود في:{' '}
                  {elsewhere.map((t) => (
                    <button key={t.key} className="ghost queue-tab-jump" onClick={() => update({ tab: t.key })}>
                      {t.label} ({counts[t.key].matched})
                    </button>
                  ))}
                </p>
              )}
              <button className="link-btn" onClick={() => update({ q: '' })}>مسح البحث</button>
            </>
          ) : <p>{data.appointments.length === 0 ? 'لا حجوزات بعد في هذه الجلسة.' : current.empty}</p>}
        </div>
      ) : tab === 'procedures' ? (
        <ProceduresTable data={data} rows={rows} all={tabRows} attendance={attendance} />
      ) : tab === 'referrals' ? (
        <ReferralsTable rows={rows} all={tabRows} attendance={attendance} />
      ) : attendance ? (
        <AttendanceQueueTable data={data} rows={rows} tab={tab} actions={{ ...actions, reload, toast }} />
      ) : (
        <SlotsQueueTable data={data} rows={rows} actions={actions}
          onDone={(msg) => { toast(msg, 'success'); reload() }} onError={(msg) => { toast(msg); reload() }} />
      )}
    </div>
  )
}

// ═══ أفعال الحجز المشتركة: صفّ الطابور ورأس صفحة الزيارة ═══
// منطقٌ واحد في مكانٍ واحد — الحضور بنموذج الإكمال والطباعة التلقائية، والإلغاء بتأكيد،
// والتأجيل والتقديم بنافذتيهما. dialogs تُعرض حيث تُستعمل الأفعال.
export function useVisitActions({ data, load, showToast }) {
  const dlg = useDialogs()
  const attendance = isAttendanceSession(data)

  // ═══ الطباعة التلقائية عند الحضور ═══
  // ثلاثة شروطٍ مجتمعة، وأيّها سقط فلا طباعة ولا ضجيج:
  //   ١) الإعداد العام مفعَّل (مشرف العيادات)
  //   ٢) **هذا الجهاز** معلَّمٌ أنّه يطبع — الاستقبال جهازان وطابعةٌ واحدة
  //   ٣) هذا أوّل حضورٍ للحجز (was_first_arrival من الخادم) — فحاضر ⇐ بانتظار
  //      ⇐ حاضر لا يطبع مرّتين
  // والفشل لا يمسّ الحضور إطلاقاً: الحضور تمّ على الخادم قبل أن نطبع.
  const autoPrint = async (appt, res) => {
    if (!res?.was_first_arrival) return
    if (!data?.auto_print_arrival_ticket) return
    const printer = loadPrinter()
    if (!printer.enabled) return
    // ★ عبر الوسيط المحلّي لا طباعة المتصفّح: طولٌ بالمحتوى، وقطعٌ تلقائيّ،
    // وبلا نافذة. والفشل لا يمسّ الحضور — تمّ على الخادم قبل أن نطبع.
    // نسختان افتراضاً (نسخة المريض ونسخة العيادة) — من «إعداد الطابعة»
    const r = await printViaHelper(ticketFrom({ ...appt, ...res }, data), printer.width,
      undefined, undefined, { copies: printer.copies })
    if (!r.ok) showToast(r.reason === 'الطابعة غير متصلة'
      ? 'حضر المريض — الطابعة غير متصلة'
      : `حضر المريض، لكن تعذّرت طباعة البطاقة${r.reason ? ` (${r.reason})` : ''}`)
  }

  // ★ الحضور لا يُحجب أبداً (قرارٌ مقصود).
  // كان الخادم يرفضه لنقص المعلومات فيقف المريض والموظف يسأله والدور ينتظر.
  // الآن: إن نقص شيء نعرض نموذجاً **اختيارياً** فيه «حفظ وحضر» و«حضر بدون
  // إكمال» — والموظف يقرّر. وإن لم ينقص شيء يمرّ الحضور مباشرةً بلا نموذج.
  const [completing, setCompleting] = useState(null)   // { appt, missing, patient }
  const doArrive = async (apptId, patientPatch) => {
    try {
      const res = await api.clinic.arrive(apptId, patientPatch)
      setCompleting(null); load()
      // بعد load: البطاقة تُبنى من صفّ الطابور قبل التحديث + ردّ الخادم.
      // الطباعة بعد نجاح الحضور دائماً — فلا تُلغيه ولا تؤخّره.
      const appt = data?.appointments?.find((a) => String(a.id) === String(apptId))
      await autoPrint({ ...appt, ...(res?.patient || {}) }, res)
    } catch (ex) { showToast(ex.message); load() }
  }
  const arrive = async (apptId, patientPatch) => {
    if (patientPatch) return doArrive(apptId, patientPatch)   // قادمٌ من النموذج
    const appt = data.appointments.find((a) => String(a.id) === String(apptId))
    const missing = appt ? missingOf(appt) : []
    if (missing.length === 0) return doArrive(apptId)
    setCompleting({
      appt, missing: missing.map((f) => f.key),
      patient: { mobile: appt.mobile, gender: appt.gender, birth_year: appt.birth_year },
    })
  }

  const cancel = async (apptId) => {
    const ok = await dlg.confirm({
      title: 'إلغاء الحجز',
      body: 'إلغاء هذا الحجز؟ يبقى في السجلّ معلَّماً «ملغى».',
      confirmLabel: 'إلغاء الحجز', cancelLabel: 'تراجع', danger: true,
    })
    if (!ok) return
    try { await api.clinic.updateAppointment(apptId, { status: 'cancelled' }); load() }
    catch (ex) { showToast(ex.message); load() }
  }

  // ── تأجيل موعد إلى جلسة أخرى ──
  // المريض جاء والدكتور غائب، أو تجاوز دوره نهاية الدوام. ننقل موعده بدل أن
  // يبقى معلّقاً في جلسة انتهت. الخادم ينشئ الحجز الجديد بنفس قواعد الحجز.
  const [postponing, setPostponing] = useState(null)   // الحجز المطلوب تأجيله

  const [prioritizing, setPrioritizing] = useState(null)   // الحجز المطلوب تقديمه
  const prioritize = (apptId) =>
    setPrioritizing(data.appointments.find((a) => String(a.id) === String(apptId)) || null)

  const dialogs = (
    <>
      {completing && (
        <CompletePatientForm
          appt={completing.appt}
          missing={completing.missing}
          patient={completing.patient}
          attendance={attendance}
          onCancel={() => setCompleting(null)}
          onSubmit={(patch) => arrive(completing.appt.id, patch)}
        />
      )}

      {prioritizing && (
        <PriorityPicker
          appt={prioritizing}
          attendance={attendance}
          onClose={() => setPrioritizing(null)}
          onArrived={autoPrint}
          onDone={load}
        />
      )}

      {postponing && (
        <PostponeDialog
          appt={postponing}
          currentSessionId={data?.id}
          showTicket={!!data?.show_booking_ticket}
          attendance={attendance}
          onSuccessToast={(msg) => showToast(msg, 'success', 4000)}
          onClose={() => setPostponing(null)}
          onDone={() => { setPostponing(null); load() }}
        />
      )}
    </>
  )
  return { autoPrint, arrive, cancel, prioritize, setPostponing, dialogs }
}

// أزرار الصفّ: تقديم · حضر · إلغاء · تأجيل · (المشرف: خروج مؤقت/نداء العودة) — بشروطها كما كانت
export function VisitActions({ appt: a, data, actions, onDone, onError }) {
  const { arrive, cancel, prioritize, setPostponing } = actions
  const btn = { padding: '3px 10px', fontSize: 11.5 }
  return (
    <>
      {/* الترقية طريقٌ آخر إلى أثر الإسعافي، فتختفي بنفس الشرط */}
      {['waiting', 'arrived'].includes(a.status) && a.priority === 'normal'
        && data.accepts_urgent !== false && (
        <button className="ghost" style={btn} onClick={() => prioritize(a.id)}>تقديم</button>
      )}{' '}
      {/* فجوةٌ حقيقية بين الأزرار: «حضر» و«إلغاء» كانا متلاصقَين فيُضغط الخطأ منهما بسهولة */}
      {a.status === 'waiting' && (
        <>
          <button className="ghost" style={btn} onClick={() => arrive(a.id)}>حضر</button>{' '}
          <button className="ghost" style={btn} onClick={() => cancel(a.id)}>إلغاء</button>
        </>
      )}{' '}
      {/* التأجيل متاح لكل من لم يُخدَم بعد — لا لمن تجاوز الدوام وحده */}
      {['waiting', 'arrived'].includes(a.status) && (
        <button className="ghost" style={btn} onClick={() => setPostponing(a)}>تأجيل</button>
      )}{' '}
      <SupervisorReturnActions appt={a} onDone={onDone} onError={onError} />
    </>
  )
}

// ═══ فتح صفحة الزيارة ═══
// كانت التفاصيل سطراً ينفتح تحت الصفّ فيطول الجدول ويضيع. الآن صفحةٌ كاملة،
// والرجوع منها يعيد الموظف إلى موضعه في الطابور (useRestoreScroll).
const visitPath = (a) => `/clinic/session/${a.session_id}/visit/${a.id}`
const scrollKey = (sessionId) => `queue-scroll:${sessionId}`
function useOpenVisit() {
  const navigate = useNavigate()
  const location = useLocation()
  return (a) => {
    try { sessionStorage.setItem(scrollKey(a.session_id), String(window.scrollY)) } catch { /* تخزينٌ محجوب — يعود لأعلى الصفحة */ }
    navigate(visitPath(a), { state: { from: location.pathname + location.search } })
  }
}
function OpenVisit({ appt }) {
  const open = useOpenVisit()
  return <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => open(appt)}>تفاصيل</button>
}
// الاسم نفسه رابطٌ للزيارة — «بكبسة على الحجز». <a> حقيقي فيعمل الفتح في لسانٍ جديد أيضاً
function VisitLink({ appt }) {
  const open = useOpenVisit()
  return (
    <a className="visit-link" href={visitPath(appt)}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault(); open(appt)
      }}>{appt.full_name}</a>
  )
}
// يعيد موضع التمرير مرّةً واحدة بعد أوّل تحميل — حين يعود الموظف من صفحة الزيارة
function useRestoreScroll(sessionId, ready) {
  useEffect(() => {
    if (!ready) return
    let y = null
    try { y = sessionStorage.getItem(scrollKey(sessionId)); sessionStorage.removeItem(scrollKey(sessionId)) } catch { /* لا شيء */ }
    if (y != null) requestAnimationFrame(() => window.scrollTo(0, Number(y) || 0))
  }, [sessionId, ready])
}

export default function SessionQueue() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  // ★ الخطأ لا يستبدل الشاشة: loadErr لأوّل تحميل فقط (ومعه «إعادة المحاولة»)، وبعده
  // إشعارٌ عابر والطابور الأخير باقٍ — انقطاعٌ في التحديث الدوري كان يُفرغ الصفحة حتى
  // يُعيد الموظف تحميلها بيده. وأخطاء الأزرار إشعارٌ لا alert() يوقف الشاشة.
  const [loadErr, setLoadErr] = useState(null)
  const [toast, showToast] = useToast()
  const [ticket, setTicket] = useState(null)
  const [recalled, setRecalled] = useState(null)   // وقت آخر إعادة نداء — تأكيدٌ مرئي للموظف
  const [bookingOpen, setBookingOpen] = useState(null)   // نمط الحضور: null | 'normal' | 'urgent'

  // بعد الحجز: بطاقة الدور للطباعة إن فُعّل الإعداد، وإلا عودةٌ إلى الطابور برسالة قصيرة.
  // الرموز وُلّدت وخُزّنت في الحالتين — هذا عرضٌ فقط (رمز الوصول في تفاصيل الحجز).
  const afterBooked = (appt) => {
    // الحجز الفوري الحضوري يُنشأ «حاضراً» بحكم تعريفه (المريض واقفٌ أمام
    // الموظف) — فهو مسار حضورٍ أيضاً، وبطاقته تُطبع كبقيّة الحضور.
    if (appt?.status === 'arrived') autoPrint(appt, { was_first_arrival: true })
    if (data?.show_booking_ticket) { setTicket(appt); return }
    // نمط الحضور: لا رقم دور عند الحجز — رقم الحجز والوقت التقريبي (ورقم الدور إن حضر
    // فوراً: الإسعافي الحضوري). أطول بقاءً: الموظف ينقل الوقت للمريض على الهاتف.
    if (attendance) showToast(attendanceBookedMessage(appt), 'success', 9000)
    else showToast(`تم الحجز — الدور ${appt.queue_number}`, 'success', 4000)
    load()
  }

  const load = () => api.clinic.queue(id).then((d) => { setData(d); setLoadErr(null) })
    .catch((e) => {
      if (data) showToast(`تعذّر تحديث قائمة الدور — يُعاد المحاولة تلقائياً (${e.message})`)
      else setLoadErr(e.message)
    })
  useEffect(() => { load() }, [id])

  // نمط الحضور: الطبيب ينادي ويُنهي من شاشته — تحديث دوري كي لا يرى الاستقبال طابوراً قديماً.
  // نمط الخانات يبقى كما كان (بلا تحديث دوري).
  const attendance = isAttendanceSession(data)
  usePolling(load, attendance)
  // فوريّ: خروجٌ مؤقت أو نداء عودة أو حضور من جهازٍ آخر يظهر هنا بلا انتظار التحديث الدوري
  useStaffEvents(id, load)

  // الحضور والإلغاء والتأجيل والتقديم والطباعة التلقائية — مشتركةٌ مع صفحة الزيارة
  const actions = useVisitActions({ data, load, showToast })
  const { autoPrint } = actions
  useRestoreScroll(id, !!data)

  // إعادة النداء: الاستقبال يرى المريض لا يتحرّك — يُعاد بثّ النداء بلا تغيير حالته.
  // الخادم يخنقها مرّة كل عشر ثوانٍ لكل حجز، فالزرّ (RecallButton) معطَّل طوال المدّة بعدّاد.
  if (!data) return loadErr ? (
    <div className="load-failed">
      <p className="error">{loadErr}</p>
      <button className="ghost" onClick={load}>إعادة المحاولة</button>
    </div>
  ) : <p className="empty">جارٍ التحميل…</p>

  if (ticket) return <TicketPrint appt={ticket} doctorName={data.doctor_name} attendance={attendance} onDone={() => { setTicket(null); load() }} />

  return (
    <>
      <h2 className="queue-head">دور {data.doctor_name}<RoomBadge room={data.room} size="lg" /><FlowModeTag mode={data.flow_mode} /></h2>
      <p className="subtitle">
        {data.specialty || '—'} · {fmtTime(data.start_time)} – {fmtTime(data.end_time)} ·
        مدة الكشف المتوقعة {data.expected_visit_minutes} دقيقة ·
        معاينة {fmtMoney(data.consultation_fee)} · مراجعة {fmtMoney(data.followup_fee)}
        {' '}(خلال {data.followup_window_days} أيام) ·
        الإيراد المتوقع {fmtMoney(data.expected_revenue)}
        {/* يشمل الإجراءات — للعرض وحده، لا يُكتب في الخزينة */}
      </p>

      {toast}

      <FlowModeMismatch data={data} onChanged={load} onError={showToast} />

      {attendance ? (
        <>
          {/* صفٌّ واحد من اليمين: حجز دور · قيد الكشف الآن · وصول الطبيب.
              يتكدّس عمودياً على الشاشات الضيّقة (CSS) */}
          <div className="attn-top-row">
            <AttendanceBookingCard acceptsUrgent={data.accepts_urgent !== false}
              open={bookingOpen} onOpen={setBookingOpen} />
            <AttendanceCurrentCard current={data.appointments.find((a) => a.status === 'in_service')}
              returning={waitingReturnOf(data.appointments)}
              recalled={recalled} onRecalled={() => setRecalled(Date.now())} onError={showToast} />
            <DoctorArrivalCard data={data} onChanged={load} onError={showToast} />
          </div>
          <AttendanceBookingForm
            sessionId={id}
            fees={{ consultation_fee: data.consultation_fee, followup_fee: data.followup_fee }}
            open={bookingOpen}
            onClose={() => setBookingOpen(null)}
            onBooked={afterBooked}
          />
        </>
      ) : (
      <div className="card">
        <h3>حجز دور — خانات اليوم</h3>
        <p className="subtitle" style={{ marginTop: -6, marginBottom: 14 }}>
          الخانات الفاضية متاحة للحجز مباشرة على وقتها. اضغط «احجز» بجانب أي خانة.
        </p>
        <SlotList
          sessionId={id}
          fees={{ consultation_fee: data.consultation_fee, followup_fee: data.followup_fee }}
          acceptsUrgent={data.accepts_urgent !== false}
          onBooked={afterBooked}
        />
      </div>
      )}

      {/* المريض الحالي وزر إعادة النداء — الاستقبال هو من يرى المريض لا يتحرّك.
          (نمط الحضور يعرضه في صفّ البطاقات أعلاه — هذه بطاقة نمط الخانات كما هي) */}
      {!attendance && (() => {
        const current = data.appointments.find((a) => a.status === 'in_service')
        if (!current) return null
        return (
          <div className="card highlight">
            <div className="action-row">
              <div>
                <h3 style={{ marginBottom: 4 }}>قيد الكشف الآن</h3>
                <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)' }}>
                  الدور {current.queue_number}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{current.full_name}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <RecallButton apptId={current.id} onError={showToast} onDone={() => setRecalled(Date.now())}
                  style={{ padding: '12px 20px', fontSize: 15 }} />
                {recalled && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>
                    أُعيد النداء {new Date(recalled).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ═══ من تجاوز الدوام ═══
          خانته NULL **وسببه** session_overflow — والسبب هو المميّز: الحاضر بلا موعد
          محدد خانته NULL أيضاً ولم يتجاوز شيئاً. لا إلغاء تلقائي: يبقى في الطابور
          حتى يقرّر إنسان، وله زرّ التأجيل. */}
      {(() => {
        const overflowed = data.appointments.filter((a) =>
          ['waiting', 'arrived'].includes(a.status) && !a.slot_time &&
          (a.delays || []).some((d) => d.cause === 'session_overflow'))
        if (overflowed.length === 0) return null
        return (
          <div className="card overflow-card">
            <h3>⏰ تجاوزوا وقت الدوام ({overflowed.length})</h3>
            <p className="subtitle" style={{ marginTop: -6 }}>
              انزاحت مواعيدهم إلى ما بعد نهاية الدوام ففقدوا خانتهم الزمنية.
              <strong> ما زالوا في قائمة الدور</strong> ويُنادى عليهم إن فرغ الدكتور —
              أو أجّل موعدهم إلى جلسة أخرى.
            </p>
            <table className="rtable">
              <thead><tr><th>الدور</th><th>الاسم</th><th>الموبايل</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {overflowed.map((a) => (
                  <tr key={a.id}>
                    <td className="num" data-label="الدور">{a.queue_number}</td>
                    <td className="rt-title">{a.full_name}</td>
                    <td data-label="الموبايل"><bdi dir="ltr">{a.mobile}</bdi></td>
                    <td className="rt-badge">{appointmentBadge(a.status)}</td>
                    <td className="rt-actions">
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                        onClick={() => actions.setPostponing(a)}>تأجيل لموعد آخر</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {actions.dialogs}

      <QueueTabsCard data={data} attendance={attendance} actions={actions} reload={load}
        toast={(msg, kind) => showToast(msg, kind, kind === 'success' ? 3500 : 6000)} />
    </>
  )
}
