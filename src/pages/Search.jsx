import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, AID_TYPES, RELATIONS, STATUSES, fmtDate } from '../api.js'

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [input, setInput] = useState(q)
  const [results, setResults] = useState(null)
  const [err, setErr] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    setInput(q)
    if (q.trim().length >= 2) {
      api.search(q).then(setResults).catch((e) => setErr(e.message))
    } else setResults(null)
  }, [q])

  const submit = (e) => {
    e.preventDefault()
    setParams({ q: input })
  }

  const total = results
    ? results.families.length + results.persons.length + results.requests.length
    : 0

  return (
    <>
      <h2>البحث</h2>
      <p className="subtitle">ابحث بالاسم، رقم الجوال، الرقم الوطني، رقم الملف، أو رقم الطلب</p>

      <form className="inline" onSubmit={submit} style={{ marginBottom: 20 }}>
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
               placeholder="مثال: أحمد، 0944123456، 01010101012، 1.1 …"
               style={{ flex: 1, maxWidth: 480, fontSize: 15 }} />
        <button type="submit">بحث</button>
      </form>

      {err && <p className="error">{err}</p>}
      {results && total === 0 && (
        <div className="card"><p className="empty">لا نتائج لـ «{results.q}» — جرّب جزءاً من الاسم أو الرقم</p></div>
      )}

      {results?.persons.length > 0 && (
        <div className="card">
          <h3>👤 الأفراد ({results.persons.length})</h3>
          <table>
            <thead><tr><th>الاسم</th><th>القرابة</th><th>الرقم الوطني</th><th>العائلة</th><th>جوال العائلة</th></tr></thead>
            <tbody>
              {results.persons.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/persons/${p.id}`)}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  <td>{RELATIONS[p.relation]}</td>
                  <td className="num" dir="ltr">{p.national_id || '—'}</td>
                  <td>{p.file_number} — {p.head_name}</td>
                  <td className="num" dir="ltr">{p.mobile || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results?.families.length > 0 && (
        <div className="card">
          <h3>🏠 العائلات ({results.families.length})</h3>
          <table>
            <thead><tr><th>رقم الملف</th><th>رب العائلة</th><th>مقدّم الطلب</th><th>الجوال</th><th>العنوان</th></tr></thead>
            <tbody>
              {results.families.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => navigate(`/families/${f.id}`)}>
                  <td className="num">{f.file_number}</td>
                  <td style={{ fontWeight: 700 }}>{f.head_name}</td>
                  <td>{f.applicant_name || '—'}</td>
                  <td className="num" dir="ltr">{f.mobile || f.phone || '—'}</td>
                  <td>{f.current_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results?.requests.length > 0 && (
        <div className="card">
          <h3>📋 الطلبات ({results.requests.length})</h3>
          <table>
            <thead><tr><th>الطلب</th><th>الملف</th><th>رب العائلة</th><th>النوع</th><th>التاريخ</th><th>الحالة</th></tr></thead>
            <tbody>
              {results.requests.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                  <td className="num">#{r.id} (طلب {r.request_no})</td>
                  <td className="num">{r.file_number}</td>
                  <td>{r.head_name}</td>
                  <td>{AID_TYPES[r.aid_type]}</td>
                  <td>{fmtDate(r.requested_at)}</td>
                  <td><span className="badge">{STATUSES[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
