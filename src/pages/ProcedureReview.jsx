import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtDateTime, todayLocal, toLatinDigits, openStaffStream } from '../api.js'
import MaterialsEditor, { qtyValid, toPayload, fmtQty, materialsSummary } from '../components/MaterialsEditor.jsx'

// ═══ المراجعة: كلّ إجراءٍ بموادّه وحصّتيه ═══
// لا شيء ينتظر هنا: كلّ سطرٍ حُسب لحظة إضافته. الصفحة للاطّلاع والتصحيح:
//   أحمر — الشفاء سالبة على السطر (المواد + الدكتور فاقا السعر)
//   أصفر — الدكتور بلا قاعدة لحظة الإضافة، فحصّته صفر: اضبط بروفايله
// وضبطُ القاعدة لاحقاً لا يمسّ الأسطر القائمة (لقطة) — الإشارة تقول ذلك صراحةً.
// مشرف العيادات يصحّح مواد أيّ سطر في أيّ وقت، وكلُّ تغييرٍ له أثر.
//
// ★ «غير المدفوع — كلّ الأيام» أعلى الصفحة: إجراءاتٌ أضافها الأطباء ولم تُقبض. هنا لا في
//   تبويبٍ مستقلّ: المشرفة تراجع الأسطر في هذه الصفحة أصلاً، والقائمة لا تتبع مرشِّح التاريخ —
//   فهي الضمان ضدّ الإغلاق التلقائي الذي لا يمرّ على مودال الإغلاق. وفي جدول المدى شارة
//   «غير مدفوع» ومرشِّحها: السطر يُعرض هنا ولا يدخل الجرد ولا المستحقات حتى يُقبض.

const FLAGS = [
  { key: '', label: 'الكل' },
  { key: 'negative', label: 'الشفاء سالبة', cls: 'is-neg' },
  { key: 'no_rule', label: 'بلا قاعدة', cls: 'is-norule' },
  { key: 'unpaid', label: 'غير مدفوع', cls: 'is-unpaid' },
]

