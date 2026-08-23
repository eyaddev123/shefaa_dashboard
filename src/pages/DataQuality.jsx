import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useRole } from '../RoleContext.jsx'

// شاشة مراجعة البيانات المستوردة من الأرشيف الورقي.
// الأرشيف ناقص ومتضارب، فاستُورد كما هو ومعه وسمٌ لكل مشكلة. هنا يصفّي
// الموظف على نوع المشكلة، يصلح الحقل، ويشطب الوسم — حتى تنظف القاعدة.

const SCOPES = {
  family:  { label: 'العائلات', path: 'families' },
  person:  { label: 'الأفراد',  path: 'persons' },
  request: { label: 'الطلبات',  path: 'requests' },
}
const SEVERITY = {
  block: { label: 'مانعة',  cls: 'bad'  },
  warn:  { label: 'تحذير',  cls: 'warn' },
  info:  { label: 'للعلم',  cls: 'blue' },
}

// الحقول القابلة للتعديل لكل نطاق — تطابق القائمة البيضاء في الخادم
const FIELDS = {
  family: [
    ['file_number', 'رقم الملف'], ['head_name', 'رب العائلة'],
    ['applicant_name', 'مقدم الطلب'], ['current_address', 'العنوان'],
    ['mobile', 'الجوال'], ['phone', 'هاتف آخر'], ['opened_at', 'تاريخ الفتح'],
    ['family_card_no', 'رقم البطاقة العائلية'], ['notes', 'ملاحظات'],
  ],
  person: [
    ['name', 'الاسم'], ['relation', 'صلة القرابة'], ['birth_year', 'سنة الميلاد'],
    ['national_id', 'الرقم الوطني'], ['occupation', 'المهنة'], ['notes', 'ملاحظات'],
  ],
  request: [
    ['description', 'الوصف'], ['aid_type', 'نوع المساعدة'],
    ['expected_cost', 'الكلفة المتوقعة'], ['decision_type', 'نوع القرار'],
    ['decision_value', 'قيمة القرار'], ['requested_at', 'تاريخ الطلب'],
  ],
}
const RELATIONS = { head: 'رب الأسرة', wife_1: 'زوجة', wife_2: 'زوجة ثانية', son: 'ابن', daughter: 'ابنة', father: 'أب', mother: 'أم', other: 'غير محدد' }
const AID_TYPES = { treatment: 'علاج', medicine: 'دواء', surgery: 'عملية', medical_equipment: 'تجهيزات طبية', financial: 'مالية', housing: 'سكن', other: 'أخرى' }
const DECISIONS = { full_approval: 'موافقة كاملة', percentage: 'نسبة', fixed_amount: 'مبلغ مقطوع', exemption: 'إعفاء', rejected: 'رفض', postponed: 'تأجيل' }

