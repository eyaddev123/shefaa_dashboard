import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtDate } from '../api.js'
import { useRole } from '../RoleContext.jsx'

export default function Families() {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  // الملفات المستوردة من الأرشيف فيها نقص موسوم — هذا المفتاح يقصر القائمة عليها
  const [onlyIssues, setOnlyIssues] = useState(false)
  const { role } = useRole()
  const navigate = useNavigate()

  useEffect(() => { api.families({ issues: onlyIssues }).then(setRows) }, [onlyIssues])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((h) =>
      h.head_name?.toLowerCase().includes(q) ||
      h.applicant_name?.toLowerCase().includes(q) ||
      h.file_number?.includes(q) ||
      h.mobile?.includes(q) ||
      h.phone?.includes(q) ||
      h.family_card_no?.toLowerCase().includes(q) ||
      h.current_address?.toLowerCase().includes(q))
  }, [rows, filter])

  return (
    <>
      <div className="page-head">
        <div>
          <h2>العائلات — الملفات الدائمة</h2>
          <p className="subtitle">الملف يبقى مدى الحياة وتتراكم عليه الطلبات</p>
        </div>
        {role === 'officer' && (
          <button onClick={() => navigate('/families/new')} style={{ padding: '11px 22px', flexShrink: 0 }}>
            ＋ فتح ملف عائلة جديد
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-filter">
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
                 placeholder="تصفية: اسم، جوال، رقم ملف، بطاقة عائلية، عنوان…" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={onlyIssues}
                   onChange={(e) => setOnlyIssues(e.target.checked)} />
            تحتاج مراجعة فقط
          </label>
          {filter && <span className="count">{visible.length} من {rows.length}</span>}
        </div>
        <table>
          <thead>
            <tr>
              <th>رقم الملف</th><th>رب العائلة</th><th>العنوان</th><th>الجوال</th>
              <th>تاريخ الفتح</th><th>الأفراد</th><th>الطلبات</th><th>مراجعة</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.id} className="clickable" onClick={() => navigate(`/families/${h.id}`)}>
                <td className="num">{h.file_number}</td>
                <td>{h.head_name}</td>
                <td>{h.current_address || '—'}</td>
                <td className="num" dir="ltr">{h.mobile || '—'}</td>
                <td>{fmtDate(h.opened_at)}</td>
                <td className="num">{h.members_count}</td>
                <td className="num">{h.requests_count}</td>
                <td>
                  {h.open_issues > 0
                    ? <span className="badge warn">{h.open_issues} مشكلة</span>
                    : <span className="subtitle">—</span>}
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="empty">لا نتائج مطابقة</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
