import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, AID_TYPES, RELATIONS, STATUSES, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function statusBadge(status) {
  const cls =
    status === 'rejected' ? 'bad'
    : ['decided', 'disbursing', 'disbursed', 'closed'].includes(status) ? 'good'
    : ['submitted', 'under_review'].includes(status) ? 'warn'
    : ''
  return <span className={`badge ${cls}`}>{STATUSES[status] || status}</span>
}

function NewPersonForm({ familyId, onCreated }) {
  const blank = { name: '', relation: 'son', birth_year: '', occupation: '', monthly_wage: '', national_id: '' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addPerson(familyId, {
        ...form,
        birth_year: form.birth_year ? Number(form.birth_year) : null,
        monthly_wage: form.monthly_wage ? Number(form.monthly_wage) : null,
        is_head: form.relation === 'head',
      })
      setForm(blank)
      onCreated()
    } catch (e) { setErr(e.message) }
  }

  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field"><label>الاسم</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="field">
        <label>صلة القرابة</label>
        <select value={form.relation} onChange={set('relation')}>
          {Object.entries(RELATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>سنة التولّد</label><input type="number" value={form.birth_year} onChange={set('birth_year')} /></div>
      <div className="field"><label>المهنة</label><input value={form.occupation} onChange={set('occupation')} /></div>
      <div className="field"><label>الأجر الشهري</label><input type="number" value={form.monthly_wage} onChange={set('monthly_wage')} /></div>
      <div className="field"><label>الرقم الوطني</label><input value={form.national_id} onChange={set('national_id')} dir="ltr" /></div>
      <button type="submit">إضافة الفرد</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

export default function FamilyDetail() {
  const { id } = useParams()
  const [h, setH] = useState(null)
  const { role } = useRole()
  const navigate = useNavigate()

  const load = useCallback(() => api.family(id).then(setH), [id])
  useEffect(() => { load() }, [load])

  if (!h) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <h2>ملف {h.file_number} — عائلة {h.head_name}</h2>
      <p className="subtitle">
        فُتح في {fmtDate(h.opened_at)} · {h.current_address || 'بدون عنوان'} ·
        جوال: <span dir="ltr">{h.mobile || '—'}</span>
      </p>

      <div className="tiles">
        <div className="tile"><div className="label">أفراد العائلة</div><div className="value">{h.members.length}</div></div>
        <div className="tile"><div className="label">طلبات العائلة</div><div className="value">{h.requests.length}</div></div>
        <div className="tile">
          <div className="label">إجمالي المصروف للعائلة</div>
          <div className="value" style={{ fontSize: 22 }}>{fmtMoney(h.disbursed_total)}</div>
          <div className="hint">عبر كل الطلبات وسندات الصرف</div>
        </div>
      </div>

      <div className="card">
        <h3>أفراد العائلة — انقر على الفرد لعرض سجل مساعداته</h3>
        <table>
          <thead>
            <tr><th>الاسم</th><th>القرابة</th><th>التولّد</th><th>المهنة</th><th>الأجر الشهري</th><th>طلباته</th></tr>
          </thead>
          <tbody>
            {h.members.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => navigate(`/persons/${m.id}`)}>
                <td>
                  <span className="plain" style={{ fontWeight: 700 }}>{m.name}</span>
                  {m.is_head && <span className="badge blue" style={{ marginInlineStart: 8 }}>رب العائلة</span>}
                </td>
                <td>{RELATIONS[m.relation]}</td>
                <td className="num">{m.birth_year || '—'}</td>
                <td>{m.occupation || '—'}</td>
                <td className="num">{fmtMoney(m.monthly_wage)}</td>
                <td className="num">
                  {m.requests_count > 0
                    ? <span className="badge good">{m.requests_count} طلب</span>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {role === 'officer' && <NewPersonForm familyId={id} onCreated={load} />}
      </div>

      <div className="card">
        <h3 style={{ justifyContent: 'space-between' }}>
          طلبات هذه العائلة
          {role === 'officer' && (
            <button style={{ padding: '7px 16px', fontSize: 12.5 }}
                    onClick={() => navigate(`/requests/new?family=${id}`)}>
              ＋ تقديم طلب لهذه العائلة
            </button>
          )}
        </h3>
        <table>
          <thead>
            <tr><th>رقم الطلب</th><th>النوع</th><th>المستفيدون</th><th>التاريخ</th><th>الحالة</th><th>المصروف</th></tr>
          </thead>
          <tbody>
            {h.requests.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                <td className="num">طلب {r.request_no}</td>
                <td>{AID_TYPES[r.aid_type]}</td>
                <td>
                  {r.beneficiaries.map((b, i) => (
                    <span key={b.id}>
                      {i > 0 && '، '}
                      <Link className="plain" to={`/persons/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.name}</Link>
                    </span>
                  ))}
                </td>
                <td>{fmtDate(r.requested_at)}</td>
                <td>{statusBadge(r.status)}</td>
                <td className="num">{fmtMoney(r.disbursed_total)}</td>
              </tr>
            ))}
            {h.requests.length === 0 && <tr><td colSpan={6} className="empty">لا طلبات على هذا الملف</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
