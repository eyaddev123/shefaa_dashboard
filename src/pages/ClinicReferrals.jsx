import { useEffect, useState } from 'react'
import { useDialogs } from '../dialogs.jsx'
import { api, fmtMoney, todayLocal } from '../api.js'
import { useToast } from '../action-feedback.jsx'

// ═══ العيادات — الإحالات ═══
// لمشرف العيادات وحده (الخادم يردّ غيره 403). تبويبان:
//   الجهات     : اسمٌ وفعّالة/موقوفة — بلا نسب: النسبة من ورقة الإحالة نفسها.
//   المستحقات  : ما خُصم للمرضى على كل جهة في مدى — وملفّ إكسل للتحاسب معها.
// الموقوفة لا تظهر للاستقبال، وإحالاتها القديمة باقية في التقرير. ولا حذف لجهةٍ عليها إحالات.

const TABS = [
  { key: 'sources', label: 'الجهات' },
  { key: 'dues', label: 'المستحقات' },
]
const monthStart = () => `${todayLocal().slice(0, 8)}01`

function NewSourceForm({ onCreated }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const s = await api.clinic.addReferralSource({ name })
      setName(''); onCreated(s.name)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <form className="ref-source-form" onSubmit={submit}>
      <div className="field"><label htmlFor="new-ref-source">اسم الجهة</label>
        <input id="new-ref-source" value={name} maxLength={150} required
          placeholder="مثال: جمعية الشفاء — المساعدات" onChange={(e) => setName(e.target.value)} /></div>
      <button type="submit" className="proc-form-btn" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة'}</button>
      {err && <p className="error proc-form-err">{err}</p>}
    </form>
  )
}

function SourcesTab({ showToast, onOpenDues }) {
  const dlg = useDialogs()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)   // { id, name }
  const load = () => api.clinic.referralSources().then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const toggle = async (s) => {
    if (s.is_active) {
      const ok = await dlg.confirm({
        title: 'إيقاف الجهة',
        body: `إيقاف «${s.name}»؟\nلا تظهر بعدها للاستقبال، وإحالاتها السابقة تبقى في التقارير كما هي.`,
        confirmLabel: 'إيقاف', danger: true,
      })
      if (!ok) return
    }
    try {
      await api.clinic.updateReferralSource(s.id, { is_active: !s.is_active })
      showToast(s.is_active ? `أُوقفت «${s.name}»` : `فُعّلت «${s.name}»`, 'success', 3000); load()
    } catch (ex) { showToast(ex.message) }
  }
  const rename = async () => {
    try {
      await api.clinic.updateReferralSource(editing.id, { name: editing.name })
      setEditing(null); showToast('حُفظ الاسم', 'success', 3000); load()
    } catch (ex) { showToast(ex.message) }
  }
  const remove = async (s) => {
    const ok = await dlg.confirm({ title: 'حذف الجهة', body: `حذف «${s.name}» نهائياً؟ (لا إحالات عليها)`,
      confirmLabel: 'حذف', danger: true })
    if (!ok) return
    try { await api.clinic.deleteReferralSource(s.id); showToast(`حُذفت «${s.name}»`, 'success', 3000); load() }
    catch (ex) { showToast(ex.message) }
  }

  if (err && !data) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>
  const list = data.sources
  return (
    <div className="card">
      <h3>الجهات المحيلة ({list.length} — الفعّالة {list.filter((s) => s.is_active).length})</h3>
      <NewSourceForm onCreated={(n) => { showToast(`أُضيفت «${n}»`, 'success', 3000); load() }} />
      <table className="rtable" style={{ marginTop: 14 }}>
        <thead>
          <tr><th>الجهة</th><th>الحالة</th><th>إحالات هذا الشهر</th><th>مستحق هذا الشهر</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className={s.is_active ? undefined : 'proc-inactive'}>
              <td className="rt-title">
                {editing?.id === s.id ? (
                  <div className="inline" style={{ gap: 6 }}>
                    <input value={editing.name} maxLength={150} aria-label="اسم الجهة" autoFocus
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <button onClick={rename} style={{ padding: '4px 12px', fontSize: 12 }}>حفظ</button>
                    <button className="ghost" onClick={() => setEditing(null)} style={{ padding: '4px 12px', fontSize: 12 }}>إلغاء</button>
                  </div>
                ) : s.name}
              </td>
              <td className="rt-badge">{s.is_active ? <span className="badge good">فعّالة</span> : <span className="badge">موقوفة</span>}</td>
              <td className="num" data-label="إحالات هذا الشهر">{s.month_referrals.toLocaleString('en-US')}</td>
              <td className="num" data-label="مستحق هذا الشهر">
                {s.month_due > 0
                  ? <button className="link-btn" onClick={() => onOpenDues(s.id)}>{fmtMoney(s.month_due)}</button>
                  : fmtMoney(0)}
              </td>
              <td className="proc-actions-cell rt-actions">
                {editing?.id !== s.id && (
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    onClick={() => setEditing({ id: s.id, name: s.name })}>تعديل</button>
                )}{' '}
                <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                  onClick={() => toggle(s)}>{s.is_active ? 'إيقاف' : 'تفعيل'}</button>{' '}
                {s.total_referrals === 0 && (
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    onClick={() => remove(s)}>حذف</button>
                )}
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={5} className="empty">لا جهات بعد — أضف أولاها أعلاه</td></tr>}
        </tbody>
      </table>
      <p className="subtitle" style={{ marginTop: 10, marginBottom: 0 }}>
        «هذا الشهر» من {data.month_start} حتى اليوم، ويُعدّ من حضر وحده (كجرد الصندوق).
      </p>
    </div>
  )
}

