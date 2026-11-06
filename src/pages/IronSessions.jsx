import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { useDialogs } from '../dialogs.jsx'
import { canCancelIron, canCollectIron, canSeeIronSplit, canWriteIronSettings } from '../permissions.js'
import IronSessionDialog, { printIronReceipt } from '../components/IronSessionDialog.jsx'
import { usePeriod, PeriodPicker, useLoad } from './ClinicFunds.jsx'

// ═══ جلسات الحديد ═══
// خدمةٌ مباشرة تُقبض لحظة تسجيلها: بلا دور ولا عيادة ولا حجز. ثلاثة تبويبات:
//   السجلّ      الجلسات لفترة — للاستقبال بلا توزيع (لا يصله من الخادم أصلاً)، وللمشرفة والاطّلاع معه
//   المستحقات   الممرضات والدكاترة، وما ذهب للشفاء وللصندوق
//   الإعدادات   الأسعار الخمسة ومادة الدواء وقائمة الممرضات — تكتبها المشرفة وحدها
// الحساب كلّه في الخادم (iron-sessions.js)، وكلّ جلسةٍ لقطتها: تغيير سعرٍ لا يمسّ القديم.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
const sessionsText = (n) => `${fmtNum(n)} ${n === 1 ? 'جلسة' : 'جلسات'}`

// فواصل خطّية لا «·»: الصفر العربي نقطةٌ هو الآخر فيلتبس بها
function SplitChips({ s }) {
  const parts = [['الدواء', s.drug], ['الممرضة', s.nurse], ['الدكتور', s.doctor], ['الشفاء', s.shifa], ['الفاضل', s.surplus]]
  return (
    <span className="iron-split">
      {parts.filter(([, v]) => v > 0).map(([k, v]) => <span key={k}>{k} <bdi>{fmtNum(v)}</bdi></span>)}
    </span>
  )
}

