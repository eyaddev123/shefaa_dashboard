import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtDateTime } from '../../api.js'
import { EmptyState, TYPE_BADGE, TYPE_LABELS, fmtDay, fmtQty, fmtSigned, stockStatus } from './shared.jsx'

const PER = 20

// تفاصيل الحركة بحسب نوعها: الاستهلاك ⇐ الدكتور والإجراء · الشراء ⇐ المورّد والسعر · التسوية ⇐ السبب
function MovementDetail({ m }) {
  if (m.type === 'consumption') {
    return (
      <>
        <span>{m.procedure_name || 'إجراء'}{m.doctor_name && <span className="inv-muted"> — {m.doctor_name}</span>}</span>
        {m.patient_name && <span className="inv-sub">{m.patient_name}</span>}
      </>
    )
  }
  if (m.type === 'adjustment') {
    return (
      <>
        <span>{m.reason_label}{m.reason_note && <span className="inv-muted"> — {m.reason_note}</span>}</span>
        {m.note && <span className="inv-sub">{m.note}</span>}
      </>
    )
  }
  const parts = [m.supplier, m.unit_cost !== null ? `${fmtMoney(m.unit_cost)} للوحدة` : null].filter(Boolean)
  return (
    <>
      <span>{parts.length ? parts.join(' · ') : <span className="inv-muted">—</span>}</span>
      {m.note && <span className="inv-sub">{m.note}</span>}
    </>
  )
}

function Movements({ material, refreshKey, onPurchase }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { setPage(1) }, [material.id, refreshKey])
  useEffect(() => {
    let alive = true
    api.inventory.movements(material.id, page, PER)
      .then((d) => { if (alive) { setData(d); setErr(null) } })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [material.id, page, refreshKey])

  if (err) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>
  if (data.total === 0) {
    return (
      <EmptyState text="لا حركات لهذه المادة بعد."
        hint="الشراء يُدخلها، والإجراءات التي تستعملها تُخرجها تلقائياً.">
        <button type="button" onClick={onPurchase}>تسجيل شراء</button>
      </EmptyState>
    )
  }
  const pages = Math.ceil(data.total / data.per)
  return (
    <>
      <table className="inv-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمّية</th><th>الرصيد بعدها</th><th>التفاصيل</th><th>سجّلها</th></tr></thead>
        <tbody>
          {data.rows.map((m) => (
            <tr key={m.id}>
              <td className="inv-nowrap">{fmtDay(m.movement_date)}</td>
              <td><span className={`badge sm ${TYPE_BADGE[m.type]}`}>{TYPE_LABELS[m.type]}</span></td>
              <td className={`num inv-qty${m.quantity < 0 ? ' is-out' : ''}`} dir="ltr">{fmtSigned(m.quantity)}</td>
              <td className={`num${m.balance_after < 0 ? ' neg' : ''}`} dir="ltr">{fmtQty(m.balance_after)}</td>
              <td className="inv-detail"><MovementDetail m={m} /></td>
              <td className="inv-who">{m.created_by_name || '—'}<span className="inv-sub">{fmtDateTime(m.created_at)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="inv-pager">
          <button type="button" className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>الأحدث</button>
          <span>صفحة {page.toLocaleString('ar-SY')} من {pages.toLocaleString('ar-SY')}</span>
          <button type="button" className="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>الأقدم</button>
        </div>
      )}
    </>
  )
}

function Prices({ material, refreshKey, onEditPrice }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.inventory.prices(material.id).then((r) => { setRows(r); setErr(null) }).catch((e) => setErr(e.message))
  }, [material.id, refreshKey])
  if (err) return <p className="error">{err}</p>
  if (!rows) return <p className="empty">جارٍ التحميل…</p>
  if (rows.length === 0) {
    return (
      <EmptyState text="لم يُعدَّل سعر البيع بعد." hint={`السعر الحالي ${fmtMoney(material.unit_price)}.`}>
        <button type="button" className="ghost" onClick={onEditPrice}>تعديل سعر البيع</button>
      </EmptyState>
    )
  }
  return (
    <table className="inv-table">
      <thead><tr><th>التاريخ</th><th>القديم ← الجديد</th><th>الملاحظة</th><th>عدّله</th></tr></thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.id}>
            <td className="inv-nowrap">{fmtDateTime(h.created_at)}</td>
            <td className="num">{fmtMoney(h.old_price)} ← <strong>{fmtMoney(h.new_price)}</strong></td>
            <td>{h.note || <span className="inv-muted">—</span>}</td>
            <td>{h.created_by_name || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** كرت المادة: رأسٌ بأهمّ الأرقام، وتبويبان: كشف الحركات وسجلّ الأسعار */
export default function MaterialCard({ id, refreshKey, onBack, onPurchase, onEdit, onEditPrice }) {
  const [m, setM] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('movements')
  useEffect(() => {
    api.inventory.material(id).then((r) => { setM(r); setErr(null) }).catch((e) => setErr(e.message))
  }, [id, refreshKey])

  if (err) return <><button type="button" className="link-btn" onClick={onBack}>→ كل المواد</button><p className="error">{err}</p></>
  if (!m) return <p className="empty">جارٍ التحميل…</p>
  const st = stockStatus(m)
  return (
    <>
      <button type="button" className="link-btn inv-back" onClick={onBack}>→ كل المواد</button>
      <div className="card">
        <div className="inv-card-head">
          <div>
            <h3 className="inv-card-title">{m.name}</h3>
            <div className="inv-card-tags">
              <span className={`badge sm ${st.cls}`}>{st.label}</span>
              {m.selling_at_loss && <span className="badge sm bad">بيع بخسارة</span>}
            </div>
          </div>
          <div className="inv-card-actions">
            <button type="button" onClick={() => onPurchase(m)}>تسجيل شراء</button>
            <button type="button" className="ghost" onClick={() => onEdit(m)}>تعديل</button>
          </div>
        </div>
        <div className="inv-stats">
          <div className="inv-stat inv-stat-main">
            <span className="label">الرصيد الحالي</span>
            <span className={`value${m.balance < 0 ? ' neg' : ''}`}><bdi dir="ltr">{fmtQty(m.balance)}</bdi> <small>{m.unit}</small></span>
          </div>
          <div className="inv-stat">
            <span className="label">الحدّ الأدنى</span>
            <span className="value">{m.min_quantity ? fmtQty(m.min_quantity) : '—'}</span>
          </div>
          <div className="inv-stat">
            <span className="label">سعر البيع للمريض</span>
            <span className={`value${m.selling_at_loss ? ' neg' : ''}`}>{fmtMoney(m.unit_price)}</span>
            <button type="button" className="link-btn" onClick={() => onEditPrice(m)}>تعديل سعر البيع</button>
          </div>
          <div className="inv-stat">
            <span className="label">آخر سعر شراء</span>
            <span className="value">{m.last_cost === null ? '—' : fmtMoney(m.last_cost)}</span>
            {m.last_cost_date && <span className="inv-sub">{fmtDay(m.last_cost_date)}</span>}
          </div>
          <div className="inv-stat">
            <span className="label">قيمة الرصيد</span>
            <span className="value">{m.stock_value === null ? '—' : fmtMoney(m.stock_value)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="inline proc-tabs inv-subtabs" role="tablist">
          {[['movements', 'كشف الحركات'], ['prices', 'سجلّ الأسعار']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {tab === 'movements'
          ? <Movements material={m} refreshKey={refreshKey} onPurchase={() => onPurchase(m)} />
          : <Prices material={m} refreshKey={refreshKey} onEditPrice={() => onEditPrice(m)} />}
      </div>
    </>
  )
}
