// ═══ صفحة الزيارة — /clinic/session/:sessionId/visit/:id ═══
// كانت «تفاصيل الحجز» سطراً ينفتح تحت صفّ الطابور، ثمّ كبرت (بيانات، إجراءات ومواد،
// إحالتان، مبالغ، سجل) حتى صار يطول داخل الجدول ولا يُقرأ. الآن صفحةٌ ببطاقات:
//   المطلوب من المريض · بيانات المريض  |  الإجراءات · الإحالات  — والسجل مطويّاً تحتها.
// إعادة تنظيمٍ للعرض لا للمنطق: البيانات من مسار الطابور نفسه (/queue) فلا حقل جديد ولا
// صلاحية جديدة، والأقسام هي مكوّنات اللوحة القديمة كما هي.
import { Fragment, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useDialogs } from '../dialogs.jsx'
import { loadPrinter, printTicket, ticketFrom, MAX_COPIES } from '../ticket-print.js'
import { printViaHelper } from '../print-helper.js'
import { api, APPOINTMENT_STATUSES, BOOKING_TYPES, VISIT_TYPES, PRIORITIES, fmtMoney, toLatinDigits } from '../api.js'
import { isAttendanceSession, usePolling, fmtClock, turnLabel, fmtTimeOfDay } from '../attendance-ui.jsx'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { canEditAppointmentProcedures, canEditBooking, canEditReferral } from '../permissions.js'
import { WAITING_RETURN, serverOffsetOf, useStaffEvents } from '../waiting-return.jsx'
import { ReferralRow, ReferralTotals, useReferralOptions } from '../components/ReferralFields.jsx'
import { DISCOUNT_SCOPES, amountText, availableScopes, blankReferral, coverageFull, draftDiscount, draftFromReferral,
  referralPayload, referralReady } from '../referral.js'
import MaterialsEditor, { qtyValid, toPayload, fmtQty, materialsSummary } from '../components/MaterialsEditor.jsx'
import RoomBadge from '../components/RoomBadge.jsx'
import { MissingBadge, StatusCell, VisitActions, missingOf, priorityBadge, useVisitActions } from './SessionQueue.jsx'

// ═══ رأس الصفحة — ثابتٌ مع التمرير ═══
// الرقم كبيراً (هو ما يُنادى به)، والاسم والحالة، والعيادة والدكتور، وأزرار الصفّ نفسها.
function VisitHeader({ appt, data, actions, onBack, onDone, onError }) {
  const attendance = isAttendanceSession(data)
  // نمط الحضور: رقم الدور يُعطى عند الحضور — قبله «—» ورقم الحجز تحته صغيراً
  const num = attendance ? (appt.arrival_number ?? '—') : appt.queue_number
  return (
    <header className="card visit-head">
      <button className="ghost visit-back" onClick={onBack} aria-label="رجوع">→ رجوع</button>
      <div className="visit-num" title={attendance && appt.arrival_number == null ? 'لم يحضر بعد — لا رقم دور' : undefined}>
        <span className="visit-num-label">الدور</span>
        <span className="visit-num-main">{num}</span>
        {attendance && <span className="visit-num-ref">حجز {appt.queue_number}</span>}
      </div>
      <div className="visit-who">
        <h2>
          {appt.full_name}
          <StatusCell appt={appt} offset={serverOffsetOf(data)} />
          {priorityBadge(appt.priority)}
        </h2>
        <p className="visit-where">
          {data.doctor_name}{data.specialty ? ` · ${data.specialty}` : ''}
          <RoomBadge room={data.room} />
        </p>
      </div>
      <div className="visit-head-actions queue-row-actions">
        <VisitActions appt={appt} data={data} actions={actions} onDone={onDone} onError={onError} />
      </div>
    </header>
  )
}

