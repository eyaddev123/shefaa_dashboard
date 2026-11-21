import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtTime, todayLocal, openStaffStream } from '../api.js'
import VisitType from '../components/VisitType.jsx'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock, fmtTimeOfDay } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'
import {
  WAITING_RETURN, waitingReturnOf, serverOffsetOf, queueWithReturnees, isBackInQueue, useServerNow, isLate,
} from '../waiting-return.jsx'
import { ReturnState } from '../waiting-return-ui.jsx'
import BottomSheet from '../components/BottomSheet.jsx'
import { ProcedureOnlyBadge } from '../components/ProcedureOnly.jsx'
import MaterialsEditor, { qtyValid, toPayload, materialsValue } from '../components/MaterialsEditor.jsx'
import { useFeeMode } from '../fee-mode.js'
import ConsumablesCounter, { CONSUMABLES_HINT } from '../components/ConsumablesCounter.jsx'
import QuantityStepper from '../components/QuantityStepper.jsx'
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
//     الدور» (أوّله «التالي»، وزرّ «بدء كشف» له في شريط النداء) و«حجوزات لم تحضر بعد» مطويّة. عمودٌ على الجوال.
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
// ★ خطوتان (طلب المستخدم 2026-11-18: «المواد مو واضحة أبداً — تحت بآخر الورقة»): الخطوة 1 الشبكة
//   وحدها و«التالي: المواد (n)»، والخطوة 2 بطاقةٌ لكلّ إجراءٍ مختار فيها قائمة المواد المنسدلة
//   والمستهلكات، ثمّ «إضافة (n)» — أو «إضافة بلا مواد (n)» إن لم يختر شيئاً (المواد اختيارية دائماً).
// draft: { selected: [{id, name, mats, cons}], step, errorId, error } — يبقى في الأب فيعود كما كان إن رُفض.
// الأسعار (طلب المستخدم 2026-11-16): سعر كلّ إجراءٍ تحت اسمه، وسعر **البيع** لكلّ مادة ومبلغ سطرها،
// وتحت المختار مجموعٌ: «على المريض» = مجموع أسعار الإجراءات (ما يدفعه فعلاً)، و«المواد بسعر البيع»
// سطرٌ وحده — المواد تُخصم من سعر الإجراء داخلياً ولا تُضاف على المريض، فجمعها معه كان يكذب.
// ★ بعد قلبة «أجرة + مواد» (2026-11-17): السعر أجرة الإيد، والمستهلكات والمواد **فوقها** على المريض —
//   فـ«على المريض» = الأجور + المستهلكات + المواد، وتحته تفصيله.
function AddProcedureSheet({ appt, catalog, usage, matCatalog, loadMaterials, draft, setDraft, onConfirm, onClose }) {
  const { since: feeMode } = useFeeMode()
  // المواد تُحمَّل مع فتح الورقة: قائمتها المنسدلة تظهر فوراً تحت كلّ إجراءٍ مختار (طلب المستخدم 2026-11-17:
  // «المواد على كبسة ما طلعت واضحة — تطلع فوراً dropdown مع بحث»؛ كانت خلف زرّ «+ مواد»)
  useEffect(() => { loadMaterials() }, [])
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
      : [...d.selected, { id: p.id, name: p.name, mats: [], cons: 0, qty: 1 }] }))
  const valid = sel.length > 0 && sel.every((x) => qtyValid(x.mats))
  const priceOf = (id) => Number((catalog || []).find((p) => String(p.id) === String(id))?.price || 0)
  // العدد (2026-11-22): «× 4» ⇒ الأجرة × العدد (بعد القلبة وحدها؛ قبلها سطرٌ واحد)
  const qtyOf = (x) => (feeMode ? Number(x.qty) || 1 : 1)
  const procTotal = sel.reduce((t, x) => t + priceOf(x.id) * qtyOf(x), 0)
  const matTotal = sel.reduce((t, x) => t + materialsValue(x.mats, matCatalog), 0)
  // عدّاد المستهلكات لكلّ إجراءٍ مختار (بعد القلبة) — تقديرٌ يضعه الدكتور
  const consTotal = feeMode ? sel.reduce((t, x) => t + Number(x.cons || 0), 0) : 0
  const onPatient = feeMode ? procTotal + consTotal + matTotal : procTotal
  const step = draft.step === 2 && sel.length > 0 ? 2 : 1
  const setStep = (n) => setDraft((d) => ({ ...d, step: n }))
  const anyMats = sel.some((x) => x.mats.length > 0 || x.cons)
  const n = sel.length.toLocaleString('ar-SY-u-nu-latn')
  return (
    <BottomSheet title={step === 1 ? `إجراء لـ ${appt.full_name}` : `المواد — ${appt.full_name}`}
      subtitle={step === 1 ? 'الخطوة 1 من 2: علّم الإجراءات، ثمّ «التالي: المواد»'
        : 'الخطوة 2 من 2: أضف المواد والمستهلكات لكلّ إجراء، ثمّ «إضافة»'}
      onClose={onClose}
      footer={step === 1 ? (
        <button type="button" className="dk-confirm" disabled={sel.length === 0} onClick={() => setStep(2)}>
          التالي: المواد ({n}) ←
        </button>
      ) : (
        <>
          {sel.length > 0 && (
            <div className="dk-total" role="status">
              <span>على المريض <strong>{fmtMoney(onPatient)}</strong></span>
              {feeMode
                ? (consTotal + matTotal > 0 && <span className="dk-total-mats">
                    الأجرة {fmtMoney(procTotal)}{consTotal > 0 && ` + مستهلكات ${fmtMoney(consTotal)}`}{matTotal > 0 && ` + مواد ${fmtMoney(matTotal)}`}</span>)
                : matTotal > 0 && <span className="dk-total-mats">المواد بسعر البيع {fmtMoney(matTotal)}</span>}
            </div>
          )}
          <button type="button" className="dk-confirm" disabled={!valid} onClick={onConfirm}>
            {anyMats ? `إضافة (${n})` : `إضافة بلا مواد (${n})`}
          </button>
        </>
      )}>
      {draft.error && <p className="error dk-sheet-error" role="alert">{draft.error}</p>}
      {step === 1 && (catalog == null ? <p className="empty">جارٍ التحميل…</p>
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
                  <span className="dk-pick-price">{fmtMoney(p.price)}</span>
                  {added && <span className="dk-pick-tag">✓ مضاف</span>}
                </button>
              )
            })}
          </div>
        ))}
      {step === 2 && (
        <button type="button" className="ghost dk-step-back" onClick={() => setStep(1)}>→ رجوع للإجراءات</button>
      )}
      {step === 2 && (
        <ul className="dk-sel">
          {sel.map((x) => (
            <li key={x.id} className={`dk-sel-item${String(draft.errorId) === String(x.id) ? ' is-bad' : ''}`}>
              {/* رأس البطاقة: الإجراء وأجرته، ومجموع موادّه ومستهلكاته حين توجد (جولة التصميم 2026-11-18) */}
              <div className="dk-sel-row">
                <span className="dk-sel-name">{x.name}{qtyOf(x) > 1 && <b className="dk-sel-qty"> × {qtyOf(x)}</b>}</span>
                <span className="dk-sel-price">
                  {fmtMoney(priceOf(x.id) * qtyOf(x))}
                  {feeMode && materialsValue(x.mats, matCatalog) + Number(x.cons || 0) > 0 && (
                    <small> + مواد {fmtMoney(materialsValue(x.mats, matCatalog) + Number(x.cons || 0))}</small>
                  )}
                </span>
              </div>
              {/* العدد: الإجراء نفسه بالقعدة أكثر من مرّة — «تخطيط أعصاب طرف × 4» (بعد القلبة) */}
              {feeMode && (
                <QuantityStepper value={x.qty || 1} unitPrice={priceOf(x.id)} onChange={(qty) => update(x.id, { qty })} />
              )}
              <div className="dk-mats-body">
                {matCatalog == null ? <p className="empty">جارٍ تحميل المواد…</p>
                  // القائمة منسدلة ظاهرة دائماً: الكبسة تعرض المواد كلّها والكتابة تُرشّحها، ومع كلّ مادة سعر بيعها
                  : <MaterialsEditor withPrice comboHint="المواد: اكتب اسم مادة للبحث، أو المس لعرضها كلّها…" catalog={matCatalog} value={x.mats} onChange={(mats) => update(x.id, { mats })} />}
                {!qtyValid(x.mats) && <p className="error">صحّح الكمّية (رقم أكبر من صفر).</p>}
              </div>
              {feeMode && (
                <ConsumablesCounter hint={false} value={x.cons || 0} onChange={(cons) => update(x.id, { cons })} />
              )}
            </li>
          ))}
        </ul>
      )}
      {step === 2 && feeMode && <p className="cons-hint">{CONSUMABLES_HINT}</p>}
    </BottomSheet>
  )
}