// ═══════ السجلّ ═══════
function LogTab({ split, canPrint, canCancel, reload, showToast }) {
  const p = usePeriod('today')
  const dialogs = useDialogs()
  const [cancelled, setCancelled] = useState(0)
  const [data, err] = useLoad(() => api.clinic.ironSessions(p.query), p.key, reload + cancelled)
  const cancel = async (r) => {
    const reason = await dialogs.prompt({
      title: `إلغاء جلسة ${r.patient}`,
      body: `تُعكس حركات الصندوق${r.withDrug ? ' وترجع الأمبولة للمخزون' : ''}، وتنزل المستحقات وحصّة الشفاء. الإلغاء لا رجعة عنه، والجلسة تبقى في السجلّ معلَّمة.`,
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
              <div className="hint">مع دوا: {fmtNum(data.totals.withDrug)}{data.totals.cancelled > 0 && ` — ملغاة خارج المجموع: ${fmtNum(data.totals.cancelled)}`}</div></div>
            <div className="tile earn-hero"><div className="label">مجموع المقبوض</div><div className="value"><Money value={data.totals.price} /></div></div>
            {split && (
              <div className="tile"><div className="label">حصّة الشفاء</div><div className="value"><Money value={data.totals.split.shifa} /></div></div>
            )}
          </div>
          <table className="rtable earn-table iron-table">
            <thead>
              <tr><th>الوقت</th><th>المريض</th><th>الممرضة</th><th>الدكتور</th><th>النوع</th><th>المبلغ</th><th>القابضة</th>
                {split && <th>التوزيع</th>}{(canPrint || canCancel) && <th />}</tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.cancelled ? 'iron-cancelled' : undefined}>
                  <td className="rt-badge earn-when" dir="ltr">{multiDay && <span className="earn-date">{r.date}</span>}<span>{r.time}</span></td>
                  <td className="rt-title">
                    {r.patient}
                    {r.cancelled && <span className="badge bad sm iron-cancel-badge">ملغاة</span>}
                    {r.cancelled && (
                      <span className="iron-cancel-note">{r.cancelled.reason} — {r.cancelled.by} — {fmtDateTime(r.cancelled.at)}</span>
                    )}
                  </td>
                  <td data-label="الممرضة">{r.nurse}</td>
                  <td data-label="الدكتور">{r.doctor || <span className="muted">بلا دكتور</span>}</td>
                  <td data-label="النوع">{r.withDrug ? 'مع دوا' : 'بلا دوا'}</td>
                  <td className="num earn-doc" data-label="المبلغ">{fmtNum(r.price)}</td>
                  <td data-label="القابضة">{r.by}</td>
                  {split && <td className="rt-full" data-label="التوزيع"><SplitChips s={r.split} /></td>}
                  {(canPrint || canCancel) && (
                    <td className="rt-actions">
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
            <div className="tile"><div className="label">لصندوق العيادات</div><div className="value"><Money value={t.drug + t.surplus} /></div>
              <div className="hint">استرداد الدواء {fmtNum(t.drug)} والفاضل {fmtNum(t.surplus)}</div></div>
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
  ['shifa_share', 'حصّة الشفاء (ثابتة)'],
]
const HISTORY_LABELS = { ...Object.fromEntries(FIELDS), drug_material: 'مادة الدواء' }
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
    setForm({ ...Object.fromEntries(FIELDS.map(([k]) => [k, String(d.settings[k])])), drug_material_id: d.settings.drug_material_id || '' })
  }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err && !data) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>

  const dirty = FIELDS.some(([k]) => form[k] !== String(data.settings[k])) || form.drug_material_id !== (data.settings.drug_material_id || '')
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.clinic.setIronSettings({ ...form, drug_material_id: form.drug_material_id || null })
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
        <div className="earn-head"><h3>الأسعار ومادة الدواء</h3></div>
        {data.drug_problem && <p className="share-warn" role="alert">⚠ {data.drug_problem}</p>}
        <form onSubmit={save}>
          <div className="iron-settings-grid">
            {FIELDS.map(([k, label]) => (
              <div className="field" key={k}>
                <label htmlFor={`iron-${k}`}>{label}</label>
                <input id={`iron-${k}`} value={form[k]} inputMode="decimal" disabled={!canWrite}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
            <div className="field">
              <label htmlFor="iron-drug">مادة دواء الحديد</label>
              <select id="iron-drug" value={form.drug_material_id} disabled={!canWrite}
                onChange={(e) => setForm((f) => ({ ...f, drug_material_id: e.target.value }))}>
                <option value="">— لم تُربط —</option>
                {/* مادةٌ رُبطت ثمّ عُطّلت لا تظهر في المعدودة المفعَّلة: تبقى في القائمة فلا يبدو الربط ممحوّاً */}
                {data.drug && !data.materials.some((m) => m.id === data.drug.id) && <option value={data.drug.id}>{data.drug.name}</option>}
                {data.materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.purchase_price === null ? 'بلا سعر شراء' : `شراء ${fmtNum(m.purchase_price)}`})</option>
                ))}
              </select>
              <small className="hint">المواد المعدودة المفعَّلة — تُضاف من <Link to="/inventory">المخزون</Link>، وقيمتها في الجلسة سعر شرائها.</small>
            </div>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          {canWrite && <button type="submit" disabled={!dirty || busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>}
        </form>
      </div>

      <div className="card earn-card">
        <div className="earn-head"><h3>معاينة التوزيع بالأسعار المحفوظة</h3></div>
        <table className="rtable earn-table">
          <thead><tr><th>الحالة</th><th>السعر</th><th>الدواء</th><th>الممرضة</th><th>الدكتور</th><th>الشفاء</th><th>الفاضل للصندوق</th></tr></thead>
          <tbody>
            {data.preview.map((s) => (
              <tr key={scenarioText(s)} className={s.negative ? 'earn-neg' : undefined}>
                <td className="rt-title">{scenarioText(s)}</td>
                <td className="num" data-label="السعر">{fmtNum(s.price)}</td>
                <td className="num" data-label="الدواء">{fmtNum(s.drug)}</td>
                <td className="num" data-label="الممرضة">{fmtNum(s.nurse)}</td>
                <td className="num" data-label="الدكتور">{fmtNum(s.doctor)}</td>
                <td className="num" data-label="الشفاء">{fmtNum(s.shifa)}</td>
                <td className={`num${s.negative ? ' neg' : ''}`} data-label="الفاضل">
                  {s.negative ? `سالب ${fmtNum(Math.abs(s.surplus))} ⚠` : fmtNum(s.surplus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.preview.some((s) => s.negative) && (
          <p className="share-warn" role="alert">⚠ الحالة المعلَّمة تُرفض عند التسجيل حتى تُحدَّث الأسعار: مجموع الكلفة والحصص أكبر من سعر الجلسة.</p>
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
      {adding && <IronSessionDialog onClose={() => setAdding(false)} onSaved={() => setReload((n) => n + 1)} />}
    </>
  )
}
