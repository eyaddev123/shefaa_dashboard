import { useEffect, useState } from 'react'
import { api, fmtMoney, todayLocal } from '../../api.js'
import { EmptyState, fmtDay, fmtQty, fmtSignedMoney, materialsCount } from './shared.jsx'

const monthStart = () => `${todayLocal().slice(0, 8)}01`
const GROUPS = [['material', 'المادة'], ['doctor', 'الدكتور'], ['procedure', 'الإجراء']]

function Range({ from, to, setFrom, setTo, children }) {
  return (
    <div className="inline inv-range">
      <div className="field"><label>من</label>
        <input type="date" value={from} max={todayLocal()}
          onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></div>
      <div className="field"><label>إلى</label>
        <input type="date" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} /></div>
      {children}
    </div>
  )
}

function useReport(load, deps) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null)
    load().then((d) => { if (alive) { setData(d); setErr(null) } }).catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return [data, err]
}

// ═══ تقرير الاستهلاك الواحد ═══
// لكل مادة في المدى: الكمّية، وقيمة البيع (ما حُسب على الإجراءات من لقطاتها)، وكلفة
// الشراء (بسعر آخر شراء)، والهامش بينهما — الفرق معلومةٌ لا تقريران يتناقضان.
// المجلس (withCost=false) يرى الكمّية وقيمة البيع وحدهما، والخادم يحذف الباقي أصلاً.
function Consumption({ showToast, withCost }) {
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => todayLocal())
  const [group, setGroup] = useState('material')
  const [busy, setBusy] = useState(false)
  const [data, err] = useReport(() => api.inventory.consumption({ from, to, group }), [from, to, group])
  const exportX = async () => {
    setBusy(true)
    try { showToast(`نُزّل ${await api.inventory.exportConsumption({ from, to, group })}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) } finally { setBusy(false) }
  }
  const grouped = group !== 'material'
  const groupLabel = group === 'doctor' ? 'الدكتور' : 'الإجراء'
  return (
    <div className="card">
      <div className="inv-toolbar">
        <h3 style={{ margin: 0 }}>الاستهلاك</h3>
        <button type="button" className="ghost" disabled={busy || !data || data.rows.length === 0} onClick={exportX}>
          {busy ? 'جارٍ التصدير…' : '⬇ Excel'}</button>
      </div>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <div className="field"><label htmlFor="cons-group">تجميع حسب</label>
          <select id="cons-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
      </Range>
      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? (
          <EmptyState text="لا استهلاك في هذا المدى." hint="الاستهلاك يُسجَّل من مواد الإجراءات تلقائياً." />
        ) : (
          <>
            <table className="inv-table inv-cons rtable">
              <thead><tr>
                {grouped && <th>{groupLabel}</th>}
                <th>المادة</th><th>الكمّية المستهلكة</th><th>في إجراءات</th><th>قيمة البيع</th>
                {withCost && <><th>كلفة الشراء</th><th>الهامش</th></>}
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const first = grouped && (i === 0 || data.rows[i - 1].group_id !== r.group_id)
                  return (
                    <tr key={`${r.group_id}-${r.material_id}`} className={grouped && !first ? 'inv-grouped' : undefined}>
                      {/* على الجوال كلّ بطاقةٍ تحمل مجموعتها — فلا تضيع بين البطاقات */}
                      {grouped && (
                        <td className="rt-full inv-cons-group" data-label={groupLabel}>
                          {first ? <strong>{r.group_name}</strong> : <span className="rt-only">{r.group_name}</span>}
                        </td>
                      )}
                      <td className="rt-title">
                        {r.material}
                        {!r.is_active && <span className="badge sm" style={{ marginInlineStart: 6 }}>معطَّلة</span>}
                      </td>
                      <td className="num" data-label="الكمّية المستهلكة"><strong>{fmtQty(r.qty)}</strong> {r.unit}</td>
                      <td className="num" data-label="في إجراءات">{r.lines.toLocaleString('ar-SY')}</td>
                      <td className="num" data-label="قيمة البيع">{fmtMoney(r.sale_value)}</td>
                      {withCost && (
                        <>
                          <td className="num" data-label="كلفة الشراء">
                            {r.cost_value === null ? <span className="inv-muted">بلا سعر شراء</span> : fmtMoney(r.cost_value)}
                            {r.unit_cost !== null && <span className="inv-sub">{fmtMoney(r.unit_cost)} للوحدة</span>}
                          </td>
                          <td className={`num inv-margin${r.margin !== null && r.margin < 0 ? ' neg' : ''}`} data-label="الهامش">
                            {r.margin === null ? '—' : <bdi dir="rtl">{fmtSignedMoney(r.margin)}</bdi>}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
                <tr className="rev-total-row">
                  <td colSpan={grouped ? 4 : 3} className="rt-title">الإجمالي</td>
                  <td className="num" data-label="قيمة البيع">{fmtMoney(data.total_sale)}</td>
                  {withCost && (
                    <>
                      <td className="num" data-label="كلفة الشراء">{fmtMoney(data.total_cost)}</td>
                      <td className={`num inv-margin${data.total_margin < 0 ? ' neg' : ''}`} data-label="الهامش">
                        <bdi dir="rtl">{fmtSignedMoney(data.total_margin)}</bdi></td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
            <p className="inv-footnote">
              قيمة البيع ما حُسب على الإجراءات بسعر المادة لحظة إضافتها.
              {withCost && ' كلفة الشراء بسعر آخر شراء، والهامش الفرق بينهما.'}
              {withCost && data.missing_cost > 0 && (
                <span className="inv-muted"> {materialsCount(data.missing_cost)} بلا سعر شراء — لا تدخل في الكلفة ولا الهامش.</span>
              )}
            </p>
          </>
        )}
    </div>
  )
}

function Purchases({ showToast }) {
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => todayLocal())
  const [busy, setBusy] = useState(false)
  const [data, err] = useReport(() => api.inventory.purchases({ from, to }), [from, to])
  const exportX = async () => {
    setBusy(true)
    try { showToast(`نُزّل ${await api.inventory.exportPurchases({ from, to })}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) } finally { setBusy(false) }
  }
  return (
    <div className="card">
      <div className="inv-toolbar">
        <h3 style={{ margin: 0 }}>المشتريات</h3>
        <button type="button" className="ghost" disabled={busy || !data || data.rows.length === 0} onClick={exportX}>
          {busy ? 'جارٍ التصدير…' : '⬇ Excel'}</button>
      </div>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <EmptyState text="لا مشتريات في هذا المدى." />
        : (
          <table className="inv-table rtable">
            <thead><tr><th>التاريخ</th><th>المادة</th><th>الكمّية</th><th>سعر الوحدة</th><th>المورّد</th><th>المجموع</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="inv-nowrap rt-badge">{fmtDay(r.date)}</td>
                  <td className="rt-title">{r.material}</td>
                  <td className="num" data-label="الكمّية">{fmtQty(r.qty)} {r.unit}</td>
                  <td className="num" data-label="سعر الوحدة">{r.unit_cost === null ? '—' : fmtMoney(r.unit_cost)}</td>
                  <td data-label="المورّد">{r.supplier || <span className="inv-muted">—</span>}</td>
                  <td className="num" data-label="المجموع">{r.total === null ? '—' : fmtMoney(r.total)}</td>
                </tr>
              ))}
              <tr className="rev-total-row">
                <td colSpan={5} className="rt-title">الإجمالي{data.missing_cost ? <span className="inv-muted"> — {data.missing_cost.toLocaleString('ar-SY')} بلا سعر لا تدخل فيه</span> : ''}</td>
                <td className="num">{fmtMoney(data.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
    </div>
  )
}

// withCost: المشرفة والمدير والمشرف العام. والمجلس بلا المشتريات (أسعار شراء) ولا كلفة الاستهلاك
export default function Reports({ showToast, withCost }) {
  return (
    <>
      <Consumption showToast={showToast} withCost={withCost} />
      {withCost && <Purchases showToast={showToast} />}
    </>
  )
}
