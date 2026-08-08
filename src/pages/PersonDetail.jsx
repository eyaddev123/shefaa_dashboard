import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, RELATIONS, STATUSES, fmtDate, fmtMoney } from '../api.js'

function statusBadge(status) {
  const cls =
    status === 'rejected' ? 'bad'
    : ['decided', 'disbursing', 'disbursed', 'closed'].includes(status) ? 'good'
    : ['submitted', 'under_review'].includes(status) ? 'warn'
    : ''
  return <span className={`badge ${cls}`}>{STATUSES[status] || status}</span>
}

export default function PersonDetail() {
  const { id } = useParams()
  const [p, setP] = useState(null)
  const [err, setErr] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { api.person(id).then(setP).catch((e) => setErr(e.message)) }, [id])

  if (err) return <p className="error">{err}</p>
  if (!p) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <h2>{p.name}</h2>
      <p className="subtitle">
        {RELATIONS[p.relation]} في عائلة{' '}
        <Link className="plain" to={`/families/${p.family_id}`}>{p.head_name} (ملف {p.file_number})</Link>
        {p.birth_year && <> · مواليد {p.birth_year}</>}
        {p.occupation && <> · {p.occupation}</>}
        {p.is_head && <> · <span className="badge blue">رب العائلة</span></>}
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="label">طلبات هذا الفرد</div>
          <div className="value">{p.requests.length}</div>
          <div className="hint">كمستفيد — وحده أو مع آخرين</div>
        </div>
        <div className="tile">
          <div className="label">طلبات معتمدة له</div>
          <div className="value">{p.approved_count}</div>
        </div>
        <div className="tile">
          <div className="label">إجمالي المصروف على طلباته</div>
          <div className="value" style={{ fontSize: 22 }}>{fmtMoney(p.total_disbursed)}</div>
          <div className="hint">مجموع سندات الصرف على طلبات هو مستفيد منها</div>
        </div>
      </div>

      <div className="card">
        <h3>سجل المساعدات — كيف ساعدنا {p.name.split(' ')[0]}؟</h3>
        <table>
          <thead>
            <tr>
              <th>الطلب</th><th>النوع</th><th>الوصف</th><th>التاريخ</th>
              <th>المراجعات</th><th>القرار</th><th>الحالة</th><th>المصروف</th>
            </tr>
          </thead>
          <tbody>
            {p.requests.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                <td className="num">
                  طلب {r.request_no}
                  {r.beneficiaries_count > 1 && (
                    <span className="badge" style={{ marginInlineStart: 6 }}>مشترك ({r.beneficiaries_count})</span>
                  )}
                </td>
                <td>{AID_TYPES[r.aid_type]}</td>
                <td style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</td>
                <td>{fmtDate(r.requested_at)}</td>
                <td className="num">{r.reviews_count}/5 ({r.approvals_count} موافقة)</td>
                <td>
                  {r.decision_type
                    ? <>{DECISION_TYPES[r.decision_type]}{r.decision_value != null && ` — ${r.decision_type === 'percentage' ? Number(r.decision_value) + '٪' : fmtMoney(r.decision_value)}`}</>
                    : '—'}
                </td>
                <td>{statusBadge(r.status)}</td>
                <td className="num">{fmtMoney(r.disbursed_total)}</td>
              </tr>
            ))}
            {p.requests.length === 0 && <tr><td colSpan={8} className="empty">لا طلبات لهذا الفرد بعد</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
