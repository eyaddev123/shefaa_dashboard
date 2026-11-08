import { useEffect, useRef, useState } from 'react'
import { api, cleanMobile, mobileError } from '../api.js'
import MobileInput from './MobileInput.jsx'
import { usePatientSearch, PatientCandidates, SameNameConfirm, MobileUpdateAsk } from './PatientPicker.jsx'
import { Modal } from './inventory/shared.jsx'
import Combobox, { byNameAr } from './Combobox.jsx'
import { readAmountInput } from '../iron-shares.js'
import MaterialsEditor, { qtyValid, toPayload } from './MaterialsEditor.jsx'
import { useDialogs } from '../dialogs.jsx'
import { useRole } from '../RoleContext.jsx'
import { canSeeInventory, canWriteIronSettings } from '../permissions.js'
import { ironReceiptFrom, loadPrinter, printTicket } from '../ticket-print.js'
import { printViaHelper } from '../print-helper.js'

// ═══ تسجيل جلسة حديد — نافذة الاستقبال ═══
// تسجيلٌ وقبضٌ بضغطةٍ واحدة: لا دور ولا عيادة ولا حجز. «مع/بلا دوا» يحدّد السعر وحده، والخادم هو من
// يحسبه ويوزّعه. «مع/بلا دوا» والممرضة بلا اختيارٍ مسبق: تغيّران المبلغ والمستحقات، فلا يمرّان بافتراضٍ
// لم يره أحد. والدكتور اختياري: الافتراض «بلا دكتور» وهو خيارٌ مكتوبٌ في القائمة.
// المواد بمحرّر نافذة الإجراء نفسه وبلا أسعار. وتنبيه «مع دوا بلا أمبولة» من الخادم: العتبة بأسعارٍ لا
// يراها الاستقبال، فيعود الطلب بسؤالٍ يُعاد إرساله بعد التأكيد.
// المريض بآلية الحجز نفسها: البحث فور ثلاث كلمات أو بالموبايل، والاختيار صريحٌ وله تراجع.
// ★ الترتيب مجموعاتٌ بالتسلسل: المريض ⇐ الطاقم ⇐ النوع ⇐ المواد ⇐ الحفظ، والمبلغ ظاهرٌ بجانب الزرّ.
// الحفظ لا يُعطَّل بنقصٍ: الضغط يبيّن الناقص تحت حقله. والنجاح يغلق النافذة (الرسالة والطباعة عند الصفحة)،
// والخطأ أو سؤال التأكيد يُبقيها مفتوحة.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY')
const NO_DOCTOR = 'بلا دكتور / محوّل من خارج الجمعية'
// الإغلاق لا يسبق هذه المدّة: ثانية ضغطتين سريعتين لا تقع على زرٍّ في السجلّ تحت النافذة
const MIN_CLOSE_MS = 300
const isThreePart = (v) => v.trim().split(/\s+/).filter(Boolean).length >= 3
// حقول الخادم (field في ردّ الخطأ) بأسماء النموذج
const SERVER_FIELDS = { full_name: 'name', mobile: 'mobile', nurse_id: 'nurse', doctor_id: 'doctor', with_drug: 'with_drug', reason: 'ov_reason', doctor_share: 'ov_doctor', nurse_share: 'ov_nurse' }
// بترتيب ظهورها: التركيز ينزل لأوّل ناقص
const FOCUS_ORDER = [['name', '#iron-name'], ['mobile', '#iron-mobile'], ['nurse', '#iron-nurse'], ['doctor', '#iron-doctor'], ['with_drug', '.iron-choice'],
  ['materials', '.mat-qty.is-bad'], ['ov_doctor', '#iron-ov-doctor'], ['ov_nurse', '#iron-ov-nurse'], ['ov_reason', '#iron-ov-reason']]

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
      {opt(false, 'بلا دوا', prices.without_drug)}
      {opt(true, 'مع دوا', prices.with_drug)}
    </div>
  )
}

