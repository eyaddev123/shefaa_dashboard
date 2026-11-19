import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { addDays, api, dayLabel, fmtTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { canSeeCashReport } from '../permissions.js'
import { FlowModeTag } from '../attendance-ui.jsx'
import RoomBadge from '../components/RoomBadge.jsx'
import RoomPicker from '../components/RoomPicker.jsx'
import CloseSweepDialog from '../components/CloseSweepDialog.jsx'
import { useToast } from '../action-feedback.jsx'
import { nowHHMM, roomOccupants } from '../room-occupancy.js'
import { generateLabel, generateSummary } from '../generate-summary.js'

// من يرى قسم «دكاترة اليوم» والاعتذارات — يطابق APOLOGY_VIEWERS في الخادم.
// الاستقبال غائبٌ عمداً: المعتذر لا وجود له عنده ذلك اليوم.
const APOLOGY_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']


// ═══ نافذة الاعتذار — من داخل النظام لا من المتصفّح ═══
//
// prompt() وconfirm() نوافذُ المتصفّح: أزرارها بالإنكليزية، وخطّها خطّ النظام،
// وتكتب اسم الموقع فوقها، ولا تعرف الثيم الداكن. ناشزةٌ عن كل شاشات النظام.
//
// وهي تجمع الخطوتين في نافذةٍ واحدة: السبب أولاً، فإن ردّ الخادم بوجود حجوزات
// عُرضت أسماء المرضى وهواتفهم **داخل النافذة نفسها** — لا نافذةٌ ثانية تُفقد
// السياق، ولا سلسلةُ confirm متتابعة.
function ApologyDialog({ doctor, date, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [bookings, setBookings] = useState(null)   // غير null ⇒ مرحلة التأكيد

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (confirmIt) => {
    setBusy(true); setErr(null)
    try {
      await api.clinic.apologize({
        doctor_id: doctor.doctor_id, date,
        reason: reason.trim() || null,
        ...(confirmIt ? { confirm: true } : {}),
      })
      onDone()
    } catch (ex) {
      // حجوزاتٌ قائمة: نعرضها ونطلب تأكيداً صريحاً. ولا يُلغى ولا يُنقل شيءٌ
      // تلقائياً — من يتّصل بالمرضى بشرٌ يقرّر.
      if (ex.data?.code === 'HAS_BOOKINGS') { setBookings(ex.data.bookings); setErr(ex.message) }
      else setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="apology-title">
        <h3 id="apology-title">تعليم «معتذر» — {doctor.doctor_name}</h3>
        <p className="subtitle" style={{ marginTop: 4 }}>
          لن يظهر على شاشة الصالة ولا في قوائم الاستقبال، ولن يُقبل حجزٌ عليه في هذا اليوم.
        </p>

        {!bookings ? (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="apology-reason">السبب (اختياري)</label>
              <input id="apology-reason" autoFocus value={reason} maxLength={200}
                placeholder="مثلاً: سفر، أو ظرف طارئ"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(false) }} />
            </div>
            {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
            <div className="bf-actions" style={{ marginTop: 16 }}>
              <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
              <button type="button" disabled={busy} onClick={() => submit(false)}>
                {busy ? 'جارٍ…' : 'تعليم معتذر'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="error" style={{ marginTop: 12 }}>{err}</p>
            <p className="subtitle" style={{ marginTop: 10 }}>
              لن يُلغى أيُّ حجز ولن يُنقل تلقائياً — اتّصل بهم أولاً:
            </p>
            <ul className="apology-bookings">
              {bookings.map((b) => (
                <li key={b.id}>
                  <span>{b.full_name}</span>
                  {b.mobile
                    ? <a href={`tel:${b.mobile}`} dir="ltr">{b.mobile}</a>
                    : <span className="muted">بلا رقم</span>}
                </li>
              ))}
            </ul>
            <div className="bf-actions" style={{ marginTop: 16 }}>
              <button type="button" className="ghost" disabled={busy} onClick={onClose}>تراجع</button>
              <button type="button" className="danger" disabled={busy} onClick={() => submit(true)}>
                {busy ? 'جارٍ…' : `تأكيد رغم ${bookings.length} حجزاً`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// «مريضٌ واحد، مريضان، ٣ مرضى، ١١ مريضاً» — العدد في نافذة نقل الغرفة
const patientsAr = (n) => n === 1 ? 'مريضٌ واحد' : n === 2 ? 'مريضان'
  : n >= 3 && n <= 10 ? `${n} مرضى` : `${n} مريضاً`

// ═══ نافذة تأكيد عامّة — بديل confirm() ═══
function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, busy, cancelLabel = 'لا، اتركه' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        <p className="subtitle" style={{ marginTop: 6 }}>{body}</p>
        <div className="bf-actions" style={{ marginTop: 16 }}>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>{cancelLabel}</button>
          <button type="button" autoFocus disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ═══ دكاترة اليوم — لمشرف العيادات (والمدير/المجلس اطّلاعاً) ═══
//
// تُبنى من **القوالب** لا من الجلسات: الدكتور يعتذر فجراً قبل التوليد، فلو بُنيت
// على الجلسات لما ظهر من لم تُولَّد جلسته — وهو بالضبط من نحتاج تعليمه.
//
// والاستقبال لا يراها إطلاقاً: المعتذر ببساطة غير موجود ذلك اليوم، لا سطرَ
// معلومةٍ ولا سبب. القرار قرار المشرف.
function DayDoctors({ date, generation, canEdit, onChanged, allRooms, onRoomChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [apologizing, setApologizing] = useState(null)   // الدكتور قيد التعليم
  const [askUndo, setAskUndo] = useState(null)           // {doctor, warning} بعد جلسةٍ يدوية
  const [exportTo, setExportTo] = useState('')           // مدى التصدير: فارغ = يومٌ واحد
  const [exporting, setExporting] = useState(null)
  const [roomAsk, setRoomAsk] = useState(null)           // {doctor, room, ...ردّ 409} قبل نقل غرفةٍ عاملة
  const [toastNode, showToast] = useToast()

  const load = () => api.clinic.dayDoctors(date).then(setData).catch((e) => setErr(e.message))
  useEffect(() => { setData(null); setErr(null); load() }, [date])
  // بعد التوليد: وإلا بقي السطر «لم تُولَّد بعد» وجلسته أمام العين في الجدول تحته
  useEffect(() => { if (generation) load() }, [generation])

  const afterApology = async () => {
    setApologizing(null); await load(); onChanged()
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
      // الاعتذار **يبقى** مانعاً — لا يُلغى ضمناً بإنشاء الجلسة، بل يُسأل عنه
      if (r.warning_code === 'DOCTOR_APOLOGIZED') {
        setBusy(null); await load()
        setAskUndo({ doctor: d, warning: r.warning })
        return
      }
    } catch (ex) { setErr(ex.message) }
    setBusy(null); await load(); onChanged()
  }

  // التصدير: دكتورٌ بعينه أو الكلّ. الخطأ يُعرض ولا يُستبدَل بالشاشة.
  const doExport = async (doctorId) => {
    setExporting(doctorId || 'all'); setErr(null)
    try { await api.clinic.exportExcel({ from: date, to: exportTo || date, doctorId }) }
    catch (ex) { setErr(ex.message) }
    finally { setExporting(null) }
  }

  // ═══ تغيير الغرفة: فوريّ، وتأكيدٌ إن كان الدكتور يستقبل الآن ═══
  // الخادم هو من يعرف «يستقبل الآن» (جلسة اليوم وفيها مرضى في الدور) فيردّ 409،
  // والنافذة تقول ما سيحدث: النداء والشاشة ينتقلان، والبطاقات المطبوعة لا.
  const changeRoom = async (d, room, confirmIt = false) => {
    setBusy(d.doctor_id)
    try {
      const r = await api.clinic.setDoctorRoom(d.doctor_id, room, confirmIt)
      setRoomAsk(null)
      showToast(r.room ? `${d.doctor_name} ← العيادة ${r.room}` : `${d.doctor_name} ← بلا غرفة`, 'success', 3500)
      await load(); onRoomChanged()
    } catch (ex) {
      if (ex.data?.code === 'ROOM_CHANGE_LIVE_SESSION') setRoomAsk({ doctor: d, room, ...ex.data })
      else { setRoomAsk(null); showToast(ex.message) }
    } finally { setBusy(null) }
  }

  // غرفة ← من فيها اليوم (عدا المعتذر)، ومعه «الآن» أو أوقات دوامه — تُحسب لحظة فتح القائمة
  const occupantsFor = (doctorId) =>
    roomOccupants(data.doctors, doctorId, { date, today: todayLocal(), now: nowHHMM() })

  const confirmUndo = async () => {
    const d = askUndo.doctor
    setBusy(d.doctor_id)
    try { await api.clinic.undoApology(d.doctor_id, date) }
    catch (ex) { setErr(ex.message) }
    setBusy(null); setAskUndo(null); await load(); onChanged()
  }

  if (err && !data) return <p className="error">{err}</p>
  if (!data) return null
  if (data.doctors.length === 0) return <div className="card cbx-dd"><p className="empty">لا دكاترة بالدوام في هذا اليوم حسب الجداول.</p></div>

  return (
    <div className="card cbx-dd">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 2 }}>دكاترة اليوم ({data.doctors.length})</h3>
          <p className="subtitle" style={{ margin: 0 }}>
            المتوقَّعون حسب جداول الدوام — حتى لو لم تُولَّد جلساتهم بعد.
          </p>
        </div>
        <div className="inline dd-export" style={{ alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* مدى اختياري: فارغ = يوم اللوحة وحده */}
          <label className="muted" style={{ whiteSpace: 'nowrap' }}>إلى تاريخ</label>
          <input type="date" value={exportTo} min={date}
            onChange={(e) => setExportTo(e.target.value)}
            title="اتركه فارغاً لتصدير هذا اليوم وحده" />
          <button type="button" className="ghost" style={{ padding: '4px 12px', fontSize: 12 }}
            disabled={exporting !== null} onClick={() => doExport(null)}>
            {exporting === 'all' ? 'جارٍ…' : '⬇ تصدير كل الدكاترة'}
          </button>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <table className="rtable">
        <thead>
          <tr><th>الدكتور</th><th>الاختصاص</th><th>الوقت</th><th>الغرفة</th><th>الحالة</th><th></th></tr>
        </thead>
        <tbody>
          {data.doctors.map((d) => (
            <tr key={d.doctor_id} className={d.off_week || d.apologized ? 'row-faded' : ''}>
              <td className="rt-title">{d.doctor_name}</td>
              <td data-label="الاختصاص">{d.specialty || '—'}</td>
              <td className="num" data-label="الوقت">
                {d.start_time ? <bdi dir="ltr">{d.start_time} – {d.end_time}</bdi> : <span className="muted">جلسة يدوية</span>}
              </td>
              <td className="num" data-label="الغرفة">
                {canEdit
                  ? <RoomPicker room={d.room} rooms={allRooms} occupants={occupantsFor(d.doctor_id)}
                      disabled={busy === d.doctor_id} onPick={(room) => changeRoom(d, room)} />
                  : (d.room || '—')}
              </td>
              <td className="rt-badge">
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
              <td className="rt-actions">
                {/* التصدير متاحٌ لمن يراه (مشرف/مدير/مجلس) لا لمن يُعدّل وحده */}
                <button type="button" className="ghost"
                  style={{ padding: '3px 10px', fontSize: 11.5, marginInlineEnd: 6 }}
                  disabled={exporting !== null || d.apologized}
                  title={d.apologized ? 'المعتذر مستبعَد من التصدير' : 'تنزيل ملفّ إكسل لهذا الدكتور'}
                  onClick={() => doExport(d.doctor_id)}>
                  {exporting === d.doctor_id ? '…' : 'Excel'}
                </button>
                {canEdit && (d.apologized ? (
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    disabled={busy === d.doctor_id} onClick={() => undo(d)}>تراجع</button>
                ) : (
                  <>
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      disabled={busy === d.doctor_id} onClick={() => setApologizing(d)}>معتذر</button>
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

      {apologizing && (
        <ApologyDialog doctor={apologizing} date={date}
          onClose={() => setApologizing(null)} onDone={afterApology} />
      )}
      {roomAsk && (
        <ConfirmDialog
          title={`نقل ${roomAsk.doctor.doctor_name} ${roomAsk.room ? `إلى العيادة ${roomAsk.room}` : 'إلى «بلا غرفة»'}`}
          body={`${roomAsk.doctor.doctor_name} يستقبل الآن${roomAsk.old_room ? ` في العيادة ${roomAsk.old_room}` : ''} وفي دوره ${patientsAr(roomAsk.active_count)} — `
            + `النداءات والشاشة ستتحوّل ${roomAsk.room ? `إلى العيادة ${roomAsk.room}` : 'إلى «بلا غرفة» (نداءٌ بلا وجهة)'} فوراً. `
            + `${roomAsk.old_room ? `البطاقات المطبوعة سابقاً عليها الرقم القديم (${roomAsk.old_room}). ` : ''}متابعة؟`}
          confirmLabel={roomAsk.room ? `نعم، انقله إلى العيادة ${roomAsk.room}` : 'نعم، بلا غرفة'}
          busy={busy === roomAsk.doctor.doctor_id}
          onConfirm={() => changeRoom(roomAsk.doctor, roomAsk.room, true)}
          onClose={() => setRoomAsk(null)} />
      )}
      {toastNode}
      {askUndo && (
        <ConfirmDialog
          title="الدكتور معلَّم معتذر لهذا اليوم"
          body={`${askUndo.warning} — هل تُلغي الاعتذار الآن ليُقبل الحجز على الجلسة الجديدة؟`}
          confirmLabel="نعم، ألغِ الاعتذار"
          busy={busy === askUndo.doctor.doctor_id}
          onConfirm={confirmUndo}
          onClose={() => { setAskUndo(null); onChanged() }} />
      )}
    </div>
  )
}

// ═══ حالةٌ واحدة لكلّ عيادة — كلمةٌ ولون (2026-11-18: كانت «مفتوحة» و«مغلقة» تظهران معاً) ═══
// الأولويّة: معتذر ⇐ ملغاة ⇐ أغلقها أحد ⇐ فيها مرضى لم ينتهوا ⇐ خدمت الكلّ ⇐ بعدُ بلا مرضى.
// «خلص الدور» ليست إغلاقاً: الاستقبال تستطيع إضافة حاضرٍ جديد، والإغلاق زرٌّ صريح.
function clinicState(s) {
  if (s.apologized) return { key: 'apology', label: 'معتذر', tone: 'bad' }
  if (s.status === 'cancelled') return { key: 'cancelled', label: 'ملغاة', tone: 'bad' }
  if (s.manual_closed_at) return { key: 'closed', label: 'مغلقة', tone: 'muted' }
  if (s.pending_count > 0) return { key: 'busy', label: 'شغّالة', tone: 'good' }
  if (s.done_count > 0) return { key: 'served', label: 'خلص الدور', tone: 'info' }
  return { key: 'open', label: 'مفتوحة', tone: 'info' }
}

// ═══ تبويب «العيادات» — ما تراه الاستقبال (وحده)، وأوّل تبويبٍ للمسؤولة والمدراء ═══
// جدولٌ مرتّب (قرار المستخدم): الدكتور بغرفته واختصاصه، الوقت، الحالة، «باقي» و«خلصوا» رقمين،
// و«فتح الدور» زرٌّ واضح، والإغلاق/إعادة الفتح بجانبه — الإغلاق بتأكيدٍ بسيط قبله، ومن له مرضى
// معلَّقون يذهب مباشرةً إلى نافذة الملخّص القائمة (CloseSweepDialog — كما هي بطلب المستخدم).
function ClinicsTab({ sessions, rooms, role, date, canCloseSession, onOpen, onChanged }) {
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)
  const [ask, setAsk] = useState(null)       // جلسةٌ تنتظر «تسكّري؟»
  const [sweep, setSweep] = useState(null)   // { session, pending } — نافذة الإغلاق الكانس
  const close = async (s) => {
    setBusyId(s.id); setErr(null)
    try { await api.clinic.closeSession(s.id); setAsk(null); await onChanged() }
    catch (ex) {
      setAsk(null)
      if (ex.data && ex.data.code === 'CLOSE_PENDING' && ex.data.pending) setSweep({ session: s, pending: ex.data.pending })
      else setErr(ex.message)
    } finally { setBusyId(null) }
  }
  const reopen = async (s) => {
    setBusyId(s.id); setErr(null)
    try { await api.clinic.reopenSession(s.id); await onChanged() }
    catch (ex) { setErr(ex.message) } finally { setBusyId(null) }
  }
  // مرضى لم ينتهوا ⇒ الملخّص مباشرةً (هو نفسه سؤال)؛ وإلّا تأكيدٌ بسيط
  const askClose = (s) => (s.pending_count > 0 ? close(s) : setAsk(s))

  if (!sessions) return <div className="card"><p className="empty">جارٍ التحميل…</p></div>
  if (sessions.length === 0) return (
    <div className="card cbx-empty">
      <p className="empty">لا عيادات في هذا اليوم.</p>
      {role === 'clinic_admin' && <p className="muted">ولّدي جلسات اليوم من تبويب «توليد الجلسات».</p>}
    </div>
  )
  return (
    <div className="card cbx-card">
      {err && <p className="error">{err}</p>}
      <table className="rtable cbx-table">
        <thead>
          <tr><th>الدكتور</th><th>الوقت</th><th>الحالة</th><th className="num">باقي</th><th className="num">خلصوا</th><th></th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const st = clinicState(s)
            return (
              // السطر كلّه يفتح الدور كما كان قبل النفض (طلب المستخدم 2026-11-19) — الأزرار وحدها لا تفتحه
              <tr key={s.id} className={`cbx-row is-${st.key} clickable`}
                onClick={(e) => { if (!e.target.closest('button,a,input')) onOpen(s) }}>
                <td className="rt-title">
                  <div className="cbx-doc">
                    <span className="cbx-name">{s.doctor_name}{rooms && <RoomBadge room={rooms[s.doctor_id]} />}</span>
                    {s.specialty && <span className="cbx-spec">{s.specialty}</span>}
                  </div>
                </td>
                <td className="num" data-label="الوقت">
                  <bdi dir="ltr">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</bdi>
                  {s.flow_mode !== 'attendance' && <div className="cbx-mode"><FlowModeTag mode={s.flow_mode} /></div>}
                </td>
                <td data-label="الحالة"><span className={`cbx-state is-${st.tone}`}>{st.label}</span></td>
                <td className="num cbx-n" data-label="باقي">{s.pending_count}</td>
                <td className="num cbx-n" data-label="خلصوا">{s.done_count}</td>
                <td className="rt-actions cbx-actions">
                  <button type="button" className="cbx-open" onClick={() => onOpen(s)}>فتح الدور</button>
                  {canCloseSession && !s.apologized && s.status !== 'cancelled' && (s.manual_closed_at ? (
                    <button type="button" className="ghost cbx-close" disabled={busyId === s.id} onClick={() => reopen(s)}>
                      {busyId === s.id ? '…' : 'إعادة فتح'}</button>
                  ) : (
                    <button type="button" className="ghost cbx-close" disabled={busyId === s.id} onClick={() => askClose(s)}>
                      {busyId === s.id ? '…' : 'إغلاق العيادة'}</button>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {ask && (
        <ConfirmDialog title={`تسكير عيادة ${ask.doctor_name}؟`}
          body={`ما رح يعود ينقبل حضور أو حجز على هالعيادة اليوم${date ? '' : ''}. فيكِ ترجّعي تفتحيها بعدين بـ«إعادة فتح».`}
          confirmLabel="إغلاق العيادة" cancelLabel="رجوع" busy={busyId === ask.id}
          onConfirm={() => close(ask)} onClose={() => setAsk(null)} />
      )}
      {sweep && (
        <CloseSweepDialog session={sweep.session} pending={sweep.pending}
          onClose={() => setSweep(null)}
          onDone={() => { setSweep(null); onChanged() }} />
      )}
    </div>
  )
}

// ═══ تبويب «توليد الجلسات» — المسؤولة وحدها، بعيداً عن باقي الأزرار (طلب المستخدم 2026-11-18) ═══
function GenerateTab({ date, onGenerated }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)
  useEffect(() => { setResult(null); setErr(null) }, [date])
  const generate = async () => {
    setBusy(true); setErr(null); setResult(null)
    try {
      const r = await api.clinic.generateSessions(date)
      setResult({ text: generateSummary(date, r), created: (r.created || []).length })
      onGenerated()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <div className="card cbx-gen">
      <h3>توليد جلسات اليوم</h3>
      <p className="subtitle">يُنشئ جلسات اليوم المختار من جداول دوام الدكاترة. مَن تولّدت جلسته من قبل ما بيتكرّر، والمعتذر ما بتنعمل جلسته.</p>
      <button type="button" className="cbx-gen-btn" disabled={busy || !date} onClick={generate}>
        {busy ? 'جارٍ التوليد…' : generateLabel(date)}</button>
      {err && <p className="error">{err}</p>}
      {result && <p className={`cbx-gen-result${result.created ? ' is-good' : ''}`} role="status">{result.text}</p>}
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
  const { clinicRole: role } = useRole()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [generation, setGeneration] = useState(0)   // يزيد مع كل توليد ناجح — لقائمة «دكاترة اليوم»
  // من يرى الصالة هو من يعرف أنّ الدكتور غادر — الاستقبال والمشرف معاً
  const canCloseSession = role === 'clinic_admin' || role === 'clinic_reception'
  // جرد الصندوق: شاشةٌ مستقلّة (الاستقبال والمشرفة والمدير) — تفتح على اليوم المختار هنا
  const canCashReport = canSeeCashReport(role)
  // التبويبات (2026-11-18): الاستقبال «العيادات» وحدها بلا شريط؛ المدراء + «الدكاترة والاعتذارات» اطّلاعاً؛
  // والمسؤولة + «توليد الجلسات»
  const tabs = [['clinics', 'العيادات'],
    ...(APOLOGY_VIEWERS.includes(role) ? [['doctors', 'الدكاترة والاعتذارات']] : []),
    ...(role === 'clinic_admin' ? [['generate', 'توليد الجلسات']] : [])]
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'clinics'
  const setTab = (k) => setParams(k === 'clinics' ? {} : { tab: k }, { replace: true })

  const load = () => api.clinic.sessions(date).then(setSessions).catch((e) => setErr(e.message))
  useEffect(() => { setSessions(null); load() }, [date])

  // رقم العيادة بجانب كل دكتور: ردّ الجلسات لا يحمل الغرفة، فنأخذها من قائمة الدكاترة
  // (المصدر نفسه doctors.room). فشلها لا يُفسد اللوحة — تغيب الشارة ولا تكذب «بلا عيادة».
  const [rooms, setRooms] = useState(null)   // doctor_id → room
  const loadRooms = () => api.clinic.doctors()
    .then((ds) => setRooms(Object.fromEntries(ds.map((d) => [d.id, d.room]))))
    .catch(() => setRooms(null))
  useEffect(() => { loadRooms() }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h2>اللوحة اليومية</h2>
          <p className="subtitle">عيادات اليوم المختار ودور كلّ دكتور — تنقّلي بالأيام للحجز المسبق</p>
        </div>
        <div className="board-head-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <input type="date" value={date} aria-label="اليوم" onChange={(e) => e.target.value && setDate(e.target.value)} />
          {canCashReport && (
            <button type="button" className="ghost" style={{ whiteSpace: 'nowrap' }}
              onClick={() => navigate(`/clinic/cash-report${date < today ? `?date=${date}` : ''}`,
                { state: { from: 'board' } })}>جرد الصندوق</button>
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

      {tabs.length > 1 && (
        <div className="pcx-tabs cbx-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={`pcx-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      )}

      {tab === 'clinics' && (
        <ClinicsTab sessions={sessions} rooms={rooms} role={role} date={date} canCloseSession={canCloseSession}
          onOpen={(s) => navigate(`/clinic/session/${s.id}`)} onChanged={load} />
      )}
      {/* الاستقبال لا يرى هذا التبويب إطلاقاً — ولا الخادم يُجيبه عليه */}
      {tab === 'doctors' && (
        <DayDoctors date={date} generation={generation} canEdit={role === 'clinic_admin'} onChanged={load}
          allRooms={rooms ? Object.values(rooms) : []} onRoomChanged={loadRooms} />
      )}
      {tab === 'generate' && (
        <GenerateTab date={date} onGenerated={() => { load(); setGeneration((g) => g + 1) }} />
      )}
    </>
  )
}
