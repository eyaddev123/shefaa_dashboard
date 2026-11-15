import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtTime, todayLocal, openStaffStream } from '../api.js'
import VisitType from '../components/VisitType.jsx'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock, fmtTimeOfDay } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'
import {
  WAITING_RETURN, waitingReturnOf, serverOffsetOf, queueWithReturnees, isBackInQueue, useServerNow, isLate,
} from '../waiting-return.jsx'
import { ReturnState, ReturnModeField, returnModeOf, returnModeValue } from '../waiting-return-ui.jsx'
import BottomSheet from '../components/BottomSheet.jsx'
import { ProcedureOnlyBadge } from '../components/ProcedureOnly.jsx'
import MaterialsEditor, { qtyValid, toPayload } from '../components/MaterialsEditor.jsx'
import {
  ringDoctor, primeOnFirstGesture, onAudioState, audioReady, unlockAudio,
  shouldOfferPush, dismissPushOffer, enablePush, refreshPush,
} from '../doctor-alert.js'

// ═══════════════════════════════════════════════════════════════════
// شاشة الطبيب («شاشتي») — صفحته الأولى، بلا تبويبات (doctor-pages-redesign، 2026-11-15)
//
// أطبّاء على تابلت: لا «برقعة ألوان» ولا فقاعات ولا أزرار عملاقة (طلب المستخدم). بطاقاتٌ محايدة،
// لونٌ مُعبّأ للزرّ الأساسيّ وحده، الشارات كلماتٌ صغيرة، والأزرار ٤٤px.
//   • «نادِ التالي» شريطٌ ثابت أعلى الشاشة يقول من التالي — النداء من هنا وحده.
//   • عمودان من ٨٢٠px (التابلت عمودياً وأفقياً): «عندك الآن» و«خارج العيادة مؤقتاً» | «بانتظار
//     الدور» (أوّله «التالي» وعليه «بدء كشف» وحده) و«حجوزات لم تحضر بعد» مطويّة. عمودٌ على الجوال.
//   • بجانب كلّ اسم: نوع الزيارة (معاينة/مراجعة) وشاراته — كلماتٌ لا فقاعات.
//   • «+ إجراء» وشريط «إجراءات اليوم» لمن لاختصاصه إجراءات وحده (has_procedures من /my-profile)؛
//     والصفحة تُفسح للشريط تحتها فلا يغطّي الأزرار على الجوال. ورقة الإضافة كما كانت (تحديدٌ
//     متعدّد ثمّ «إضافة (n)»، ومواد اختيارية لكلّ إجراء).
//   • الإضافة والحذف متفائلان: يظهران فوراً، ويتراجعان برسالة واضحة إن رفض الخادم.
//
// ★ ولا رقمٌ ماليّ في «الموجودون» و«الحجوزات» وبطاقة المريض (المريض أمام الشاشة): سطر الإجراء
//   اسمٌ ومؤشّر لون (✓ أخضر محاسَب، ⏳ أصفر بانتظار المحاسبة)، ولا في الشريط السفلي بوضعيه.
//   test:doctor-payment يفحص DOM الشاشة كلّها (التبويبين والشريط مسكّراً وممدّداً).
// ★ الرنّة: حدث idle_arrival من الخادم وحده يقرّر (حضورٌ والعيادة فارغة تماماً) — انظر doctor-alert.js.
// ═══════════════════════════════════════════════════════════════════


