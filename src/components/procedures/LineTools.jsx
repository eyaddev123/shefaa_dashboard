import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtDateTime, toLatinDigits, openStaffStream } from '../../api.js'
import MaterialsEditor, { qtyValid, toPayload, fmtQty } from '../MaterialsEditor.jsx'

// ═══ أدوات أسطر الإجراءات — كانت في تبويب «المراجعة» (أُزيل 2026-11-15) وصارت في «المستحقات» ═══
//   UnpaidPanel  — «بانتظار المحاسبة» من كلّ الأيام: تعليم مدفوع، أو إزالة بسببٍ إلزامي (المشرفة)
//   EmptyVisits  — زيارات «إجراء فقط» انتهت بلا إجراء في الفترة: هل نُسي تسجيله؟
//   LineEditor   — تصحيح مواد سطرٍ وكمّياتها (ومستهلكاته بسبب) — يُعاد الحساب في الخادم
//   LineHistory  — أثر السطر: كلّ تصحيحٍ بفاعله وأرقامه قبل وبعد
// المنطق كلّه في الخادم كما كان؛ هنا العرض والطلب وحدهما.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })

export function useUnpaid(onError) {
  const [data, setData] = useState(null)
  const load = () => api.clinic.unpaidProcedures().then(setData).catch((e) => onError?.(e.message))
  useEffect(() => {
    load()
    let timer = null
    const close = openStaffStream((name) => {
      if (name !== 'procedure') return
      clearTimeout(timer); timer = setTimeout(load, 300)
    })
    return () => { clearTimeout(timer); close() }
  }, [])
  return [data, load]
}

