import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { useDialogs } from '../dialogs.jsx'
import { canCancelIron, canCollectIron, canSeeIronSplit, canWriteIronSettings } from '../permissions.js'
import IronSessionDialog, { printIronReceipt } from '../components/IronSessionDialog.jsx'
import { materialsSummary } from '../components/MaterialsEditor.jsx'
import { Modal, fmtQty } from '../components/inventory/shared.jsx'
import { loadPrinter } from '../ticket-print.js'
import { usePeriod, PeriodPicker, useLoad } from './ClinicFunds.jsx'
import { fundOf, previewShareEdit } from '../iron-shares.js'
import { ReferralRow, useReferralOptions } from '../components/ReferralFields.jsx'
import { blankReferral, draftFromIronReferral, ironDraftDiscount, ironReferralPayload, referralReady, amountText } from '../referral.js'

// ═══ جلسات الحديد ═══
// خدمةٌ مباشرة تُقبض لحظة تسجيلها: بلا دور ولا عيادة ولا حجز. ثلاثة تبويبات:
//   السجلّ      الجلسات لفترة — للاستقبال بلا توزيع (لا يصله من الخادم أصلاً)، وللمشرفة والاطّلاع معه
//   المستحقات   الممرضات والدكاترة، وما ذهب للشفاء وللصندوق
//   الإعدادات   الأسعار والحصص وسقف الشفاء وقائمة الممرضات — تكتبها المشرفة وحدها
// الحساب كلّه في الخادم (iron-sessions.js)، وكلّ جلسةٍ لقطتها: تغيير سعرٍ لا يمسّ القديم.
// الإحالة على السطر: «المبلغ» هو المقبوض (السعر − الخصم) والسعر تحته، وزرّ «إحالة» يضيف أو يعدّل أو يحذف —
// للاستقبال يوم الجلسة وحده وللمشرفة أيّ وقت (والخادم يحرس الاثنين).

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
const sessionsText = (n) => `${fmtNum(n)} ${n === 1 ? 'جلسة' : 'جلسات'}`

