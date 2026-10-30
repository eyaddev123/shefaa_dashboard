import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtTime, fmtMoney, todayLocal, openStaffStream } from '../api.js'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock, fmtTimeOfDay } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'
import { waitingReturnOf, serverOffsetOf, Elapsed } from '../waiting-return.jsx'
import { useDialogs } from '../dialogs.jsx'
import BottomSheet from '../components/BottomSheet.jsx'
import MaterialsEditor, { qtyValid, toPayload } from '../components/MaterialsEditor.jsx'
import {
  ringDoctor, primeOnFirstGesture, onAudioState, audioReady, unlockAudio,
  shouldOfferPush, dismissPushOffer, enablePush, refreshPush,
} from '../doctor-alert.js'

// ═══════════════════════════════════════════════════════════════════
// شاشة الطبيب — شاشةٌ واحدة لا متاهة تبويبات
//
// وقت الطبيب مضغوط بين مريضين: أقلّ لمسات، وكلّ المهمّ أمام عينه بلا تنقّل.
//   • ثلاثة تبويبات: «الموجودون» (الدور بكلّ أزراره)، «الحجوزات» (للاطّلاع)، و«أعمالي» (أرقامه).
//   • المريض قيد الكشف هو النجم، وأزراره هرم: أساسيٌّ واحد بحسب الحالة («بدء الكشف» أو «إنهاء
//     الكشف»)، ثمّ «+ إجراء» ثانوياً، ثمّ «إعادة النداء» و«خروج مؤقت» خفيفين. كلّها ≥48px.
//   • «+ إجراء» على بطاقته ⇒ ورقة سفلية بإجراءات اختصاصه أزراراً كبيرة مرتّبة بالأكثر
//     استعمالاً ⇒ لمسةٌ تعلّم الإجراء (وأكثر) ⇒ «إضافة (n)» تضيف المختار كلّه بطلبٍ واحد.
//     المواد «+ مواد» لكلّ إجراءٍ مختار داخل الورقة نفسها، اختيارية.
//     من «مريض قيد الكشف» إلى «إجراء مضاف بلا مواد» = ثلاث لمسات.
//   • «أعمالي»: اليوم/الأسبوع/الشهر، المرضى والإجراءات، والإجراءات المحاسَبة بحصّته ومجموعها.
//   • الإضافة والحذف متفائلان: يظهران فوراً، ويتراجعان برسالة واضحة إن رفض الخادم.
//
// ★ ولا رقمٌ ماليّ في «الموجودون» و«الحجوزات» وبطاقة المريض (المريض أمام الشاشة): سطر الإجراء
//   اسمٌ ومؤشّر لون (✓ أخضر محاسَب، ⏳ أصفر بانتظار المحاسبة). الأرقام في «أعمالي» وحده، من
//   /clinic/my-work — حصّته هو من حساب صفحة المستحقات نفسه (live-check يفحص DOM التبويبين).
// ★ الرنّة: حدث idle_arrival من الخادم وحده يقرّر (حضورٌ والعيادة فارغة تماماً) — انظر doctor-alert.js.
// ═══════════════════════════════════════════════════════════════════


// شاراتُ ما أُضيف على المريض الحالي — بالأسماء وحدها، وحالة الدفع رمزاً
function AddedProcedures({ added = [], pending = [] }) {
  const live = (added || []).filter((l) => !l.removed_at)
  if (live.length === 0 && pending.length === 0) return null
  return (
    <div className="dk-chips" aria-label="الإجراءات المضافة">
      {live.map((l) => (
        <span key={l.id} className={`dk-chip ${l.paid_at ? 'is-paid' : 'is-unpaid'}`}
          title={l.paid_at ? 'تمت المحاسبة' : 'بانتظار المحاسبة'}>
          <span aria-hidden="true">{l.paid_at ? '✓' : '⏳'}</span> {l.name}
        </span>
      ))}
      {pending.map((p) => (
        <span key={p.tempId} className="dk-chip is-adding" aria-busy="true">
          <span className="dk-spin" aria-hidden="true" /> {p.name}
        </span>
      ))}
    </div>
  )
}

