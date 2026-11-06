import { useEffect, useRef, useState } from 'react'
import { api, toLatinDigits } from '../api.js'
import { Modal, fmtQty } from './inventory/shared.jsx'
import { ironReceiptFrom, loadPrinter, printTicket } from '../ticket-print.js'
import { printViaHelper } from '../print-helper.js'

// ═══ تسجيل جلسة حديد — نافذة الاستقبال ═══
// تسجيلٌ وقبضٌ بضغطةٍ واحدة: لا دور ولا عيادة ولا حجز. السعر يتحدّث فور اختيار «مع/بلا دوا»، والخادم
// هو من يحسبه ويوزّعه. «مع/بلا دوا» والممرضة بلا اختيارٍ مسبق: تغيّران المبلغ والمستحقات، فلا يمرّان
// بافتراضٍ لم يره أحد. والدكتور اختياري: الافتراض «بلا دكتور» وهو خيارٌ مكتوبٌ في القائمة.
// المريض بآلية الحجز نفسها: البحث فور ثلاث كلمات أو بالموبايل، والاختيار صريحٌ وله تراجع.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY')
const NO_DOCTOR = 'بلا دكتور / محوّل من خارج الجمعية'

async function printReceipt(session, copies) {
  const printer = loadPrinter()
  const data = ironReceiptFrom(session)
  const r = await printViaHelper(data, printer.width, undefined, undefined, { copies })
  if (r.ok) return { ok: true }
  return printTicket(data, printer.width, undefined, { copies })
}

export { printReceipt as printIronReceipt }

function DrugChoice({ value, prices, drug, onPick }) {
  const opt = (v, label, price, disabled) => (
    <button key={label} type="button" role="radio" aria-checked={value === v} disabled={disabled}
      className={`iron-choice${value === v ? ' is-on' : ''}`} onClick={() => onPick(v)}>
      <span className="iron-choice-label">{label}</span>
      <span className="iron-choice-price">{fmtNum(price)} <small>ل.س</small></span>
    </button>
  )
  return (
    <div className="iron-choices" role="radiogroup" aria-label="الدواء">
      {opt(false, 'بلا دوا', prices.without_drug, false)}
      {opt(true, 'مع دوا', prices.with_drug, !drug.available)}
    </div>
  )
}

