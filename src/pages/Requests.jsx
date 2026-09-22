import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, AID_TYPES, STATUSES, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { isReadOnly } from '../permissions.js'

function statusBadge(status) {
  const cls =
    status === 'rejected' ? 'bad'
    : ['decided', 'disbursing', 'disbursed', 'closed'].includes(status) ? 'good'
    : ['submitted', 'under_review'].includes(status) ? 'warn'
    : ''
  return <span className={`badge ${cls}`}>{STATUSES[status] || status}</span>
}

// أرباع البحث — كلٌّ على حدة، فلا تختلط النتائج
const SEARCH_BY = { name: 'الاسم', phone: 'رقم الهاتف', request_no: 'رقم الطلب' }

export default function Requests() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const { role } = useRole()
  const navigate = useNavigate()

  // البحث والفلتر محفوظان في الـ URL فلا يضيعان بالتحديث
  const [params, setParams] = useSearchParams()
  const by = SEARCH_BY[params.get('by')] ? params.get('by') : 'name'
  const q = params.get('q') || ''
  const statusFilter = params.get('status') || ''
  const [text, setText] = useState(q)

  // البحث خادمي بالربع المختار (فارغ ⇒ كل الطلبات)
  const fetchRows = useCallback((searchBy, query) => {
    setLoading(true)
    api.requests(query.trim() ? searchBy : null, query.trim())
      .then(setRows).finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRows(by, q) }, [fetchRows, by, q])

  const runSearch = (e) => {
    e?.preventDefault()
    const next = new URLSearchParams(params)
    if (text.trim()) { next.set('by', by); next.set('q', text.trim()) }
    else { next.delete('q') }
    setParams(next, { replace: true })
  }
  const setBy = (v) => { const n = new URLSearchParams(params); n.set('by', v); setParams(n, { replace: true }) }
  const setStatus = (v) => { const n = new URLSearchParams(params); v ? n.set('status', v) : n.delete('status'); setParams(n, { replace: true }) }

  // فلتر الحالة يُطبَّق على نتائج البحث (بالواجهة — لا يحتاج جولة خادم)
  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows

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
        {/* بحث مقسَّم لأرباع: اسم / هاتف / رقم طلب */}
        <form className="search-bar" onSubmit={runSearch}>
          <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="نوع البحث">
            {Object.entries(SEARCH_BY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)}
                 dir={by === 'name' ? 'rtl' : 'ltr'}
                 placeholder={by === 'name' ? 'اسم رب العائلة أو المستفيد…'
                   : by === 'phone' ? 'رقم الهاتف…' : 'رقم الطلب…'} />
          <button type="submit">بحث</button>
          {q && <button type="button" className="ghost" onClick={() => { setText(''); const n = new URLSearchParams(params); n.delete('q'); setParams(n, { replace: true }) }}>مسح</button>}
        </form>

        {/* فلتر الحالة يبقى شغّالاً مع البحث */}
        <div className="table-filter" style={{ gap: 8 }}>
          <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="count">{loading ? 'جارٍ البحث…' : `${visible.length} نتيجة`}</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>الملف</th><th>رب العائلة</th><th>المستفيدون</th><th>النوع</th>
              <th>تاريخ الطلب</th><th>مراجعات المجلس</th><th>الحالة</th><th>المصروف</th>
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
            {!loading && visible.length === 0 && <tr><td colSpan={8} className="empty">لا نتائج مطابقة</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
