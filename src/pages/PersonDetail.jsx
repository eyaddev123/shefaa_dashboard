import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, RELATIONS, STATUSES, MARITAL_STATUS, maritalLabel, fmtDate, fmtDateTime, fmtMoney } from '../api.js'
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

// الابن/الابنة وحدهما تُفرض عليهما الحالة الاجتماعية
const isChild = (relation) => relation === 'son' || relation === 'daughter'
const WITH_CHILDREN = new Set(['married', 'divorced', 'widowed'])

function EditForm({ person, onSaved, onCancel }) {
  const blank = {
    name: person.name || '', father_name: person.father_name || '', mother_name: person.mother_name || '',
    birth_year: person.birth_year || '', relation: person.relation,
    marital_status: person.marital_status || '', daughters_count: person.daughters_count ?? '',
    sons_count: person.sons_count ?? '', occupation: person.occupation || '',
    monthly_wage: person.monthly_wage ?? '', national_id: person.national_id || '', notes: person.notes || '',
  }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const child = isChild(form.relation)
  const showCounts = child && WITH_CHILDREN.has(form.marital_status)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const body = {
        version: person.version,
        name: form.name, father_name: form.father_name || null, mother_name: form.mother_name || null,
        birth_year: form.birth_year ? Number(form.birth_year) : null,
        relation: form.relation,
        marital_status: form.marital_status || null,
        daughters_count: showCounts && form.daughters_count !== '' ? Number(form.daughters_count) : null,
        sons_count: showCounts && form.sons_count !== '' ? Number(form.sons_count) : null,
        occupation: form.occupation || null,
        monthly_wage: form.monthly_wage !== '' ? Number(form.monthly_wage) : null,
        national_id: form.national_id || null, notes: form.notes || null,
      }
      const updated = await api.updatePerson(person.id, body)
      onSaved(updated)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>تعديل بيانات {person.name.split(' ')[0]}</h3>
      <div className="inline">
        <div className="field"><label>الاسم</label><input value={form.name} onChange={set('name')} required /></div>
        <div className="field"><label>اسم الأب</label><input value={form.father_name} onChange={set('father_name')} /></div>
        <div className="field"><label>اسم الأم</label><input value={form.mother_name} onChange={set('mother_name')} /></div>
        <div className="field"><label>سنة الميلاد</label><input type="number" value={form.birth_year} onChange={set('birth_year')} /></div>
      </div>
      <div className="inline">
        {/* العلاقة: تبديل ابن↔ابنة فقط لتصحيح الجنس. غيرهما معطّل (تغييره خارج النطاق). */}
        <div className="field">
          <label>العلاقة</label>
          {isChild(person.relation) ? (
            <select value={form.relation} onChange={set('relation')}>
              <option value="son">ابن</option>
              <option value="daughter">ابنة</option>
            </select>
          ) : (
            <input value={RELATIONS[form.relation] || form.relation} disabled title="لا يمكن تغيير العلاقة من هنا" />
          )}
        </div>
        {child && (
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
      </div>
      <div className="inline">
        <div className="field"><label>المهنة</label><input value={form.occupation} onChange={set('occupation')} /></div>
        <div className="field"><label>الدخل الشهري</label><input type="number" value={form.monthly_wage} onChange={set('monthly_wage')} /></div>
        <div className="field"><label>الرقم الوطني</label><input value={form.national_id} onChange={set('national_id')} dir="ltr" /></div>
      </div>
      <div className="field"><label>ملاحظات (٥٠٠ حرف كحدّ أقصى)</label>
        <textarea rows={2} maxLength={500} value={form.notes} onChange={set('notes')} /></div>
      {err && <p className="error">{err}</p>}
      <div className="inline" style={{ marginTop: 8 }}>
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديل'}</button>
        <button type="button" className="ghost" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  )
}

export default function PersonDetail() {
  const { id } = useParams()
  const [p, setP] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  const { role } = useRole()
  const readOnly = isReadOnly(role)

  const load = () => api.person(id).then(setP).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id])

  if (err) return <p className="error">{err}</p>
  if (!p) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>{p.name}</h2>
        {/* التعديل للموظف فقط — المدير والمشرف العام اطّلاع */}
        {!readOnly && !editing && (
          <button className="ghost" onClick={() => setEditing(true)}>تعديل البيانات</button>
        )}
      </div>
      <p className="subtitle">
        {RELATIONS[p.relation]} في عائلة{' '}
        <Link className="plain" to={`/families/${p.family_id}`}>{p.head_name} (ملف {p.file_number})</Link>
        {p.birth_year && <> · مواليد {p.birth_year}</>}
        {p.occupation && <> · {p.occupation}</>}
        {/* الحالة الاجتماعية بجنس الفرد */}
        {isChild(p.relation) && (
          <> · {p.marital_status
            ? maritalLabel(p.marital_status, p.relation)
            : <span className="badge">غير محدَّد</span>}
            {WITH_CHILDREN.has(p.marital_status) && (p.daughters_count != null || p.sons_count != null) &&
              <> — {p.daughters_count ?? 0} بنات، {p.sons_count ?? 0} صبيان</>}
          </>
        )}
        {p.is_head && <> · <span className="badge blue">رب العائلة</span></>}
      </p>
      {p.notes && <p className="note-line">📝 {p.notes}</p>}

      {editing && (
        <EditForm person={p} onCancel={() => setEditing(false)}
          onSaved={(u) => {
            setEditing(false)
            load()
            if (u.standing_suspended) window.alert('عُدّلت هوية رب الأسرة — عُلّق الاعتماد الدائم بانتظار تأكيد المدير المسؤول.')
          }} />
      )}

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

      {/* سجل التعديلات على بيانات هذا الفرد — أثر لا منع */}
      {p.edit_history?.length > 0 && (
        <div className="card">
          <h3>سجل التعديلات ({p.edit_history.length})</h3>
          <table>
            <thead><tr><th>الحقل</th><th>القيمة السابقة</th><th>القيمة الجديدة</th><th>مَن</th><th>متى</th></tr></thead>
            <tbody>
              {p.edit_history.map((h) => (
                <tr key={h.id}>
                  <td>{FIELD_LABELS[h.field] || h.field}</td>
                  <td className="muted">{h.old_value ?? '—'}</td>
                  <td>{h.new_value ?? '—'}</td>
                  <td>{h.changed_by_name || '—'}</td>
                  <td>{fmtDateTime(h.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// أسماء الحقول العربية لسجل التعديلات
const FIELD_LABELS = {
  name: 'الاسم', father_name: 'اسم الأب', mother_name: 'اسم الأم', birth_year: 'سنة الميلاد',
  relation: 'العلاقة', marital_status: 'الحالة الاجتماعية', daughters_count: 'عدد البنات',
  sons_count: 'عدد الصبيان', occupation: 'المهنة', monthly_wage: 'الدخل الشهري',
  national_id: 'الرقم الوطني', notes: 'ملاحظات',
}