export function UnpaidPanel({ data, canEdit, showToast, onChanged }) {
  const [removing, setRemoving] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null)
  const [editing, setEditing] = useState(null)   // سطرٌ غير مدفوع تُصحَّح موادّه قبل قبضه (كان في المراجعة)
  const done = (msg) => { showToast(msg, 'success', 3000); setRemoving(null); setReason(''); onChanged() }
  const pay = async (l) => {
    setBusy(l.id)
    try { await api.clinic.markProcedurePaid(l.appointment_id, l.id); done(`عُلّم «${l.name}» مدفوعاً`) }
    catch (ex) { showToast(ex.message) } finally { setBusy(null) }
  }
  const remove = async (l) => {
    if (!reason.trim()) return
    setBusy(l.id)
    try { await api.clinic.removeAppointmentProcedure(l.appointment_id, l.id, reason.trim()); done(`أُزيل «${l.name}»`) }
    catch (ex) { showToast(ex.message) } finally { setBusy(null) }
  }
  return (
    <ul className="pex-plist">
      {data.lines.map((l) => (
        <li key={l.id} className="pex-pline">
          <div className="pex-pwho">
            <span className="pex-pname">{l.name}</span>
            <span className="pex-pmeta">{l.patient_name}، {l.doctor_name}
              {l.session_date !== data.today && <span className="pay-badge is-unpaid">من يومٍ سابق</span>}</span>
            <span className="pex-pmeta" dir="ltr">{fmtDateTime(l.added_at)}</span>
          </div>
          <span className="pex-pamt">{fmtMoney(l.price)}</span>
          {canEdit && (removing === l.id ? (
            <span className="proc-remove-form pex-pact">
              <input value={reason} autoFocus placeholder="سبب الإزالة (إلزامي)" aria-label="سبب الإزالة"
                onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') remove(l) }} />
              <button disabled={busy === l.id || !reason.trim()} onClick={() => remove(l)}>تأكيد الإزالة</button>
              <button className="ghost" onClick={() => setRemoving(null)}>إلغاء</button>
            </span>
          ) : (
            <span className="pex-pact">
              <button className="pay-btn" disabled={busy === l.id} onClick={() => pay(l)}>تعليم مدفوع</button>
              <button className="ghost" disabled={busy === l.id} onClick={() => setEditing(editing === l.id ? null : l.id)}>تصحيح المواد</button>
              <button className="ghost" disabled={busy === l.id} onClick={() => { setRemoving(l.id); setReason('') }}>إزالة</button>
            </span>
          ))}
          {editing === l.id && (
            <div className="pex-line-open pex-pedit">
              <LineEditor lineId={l.id} showToast={showToast} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged() }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function EmptyVisitsList({ visits }) {
  return (
    <ul className="pex-plist">
      {visits.map((v) => (
        <li key={v.id} className="pex-pline">
          <div className="pex-pwho">
            <Link className="pex-pname" to={`/clinic/session/${v.session_id}/visit/${v.id}`}>{v.patient_name}</Link>
            <span className="pex-pmeta">{v.doctor_name}، <bdi dir="ltr">{v.session_date}</bdi></span>
          </div>
          <Link className="pex-pact link-btn" to={`/clinic/session/${v.session_id}/visit/${v.id}`}>فتح الزيارة ←</Link>
        </li>
      ))}
    </ul>
  )
}

export function LineHistory({ lineId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.clinic.procedureHistory(lineId).then(setRows).catch((e) => setErr(e.message)) }, [lineId])
  if (err) return <p className="error">{err}</p>
  if (!rows) return <p className="empty">جارٍ التحميل…</p>
  if (rows.length === 0) return <p className="pex-none">لا تصحيح على هذا الإجراء منذ تسجيله.</p>
  return (
    <ul className="rev-history">
      {rows.map((h) => (
        <li key={h.id}>
          <span dir="ltr">{new Date(h.changed_at).toLocaleString('en-CA', { hour12: false }).slice(0, 17)}</span>
          {' — '}<strong>{h.changed_by_name || '—'}</strong>
          {(h.change_detail || []).length > 0 && (
            <span>: {h.change_detail.map((d) => (d.old_amount !== undefined
              ? `${d.material} ${fmtMoney(d.old_amount)} ← ${fmtMoney(d.new_amount)}`
              : `${d.material} ${fmtQty(d.old_qty)} ← ${fmtQty(d.new_qty)}`)).join('، ')}</span>
          )}
          {h.reason && <span> ({h.reason})</span>}
          <span className="rev-history-nums">
            المواد {fmtMoney(h.old_materials)} ← {fmtMoney(h.new_materials)}، الدكتور {fmtMoney(h.old_doctor)} ← {fmtMoney(h.new_doctor)}، الشفاء {fmtMoney(h.old_shifa)} ← {fmtMoney(h.new_shifa)}
          </span>
        </li>
      ))}
    </ul>
  )
}

// كتالوج المواد المعدودة يُحمَّل مرّةً للصفحة (الاستهلاكية قيمتها على نوع الإجراء، والخادم يرفضها على السطر)
let catalogPromise = null
const loadCatalog = () => {
  if (!catalogPromise) catalogPromise = api.clinic.materials()
    .then((r) => r.filter((m) => m.is_active && m.material_kind !== 'consumable'))
    .catch((e) => { catalogPromise = null; throw e })
  return catalogPromise
}

// ★ المستهلكات (الإصدار 2 وحده): لقطة نوع الإجراء على السطر — تُعدَّل استثناءً بسببٍ إلزاميّ
export function LineEditor({ lineId, onSaved, onCancel, showToast }) {
  const [line, setLine] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    Promise.all([api.clinic.procedureLine(lineId), loadCatalog()])
      .then(([l, c]) => { setLine(l); setCatalog(c) }).catch((e) => setErr(e.message))
  }, [lineId])
  if (err) return <p className="error">{err}</p>
  if (!line || !catalog) return <p className="empty">جارٍ التحميل…</p>
  return <EditForm line={line} catalog={catalog} onSaved={onSaved} onCancel={onCancel} showToast={showToast} />
}

function EditForm({ line, catalog, onSaved, onCancel, showToast }) {
  const [mats, setMats] = useState(() => line.materials.map((m) => ({ ...m, qty: fmtQty(m.qty) })))
  const legacyStart = Number(line.legacy_materials || 0)
  const [legacy, setLegacy] = useState(String(legacyStart))
  const v2 = Number(line.distribution_version) === 2
  const consStart = Number(line.consumables_estimate || 0)
  const [cons, setCons] = useState(String(consStart))
  const consChanged = v2 && Number(cons || 0) !== consStart
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const body = { materials: toPayload(mats) }
      if (legacyStart > 0 && Number(legacy || 0) !== legacyStart) body.legacy_materials = legacy || '0'
      if (consChanged) { body.consumables_estimate = cons || '0'; body.reason = reason.trim() }
      const r = await api.clinic.setLineMaterials(line.appointment_id, line.id, body)
      if (r.unchanged) showToast('لا تغيير', 'success', 2500)
      else if (r.warnings && r.warnings.length) showToast(`حُفظ — ⚠ ${r.warnings[0]}`, 'warn', 7000)
      else showToast(`أُعيد الحساب: الدكتور ${fmtMoney(r.doctor_share)}، الشفاء ${fmtMoney(r.shifa_share)}`, 'success', 4000)
      onSaved()
    } catch (ex) {
      setMats(line.materials.map((m) => ({ ...m, qty: fmtQty(m.qty) })))
      showToast(`${ex.message} — لم تُحفظ المواد، ورجعت الكمّيات لآخر قيمةٍ محفوظة`)
    } finally { setBusy(false) }
  }
  return (
    <div className="rev-edit pex-edit">
      <p className="pex-edit-lead">صحّح المواد التي استُعملت فعلاً لـ«{line.name_snapshot}» — يُعاد حساب حصّة الدكتور والشفاء والمخزون فور الحفظ، ويُسجَّل التصحيح في أثر السطر.</p>
      <MaterialsEditor catalog={catalog} value={mats} onChange={setMats} disabled={busy} saved={line.materials} />
      {legacyStart > 0 && (
        <label className="rev-legacy">مواد سابقة (إجمالي، من التسوية القديمة):
          <input value={legacy} inputMode="decimal" style={{ width: 120 }} onChange={(e) => setLegacy(toLatinDigits(e.target.value))} />
        </label>
      )}
      {v2 && (
        <div className="rev-consumables">
          <label>المستهلكات (تقدير نوع الإجراء):
            <input value={cons} inputMode="decimal" style={{ width: 110 }} onChange={(e) => setCons(toLatinDigits(e.target.value))} />
          </label>
          {consChanged && (
            <label>السبب (إلزامي):
              <input value={reason} maxLength={300} placeholder="مثلاً: ضماد إضافي" onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
        </div>
      )}
      <div className="mat-actions">
        <button disabled={busy || !qtyValid(mats) || (consChanged && !reason.trim())} onClick={save}>حفظ وإعادة الحساب</button>
        <button className="ghost" disabled={busy} onClick={onCancel}>إلغاء</button>
      </div>
    </div>
  )
}

