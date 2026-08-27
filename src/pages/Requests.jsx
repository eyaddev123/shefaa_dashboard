import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, AID_TYPES, STATUSES, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function statusBadge(status) {
  const cls =
    status === 'rejected' ? 'bad'
    : ['decided', 'disbursing', 'disbursed', 'closed'].includes(status) ? 'good'
    : ['submitted', 'under_review'].includes(status) ? 'warn'
    : ''
  return <span className={`badge ${cls}`}>{STATUSES[status] || status}</span>
}

export default function Requests() {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  const { role } = useRole()
  const navigate = useNavigate()

  useEffect(() => { api.requests().then(setRows) }, [])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.head_name?.toLowerCase().includes(q) ||
      r.file_number?.includes(q) ||
      String(r.id) === q ||
      r.description?.toLowerCase().includes(q) ||
      r.beneficiaries.some((b) => b.name?.toLowerCase().includes(q)))
  }, [rows, filter])

  return (
    <>
      <div className="page-head">
        <div>
          <h2>طلبات المساعدة</h2>
          <p className="subtitle">
            {role === 'board'
              ? 'بصفتك عضو مجلس إدارة: افتح الطلب لمراجعته والاطلاع على الملف الكامل للعائلة'
              : 'افتح الطلب لعرض تفاصيله وسير مراجعته'}
          </p>
        </div>
        {role === 'officer' && (
          <button onClick={() => navigate('/requests/new')} style={{ padding: '11px 22px', flexShrink: 0 }}>
            ＋ تقديم طلب جديد
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-filter">
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
                 placeholder="تصفية: اسم رب العائلة، مستفيد، رقم ملف، رقم طلب…" />
          {filter && <span className="count">{visible.length} من {rows.length}</span>}
        </div>
        <table>
          <thead>
            <tr>
              <th>الملف</th>
              <th>رب العائلة</th>
              <th>المستفيدون</th>
              <th>النوع</th>
              <th>تاريخ الطلب</th>
              <th>مراجعات المجلس</th>
              <th>الحالة</th>
              <th>المصروف</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                <td className="num">{r.file_number} / طلب {r.request_no}</td>
                <td>{r.head_name}</td>
                <td>{r.beneficiaries.map((b) => b.name).join('، ')}</td>
                <td>{AID_TYPES[r.aid_type]}</td>
                <td>{fmtDate(r.requested_at)}</td>
                <td className="num">{r.reviews_count} / 5 <span style={{ color: 'var(--muted)' }}>({r.approvals_count} موافقة)</span></td>
                <td>{statusBadge(r.status)}</td>
                <td className="num">{fmtMoney(r.disbursed_total)}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="empty">لا نتائج مطابقة</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