// ═══ المطلوب من المريض — أهمّ رقمٍ للاستقبال ═══
// كلّه من الخادم (patient_total بعد خصم الإحالات) — لا حساب في الواجهة.
// للعرض وحده: لا شيء يُكتب في الخزينة.
function PaymentCard({ appt, session, onToast }) {
  const { role } = useRole()
  const live = (appt.procedures || []).filter((l) => !l.removed_at)
  const refs = appt.referrals || []
  const final = appt.patient_total ?? appt.total ?? appt.fee
  const dayOk = role === 'clinic_admin' || session.session_day === session.server_today
  // إعادة الطباعة بشرط لوحة التفاصيل القديمة نفسه
  const canReprint = canEditBooking(role) && appt.status !== 'postponed' && dayOk
  const note = appt.status === 'cancelled' ? 'الحجز ملغى.'
    : appt.status === 'no_show' ? 'لم يحضر.'
    : appt.status === 'postponed' ? 'أُجّل — المبلغ على الحجز الجديد.' : null
  return (
    <section className="card visit-pay">
      <h3>المطلوب من المريض</h3>
      <table>
        <tbody>
          <tr><td>رسم الكشف ({VISIT_TYPES[appt.visit_type] || 'زيارة'})</td><td className="num">{fmtMoney(appt.fee)}</td></tr>
          <tr>
            <td>الإجراءات {live.length > 0 && <span className="muted">({live.length})</span>}</td>
            <td className="num">{live.length ? fmtMoney(appt.procedures_total) : <span className="muted">لا إجراءات</span>}</td>
          </tr>
          {refs.map((r) => (
            <tr key={r.id} className="visit-pay-disc">
              <td>خصم إحالة — {r.source_name}<span className="visit-pay-sub">{DISCOUNT_SCOPES[r.discount_scope]}</span></td>
              <td className="num">−{fmtMoney(r.actual_discount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="visit-pay-final">
        <span>المبلغ النهائي</span>
        <strong>{fmtMoney(final)}</strong>
      </div>
      {refs.length > 0 && appt.referral_discount > 0 && (
        <p className="visit-pay-was">قبل الخصم <s>{fmtMoney(appt.total ?? appt.fee)}</s></p>
      )}
      {note && <p className="visit-empty">{note}</p>}
      {canReprint && <ReprintButton appt={appt} session={session} onToast={onToast} />}
    </section>
  )
}

// إعادة الطباعة تتجاهل الإعداد العام وأوّل الحضور (طلبٌ صريح)، لكنّها
// تحترم «هذا الجهاز يطبع»: جهازٌ بلا طابعة لا يُجدي ضغطُ الزرّ فيه.
// متاحةٌ دائماً — بطاقةٌ ضاعت، أو إجراءاتٌ أُضيفت بعد الحضور فصار المبلغ غير ما طُبع.
function ReprintButton({ appt, session, onToast }) {
  const dlg = useDialogs()
  const [reprinting, setReprinting] = useState(false)
  const reprint = async () => {
    const printer = loadPrinter()
    if (!printer.enabled) {
      onToast('هذا الجهاز غير معلَّمٍ للطباعة — فعّله من «إعداد الطابعة»')
      return
    }
    // كم نسخة؟ واحدة افتراضاً — الإعادة غالباً بطاقةٌ ضاعت من المريض
    const answer = await dlg.prompt({
      title: 'طباعة البطاقة',
      body: `كم نسخة؟ (من ١ إلى ${MAX_COPIES.toLocaleString('ar-SY')})`,
      defaultValue: '1', confirmLabel: 'طباعة', required: true,
    })
    if (answer == null) return
    const copies = Math.round(Number(toLatinDigits(answer)))
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
      onToast(`عدد النسخ بين ١ و${MAX_COPIES.toLocaleString('ar-SY')}`)
      return
    }
    setReprinting(true)
    try {
      const r = await printViaHelper(ticketFrom(appt, session), printer.width,
        undefined, undefined, { copies })
      if (r.ok) return
      // ★ الاحتياط لإعادة الطباعة وحدها (طلبٌ صريح من الموظف): لو كان
      // الوسيط متوقّفاً تبقى طباعة المتصفّح طريقاً — بنافذةٍ وورقٍ أطول،
      // لكنّها أفضل من «لا شيء» حين يطلبها المريض.
      const fb = await printTicket(ticketFrom(appt, session), printer.width, undefined, { copies })
      onToast(fb.ok
        ? 'الوسيط غير متصل — طُبعت من المتصفّح (قد يزيد الورق)'
        : `تعذّرت الطباعة${fb.reason ? ` (${fb.reason})` : ''}`)
    } finally { setReprinting(false) }
  }
  return (
    <button className="ghost visit-reprint" disabled={reprinting} onClick={reprint}>
      {reprinting ? 'جارٍ الطباعة…' : '🖨 طباعة البطاقة'}
    </button>
  )
}

// ═══ بيانات المريض ═══
// قراءةً أولاً، و«تعديل» يفتح نموذج لوحة التفاصيل القديمة كما هو: صفُّ حقولٍ واحد
// بزرٍّ واحد يحفظ كلّ ما تغيّر في طلبٍ واحد ذرّيّ.
const GENDERS = { male: 'ذكر', female: 'أنثى' }
function PatientCard({ appt, session, onChanged, onToast, onArrived }) {
  const dlg = useDialogs()
  const { role } = useRole()
  const [busy, setBusy] = useState(false)
  const [editingForm, setEditingForm] = useState(false)
  const [swap, setSwap] = useState(false)

  const base = () => ({
    full_name: appt.full_name || '', mobile: appt.mobile || '',
    gender: appt.gender || '', birth_year: appt.birth_year || '',
    visit_type: appt.visit_type, priority: appt.priority || 'normal',
    status: appt.status,
    // ملاحظة الحجز نفسها (عمود reason) — حقلٌ كغيره: يبدأ بقيمته ويدخل فحص التغيير
    reason: appt.reason || '',
  })
  const [form, setForm] = useState(base)
  useEffect(() => { setForm(base()) }, [appt.id, appt.full_name, appt.mobile,
    appt.gender, appt.birth_year, appt.visit_type, appt.priority, appt.status, appt.reason]) // eslint-disable-line
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const dayOk = role === 'clinic_admin' || session.session_day === session.server_today
  const editable = canEditBooking(role) && appt.status !== 'postponed' && dayOk
  // الملغى: حالتُه وحدها تُغيَّر (طريق استعادته)، وبياناته مجمَّدة
  const fieldsFrozen = appt.status === 'cancelled'

  const dirty = () => {
    const b = base(), d = {}
    for (const k of Object.keys(b))
      if (String(form[k] ?? '') !== String(b[k] ?? '')) d[k] = form[k]
    return d
  }
  const changes = dirty()
  const hasChanges = Object.keys(changes).length > 0

  const save = async () => {
    const d = { ...changes }
    if (Object.keys(d).length === 0) return
    // التأكيد باسم المريض: الإلغاء و«لم يحضر» يُخرجانه من الطابور
    if (['cancelled', 'no_show'].includes(d.status)) {
      const who = `${turnLabel(appt, isAttendanceSession(session))}${appt.full_name ? ` (${appt.full_name})` : ''}`
      const what = d.status === 'cancelled' ? 'إلغاء حجز' : 'تعليم «لم يحضر» لـ'
      const ok = await dlg.confirm({
        title: d.status === 'cancelled' ? 'إلغاء الحجز' : 'تعليم «لم يحضر»',
        body: `${what} ${who}؟`,
        confirmLabel: d.status === 'cancelled' ? 'إلغاء الحجز' : 'لم يحضر',
        cancelLabel: 'تراجع', danger: true,
      })
      if (!ok) return
    }
    if (d.reason !== undefined) d.reason = d.reason.trim()
    setBusy(true)
    try {
      const r = await api.clinic.saveAppointmentDetails(appt.id, d)
      onToast(r?.message || 'حُفظت التعديلات', 'success'); onChanged()
      setEditingForm(false)
      // «بانتظار الحضور» ⇒ «حاضر» من هذه اللوحة مسارُ حضورٍ كغيره.
      // was_first_arrival من الخادم يمنع الطباعة الثانية عند التبديل ذهاباً وإياباً.
      if (r?.was_first_arrival && onArrived) onArrived({ ...appt, ...(r || {}) }, r)
    } catch (ex) { onToast(ex.message) } finally { setBusy(false) }
  }

  const missing = missingOf(appt)
  const age = appt.birth_year ? Number(String(session.server_today).slice(0, 4)) - Number(appt.birth_year) : null
  const facts = [
    ['الاسم الثلاثي', appt.full_name],
    ['العمر', age != null && age >= 0 ? <>{age} سنة <span className="muted">({appt.birth_year})</span></> : null],
    ['الجنس', GENDERS[appt.gender]],
    ['الموبايل', appt.mobile ? <span dir="ltr">{appt.mobile}</span> : null],
    ['نوع الزيارة', <>{VISIT_TYPES[appt.visit_type] || appt.visit_type}
      {appt.followup_override_by && (
        <span className="badge warn sm" style={{ marginInlineStart: 6 }} title={appt.followup_override_reason || ''}>تجاوز</span>
      )}</>],
    ['الأولوية', PRIORITIES[appt.priority] || 'عادي'],
  ]
  const info = [
    // نمط الحضور: رقم الحجز والوقت التقريبي المُعطى عنده (رقم الدور في الرأس)
    ...(isAttendanceSession(session) ? [
      ['رقم الحجز', String(appt.queue_number), null],
      ['الوقت التقريبي', fmtTimeOfDay(appt.estimated_time), 'ltr'],
    ] : []),
    // رمز الوصول هنا دائماً: حين تُعطَّل بطاقة الحجز لا يُعرض الرمز في أي مكان آخر،
    // والمريض قد يطلبه لاحقاً لمتابعة دوره من «دوري».
    ['رمز الوصول', appt.access_code, 'ltr'],
    // رمز البطاقة يظهر حين تكون البطاقة مفعَّلة فقط — وإلّا فهو سطرٌ بلا معنى
    ...(session.show_booking_ticket && appt.ticket_code ? [['رمز البطاقة', appt.ticket_code, 'ltr']] : []),
    ['طريقة الحجز', BOOKING_TYPES[appt.booking_type] || appt.booking_type, null],
    ['وقت الحجز', appt.booked_at ? fmtClock(appt.booked_at) : '—', 'ltr'],
    ['وقت الحضور', appt.arrived_at ? fmtClock(appt.arrived_at) : '—', 'ltr'],
  ]

  return (
    <section className="card visit-patient">
      <h3 className="visit-card-head">
        بيانات المريض <MissingBadge appt={appt} />
        {editable && !editingForm && (
          <button className="ghost visit-card-btn" onClick={() => { setForm(base()); setEditingForm(true) }}>تعديل</button>
        )}
      </h3>

      {editingForm ? (
        <>
          <div className="ad-fields">
            <label>الاسم الثلاثي
              <input value={form.full_name} onChange={set('full_name')} disabled={fieldsFrozen} /></label>
            <label>الموبايل
              <input value={form.mobile} onChange={set('mobile')} dir="ltr" disabled={fieldsFrozen} /></label>
            <label>الجنس
              <select value={form.gender} onChange={set('gender')} disabled={fieldsFrozen}>
                <option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option>
              </select></label>
            <label>سنة الميلاد
              <input value={form.birth_year} onChange={set('birth_year')} dir="ltr" disabled={fieldsFrozen} /></label>
            <label>نوع الزيارة
              <select value={form.visit_type} onChange={set('visit_type')} disabled={fieldsFrozen}>
                {Object.entries(VISIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label>الأولوية
              <select value={form.priority} onChange={set('priority')} disabled={fieldsFrozen}>
                <option value="normal">عادي</option><option value="urgent">إسعافي</option>
                <option value="elderly">كبير بالعمر</option><option value="infant">رضيع</option>
              </select></label>
            <label>الحالة
              <select value={form.status} onChange={set('status')}>
                {/* «بانتظار العودة» لا يُختار من هنا (الطبيب وحده يُخرج مريضه) — يظهر خياراً
                    فقط حين يكون هو الحالة الحالية، فتُقرأ القائمة صحيحة ويُخرَج منها */}
                {Object.entries(APPOINTMENT_STATUSES)
                  .filter(([k]) => k !== WAITING_RETURN || appt.status === WAITING_RETURN)
                  .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label className="ad-note">ملاحظة الحجز (اختيارية)
              <input value={form.reason} onChange={set('reason')} disabled={fieldsFrozen} /></label>
          </div>
          <div className="ad-actions">
            <button disabled={busy || !hasChanges} onClick={save}>حفظ التعديلات</button>
            <button className="ghost" disabled={busy} onClick={() => { setForm(base()); setEditingForm(false) }}>إلغاء</button>
            {missing.length > 0 && <span className="ad-missing">ينقص: {missing.map((f) => f.label).join('، ')}</span>}
          </div>
        </>
      ) : (
        <>
          <dl className="appt-details-grid visit-facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></div>
            ))}
            <div className="visit-facts-wide">
              <dt>ملاحظة الحجز</dt>
              <dd>{appt.reason || <span className="muted">لا ملاحظة</span>}</dd>
            </div>
          </dl>
          {/* البيانات الناقصة: سطرٌ يقول ما ينقص وزرٌّ يفتح النموذج عليه */}
          {missing.length > 0 && editable && !fieldsFrozen && (
            <p className="visit-empty">
              ينقص: {missing.map((f) => f.label).join('، ')}{' '}
              <button className="link-btn" onClick={() => { setForm(base()); setEditingForm(true) }}>أكمل البيانات</button>
            </p>
          )}
        </>
      )}

      <div className="ad-info visit-info">
        {info.map(([k, v, d]) => (
          <span key={k}><b>{k}</b> <span dir={d || undefined}>{v || '—'}</span></span>
        ))}
      </div>

      {!editable && (
        <p className="ad-readonly">
          {appt.status === 'postponed' ? 'الحجز مؤجَّل — عدّل الحجز الجديد.'
            : !canEditBooking(role) ? 'للاطّلاع فقط.'
            : 'التعديل في يوم الجلسة فقط — راجِع مشرف العيادات.'}
        </p>
      )}

      {editable && !fieldsFrozen && (
        <div className="ad-links">
          <button className="link-btn" onClick={() => setSwap((v) => !v)}>تغيير المريض</button>
        </div>
      )}
      {swap && <SwapPatient appt={appt} onToast={onToast}
        onDone={() => { setSwap(false); onChanged() }} onCancel={() => setSwap(false)} />}
    </section>
  )
}

// ═══ السجل — مطويٌّ افتراضياً، ويُحمَّل حين يُفتح ═══
function HistoryCard({ appt, session, onToast }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card visit-history">
      <h3 className="visit-card-head">
        <button className="visit-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="visit-fold-icon" aria-hidden="true">{open ? '▾' : '◂'}</span> سجل التعديلات
        </button>
      </h3>
      {open
        ? <BookingHistory appt={appt} session={session} onToast={onToast} />
        : <p className="visit-empty">من غيّر ماذا ومتى على هذه الزيارة — اضغط العنوان لعرضه.</p>}
    </section>
  )
}

export default function VisitPage() {
  const { sessionId, id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [toast, showToast] = useToast()
  const toastFor = (msg, kind) => showToast(msg, kind, kind === 'success' ? 3500 : 6000)

  // البيانات من مسار الطابور نفسه — الحقول التي كانت تقرؤها اللوحة القديمة بلا زيادة
  const load = () => api.clinic.queue(sessionId).then((d) => { setData(d); setLoadErr(null) })
    .catch((e) => {
      if (data) showToast(`تعذّر تحديث الزيارة — يُعاد المحاولة تلقائياً (${e.message})`)
      else setLoadErr(e.message)
    })
  useEffect(() => { load() }, [sessionId, id]) // eslint-disable-line
  // فوريّ: حالةٌ أو إجراءٌ أو إحالةٌ من جهازٍ آخر — والدوريّ في نمط الحضور شبكة أمان كالطابور
  const attendance = isAttendanceSession(data)
  usePolling(load, attendance)
  useStaffEvents(sessionId, load)

  const actions = useVisitActions({ data, load, showToast })
  // الرجوع إلى حيث جاء (الطابور بموضعه) — ومن رابطٍ مباشر إلى طابور جلسته
  const back = () => (location.state?.from ? navigate(-1) : navigate(`/clinic/session/${sessionId}`))

  if (!data) return loadErr ? (
    <div className="load-failed">
      <p className="error">{loadErr}</p>
      <button className="ghost" onClick={load}>إعادة المحاولة</button>
    </div>
  ) : <p className="empty">جارٍ التحميل…</p>

  const appt = data.appointments.find((a) => String(a.id) === String(id))
  if (!appt) return (
    <div className="card visit-missing">
      <h3>الزيارة غير موجودة في هذه الجلسة</h3>
      <p className="visit-empty">ربما الرابط قديم، أو نُقل الحجز.</p>
      <button className="ghost" onClick={back}>→ رجوع إلى الدور</button>
    </div>
  )

  const liveCount = (appt.procedures || []).filter((l) => !l.removed_at).length
  return (
    <div className="visit-page">
      <VisitHeader appt={appt} data={data} actions={actions} onBack={back}
        onDone={(msg) => { toastFor(msg, 'success'); load() }} onError={(msg) => { toastFor(msg); load() }} />
      {toast}
      {actions.dialogs}

      <div className="visit-grid">
        <div className="visit-col">
          <PaymentCard appt={appt} session={data} onToast={toastFor} />
          <PatientCard appt={appt} session={data} onChanged={load} onToast={toastFor} onArrived={actions.autoPrint} />
        </div>
        <div className="visit-col">
          <section className="card visit-procs">
            <h3>الإجراءات {liveCount > 0 && <span className="muted">({liveCount})</span>}</h3>
            <AppointmentProcedures appt={appt} session={data} onChanged={load} onToast={toastFor} />
          </section>
          <section className="card visit-refs">
            <h3>الإحالات {(appt.referrals || []).length > 0 && <span className="muted">({appt.referrals.length})</span>}</h3>
            <ReferralSection appt={appt} session={data} onChanged={load} onToast={toastFor} />
          </section>
        </div>
      </div>

      <HistoryCard appt={appt} session={data} onToast={toastFor} />
    </div>
  )
}

// ═══ إحالات الزيارة — عند الحجز أو الحضور، وتُعدَّل قبل نهاية يوم الجلسة ═══
// حتى سطرين بلا تداخل: كل سطر الجهة · النوع والقيمة · النطاق · خصمه الفعليّ · تعديل · حذف،
// و«+ إحالة» يختفي حين تكتمل التغطية. الاستقبال في يوم الجلسة، والمشرف أي وقت (الخادم هو
// الحارس). كل حفظٍ يُعيد الخادمُ به الحساب — والطابور يُحدَّث من ردّه لا من حساب الواجهة.
function ReferralSection({ appt, session, onChanged, onToast }) {
  const { role } = useRole()
  const dlg = useDialogs()
  const list = appt.referrals || []
  const [editing, setEditing] = useState(null)   // مسوّدة: جديدة (بلا id) أو تعديل إحالةٍ قائمة
  const [busy, setBusy] = useState(false)
  const { options, err: optionsErr } = useReferralOptions(!!editing)

  const dayOk = role === 'clinic_admin' || session.session_day === session.server_today
  const canEdit = canEditReferral(role) && dayOk && !['cancelled', 'postponed'].includes(appt.status)
  const liveLines = (appt.procedures || []).filter((l) => !l.removed_at)
  const amounts = { fee: appt.fee, lines: liveLines.map((l) => ({ id: l.id, price: l.price })) }
  const original = Number(appt.fee || 0) + liveLines.reduce((s, l) => s + Number(l.price || 0), 0)
  // البطاقة طُبعت قبل التعديل؟ فمبلغها قديم — نقولها صراحةً بدل أن يدفع المريض الأصل
  const printedNote = appt.first_arrived_at ? ' — البطاقة طُبعت قبلها: أعِد طباعتها بالمبلغ الجديد' : ''

  const others = editing ? list.filter((r) => r.id !== editing.id) : list
  const scopes = availableScopes(others.map((r) => r.discount_scope))
  const draft = editing ? draftDiscount(editing, amounts) : null
  // الملخّص الحيّ أثناء التعديل: الإحالات الأخرى بخصمها الفعليّ + المسوّدة بحسابها
  const shownDiscount = editing
    ? others.reduce((s, r) => s + r.actual_discount, 0) + draft.total
    : appt.referral_discount

  const save = async () => {
    setBusy(true)
    try {
      if (editing.id) await api.clinic.updateReferral(appt.id, editing.id, referralPayload(editing))
      else await api.clinic.addReferral(appt.id, referralPayload(editing))
      onToast(`${editing.id ? 'عُدّلت الإحالة' : 'سُجّلت الإحالة'}${printedNote}`, 'success')
      setEditing(null); onChanged()
    } catch (ex) { onToast(ex.message) } finally { setBusy(false) }
  }
  const remove = async (r) => {
    const ok = await dlg.confirm({ title: 'حذف الإحالة',
      body: `حذف إحالة «${r.source_name}» (${DISCOUNT_SCOPES[r.discount_scope]}) عن ${appt.full_name || 'هذا الحجز'}؟`,
      confirmLabel: 'حذف', cancelLabel: 'تراجع', danger: true })
    if (!ok) return
    setBusy(true)
    try { await api.clinic.removeReferral(appt.id, r.id); onToast(`حُذفت الإحالة${printedNote}`, 'success'); onChanged() }
    catch (ex) { onToast(ex.message) } finally { setBusy(false) }
  }

  if (!list.length && !editing && !canEdit) return <p className="visit-empty">لا إحالة على هذه الزيارة.</p>
  const canAdd = canEdit && !editing && !coverageFull(list.map((r) => r.discount_scope))
  return (
    <div className="ad-referral">
      {!list.length && !editing && (
        <p className="visit-empty">لا إحالة على هذه الزيارة — سجّلها إن جاء المريض بورقة إحالة.</p>
      )}
      {list.map((r) => (editing?.id === r.id ? null : (
        <div key={r.id} className="ad-ref-line">
          <span>
            {r.source_name} · {amountText(r)} · {DISCOUNT_SCOPES[r.discount_scope]}
            {r.referral_doc_number && <> · الورقة <span dir="auto">{r.referral_doc_number}</span></>}
            {' · '}خصمها <strong>{fmtMoney(r.actual_discount)}</strong>
            {r.waiting_for_procedures && <span className="ref-waiting"> — ما في إجراءات بعد، رح يتفعّل أوّل ما ينضاف إجراء</span>}
            {r.referral_note && <span className="muted"> — {r.referral_note}</span>}
          </span>
          {canEdit && !editing && (
            <span className="ad-ref-actions">
              <button className="link-btn" disabled={busy} onClick={() => setEditing(draftFromReferral(r))}>تعديل</button>
              <button className="link-btn" disabled={busy} onClick={() => remove(r)}>حذف</button>
            </span>
          )}
        </div>
      )))}
      {editing && (
        <div className="ad-ref-edit">
          <ReferralRow value={editing} onChange={setEditing} scopes={scopes} options={options} optionsErr={optionsErr}
            keep={editing.id ? (() => { const r = list.find((x) => x.id === editing.id); return { id: r.referral_source_id, name: r.source_name } })() : null}
            discount={draft} disabled={busy} />
          <div className="ad-actions">
            <button disabled={busy || !referralReady(editing)} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإحالة'}</button>
            <button className="ghost" disabled={busy} onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      )}
      {canAdd && (
        <button className="ghost ref-add" onClick={() => setEditing(blankReferral(availableScopes(list.map((r) => r.discount_scope))[0]))}>
          + إحالة</button>
      )}
      {(list.length > 0 || editing) && <ReferralTotals original={original} discount={shownDiscount} />}
    </div>
  )
}

// ═══ تغيير المريض — اختير الخطأ عند الحجز ═══
// يُربط هذا الحجز وحده بمريضٍ آخر؛ سجلّ المريض الحالي لا يُمَسّ. بسببٍ إلزامي.
function SwapPatient({ appt, onToast, onDone, onCancel }) {
  const [search, setSearch] = useState('')
  const [found, setFound] = useState(null)
  const [newPt, setNewPt] = useState({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const doSearch = async () => {
    const q = search.trim()
    if (q.length < 2) return
    const digits = toLatinDigits(q).replace(/\D/g, '')
    setBusy(true)
    try {
      const r = await api.clinic.lookupPatientBy(digits.length >= 6 ? { mobile: q } : { full_name: q })
      setFound(r == null ? [] : (r.candidates || [r]))
    } catch (ex) { onToast(ex.message) } finally { setBusy(false) }
  }
  const link = async (body) => {
    setBusy(true)
    try { await api.clinic.changePatient(appt.id, { ...body, reason: reason.trim() })
      onToast('تغيّر المريض', 'success'); onDone() }
    catch (ex) { onToast(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="ad-swap">
      <div className="ad-swap-row">
        <input placeholder="ابحث بالاسم الكامل أو الموبايل…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch() } }} />
        <button className="ghost" disabled={busy} onClick={doSearch}>بحث</button>
        <input placeholder="سبب التغيير (إلزامي)…" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="ghost" onClick={onCancel}>إغلاق</button>
      </div>
      {found && found.length > 0 && (
        <ul className="ad-swap-results">
          {found.map((p) => (
            <li key={p.id}>
              <span>{p.full_name} <span dir="ltr" className="muted">{p.mobile || '—'}</span></span>
              <button className="ghost" disabled={busy || reason.trim().length < 3}
                onClick={() => link({ patient_id: p.id })}>اختر</button>
            </li>
          ))}
        </ul>
      )}
      {found && found.length === 0 && <p className="ad-readonly">لا نتائج — أنشئ مريضاً جديداً:</p>}
      <div className="ad-swap-row">
        <input placeholder="اسم مريض جديد (ثلاثي)"
          onChange={(e) => setNewPt((f) => ({ ...f, full_name: e.target.value }))} />
        <input placeholder="موبايله" dir="ltr"
          onChange={(e) => setNewPt((f) => ({ ...f, mobile: e.target.value }))} />
        <button className="ghost" disabled={busy || reason.trim().length < 3 || !newPt.full_name}
          onClick={() => link(newPt)}>إنشاء وربط</button>
      </div>
    </div>
  )
}

// ═══ سجلّ تعديلات الحجز — يُفتح بالضغط لا تلقائياً ═══
const EDIT_FIELD_LABELS = {
  status: 'الحالة', patient_id: 'المريض', visit_type: 'نوع الزيارة', fee: 'الأجر', referral: 'الإحالة',
  priority: 'الأولوية', slot_time: 'الخانة الزمنية',
  'patient.full_name': 'اسم المريض', 'patient.mobile': 'الموبايل',
  'patient.gender': 'الجنس', 'patient.birth_year': 'سنة الميلاد',
  reason: 'ملاحظة الحجز',
}
const EDIT_VALUE_LABELS = {
  ...APPOINTMENT_STATUSES, ...VISIT_TYPES,
  normal: 'عادي', urgent: 'إسعافي', elderly: 'كبير بالعمر', infant: 'رضيع',
  male: 'ذكر', female: 'أنثى',
}
const editValue = (v) => (v == null || v === '' ? '—' : (EDIT_VALUE_LABELS[v] || v))

function BookingHistory({ appt, session, onToast }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    api.clinic.appointmentHistory(appt.id)
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) { setRows([]); onToast(e.message) } })
    return () => { alive = false }
  }, [appt.id]) // eslint-disable-line

  if (!rows) return <p className="ad-readonly">جارٍ التحميل…</p>
  if (rows.length === 0) return <p className="ad-readonly">لا تعديلات على هذا الحجز.</p>
  return (
    <table className="ad-history">
      <tbody>
        {rows.map((h) => (
          <tr key={h.id}>
            <td>{EDIT_FIELD_LABELS[h.field] || h.field}</td>
            <td><span className="muted">{editValue(h.old_value)}</span> ← <strong>{editValue(h.new_value)}</strong></td>
            <td className="muted">
              {h.changed_by_name || '—'} <span dir="ltr">{whenAt(h.changed_at, session.session_day)}</span>
              {h.reason && <em> — {h.reason}</em>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}


// وقت الإضافة/الإزالة: الساعة وحدها إن كانت في يوم الجلسة، وإلا بالتاريخ (تصحيحٌ متأخّر)
const whenAt = (ts, sessionDay) => {
  const day = new Date(ts).toLocaleDateString('en-CA')
  return day === sessionDay ? fmtClock(ts) : `${day} ${fmtClock(ts)}`
}

// ═══ إجراءات الحجز وموادّها ═══
// تُضاف بعد دخول المريض فقط (قيد الكشف أو انتهى). السعر من الكتالوج ولا يُعدَّل هنا.
// الاستقبال في يوم الجلسة وحده، ومسؤول العيادات أي وقت — والخادم هو الحارس، والإخفاء هنا
// يقول السبب بدل زرٍّ يُرفض. الإزالة بسبب إلزامي، والمُزال يبقى ظاهراً مشطوباً بأثره.
//
// ★ المواد: الممرّضة تُملي ما استُعمل، والاستقبال يختاره من الكتالوج كاملاً بكمّيته.
//   إجراءٌ بلا مواد (إيكو) طبيعيّ تماماً. ولا سعر مادة ولا تقسيم هنا — الخادم يحسبهما
//   لحظة الحفظ ولا يرسلهما للاستقبال أصلاً.
function AppointmentProcedures({ appt, session, onChanged, onToast }) {
  const { role } = useRole()
  const [catalog, setCatalog] = useState(null)
  const [matCatalog, setMatCatalog] = useState(null)
  const [pick, setPick] = useState('')
  const [newMats, setNewMats] = useState([])
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)   // id السطر الجاري إزالته
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(null)     // id السطر الجاري تعديل موادّه
  const [editMats, setEditMats] = useState([])
  const lines = appt.procedures || []
  // «بانتظار العودة» دخل على الطبيب ثمّ خرج مؤقتاً — والقطرة نفسها إجراءٌ يُضاف وهو في الصالة
  const entered = ['in_service', WAITING_RETURN, 'done'].includes(appt.status)
  const dayOk = role === 'clinic_admin' || session.session_day === session.server_today
  const canEdit = canEditAppointmentProcedures(role) && entered && dayOk

  useEffect(() => {
    if (!canEdit || catalog) return
    // ═══ الترشيح باختصاص **دكتور الحجز** ═══
    // الاستقبال يضيف لمريض دكتورٍ بعينه، فالقائمة قائمتُه. والخادم يرشّح
    // ويمنع أيضاً — الواجهة تُخفي وحدها لا تحرس.
    // والمشرف يرى الكلّ: قد يضيف خارج الاختصاص لحالةٍ استثنائية، ويُعلَّم السطر.
    const forDoctor = role === 'clinic_admin' ? null : session.doctor_id
    api.clinic.procedures(forDoctor).then((r) => setCatalog(r.filter((p) => p.is_active)))
      .catch((e) => onToast(e.message))
    // كتالوج المواد كاملاً، المفعَّل وحده (المعطَّلة تختفي من البحث)
    api.clinic.materials().then((r) => setMatCatalog(r.filter((m) => m.is_active !== false)))
      .catch((e) => onToast(e.message))
  }, [canEdit])

  const activeIds = new Set(lines.filter((l) => !l.removed_at).map((l) => String(l.procedure_id)))
  const choices = (catalog || []).filter((p) => !activeIds.has(String(p.id)))
  const chosen = choices.find((p) => String(p.id) === pick)

  const add = async () => {
    if (!chosen || !qtyValid(newMats)) return
    setBusy(true)
    try {
      await api.clinic.addAppointmentProcedure(appt.id, chosen.id, toPayload(newMats))
      const withMats = newMats.length ? ` + ${newMats.length} ${newMats.length === 1 ? 'مادة' : 'مواد'}` : ''
      onToast(`أُضيف «${chosen.name}» — ${fmtMoney(chosen.price)}${withMats}`, 'success')
      setPick(''); setNewMats([]); onChanged()
    } catch (ex) { onToast(ex.message) }
    finally { setBusy(false) }
  }
  const remove = async (line) => {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await api.clinic.removeAppointmentProcedure(appt.id, line.id, reason.trim())
      onToast(`أُزيل «${line.name}»`, 'success'); setRemoving(null); setReason(''); onChanged()
    } catch (ex) { onToast(ex.message) }
    finally { setBusy(false) }
  }
  const startEdit = (line) => {
    setRemoving(null); setEditing(line.id)
    setEditMats((line.materials || []).map((m) => ({ ...m, qty: fmtQty(m.qty) })))
  }
  const saveEdit = async (line) => {
    if (!qtyValid(editMats)) return
    setBusy(true)
    try {
      const r = await api.clinic.setLineMaterials(appt.id, line.id, { materials: toPayload(editMats) })
      onToast(r.unchanged ? 'لا تغيير في المواد' : `حُدّثت مواد «${line.name}»`, 'success')
      setEditing(null); onChanged()
    } catch (ex) { onToast(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="appt-procs">
      {lines.length === 0 ? (
        <p className="visit-empty">{canEdit ? 'لا إجراءات بعد — اختر الإجراء من القائمة وأضفه.' : 'لا إجراءات على هذه الزيارة.'}</p>
      ) : (
        <table className="appt-procs-table">
          <tbody>
            {lines.map((l) => (
              <Fragment key={l.id}>
                <tr className={l.removed_at ? 'proc-removed' : undefined}>
                  <td>
                    {l.name}
                    {/* أُضيف خارج اختصاص دكتوره بقرار المشرف — العلامة تُبقي الأثر */}
                    {l.off_specialty && (
                      <span className="badge warn" style={{ marginInlineStart: 5, fontSize: 10.5 }}
                        title="أُضيف خارج اختصاص الدكتور بقرار مشرف العيادات">خارج الاختصاص</span>
                    )}
                  </td>
                  <td className="num">{fmtMoney(l.price)}</td>
                  <td className="appt-procs-meta">
                    أضافه {l.added_by_name || '—'} <span dir="ltr">{whenAt(l.added_at, session.session_day)}</span>
                    {l.removed_at && (
                      <span className="proc-removed-why">
                        أزاله {l.removed_by_name || '—'} <span dir="ltr">{whenAt(l.removed_at, session.session_day)}</span> — {l.removed_reason}
                      </span>
                    )}
                  </td>
                  <td>
                    {!l.removed_at && canEdit && removing !== l.id && editing !== l.id && (
                      <span className="proc-line-actions">
                        <button className="ghost" style={{ padding: '2px 10px', fontSize: 11.5 }}
                          onClick={() => startEdit(l)}>المواد</button>
                        <button className="ghost" style={{ padding: '2px 10px', fontSize: 11.5 }}
                          onClick={() => { setEditing(null); setRemoving(l.id); setReason('') }}>إزالة</button>
                      </span>
                    )}
                    {removing === l.id && (
                      <span className="proc-remove-form">
                        <input value={reason} autoFocus placeholder="سبب الإزالة (إلزامي)" aria-label="سبب الإزالة"
                          onChange={(e) => setReason(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') remove(l) }} />
                        <button style={{ padding: '3px 10px', fontSize: 11.5 }} disabled={busy || !reason.trim()}
                          onClick={() => remove(l)}>تأكيد الإزالة</button>
                        <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                          onClick={() => setRemoving(null)}>إلغاء</button>
                      </span>
                    )}
                  </td>
                </tr>
                {/* مواد السطر: بالاسم والكمّية — أو محرّرها إن فُتح */}
                {!l.removed_at && (editing === l.id ? (
                  <tr className="proc-mats-row">
                    <td colSpan={4}>
                      <MaterialsEditor catalog={matCatalog} value={editMats} onChange={setEditMats} disabled={busy} />
                      <div className="mat-actions">
                        <button disabled={busy || !qtyValid(editMats)} onClick={() => saveEdit(l)}>حفظ المواد</button>
                        <button className="ghost" disabled={busy} onClick={() => setEditing(null)}>إلغاء</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr className="proc-mats-row">
                    <td colSpan={4} className="proc-mats-text">
                      {(l.materials || []).length
                        ? <>المواد: {materialsSummary(l.materials)}</>
                        : <span className="muted">بلا مواد</span>}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {canEditAppointmentProcedures(role) && (
        canEdit ? (
          <div className="proc-add-box">
            <div className="proc-add">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="الإجراء">
                <option value="">{catalog === null ? 'جارٍ التحميل…' : choices.length ? '— اختر إجراءً —' : 'لا إجراءات متاحة'}</option>
                {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {/* السعر للقراءة فقط — من الكتالوج، ولا يُرسَل للخادم أصلاً */}
              <span className="proc-add-price">{chosen ? fmtMoney(chosen.price) : '—'}</span>
              <button disabled={!chosen || busy || !qtyValid(newMats)} onClick={add}>+ إجراء</button>
            </div>
            {/* المواد بعد اختيار الإجراء: اختيارية — إجراءٌ بلا مواد يُضاف كما هو */}
            {chosen && (
              <div className="proc-add-mats">
                <span className="proc-add-mats-label">المواد المستعملة (اختياري):</span>
                <MaterialsEditor catalog={matCatalog} value={newMats} onChange={setNewMats} disabled={busy} />
              </div>
            )}
          </div>
        ) : (
          <p className="appt-procs-hint">
            {!entered ? 'تُضاف الإجراءات بعد دخول المريض على الطبيب.'
              : 'انتهى يوم هذه الجلسة — الإضافة والإزالة وتعديل المواد الآن لمسؤول العيادات.'}
          </p>
        )
      )}
    </div>
  )
}