function DuesTab({ showToast, initialSource }) {
  const [sources, setSources] = useState([])
  const [sourceId, setSourceId] = useState(initialSource ? String(initialSource) : '')
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => todayLocal())
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [exporting, setExporting] = useState(false)
  useEffect(() => { api.clinic.referralSources().then((d) => setSources(d.sources)).catch(() => {}) }, [])
  useEffect(() => {
    setData(null)
    api.clinic.referralReport({ from, to, sourceId }).then((d) => { setData(d); setErr(null) })
      .catch((e) => setErr(e.message))
  }, [from, to, sourceId])

  const doExport = async () => {
    setExporting(true)
    try { const name = await api.clinic.exportReferralReport({ from, to, sourceId }); showToast(`نُزّل ${name}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) } finally { setExporting(false) }
  }
  const all = !sourceId
  const sourceName = sources.find((s) => String(s.id) === sourceId)?.name

  return (
    <div className="card">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <h3 style={{ margin: 0 }}>المستحقات على الجهات</h3>
        <button type="button" className="ghost" disabled={exporting || !data || data.lines.length === 0}
          onClick={doExport} style={{ padding: '6px 14px' }}>{exporting ? 'جارٍ التصدير…' : 'إكسل'}</button>
      </div>
      <div className="inline rev-filters">
        <div className="field"><label>الجهة</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">كل الجهات</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (موقوفة)'}</option>)}
          </select></div>
        <div className="field"><label>من</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></div>
        <div className="field"><label>إلى</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.lines.length === 0 ? <p className="empty">لا إحالات في هذا المدى.</p>
        : (
          <>
            <div className="ref-due-total">
              <span>مجموع المستحق على {sourceName || 'كل الجهات'}</span>
              <strong>{fmtMoney(data.total_due)}</strong>
              <span className="muted">{data.visits.toLocaleString('en-US')} زيارة · {from} — {to}</span>
            </div>
            {all && data.totals.length > 1 && (
              <table className="ref-totals rtable">
                <thead><tr><th>الجهة</th><th>الزيارات</th><th>المستحق</th></tr></thead>
                <tbody>
                  {data.totals.map((t) => (
                    <tr key={t.source_id}>
                      <td className="rt-title"><button className="link-btn" onClick={() => setSourceId(String(t.source_id))}>{t.source}</button></td>
                      <td className="num" data-label="الزيارات">{t.visits.toLocaleString('en-US')}</td>
                      <td className="num" data-label="المستحق">{fmtMoney(t.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <table className="ref-dues rtable">
              <thead>
                <tr>
                  <th>التاريخ</th>{all && <th>الجهة</th>}<th>المريض</th><th>الدكتور</th><th>كشف/إجراء</th>
                  <th>المبلغ الأصلي</th><th>الخصم</th><th>رقم ورقة الإحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={`${l.appointment_id}-${i}`}>
                    <td dir="ltr" className="num rt-badge">{l.date}</td>
                    {all && <td data-label="الجهة">{l.source}</td>}
                    <td className="rt-title">{l.patient}</td>
                    <td data-label="الدكتور">{l.doctor || '—'}</td>
                    <td data-label="كشف/إجراء">{l.item} <span className="muted ref-doc-pct">{l.discount_type === 'percent'
                      ? `${l.discount_value.toLocaleString('ar-SY')}٪` : `${fmtMoney(l.discount_value)} ثابت`}</span></td>
                    <td className="num" data-label="المبلغ الأصلي">{fmtMoney(l.original)}</td>
                    <td className="num" data-label="الخصم"><strong>{fmtMoney(l.discount)}</strong></td>
                    <td dir="auto" data-label="رقم ورقة الإحالة">{l.doc_number || '—'}</td>
                  </tr>
                ))}
                <tr className="rev-total-row">
                  <td colSpan={all ? 6 : 5} className="rt-title">المجموع</td>
                  <td className="num rt-badge">{fmtMoney(data.total_due)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </>
        )}
    </div>
  )
}

export default function ClinicReferrals() {
  const [tab, setTab] = useState('sources')
  const [duesSource, setDuesSource] = useState(null)
  const [toast, showToast] = useToast()
  return (
    <>
      <h2>العيادات — الإحالات</h2>
      <p className="subtitle">
        مريضٌ بورقة إحالة: الاستقبال يختار الجهة ويُدخل الخصم من الورقة، فيدفع المريض الباقي.
        حصّة الدكتور وحصّة الشفاء تُحسبان من <strong>السعر الأصلي</strong> كما هما، والخصم مستحقٌّ على الجهة.
      </p>
      {toast}
      <div className="inline proc-tabs" role="tablist" style={{ gap: 8, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={tab === t.key ? '' : 'ghost'} style={{ padding: '6px 16px' }}
            onClick={() => { setTab(t.key); if (t.key === 'sources') setDuesSource(null) }}>{t.label}</button>
        ))}
      </div>
      {tab === 'sources'
        ? <SourcesTab showToast={showToast} onOpenDues={(id) => { setDuesSource(id); setTab('dues') }} />
        : <DuesTab key={duesSource || 'all'} showToast={showToast} initialSource={duesSource} />}
    </>
  )
}