// ═══ ورقة الإضافة — تحديدٌ متعدد ثمّ «إضافة (n)» ═══
// اللمسة على الإجراء تعلّمه (يتلوّن وعليه ✓) ولا تُضيفه؛ زرّ التأكيد أسفل الورقة يحمل العدد
// ويُضيف المختار كلّه بطلبٍ واحد (كلّها أو لا شيء). إجراءٌ واحد = السلوك نفسه: تعليم + «إضافة (1)»
// — من «قيد الكشف» إلى «مضاف» ثلاث لمسات.
// المواد: لكلّ إجراءٍ مختار سطرٌ تحت الشبكة بـ«+ مواد» خاصّةٍ به — داخل الورقة نفسها، اختيارية.
// draft: { selected: [{id, name, mats, open}], errorId, error } — يبقى في الأب فيعود كما كان إن رُفض.
function AddProcedureSheet({ appt, catalog, usage, matCatalog, loadMaterials, draft, setDraft, onConfirm, onClose }) {
  const taken = new Set((appt.procedures || []).filter((l) => !l.removed_at).map((l) => String(l.procedure_id)))
  // الأكثر استعمالاً عنده أوّلاً (آخر ٩٠ يوماً)، ثمّ أبجدياً
  const items = (catalog || []).filter((p) => p.is_active)
    .sort((a, b) => (usage[String(b.id)] || 0) - (usage[String(a.id)] || 0) || a.name.localeCompare(b.name, 'ar'))
  const sel = draft.selected
  const isOn = (id) => sel.some((x) => String(x.id) === String(id))
  const update = (id, patch) => setDraft((d) => ({ ...d,
    selected: d.selected.map((x) => (String(x.id) === String(id) ? { ...x, ...patch } : x)) }))
  const toggle = (p) => setDraft((d) => ({ ...d, errorId: null, error: null,
    selected: isOn(p.id) ? d.selected.filter((x) => String(x.id) !== String(p.id))
      : [...d.selected, { id: p.id, name: p.name, mats: [], open: false }] }))
  const valid = sel.length > 0 && sel.every((x) => qtyValid(x.mats))
  return (
    <BottomSheet title={`إجراء لـ ${appt.full_name}`}
      subtitle="علّم الإجراءات ثمّ «إضافة» — وتبقى «بانتظار المحاسبة» حتى يدفع المريض"
      onClose={onClose}
      footer={(
        <button type="button" className="dk-confirm" disabled={!valid} onClick={onConfirm}>
          إضافة ({sel.length.toLocaleString('ar-SY')})
        </button>
      )}>
      {draft.error && <p className="error dk-sheet-error" role="alert">{draft.error}</p>}
      {catalog == null ? <p className="empty">جارٍ التحميل…</p>
        : items.length === 0 ? <p className="empty">لا إجراءات لاختصاصك في الكتالوج — راجع مشرفة العيادات.</p> : (
          <div className="dk-pick-grid">
            {items.map((p) => {
              const added = taken.has(String(p.id))
              const on = isOn(p.id)
              const bad = String(draft.errorId) === String(p.id)
              return (
                <button key={p.id} type="button" aria-pressed={on} disabled={added}
                  className={`dk-pick${on ? ' is-on' : ''}${bad ? ' is-bad' : ''}`} onClick={() => toggle(p)}>
                  {on && <span className="dk-pick-check" aria-hidden="true">✓</span>}
                  <span className="dk-pick-name">{p.name}</span>
                  {added && <span className="dk-pick-tag">✓ مضاف</span>}
                </button>
              )
            })}
          </div>
        )}
      {sel.length > 0 && (
        <ul className="dk-sel">
          {sel.map((x) => (
            <li key={x.id} className="dk-sel-item">
              <div className="dk-sel-row">
                <span className="dk-sel-name">{x.name}</span>
                <button type="button" className="ghost dk-sel-mats" aria-expanded={x.open}
                  onClick={() => { update(x.id, { open: !x.open }); loadMaterials() }}>
                  {x.open ? '− المواد' : `+ مواد${x.mats.length ? ` (${x.mats.length.toLocaleString('ar-SY')})` : ''}`}
                </button>
              </div>
              {x.open && (
                <div className="dk-mats-body">
                  {matCatalog == null ? <p className="empty">جارٍ التحميل…</p>
                    : <MaterialsEditor catalog={matCatalog} value={x.mats} onChange={(mats) => update(x.id, { mats })} />}
                  {!qtyValid(x.mats) && <p className="error">صحّح الكمّية (رقم أكبر من صفر).</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  )
}

// ═══ «أعمالي» — التبويب الثالث، والمكان الوحيد الذي تظهر فيه أرقام الطبيب ═══
// اليوم / الأسبوع (من السبت) / الشهر: chips فورية بلا زرّ تطبيق. بطاقتا ملخّص (المرضى، الإجراءات)،
// ثمّ الإجراءات المقبوضة بحصّته من لقطة السطر، ثمّ المجموع — من /clinic/my-work، أي حساب صفحة
// المستحقات نفسه. وتحتها ما ينتظر المحاسبة بالأسماء وحدها (بلا مبالغ)، ومنه يحذف الطبيب سطره.
const WORK_PERIODS = [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']]

function MyWork({ reloadKey, pending, onRemove }) {
  const [period, setPeriod] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    api.clinic.myWork(period).then((d) => { if (alive) { setData(d); setErr(null) } })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [period, reloadKey])
  const shown = data && data.period === period ? data : null
  return (
    <div className="dk-work" role="tabpanel">
      <div className="dk-chips-filter" role="group" aria-label="الفترة">
        {WORK_PERIODS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={period === k}
            className={`dk-filter${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : (
        <>
          <div className="dk-stats">
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.patients.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">المرضى</span>
            </div>
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.procedures.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">الإجراءات</span>
            </div>
          </div>
          <div className="card dk-work-list">
            <h3>الإجراءات المحاسَبة <span className="dk-work-range" dir="ltr">
              {shown.from === shown.to ? shown.from : `${shown.from} — ${shown.to}`}</span></h3>
            {shown.lines.length === 0 ? <p className="empty">لا إجراءات محاسَبة في هذه الفترة.</p> : (
              <ul className="dk-lines">
                {shown.lines.map((l) => (
                  <li key={l.id} className="dk-line is-paid">
                    <div className="dk-line-main">
                      <span className="dk-line-proc">{l.procedure}</span>
                      <span className="dk-line-patient">{l.patient}</span>
                    </div>
                    <span className="dk-line-share">{fmtMoney(l.doctor_share)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="dk-work-total">
              <span>مجموع حصّتك</span>
              <strong>{fmtMoney(shown.total_share)}</strong>
            </div>
          </div>
        </>
      )}
      {pending.length > 0 && (
        <div className="card dk-work-pending">
          <h3>بانتظار المحاسبة <span className="dk-group-count">{pending.length.toLocaleString('ar-SY')}</span></h3>
          <p className="dk-hint">تُحتسب لك حين تقبضها الاستقبال. تحذف ما أضفته أنت قبل ذلك.</p>
          <ul className="dk-lines">
            {pending.map((l) => (
              <li key={l.id} className="dk-line is-unpaid">
                <div className="dk-line-main">
                  <span className="dk-line-proc">⏳ {l.name}</span>
                  <span className="dk-line-patient">{l.patient_name}</span>
                </div>
                {l.mine && (
                  <button type="button" className="ghost dk-line-x"
                    aria-label={`حذف ${l.name} عن ${l.patient_name}`} onClick={() => onRemove(l)}>حذف</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function DoctorScreen() {
  const dialogs = useDialogs()
  const [sessions, setSessions] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [queue, setQueue] = useState(null)
  // ★ الخطأ لا يستبدل الشاشة. loadErr لأوّل تحميل فقط (لا بيانات تُعرض بعد) ومعه زرّ
  // إعادة المحاولة؛ وأي خطأ بعدها — زرٌّ رُفض أو تحديثٌ دوري انقطع — إشعارٌ عابر
  // والطابور الأخير باقٍ.
  const [loadErr, setLoadErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, showToast] = useToast()
  const [tab, setTab] = useState('present')
  const [mine, setMine] = useState(null)
  const [workKey, setWorkKey] = useState(0)          // يُعيد تحميل «أعمالي» عند حدث إجراء
  const [adding, setAdding] = useState([])          // إضافاتٌ متفائلة: {tempId, appointment_id, name}
  const [removingIds, setRemovingIds] = useState([]) // حذفٌ متفائل
  const [sheetFor, setSheetFor] = useState(null)    // id الحجز الذي تُضاف له
  const emptyDraft = { selected: [], errorId: null, error: null }
  const [draft, setDraft] = useState(emptyDraft)     // المختار في الورقة — يعود كما كان إن رُفض
  const [catalog, setCatalog] = useState(null)
  const [matCatalog, setMatCatalog] = useState(null)
  const [audioOn, setAudioOn] = useState(audioReady())
  const [pushOffer, setPushOffer] = useState(false)

  const loadSessions = () => api.clinic.mySessions(todayLocal()).then((rows) => {
    setSessions(rows); setLoadErr(null)
    if (!sessionId && rows.length) setSessionId(rows[0].id)
  }).catch((e) => setLoadErr(e.message))
  useEffect(() => { loadSessions() }, [])

  const queueRef = useRef(null)
  queueRef.current = queue
  const loadQueue = useCallback(() => {
    if (!sessionId) return Promise.resolve()
    // يُعيد الوعد: الإضافة المتفائلة تنتظر الطابور الجديد قبل أن تُسقط شارة «تُضاف…»
    return api.clinic.queue(sessionId).then((q) => { setQueue(q); setLoadErr(null) })
      .catch((e) => {
        if (queueRef.current) showToast(`تعذّر تحديث قائمة الدور — يُعاد المحاولة تلقائياً (${e.message})`)
        else setLoadErr(e.message)
      })
  }, [sessionId, showToast])
  const loadMine = useCallback(() => api.clinic.myProcedures().then(setMine).catch(() => {}), [])
  useEffect(() => { loadQueue() }, [loadQueue])
  useEffect(() => { loadMine() }, [loadMine])

  // ★ نمط الحضور: الاستقبال يعلّم الحضور فيتغيّر الطابور من خارج هذه الشاشة — تحديث دوري.
  const attendance = isAttendanceSession(queue)
  const shownNumber = (a) => (attendance ? (a.arrival_number ?? '—') : a.queue_number)
  usePolling(loadQueue, attendance && !!sessionId)
  usePolling(loadMine, !!sessionId, 60000)

  // ═══ بثّ الموظفين: تحديثٌ فوري + الرنّة ═══
  // أيّ حدثٍ لجلستي ⇒ الطابور (و«إجراءاتي» إن كان إجراءً). idle_arrival لجلستي ⇒ الرنّة.
  const handlers = useRef({})
  handlers.current = { loadQueue, loadMine }
  useEffect(() => {
    if (!sessionId) return undefined
    let timer = null
    const close = openStaffStream((name, data) => {
      if (String(data?.session_id) !== String(sessionId)) return
      if (name === 'idle_arrival') ringDoctor()
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.hidden && name !== 'idle_arrival') return
        handlers.current.loadQueue()
        if (name === 'procedure' || name === 'visit') { handlers.current.loadMine(); setWorkKey((k) => k + 1) }
      }, 250)
    })
    return () => { clearTimeout(timer); close() }
  }, [sessionId])

  // الصوت: أوّل لمسة تفتحه بصمت (سياسة التشغيل التلقائي) — والشارة تقول إن لم يُفتح بعد
  useEffect(() => {
    const off = primeOnFirstGesture()
    const un = onAudioState(setAudioOn)
    return () => { off(); un() }
  }, [])
  // Web Push: عرضٌ لطيف أوّل مرّة؛ والإذن الممنوح سابقاً يُجدَّد بصمت
  useEffect(() => {
    if (shouldOfferPush()) api.push.key().then((k) => setPushOffer(!!k.enabled)).catch(() => {})
    else refreshPush(api.push)
  }, [])

  const act = async (fn, apptId) => {
    setBusy(true)
    try { await fn(apptId) }
    catch (ex) { showToast(ex.message) }
    // بعد النجاح والفشل معاً: الرفض (409) يعني غالباً أن الطابور تغيّر من شاشة أخرى
    finally { setBusy(false); loadQueue() }
  }

  // ═══ الإضافة: الورقة تُغلق فوراً، والشارة «تُضاف…» حتى يردّ الخادم ═══
  const openSheet = (appt) => {
    if (String(sheetFor) !== String(appt.id)) setDraft(emptyDraft)
    setSheetFor(appt.id)
    if (catalog == null) api.clinic.procedures().then(setCatalog).catch((e) => { setCatalog([]); showToast(e.message) })
  }
  const loadMaterials = () => {
    if (matCatalog == null) api.clinic.materials().then((r) => setMatCatalog(r.filter((m) => m.is_active !== false)))
      .catch((e) => { setMatCatalog([]); showToast(e.message) })
  }
  // «إضافة (n)»: الورقة تُغلق فوراً والشارات «تُضاف…»؛ ورفضٌ ⇒ تعود الورقة بالمختار نفسه
  // والإجراء الرافض معلَّمٌ أحمر برسالته (الطلب كلّه أو لا شيء — لم يُضَف أيٌّ منها)
  const confirmAdd = async () => {
    const apptId = sheetFor
    const chosen = draft.selected
    const temps = chosen.map((x, i) => ({ tempId: `t${Date.now()}-${i}`, appointment_id: apptId, name: x.name }))
    setSheetFor(null)
    setAdding((a) => [...a, ...temps])
    try {
      await api.clinic.addAppointmentProcedures(apptId, chosen.map((x) => ({ procedure_id: x.id, materials: toPayload(x.mats) })))
      setDraft(emptyDraft)
      showToast(chosen.length === 1 ? `أُضيف «${chosen[0].name}» — بانتظار المحاسبة`
        : `أُضيفت ${chosen.length.toLocaleString('ar-SY')} إجراءات — بانتظار المحاسبة`, 'success', 3500)
      await Promise.all([loadQueue(), loadMine()])
    } catch (ex) {
      setDraft((d) => ({ ...d, errorId: ex.data?.procedure_id ?? null, error: `لم يُضَف شيء: ${ex.message}` }))
      setSheetFor(apptId)
    } finally {
      const ids = new Set(temps.map((t) => t.tempId))
      setAdding((a) => a.filter((x) => !ids.has(x.tempId)))
    }
  }
  const remove = async (line) => {
    const ok = await dialogs.confirm({
      title: 'حذف الإجراء؟', body: `«${line.name}» عن ${line.patient_name} — لم يُحاسَب بعد.`,
      confirmLabel: 'حذف', danger: true })
    if (!ok) return
    setRemovingIds((r) => [...r, String(line.id)])
    try {
      await api.clinic.removeAppointmentProcedure(line.appointment_id, line.id, '')
      showToast(`حُذف «${line.name}»`, 'success', 3000)
      await Promise.all([loadMine(), loadQueue()])
    } catch (ex) {
      showToast(`لم يُحذف «${line.name}»: ${ex.message}`)
    } finally {
      setRemovingIds((r) => r.filter((x) => x !== String(line.id)))
    }
  }

  const mineLines = useMemo(() => (mine?.lines || [])
    .filter((l) => !removingIds.includes(String(l.id))), [mine, removingIds])

  if (loadErr && !sessions) return (
    <div className="load-failed">
      <p className="error">{loadErr}</p>
      <button className="ghost" onClick={loadSessions}>إعادة المحاولة</button>
    </div>
  )
  if (!sessions) return <p className="empty">جارٍ التحميل…</p>
  if (sessions.length === 0) return <p className="empty">لا جلسات لك اليوم.</p>

  const appts = queue?.appointments || []
  const current = appts.find((a) => a.status === 'in_service')
  const arrivedWaiting = appts.filter((a) => a.status === 'arrived')
  const nextUp = arrivedWaiting[0]
  // خرجوا مؤقتاً (قطرة، صورة…) وسيُنادَون ليُكملوا — ليسوا في الطابور ولا «قيد الكشف»
  const returning = waitingReturnOf(appts)
  const offset = serverOffsetOf(queue)
  // «الحجوزات»: محجوزو الجلسة الذين لم يحضروا بعد — بالوقت التقريبي/الخانة ثمّ رقم الحجز
  const timeOf = (a) => (attendance ? fmtTimeOfDay(a.estimated_time) : (a.slot_time ? fmtTime(a.slot_time) : null))
  const bookings = appts.filter((a) => a.status === 'waiting')
    .sort((a, b) => (timeOf(a) || '99').localeCompare(timeOf(b) || '99') || a.queue_number - b.queue_number)
  const presentCount = arrivedWaiting.length + (current ? 1 : 0) + returning.length
  const pendingFor = (id) => adding.filter((p) => String(p.appointment_id) === String(id))
  const sheetAppt = sheetFor && appts.find((a) => String(a.id) === String(sheetFor))

  const unpaidLines = mineLines.filter((l) => !l.paid_at)

  return (
    <div className="dk">
      <div className="dk-top">
        <div>
          <h2>شاشة الدكتور</h2>
          <p className="subtitle">مَن عندك الآن، ومَن ينتظر — وأرقامك في «أعمالي»</p>
        </div>
        <div className="dk-top-tools">
          {sessions.length > 1 && (
            <select aria-label="الجلسة" value={sessionId || ''} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</option>
              ))}
            </select>
          )}
          {/* ★ يبقى مكانه بعد التفعيل (تتبدّل حالته لا يختفي): أوّل لمسة في الصفحة تفتح الصوت،
              واختفاء الزرّ بين ضغطها ورفعها كان يُزيح الصفحة فتضيع اللمسة عن هدفها */}
          <button type="button" className={`ghost dk-audio${audioOn ? ' is-on' : ''}`} disabled={audioOn}
            onClick={() => unlockAudio()} title="المتصفّح لا يُصدر صوتاً قبل أوّل لمسة على الصفحة">
            {audioOn ? '🔔 التنبيه مفعّل' : '🔈 فعّل صوت التنبيه'}
          </button>
        </div>
      </div>

      {pushOffer && (
        <div className="dk-push" role="region" aria-label="التنبيهات">
          <span>🔔 تفعيل التنبيهات؟ يصلك إشعار حين يحضر مريض وعيادتك فارغة — ولو كانت الشاشة مطفأة.</span>
          <div className="dk-push-actions">
            <button type="button" onClick={async () => {
              setPushOffer(false)
              const ok = await enablePush(api.push)
              if (ok) showToast('فُعّلت التنبيهات', 'success', 3000)
            }}>تفعيل</button>
            <button type="button" className="ghost" onClick={() => { dismissPushOffer(); setPushOffer(false) }}>لاحقاً</button>
          </div>
        </div>
      )}

      {toast}

      {!queue ? (loadErr ? (
        <div className="load-failed">
          <p className="error">{loadErr}</p>
          <button className="ghost" onClick={loadQueue}>إعادة المحاولة</button>
        </div>
      ) : <p className="empty">جارٍ التحميل…</p>) : (
        <div className="dk-grid">
          <section className="dk-queue" aria-label="المرضى">
            <div className="dk-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'present'} className="dk-tab"
                onClick={() => setTab('present')}>
                الموجودون <span className="dk-tab-count">{presentCount.toLocaleString('ar-SY')}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'bookings'} className="dk-tab"
                onClick={() => setTab('bookings')}>
                الحجوزات <span className="dk-tab-count">{bookings.length.toLocaleString('ar-SY')}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'work'} className="dk-tab"
                onClick={() => setTab('work')}>
                أعمالي
              </button>
            </div>

            {tab === 'work' ? (
              <MyWork reloadKey={workKey} pending={unpaidLines} onRemove={remove} />
            ) : tab === 'bookings' ? (
              <div className="card dk-bookings" role="tabpanel">
                {bookings.length === 0 ? <p className="empty">لا حجوزات منتظرة</p> : (
                  <ul className="dk-book-list">
                    {bookings.map((a) => (
                      <li key={a.id} className="dk-book">
                        <span className="dk-book-time" dir="ltr">{timeOf(a) || '—'}</span>
                        <span className="dk-book-name">{a.full_name}</span>
                        <span className="dk-book-ref">حجز {a.queue_number}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div role="tabpanel">
                {/* ═══ النجم: من قيد الكشف ═══ */}
                <div className={`card dk-current${current ? '' : ' is-empty'}`}>
                  <h3 className="dk-current-label">قيد الكشف الآن</h3>
                  {current ? (
                    <>
                      <div className="dk-current-who">
                        <span className="dk-current-num">الدور {shownNumber(current)}</span>
                        {attendance && <AttendanceBadge priority={current.priority} />}
                        <span className="dk-current-name">{current.full_name}</span>
                        {current.reason && <span className="dk-current-note">ملاحظة الحجز: {current.reason}</span>}
                        {attendance && current.started_at && (
                          <span className="dk-current-note">بدأ الكشف {fmtClock(current.started_at)}</span>
                        )}
                      </div>
                      <AddedProcedures added={current.procedures} pending={pendingFor(current.id)} />
                      {/* ═══ هرم الأزرار ═══ زرٌّ أساسيّ واحد بحسب الحالة: نُودي ولم يبدأ ⇒ «بدء الكشف»،
                          كشفٌ شغّال ⇒ «إنهاء الكشف». «+ إجراء» ثانويٌّ واضح أصغر منه، و«إعادة النداء»
                          و«خروج مؤقت» خفيفان تحتهما. كلّها ≥48px لمساً.
                          ★ بدء الكشف منفصل عن النداء: بين النداء ودخول المريض الغرفة دقائق لا تُحسب من
                          الكشف. ونمط الخانات بلا «بدء» — فالأساسيّ فيه «إنهاء» دائماً. */}
                      {(() => {
                        const needsStart = attendance && !current.started_at
                        return (
                          <div className="dk-actions">
                            {needsStart ? (
                              <button className="dk-btn dk-primary dk-btn-start" disabled={busy}
                                onClick={() => act(api.clinic.start, current.id)}>
                                <span aria-hidden="true">▶</span> بدء الكشف
                              </button>
                            ) : (
                              <button className="dk-btn dk-primary dk-btn-done" disabled={busy}
                                onClick={() => act(api.clinic.done, current.id)}>
                                إنهاء الكشف
                              </button>
                            )}
                            <button type="button" className="dk-btn dk-secondary dk-btn-add" onClick={() => openSheet(current)}>
                              <span aria-hidden="true">＋</span> إجراء
                            </button>
                            <div className="dk-tertiary">
                              <RecallButton apptId={current.id} onError={showToast} className="ghost dk-btn dk-light" />
                              <button className="ghost dk-btn dk-light" disabled={busy}
                                title="المريض يخرج (قطرة، صورة…) ويعود بدوره — وتنادي التالي"
                                onClick={() => act(api.clinic.stepOut, current.id)}>
                                <span aria-hidden="true">⏸</span> خروج مؤقت
                              </button>
                              {/* إنهاءٌ بلا بدء ممكن (يُستبعد من حساب المدة) — خفيفٌ هنا لا ينافس «بدء» */}
                              {needsStart && (
                                <button className="ghost dk-btn dk-light" disabled={busy}
                                  onClick={() => act(api.clinic.done, current.id)}>
                                  إنهاء
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <p className="empty">لا أحد قيد الكشف حالياً.</p>
                  )}
                </div>

                {/* ═══ بانتظار العودة ═══ */}
                {returning.length > 0 && (
                  <div className="card wr-card">
                    <h3>بانتظار العودة <span className="wr-count">{returning.length}</span></h3>
                    <ul className="wr-list">
                      {returning.map((a) => (
                        <li key={a.id} className="wr-item">
                          <span className="wr-num">الدور {shownNumber(a)}</span>
                          <span className="wr-name">{a.full_name}</span>
                          <Elapsed since={a.stepped_out_at} offset={offset} />
                          <button className="ghost wr-call dk-tap" disabled={busy || !!current}
                            onClick={() => act(api.clinic.returnCall, a.id)}>
                            نداء
                          </button>
                        </li>
                      ))}
                    </ul>
                    {current && (
                      <p className="wr-hint">أنهِ الكشف الحالي أو اجعله «خروجاً مؤقتاً» قبل نداء العودة.</p>
                    )}
                  </div>
                )}

                <div className="card dk-next">
                  <h3>التالي في الدور</h3>
                  {nextUp ? (
                    <div className="dk-next-row">
                      <div>
                        <div className="dk-next-who">
                          الدور {shownNumber(nextUp)} — {nextUp.full_name}
                          {attendance && <AttendanceBadge priority={nextUp.priority} />}
                        </div>
                        {nextUp.reason && <div className="dk-next-note">{nextUp.reason}</div>}
                      </div>
                      <div className="dk-next-actions">
                        <button className="dk-tap" disabled={busy || !!current} onClick={() => act(api.clinic.call, nextUp.id)}>
                          نادِ التالي
                        </button>
                        <button className="ghost dk-tap" disabled={busy} onClick={() => act(api.clinic.noShow, nextUp.id)}>
                          لم يحضر
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="empty">لا أحد حاضر بانتظار الدور بعد.</p>
                  )}
                  {current && nextUp && (
                    <p className="dk-hint">أنهِ الكشف الحالي أولاً قبل استدعاء التالي.</p>
                  )}
                </div>

                <div className="card">
                  <h3>الحاضرون بانتظار الدور ({arrivedWaiting.length.toLocaleString('ar-SY')})</h3>
                  {arrivedWaiting.length === 0 ? (
                    <p className="empty">لا أحد بانتظار الدور.</p>
                  ) : (
                    <ul className="dk-wait-list">
                      {arrivedWaiting.map((a) => (
                        <li key={a.id} className={['dk-wait', a.id === nextUp?.id ? 'is-next' : '',
                          attendance ? urgentRowClass(a) : ''].filter(Boolean).join(' ')}>
                          <span className="dk-wait-num">{shownNumber(a)}</span>
                          <span className="dk-wait-name">{a.full_name}{attendance && <AttendanceBadge priority={a.priority} />}</span>
                          {a.id === nextUp?.id && <span className="doc-next-tag">التالي</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>

        </div>
      )}

      {sheetAppt && (
        <AddProcedureSheet appt={sheetAppt} catalog={catalog} usage={mine?.usage || {}}
          matCatalog={matCatalog} loadMaterials={loadMaterials}
          draft={draft} setDraft={setDraft} onConfirm={confirmAdd} onClose={() => setSheetFor(null)} />
      )}
    </div>
  )
}