// ═══ غير المدفوع عبر الأيام — مع «تعليم مدفوع» و«إزالة بسبب» للمشرفة ═══
function UnpaidAcrossDays({ canEdit, showToast, onChanged }) {
  const [data, setData] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null)
  const load = () => api.clinic.unpaidProcedures().then(setData).catch((e) => showToast(e.message))
  useEffect(() => {
    load()
    let timer = null
    const close = openStaffStream((name) => {
      if (name !== 'procedure') return
      clearTimeout(timer); timer = setTimeout(load, 300)
    })
    return () => { clearTimeout(timer); close() }
  }, [])
  const done = (msg) => { showToast(msg, 'success', 3000); setRemoving(null); setReason(''); load(); onChanged() }
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
  if (!data) return null
  if (data.lines.length === 0) return <p className="rev-unpaid-none">✓ لا إجراءات غير مدفوعة.</p>
  return (
    <div className="rev-unpaid" role="region" aria-labelledby="rev-unpaid-title">
      <h4 id="rev-unpaid-title">
        غير المدفوع — كلّ الأيام <span className="rev-flag-n">{data.lines.length}</span>
        <span className="rev-unpaid-total">{fmtMoney(data.total)}</span>
      </h4>
      <table className="rev-table rtable">
        <thead><tr><th>المريض</th><th>الدكتور</th><th>الإجراء</th><th>المبلغ</th><th>منذ</th><th></th></tr></thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id}>
              <td className="rt-title">{l.patient_name}</td>
              <td data-label="الدكتور">{l.doctor_name}</td>
              <td data-label="الإجراء">{l.name}</td>
              <td className="num" data-label="المبلغ">{fmtMoney(l.price)}</td>
              <td data-label="منذ"><span dir="ltr">{fmtDateTime(l.added_at)}</span>
                {l.session_date !== data.today && <span className="pay-badge is-unpaid">من يومٍ سابق</span>}</td>
              <td className="rt-actions" style={{ whiteSpace: 'nowrap' }}>
                {canEdit && removing !== l.id && (
                  <>
                    <button className="pay-btn" disabled={busy === l.id} onClick={() => pay(l)}>تعليم مدفوع</button>{' '}
                    <button className="ghost" style={{ padding: '6px 12px' }} disabled={busy === l.id}
                      onClick={() => { setRemoving(l.id); setReason('') }}>إزالة</button>
                  </>
                )}
                {removing === l.id && (
                  <span className="proc-remove-form">
                    <input value={reason} autoFocus placeholder="سبب الإزالة (إلزامي)" aria-label="سبب الإزالة"
                      onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') remove(l) }} />
                    <button disabled={busy === l.id || !reason.trim()} onClick={() => remove(l)}>تأكيد الإزالة</button>
                    <button className="ghost" onClick={() => setRemoving(null)}>إلغاء</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function History({ lineId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.clinic.procedureHistory(lineId).then(setRows).catch((e) => setErr(e.message)) }, [lineId])
  if (err) return <p className="error">{err}</p>
  if (!rows) return <p className="empty">جارٍ التحميل…</p>
  if (rows.length === 0) return <p className="empty">لا تغييرات منذ الإضافة.</p>
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
            المواد {fmtMoney(h.old_materials)} ← {fmtMoney(h.new_materials)} ·
            الدكتور {fmtMoney(h.old_doctor)} ← {fmtMoney(h.new_doctor)} ·
            الشفاء {fmtMoney(h.old_shifa)} ← {fmtMoney(h.new_shifa)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function EditLine({ line, catalog, onSaved, onCancel, showToast }) {
  const [mats, setMats] = useState(() => line.materials.map((m) => ({ ...m, qty: fmtQty(m.qty) })))
  const legacyStart = Number(line.legacy_materials || 0)
  const [legacy, setLegacy] = useState(String(legacyStart))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const body = { materials: toPayload(mats) }
      if (legacyStart > 0 && Number(legacy || 0) !== legacyStart) body.legacy_materials = legacy || '0'
      const r = await api.clinic.setLineMaterials(line.appointment_id, line.id, body)
      if (r.unchanged) showToast('لا تغيير', 'success', 2500)
      else if (r.warnings && r.warnings.length) showToast(`حُفظ — ⚠ ${r.warnings[0]}`, 'warn', 7000)
      else showToast(`أُعيد الحساب: الدكتور ${fmtMoney(r.doctor_share)} · الشفاء ${fmtMoney(r.shifa_share)}`, 'success', 4000)
      onSaved()
    } catch (ex) { showToast(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="rev-edit">
      <MaterialsEditor catalog={catalog} value={mats} onChange={setMats} disabled={busy} />
      {/* مواد إجمالية من التصميم السابق (بلا أصناف) — تُعدَّل أو تُصفَّر هنا وحدها */}
      {legacyStart > 0 && (
        <label className="rev-legacy">مواد سابقة (إجمالي، من التسوية القديمة):
          <input value={legacy} inputMode="decimal" style={{ width: 120 }}
            onChange={(e) => setLegacy(toLatinDigits(e.target.value))} />
        </label>
      )}
      <div className="mat-actions">
        <button disabled={busy || !qtyValid(mats)} onClick={save}>حفظ وإعادة الحساب</button>
        <button className="ghost" disabled={busy} onClick={onCancel}>إلغاء</button>
      </div>
    </div>
  )
}

export default function ProcedureReview({ canEdit, showToast }) {
  const [from, setFrom] = useState(() => todayLocal())
  const [to, setTo] = useState(() => todayLocal())
  const [doctorId, setDoctorId] = useState('')
  const [flag, setFlag] = useState('')
  const [doctors, setDoctors] = useState([])
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({})        // lineId → 'edit' | 'history'
  const [catalog, setCatalog] = useState(null)
  const [exporting, setExporting] = useState(false)

  const load = () => api.clinic.procedureReview({ from, to, doctorId, flag })
    .then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { setData(null); load() }, [from, to, doctorId, flag])
  useEffect(() => { api.clinic.doctors().then(setDoctors).catch(() => {}) }, [])
  useEffect(() => {
    if (canEdit) api.clinic.materials().then((r) => setCatalog(r.filter((m) => m.is_active))).catch(() => {})
  }, [canEdit])

  const toggle = (id, what) => setOpen((o) => ({ ...o, [id]: o[id] === what ? null : what }))
  const doExport = async () => {
    setExporting(true)
    try { const name = await api.clinic.exportProcedures({ from, to, doctorId }); showToast(`نُزّل ${name}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) }
    finally { setExporting(false) }
  }

  const counts = data?.counts || {}
  const t = data?.totals
  return (
    <div className="card">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <h3 style={{ margin: 0 }}>مراجعة الإجراءات وحصصها</h3>
        <button type="button" className="ghost" disabled={exporting || !data || counts.lines === 0}
          onClick={doExport} style={{ padding: '6px 14px' }}>
          {exporting ? 'جارٍ التصدير…' : 'إكسل لكل دكتور'}
        </button>
      </div>

      <UnpaidAcrossDays canEdit={canEdit} showToast={showToast} onChanged={load} />

      <div className="inline rev-filters">
        <div className="field"><label>من</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></div>
        <div className="field"><label>إلى</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><label>الدكتور</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">كل الدكاترة</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
      </div>

      {/* العدّادان ظاهران دائماً: ما يحتاج انتباهاً لا يختبئ خلف مرشِّح */}
      <div className="inline rev-flags">
        {FLAGS.map((f) => {
          const n = f.key === 'negative' ? counts.negative : f.key === 'no_rule' ? counts.no_rule
            : f.key === 'unpaid' ? counts.unpaid : counts.lines
          return (
            <button key={f.key} type="button" aria-pressed={flag === f.key}
              className={`rev-flag ${f.cls || ''}${flag === f.key ? ' is-on' : ''}`}
              onClick={() => setFlag(f.key)}>
              {f.label} <span className="rev-flag-n">{n ?? '…'}</span>
            </button>
          )
        })}
      </div>

      {t && counts.lines > 0 && (
        <div className="rev-totals">
          <span>الأسعار <strong>{fmtMoney(t.price)}</strong></span>
          <span>المواد <strong>{fmtMoney(t.materials)}</strong></span>
          <span>حصص الدكاترة <strong>{fmtMoney(t.doctor)}</strong></span>
          <span>حصّة الشفاء <strong className={t.shifa < 0 ? 'neg' : undefined}>{fmtMoney(t.shifa)}</strong></span>
        </div>
      )}

      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.lines.length === 0 ? (
          <p className="empty">{flag ? 'لا أسطر تحتاج انتباهاً بهذا المرشِّح.' : 'لا إجراءات في هذا المدى.'}</p>
        ) : (
          <table className="rev-table">
            <thead>
              <tr><th>التاريخ</th><th>المريض</th><th>الدكتور</th><th>الإجراء</th><th>السعر</th>
                <th>المواد</th><th>القاعدة</th><th>الدكتور</th><th>الشفاء</th><th></th></tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <Fragment key={l.id}>
                  <tr className={l.negative_shifa ? 'rev-neg' : l.no_rule ? 'rev-norule' : undefined}>
                    <td dir="ltr" style={{ whiteSpace: 'nowrap' }}>{l.session_date}</td>
                    <td>{l.patient_name} <span className="muted">{l.flow_mode === 'attendance'
                      // نمط الحضور: رقم الدور (عند الحضور) ثم رقم الحجز
                      ? `${l.arrival_number != null ? `#${l.arrival_number} · ` : ''}حجز ${l.queue_number}`
                      : `#${l.queue_number}`}</span></td>
                    <td>{l.doctor_name}</td>
                    <td>{l.name_snapshot}
                      {l.unpaid && <span className="pay-badge is-unpaid">غير مدفوع</span>}</td>
                    <td className="num">{fmtMoney(l.price_snapshot)}</td>
                    <td className="rev-mats">
                      <strong>{fmtMoney(l.materials_cost)}</strong>
                      <span className="rev-mats-list">
                        {l.materials.length ? materialsSummary(l.materials) : (Number(l.legacy_materials) ? '' : 'بلا مواد')}
                        {Number(l.legacy_materials) > 0 && `${l.materials.length ? '، ' : ''}مواد سابقة ${fmtMoney(l.legacy_materials)}`}
                      </span>
                    </td>
                    <td className="rev-rule">
                      {l.rule_label}
                      {l.no_rule && (l.doctor_has_rule_now
                        ? <span className="rev-note">ضُبطت قاعدةٌ للدكتور لاحقاً — هذا السطر يبقى كما سُجّل</span>
                        : <Link className="rev-note" to={`/clinic/doctors/${l.doctor_id}`}>اضبط قاعدة الدكتور ←</Link>)}
                    </td>
                    <td className="num">{fmtMoney(l.doctor_share)}</td>
                    <td className={`num${l.negative_shifa ? ' neg' : ''}`}>
                      {fmtMoney(l.shifa_share)}{l.negative_shifa && ' ⚠'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <button className="ghost" style={{ padding: '2px 10px', fontSize: 11.5 }}
                          onClick={() => toggle(l.id, 'edit')}>المواد</button>
                      )}{' '}
                      <button className="ghost" style={{ padding: '2px 10px', fontSize: 11.5 }}
                        onClick={() => toggle(l.id, 'history')}>
                        الأثر{l.changes_count ? ` (${l.changes_count})` : ''}
                      </button>
                    </td>
                  </tr>
                  {open[l.id] && (
                    <tr className="rev-detail">
                      <td colSpan={10}>
                        {open[l.id] === 'edit'
                          ? <EditLine line={l} catalog={catalog} showToast={showToast}
                              onCancel={() => toggle(l.id, 'edit')}
                              onSaved={() => { setOpen((o) => ({ ...o, [l.id]: null })); load() }} />
                          : <History lineId={l.id} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}
