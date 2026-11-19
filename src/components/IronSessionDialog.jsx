import { useEffect, useRef, useState } from 'react'
import { api, cleanMobile, mobileError } from '../api.js'
import MobileInput from './MobileInput.jsx'
import { usePatientSearch, PatientDropdown, SameNameConfirm, MobileUpdateAsk, blockedName, nameCharsError } from './PatientPicker.jsx'
import { Modal } from './inventory/shared.jsx'
import Combobox, { byNameAr } from './Combobox.jsx'
import { readAmountInput } from '../iron-shares.js'
import MaterialsEditor, { qtyValid, toPayload } from './MaterialsEditor.jsx'
import ConsumablesCounter from './ConsumablesCounter.jsx'
import { useDialogs } from '../dialogs.jsx'
import { useRole } from '../RoleContext.jsx'
import { canSeeInventory, canWriteIronSettings } from '../permissions.js'
import { ironReceiptFrom, loadPrinter, printTicket } from '../ticket-print.js'
import { printViaHelper } from '../print-helper.js'
import { ReferralRow, useReferralOptions } from './ReferralFields.jsx'
import { blankReferral, referralReady, ironReferralPayload, ironDraftDiscount, draftFromIronReferral } from '../referral.js'

// ═══ تسجيل جلسة خدمة عيادة (حديد، رذاذ، تحاليل…) — نافذة الاستقبال ═══
// ★ منذ 2026-11-19: الخدمة من الكتالوج أوّلاً (initialServiceId من زرّها في رأس الصفحة، أو تُختار هنا حين يكون
//   في الكتالوج أكثر من خدمة). منها السعر — واحدٌ أو سعران (مع/بلا دوا) — وهل لها دكتور: الخدمة بلا حصّة دكتور
//   لا يظهر لها حقل الدكتور، والخدمة بسعرٍ واحد لا يظهر لها «النوع».
// ★ المشمول (جولة 2): باختيار الخدمة والنوع تُعبّأ المواد المشمولة بسعرها (للجلسة الجديدة، ما لم تُغيَّر المواد يدوياً)،
//   وما يُصرف فوقها على المريض بسعر البيع: المبلغ من الخادم (/clinic/iron/quote) — الاستقبال لا يرى سعر مادة إلا هنا،
//   ثمنَ الزيادة التي تقبضها.
// ★ «أجرة + مواد» (جولة 3، بعد القلبة opts.fee_mode — أو جلسةٌ بالإصدار 3 في التعديل): أجرة الخدمة وحدها، وكلّ
//   المواد (والدواء منها) وعدّاد المستهلكات فوقها على المريض. «المواد المعتادة» تُعبّأ وحدها ولا أثر لها بالسعر.
// تسجيلٌ وقبضٌ بضغطةٍ واحدة: لا دور ولا عيادة ولا حجز. «مع/بلا دوا» يحدّد السعر وحده، والخادم هو من
// يحسبه ويوزّعه. «مع/بلا دوا» والممرضة بلا اختيارٍ مسبق: تغيّران المبلغ والمستحقات، فلا يمرّان بافتراضٍ
// لم يره أحد. والدكتور اختياري: الافتراض «بلا دكتور» وهو خيارٌ مكتوبٌ في القائمة.
// المواد بمحرّر نافذة الإجراء نفسه وبلا أسعار. وتنبيه «مع دوا بلا أمبولة» من الخادم: العتبة بأسعارٍ لا
// يراها الاستقبال، فيعود الطلب بسؤالٍ يُعاد إرساله بعد التأكيد.
// المريض بآلية الحجز نفسها: البحث فور ثلاث كلمات أو بالموبايل، والاختيار صريحٌ وله تراجع.
// ★ الترتيب مجموعاتٌ بالتسلسل: المريض ⇐ الطاقم ⇐ النوع ⇐ المواد ⇐ الحفظ، والمبلغ ظاهرٌ بجانب الزرّ.
// الحفظ لا يُعطَّل بنقصٍ: الضغط يبيّن الناقص تحت حقله. والنجاح يغلق النافذة (الرسالة والطباعة عند الصفحة)،
// والخطأ أو سؤال التأكيد يُبقيها مفتوحة.
// الإحالة اختيارية ومطويّة: ورقةٌ واحدة بلا نطاق (السعر كلّه). التوزيع من السعر الكامل لا يتغيّر، والمبلغ
// بجانب الزرّ هو ما يُقبض فعلاً (السعر − الخصم)؛ والخادم هو الحاسب — المعاينة هنا مرآته.
//
// ═══ وضع التعديل (session = سطر السجلّ، 2026-11-14) ═══
// النموذج نفسه معبّأً بالجلسة: المريض مختار (وله «ليس هو»)، والنوع والطاقم والمواد كما سُجّلت — والمواد المصروفة
// تُحسب في حدّ الرصيد (saved). سعر النوع الحاليّ سعرُ الجلسة نفسه، والآخر من الإعدادات. «ما سيتغيّر» يُعرض قبل الحفظ،
// والفرق في المبلغ (يُقبض أو يُردّ)، والسبب إلزاميّ. الإحالة وتعديل الحصص لهما أزرارهما في تفاصيل الجلسة.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY-u-nu-latn')
const NO_DOCTOR = 'بلا دكتور / محوّل من خارج الجمعية'
// الإغلاق لا يسبق هذه المدّة: ثانية ضغطتين سريعتين لا تقع على زرٍّ في السجلّ تحت النافذة
const MIN_CLOSE_MS = 300
const isThreePart = (v) => v.trim().split(/\s+/).filter(Boolean).length >= 3
// حقول الخادم (field في ردّ الخطأ) بأسماء النموذج
const SERVER_FIELDS = { service_id: 'service', full_name: 'name', mobile: 'mobile', nurse_id: 'nurse', doctor_id: 'doctor', with_drug: 'with_drug', reason: 'ov_reason', edit_reason: 'edit_reason', doctor_share: 'ov_doctor', nurse_share: 'ov_nurse',
  'referral.referral_source_id': 'referral', 'referral.discount_type': 'referral', 'referral.discount_value': 'referral' }
