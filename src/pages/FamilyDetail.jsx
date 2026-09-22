import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, RELATIONS, STATUSES, MARITAL_STATUS, maritalLabel, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function statusBadge(status) {
  const cls =
    status === 'rejected' ? 'bad'
    : ['decided', 'disbursing', 'disbursed', 'closed'].includes(status) ? 'good'
    : ['submitted', 'under_review'].includes(status) ? 'warn'
    : ''
  return <span className={`badge ${cls}`}>{STATUSES[status] || status}</span>
}

const WITH_CHILDREN_COUNTS = new Set(['married', 'divorced', 'widowed'])
function NewPersonForm({ familyId, onCreated }) {
  const blank = { name: '', relation: 'son', birth_year: '', marital_status: '',
    daughters_count: '', sons_count: '', occupation: '', monthly_wage: '', national_id: '' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const isChild = form.relation === 'son' || form.relation === 'daughter'
  const showCounts = isChild && WITH_CHILDREN_COUNTS.has(form.marital_status)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addPerson(familyId, {
        name: form.name, relation: form.relation,
        birth_year: form.birth_year ? Number(form.birth_year) : null,
        marital_status: form.marital_status || null,
        daughters_count: showCounts && form.daughters_count !== '' ? Number(form.daughters_count) : null,
        sons_count: showCounts && form.sons_count !== '' ? Number(form.sons_count) : null,
        occupation: form.occupation || null,
        monthly_wage: form.monthly_wage ? Number(form.monthly_wage) : null,
        national_id: form.national_id || null,
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
      {/* الحالة الاجتماعية للأبناء فقط، والعددان مع متزوج/مطلّق/أرمل */}
      {isChild && (
        <div className="field">
          <label>الحالة الاجتماعية</label>
          <select value={form.marital_status} onChange={set('marital_status')}>
            <option value="">— غير محدَّدة —</option>
            {Object.keys(MARITAL_STATUS).map((k) =>
              <option key={k} value={k}>{maritalLabel(k, form.relation)}</option>)}
          </select>
        </div>
      )}
      {showCounts && (
        <>
          <div className="field"><label>عدد البنات</label><input type="number" min="0" value={form.daughters_count} onChange={set('daughters_count')} /></div>
          <div className="field"><label>عدد الصبيان</label><input type="number" min="0" value={form.sons_count} onChange={set('sons_count')} /></div>
        </>
      )}
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
  const { role, isChairman } = useRole()
  const navigate = useNavigate()

  const [standing, setStanding] = useState([])
  const [headChange, setHeadChange] = useState(null)   // آخر تعديل هوية رب الأسرة (للتعليق)
  const [revoking, setRevoking] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(() => api.family(id).then(setH), [id])
  const loadStanding = useCallback(
    () => api.standingApprovals(id).then((r) => {
      setStanding(r.approvals || [])
      setHeadChange(r.head_identity_change || null)
    }).catch(() => {}), [id])
  useEffect(() => { load(); loadStanding() }, [load, loadStanding])

  if (!h) return <p className="empty">جارٍ التحميل…</p>

  // الاعتماد الفعّال واحد بحكم الفهرس الفريد الجزئي؛ الباقي تاريخ.
  // المعلّق فعّال لكنه ينتظر تأكيد المدير المسؤول.
  const active = standing.find((x) => !x.revoked_at)
  const suspended = active && active.suspended_at
  const history = standing.filter((x) => x.revoked_at)

  const revoke = async (sa) => {
    const reason = window.prompt('سبب سحب الاعتماد الدائم (إلزامي):')
    if (!reason || !reason.trim()) return
    setRevoking(sa.id)
    try {
      await api.revokeStandingApproval(sa.id, reason.trim())
      await loadStanding()
    } catch (e) { window.alert(e.message) }
    finally { setRevoking(null) }
  }

  const reconfirm = async (sa) => {
    if (!window.confirm('تأكيد أن هوية رب الأسرة الجديدة صحيحة، ورفع تعليق الاعتماد الدائم؟')) return
    setConfirming(true)
    try {
      await api.reconfirmStandingApproval(sa.id)
      await loadStanding()
    } catch (e) { window.alert(e.message) }
    finally { setConfirming(false) }
  }

  return (
    <>
      <h2>
        ملف {h.file_number} — عائلة {h.head_name}
        {active && (suspended
          ? <span className="standing-badge suspended" style={{ marginRight: 10 }}>اعتماد معلّق</span>
          : <span className="standing-badge" style={{ marginRight: 10 }}>معتمدة دائماً</span>)}
      </h2>
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

      {/* ═══ الاعتماد الدائم: الشروط + الطلب الأصلي + سجلّ المنح والسحب ═══
          الشروط معروضة نصاً لأن الموظف يحتاج أن يعرف **لماذا** مرّ طلب ولم يمرّ غيره. */}
      {(active || history.length > 0) && (
        <div className="card">
          <h3>الاعتماد الدائم</h3>
          {active ? (
            <>
              <p>
                <strong>{DECISION_TYPES[active.decision_type] || active.decision_type}</strong>
                {active.decision_type === 'percentage' && active.decision_value != null &&
                  <> — {Number(active.decision_value)}٪</>}
                {' · السقف لكل طلب: '}<strong>{fmtMoney(active.per_request_cap)}</strong>
                {active.review_date && <> · تاريخ إعادة النظر: {fmtDate(active.review_date)}</>}
              </p>
              <p className="hint">
                مُنح من الطلب رقم{' '}
                <Link to={`/requests/${active.source_request_id}`}>{active.source_request_no}</Link>
                {' '}بواسطة {active.granted_by_name || '—'} في {fmtDate(active.granted_at)}.
              </p>
              <p className="hint">
                يمرّ الطلب تلقائياً إذا: التزامه ضمن السقف، ولم يفت تاريخ إعادة النظر،
                ولا يتضمن عملية، ولا في ملف العائلة مشكلة بيانات حاجبة.
              </p>
              {/* ═══ معلّق: عُدّلت هوية رب الأسرة، بانتظار تأكيد المدير المسؤول ═══ */}
              {suspended && (
                <div className="warn-box" style={{ marginTop: 10 }}>
                  <strong>الاعتماد معلّق</strong> — {active.suspend_reason}
                  {headChange && (
                    <div style={{ marginTop: 6, fontSize: 13 }}>
                      {headChange.field === 'national_id' ? 'الرقم الوطني' : 'الاسم'}:{' '}
                      <span className="muted" style={{ textDecoration: 'line-through' }}>{headChange.old_value || '—'}</span>
                      {' ← '}<strong>{headChange.new_value || '—'}</strong>
                    </div>
                  )}
                  {isChairman
                    ? <button disabled={confirming} onClick={() => reconfirm(active)} style={{ marginTop: 8 }}>
                        {confirming ? 'جارٍ التأكيد…' : 'تأكيد الاعتماد'}
                      </button>
                    : <p className="hint" style={{ marginBottom: 0 }}>التأكيد من صلاحية المدير المسؤول.</p>}
                </div>
              )}
              {isChairman && (
                <button className="danger" disabled={revoking === active.id}
                        onClick={() => revoke(active)} style={{ marginTop: 10 }}>
                  {revoking === active.id ? 'جارٍ السحب…' : 'سحب الاعتماد'}
                </button>
              )}
            </>
          ) : <p className="empty">لا اعتماد فعّال — طلبات العائلة تمرّ بمراجعة المجلس</p>}

          {history.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                اعتمادات سابقة مسحوبة ({history.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                {history.map((x) => (
                  <div key={x.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>{DECISION_TYPES[x.decision_type] || x.decision_type}</strong>
                    {' · سقف '}{fmtMoney(x.per_request_cap)}
                    <div className="when">
                      مُنح {fmtDate(x.granted_at)} · سُحب {fmtDate(x.revoked_at)}
                      {x.revoked_by_name && <> بواسطة {x.revoked_by_name}</>}
                    </div>
                    <div className="rec">السبب: {x.revoke_reason}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

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