export default function IronSessionDialog({ onClose, onSaved }) {
  const { clinicRole: role } = useRole()
  const canOverride = canWriteIronSettings(role)
  const dialogs = useDialogs()
  const [opts, setOpts] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [items, setItems] = useState([])
  const [override, setOverride] = useState(null)    // null | {doctor_share, nurse_share, reason}: للمشرفة وحدها
  const [loadErr, setLoadErr] = useState(null)
  const [withDrug, setWithDrug] = useState(null)
  const [nurseId, setNurseId] = useState('')
  const [doctorId, setDoctorId] = useState('')
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

  const load = () => api.clinic.ironOptions().then(setOpts).catch((e) => setLoadErr(e.message))
  useEffect(() => {
    load()
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
  const onMobile = (v) => { setMobile(v); setMobileAsk(false); patientSearch.byMobile(v) }
  const chooseNew = () => {
    if (patientSearch.nearNames.length) setSameName({ matches: patientSearch.nearNames, fromSubmit: false })
    else { setNewConfirmed(true); patientSearch.dismiss() }
  }
  // «نعم، مريض جديد»: إن جاء السؤال من الحفظ نفسه، يُعاد الحفظ بالتأكيد فوراً
  const confirmNew = () => {
    const again = sameName?.fromSubmit
    setNewConfirmed(true); setSameName(null); patientSearch.dismiss()
    if (again) submit(null, null, true)
  }
  // رقمٌ مكتوب يختلف عن رقم المختار؟ (الفارغ ليس تغييراً)
  const pickedMobileDiffers = picked && cleanMobile(mobile) !== '' && cleanMobile(mobile) !== cleanMobile(picked.mobile || '')

  const price = opts && withDrug !== null ? (withDrug ? opts.prices.with_drug : opts.prices.without_drug) : null

  const validate = () => {
    const e = {}
    if (!picked && !name.trim()) e.name = 'اكتبي اسم المريض'
    else if (!picked && !isThreePart(name)) e.name = 'الاسم الثلاثي مطلوب: الاسم واسم الأب والكنية'
    if ((!picked || pickedMobileDiffers) && mobileError(mobile)) e.mobile = mobileError(mobile)
    if (!nurseId) e.nurse = 'اختاري الممرضة'
    if (withDrug === null) e.with_drug = 'اختاري النوع: مع دوا أو بلا دوا — منه يتحدّد المبلغ'
    if (!qtyValid(items)) e.materials = 'صحّحي الكمّية المعلَّمة: رقمٌ أكبر من صفر'
    if (override) {
      const d = doctorId ? readAmountInput(override.doctor_share) : { empty: true }
      const n = readAmountInput(override.nurse_share)
      if (d.error) e.ov_doctor = 'مبلغٌ غير صالح'
      if (n.error) e.ov_nurse = 'مبلغٌ غير صالح'
      if (d.empty && n.empty) e[doctorId ? 'ov_doctor' : 'ov_nurse'] = 'اكتبي الحصّة المعدَّلة'
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
    body: `${message}\n\nإن أكّدتِ: تُحفظ الجلسة ويُقبض ${fmtNum(price)} ل.س، ${items.length === 0 ? 'ولا يُخصم شيء من المخزون' : 'ولا يُخصم من المخزون إلا ما أضفتِه'}، وتراها مشرفة العيادات معلَّمة «مع دوا بمواد قليلة — مؤكَّدة».\nإن رجعتِ: لا يُحفظ شيء، ويبقى ما كتبتِه لتعديله.`,
    confirmLabel: 'تأكيد وحفظ', cancelLabel: 'رجوع للتعديل',
  })

  const submit = async (e, mobileDecision = null, confirmedNew = false) => {
    e?.preventDefault?.()
    if (sending.current) return
    setTried(true); setServerField(null); setErr(null)
    const invalid = validate()
    if (Object.keys(invalid).length > 0) { focusFirst(invalid); return }
    // المختار برقمٍ مختلف: لا يتغيّر رقمه من تلقاء نفسه — نسأل، والافتراضي «اتركيه»
    if (pickedMobileDiffers && mobileDecision === null) { setMobileAsk(true); return }
    setMobileAsk(false)
    sending.current = true
    setBusy(true)
    const startedAt = Date.now()
    const body = {
      with_drug: withDrug, nurse_id: nurseId, doctor_id: doctorId || null, materials: toPayload(items),
      ...(override ? { share_override: { ...override, doctor_share: doctorId ? override.doctor_share : '' } } : {}),
      ...(picked
        ? { patient_id: picked.id,
            ...(mobileDecision === 'update' ? { update_mobile: true, mobile: cleanMobile(mobile) } : {}) }
        : { full_name: name, mobile: cleanMobile(mobile),
            ...(newConfirmed || confirmedNew ? { confirm_new_patient: true } : {}) }),
    }
    try {
      let s
      try { s = await api.clinic.addIronSession(body) } catch (ex) {
        if (ex.data?.code !== 'IRON_LOW_MATERIALS') throw ex
        // تحذيرٌ لا منع: لا شيء كُتب، والتأكيد يعيد الإرسال
        if (!await confirmLow(ex.message)) return
        s = await api.clinic.addIronSession({ ...body, confirm_low_materials: true })
      }
      const wait = MIN_CLOSE_MS - (Date.now() - startedAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      onSaved(s)
    } catch (ex) {
      // اسمٌ مطابق لمسجَّل بلا تأكيد: السؤال نفسه بدل رسالة خطأ — ولا شيء حُفظ
      if (ex.data?.code === 'SAME_NAME_EXISTS') { setSameName({ matches: [...(ex.data.matches || []), ...(ex.data.similar || [])], fromSubmit: true }); return }
      const field = SERVER_FIELDS[ex.data?.field]
      if (field) {
        setServerField({ field, msg: ex.message })
        focusFirst({ [field]: true })
      } else setErr(ex.message)
      // ممرضةٌ أُوقفت بعد فتح النافذة: تختفي من القائمة فلا تبقى مختارةً خفيةً
      if (ex.data?.field === 'nurse_id') { setNurseId(''); load() }
    } finally { sending.current = false; setBusy(false) }
  }
  // Enter في حقل نصّ لا يقبض مالاً: الحفظ بالزرّ وحده (وبحث المواد له Enter خاصّ به)
  const noEnterSubmit = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault() }

  return (
    <Modal title="جلسة حديد جديدة" subtitle="تُسجَّل وتُقبض فوراً — بلا دور ولا عيادة" onClose={onClose} busy={busy} wide sheet>
      {loadErr ? <p className="error">{loadErr}</p> : !opts ? <p className="empty">جارٍ التحميل…</p> : (
        <form onSubmit={submit} onKeyDown={noEnterSubmit} onChange={() => setServerField(null)} className="iron-form" noValidate>
          <Section n="١" title="المريض">
            <div className="bf-row">
              <div className="field">
                <label htmlFor="iron-name">اسم المريض الثلاثي</label>
                <input id="iron-name" value={name} disabled={!!picked} placeholder="الاسم واسم الأب والكنية" {...invalidProps('name')}
                  onChange={(e) => onName(e.target.value)} />
                {errors.name ? <FieldError id="iron-err-name" msg={errors.name} /> : (
                  <small className="hint">
                    {patientSearch.checking ? 'جارٍ البحث…' : picked ? '\u00A0' : newConfirmed || patientSearch.noMatch ? 'مريض جديد' : 'ثلاث كلمات على الأقل — نبحث بها عن المريض السابق'}
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
            {!sameName && (
              <PatientCandidates candidates={patientSearch.candidates} similar={patientSearch.similar} onPick={pick} onNew={chooseNew} disabled={busy} />
            )}
            <SameNameConfirm matches={sameName?.matches} onPick={pick} onConfirm={confirmNew} disabled={busy} />
            {mobileAsk && picked && (
              <MobileUpdateAsk storedMobile={picked.mobile} disabled={busy}
                onUpdate={() => submit(null, 'update')} onKeep={() => submit(null, 'keep')} />
            )}
          </Section>

          <Section n="٢" title="الطاقم">
            <div className="bf-row">
              <div className="field">
                <label htmlFor="iron-nurse">الممرضة</label>
                <Combobox id="iron-nurse" value={nurseId} onChange={(v) => { setNurseId(v); setServerField(null) }} placeholder="— اختاري الممرضة —"
                  options={[...opts.nurses].sort(byNameAr).map((n) => ({ value: n.id, label: n.name }))}
                  emptyText="ما في ممرضات — تُضاف من الإعدادات" invalid={!!errors.nurse} describedBy={errors.nurse ? 'iron-err-nurse' : undefined} />
                <FieldError id="iron-err-nurse" msg={errors.nurse} />
                {opts.nurses.length === 0 && <small className="hint warn-hint">ما في ممرضات — تُضاف من الإعدادات</small>}
              </div>
              <div className="field">
                <label htmlFor="iron-doctor">الدكتور <span className="opt">(اختياري)</span></label>
                <Combobox id="iron-doctor" value={doctorId} onChange={(v) => { setDoctorId(v); setServerField(null) }}
                  options={[{ value: '', label: NO_DOCTOR }, ...[...opts.doctors].sort(byNameAr).map((d) => ({ value: d.id, label: d.name }))]}
                  invalid={!!errors.doctor} describedBy={errors.doctor ? 'iron-err-doctor' : undefined} />
                <FieldError id="iron-err-doctor" msg={errors.doctor} />
              </div>
            </div>
          </Section>

          <Section n="٣" title="النوع" note="يحدّد المبلغ">
            <DrugChoice value={withDrug} prices={opts.prices} onPick={setWithDrug} />
            <FieldError id="iron-err-with_drug" msg={errors.with_drug} />
          </Section>

          <Section n="٤" title="المواد" note="أمبولة، قسطرة، محلول…">
            <div className="iron-materials">
              <MaterialsEditor combo catalog={catalog} value={items} onChange={setItems} disabled={busy} />
              {items.length === 0 && <small className="hint">لم تُضف مواد بعد.</small>}
              <FieldError id="iron-err-materials" msg={errors.materials} />
            </div>
          </Section>

          {canOverride && (override === null ? (
            <button type="button" className="ghost iron-override-open" onClick={() => setOverride({ doctor_share: '', nurse_share: '', reason: '' })}>
              تعديل الحصّة لهذه الجلسة
            </button>
          ) : (
            <fieldset className="iron-override">
              <legend>تعديل الحصّة لهذه الجلسة وحدها</legend>
              <div className="bf-row">
                {doctorId && <div className="field"><label htmlFor="iron-ov-doctor">حصّة الدكتور</label>
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
              <span className="iron-pay-label">المبلغ الذي سيُقبض</span>
              {price === null
                ? <span className="iron-pay-none">اختاري النوع أولاً</span>
                : <strong className="iron-pay-amount">{fmtNum(price)} <small>ل.س</small></strong>}
            </div>
            <button type="submit" className="iron-save" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'سجّل واقبض'}</button>
            <button type="button" className="ghost iron-close" disabled={busy} onClick={onClose}>إغلاق</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
