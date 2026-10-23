import { useEffect, useState } from 'react'
import { api, fmtMoney, todayLocal } from '../api.js'
import { fmtQty } from '../components/MaterialsEditor.jsx'

// ═══ استهلاك المواد في مدى ═══
// الكمّية المستعملة لكل مادة من الإجراءات المسجّلة — بلا مخزون ولا مستودع.
// الإجراء المُزال لا يُعدّ (المريض لم يدفعه، والإزالة غالباً خطأ إدخال).

// أوّل الشهر الحالي — المدى الافتراضي لتقريرٍ يُقرأ شهرياً
const monthStart = () => `${todayLocal().slice(0, 8)}01`

export default function MaterialsConsumption({ showToast }) {
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => todayLocal())
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setData(null)
    api.clinic.materialsConsumption({ from, to }).then((d) => { setData(d); setErr(null) })
      .catch((e) => setErr(e.message))
  }, [from, to])

  const doExport = async () => {
    setExporting(true)
    try { const name = await api.clinic.exportConsumption({ from, to }); showToast(`نُزّل ${name}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="card">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <h3 style={{ margin: 0 }}>استهلاك المواد</h3>
        <button type="button" className="ghost" disabled={exporting || !data || data.rows.length === 0}
          onClick={doExport} style={{ padding: '6px 14px' }}>{exporting ? 'جارٍ التصدير…' : 'إكسل'}</button>
      </div>
      <div className="inline rev-filters">
        <div className="field"><label>من</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></div>
        <div className="field"><label>إلى</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <p className="empty">لا مواد مستعملة في هذا المدى.</p>
        : (
          <table>
            <thead><tr><th>المادة</th><th>الكمّية المستعملة</th><th>في إجراءات</th><th>الكلفة</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.material_id}>
                  <td>{r.name}{!r.is_active && <span className="badge" style={{ marginInlineStart: 6 }}>معطَّلة</span>}</td>
                  <td className="num"><strong>{fmtQty(r.qty)}</strong> {r.unit}</td>
                  <td className="num">{r.lines}</td>
                  <td className="num">{fmtMoney(r.cost)}</td>
                </tr>
              ))}
              <tr className="rev-total-row">
                <td colSpan={3}>الإجمالي</td>
                <td className="num">{fmtMoney(data.total_cost)}</td>
              </tr>
            </tbody>
          </table>
        )}
    </div>
  )
}