// ═══ «+ مواد» على إجراءٍ مضاف — زيادةٌ فقط (قرار المستخدم 2026-11-18) ═══
// «يمكن يضيف الإجراء وما يعرف قديش استخدامات، بس يخلص إجراء يضيف المواد تبعته». ما في السطر يظهر
// نصّاً لا يُعدَّل، وتحته قائمة المواد المنسدلة للإضافة: مادةٌ موجودة تُختار ثانيةً ⇒ تُجمع كمّيتها.
// والمستهلكات (بعد القلبة) لا تنزل عن قيمتها. التنقيص والحذف وما بعد الدفع من الاستقبال — والخادم
// يحرس الثلاثة (DOCTOR_NO_DECREASE، DOCTOR_LINE_PAID، يوم الجلسة).
function AddMaterialsSheet({ lines, patientName, matCatalog, loadMaterials, onClose, onSaved }) {
  useEffect(() => { loadMaterials() }, [])
  const [picked, setPicked] = useState(lines.length === 1 ? lines[0] : null)
  if (!picked) return (
    <BottomSheet title="مواد لأيّ إجراء؟" subtitle={patientName} onClose={onClose}>
      <div className="dk-pick-grid">
        {lines.map((l) => (
          <button key={l.id} type="button" className="dk-pick" onClick={() => setPicked(l)}>
            <span className="dk-pick-name">{l.name}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
  return <MaterialsForLine line={picked} patientName={patientName} matCatalog={matCatalog}
    onBack={lines.length > 1 ? () => setPicked(null) : null} onClose={onClose} onSaved={onSaved} />
}

function MaterialsForLine({ line, patientName, matCatalog, onBack, onClose, onSaved }) {
  const v3 = line.fee !== null && line.fee !== undefined
  const oldCons = Number(line.consumables || 0)
  const [extra, setExtra] = useState([])
  const [cons, setCons] = useState(oldCons)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const existing = line.materials || []
  const more = materialsValue(extra, matCatalog) + (v3 ? cons - oldCons : 0)
  const changed = extra.length > 0 || cons !== oldCons
  const save = async () => {
    setSaving(true); setError(null)
    // القائمة كاملةً (الخادم يستبدلها): الموجود + الإضافات، والمادة المكرّرة تُجمع كمّيتها
    const merged = new Map(existing.map((m) => [String(m.material_id), Number(m.qty)]))
    for (const m of toPayload(extra)) merged.set(String(m.material_id), (merged.get(String(m.material_id)) || 0) + m.qty)
    try {
      await api.clinic.setLineMaterials(line.appointment_id, line.id, {
        materials: [...merged].map(([id, qty]) => ({ material_id: Number(id), qty: Math.round(qty * 100) / 100 })),
        ...(v3 && cons !== oldCons ? { consumables: cons } : {}),
      })
      onSaved(line)
    } catch (ex) { setError(ex.message); setSaving(false) }
  }
  return (
    <BottomSheet title={`مواد «${line.name}»`} subtitle={patientName}
      onClose={onClose}
      footer={(
        <>
          {v3 && more > 0 && (
            <div className="dk-total" role="status"><span>يزيد على المريض <strong>{fmtMoney(more)}</strong></span></div>
          )}
          <button type="button" className="dk-confirm" disabled={!changed || !qtyValid(extra) || saving} onClick={save}>
            {saving ? 'يُحفظ…' : 'حفظ المواد'}
          </button>
        </>
      )}>
      {error && <p className="error dk-sheet-error" role="alert">{error}</p>}
      {onBack && <button type="button" className="ghost dk-step-back" onClick={onBack}>→ إجراءٌ آخر</button>}
      <p className="dk-mats-now">
        {existing.length === 0 ? 'لا مواد عليه بعد.'
          : <>عليه الآن: {existing.map((m) => `${m.name} ×${Number(m.qty)}`).join('، ')}</>}
      </p>
      <div className="dk-mats-body">
        {matCatalog == null ? <p className="empty">جارٍ تحميل المواد…</p>
          : <MaterialsEditor withPrice comboHint="أضف مادة: اكتب اسمها للبحث، أو المس لعرضها كلّها…" catalog={matCatalog} value={extra} onChange={setExtra} />}
        {!qtyValid(extra) && <p className="error">صحّح الكمّية (رقم أكبر من صفر).</p>}
      </div>
      {v3 && (
        <ConsumablesCounter hint={false} value={cons} onChange={(v) => setCons(Math.max(oldCons, v))} />
      )}
      <p className="cons-hint">تقدر تزيد بس. التنقيص أو الحذف من الاستقبال.</p>
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

function TodayBar({ lines, toast, onMaterials }) {
  const [open, setOpen] = useState(false)
  const startY = useRef(null)
  const swiped = useRef(false)
  // العدد (2026-11-22): «× 4» أربعة إجراءات
  const qtyOf = (l) => Number(l.quantity) || 1
  const paid = lines.filter((l) => l.paid_at).reduce((t, l) => t + qtyOf(l), 0)
  const pending = lines.filter((l) => !l.paid_at).reduce((t, l) => t + qtyOf(l), 0)
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
            {/* «،» لا «·»: النقطة الوسطى بجانب رقمٍ هنديّ تُقرأ صفراً («0 ·» ⇐ «00») */}
            إجراءات اليوم: تمت محاسبة {paid.toLocaleString('ar-SY-u-nu-latn')}، وبانتظار المحاسبة {pending.toLocaleString('ar-SY-u-nu-latn')}
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
                {!l.paid_at && onMaterials && (
                  <button type="button" className="dk-mats-btn" tabIndex={open ? 0 : -1}
                    onClick={() => onMaterials(l)}>+ مواد</button>
                )}
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
  // «أحتاج ممرضة»: طلبٌ واحد قائم أو لا — يومض عند الاستقبال حتى تكبس «أرسلنا ممرضة»
  const [nurse, setNurse] = useState(null)       // null = لم يُحمَّل، false = لا طلب، {requested_at} = قائم
  const [mine, setMine] = useState(null)
  const [adding, setAdding] = useState([])          // إضافاتٌ متفائلة: {tempId, appointment_id, name}
  const [sheetFor, setSheetFor] = useState(null)    // id الحجز الذي تُضاف له
  const [matsFor, setMatsFor] = useState(null)      // «+ مواد»: { lines, patient } — زيادة مواد إجراءٍ مضاف
  const emptyDraft = { selected: [], step: 1, errorId: null, error: null }
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
  useEffect(() => { api.clinic.myProfile().then(setProfile).catch(() => setProfile({})) }, [])
  const loadNurse = useCallback(() => api.clinic.nurseCalls().then((d) => setNurse(d.calls[0] || false))
    .catch(() => setNurse(false)), [])
  useEffect(() => { loadNurse() }, [loadNurse])

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
  // ردّ الاستقبال على طلب الممرضة (أو إلغاؤه من جهازٍ آخر) — حدثٌ بلا جلسة على بثّ الموظفين
  useEffect(() => {
    if (!profile?.id) return undefined
    return openStaffStream((name, data) => {
      if (name !== 'nurse_call' || String(data?.doctor_id) !== String(profile.id)) return
      if (data.action === 'ack') {
        setNurse(false)
        showToast(`الممرضة في الطريق${data.by ? ` — أرسلتها ${data.by}` : ''}`, 'success', 6000)
      } else loadNurse()
    })
  }, [profile?.id, loadNurse, showToast])
  const toggleNurse = async () => {
    try {
      if (nurse) { await api.clinic.cancelNurseCall(); setNurse(false); showToast('أُلغي طلب الممرضة', 'success', 3000) }
      else { setNurse(await api.clinic.nurseCall()); showToast('طُلبت ممرضة — يظهر الطلب عند الاستقبال الآن', 'success', 4000) }
    } catch (ex) { showToast(ex.message) }
  }

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
    else if (fresh.length > 1) showToast(`رجع ${fresh.length.toLocaleString('ar-SY-u-nu-latn')} من الخروج المؤقت — على الدور`, 'success', 6000)
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
    const temps = chosen.map((x, i) => ({ tempId: `t${Date.now()}-${i}`, appointment_id: apptId,
      name: Number(x.qty) > 1 ? `${x.name} × ${x.qty}` : x.name }))
    setSheetFor(null)
    setAdding((a) => [...a, ...temps])
    try {
      await api.clinic.addAppointmentProcedures(apptId, chosen.map((x) => ({ procedure_id: x.id, materials: toPayload(x.mats),
        ...(x.cons ? { consumables: x.cons } : {}), ...(Number(x.qty) > 1 ? { quantity: Number(x.qty) } : {}) })))
      setDraft(emptyDraft)
      showToast(chosen.length === 1 ? `أُضيف «${chosen[0].name}» — بانتظار المحاسبة`
        : `أُضيفت ${chosen.length.toLocaleString('ar-SY-u-nu-latn')} إجراءات — بانتظار المحاسبة`, 'success', 3500)
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
  // صفحته الأولى (لا «لوحة قيادة» للطبيب): يومٌ بلا جلسة يبقى صفحةً بعنوانها، ومنها إلى مرضاه
  if (sessions.length === 0) return (
    <div className="dk">
      <div className="dk-top"><div><h2>شاشتي</h2><p className="subtitle">لا جلسات لك اليوم.</p></div></div>
      <div className="card dk-current is-empty">
        <p className="empty">لا دوام لك اليوم. مرضاك السابقون وسجلّاتهم في <Link to="/clinic/my-patients">«مرضاي»</Link>.</p>
      </div>
    </div>
  )

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
          {/* «أحتاج ممرضة»: كبسةٌ تطلب، والثانية تُلغي — والطلب القائم ظاهرٌ بحدّه حتى تُجيب الاستقبال */}
          <button type="button" className={`ghost dk-tool dk-nurse${nurse ? ' is-on' : ''}`} disabled={nurse === null}
            onClick={toggleNurse} title={nurse ? 'الطلب ظاهرٌ عند الاستقبال — اكبس لإلغائه' : 'يومض عند الاستقبال: الدكتور يحتاج ممرضة'}>
            {nurse ? 'طُلبت ممرضة — إلغاء' : 'أحتاج ممرضة'}
          </button>
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
          {/* «بدء كشف» بجانبه بالحجم نفسه (طلب المستخدم 2026-11-18: «إذا فات المريض فوراً خليه يعمل
              بداية كشف بدون ما ينادي») — للتالي نفسه، بلا نداء ولا صوت في الصالة؛ والعائد يكمّل كشفه */}
          <div className="dk-callbar-btns">
            <button type="button" className="dk-callbar-btn" disabled={busy || !!current || !nextUp}
              onClick={() => act(nextIsBack ? api.clinic.returnCall : api.clinic.call, nextUp.id)}>
              نادِ التالي
            </button>
            <button type="button" className="ghost dk-callbar-btn dk-callbar-start" disabled={busy || !!current || !nextUp}
              title="المريض دخل وحده — يبدأ كشفه بلا نداء ولا صوت في الصالة"
              onClick={() => (nextIsBack
                ? act(api.clinic.resume, nextUp.id, { ok: `بدأ كشف الدور ${shownNumber(nextUp)} (بلا نداء)`, undo: 'resume' })
                : act(api.clinic.walkIn, nextUp.id, { ok: `بدأ كشف الدور ${shownNumber(nextUp)} (بلا نداء)`, undo: 'walk_in' }))}>
              بدء كشف
            </button>
          </div>
        </div>

        <div className="dk-grid">
          <section className="dk-main" aria-label="عندك الآن">
            {/* ═══ عندك الآن ═══ زرٌّ أساسيٌّ واحد مُعبّأ بحسب الحالة («بدء كشف» لمن نودي، «إنهاء
                الكشف» لمن بدأ) والباقي بإطار — كلّها بحجمٍ عاديّ يناسب التابلت (44px لمساً). */}
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
                        كامل، وتحته البقيّة بعرضٍ متساوٍ بلا زرٍّ يتيم: أربعةٌ ⇒ 2×2 في بطاقةٍ ضيّقة (جوال،
                        عمودا التابلت)، وثلاثةٌ ⇒ صفٌّ واحد. والبطاقة العريضة (لابتوب) ⇒ كلّها صفٌّ واحد،
                        الأساسيّ أعرض. القرار بعرض البطاقة نفسها (container query) لا بعرض الشاشة. */}
                    {(() => {
                      // «+ إجراء» و«+ مواد» صفٌّ وحدهما بحجمٍ واحد (طلب المستخدم 2026-11-18: المواد واضحة)؛
                      // «+ مواد» لما لم يُقبض من إجراءاته — وأكثر من واحد ⇒ الورقة تسأل على أيّها أوّلاً
                      const matLines = (current.procedures || []).filter((l) => !l.removed_at && !l.paid_at)
                      const procRow = withProcedures && (
                        <div className="dk-proc-row">
                          <button type="button" className="ghost dk-btn dk-btn-add" onClick={() => openSheet(current)}>
                            + إجراء
                          </button>
                          <button type="button" className="ghost dk-btn dk-btn-add" disabled={matLines.length === 0}
                            title={matLines.length === 0 ? 'أضف إجراءً أولاً — المواد تُضاف على إجراء' : 'مواد ومستهلكات على إجراءٍ أضفته'}
                            onClick={() => setMatsFor({ lines: matLines.map((l) => ({ ...l, appointment_id: current.id })), patient: current.full_name })}>
                            + مواد
                          </button>
                        </div>
                      )
                      const more = [
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
                          <div className="dk-side">
                            {procRow}
                            <div className="dk-more" data-n={more.length} style={{ '--n': more.length }}>{more}</div>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              })() : (
                <p className="empty">لا أحد عندك الآن{nextUp ? ' — نادِ التالي أو ابدأ كشفه من الأعلى' : ''}.</p>
              )}
            </div>

            {/* ═══ خارج العيادة مؤقتاً ═══ من ما زال خارجاً (أو تأخّر) وحاله. من رجع ينتقل إلى الدور
                ويُنادى من الزرّ الثابت. على السطر «بدء كشف» لمن دخل الغرفة مباشرةً (بلا نداء)، و«إنهاء»
                لمن خرج لقطرة فأكمل وذهب (المتأخّر لم يُكشف عليه أصلاً فلا «إنهاء» له). */}
            {stillOut.length > 0 && (
              <div className="card wr-card">
                <h3 className="dk-sec">خارج العيادة مؤقتاً <span className="dk-count">({stillOut.length.toLocaleString('ar-SY-u-nu-latn')})</span></h3>
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
                  onClick={() => setSide('line')}>بانتظار الدور <span className="dk-count">{line.length.toLocaleString('ar-SY-u-nu-latn')}</span></button>
                <button type="button" role="tab" aria-selected={side === 'bookings'} className={side === 'bookings' ? 'is-on' : ''}
                  onClick={() => setSide('bookings')}>محجوزون لم يصلوا بعد <span className="dk-count">{bookings.length.toLocaleString('ar-SY-u-nu-latn')}</span></button>
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
                        {/* «بدء كشف» انتقل لشريط النداء (2026-11-18) — هنا كلمة «التالي» وحدها */}
                        {isNext && (
                          <span className="dk-next-actions">
                            <span className="doc-next-tag">التالي</span>
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

      {withProcedures ? <TodayBar lines={todayLines} toast={toast} onMaterials={(l) => setMatsFor({ lines: [l], patient: l.patient_name })} />
        : toast && <div className="dk-toast-float">{toast}</div>}

      {matsFor && (
        <AddMaterialsSheet key={matsFor.lines.map((l) => l.id).join()} lines={matsFor.lines} patientName={matsFor.patient}
          matCatalog={matCatalog} loadMaterials={loadMaterials} onClose={() => setMatsFor(null)}
          onSaved={(l) => {
            setMatsFor(null)
            showToast(`حُفظت مواد «${l.name}» — بانتظار المحاسبة`, 'success', 3500)
            loadQueue(); loadMine()
          }} />
      )}

      {sheetAppt && (
        <AddProcedureSheet appt={sheetAppt} catalog={catalog} usage={mine?.usage || {}}
          matCatalog={matCatalog} loadMaterials={loadMaterials}
          draft={draft} setDraft={setDraft} onConfirm={confirmAdd} onClose={() => setSheetFor(null)} />
      )}
    </div>
  )
}
