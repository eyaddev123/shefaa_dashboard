import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, INCOME_KINDS, PAYMENT_METHODS, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import FinanceBar from '../components/FinanceBar.jsx'

function NewIncomeForm({ onCreated }) {
  const blank = { kind: 'donation', source_name: '', amount: '', received_at: '', payment_method: 'cash', receipt_no: '', notes: '' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addIncome({ ...form, amount: Number(form.amount), received_at: form.received_at || null })
      setForm(blank)
      onCreated()
    } catch (ex) { setErr(ex.message) }
  }

  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field">
        <label>نوع الإيراد</label>
        <select value={form.kind} onChange={set('kind')}>
          {Object.entries(INCOME_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>المتبرع / الجهة</label><input value={form.source_name} onChange={set('source_name')} required /></div>
      <div className="field"><label>المبلغ (ل.س)</label><input type="number" min="1" value={form.amount} onChange={set('amount')} required /></div>
      <div className="field"><label>التاريخ</label><input type="date" value={form.received_at} onChange={set('received_at')} /></div>
      <div className="field">
        <label>طريقة الدفع</label>
        <select value={form.payment_method} onChange={set('payment_method')}>
          {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>رقم سند القبض</label><input value={form.receipt_no} onChange={set('receipt_no')} dir="ltr" /></div>
      <button type="submit">تسجيل الإيراد</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

export default function Treasury() {
  const [t, setT] = useState(null)
  const [income, setIncome] = useState([])
  const [err, setErr] = useState(null)
  const { role } = useRole()

  const load = () => Promise.all([api.treasury().then(setT), api.income().then(setIncome)]).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <p className="error">{err}</p>
  if (!t) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <h2>الخزينة والإيرادات</h2>
      <p className="subtitle">الصورة المالية الكاملة: ما دخل، ما صُرف، ما التزمنا به، وما بقي متاحاً للقرارات الجديدة</p>

      <div className="card">
        <h3>الوضع المالي</h3>
        <FinanceBar treasury={t} />
      </div>

      <div className="tiles">
        <div className="tile"><div className="label">إجمالي الإيرادات</div><div className="value" style={{ fontSize: 21 }}>{fmtMoney(t.incomeTotal)}</div></div>
        <div className="tile"><div className="label">إجمالي المصروف</div><div className="value" style={{ fontSize: 21 }}>{fmtMoney(t.spentTotal)}</div></div>
        <div className="tile"><div className="label">الرصيد النقدي</div><div className="value" style={{ fontSize: 21 }}>{fmtMoney(t.cashBalance)}</div></div>
        <div className="tile"><div className="label">الالتزامات المعلقة</div><div className="value" style={{ fontSize: 21 }}>{fmtMoney(t.committedTotal)}</div><div className="hint">قرارات معتمدة لم تُصرف بعد</div></div>
        <div className="tile hero">
          <div className="label">المتاح للقرارات الجديدة</div>
          <div className="value" style={{ fontSize: 21, color: t.available < 0 ? 'var(--status-bad)' : 'var(--status-good)' }}>{fmtMoney(t.available)}</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>الإيرادات حسب المصدر</h3>
          <table>
            <thead><tr><th>المصدر</th><th>عدد</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {t.byKind.map((k) => (
                <tr key={k.kind}>
                  <td><span className="badge blue">{INCOME_KINDS[k.kind] || k.kind}</span></td>
                  <td className="num">{k.n}</td>
                  <td className="num">{fmtMoney(k.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>الالتزامات المعلقة — قرارات بانتظار الصرف</h3>
          <table>
            <thead><tr><th>الطلب</th><th>القرار</th><th>المتبقي</th></tr></thead>
            <tbody>
              {t.commitments.filter((c) => Number(c.remaining) > 0).map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="plain" to={`/requests/${c.id}`}>{c.file_number} / طلب {c.request_no}</Link>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.head_name} · {AID_TYPES[c.aid_type]}</div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{DECISION_TYPES[c.decision_type]}{c.decision_type === 'percentage' && ` ${Number(c.decision_value)}٪`}</td>
                  <td className="num">{fmtMoney(c.remaining)}</td>
                </tr>
              ))}
              {t.commitments.filter((c) => Number(c.remaining) > 0).length === 0 &&
                <tr><td colSpan={3} className="empty">لا التزامات معلقة ✓</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>سجل الإيرادات</h3>
        {role === 'accountant' && <NewIncomeForm onCreated={load} />}
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>النوع</th><th>المتبرع / الجهة</th><th>المبلغ</th><th>التاريخ</th><th>الطريقة</th><th>سند القبض</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>
            {income.map((e) => (
              <tr key={e.id}>
                <td><span className="badge blue">{INCOME_KINDS[e.kind] || e.kind}</span></td>
                <td>{e.source_name}</td>
                <td className="num">{fmtMoney(e.amount)}</td>
                <td>{fmtDate(e.received_at)}</td>
                <td>{PAYMENT_METHODS[e.payment_method]}</td>
                <td className="num" dir="ltr">{e.receipt_no || '—'}</td>
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{e.notes || '—'}</td>
              </tr>
            ))}
            {income.length === 0 && <tr><td colSpan={7} className="empty">لا إيرادات مسجلة بعد</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
