import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, AID_TYPES, PAYMENT_METHODS, fmtDate, fmtMoney } from '../api.js'

export default function Vouchers() {
  const [rows, setRows] = useState([])
  useEffect(() => { api.vouchers().then(setRows) }, [])

  const total = rows.reduce((s, v) => s + Number(v.amount), 0)

  return (
    <>
      <h2>سندات الصرف</h2>
      <p className="subtitle">كل صرف فعلي مرتبط بطلب معتمد — الإجمالي: <strong>{fmtMoney(total)}</strong></p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>رقم السند</th><th>الملف / الطلب</th><th>رب العائلة</th><th>النوع</th>
              <th>المبلغ</th><th>التاريخ</th><th>الطريقة</th><th>المصدر</th><th>قيد الأمين</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="num" dir="ltr">{v.voucher_no}</td>
                <td><Link className="plain" to={`/requests/${v.request_id}`}>{v.file_number} / طلب {v.request_no}</Link></td>
                <td>{v.head_name}</td>
                <td>{AID_TYPES[v.aid_type]}</td>
                <td className="num">{fmtMoney(v.amount)}</td>
                <td>{fmtDate(v.disbursed_at)}</td>
                <td>{PAYMENT_METHODS[v.payment_method]}</td>
                <td>{v.source === 'ameen_import' ? <span className="badge blue">كشف الأمين</span> : 'يدوي'}</td>
                <td className="num" dir="ltr">{v.ledger_ref || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="empty">لا سندات صرف بعد</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