// محرّر سجل واحد: يعرض مشاكله، ويتيح تصحيح الحقول وشطب ما عولج
function RecordEditor({ scope, row, dict, onDone, canEdit }) {
  const [fields, setFields] = useState({})
  const [cleared, setCleared] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }))
  // القيمة الحالية كما تُحرَّر: التاريخ يُقصّ إلى YYYY-MM-DD، والفارغ نص فارغ
  const current = (k) => {
    const v = row[k]
    if (v == null) return ''
    return /_at$/.test(k) && typeof v === 'string' ? v.slice(0, 10) : String(v)
  }
  const toggle = (code) =>
    setCleared((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]))

  const save = async (resolveAll = false) => {
    setBusy(true); setErr(null)
    try {
      await api.dqFix(scope, row.id, {
        fields, clear_codes: cleared, resolve_all: resolveAll,
      })
      onDone()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const options = { relation: RELATIONS, aid_type: AID_TYPES, decision_type: DECISIONS }

  return (
    <tr>
      <td colSpan={5} style={{ background: 'var(--surface-2, rgba(0,0,0,.02))', padding: 18 }}>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(280px,1fr) minmax(280px,1fr)' }}>
          <div>
            <strong style={{ display: 'block', marginBottom: 8 }}>المشاكل المسجَّلة</strong>
            {row.data_issues.map((iss, i) => {
              const meta = dict[iss.code] || {}
              const done = cleared.includes(iss.code)
              return (
                <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                        marginBottom: 10, opacity: done ? 0.5 : 1, cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={done} disabled={!canEdit}
                         onChange={() => toggle(iss.code)} style={{ marginTop: 4 }} />
                  <span>
                    <span className={`badge ${SEVERITY[iss.severity]?.cls || 'blue'}`}>
                      {meta.label_ar || iss.code}
                    </span>
                    <span style={{ display: 'block', marginTop: 4 }}>{iss.message}</span>
                    {/* الرسالة الخاصة بالسجل تحمل التفصيل، والتلميح العام يكرّرها غالباً.
                        فلا يُعرض إلا إن أضاف شيئاً — يُقارن بذيل الرسالة بعد الشرطة. */}
                    {meta.hint_ar && !iss.message.includes(meta.hint_ar)
                      && !meta.hint_ar.includes(iss.message.split('—').pop().trim()) && (
                      <span className="subtitle" style={{ display: 'block', fontSize: 13 }}>{meta.hint_ar}</span>
                    )}
                  </span>
                </label>
              )
            })}
            <p className="subtitle" style={{ fontSize: 13 }}>
              المصدر: {row.source_ref || '—'} — علّم المشكلة بعد إصلاحها لتُشطب.
            </p>
          </div>

          <div>
            <strong style={{ display: 'block', marginBottom: 8 }}>تصحيح الحقول</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
              {FIELDS[scope].map(([k, label]) => (
                <div className="field" key={k}>
                  {/* القيمة الحالية تظهر في الخانة نفسها — لا يحرّر الموظف على
                      العمياء، ويرى فوراً إن كتب في الحقل الخطأ. */}
                  <label>{label}</label>
                  {options[k] ? (
                    <select value={fields[k] ?? row[k] ?? ''} onChange={set(k)} disabled={!canEdit}>
                      <option value="">— غير محدد —</option>
                      {Object.entries(options[k]).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  ) : (
                    <input value={fields[k] ?? current(k)} onChange={set(k)} disabled={!canEdit}
                           placeholder="فارغ" />
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button onClick={() => save(false)} disabled={busy || (!cleared.length && !Object.keys(fields).length)}>
                  حفظ التصحيح
                </button>
                <button onClick={() => save(true)} disabled={busy} className="secondary">
                  إعلان السجل نظيفاً
                </button>
              </div>
            )}
            {err && <p className="error">{err}</p>}
          </div>
        </div>
      </td>
    </tr>
  )
}

export default function DataQuality() {
  const { role } = useRole()
  const navigate = useNavigate()
  const canEdit = role === 'officer'

  const [summary, setSummary] = useState(null)
  const [scope, setScope] = useState('family')
  const [code, setCode] = useState('')
  const [severity, setSeverity] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState({ rows: [], total: 0 })
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadSummary = () => api.dqSummary().then(setSummary)
  useEffect(() => { loadSummary() }, [])

  const load = () => {
    setLoading(true)
    api.dqRecords({ scope, code, severity, q, limit: 100 })
      .then(setData).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [scope, code, severity, q])

  // قاموس الأكواد: كود ← {label_ar, hint_ar}
  const dict = useMemo(() => Object.fromEntries(
    (summary?.dictionary || []).map((d) => [d.code, d])), [summary])

  // أكواد هذا النطاق مع أعدادها، الأكثر أولاً.
  // الكود الواحد قد يرد بخطورتين (bad_phone تحذيراً ومعلومةً حسب شدّة العطب)،
  // فيُجمع هنا في سطر واحد كي لا يتكرر في القائمة.
  const codes = useMemo(() => {
    const byCode = new Map()
    for (const c of summary?.scopes?.[scope]?.codes || [])
      byCode.set(c.code, (byCode.get(c.code) || 0) + c.n)
    return [...byCode].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n)
  }, [summary, scope])

  const refresh = () => { setOpen(null); load(); loadSummary() }

  return (
    <>
      <div>
        <h2>مراجعة البيانات — الأرشيف المستورد</h2>
        <p className="subtitle">
          كل سجل استُورد من الأرشيف الورقي ومعه وسمٌ بما نقص أو تضارب فيه.
          صفِّ على المشكلة، صحّح الحقل، ثم اشطب الوسم — حتى تنظف القاعدة.
        </p>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginBottom: 4 }}>
          {Object.entries(SCOPES).map(([k, s]) => {
            const st = summary.scopes[k] || {}
            const pct = st.total ? Math.round(((st.total - st.flagged) / st.total) * 100) : 100
            return (
              <div className="card" key={k} onClick={() => { setScope(k); setCode(''); setSeverity('') }}
                   style={{ cursor: 'pointer', borderColor: scope === k ? 'var(--accent)' : undefined }}>
                <strong>{s.label}</strong>
                <p style={{ fontSize: 26, margin: '6px 0 2px' }}>{st.flagged ?? 0}</p>
                <p className="subtitle" style={{ margin: 0 }}>
                  سجلاً يحتاج مراجعة من {st.total ?? 0} — نظيف {pct}%
                </p>
              </div>
            )
          })}
        </div>
      )}

      <div className="card">
        <div className="table-filter" style={{ flexWrap: 'wrap', gap: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="تصفية بالاسم أو مرجع الصف في الإكسل…" style={{ minWidth: 240 }} />
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">كل الخطورات</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={code} onChange={(e) => setCode(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">كل المشاكل</option>
            {codes.map((c) => (
              <option key={c.code} value={c.code}>
                {(dict[c.code]?.label_ar || c.code)} ({c.n})
              </option>
            ))}
          </select>
          <span className="count">{data.total} سجلاً</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>رقم الملف</th><th>الاسم / الوصف</th><th>المشاكل</th>
              <th>المصدر</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="clickable"
                    onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="num">{r.file_number || '—'}</td>
                  <td>{r.title?.length > 70 ? `${r.title.slice(0, 70)}…` : (r.title || '—')}</td>
                  <td>
                    {[...new Set(r.data_issues.map((i) => i.severity))].map((sev) => (
                      <span key={sev} className={`badge ${SEVERITY[sev]?.cls || 'blue'}`}
                            style={{ marginInlineEnd: 4 }}>
                        {r.data_issues.filter((i) => i.severity === sev).length} {SEVERITY[sev]?.label}
                      </span>
                    ))}
                  </td>
                  <td className="subtitle" style={{ fontSize: 12 }}>{r.source_ref || '—'}</td>
                  <td>
                    {scope !== 'family' && r.family_id && (
                      <button className="secondary" onClick={(e) => { e.stopPropagation(); navigate(`/families/${r.family_id}`) }}>
                        الملف
                      </button>
                    )}
                    {scope === 'family' && (
                      <button className="secondary" onClick={(e) => { e.stopPropagation(); navigate(`/families/${r.id}`) }}>
                        الملف
                      </button>
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <RecordEditor scope={scope} row={r} dict={dict} canEdit={canEdit} onDone={refresh} />
                )}
              </Fragment>
            ))}
            {!loading && data.rows.length === 0 && (
              <tr><td colSpan={5} className="empty">لا سجلات مطابقة — البيانات نظيفة بهذا المرشّح</td></tr>
            )}
            {loading && <tr><td colSpan={5} className="empty">…جارٍ التحميل</td></tr>}
          </tbody>
        </table>
        {data.total > data.rows.length && (
          <p className="subtitle" style={{ padding: '10px 16px' }}>
            يُعرض أول {data.rows.length} من {data.total} — ضيّق التصفية لرؤية البقية.
          </p>
        )}
      </div>
    </>
  )
}
