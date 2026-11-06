import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime } from '../api.js'
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

// ═══ جلسات الحديد ═══
// خدمةٌ مباشرة تُقبض لحظة تسجيلها: بلا دور ولا عيادة ولا حجز. ثلاثة تبويبات:
//   السجلّ      الجلسات لفترة — للاستقبال بلا توزيع (لا يصله من الخادم أصلاً)، وللمشرفة والاطّلاع معه
//   المستحقات   الممرضات والدكاترة، وما ذهب للشفاء وللصندوق
//   الإعدادات   الأسعار والحصص وسقف الشفاء وقائمة الممرضات — تكتبها المشرفة وحدها
// الحساب كلّه في الخادم (iron-sessions.js)، وكلّ جلسةٍ لقطتها: تغيير سعرٍ لا يمسّ القديم.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
const sessionsText = (n) => `${fmtNum(n)} ${n === 1 ? 'جلسة' : 'جلسات'}`

// فواصل خطّية لا «·»: الصفر العربي نقطةٌ هو الآخر فيلتبس بها
function SplitChips({ s }) {
  const parts = [['المواد', s.materials], ['الممرضة', s.nurse], ['الدكتور', s.doctor], ['الشفاء', s.shifa], ['الفاضل', s.surplus]]
  return (
    <span className="iron-split">
      {parts.filter(([, v]) => v > 0).map(([k, v]) => <span key={k}>{k} <bdi>{fmtNum(v)}</bdi></span>)}
    </span>
  )
}

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

// ═══════ تفاصيل جلسة: لمن يرى التوزيع وحده ═══════
// كلّ رقمٍ من لقطة الجلسة (iron_session_materials وأعمدة iron_sessions) لا من أسعار المخزون الحالية.
// «مؤكَّدة»: الخادم يحفظ العلَم وحده، ومؤكِّدته هي من أرسل طلب التسجيل نفسه: القابضة.
const EDIT_STAGE = { register: 'عند التسجيل', review: 'بعد التسجيل' }
function EditChanges({ e }) {
  return (
    <>
      {e.old_doctor !== e.new_doctor && <>الدكتور <bdi>{fmtNum(e.old_doctor)}</bdi> ← <bdi>{fmtNum(e.new_doctor)}</bdi> </>}
      {e.old_nurse !== e.new_nurse && <>الممرضة <bdi>{fmtNum(e.old_nurse)}</bdi> ← <bdi>{fmtNum(e.new_nurse)}</bdi> </>}
    </>
  )
}