// ما أُضيف على المريض الحالي — سطرٌ نصّيّ هادئ: الاسم وحالة المحاسبة كلمةً صغيرة (لا فقاعات ملوّنة)
function AddedProcedures({ added = [], pending = [] }) {
  const live = (added || []).filter((l) => !l.removed_at)
  if (live.length === 0 && pending.length === 0) return null
  return (
    <ul className="dk-procs" aria-label="الإجراءات المضافة">
      {live.map((l) => (
        <li key={l.id} className={`dk-proc ${l.paid_at ? 'is-paid' : 'is-unpaid'}`}>
          {l.name} <small>{l.paid_at ? 'تمت المحاسبة' : 'بانتظار المحاسبة'}</small>
        </li>
      ))}
      {pending.map((p) => (
        <li key={p.tempId} className="dk-proc is-adding" aria-busy="true">
          <span className="dk-spin" aria-hidden="true" /> {p.name} <small>تُضاف…</small>
        </li>
      ))}
    </ul>
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

// ═══ شريط «إجراءات اليوم» — سفليٌّ ثابت، يتمدّد لفوق ═══
// مسكّراً: سطرٌ بنقطتين ملوّنتين وعددين (أو «لا إجراءات اليوم»). لمسةٌ أو سحبةٌ لفوق تمدّه حتى
// نصف الشاشة بتمريرٍ داخلي: المريض، الإجراء، شارة الحالة — الأحدث فوق. لمسةٌ على الرأس أو سحبةٌ
// لتحت تُعيده سطراً. ولا رقمٌ ماليّ فيه أبداً (الأسطر من my-procedures ولا يُعرض منها مبلغ).
const SWIPE = 30
// مريضٌ «فعّال» واحد (منادى أو قيد الكشف): أزرار الإدخال كلّها معطّلة ما دام موجوداً، وتحتها هذه
// الجملة نفسها. والخادم يرفض بـ DOCTOR_BUSY إن وصله طلبٌ رغم ذلك (شاشةٌ متأخّرة، جهازٌ ثانٍ).
const ACTIVE_HINT = 'أنهِ الكشف الحالي أولاً قبل نداء التالي أو بدء كشف مريض.'

function TodayBar({ lines, toast }) {
  const [open, setOpen] = useState(false)
  const startY = useRef(null)
  const swiped = useRef(false)
  const paid = lines.filter((l) => l.paid_at).length
  const pending = lines.length - paid
  const down = (e) => { startY.current = e.clientY; swiped.current = false }
  const up = (e) => {
    if (startY.current == null) return
    const dy = e.clientY - startY.current
    startY.current = null
    if (dy > SWIPE && open) { setOpen(false); swiped.current = true }
    else if (dy < -SWIPE && !open) { setOpen(true); swiped.current = true }
  }
  return (
    <div className={`dk-today${open ? ' is-open' : ''}`}>
      {/* الإشعار (ومعه «تراجع») شريطٌ ملتصقٌ بأعلى هذا الشريط: بعرضه، لا يطفو فوق المحتوى */}
      {toast && <div className="dk-toast-strip">{toast}</div>}
      <button type="button" className="dk-today-head" aria-expanded={open} aria-controls="dk-today-body"
        onPointerDown={down} onPointerUp={up}
        onClick={() => { if (!swiped.current) setOpen((v) => !v); swiped.current = false }}>
        <span className="dk-today-grip" aria-hidden="true" />
        {lines.length === 0 ? <span className="dk-today-sum">لا إجراءات اليوم</span> : (
          <span className="dk-today-sum">
            {/* «،» لا «·»: النقطة الوسطى بجانب رقمٍ هنديّ تُقرأ صفراً («٠ ·» ⇐ «٠٠») */}
            إجراءات اليوم: تمت محاسبة {paid.toLocaleString('ar-SY')}، وبانتظار المحاسبة {pending.toLocaleString('ar-SY')}
          </span>
        )}
        <span className="dk-today-caret" aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      <div id="dk-today-body" className="dk-today-body" aria-hidden={!open}>
        {lines.length === 0 ? <p className="empty">لا إجراءات اليوم بعد.</p> : (
          <ul className="dk-today-list">
            {lines.map((l) => (
              <li key={l.id} className="dk-today-item">
                <div className="dk-today-who">
                  <span className="dk-today-patient">{l.patient_name}</span>
                  <span className="dk-today-proc">{l.name}</span>
                </div>
                <span className={`dk-today-state ${l.paid_at ? 'is-paid' : 'is-unpaid'}`}>
                  {l.paid_at ? 'تمت المحاسبة' : 'بانتظار المحاسبة'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function DoctorScreen() {
  const [sessions, setSessions] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [queue, setQueue] = useState(null)
  // ★ الخطأ لا يستبدل الشاشة. loadErr لأوّل تحميل فقط (لا بيانات تُعرض بعد) ومعه زرّ
  // إعادة المحاولة؛ وأي خطأ بعدها — زرٌّ رُفض أو تحديثٌ دوري انقطع — إشعارٌ عابر
  // والطابور الأخير باقٍ.
  const [loadErr, setLoadErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, showToast] = useToast()
  // has_procedures من اختصاصه (الخادم): بلا إجراءات ⇒ لا «+ إجراء» ولا شريط «إجراءات اليوم»
  const [profile, setProfile] = useState(null)
  // عمود الدور: «بانتظار الدور» أو «محجوزون لم يحضروا» — مبدِّلٌ ثابت أعلى البطاقة، فالحجوزات لا تُدفع
  // لأسفل الشاشة حين يطول الدور (ملاحظة المستخدم: عشرة حاضرين أخفوا الحاجزين)
  const [side, setSide] = useState('line')
  const [mine, setMine] = useState(null)
  const [adding, setAdding] = useState([])          // إضافاتٌ متفائلة: {tempId, appointment_id, name}
  const [sheetFor, setSheetFor] = useState(null)    // id الحجز الذي تُضاف له
  const emptyDraft = { selected: [], errorId: null, error: null }
  const [draft, setDraft] = useState(emptyDraft)     // المختار في الورقة — يعود كما كان إن رُفض
  const [catalog, setCatalog] = useState(null)
  const [matCatalog, setMatCatalog] = useState(null)
  const [audioOn, setAudioOn] = useState(audioReady())
  const [pushOffer, setPushOffer] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadSessions = () => api.clinic.mySessions(todayLocal()).then((rows) => {
    setSessions(rows); setLoadErr(null)
    if (!sessionId && rows.length) setSessionId(rows[0].id)
  }).catch((e) => setLoadErr(e.message))
  useEffect(() => { loadSessions() }, [])
  useEffect(() => { api.clinic.myProfile().then(setProfile).catch(() => setProfile({})) }, [])

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
        if (name === 'procedure' || name === 'visit') handlers.current.loadMine()
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

  // ok: رسالة النجاح، undo: نوع التراجع ('walk_in' | 'start' | 'resume' | 'done') — زرّ «تراجع» في الإشعار
  const act = async (fn, apptId, { ok, undo } = {}) => {
    setBusy(true)
    try {
      await fn(apptId)
      if (ok) showToast(ok, 'success', undo ? 10000 : 3500, undo ? {
        label: 'تراجع',
        run: () => act((id) => api.clinic.undoFlow(id, undo), apptId, { ok: 'تمّ التراجع' }),
      } : null)
    }
    catch (ex) { showToast(ex.message) }
    // بعد النجاح والفشل معاً: الرفض (409) يعني غالباً أن الطابور تغيّر من شاشة أخرى
    finally { setBusy(false); loadQueue() }
  }

  // ═══ «رجع على الدور» — ساعة الخادم، وإشعارٌ لمن رجع ═══
  // الاستقبال تكبس «رجع» (يصل بالبثّ) أو يحلّ وقت الرجوع التلقائي (الساعة تتحدّث عنده):
  // إشعارٌ صامت «الدور ٨ رجع على الدور» — بلا رنّة، فالطبيب مع مريض. لا عند أوّل تحميل.
  const serverNow = useServerNow(queue?.appointments, serverOffsetOf(queue))
  const backSeen = useRef(null)
  useEffect(() => {
    const list = queue?.appointments || []
    const ids = new Set(list.filter((a) => isBackInQueue(a, serverNow)).map((a) => String(a.id)))
    const prev = backSeen.current
    backSeen.current = { session: queue?.id, ids }
    if (!prev || String(prev.session) !== String(queue?.id)) return
    const fresh = list.filter((a) => ids.has(String(a.id)) && !prev.ids.has(String(a.id)))
    if (fresh.length === 1) showToast(`الدور ${shownNumber(fresh[0])} رجع من الخروج المؤقت — على الدور`, 'success', 6000)
    else if (fresh.length > 1) showToast(`رجع ${fresh.length.toLocaleString('ar-SY')} من الخروج المؤقت — على الدور`, 'success', 6000)
  }, [queue, serverNow])

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
  const todayLines = useMemo(() => mine?.lines || [], [mine])

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
  // خرجوا مؤقتاً (قطرة، صورة…) — ليسوا في الطابور ولا «قيد الكشف» حتى يرجعوا على الدور
  const returning = waitingReturnOf(appts)
  const stillOut = returning.filter((a) => !isBackInQueue(a, serverNow))
  // الدور الفعلي: الإسعافي ثمّ العائدون ثمّ الحاضرون — والنداء من الزرّ العلوي وحده
  const line = queueWithReturnees(arrivedWaiting, appts, serverNow)
  const nextUp = line[0]
  const nextIsBack = nextUp?.status === WAITING_RETURN
  const offset = serverOffsetOf(queue)
  // «الحجوزات»: محجوزو الجلسة الذين لم يحضروا بعد — بالوقت التقريبي/الخانة ثمّ رقم الحجز
  const timeOf = (a) => (attendance ? fmtTimeOfDay(a.estimated_time) : (a.slot_time ? fmtTime(a.slot_time) : null))
  const bookings = appts.filter((a) => a.status === 'waiting')
    .sort((a, b) => (timeOf(a) || '99').localeCompare(timeOf(b) || '99') || a.queue_number - b.queue_number)
  const pendingFor = (id) => adding.filter((p) => String(p.appointment_id) === String(id))
  const sheetAppt = sheetFor && appts.find((a) => String(a.id) === String(sheetFor))
  // false صريحاً وحده يُخفي (فشل التحميل أو ردٌّ بلا الحقل ⇒ تبقى الإجراءات كما كانت)
  const withProcedures = profile?.has_procedures !== false || todayLines.length > 0
  const session = sessions.find((s) => String(s.id) === String(sessionId))
  // شارات المريض نصٌّ صغير: نوع الزيارة (معاينة/مراجعة — طلب المستخدم)، الأولوية (إسعافي…)،
  // «إجراء فقط»، و«عائد/تأخّر»
  const tags = (a) => (
    <>
      <VisitType appt={a} />
      {attendance && <AttendanceBadge priority={a.priority} />}
      <ProcedureOnlyBadge appt={a} />
      {a.status === WAITING_RETURN && (
        <span className={`dk-tag${isLate(a) ? ' is-late' : ''}`}>{isLate(a) ? 'تأخّر ثمّ وصل' : 'عائد — يكمّل كشفه'}</span>
      )}
    </>
  )

  return (
    <div className={`dk${withProcedures ? ' has-bar' : ''}${toast ? ' has-toast' : ''}`}>
      <div className="dk-top">
        <div>
          <h2>شاشتي</h2>
          <p className="subtitle">
            {session ? <>جلسة اليوم <bdi dir="ltr">{fmtTime(session.start_time)} – {fmtTime(session.end_time)}</bdi></> : 'جلسة اليوم'}
          </p>
        </div>
        <div className="dk-top-tools">
          {sessions.length > 1 && (
            <select aria-label="الجلسة" value={sessionId || ''} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}{s.apologized ? ' (معتذر)' : ''}</option>
              ))}
            </select>
          )}
          <button type="button" className="ghost dk-tool dk-settings-btn" onClick={() => setSettingsOpen(true)}>الإعدادات</button>
          {/* ★ يبقى مكانه بعد التفعيل (تتبدّل حالته لا يختفي): أوّل لمسة في الصفحة تفتح الصوت،
              واختفاء الزرّ بين ضغطها ورفعها كان يُزيح الصفحة فتضيع اللمسة عن هدفها */}
          <button type="button" className={`ghost dk-tool dk-audio${audioOn ? ' is-on' : ''}`} disabled={audioOn}
            onClick={() => unlockAudio()} title="المتصفّح لا يُصدر صوتاً قبل أوّل لمسة على الصفحة">
            {audioOn ? 'التنبيه الصوتي يعمل' : 'تفعيل التنبيه الصوتي'}
          </button>
        </div>
      </div>

      {/* الاعتذار ليوم الجلسة: تبقى الجلسة ظاهرة لصاحبها، ولا تبدو جلسةً عادية */}
      {session?.apologized && (
        <p className="dk-apology" role="status">
          <strong>معتذر</strong> هذه الجلسة عليها اعتذار: الحجز عليها ممنوع، وحجوزاتها القائمة تتواصل معها المشرفة.
        </p>
      )}

      {pushOffer && (
        <div className="dk-push" role="region" aria-label="التنبيهات">
          <span>تفعيل التنبيهات؟ يصلك إشعار حين يحضر مريض وعيادتك فارغة — ولو كانت الشاشة مطفأة.</span>
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

      {!queue ? (loadErr ? (
        <div className="load-failed">
          <p className="error">{loadErr}</p>
          <button className="ghost" onClick={loadQueue}>إعادة المحاولة</button>
        </div>
      ) : <p className="empty">جارٍ التحميل…</p>) : (
        <>
        {/* ═══ «نادِ التالي» — زرٌّ واحد ثابت أعلى الشاشة ═══ مكانه لا يتحرّك مهما تغيّرت القوائم
            تحته (يلتصق بالأعلى عند التمرير). ينادي «التالي» أيّاً كان — حاضراً أو عائداً من خروج
            مؤقت (نداء العودة). ولا نداء عند أيّ مريض. */}
        <div className="dk-callbar" role="region" aria-label="النداء">
          <span className="dk-callbar-who">
            {current ? ACTIVE_HINT
              : nextUp ? <>التالي: <strong>الدور {shownNumber(nextUp)}</strong> — {nextUp.full_name} <VisitType appt={nextUp} /></>
              : 'لا أحد بانتظار الدور'}
          </span>
          <button type="button" className="dk-callbar-btn" disabled={busy || !!current || !nextUp}
            onClick={() => act(nextIsBack ? api.clinic.returnCall : api.clinic.call, nextUp.id)}>
            نادِ التالي
          </button>
        </div>

        <div className="dk-grid">
          <section className="dk-main" aria-label="عندك الآن">
            {/* ═══ عندك الآن ═══ زرٌّ أساسيٌّ واحد مُعبّأ بحسب الحالة («بدء كشف» لمن نودي، «إنهاء
                الكشف» لمن بدأ) والباقي بإطار — كلّها بحجمٍ عاديّ يناسب التابلت (٤٤px لمساً). */}
            <div className={`card dk-current${current ? '' : ' is-empty'}`}>
              <h3 className="dk-sec">عندك الآن</h3>
              {current ? (() => {
                const needsStart = attendance && !current.started_at
                return (
                  <>
                    <div className="dk-current-who">
                      <span className="dk-current-num">الدور {shownNumber(current)}</span>
                      <span className="dk-current-name">{current.full_name}</span>
                      {tags(current)}
                    </div>
                    <p className="dk-current-meta">
                      {needsStart ? <>نودي{current.served_at ? <> {fmtClock(current.served_at)}</> : ''} — لم يدخل بعد</>
                        : attendance && current.started_at ? <>بدأ الكشف {fmtClock(current.started_at)}</> : null}
                      {current.reason && <span className="dk-current-note">ملاحظة الحجز: {current.reason}</span>}
                    </p>
                    <AddedProcedures added={current.procedures} pending={pendingFor(current.id)} />
                    {/* ═══ الأزرار: نظامٌ واحد لكلّ الشاشات ═══ الأساسيّ («بدء كشف» أو «إنهاء الكشف») سطرٌ
                        كامل، وتحته البقيّة بعرضٍ متساوٍ بلا زرٍّ يتيم: أربعةٌ ⇒ ٢×٢ في بطاقةٍ ضيّقة (جوال،
                        عمودا التابلت)، وثلاثةٌ ⇒ صفٌّ واحد. والبطاقة العريضة (لابتوب) ⇒ كلّها صفٌّ واحد،
                        الأساسيّ أعرض. القرار بعرض البطاقة نفسها (container query) لا بعرض الشاشة. */}
                    {(() => {
                      const more = [
                        withProcedures && (
                          <button key="add" type="button" className="ghost dk-btn dk-btn-add" onClick={() => openSheet(current)}>
                            + إجراء
                          </button>
                        ),
                        <RecallButton key="recall" apptId={current.id} onError={showToast} icon={false} className="ghost dk-btn dk-light" />,
                        needsStart ? (
                          // نودي ولم يدخل ⇒ «تأخّر المريض» (لا «لم يحضر»: من قطع بطاقته حاضر). يخرج من الدور
                          // لحين تكبس الاستقبال «رجع» فيصير التالي — وتنادي غيره الآن.
                          <button key="late" className="ghost dk-btn dk-light" disabled={busy}
                            title="نودي ولم يدخل — يرجع على الدور حين تخبر الاستقبال أنه وصل، وتنادي التالي"
                            onClick={() => act(api.clinic.stepOut, current.id,
                              { ok: `الدور ${shownNumber(current)} تأخّر — يرجع على الدور حين تخبرك الاستقبال` })}>
                            تأخّر المريض
                          </button>
                        ) : (
                          // من دخل وبدأ كشفه ⇒ «خروج مؤقت» (قطرة، صورة…) بإعداد الدكتور
                          <button key="out" className="ghost dk-btn dk-light" disabled={busy}
                            title="المريض يخرج (قطرة، صورة…) ويعود بدوره — وتنادي التالي"
                            onClick={() => act(api.clinic.stepOut, current.id)}>
                            خروج مؤقت
                          </button>
                        ),
                        // إنهاءٌ بلا بدء ممكن (يُستبعد من حساب المدة) — ثانويٌّ هنا لا ينافس «بدء»
                        needsStart && (
                          <button key="end" className="ghost dk-btn dk-light" disabled={busy}
                            title="المريض دخل وخرج — يُنهى بلا نداء"
                            onClick={() => act(api.clinic.done, current.id, { ok: 'انتهى الكشف', undo: 'done' })}>
                            إنهاء كشف
                          </button>
                        ),
                      ].filter(Boolean)
                      return (
                        <div className="dk-actions">
                          {needsStart ? (
                            <button className="dk-btn dk-primary dk-btn-start" disabled={busy}
                              title="المريض دخل الغرفة — يبدأ الكشف بلا نداء جديد"
                              onClick={() => act(api.clinic.start, current.id, { ok: 'بدأ الكشف', undo: 'start' })}>
                              بدء كشف
                            </button>
                          ) : (
                            <button className="dk-btn dk-primary dk-btn-done" disabled={busy}
                              onClick={() => act(api.clinic.done, current.id, { ok: 'انتهى الكشف', undo: 'done' })}>
                              إنهاء الكشف
                            </button>
                          )}
                          <div className="dk-more" data-n={more.length} style={{ '--n': more.length }}>{more}</div>
                        </div>
                      )
                    })()}
                  </>
                )
              })() : (
                <p className="empty">لا أحد عندك الآن{nextUp ? ' — نادِ التالي من الأعلى' : ''}.</p>
              )}
            </div>

            {/* ═══ خارج العيادة مؤقتاً ═══ من ما زال خارجاً (أو تأخّر) وحاله. من رجع ينتقل إلى الدور
                ويُنادى من الزرّ الثابت. على السطر «بدء كشف» لمن دخل الغرفة مباشرةً (بلا نداء)، و«إنهاء»
                لمن خرج لقطرة فأكمل وذهب (المتأخّر لم يُكشف عليه أصلاً فلا «إنهاء» له). */}
            {stillOut.length > 0 && (
              <div className="card wr-card">
                <h3 className="dk-sec">خارج العيادة مؤقتاً <span className="dk-count">({stillOut.length.toLocaleString('ar-SY')})</span></h3>
                <ul className="wr-list">
                  {stillOut.map((a) => (
                    <li key={a.id} className="wr-item">
                      <span className="wr-num">الدور {shownNumber(a)}</span>
                      <span className="wr-name">{a.full_name}<ProcedureOnlyBadge appt={a} />
                        {isLate(a) && <span className="dk-tag is-late">تأخّر</span>}</span>
                      <ReturnState appt={a} offset={offset} />
                      <span className="wr-btns">
                        <button className="ghost wr-call dk-tap" disabled={busy || !!current}
                          title="المريض دخل الغرفة — يبدأ كشفه بلا نداء ولا صوت في الصالة"
                          onClick={() => act(api.clinic.resume, a.id, { ok: `بدأ كشف الدور ${shownNumber(a)} (بلا نداء)`, undo: 'resume' })}>
                          بدء كشف
                        </button>
                        {!isLate(a) && (
                          <button className="ghost wr-call dk-tap" disabled={busy}
                            title="أكمل وذهب — يُنهى كشفه بلا رجوع"
                            onClick={() => act(api.clinic.done, a.id, { ok: `انتهى كشف الدور ${shownNumber(a)}`, undo: 'done' })}>
                            إنهاء كشف
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="dk-side" aria-label="بانتظار الدور">
            {/* ═══ بانتظار الدور | محجوزون لم يحضروا ═══ مبدِّلٌ واحد أعلى البطاقة بعدّادَيه — كلاهما ظاهرٌ
                مهما طال الدور. «بانتظار الدور» بالترتيب الفعلي (الإسعافي ثمّ العائدون ثمّ الحاضرون)، أوّله
                «التالي» وعليه «بدء كشف» وحده؛ والبقية للعرض بلا أزرار. والمحجوزون للاطّلاع. */}
            <div className="card dk-waiting">
              <div className="dk-switch" role="tablist" aria-label="المرضى">
                <button type="button" role="tab" aria-selected={side === 'line'} className={side === 'line' ? 'is-on' : ''}
                  onClick={() => setSide('line')}>بانتظار الدور <span className="dk-count">{line.length.toLocaleString('ar-SY')}</span></button>
                <button type="button" role="tab" aria-selected={side === 'bookings'} className={side === 'bookings' ? 'is-on' : ''}
                  onClick={() => setSide('bookings')}>محجوزون لم يحضروا <span className="dk-count">{bookings.length.toLocaleString('ar-SY')}</span></button>
              </div>
              {side === 'bookings' ? (
                bookings.length === 0 ? <p className="empty">لا حجوزات بانتظار الحضور.</p> : (
                  <ul className="dk-book-list dk-bookings" role="tabpanel">
                    {bookings.map((a) => (
                      <li key={a.id} className="dk-book">
                        <span className="dk-book-time" dir="ltr">{timeOf(a) || '—'}</span>
                        <span className="dk-book-name">{a.full_name}<VisitType appt={a} /><ProcedureOnlyBadge appt={a} /></span>
                        <span className="dk-book-ref">حجز {a.queue_number}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : line.length === 0 ? (
                <p className="empty">لا أحد حاضر بانتظار الدور.</p>
              ) : (
                <ul className="dk-wait-list" role="tabpanel">
                  {line.map((a) => {
                    const isNext = a.id === nextUp?.id
                    return (
                      <li key={a.id} className={['dk-wait', isNext ? 'is-next dk-next' : '',
                        attendance ? urgentRowClass(a) : ''].filter(Boolean).join(' ')}>
                        <span className="dk-wait-num">{shownNumber(a)}</span>
                        <span className={`dk-wait-name${isNext ? ' dk-next-who' : ''}`}>
                          {a.full_name}{tags(a)}
                          {isNext && a.reason && <small className="dk-next-note">{a.reason}</small>}
                        </span>
                        {isNext && (
                          <span className="dk-next-actions">
                            <span className="doc-next-tag">التالي</span>
                            <button className="ghost dk-tap" disabled={busy || !!current}
                              title="المريض دخل وحده — يبدأ كشفه بلا نداء ولا صوت في الصالة"
                              onClick={() => (nextIsBack
                                ? act(api.clinic.resume, a.id, { ok: `بدأ كشف الدور ${shownNumber(a)} (بلا نداء)`, undo: 'resume' })
                                : act(api.clinic.walkIn, a.id, { ok: `بدأ كشف الدور ${shownNumber(a)} (بلا نداء)`, undo: 'walk_in' }))}>
                              بدء كشف
                            </button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
        </>
      )}

      {withProcedures ? <TodayBar lines={todayLines} toast={toast} />
        : toast && <div className="dk-toast-float">{toast}</div>}

      {settingsOpen && <MySettingsSheet onClose={() => setSettingsOpen(false)} onSaved={(m) => showToast(m, 'success', 4000)} />}

      {sheetAppt && (
        <AddProcedureSheet appt={sheetAppt} catalog={catalog} usage={mine?.usage || {}}
          matCatalog={matCatalog} loadMaterials={loadMaterials}
          draft={draft} setDraft={setDraft} onConfirm={confirmAdd} onClose={() => setSheetFor(null)} />
      )}
    </div>
  )
}

// ═══ «إعداداتي» — ما يضبطه الدكتور لنفسه ═══
// الخروج المؤقت: «لحين ما تخبّر الاستقبال» أو «يرجع تلقائياً بعد كذا دقيقة» — المدّة يكتبها هو
// (أو المشرفة من البروفايل). الإعداد نفسه، والتغيير في سجلّ الدكتور بفاعله.
function MySettingsSheet({ onClose, onSaved }) {
  const [value, setValue] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.clinic.mySettings().then((r) => setValue(returnModeOf(r.return_after_minutes))).catch((e) => setErr(e.message))
  }, [])
  const save = async () => {
    const v = returnModeValue(value)
    if (v === undefined) return   // التنبيه تحت الحقل مباشرةً (ReturnModeField)
    setErr(null); setBusy(true)
    try {
      const r = await api.clinic.saveMySettings({ return_after_minutes: v })
      onSaved(r.return_after_minutes == null ? 'حُفظ: الخروج المؤقت لحين ما تخبّر الاستقبال'
        : `حُفظ: يرجع على الدور تلقائياً بعد ${Number(r.return_after_minutes).toLocaleString('ar-SY')} دقيقة`)
      onClose()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <BottomSheet title="إعداداتي" subtitle="تخصّك وحدك — والمشرفة تراها في بروفايلك" onClose={onClose}
      footer={value && (
        <div className="dk-settings-foot">
          <button type="button" disabled={busy} onClick={save}>حفظ</button>
          <button type="button" className="ghost" onClick={onClose}>إلغاء</button>
        </div>
      )}>
      {value ? <ReturnModeField value={value} onChange={(v) => { setValue(v); setErr(null) }} name="my_return_mode" />
        : !err && <p className="empty">جارٍ التحميل…</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </BottomSheet>
  )
}
