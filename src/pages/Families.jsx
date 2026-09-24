import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, fmtDate } from '../api.js'
import { useRole } from '../RoleContext.jsx'

// أرباع البحث — كلٌّ على حدة كشاشة الطلبات، فلا تختلط النتائج
const SEARCH_BY = { name: 'الاسم', phone: 'رقم الهاتف', file_no: 'رقم الملف' }

export default function Families() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const { role } = useRole()
  const navigate = useNavigate()

  // البحث والفلتر في الـ URL فلا يضيعان بالتحديث ولا بالرجوع من ملفٍ فُتح
  const [params, setParams] = useSearchParams()
  const by = SEARCH_BY[params.get('by')] ? params.get('by') : 'name'
  const q = params.get('q') || ''
  // الملفات المستوردة من الأرشيف فيها نقص موسوم — هذا المفتاح يقصر القائمة عليها
  const onlyIssues = params.get('issues') === '1'
  const [text, setText] = useState(q)

  useEffect(() => { setText(q) }, [q])

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.families({ issues: onlyIssues, by, q })
      .then((r) => { if (alive) setRows(r) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [onlyIssues, by, q])

  const runSearch = (e) => {
    e?.preventDefault()
    const next = new URLSearchParams(params)
    if (text.trim()) { next.set('by', by); next.set('q', text.trim()) }
    else { next.delete('q') }
    setParams(next, { replace: true })
  }
  const setBy = (v) => { const n = new URLSearchParams(params); n.set('by', v); setParams(n, { replace: true }) }
  const setIssues = (on) => { const n = new URLSearchParams(params); on ? n.set('issues', '1') : n.delete('issues'); setParams(n, { replace: true }) }

  const visible = rows

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
        {/* بحث مقسَّم لأرباع: اسم / هاتف / رقم ملف — نفس شريط الطلبات */}
        <form className="search-bar" onSubmit={runSearch}>
          <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="نوع البحث">
            {Object.entries(SEARCH_BY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)}
                 dir={by === 'name' ? 'rtl' : 'ltr'}
                 placeholder={by === 'name' ? 'اسم رب العائلة أو أحد الأفراد…'
                   : by === 'phone' ? 'رقم الهاتف…' : 'رقم الملف…'} />
          <button type="submit">بحث</button>
          {q && <button type="button" className="ghost" onClick={() => { setText(''); const n = new URLSearchParams(params); n.delete('q'); setParams(n, { replace: true }) }}>مسح</button>}
        </form>

        {/* فلتر «تحتاج مراجعة» يبقى شغّالاً مع البحث */}
        <div className="table-filter" style={{ gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={onlyIssues}
                   onChange={(e) => setIssues(e.target.checked)} />
            تحتاج مراجعة فقط
          </label>
          <span className="count">{loading ? 'جارٍ البحث…' : `${visible.length} نتيجة`}</span>
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