// بترتيب ظهورها: التركيز ينزل لأوّل ناقص
const FOCUS_ORDER = [['service', '#iron-service'], ['name', '#iron-name'], ['mobile', '#iron-mobile'], ['nurse', '#iron-nurse'], ['doctor', '#iron-doctor'], ['with_drug', '.iron-choice'],
  ['materials', '.mat-qty.is-bad'], ['referral', '#iron-ref-source'], ['ov_doctor', '#iron-ov-doctor'], ['ov_nurse', '#iron-ov-nurse'], ['ov_reason', '#iron-ov-reason'],
  ['edit_reason', '#iron-edit-reason']]

async function printReceipt(session, copies) {
  const printer = loadPrinter()
  const data = ironReceiptFrom(session)
  const r = await printViaHelper(data, printer.width, undefined, undefined, { copies })
  if (r.ok) return { ok: true }
  return printTicket(data, printer.width, undefined, { copies })
}

export { printReceipt as printIronReceipt }

function FieldError({ id, msg }) {
  return msg ? <small id={id} className="iron-err" role="alert">{msg}</small> : null
}

function Section({ n, title, note, children }) {
  return (
    <section className="iron-sec" aria-label={title}>
      <h4 className="iron-sec-head"><span className="iron-sec-n" aria-hidden="true">{n}</span>{title}{note && <span className="opt">{note}</span>}</h4>
      {children}
    </section>
  )
}

function DrugChoice({ value, prices, onPick }) {
  const opt = (v, label, price) => (
    <button key={label} type="button" role="radio" aria-checked={value === v}
      className={`iron-choice${value === v ? ' is-on' : ''}`} onClick={() => onPick(v)}>
      <span className="iron-choice-label">{label}</span>
      <span className="iron-choice-price">{fmtNum(price)} <small>ل.س</small></span>
    </button>
  )
  return (
    <div className="iron-choices" role="radiogroup" aria-label="الدواء">
      {opt(false, 'بلا دواء', prices.without_drug)}
      {opt(true, 'مع دواء', prices.with_drug)}
    </div>
  )
}

/** اختيار الخدمة: قائمةٌ منسدلة بالبحث (الكتالوج قد يبلغ عشرين خدمة — طلب المستخدم: لا مربّعات) */
const servicePriceText = (s) => (s.dual ? `${fmtNum(s.prices.without_drug)} / ${fmtNum(s.prices.with_drug)} ل.س` : `${fmtNum(s.prices.without_drug)} ل.س`)

/**
 * ما سيتغيّر في الجلسة بالكلام — مرآة ما يكتبه الخادم في أثرها (iron_session_edits)، للعرض قبل الحفظ.
 * @returns {{key:string, label:string, old:string|null, new:string|null}[]}
 */
function changeList({ session, picked, name, nurseId, doctorId, withDrug, items, price, opts, service }) {
  const out = []
  const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name
  const add = (key, label, o, n) => out.push({ key, label, old: o, new: n })
  if (service && session.serviceId && String(service.id) !== String(session.serviceId)) add('service', 'الخدمة', session.service, service.name)
  if (picked ? String(picked.id) !== String(session.patientId) : name.trim() !== '') add('patient', 'المريض', session.patient, picked ? picked.full_name : name.trim())
  if (String(nurseId) !== String(session.nurseId)) add('nurse', 'الممرضة', session.nurse, nameOf(opts.nurses, nurseId) || '—')
  if (String(doctorId || '') !== String(session.doctorId || '')) add('doctor', 'الدكتور', session.doctor || 'بلا دكتور', doctorId ? nameOf(opts.doctors, doctorId) || '—' : 'بلا دكتور')
  if (withDrug !== null && withDrug !== session.withDrug && (service?.dual || session.serviceDual !== false)) add('with_drug', 'النوع', session.withDrug ? 'مع دواء' : 'بلا دواء', withDrug ? 'مع دواء' : 'بلا دواء')
  if (price !== null && price !== session.price) add('price', 'السعر', fmtNum(session.price), fmtNum(price))
  const before = new Map(session.materials.map((m) => [String(m.material_id), m]))
  const after = new Map(items.map((m) => [String(m.material_id), m]))
  for (const [id, m] of before) {
    const n = after.get(id)
    if (!n) add(`m-${id}`, m.name, `${fmtNum(m.qty)} ${m.unit}`, null)
    else if (Number(n.qty) !== Number(m.qty)) add(`m-${id}`, m.name, `${fmtNum(m.qty)} ${m.unit}`, `${fmtNum(Number(n.qty) || 0)} ${m.unit}`)
  }
  for (const [id, n] of after) if (!before.has(id)) add(`m-${id}`, n.name, null, `${fmtNum(Number(n.qty) || 0)} ${n.unit}`)
  return out
}