function SessionDetailsDialog({ row: r, canEdit, onEdit, onClose }) {
  const itemsTotal = r.materials.reduce((t, m) => t + m.cost, 0)
  const s = r.split
  const hasFlags = r.lowMaterialsConfirmed || r.overPrice || r.edits.length > 0 || r.cancelled
  return (
    <Modal title={`تفاصيل جلسة ${r.patient}`} onClose={onClose} wide sheet>
      <div className="iron-details">
        <dl className="iron-facts">
          <div><dt>التاريخ</dt><dd><bdi dir="ltr">{r.date} {r.time}</bdi></dd></div>
          <div><dt>النوع</dt><dd>{r.withDrug ? 'مع دوا' : 'بلا دوا'}</dd></div>
          <div><dt>الممرضة</dt><dd>{r.nurse}</dd></div>
          <div><dt>الدكتور</dt><dd>{r.doctor || 'بلا دكتور'}</dd></div>
          <div><dt>القابضة</dt><dd>{r.by}</dd></div>
          <div className="iron-facts-price"><dt>المبلغ المقبوض</dt><dd><Money value={r.price} /></dd></div>
        </dl>

        <section aria-label="المواد">
          <h4 className="iron-details-head">المواد</h4>
          {r.materials.length === 0 ? <p className="empty">لا مواد في هذه الجلسة.</p> : (
            <>
              <table className="iron-mat-table">
                <thead><tr><th>المادة</th><th className="num">الكمية</th><th className="num">سعر الوحدة</th><th className="num">الإجمالي</th></tr></thead>
                <tbody>
                  {r.materials.map((m) => (
                    <tr key={m.material_id}>
                      <td>{m.name}</td>
                      <td className="num">{fmtNum(m.qty)} <small>{m.unit}</small></td>
                      <td className="num">{fmtNum(m.unit_price)}</td>
                      <td className="num">{fmtNum(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>مجموع المواد</td><td className="num">{fmtNum(itemsTotal)}</td></tr></tfoot>
              </table>
              <p className="earn-note">بأسعار لحظة التسجيل: تغيير سعر المادة في المخزون لا يمسّها.</p>
            </>
          )}
        </section>

        <section aria-label="التوزيع">
          <h4 className="iron-details-head">التوزيع</h4>
          <div className="iron-dist">
            {[['المواد', s.materials], ['الدكتور', s.doctor], ['الممرضة', s.nurse], ['الشفاء', s.shifa], ['الفاضل للصندوق', s.surplus]].map(([k, v]) => (
              <div key={k} className="iron-dist-cell"><span>{k}</span><strong><Money value={v} /></strong></div>
            ))}
          </div>
          <p className="earn-note">يذهب لصندوق العيادات: <bdi>{fmtNum(fundOf(s))}</bdi> ل.س (المواد والفاضل).{r.shifaCap !== null && <> سقف الشفاء لهذه الجلسة <bdi>{fmtNum(r.shifaCap)}</bdi>.</>}</p>
          {r.version !== 2 && <p className="earn-note">جلسة قبل نظام السقف: أرقامها مجمّدة ولا تُعدَّل.</p>}
        </section>

        <section aria-label="العلامات">
          <h4 className="iron-details-head">العلامات</h4>
          {!hasFlags ? <p className="empty">لا علامات على هذه الجلسة.</p> : (
            <ul className="iron-flags">
              {r.cancelled && <li><span className="badge bad sm">ملغاة</span> <span>{r.cancelled.reason} — {r.cancelled.by} — {fmtDateTime(r.cancelled.at)}</span></li>}
              {r.lowMaterialsConfirmed && <li><span className="badge warn sm">جلسة مؤكَّدة</span> <span>مع دوا بمواد قليلة — أكّدتها {r.by} عند التسجيل</span></li>}
              {r.overPrice && <li><span className="badge bad sm">المواد فوق السعر</span> <span>سُقّفت من <bdi>{fmtNum(itemsTotal)}</bdi> إلى <bdi>{fmtNum(s.materials)}</bdi> والشفاء صفر</span></li>}
              {r.edits.map((e, i) => (
                <li key={i}><span className="badge blue sm">حصّة معدَّلة</span>{' '}
                  <span>{EDIT_STAGE[e.stage] || ''}: <EditChanges e={e} />— السبب: {e.reason} — {e.by} — {fmtDateTime(e.at)}</span></li>
              ))}
            </ul>
          )}
        </section>

        <div className="inline iron-actions">
          {canEdit && <button type="button" className="iron-details-edit" onClick={onEdit}>تعديل الحصص</button>}
          <button type="button" className="ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </Modal>
  )
}

// ═══════ السجلّ ═══════
function LogTab({ split, canPrint, canCancel, reload, showToast }) {
  const p = usePeriod('today')
  const dialogs = useDialogs()
  const [cancelled, setCancelled] = useState(0)
  const [editing, setEditing] = useState(null)
  const [detailId, setDetailId] = useState(null)    // من السطر الحيّ: يتحدّث بعد تعديل الحصّة
  const [data, err] = useLoad(() => api.clinic.ironSessions(p.query), p.key, reload + cancelled)
  const cancel = async (r) => {
    const reason = await dialogs.prompt({
      title: `إلغاء جلسة ${r.patient}`,
      body: `تُعكس حركات الصندوق${r.materials.length > 0 ? ' وترجع كلّ المواد للمخزون بكمّياتها' : ''}، وتنزل المستحقات وحصّة الشفاء. الإلغاء لا رجعة عنه، والجلسة تبقى في السجلّ معلَّمة.`,
      placeholder: 'سبب الإلغاء', confirmLabel: 'إلغاء الجلسة', cancelLabel: 'رجوع', required: true, danger: true,
    })
    if (reason == null) return
    try {
      await api.clinic.cancelIronSession(r.id, reason)
      showToast('أُلغيت الجلسة وعُكست حركاتها', 'success', 3500)
      setCancelled((n) => n + 1)
    } catch (ex) { showToast(ex.message) }
  }
  const multiDay = data && data.from !== data.to
  const detail = detailId && data?.rows.find((r) => r.id === detailId)
  const print = async (r) => {
    const out = await printIronReceipt(r, 1)
    if (!out.ok) showToast(`تعذّرت الطباعة${out.reason ? ` (${out.reason})` : ''}`)
  }
  return (
    <div className="card earn-card">
      <div className="earn-head"><h3>سجلّ الجلسات</h3></div>
      <PeriodPicker p={p} data={data} />
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <p className="empty">لا جلسات حديد في هذه الفترة.</p> : (
        <>
          <div className="tiles earn-tiles">
            <div className="tile"><div className="label">عدد الجلسات</div><div className="value">{fmtNum(data.totals.count)}</div>
              <div className="hint">مع دوا: {fmtNum(data.totals.withDrug)}{data.totals.cancelled > 0 && ` — ملغاة خارج المجموع: ${fmtNum(data.totals.cancelled)}`}</div>
              {data.totals.overPrice > 0 && <div className="hint iron-over-count">المواد فوق السعر: {fmtNum(data.totals.overPrice)}</div>}</div>
            <div className="tile earn-hero"><div className="label">مجموع المقبوض</div><div className="value"><Money value={data.totals.price} /></div></div>
            {split && (
              <div className="tile"><div className="label">حصّة الشفاء</div><div className="value"><Money value={data.totals.split.shifa} /></div></div>
            )}
          </div>
          <table className="rtable earn-table iron-table">
            <thead>
              <tr><th>الوقت</th><th>المريض</th><th>الممرضة</th><th>الدكتور</th><th>النوع</th><th>المواد</th><th>المبلغ</th><th>القابضة</th>
                {split && <th>التوزيع</th>}{(canPrint || canCancel || split) && <th />}</tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.cancelled ? 'iron-cancelled' : undefined}>
                  <td className="rt-badge earn-when" dir="ltr">{multiDay && <span className="earn-date">{r.date}</span>}<span>{r.time}</span></td>
                  <td className="rt-title">
                    {r.patient}
                    {r.cancelled && <span className="badge bad sm iron-cancel-badge">ملغاة</span>}
                    {r.overPrice && <span className="badge bad sm iron-cancel-badge iron-over-badge">المواد فوق السعر</span>}
                    {r.lowMaterialsConfirmed && <span className="badge sm iron-cancel-badge iron-low-badge">مع دوا بمواد قليلة — مؤكَّدة</span>}
                    {r.edits?.length > 0 && <span className="badge blue sm iron-cancel-badge iron-edited-badge">حصّة معدَّلة</span>}
                    {r.cancelled && (
                      <span className="iron-cancel-note">{r.cancelled.reason} — {r.cancelled.by} — {fmtDateTime(r.cancelled.at)}</span>
                    )}
                  </td>
                  <td data-label="الممرضة">{r.nurse}</td>
                  <td data-label="الدكتور">{r.doctor || <span className="muted">بلا دكتور</span>}</td>
                  <td data-label="النوع">{r.withDrug ? 'مع دوا' : 'بلا دوا'}</td>
                  <td className="iron-mats" data-label="المواد">{r.materials.length ? materialsSummary(r.materials) : <span className="muted">—</span>}</td>
                  <td className="num earn-doc" data-label="المبلغ">{fmtNum(r.price)}</td>
                  <td data-label="القابضة">{r.by}</td>
                  {split && <td className="rt-full" data-label="التوزيع"><SplitChips s={r.split} /></td>}
                  {(canPrint || canCancel || split) && (
                    <td className="rt-actions">
                      {split && <button type="button" className="ghost iron-details-btn" onClick={() => setDetailId(r.id)}>التفاصيل</button>}
                      {!r.cancelled && canPrint && <button type="button" className="ghost iron-print" onClick={() => print(r)}>🖨 إيصال</button>}
                      {!r.cancelled && canCancel && <button type="button" className="ghost iron-print iron-cancel-btn" onClick={() => cancel(r)}>إلغاء</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {/* نافذةٌ واحدة في كلّ لحظة: التعديل يفتح من التفاصيل، والرجوع منه إليها */}
      {editing ? <EditSharesDialog row={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); showToast('عُدّلت الحصّة وأُعيد الحساب', 'success', 3500); setCancelled((n) => n + 1) }} />
        : detail && <SessionDetailsDialog row={detail} canEdit={canCancel && !detail.cancelled && detail.version === 2} onEdit={() => setEditing(detail)} onClose={() => setDetailId(null)} />}
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
          <td data-label="التاريخ"><bdi dir="ltr">{l.date} {l.time}</bdi> — {l.withDrug ? 'مع دوا' : 'بلا دوا'}</td>
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
            <div className="tile"><div className="label">المقبوض ({sessionsText(data.totals.count)})</div><div className="value"><Money value={data.totals.price} /></div></div>
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
            note={<>تظهر أيضاً مميَّزةً في <Link to="/clinic/procedures?tab=earnings">الإجراءات والمستحقات</Link> مع حصصهم من الإجراءات.</>} />
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
const scenarioText = (s) => `${s.with_drug ? 'مع دوا' : 'بلا دوا'} ${s.with_doctor ? '+ دكتور' : '— بلا دكتور'}`

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
      const head = `سُجّلت جلسة ${s.patient} وقُبض ${fmtNum(s.price)} ل.س`
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