export default function IronSessionDialog({ onClose, onSaved }) {
  const [opts, setOpts] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [withDrug, setWithDrug] = useState(null)
  const [nurseId, setNurseId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [lookup, setLookup] = useState(null)        // null | 'checking' | 'new'
  const [candidates, setCandidates] = useState(null)
  const [picked, setPicked] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)            // ردّ التسجيل
  const [printNote, setPrintNote] = useState(null)
  // ضغطتان سريعتان تسبقان رسم الزرّ معطّلاً: جلستان ومالٌ مرّتين. القفل مرجعٌ لا حالة.
  const sending = useRef(false)

  const load = () => api.clinic.ironOptions().then(setOpts).catch((e) => setLoadErr(e.message))
  useEffect(() => { load() }, [])

  const pick = (p) => {
    setPicked(p); setName(p.full_name); setMobile(p.mobile || '')
    setCandidates(null); setLookup(null)
  }
  const handleLookup = (r) => {
    const list = r?.candidates
    if (list?.length) { setCandidates(list); setLookup(null); return }
    if (r?.id) { pick(r); return }
    setCandidates(null); setLookup('new')
  }
  const checkName = async (v) => {
    if (v.trim().split(/\s+/).filter(Boolean).length < 3) { setCandidates(null); setLookup(null); return }
    setLookup('checking')
    try { handleLookup(await api.clinic.lookupPatientBy({ full_name: v })) } catch { setLookup(null) }
  }
  const checkMobile = async (v) => {
    if (v.trim().length < 8) return
    setLookup('checking')
    try { handleLookup(await api.clinic.lookupPatientBy({ mobile: v })) } catch { setLookup(null) }
  }
  const undoPick = () => { setPicked(null); setName(''); setMobile(''); setLookup(null) }

  const price = opts && withDrug !== null ? (withDrug ? opts.prices.with_drug : opts.prices.without_drug) : null
  const ready = withDrug !== null && nurseId && (picked || name.trim())

  const printNow = async (s, copies) => {
    const r = await printReceipt(s, copies)
    setPrintNote(r.ok ? null : `تعذّرت طباعة الإيصال${r.reason ? ` (${r.reason})` : ''} — الجلسة مسجَّلة`)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!ready || sending.current) return
    sending.current = true
    setBusy(true); setErr(null)
    try {
      const s = await api.clinic.addIronSession({
        with_drug: withDrug, nurse_id: nurseId, doctor_id: doctorId || null,
        ...(picked ? { patient_id: picked.id } : { full_name: name, mobile }),
      })
      setDone(s)
      onSaved?.(s)
      // الجلسة سُجّلت قبل هذا السطر: فشل الطباعة رسالةٌ لا تراجع
      const printer = loadPrinter()
      if (printer.enabled) printNow(s, printer.copies)
    } catch (ex) {
      setErr(ex.message)
      if (ex.data?.field === 'nurse_id' || ex.data?.code?.startsWith('IRON_DRUG')) load()
    } finally { sending.current = false; setBusy(false) }
  }

  const again = () => {
    setDone(null); setPrintNote(null); setErr(null); setWithDrug(null); setNurseId(''); setDoctorId('')
    setName(''); setMobile(''); setPicked(null); setCandidates(null); setLookup(null)
    load()
  }

  if (done) {
    return (
      <Modal title="سُجّلت الجلسة وقُبض المبلغ" onClose={onClose} sheet>
        <p className="iron-done-amount">{fmtNum(done.price)} <small>ل.س</small></p>
        <p className="iron-done-who">{done.patient} — {done.with_drug ? 'مع دوا' : 'بلا دوا'} — الممرضة {done.nurse}</p>
        {done.stock_warnings?.map((w) => (
          <p key={w.material_id} className="share-warn" role="alert">
            ⚠ رصيد «{w.name}» صار {fmtQty(w.after)} {w.unit} — الدواء المستعمل غير مسجَّل بالكامل، أبلغي مشرفة العيادات.
          </p>
        ))}
        {printNote && <p className="share-warn" role="alert">⚠ {printNote}</p>}
        <div className="inline iron-actions">
          <button type="button" onClick={again}>جلسة جديدة</button>
          <button type="button" className="ghost" onClick={() => printNow(done, 1)}>🖨 طباعة الإيصال</button>
          <button type="button" className="ghost" onClick={onClose}>إغلاق</button>
        </div>
      </Modal>
    )
  }

  const zeroStock = opts && withDrug === true && opts.drug.balance !== null && opts.drug.balance <= 0

  return (
    <Modal title="جلسة حديد جديدة" subtitle="تُسجَّل وتُقبض فوراً — بلا دور ولا عيادة" onClose={onClose} busy={busy} sheet>
      {loadErr ? <p className="error">{loadErr}</p> : !opts ? <p className="empty">جارٍ التحميل…</p> : (
        <form onSubmit={submit} className="iron-form">
          <DrugChoice value={withDrug} prices={opts.prices} drug={opts.drug} onPick={setWithDrug} />
          {!opts.drug.available && <p className="iron-hint">«مع دوا» غير متاحة: {opts.drug.problem}</p>}
          {zeroStock && (
            <p className="share-warn" role="alert">
              ⚠ رصيد «{opts.drug.name}» {opts.drug.balance === 0 ? 'صفر' : `سالب (${fmtQty(opts.drug.balance)})`} — يمكنك التسجيل، لكن الرصيد سيصير سالباً. أبلغي مشرفة العيادات.
            </p>
          )}

          <div className="bf-row">
            <div className="field">
              <label htmlFor="iron-nurse">الممرضة</label>
              <select id="iron-nurse" value={nurseId} required onChange={(e) => setNurseId(e.target.value)}>
                <option value="">— اختاري الممرضة —</option>
                {opts.nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              {opts.nurses.length === 0 && <small className="hint warn-hint">لا ممرضات فعّالات — تضيفهنّ مشرفة العيادات من إعدادات الحديد</small>}
            </div>
            <div className="field">
              <label htmlFor="iron-doctor">الدكتور <span className="opt">(اختياري)</span></label>
              <select id="iron-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">{NO_DOCTOR}</option>
                {opts.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bf-row">
            <div className="field">
              <label htmlFor="iron-name">اسم المريض الثلاثي</label>
              <input id="iron-name" value={name} disabled={!!picked} placeholder="الاسم واسم الأب والكنية"
                onChange={(e) => { setName(e.target.value); checkName(e.target.value) }} />
              <small className="hint">
                {lookup === 'checking' ? 'جارٍ البحث…' : lookup === 'new' ? 'مريض جديد' : 'ثلاث كلمات على الأقل — نبحث بها عن المريض السابق'}
              </small>
            </div>
            <div className="field">
              <label htmlFor="iron-mobile">الموبايل <span className="opt">(اختياري)</span></label>
              <input id="iron-mobile" value={mobile} disabled={!!picked} dir="ltr" inputMode="numeric" placeholder="09XXXXXXXX"
                onChange={(e) => { const v = toLatinDigits(e.target.value); setMobile(v); checkMobile(v) }} />
            </div>
          </div>

          {picked && (
            <div className="picked-box">
              <div>
                <strong>اختير المريض:</strong> {picked.full_name}
                <span className="candidate-meta">
                  {picked.mobile ? <span dir="ltr">{picked.mobile}</span> : 'بلا موبايل'}
                  {picked.visits_count > 0 && ` · ${picked.visits_count} زيارة`}
                </span>
              </div>
              <button type="button" className="ghost" onClick={undoPick}>تراجع — ليس هو</button>
            </div>
          )}
          {candidates?.length > 0 && (
            <div className="candidates-box">
              <div className="candidates-title">وُجد مرضى بهذا الاسم — اختر الصحيح أو تابع كمريض جديد</div>
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
                  <button type="button" className="ghost" onClick={() => pick(c)}>هو نفسه</button>
                </div>
              ))}
              <button type="button" className="ghost candidate-new" onClick={() => { setCandidates(null); setLookup('new') }}>
                لا — مريض جديد
              </button>
            </div>
          )}

          {err && <p className="error" role="alert">{err}</p>}
          <div className="inline iron-actions">
            <button type="submit" disabled={!ready || busy}>
              {busy ? 'جارٍ التسجيل…' : price === null ? 'سجّل واقبض' : `سجّل واقبض ${fmtNum(price)} ل.س`}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