/** «ما سيتغيّر»: سطرٌ لكلّ تغيير — القديم مشطوبٌ والجديد بجانبه */
function ChangePreview({ changes }) {
  if (changes.length === 0) return <p className="iron-chg-none">لم تغيّري شيئاً بعد.</p>
  return (
    <ul className="iron-chg" aria-label="ما سيتغيّر">
      {changes.map((c) => (
        <li key={c.key}>
          <span className="iron-chg-k">{c.label}</span>
          {c.old === null ? <span className="iron-chg-add">يُضاف: {c.new}</span>
            : c.new === null ? <span className="iron-chg-del">يُحذف ({c.old})</span>
            : <><del>{c.old}</del><span aria-hidden="true">←</span><ins>{c.new}</ins></>}
        </li>
      ))}
    </ul>
  )
}

export default function IronSessionDialog({ onClose, onSaved, session = null, initialServiceId = null }) {
  const editing = session !== null
  const { clinicRole: role } = useRole()
  const canOverride = canWriteIronSettings(role)
  const dialogs = useDialogs()
  const [opts, setOpts] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const savedItems = useRef(editing ? session.materials.map((m) => ({ material_id: m.material_id, name: m.name, unit: m.unit, qty: String(m.qty) })) : [])
  const [items, setItems] = useState(savedItems.current)
  const [editReason, setEditReason] = useState('')
  const [override, setOverride] = useState(null)    // null | {doctor_share, nurse_share, reason}: للمشرفة وحدها
  const [referral, setReferral] = useState(null)    // null = بلا إحالة · مسوّدة ورقة (بلا نطاق)
  const refOpts = useReferralOptions(referral !== null)
  const [loadErr, setLoadErr] = useState(null)
  const [serviceId, setServiceId] = useState(editing ? session.serviceId : initialServiceId)
  const [withDrug, setWithDrug] = useState(editing ? session.withDrug : null)
  const [nurseId, setNurseId] = useState(editing ? session.nurseId : '')
  const [doctorId, setDoctorId] = useState(editing ? session.doctorId || '' : '')
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  // المريض: بحثٌ بأسماء فقط واختيارٌ صريح — لا اختيار تلقائي ولا قفل لخانة الرقم
  const patientSearch = usePatientSearch()
  const { picked } = patientSearch
  const [newConfirmed, setNewConfirmed] = useState(false)  // «نعم، مريض جديد» رغم اسمٍ مطابق
  const [sameName, setSameName] = useState(null)           // { matches, fromSubmit }
  const [mobileAsk, setMobileAsk] = useState(false)
  const [tried, setTried] = useState(false)         // ضُغط الحفظ: الأخطاء تظهر وتختفي مع التصحيح
  const [serverField, setServerField] = useState(null) // {field, msg}: خطأٌ من الخادم له حقل
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  // ضغطتان سريعتان تسبقان رسم الزرّ معطّلاً: جلستان ومالٌ مرّتين. القفل مرجعٌ لا حالة.
  const sending = useRef(false)

  const load = () => api.clinic.ironOptions().then((o) => {
    setOpts(o)
    // خدمةٌ واحدة فعّالة: هي المختارة (لا اختيار غيرها) — وأكثر: تُختار صراحةً أو من زرّها
    setServiceId((v) => v ?? (o.services?.length === 1 ? o.services[0].id : null))
  }).catch((e) => setLoadErr(e.message))
  useEffect(() => {
    load()
    // التعديل: المريض مختارٌ من البداية — «ليس هو» يفتح البحث لغيره
    if (editing) pick({ id: session.patientId })
    // المشرفة من المخزون، والاستقبال من قائمة الاختيار (مسار المخزون 403 له): الاثنان بالرصيد، والاستقبال بلا سعر
    const read = canSeeInventory(role) ? api.inventory.materials().then((d) => d.materials) : api.clinic.materials()
    read.then((r) => setCatalog(r.filter((m) => m.is_active !== false && m.material_kind !== 'consumable').sort(byNameAr))).catch((e) => setLoadErr(e.message))
  }, [])

  const pick = async (c) => {
    setSameName(null); setMobileAsk(false); setErr(null)
    const p = await patientSearch.pick(c)
    // بعد «هو نفسه» تُعرض بياناته. ورقمٌ كُتب قبل الاختيار يبقى إن لم يكن له رقم (ويُسأل عنه)
    if (p) { setName(p.full_name); setMobile((m) => p.mobile || m) }
  }
  const undoPick = () => { patientSearch.reset(); setName(''); setMobile(''); setMobileAsk(false) }
  const onName = (v) => { setName(v); setNewConfirmed(false); setSameName(null); patientSearch.byName(v) }
  const onMobile = (v) => { setMobile(v); setMobileAsk(false) }
  const chooseNew = () => {
    if (patientSearch.exactNames.length) setSameName({ matches: patientSearch.exactNames, blocked: true, fromSubmit: false })
    else if (patientSearch.nearNames.length) setSameName({ matches: patientSearch.nearNames, fromSubmit: false })
    else { setNewConfirmed(true); patientSearch.dismiss() }
  }
  // «نعم، مريض جديد»: إن جاء السؤال من الحفظ نفسه، يُعاد الحفظ بالتأكيد فوراً
  // ومعها سنة الميلاد (إلزامية لـ«شخص آخر» باسمٍ قريب؛ لا خانة لها في هذا النموذج)
  const [newYear, setNewYear] = useState(null)
  const confirmNew = (year) => {
    const again = sameName?.fromSubmit
    setNewYear(year); setNewConfirmed(true); setSameName(null); patientSearch.dismiss()
    if (again) submit(null, null, true, year)
  }
  // رقمٌ مكتوب يختلف عن رقم المختار؟ (الفارغ ليس تغييراً)
  const pickedMobileDiffers = picked && cleanMobile(mobile) !== '' && cleanMobile(mobile) !== cleanMobile(picked.mobile || '')

  // الخدمة المختارة — والجلسة القائمة على خدمةٍ أُوقفت بعدها: تبقى لها بلقطتها
  const services = opts?.services || []
  const sameService = editing && String(serviceId) === String(session.serviceId)
  const service = services.find((x) => String(x.id) === String(serviceId))
    || (sameService ? { id: session.serviceId, name: session.service, dual: session.serviceDual !== false,
      prices: { without_drug: session.price, with_drug: session.price }, with_doctor: true } : null)
  const dual = !!service?.dual
  const kind = dual ? withDrug : service ? false : null
  // سعر النوع المسجَّل سعرُ الجلسة نفسه (لقطة)، والنوع الآخر والخدمة الأخرى من الكتالوج — كما يحسبه الخادم
  const sessBase = editing ? (session.basePrice ?? session.price) : null
  const prices = !opts || !service ? null : !sameService ? service.prices : {
    without_drug: session.withDrug ? service.prices.without_drug : sessBase,
    with_drug: session.withDrug ? sessBase : service.prices.with_drug }
  const basePrice = prices && kind !== null ? (kind ? prices.with_drug : prices.without_drug) : null
  // حقل الدكتور: للخدمة التي لها حصّة دكتور — أو جلسةٍ قائمة لها دكتور أصلاً (يُرفع منها)
  const showDoctor = !!service && (service.with_doctor || (sameService && !!session.doctorId))
  // ═══ المشمول والزيادة ═══
  // «أجرة + مواد»: بعد القلبة للجديدة، وبإصدار الجلسة للتعديل
  const feeMode = editing ? !!session.feeMode : !!opts?.fee_mode
  const [consumables, setConsumables] = useState(editing ? Number(session.consumables || 0) : 0)
  const included = service && kind !== null ? (service.included?.[kind && dual ? 'with' : 'without'] || []) : []
  const prefilled = useRef(null)   // آخر ما عُبّئ تلقائياً: يُستبدل بتغيير الخدمة/النوع ما لم تُغيَّر المواد يدوياً
  useEffect(() => {
    if (editing || !service || kind === null) return
    const same = (a, b) => JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b))
    if (items.length > 0 && !(prefilled.current && same(items, prefilled.current))) return
    const next = included.map((m) => ({ material_id: m.material_id, name: m.name, unit: m.unit, qty: String(m.qty) }))
    prefilled.current = next
    if (!same(items, next)) setItems(next)
  }, [serviceId, kind, opts])
  const [quote, setQuote] = useState(null)   // {key, extras_total, extras, price}
  const quoteKey = JSON.stringify([serviceId, kind, qtyValid(items) ? toPayload(items) : null, feeMode ? consumables : 0])
  useEffect(() => {
    if (!service || kind === null || !qtyValid(items) || !(service.charge_extras || editing || feeMode)) { setQuote(null); return }
    const t = setTimeout(() => {
      api.clinic.ironQuote({ service_id: service.id, with_drug: kind, materials: toPayload(items),
        ...(feeMode ? { consumables } : {}), ...(editing ? { session_id: session.id } : {}) })
        .then((q) => setQuote({ ...q, key: quoteKey })).catch(() => setQuote(null))
    }, 250)
    return () => clearTimeout(t)
  }, [quoteKey])
  const extras = quote && quote.key === quoteKey ? quote : null
  const extrasTotal = extras ? extras.extras_total : 0
  // المبلغ = الأساس + الزيادة (من المعاينة؛ وقبل وصولها في التعديل: زيادة الجلسة كما كانت إن لم تتغيّر المواد)
  // المبلغ ينتظر المعاينة حيث تُطلب (أجرة + مواد، أو زيادة على المريض، أو تعديل): رقمٌ ناقص المواد يضلّل
  const quoteWanted = !!service && kind !== null && qtyValid(items) && !!(service.charge_extras || editing || feeMode)
  const quotePending = quoteWanted && !extras
  const price = basePrice === null || quotePending ? null : basePrice + (extras ? extrasTotal : 0)
  // التعديل: إحالة الجلسة القائمة تُعاد على السعر الجديد (الخادم يحسبها) — والمعاينة مرآتها
  const editRef = editing && session.referral ? draftFromIronReferral(session.referral) : null
  const discount = editRef ? ironDraftDiscount(editRef, price) : referral ? ironDraftDiscount(referral, price) : 0
  const pay = price === null ? null : Math.max(0, price - discount)
  const oldPaid = editing ? (session.paid ?? session.price) : null
  const changes0 = editing && opts ? changeList({ session, picked, name, nurseId, doctorId: showDoctor ? doctorId : '', withDrug: kind, items, price, opts, service }) : []
  const changes = feeMode && editing && consumables !== Number(session.consumables || 0)
    ? [...changes0, { key: 'consumables', label: 'المستهلكات', old: fmtNum(session.consumables || 0), new: fmtNum(consumables) }] : changes0

  const validate = () => {
    const e = {}
    if (!service) e.service = 'اختاري الخدمة — منها يتحدّد المبلغ'
    if (!picked && !name.trim()) e.name = 'اكتبي اسم المريض'
    else if (!picked && !isThreePart(name)) e.name = 'الاسم الثلاثي مطلوب: الاسم واسم الأب والكنية'
    if ((!picked || pickedMobileDiffers) && mobileError(mobile)) e.mobile = mobileError(mobile)
    if (!nurseId) e.nurse = 'اختاري الممرضة'
    if (service && dual && withDrug === null) e.with_drug = 'اختاري النوع: مع دواء أو بلا دواء — منه يتحدّد المبلغ'
    if (!qtyValid(items)) e.materials = 'صحّحي الكمّية المعلَّمة: رقمٌ أكبر من صفر'
    if (editing && !editReason.trim()) e.edit_reason = 'اكتبي سبب التعديل — يُحفظ مع الجلسة'
    if (referral && !referralReady(referral))
      e.referral = !referral.referral_source_id ? 'اختاري الجهة المحيلة — أو ألغي «معه إحالة؟»' : 'قيمة الخصم رقمٌ أكبر من صفر (النسبة حتى 100%)'
    if (override) {
      const d = showDoctor && doctorId ? readAmountInput(override.doctor_share) : { empty: true }
      const n = readAmountInput(override.nurse_share)
      if (d.error) e.ov_doctor = 'مبلغٌ غير صالح'
      if (n.error) e.ov_nurse = 'مبلغٌ غير صالح'
      if (d.empty && n.empty) e[showDoctor && doctorId ? 'ov_doctor' : 'ov_nurse'] = 'اكتبي الحصّة المعدَّلة'
      if (!override.reason.trim()) e.ov_reason = 'سبب تعديل الحصّة مطلوب'
    }
    return e
  }
  const errors = {
    ...(tried ? validate() : {}),
    ...(serverField ? { [serverField.field]: serverField.msg } : {}),
  }
  const invalidProps = (key) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `iron-err-${key}` } : {})
  const focusFirst = (errs) => {
    const hit = FOCUS_ORDER.find(([k]) => errs[k])
    const el = hit && document.querySelector(`.iron-form ${hit[1]}`)
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center' }) }
  }

  const confirmLow = (message) => dialogs.confirm({
    title: 'تأكيد قبل الحفظ',
    body: `${message}\n\nإن أكّدتِ: ${editing ? 'يُحفظ التعديل' : `تُحفظ الجلسة ويُقبض ${fmtNum(pay)} ل.س`}، ${items.length === 0 ? 'ولا يُخصم شيء من المخزون' : 'ولا يُخصم من المخزون إلا ما أضفتِه'}، وتراها مشرفة العيادات معلَّمة «مع دواء بمواد قليلة — مؤكَّدة».\nإن رجعتِ: لا يُحفظ شيء، ويبقى ما كتبتِه لتعديله.`,
    confirmLabel: 'تأكيد وحفظ', cancelLabel: 'رجوع للتعديل',
  })

  const submit = async (e, mobileDecision = null, confirmedNew = false, yearNow = null) => {
    e?.preventDefault?.()
    if (sending.current) return
    setTried(true); setServerField(null); setErr(null)
    if (!picked && nameCharsError(name)) { setErr(nameCharsError(name)); return }
    const invalid = validate()
    if (Object.keys(invalid).length > 0) { focusFirst(invalid); return }
    // المختار برقمٍ مختلف: لا يتغيّر رقمه من تلقاء نفسه — نسأل، والافتراضي «اتركيه»
    if (pickedMobileDiffers && mobileDecision === null) { setMobileAsk(true); return }
    setMobileAsk(false)
    sending.current = true
    setBusy(true)
    const startedAt = Date.now()
    const docId = showDoctor ? doctorId || null : null
    const body = {
      service_id: service.id, with_drug: kind, nurse_id: nurseId, doctor_id: docId, materials: toPayload(items),
      ...(feeMode ? { consumables } : {}),
      ...(editing ? { reason: editReason } : {}),
      ...(!editing && referral ? { referral: ironReferralPayload(referral) } : {}),
      ...(!editing && override ? { share_override: { ...override, doctor_share: docId ? override.doctor_share : '' } } : {}),
      ...(picked
        ? { patient_id: picked.id,
            ...(mobileDecision === 'update' ? { update_mobile: true, mobile: cleanMobile(mobile) } : {}) }
        : { full_name: name, mobile: cleanMobile(mobile),
            ...(newConfirmed || confirmedNew ? { confirm_new_patient: true, birth_year: yearNow ?? newYear } : {}) }),
    }
    try {
      const send = (b) => (editing ? api.clinic.editIronSession(session.id, b) : api.clinic.addIronSession(b))
      let s
      try { s = await send(body) } catch (ex) {
        if (ex.data?.code !== 'IRON_LOW_MATERIALS') throw ex
        // تحذيرٌ لا منع: لا شيء كُتب، والتأكيد يعيد الإرسال
        if (!await confirmLow(ex.message)) return
        s = await send({ ...body, confirm_low_materials: true })
      }
      if (editing && s.changed === false) { setErr('لم يتغيّر شيء — عدّلي ما تريدين ثمّ احفظي.'); return }
      const wait = MIN_CLOSE_MS - (Date.now() - startedAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      onSaved(s)
    } catch (ex) {
      // اسمٌ مطابق لمسجَّل بلا تأكيد: السؤال نفسه بدل رسالة خطأ — ولا شيء حُفظ
      if (ex.data?.code === 'SAME_NAME_EXISTS') { setSameName({ matches: [...(ex.data.matches || []), ...(ex.data.similar || [])], fromSubmit: true }); return }
      if (blockedName(ex)) { setNewConfirmed(false); setSameName({ matches: blockedName(ex), blocked: true, message: ex.data.code === 'NAME_EXISTS' ? null : ex.message, fromSubmit: true }); return }
      if (ex.data?.code === 'SIMILAR_NEEDS_BIRTH_YEAR') { setNewConfirmed(false); setSameName({ matches: patientSearch.nearNames.length ? patientSearch.nearNames : [{ id: 0, full_name: name }], fromSubmit: true }); return }
      const field = SERVER_FIELDS[ex.data?.field]
      if (field) {
        const f = editing && ex.data?.field === 'reason' ? 'edit_reason' : field
        setServerField({ field: f, msg: ex.message })
        focusFirst({ [f]: true })
      } else setErr(ex.message)
      // ممرضةٌ أُوقفت بعد فتح النافذة: تختفي من القائمة فلا تبقى مختارةً خفيةً
      if (ex.data?.field === 'nurse_id') { setNurseId(''); load() }
      // خدمةٌ أُوقفت بعد فتح النافذة: تختفي من الاختيار
      if (ex.data?.code === 'SERVICE_INACTIVE') { setServiceId(null); load() }
    } finally { sending.current = false; setBusy(false) }
  }
  // ترقيم المجموعات بما يظهر منها: الخدمة (إن اختيرت هنا) ⇐ المريض ⇐ الطاقم ⇐ النوع (للسعرين) ⇐ المواد ⇐ الأخيرة
  const N = (() => {
    const order = [...((services.length > 1 || (editing && !sameService) || !service) ? ['service'] : []), 'patient', 'staff', ...(dual ? ['kind'] : []), 'materials', 'last']
    return Object.fromEntries(order.map((k, i) => [k, String(i + 1)]))
  })()
  // Enter في حقل نصّ لا يقبض مالاً: الحفظ بالزرّ وحده (وبحث المواد له Enter خاصّ به)
  const noEnterSubmit = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault() }

  return (
    <Modal title={editing ? `تعديل جلسة ${session.patient}` : service ? `جلسة ${service.name} جديدة` : 'جلسة جديدة'}
      subtitle={editing ? `سُجّلت ${session.date} الساعة ${session.time} — كلّ تعديلٍ يُحفظ بسببه ويراه من يفتح الجلسة` : 'تُسجَّل وتُقبض فوراً — بلا دور ولا عيادة'}
      onClose={onClose} busy={busy} wide sheet>
      {loadErr ? <p className="error">{loadErr}</p> : !opts ? <p className="empty">جارٍ التحميل…</p> : (
        <form onSubmit={submit} onKeyDown={noEnterSubmit} onChange={() => setServerField(null)} className="iron-form" noValidate>
          {(services.length > 1 || (editing && !sameService) || !service) && (
            <Section n={N.service} title="الخدمة" note="يحدّد المبلغ">
              <div className="field iron-svc-field">
                <label htmlFor="iron-service">نوع الجلسة</label>
                <Combobox id="iron-service" value={serviceId == null ? '' : String(serviceId)} placeholder="— اختاري الخدمة —"
                  onChange={(v) => { setServiceId(v); setWithDrug(editing && String(v) === String(session.serviceId) ? session.withDrug : null); setServerField(null) }}
                  options={services.map((x) => ({ value: String(x.id), label: x.name, meta: servicePriceText(x) }))}
                  emptyText="ما في خدمات فعّالة — تُضاف من الإعدادات" invalid={!!errors.service} describedBy={errors.service ? 'iron-err-service' : undefined} />
                <FieldError id="iron-err-service" msg={errors.service} />
              </div>
            </Section>
          )}
          <Section n={N.patient} title="المريض">
            <div className="bf-row">
              <div className="field">
                <label htmlFor="iron-name">اسم المريض الثلاثي</label>
                <input id="iron-name" value={name} disabled={!!picked} placeholder="الاسم واسم الأب والكنية" {...invalidProps('name')}
                  onChange={(e) => onName(e.target.value)} {...patientSearch.inputProps(pick)} />
                {!sameName && <PatientDropdown search={patientSearch} onPick={pick} onNew={chooseNew} disabled={busy} />}
                {errors.name ? <FieldError id="iron-err-name" msg={errors.name} /> : (
                  <small className="hint">
                    {patientSearch.checking ? 'جارٍ البحث…' : picked ? '\u00A0' : newConfirmed || patientSearch.noMatch ? 'مريض جديد' : 'المسجّلون يطلعون تحت الخانة وأنتِ تكتبين — والجديد بالاسم الثلاثي'}
                  </small>
                )}
              </div>
              <div className="field">
                <label htmlFor="iron-mobile">الموبايل <span className="opt">(اختياري)</span></label>
                <MobileInput id="iron-mobile" value={mobile} onChange={onMobile} {...invalidProps('mobile')} />
                {errors.mobile && <FieldError id="iron-err-mobile" msg={errors.mobile} />}
              </div>
            </div>

            {picked && (
              <div className="picked-box">
                <div>
                  <strong>اختير المريض:</strong> {picked.full_name}
                  <span className="candidate-meta">
                    {picked.mobile ? <span dir="ltr">{picked.mobile}</span> : 'بلا موبايل'}
                  </span>
                </div>
                <button type="button" className="ghost" onClick={undoPick}>تراجع — ليس هو</button>
              </div>
            )}
            {patientSearch.pickError && <p className="error">{patientSearch.pickError}</p>}
            <SameNameConfirm key={sameName ? 'open' : 'closed'} matches={sameName?.matches} blocked={sameName?.blocked} message={sameName?.message}
              defaultYear={newYear || ''} onPick={pick} onConfirm={confirmNew} disabled={busy} />
            {mobileAsk && picked && (
              <MobileUpdateAsk storedMobile={picked.mobile} disabled={busy}
                onUpdate={() => submit(null, 'update')} onKeep={() => submit(null, 'keep')} />
            )}
          </Section>

          <Section n={N.staff} title="الطاقم">
            <div className="bf-row">
              <div className="field">
                <label htmlFor="iron-nurse">الممرضة</label>
                <Combobox id="iron-nurse" value={nurseId} onChange={(v) => { setNurseId(v); setServerField(null) }} placeholder="— اختاري الممرضة —"
                  options={[...opts.nurses].sort(byNameAr).map((n) => ({ value: n.id, label: n.name }))}
                  emptyText="ما في ممرضات — تُضاف من الإعدادات" invalid={!!errors.nurse} describedBy={errors.nurse ? 'iron-err-nurse' : undefined} />
                <FieldError id="iron-err-nurse" msg={errors.nurse} />
                {opts.nurses.length === 0 && <small className="hint warn-hint">ما في ممرضات — تُضاف من الإعدادات</small>}
              </div>
              {showDoctor && <div className="field">
                <label htmlFor="iron-doctor">الدكتور <span className="opt">(اختياري)</span></label>
                <Combobox id="iron-doctor" value={doctorId} onChange={(v) => { setDoctorId(v); setServerField(null) }}
                  options={[{ value: '', label: NO_DOCTOR }, ...[...opts.doctors].sort(byNameAr).map((d) => ({ value: d.id, label: d.name }))]}
                  invalid={!!errors.doctor} describedBy={errors.doctor ? 'iron-err-doctor' : undefined} />
                <FieldError id="iron-err-doctor" msg={errors.doctor} />
              </div>}
            </div>
          </Section>

          {dual && <Section n={N.kind} title="النوع" note="يحدّد المبلغ">
            <DrugChoice value={withDrug} prices={prices} onPick={setWithDrug} />
            <FieldError id="iron-err-with_drug" msg={errors.with_drug} />
          </Section>}

          <Section n={N.materials} title="المواد" note="أمبولة، قسطرة، محلول…">
            <div className="iron-materials">
              {feeMode && service && (
                <small className="hint iron-included-hint">
                  {included.length && !editing ? 'المواد المعتادة لهذه الخدمة تعبّأت — زيدي أو نقّصي أو شيلي حسب ما انصرف. ' : ''}
                  كلّ مادة (والدواء منها) على المريض بسعر البيع فوق الأجرة.
                </small>
              )}
              {!feeMode && service?.charge_extras && kind !== null && (
                <small className="hint iron-included-hint">
                  {included.length ? <>مشمولٌ بالسعر: {included.map((m) => `${m.name} ×${fmtNum(m.qty)}`).join('، ')} — وما فوقه على المريض.</>
                    : 'لا مواد مشمولة بسعر هذه الخدمة — كلّ مادة تُضاف على المريض.'}
                </small>
              )}
              <MaterialsEditor catalog={catalog} value={items} onChange={setItems} disabled={busy} saved={savedItems.current} />
              {items.length === 0 && <small className="hint">لم تُضف مواد بعد.</small>}
              {feeMode && <ConsumablesCounter value={consumables} onChange={(v) => { setConsumables(v); setServerField(null) }} disabled={busy} />}
              {feeMode && extras && extrasTotal > 0 && (
                <div className="iron-extras" aria-live="polite">
                  <strong>على المريض فوق الأجرة: {fmtNum(extrasTotal)} ل.س</strong>
                  <ul>
                    {extras.extras.map((x) => <li key={x.material_id}>{x.name} ×{fmtNum(x.qty)} — {fmtNum(x.amount)}</li>)}
                    {extras.consumables > 0 && <li>المستهلكات — {fmtNum(extras.consumables)}</li>}
                  </ul>
                </div>
              )}
              {!feeMode && extras && extras.extras.length > 0 && (
                <div className="iron-extras" aria-live="polite">
                  <strong>زيادة على المريض: {fmtNum(extrasTotal)} ل.س</strong>
                  <ul>{extras.extras.map((x) => <li key={x.material_id}>{x.name} ×{fmtNum(x.qty)} فوق المشمول — {fmtNum(x.amount)}</li>)}</ul>
                </div>
              )}
              <FieldError id="iron-err-materials" msg={errors.materials} />
            </div>
          </Section>

          {!editing && <Section n={N.last} title="الإحالة" note="اختياري">
            <div className={`ref-box iron-ref${referral ? ' open' : ''}`}>
              <label className="ref-toggle">
                <input type="checkbox" checked={referral !== null} disabled={busy}
                  onChange={(e) => { setReferral(e.target.checked ? blankReferral() : null); setServerField(null) }} />
                معه إحالة؟
              </label>
              {referral && (
                <>
                  <ReferralRow value={referral} onChange={setReferral} scopes={null} idPrefix="iron-ref" combo
                    options={refOpts.options} optionsErr={refOpts.err} discount={{ total: discount }} disabled={busy} />
                  <p className="ref-due" aria-live="polite">
                    {price === null ? (service ? 'اختاري النوع ليظهر الخصم.' : 'اختاري الخدمة ليظهر الخصم.') : <>السعر {fmtNum(price)} ← خصم الإحالة {fmtNum(discount)} ← المطلوب من المريض <strong>{fmtNum(pay)}</strong></>}
                  </p>
                  <small className="hint">الخصم على الجهة المحيلة — حصص الممرضة والدكتور والشفاء تبقى من السعر الكامل.</small>
                </>
              )}
              <FieldError id="iron-err-referral" msg={errors.referral} />
            </div>
          </Section>}

          {editing && (
            <Section n={N.last} title="ما سيتغيّر" note="يُحفظ مع سببه">
              <ChangePreview changes={changes} />
              {session.referral && <small className="hint">إحالة {session.referral.source}: خصمها يُعاد على السعر الجديد تلقائياً — وتُعدَّل من زرّ «الإحالة».</small>}
              <div className="field iron-edit-reason">
                <label htmlFor="iron-edit-reason">سبب التعديل</label>
                <input id="iron-edit-reason" value={editReason} placeholder="مثال: نُسيت الأمبولة، أو اختير مريضٌ غيره"
                  {...invalidProps('edit_reason')} onChange={(e) => { setEditReason(e.target.value); setServerField(null) }} />
                <FieldError id="iron-err-edit_reason" msg={errors.edit_reason} />
              </div>
            </Section>
          )}

          {!editing && canOverride && (override === null ? (
            <button type="button" className="ghost iron-override-open" onClick={() => setOverride({ doctor_share: '', nurse_share: '', reason: '' })}>
              تعديل الحصّة لهذه الجلسة
            </button>
          ) : (
            <fieldset className="iron-override">
              <legend>تعديل الحصّة لهذه الجلسة وحدها</legend>
              <div className="bf-row">
                {showDoctor && doctorId && <div className="field"><label htmlFor="iron-ov-doctor">حصّة الدكتور</label>
                  <input id="iron-ov-doctor" inputMode="decimal" value={override.doctor_share} {...invalidProps('ov_doctor')} onChange={(e) => setOverride((o) => ({ ...o, doctor_share: e.target.value }))} />
                  <FieldError id="iron-err-ov_doctor" msg={errors.ov_doctor} /></div>}
                <div className="field"><label htmlFor="iron-ov-nurse">حصّة الممرضة</label>
                  <input id="iron-ov-nurse" inputMode="decimal" value={override.nurse_share} {...invalidProps('ov_nurse')} onChange={(e) => setOverride((o) => ({ ...o, nurse_share: e.target.value }))} />
                  <FieldError id="iron-err-ov_nurse" msg={errors.ov_nurse} /></div>
              </div>
              <div className="field"><label htmlFor="iron-ov-reason">السبب</label>
                <input id="iron-ov-reason" value={override.reason} {...invalidProps('ov_reason')} onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))} />
                <FieldError id="iron-err-ov_reason" msg={errors.ov_reason} /></div>
              <button type="button" className="ghost" onClick={() => setOverride(null)}>بلا تعديل</button>
            </fieldset>
          ))}

          {err && <p className="error" role="alert">{err}</p>}
          <div className="iron-paybar">
            <div className="iron-pay">
              <span className="iron-pay-label">{editing ? 'المبلغ بعد التعديل' : 'المبلغ الذي سيُقبض'}</span>
              {price === null
                ? <span className="iron-pay-none">{quotePending ? 'جارٍ حساب المبلغ…' : service ? 'اختاري النوع أولاً' : 'اختاري الخدمة أولاً'}</span>
                : <strong className="iron-pay-amount">{fmtNum(pay)} <small>ل.س</small></strong>}
              {price !== null && extrasTotal > 0 && (feeMode
                ? <small className="iron-pay-ref">الأجرة {fmtNum(basePrice)} + مواد {fmtNum(extras.materials_amount)}{extras.consumables > 0 ? ` + مستهلكات ${fmtNum(extras.consumables)}` : ''}</small>
                : <small className="iron-pay-ref">السعر {fmtNum(basePrice)} + مواد زيادة {fmtNum(extrasTotal)}</small>)}
              {price !== null && discount > 0 && <small className="iron-pay-ref">بعد خصم الإحالة {fmtNum(discount)} من {fmtNum(price)}</small>}
              {editing && pay !== null && (
                <small className={`iron-pay-diff${pay > oldPaid ? ' is-more' : pay < oldPaid ? ' is-less' : ''}`} aria-live="polite">
                  {pay > oldPaid ? `اقبضي من المريض ${fmtNum(pay - oldPaid)} ل.س إضافية`
                    : pay < oldPaid ? `رُدّي للمريض ${fmtNum(oldPaid - pay)} ل.س`
                    : `المبلغ كما قُبض (${fmtNum(oldPaid)})`}
                </small>
              )}
            </div>
            <button type="submit" className="iron-save" disabled={busy}>{busy ? 'جارٍ الحفظ…' : editing ? 'احفظ التعديل' : 'سجّل واقبض'}</button>
            <button type="button" className="ghost iron-close" disabled={busy} onClick={onClose}>إغلاق</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
