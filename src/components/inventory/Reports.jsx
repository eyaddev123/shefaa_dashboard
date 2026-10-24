import { useEffect, useState } from 'react'
import { api, fmtMoney, todayLocal } from '../../api.js'
import { EmptyState, fmtDay, fmtQty } from './shared.jsx'

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

function Consumption({ showToast }) {
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
          <table className="inv-table">
            <thead><tr>
              {grouped && <th>{group === 'doctor' ? 'الدكتور' : 'الإجراء'}</th>}
              <th>المادة</th><th>الكمّية المستهلكة</th><th>في إجراءات</th><th>القيمة (بسعر آخر شراء)</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r, i) => {
                const first = grouped && (i === 0 || data.rows[i - 1].group_id !== r.group_id)
                return (
                  <tr key={`${r.group_id}-${r.material_id}`} className={grouped && !first ? 'inv-grouped' : undefined}>
                    {grouped && <td>{first ? <strong>{r.group_name}</strong> : ''}</td>}
                    <td>{r.material}</td>
                    <td className="num"><strong>{fmtQty(r.qty)}</strong> {r.unit}</td>
                    <td className="num">{r.lines.toLocaleString('ar-SY')}</td>
                    <td className="num">{r.value === null ? '—' : fmtMoney(r.value)}</td>
                  </tr>
                )
              })}
              <tr className="rev-total-row">
                <td colSpan={grouped ? 4 : 3}>الإجمالي{data.missing_cost ? <span className="inv-muted"> — {data.missing_cost.toLocaleString('ar-SY')} بلا سعر شراء لا تدخل فيه</span> : ''}</td>
                <td className="num">{fmtMoney(data.total_value)}</td>
              </tr>
            </tbody>
          </table>
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
          <table className="inv-table">
            <thead><tr><th>التاريخ</th><th>المادة</th><th>الكمّية</th><th>سعر الوحدة</th><th>المورّد</th><th>المجموع</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="inv-nowrap">{fmtDay(r.date)}</td>
                  <td>{r.material}</td>
                  <td className="num">{fmtQty(r.qty)} {r.unit}</td>
                  <td className="num">{r.unit_cost === null ? '—' : fmtMoney(r.unit_cost)}</td>
                  <td>{r.supplier || <span className="inv-muted">—</span>}</td>
                  <td className="num">{r.total === null ? '—' : fmtMoney(r.total)}</td>
                </tr>
              ))}
              <tr className="rev-total-row">
                <td colSpan={5}>الإجمالي{data.missing_cost ? <span className="inv-muted"> — {data.missing_cost.toLocaleString('ar-SY')} بلا سعر لا تدخل فيه</span> : ''}</td>
                <td className="num">{fmtMoney(data.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
    </div>
  )
}

export default function Reports({ showToast }) {
  return (
    <>
      <Consumption showToast={showToast} />
      <Purchases showToast={showToast} />
    </>
  )
}