// ═══════ تعديل حصّة جلسة: بسبب، وبلا مساس بالإعدادات ═══════
// المعاينة تحسب بأرقام الجلسة نفسها قبل الحفظ، والخادم يعيد الحساب ويقرّر
function EditSharesDialog({ row, onClose, onSaved }) {
  const [doctor, setDoctor] = useState(String(row.split.doctor))
  const [nurse, setNurse] = useState(String(row.split.nurse))
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const pv = previewShareEdit(row, doctor, nurse)
  const a = pv.after
  const reasonErr = tried && !reason.trim() ? 'اكتبي سبب التعديل: يبقى في أثر الجلسة' : null
  const unchanged = tried && a && !a.negative && !pv.changed
  const save = async (e) => {
    e.preventDefault()
    setTried(true)
    if (sending.current || !reason.trim() || !a || a.negative || !pv.changed) return
    sending.current = true
    setBusy(true); setErr(null)
    try {
      await api.clinic.setIronShares(row.id, { ...(row.doctorId ? { doctor_share: doctor } : {}), nurse_share: nurse, reason })
      onSaved()
    } catch (ex) { setErr(ex.message); setBusy(false) } finally { sending.current = false }
  }
  const share = (id, label, now, value, onChange, bad) => (
    <div className="iron-ed-row">
      <span className="iron-ed-label">{label}</span>
      <span className="iron-ed-now"><small>الحالية</small><strong><Money value={now} /></strong></span>
      <div className="field">
        <label htmlFor={id}>الجديدة</label>
        <input id={id} inputMode="decimal" value={value} aria-invalid={bad || undefined} onChange={(e) => onChange(e.target.value)} />
        {bad && <small className="iron-err" role="alert">مبلغٌ غير صالح</small>}
      </div>
    </div>
  )
  return (
    <Modal title={`تعديل حصص جلسة ${row.patient}`} subtitle="لهذه الجلسة وحدها — يُعاد الحساب بسقف الشفاء لحظة تسجيلها" onClose={onClose} busy={busy} sheet>
      <form onSubmit={save} className="iron-form" noValidate>
        <div className="iron-ed-rows">
          {row.doctorId && share('iron-ed-doctor', 'حصّة الدكتور', row.split.doctor, doctor, setDoctor, pv.bad.doctor)}
          {share('iron-ed-nurse', 'حصّة الممرضة', row.split.nurse, nurse, setNurse, pv.bad.nurse)}
        </div>
        <div className="iron-effect" aria-live="polite">
          {!a ? <p className="iron-effect-line">صحّحي المبلغ لتظهر النتيجة.</p>
            : a.negative ? <p className="share-warn" role="alert">⚠ مجموع الحصّتين أكبر من سعر الجلسة ({fmtNum(row.price)}) — لا يُحفظ.</p> : (
            <>
              <table className="iron-effect-table">
                <thead><tr><th /><th className="num">الآن</th><th className="num">بعد التعديل</th></tr></thead>
                <tbody>
                  <tr><td>حصّة الشفاء</td><td className="num">{fmtNum(row.split.shifa)}</td><td className="num">{fmtNum(a.shifa)}</td></tr>
                  <tr><td>المواد</td><td className="num">{fmtNum(row.split.materials)}</td><td className="num">{fmtNum(a.materials)}</td></tr>
                  <tr><td>الفاضل</td><td className="num">{fmtNum(row.split.surplus)}</td><td className="num">{fmtNum(a.surplus)}</td></tr>
                  <tr className="iron-effect-fund"><td>لصندوق العيادات</td><td className="num">{fmtNum(fundOf(row.split))}</td><td className="num">{fmtNum(fundOf(a))}</td></tr>
                </tbody>
              </table>
              <p className="iron-effect-line">
                {pv.fundDelta === 0 ? 'الصندوق لا يتغيّر.'
                  : <>{pv.fundDelta > 0 ? 'الصندوق يزيد' : 'الصندوق ينقص'} <strong className="iron-fund-delta">{fmtNum(Math.abs(pv.fundDelta))} ل.س</strong> — حركةٌ بيوم التعديل.</>}
              </p>
              {a.overPrice && <p className="share-warn" role="alert">⚠ المواد تتجاوز ما يبقى بعد الحصص: تُسقَّف والشفاء صفر.</p>}
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor="iron-ed-reason">سبب التعديل <span className="iron-required">(إلزامي)</span></label>
          <input id="iron-ed-reason" value={reason} maxLength={300} aria-invalid={!!reasonErr || undefined} onChange={(e) => setReason(e.target.value)} />
          {reasonErr && <small className="iron-err" role="alert">{reasonErr}</small>}
        </div>
        {unchanged && <p className="iron-err" role="alert">لم تتغيّر أيّ حصّة — لا شيء يُحفظ.</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="inline iron-actions">
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديل'}</button>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>رجوع</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══════ إحالة جلسة قائمة: إضافة · تعديل · حذف ═══════
// ورقةٌ واحدة بلا نطاق. التوزيع لا يتغيّر: الخصم وحده، والمقبوض يُقرأ بعده — والفرق على الجهة.
const REF_ACTION = { add: 'أُضيفت', edit: 'عُدّلت', remove: 'حُذفت' }
function ReferralDialog({ row, onClose, onSaved }) {
  const dialogs = useDialogs()
  const existing = row.referral
  const [draft, setDraft] = useState(() => (existing ? draftFromIronReferral(existing) : blankReferral()))
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const { options, err: optErr } = useReferralOptions(true)
  const discount = ironDraftDiscount(draft, row.price)
  const keep = existing && !existing.source_active ? { id: existing.referral_source_id, name: existing.source } : null
  const ready = referralReady(draft)
  const run = async (fn, done) => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr(null)
    try { const out = await fn(); onSaved(done(out)) } catch (ex) { setErr(ex.message); setBusy(false) } finally { sending.current = false }
  }
  const save = (e) => {
    e.preventDefault()
    setTried(true)
    if (!ready) return
    run(() => api.clinic.setIronReferral(row.id, { ...ironReferralPayload(draft), reason: reason.trim() || null }),
      (out) => (out.changed === false ? 'لم يتغيّر شيء في الإحالة' : `${existing ? 'عُدّلت' : 'أُضيفت'} الإحالة — المقبوض ${fmtNum(out.paid)} ل.س`))
  }
  const remove = async () => {
    const ok = await dialogs.confirm({
      title: `حذف إحالة ${row.patient}`,
      body: `تُحذف إحالة «${existing.source}» ويصير المطلوب من المريض ${fmtNum(row.price)} ل.س — والفرق لم يعد على الجهة. يبقى الحذف في أثر الجلسة.`,
      confirmLabel: 'حذف الإحالة', cancelLabel: 'رجوع', danger: true,
    })
    if (ok) run(() => api.clinic.removeIronReferral(row.id, reason.trim()), () => 'حُذفت الإحالة')
  }
  return (
    <Modal title={`${existing ? 'تعديل إحالة' : 'إحالة على'} جلسة ${row.patient}`} subtitle={`${row.withDrug ? 'مع دواء' : 'بلا دواء'} — السعر ${fmtNum(row.price)} ل.س`} onClose={onClose} busy={busy} wide sheet>
      <form onSubmit={save} className="iron-form" noValidate>
        <div className="ref-box open iron-ref">
          <ReferralRow value={draft} onChange={setDraft} scopes={null} idPrefix="iron-ref" combo options={options} optionsErr={optErr}
            keep={keep} discount={{ total: discount }} disabled={busy} />
          <p className="ref-due" aria-live="polite">
            السعر {fmtNum(row.price)} ← خصم الإحالة {fmtNum(discount)} ← المطلوب من المريض <strong>{fmtNum(Math.max(0, row.price - discount))}</strong>
          </p>
          <small className="hint">توزيع الجلسة (الممرضة والدكتور والشفاء والصندوق) لا يتغيّر — الخصم وحده على الجهة.</small>
        </div>
        {tried && !ready && <p className="iron-err" role="alert">{!draft.referral_source_id ? 'اختاري الجهة المحيلة' : 'قيمة الخصم رقمٌ أكبر من صفر (النسبة حتى 100%)'}</p>}
        <div className="field">
          <label htmlFor="iron-ref-reason">السبب <span className="opt">(اختياري — يبقى في أثر الجلسة)</span></label>
          <input id="iron-ref-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="inline iron-actions">
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : existing ? 'حفظ التعديل' : 'إضافة الإحالة'}</button>
          {existing && <button type="button" className="ghost iron-cancel-btn" disabled={busy} onClick={remove}>حذف الإحالة</button>}
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>رجوع</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══════ السجلّ: سطرٌ لكلّ جلسة، والضغط يفتح ورقتها (2026-11-14) ═══════
// أسئلة من يفتح السجلّ بترتيبها: كم جلسة اليوم وكم قبضنا (وللمشرفة: أين ذهب المال) ⇐ الجلسات واحدةً واحدة
// (من، أيّ نوع، من الطاقم، كم) ⇐ جلسةٌ بعينها: كلّ ما فيها وما جرى عليها، وما يُفعل بها (تعديل، إحالة، إيصال، إلغاء).
function EditChanges({ e }) {
  return (
    <>
      {e.old_doctor !== e.new_doctor && <>الدكتور <bdi>{fmtNum(e.old_doctor)}</bdi> ← <bdi>{fmtNum(e.new_doctor)}</bdi> </>}
      {e.old_nurse !== e.new_nurse && <>الممرضة <bdi>{fmtNum(e.old_nurse)}</bdi> ← <bdi>{fmtNum(e.new_nurse)}</bdi> </>}
    </>
  )
}
const drugText = (v) => (v ? 'مع دواء' : 'بلا دواء')
const isToday = (r) => r.date === todayLocal()

/** شارات الجلسة على سطرها وفي ورقتها */
function SessionBadges({ r }) {
  const edited = (r.changeLog?.length || 0) + (r.edits?.length || 0)
  return (
    <>
      {r.cancelled && <span className="badge bad sm">ملغاة</span>}
      {edited > 0 && <span className="badge blue sm iron-edited-badge">معدَّلة</span>}
      {r.referral && <span className="badge blue sm iron-ref-badge">إحالة</span>}
      {r.overPrice && <span className="badge bad sm iron-over-badge">المواد فوق السعر</span>}
      {r.lowMaterialsConfirmed && <span className="badge sm iron-low-badge">مع دواء بمواد قليلة — مؤكَّدة</span>}
    </>
  )
}

function SessionRow({ r, multiDay, onOpen, onPrint }) {
  return (
    <li className={`ir-row${r.cancelled ? ' is-cancelled' : ''}`}>
      <button type="button" className="ir-row-main" onClick={onOpen} aria-label={`جلسة ${r.patient} — تفاصيل`}>
        <span className="ir-when" dir="ltr">{multiDay && <small>{r.date.slice(5)}</small>}{r.time}</span>
        <span className="ir-who">
          <strong className="ir-patient">{r.patient}</strong>
          <span className="ir-meta">
            <span className={`ir-type${r.withDrug ? ' is-drug' : ''}`}>{drugText(r.withDrug)}</span>
            <span>{r.nurse}</span>
            {r.doctor && <span>{r.doctor}</span>}
          </span>
          {r.materials.length > 0 && <span className="ir-mats">{materialsSummary(r.materials)}</span>}
          <span className="ir-badges"><SessionBadges r={r} /></span>
        </span>
        <span className="ir-amount">
          <strong>{fmtNum(r.paid ?? r.price)}</strong>
          {r.referral && <small>من {fmtNum(r.price)}</small>}
        </span>
        <span className="ir-chev" aria-hidden="true">‹</span>
      </button>
      {onPrint && !r.cancelled && <button type="button" className="ghost ir-print" onClick={onPrint} title="طباعة الإيصال" aria-label={`طباعة إيصال ${r.patient}`}>🖨</button>}
    </li>
  )
}

/** سجلّ ما جرى على الجلسة بالترتيب: التسجيل ⇐ التعديلات (الجلسة والحصص والإحالة) ⇐ الإلغاء */
function SessionTimeline({ r }) {
  const events = [
    ...(r.changeLog || []).map((e) => ({ at: e.at, kind: 'edit', e })),
    ...(r.edits || []).filter((e) => e.stage === 'review').map((e) => ({ at: e.at, kind: 'share', e })),
    ...(r.referralLog || []).map((e) => ({ at: e.at, kind: 'ref', e })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const registerShare = (r.edits || []).find((e) => e.stage === 'register')
  return (
    <ol className="ir-timeline">
      <li><span className="ir-tl-dot" /><div>
        <strong>سُجّلت وقُبضت</strong> <span className="muted">— {r.by} — <bdi dir="ltr">{r.date} {r.time}</bdi></span>
        {registerShare && <p className="ir-tl-sub">بحصّةٍ معدَّلة عند التسجيل: <EditChanges e={registerShare} />— {registerShare.reason}</p>}
      </div></li>
      {events.map((x, i) => (
        <li key={i}><span className={`ir-tl-dot is-${x.kind}`} /><div>
          {x.kind === 'edit' && <>
            <strong>عُدّلت الجلسة</strong> <span className="muted">— {x.e.by} — {fmtDateTime(x.e.at)}</span>
            <ul className="iron-chg">
              {x.e.changes.map((c, k) => (
                <li key={k}><span className="iron-chg-k">{c.label}</span>
                  {c.old === null ? <span className="iron-chg-add">أُضيف: {c.new}</span>
                    : c.new === null ? <span className="iron-chg-del">حُذف ({c.old})</span>
                    : <><del>{c.old}</del><span aria-hidden="true">←</span><ins>{c.new}</ins></>}</li>
              ))}
            </ul>
            <p className="ir-tl-sub">السبب: {x.e.reason}</p>
          </>}
          {x.kind === 'share' && <>
            <strong>عُدّلت الحصّة</strong> <span className="muted">— {x.e.by} — {fmtDateTime(x.e.at)}</span>
            <p className="ir-tl-sub"><EditChanges e={x.e} />— السبب: {x.e.reason}</p>
          </>}
          {x.kind === 'ref' && <>
            <strong>الإحالة {REF_ACTION[x.e.action]}</strong> <span className="muted">— {x.e.by} — {fmtDateTime(x.e.at)}</span>
            <p className="ir-tl-sub">{x.e.old && <><bdi>{x.e.old}</bdi>{x.e.new && ' ← '}</>}{x.e.new && <bdi>{x.e.new}</bdi>}{x.e.reason && <> — السبب: {x.e.reason}</>}</p>
          </>}
        </div></li>
      ))}
      {r.cancelled && (
        <li><span className="ir-tl-dot is-cancel" /><div>
          <strong>أُلغيت</strong> <span className="muted">— {r.cancelled.by} — {fmtDateTime(r.cancelled.at)}</span>
          <p className="ir-tl-sub">السبب: {r.cancelled.reason}</p>
        </div></li>
      )}
    </ol>
  )
}

// ═══════ ورقة الجلسة: لكلّ من يرى السجلّ — والأرقام الداخلية (الكلفة والتوزيع) لمن يراها وحده ═══════
// كلّ رقمٍ من لقطة الجلسة لا من أسعار المخزون الحالية. المواد منذ 2026-11-14 بسعر البيع (ما دخل الصندوق)،
// وكلفتها بسعر الشراء لحظة الصرف، والفرق ربحها؛ والأقدم بسعر الشراء (ربحها صفر) أو بسعر البيع القديم.
function SessionSheet({ r, split, actions, onClose }) {
  const s = r.split
  const mats = r.materials.map((m) => {
    if (!split) return m
    const cost = m.costBasis === 'sale' ? (m.unitCost === null ? null : Math.round(m.qty * m.unitCost)) : m.costBasis === 'purchase' ? m.deduct : null
    return { ...m, fundIn: m.deduct, costTotal: cost, profit: cost === null ? null : m.deduct - cost }
  })
  const sum = (k) => mats.reduce((t, m) => t + (m[k] ?? 0), 0)
  const oldBasis = split && r.materials.some((m) => m.costBasis !== 'sale')
  return (
    <Modal title={r.patient} subtitle={`جلسة حديد — ${r.date} الساعة ${r.time}`} onClose={onClose} wide sheet>
      <div className="ir-sheet">
        <div className="ir-sheet-badges"><SessionBadges r={r} /></div>
        <div className="ir-facts">
          <div className="ir-fact is-money">
            <span>{r.referral ? 'دفعه المريض' : 'المبلغ المقبوض'}</span>
            <strong><Money value={r.paid ?? r.price} /></strong>
            {r.referral && <small>من {fmtNum(r.price)} — خصم {fmtNum(r.discount)} على {r.referral.source}{r.referral.referral_doc_number && <> (ورقة <bdi>{r.referral.referral_doc_number}</bdi>)</>}</small>}
          </div>
          <div className="ir-fact"><span>النوع</span><strong>{drugText(r.withDrug)}</strong></div>
          <div className="ir-fact"><span>الممرضة</span><strong>{r.nurse}</strong></div>
          <div className="ir-fact"><span>الدكتور</span><strong>{r.doctor || 'بلا دكتور'}</strong></div>
          <div className="ir-fact"><span>القابضة</span><strong>{r.by}</strong></div>
        </div>

        <section className="ir-block" aria-label="المواد">
          <h4>المواد</h4>
          {mats.length === 0 ? <p className="empty">لا مواد في هذه الجلسة.</p> : !split ? (
            <ul className="ir-mat-list">{mats.map((m) => <li key={m.material_id}><span>{m.name}</span><b>{fmtNum(m.qty)} {m.unit}</b></li>)}</ul>
          ) : (
            <>
              <table className="ir-mat-table">
                <thead><tr><th>المادة</th><th className="num">الكمية</th><th className="num">للصندوق</th><th className="num">الكلفة</th><th className="num">الربح</th></tr></thead>
                <tbody>
                  {mats.map((m) => (
                    <tr key={m.material_id}>
                      <td>{m.name}{m.costBasis === 'sale' && m.unitCost === null && <> <span className="badge warn sm" title="لم يكن لها سعر شراء لحظة الصرف">بلا سعر شراء</span></>}</td>
                      <td className="num">{fmtNum(m.qty)} <small>{m.unit}</small></td>
                      <td className="num">{fmtNum(m.fundIn)}</td>
                      <td className="num">{m.costTotal === null ? '—' : fmtNum(m.costTotal)}</td>
                      <td className="num">{m.profit === null ? '—' : fmtNum(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>المجموع</td><td className="num">{fmtNum(sum('fundIn'))}</td><td className="num">{fmtNum(sum('costTotal'))}</td><td className="num">{fmtNum(sum('profit'))}</td></tr></tfoot>
              </table>
              <p className="earn-note">
                المواد بسعر البيع كالإجراءات: «للصندوق» ثمن بيعها، و«الكلفة» بسعر الشراء لحظة الصرف، والفرق ربحٌ للصندوق.
                {oldBasis && ' هذه الجلسة أقدم: موادّها طُرحت بسعر الشراء (أو بسعر البيع قبله) كما حُسبت يومها.'}
              </p>
            </>
          )}
        </section>

        {split && s && (
          <section className="ir-block" aria-label="التوزيع">
            <h4>أين ذهب المبلغ</h4>
            <div className="ir-dist">
              {[['المواد', s.materials, 'للصندوق'], ['الدكتور', s.doctor], ['الممرضة', s.nurse], ['الشفاء', s.shifa], ['الفاضل', s.surplus, 'للصندوق']].map(([k, v, note]) => (
                <div key={k} className="ir-dist-cell"><span>{k}{note && <small> {note}</small>}</span><strong>{fmtNum(v)}</strong></div>
              ))}
            </div>
            <p className="earn-note">يدخل صندوق العيادات <bdi>{fmtNum(fundOf(s))}</bdi> ل.س (المواد والفاضل).{r.shifaCap !== null && <> سقف الشفاء لهذه الجلسة <bdi>{fmtNum(r.shifaCap)}</bdi>.</>}
              {r.overPrice && ' المواد فوق ما بقي بعد الحصص: سُقّفت والشفاء صفر.'}{r.version !== 2 && ' جلسة قبل نظام السقف: أرقامها مجمّدة.'}</p>
          </section>
        )}

        <section className="ir-block" aria-label="ما جرى على الجلسة">
          <h4>ما جرى على الجلسة</h4>
          <SessionTimeline r={r} />
        </section>

        <div className="ir-actions">
          {actions.edit && <button type="button" className="ir-act-edit" onClick={actions.edit}>تعديل الجلسة</button>}
          {actions.refer && <button type="button" className="ghost" onClick={actions.refer}>{r.referral ? 'الإحالة' : '+ إحالة'}</button>}
          {actions.print && <button type="button" className="ghost" onClick={actions.print}>🖨 إيصال</button>}
          {actions.shares && <button type="button" className="ghost" onClick={actions.shares}>تعديل الحصص</button>}
          <span className="ir-actions-gap" />
          {actions.cancel && <button type="button" className="ghost danger ir-act-cancel" onClick={actions.cancel}>إلغاء الجلسة</button>}
          <button type="button" className="ghost" onClick={onClose}>إغلاق</button>
        </div>
        {actions.lockedNote && <p className="earn-note">{actions.lockedNote}</p>}
      </div>
    </Modal>
  )
}

function LogTab({ split, canPrint, canCancel, reload, showToast }) {
  const p = usePeriod('today')
  const dialogs = useDialogs()
  const [bump, setBump] = useState(0)
  const [openId, setOpenId] = useState(null)       // الورقة من السطر الحيّ: تتحدّث بعد كلّ حفظ
  const [mode, setMode] = useState(null)           // null | 'edit' | 'shares' | 'refer' — نافذةٌ واحدة فوق الورقة
  const [data, err] = useLoad(() => api.clinic.ironSessions(p.query), p.key, reload + bump)
  const r = openId && data?.rows.find((x) => x.id === openId)
  const refresh = () => setBump((n) => n + 1)
  // الاستقبال يوم الجلسة وحده، والمشرفة أيّ وقت (canCancel = المشرفة) — والخادم يحرس الاثنين
  const inTime = (x) => canCancel || isToday(x)
  const editable = (x) => !x.cancelled && canPrint && inTime(x) && (x.version === undefined || x.version === 2)
  const print = async (x) => {
    const out = await printIronReceipt(x, 1)
    if (!out.ok) showToast(`تعذّرت الطباعة${out.reason ? ` (${out.reason})` : ''}`)
  }
  const cancel = async (x) => {
    const reason = await dialogs.prompt({
      title: `إلغاء جلسة ${x.patient}`,
      body: `تُعكس حركات الصندوق${x.materials.length > 0 ? ' وترجع كلّ المواد للمخزون بكمّياتها' : ''}، وتنزل المستحقات وحصّة الشفاء. الإلغاء لا رجعة عنه، والجلسة تبقى في السجلّ معلَّمة.`,
      placeholder: 'سبب الإلغاء', confirmLabel: 'إلغاء الجلسة', cancelLabel: 'رجوع', required: true, danger: true,
    })
    if (reason == null) return
    try {
      await api.clinic.cancelIronSession(x.id, reason)
      showToast('أُلغيت الجلسة وعُكست حركاتها', 'success', 3500)
      refresh()
    } catch (ex) { showToast(ex.message) }
  }
  const edited = (out) => {
    setMode(null); refresh()
    const diff = out.paid - ((r?.paid ?? r?.price) || 0)
    const money = diff > 0 ? ` — اقبضي ${fmtNum(diff)} ل.س إضافية` : diff < 0 ? ` — رُدّي للمريض ${fmtNum(-diff)} ل.س` : ''
    const warns = (out.stock_warnings || []).map((w) => `رصيد «${w.name}» صار ${fmtQty(w.after)} ${w.unit}.`)
    showToast(`عُدّلت الجلسة${money}${warns.length ? ` — ⚠ ${warns.join(' ')}` : ''}`, warns.length || diff !== 0 ? 'warning' : 'success', diff !== 0 ? 9000 : 4000)
  }
  const t = data?.totals
  return (
    <div className="card earn-card ir-log">
      <PeriodPicker p={p} data={data} formal />
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <p className="empty">لا جلسات حديد في هذه الفترة.</p> : (
        <>
          <div className="ir-strip">
            <div className="ir-stat"><span>الجلسات</span><strong>{fmtNum(t.count)}</strong>
              <small>{t.withDrug > 0 ? `منها ${fmtNum(t.withDrug)} مع دواء` : 'كلّها بلا دواء'}{t.cancelled > 0 && ` · ملغاة ${fmtNum(t.cancelled)}`}</small></div>
            <div className="ir-stat is-hero"><span>المقبوض</span><strong><Money value={t.paid ?? t.price} /></strong>
              {t.discount > 0 && <small>بعد خصم إحالات {fmtNum(t.discount)} على الجهات</small>}</div>
            {split && t.split && <>
              <div className="ir-stat"><span>للشفاء</span><strong>{fmtNum(t.split.shifa)}</strong></div>
              <div className="ir-stat"><span>للصندوق</span><strong>{fmtNum(fundOf(t.split))}</strong><small>المواد والفاضل</small></div>
              <div className="ir-stat"><span>للطاقم</span><strong>{fmtNum(t.split.nurse + t.split.doctor)}</strong>
                <small>ممرضات {fmtNum(t.split.nurse)}{t.split.doctor > 0 && ` · دكاترة ${fmtNum(t.split.doctor)}`}</small></div>
            </>}
          </div>
          {t.overPrice > 0 && <p className="ir-alert">جلسات موادّها فوق السعر: {fmtNum(t.overPrice)} — الشفاء فيها صفر. افتحي الجلسة لمراجعتها.</p>}
          <ul className="ir-list">
            {data.rows.map((x) => (
              <SessionRow key={x.id} r={x} multiDay={data.from !== data.to} onOpen={() => { setOpenId(x.id); setMode(null) }}
                onPrint={canPrint ? () => print(x) : null} />
            ))}
          </ul>
          <p className="earn-note">اضغطي على الجلسة لرؤية تفاصيلها وما جرى عليها، ولتعديلها{canCancel ? '' : ' (يوم الجلسة)'} أو طباعة إيصالها.</p>
        </>
      )}
      {r && mode === null && (
        <SessionSheet r={r} split={split} onClose={() => setOpenId(null)} actions={{
          edit: editable(r) ? () => setMode('edit') : null,
          refer: !r.cancelled && canPrint && inTime(r) ? () => setMode('refer') : null,
          print: canPrint && !r.cancelled ? () => print(r) : null,
          shares: canCancel && !r.cancelled && r.version === 2 ? () => setMode('shares') : null,
          cancel: canCancel && !r.cancelled ? () => { setOpenId(null); cancel(r) } : null,
          lockedNote: !r.cancelled && canPrint && !inTime(r) ? 'جلسة يومٍ سابق: يعدّلها ويضيف إحالتها مشرفة العيادات.' : null,
        }} />
      )}
      {r && mode === 'edit' && <IronSessionDialog session={r} onClose={() => setMode(null)} onSaved={edited} />}
      {r && mode === 'refer' && <ReferralDialog row={r} onClose={() => setMode(null)}
        onSaved={(msg) => { setMode(null); showToast(msg, 'success', 3500); refresh() }} />}
      {r && mode === 'shares' && <EditSharesDialog row={r} onClose={() => setMode(null)}
        onSaved={() => { setMode(null); showToast('عُدّلت الحصّة وأُعيد الحساب', 'success', 3500); refresh() }} />}
    </div>
  )
}

// ═══════ المستحقات ═══════
function DuesTable({ title, rows, empty, note }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="card earn-card">
      <div className="earn-head"><h3>{title}</h3></div>
      {rows.length === 0 ? <p className="empty">{empty}</p> : (
        <table className="rtable earn-table">
          <thead><tr><th>الاسم</th><th>الجلسات</th><th>المستحق</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <FragmentRows key={g.id} g={g} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
            ))}
          </tbody>
          <tfoot>
            <tr className="earn-total">
              <td className="rt-title">الإجمالي</td>
              <td className="num" data-label="الجلسات">{fmtNum(rows.reduce((t, g) => t + g.count, 0))}</td>
              <td className="num earn-doc" data-label="المستحق">{fmtNum(rows.reduce((t, g) => t + g.share, 0))}</td>
              <td className="rt-actions" />
            </tr>
          </tfoot>
        </table>
      )}
      {note && <p className="earn-note">{note}</p>}
    </div>
  )
}

function FragmentRows({ g, open, onToggle }) {
  return (
    <>
      <tr>
        <td className="rt-title">{g.name}</td>
        <td className="num" data-label="الجلسات">{fmtNum(g.count)}</td>
        <td className="num earn-doc" data-label="المستحق">{fmtNum(g.share)}</td>
        <td className="rt-actions"><button type="button" className="ghost" aria-expanded={open} onClick={onToggle}>{open ? 'طيّ' : 'التفصيل'}</button></td>
      </tr>
      {open && g.lines.map((l) => (
        <tr key={l.id} className="iron-line">
          <td className="rt-title">{l.patient}</td>
          <td data-label="التاريخ"><bdi dir="ltr">{l.date} {l.time}</bdi> — {l.withDrug ? 'مع دواء' : 'بلا دواء'}</td>
          <td className="num" data-label="الحصّة">{fmtNum(l.share)}</td>
          <td className="rt-actions" />
        </tr>
      ))}
    </>
  )
}

function DuesTab() {
  const p = usePeriod('month')
  const [data, err] = useLoad(() => api.clinic.ironDues(p.query), p.key)
  const t = data?.totals.split
  return (
    <>
      <div className="card earn-card">
        <div className="earn-head"><h3>توزيع الفترة</h3></div>
        <PeriodPicker p={p} data={data} />
        {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
          : data.totals.count === 0 ? <p className="empty">لا جلسات حديد في هذه الفترة.</p> : (
          <div className="tiles earn-tiles">
            <div className="tile"><div className="label">المقبوض ({sessionsText(data.totals.count)})</div><div className="value"><Money value={data.totals.paid ?? data.totals.price} /></div>
              {data.totals.discount > 0 && <div className="hint">والسعر الكامل {fmtNum(data.totals.price)} — الفرق على الجهات المحيلة</div>}</div>
            <div className="tile earn-hero"><div className="label">مستحقات الممرضات</div><div className="value"><Money value={t.nurse} /></div></div>
            <div className="tile"><div className="label">مستحقات الدكاترة</div><div className="value"><Money value={t.doctor} /></div></div>
            <div className="tile"><div className="label">إيرادات الشفاء</div><div className="value"><Money value={t.shifa} /></div></div>
            <div className="tile"><div className="label">لصندوق العيادات</div><div className="value"><Money value={t.materials + t.surplus} /></div>
              <div className="hint">المواد {fmtNum(t.materials)} والفاضل {fmtNum(t.surplus)}</div></div>
          </div>
        )}
      </div>
      {data && data.totals.count > 0 && (
        <>
          <DuesTable title="مستحقات الممرضات" rows={data.nurses} empty="لا مستحقات." />
          <DuesTable title="مستحقات الدكاترة من الحديد" rows={data.doctors} empty="لا جلسات بدكتور في هذه الفترة."
            note={<>تظهر أيضاً مميَّزةً في <Link to="/clinic/payroll">الرواتب والأجور</Link> مع حصصهم من الإجراءات.</>} />
        </>
      )}
    </>
  )
}

// ═══════ الإعدادات ═══════
const FIELDS = [
  ['price_without_drug', 'سعر الجلسة بلا دواء'],
  ['price_with_drug', 'سعر الجلسة مع دواء'],
  ['nurse_share', 'حصّة الممرضة (إلزامية)'],
  ['doctor_share', 'حصّة الدكتور (إن وُجد)'],
  ['shifa_share', 'سقف حصّة الشفاء'],
]
const HISTORY_LABELS = { ...Object.fromEntries(FIELDS), drug_material: 'مادة الدواء (سابقاً)' }
const scenarioText = (s) => `${s.with_drug ? 'مع دواء' : 'بلا دواء'} ${s.with_doctor ? '+ دكتور' : '— بلا دكتور'}`

function SettingsTab({ canWrite, showToast }) {
  const dialogs = useDialogs()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newNurse, setNewNurse] = useState('')

  const load = () => api.clinic.ironSettings().then((d) => {
    setData(d)
    setForm(Object.fromEntries(FIELDS.map(([k]) => [k, String(d.settings[k])])))
  }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err && !data) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>

  const dirty = FIELDS.some(([k]) => form[k] !== String(data.settings[k]))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.clinic.setIronSettings(form)
      showToast('حُفظت الإعدادات — تسري على الجلسات القادمة وحدها', 'success', 3500)
      await load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const addNurse = async (e) => {
    e.preventDefault()
    if (!newNurse.trim()) return
    try { await api.clinic.addNurse({ name: newNurse }); setNewNurse(''); await load() }
    catch (ex) { showToast(ex.message) }
  }
  const renameNurse = async (n) => {
    const name = await dialogs.prompt({ title: 'تعديل اسم الممرضة', defaultValue: n.name, confirmLabel: 'حفظ', required: true })
    if (name == null || name.trim() === n.name) return
    try { await api.clinic.updateNurse(n.id, { name }); await load() } catch (ex) { showToast(ex.message) }
  }
  const toggleNurse = async (n) => {
    try { await api.clinic.updateNurse(n.id, { is_active: !n.is_active }); await load() } catch (ex) { showToast(ex.message) }
  }

  return (
    <>
      <div className="card earn-card">
        <div className="earn-head"><h3>الأسعار والحصص</h3></div>
        <form onSubmit={save}>
          <div className="iron-settings-grid">
            {FIELDS.map(([k, label]) => (
              <div className="field" key={k}>
                <label htmlFor={`iron-${k}`}>{label}</label>
                <input id={`iron-${k}`} value={form[k]} inputMode="decimal" disabled={!canWrite}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          {canWrite && <button type="submit" disabled={!dirty || busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>}
        </form>
      </div>

      <div className="card earn-card">
        <div className="earn-head"><h3>معاينة التوزيع بلا مواد</h3></div>
        <p className="earn-note">المواد المضافة تُنقص الباقي: تأخذ الشفاء منه حتى سقفها، والزيادة للصندوق.</p>
        <table className="rtable earn-table">
          <thead><tr><th>الحالة</th><th>السعر</th><th>الممرضة</th><th>الدكتور</th><th>الشفاء</th><th>الزيادة للصندوق</th></tr></thead>
          <tbody>
            {data.preview.map((s) => (
              <tr key={scenarioText(s)} className={s.negative ? 'earn-neg' : undefined}>
                <td className="rt-title">{scenarioText(s)}</td>
                <td className="num" data-label="السعر">{fmtNum(s.price)}</td>
                <td className="num" data-label="الممرضة">{fmtNum(s.nurse)}</td>
                <td className="num" data-label="الدكتور">{fmtNum(s.doctor)}</td>
                <td className="num" data-label="الشفاء">{fmtNum(s.shifa)}</td>
                <td className={`num${s.negative ? ' neg' : ''}`} data-label="الفاضل">
                  {s.negative ? 'الحصص فوق السعر ⚠' : fmtNum(s.surplus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.preview.some((s) => s.negative) && (
          <p className="share-warn" role="alert">⚠ الحالة المعلَّمة تُرفض عند التسجيل حتى تُحدَّث الأرقام: مجموع الحصّتين أكبر من سعر الجلسة.</p>
        )}
      </div>

      <div className="card earn-card">
        <div className="earn-head"><h3>الممرضات</h3></div>
        {canWrite && (
          <form className="inline iron-nurse-add" onSubmit={addNurse}>
            <div className="field"><label htmlFor="iron-new-nurse">اسم ممرضة جديدة</label>
              <input id="iron-new-nurse" value={newNurse} onChange={(e) => setNewNurse(e.target.value)} /></div>
            <button type="submit" disabled={!newNurse.trim()}>إضافة</button>
          </form>
        )}
        {data.nurses.length === 0 ? <p className="empty">لا ممرضات بعد — أضيفي أولاً، فالتسجيل يحتاج ممرضة.</p> : (
          <ul className="iron-nurses">
            {data.nurses.map((n) => (
              <li key={n.id}>
                <span className={n.is_active ? '' : 'muted'}>{n.name}</span>
                {!n.is_active && <span className="badge sm">موقوفة</span>}
                {canWrite && (
                  <span className="iron-nurse-actions">
                    <button type="button" className="ghost" onClick={() => renameNurse(n)}>تعديل</button>
                    <button type="button" className="ghost" onClick={() => toggleNurse(n)}>{n.is_active ? 'إيقاف' : 'تفعيل'}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.history.length > 0 && (
        <details className="card earn-card iron-history">
          <summary>سجلّ تعديل الإعدادات</summary>
          <ul>
            {data.history.map((h) => (
              <li key={h.id}>
                {HISTORY_LABELS[h.field]}: <bdi>{h.old_value ?? '—'}</bdi> ← <bdi>{h.new_value ?? '—'}</bdi>
                <span className="muted"> — {h.by_name} — {fmtDateTime(h.changed_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

const ALL_TABS = [['log', 'السجلّ'], ['dues', 'المستحقات'], ['settings', 'الإعدادات']]

export default function IronSessions() {
  const { clinicRole: role } = useRole()
  const split = canSeeIronSplit(role)
  const tabs = split ? ALL_TABS : []
  const [params, setParams] = useSearchParams()
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'log'
  const [toast, showToast] = useToast()
  const [adding, setAdding] = useState(false)
  const [reload, setReload] = useState(0)

  // النافذة أُغلقت: الجلسة ظاهرة في سجلّ اليوم أيّاً كان التبويب أو الفترة، والرسالة تحمل ما كانت تقوله شاشة
  // النجاح من تحذيرات. الجلسة سُجّلت قبل هذا كلّه: فشل الطباعة رسالةٌ لا تراجع.
  const sessionSaved = async (s) => {
    setAdding(false); setReload((n) => n + 1); setParams({}, { replace: true })
    const notes = [
      ...(s.overPrice ? ['المواد فوق ما بقي بعد الحصص: سُقّفت والشفاء صفر — الجلسة معلَّمة في السجلّ.'] : []),
      ...(s.stock_warnings || []).map((w) => `رصيد «${w.name}» صار ${fmtQty(w.after)} ${w.unit} — أبلغي مشرفة العيادات.`),
    ]
    const say = (extra = []) => {
      const all = [...notes, ...extra]
      const head = `سُجّلت جلسة ${s.patient} وقُبض ${fmtNum(s.paid ?? s.price)} ل.س${s.discount > 0 ? ` (بعد خصم إحالة ${fmtNum(s.discount)})` : ''}`
      if (all.length === 0) showToast(head, 'success', 4000)
      else showToast(`${head} — ⚠ ${all.join(' ')}`, 'warning', 15000)
    }
    say()
    const printer = loadPrinter()
    if (!printer.enabled) return
    const r = await printIronReceipt(s, printer.copies)
    if (!r.ok) say([`تعذّرت طباعة الإيصال${r.reason ? ` (${r.reason})` : ''} — اطبعيه من السجلّ.`])
  }

  return (
    <>
      {toast}
      <div className="page-head">
        <div>
          <h2>جلسات الحديد</h2>
          <p className="subtitle">تسريب حديد مباشر: يُسجَّل ويُقبض فوراً — بلا دور ولا عيادة ولا حجز.</p>
        </div>
        {canCollectIron(role) && <button type="button" onClick={() => setAdding(true)}>+ جلسة حديد</button>}
      </div>
      {tabs.length > 0 && (
        <div className="inline proc-tabs inv-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={tab === k ? '' : 'ghost'} onClick={() => setParams(k === 'log' ? {} : { tab: k })}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'log' && <LogTab split={split} canPrint={canCollectIron(role)} canCancel={canCancelIron(role)} reload={reload} showToast={showToast} />}
      {tab === 'dues' && <DuesTab />}
      {tab === 'settings' && <SettingsTab canWrite={canWriteIronSettings(role)} showToast={showToast} />}
      {adding && <IronSessionDialog onClose={() => setAdding(false)} onSaved={sessionSaved} />}
    </>
  )
}
