import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, AID_TYPES, RELATIONS, SERVICE_UNITS, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import useDraft, { fmtDraftTime } from '../useDraft.js'

// صفحة تقديم طلب مساعدة جديد — يدعم ?family=<id> للقدوم من صفحة العائلة
export default function NewRequest() {
  const { role } = useRole()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [families, setFamilies] = useState([])
  const [familyId, setFamilyId] = useState(params.get('family') || '')
  const [members, setMembers] = useState([])
  const [selected, setSelected] = useState([])
  const [aidType, setAidType] = useState('treatment')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const fileInput = useRef(null)
  // الكلفة المتوقعة من الكتالوج
  const [catalog, setCatalog] = useState({ diseases: [], services: [] })
  const [diseaseId, setDiseaseId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [expectedCost, setExpectedCost] = useState('')
  const [costTouched, setCostTouched] = useState(false)

  useEffect(() => { api.families().then(setFamilies); api.catalog().then(setCatalog) }, [])
  useEffect(() => {
    if (familyId) api.family(familyId).then((h) => setMembers(h.members))
    else setMembers([])
  }, [familyId])

  // حفظ تلقائي للمسودة (الملفات لا تُحفظ — يعاد إرفاقها عند الاستعادة)
  const draftState = useMemo(
    () => ({ familyId, selected, aidType, description, diseaseId, serviceId, quantity, expectedCost, costTouched }),
    [familyId, selected, aidType, description, diseaseId, serviceId, quantity, expectedCost, costTouched])
  const { savedAt, restored, clearDraft } = useDraft(
    'draft:new-request',
    draftState,
    (d) => {
      setFamilyId(d.familyId || '')
      setSelected(d.selected || [])
      setAidType(d.aidType || 'treatment')
      setDescription(d.description || '')
      setDiseaseId(d.diseaseId || '')
      setServiceId(d.serviceId || '')
      setQuantity(d.quantity || 1)
      setExpectedCost(d.expectedCost || '')
      setCostTouched(d.costTouched || false)
    },
    (s) => !s.familyId && !s.description.trim() && s.selected.length === 0,
  )

  // اختيار عائلة مختلفة يُفرغ المستفيدين المحددين (وليس عند استعادة المسودة)
  const prevFamily = useRef(familyId)
  useEffect(() => {
    if (prevFamily.current && familyId !== prevFamily.current) setSelected([])
    prevFamily.current = familyId
  }, [familyId])

  const visibleServices = useMemo(
    () => catalog.services.filter((s) => s.is_active && (!diseaseId || String(s.disease_id) === diseaseId)),
    [catalog.services, diseaseId])
  const service = catalog.services.find((s) => String(s.id) === serviceId)

  // سعر × كمية تلقائياً ما لم يعدّل الموظف الكلفة يدوياً
  useEffect(() => {
    if (!costTouched)
      setExpectedCost(service ? String(Number(service.unit_price) * (Number(quantity) || 1)) : '')
  }, [service, quantity, costTouched])

  if (role !== 'officer') {
    return (
      <>
        <h2>تقديم طلب جديد</h2>
        <div className="card"><p className="empty">تقديم الطلبات من صلاحية موظف الإدخال فقط.</p></div>
      </>
    )
  }

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const addFiles = (e) => {
    setFiles((f) => [...f, ...Array.from(e.target.files || [])])
    e.target.value = ''
  }
  const removeFile = (i) => setFiles((f) => f.filter((_, idx) => idx !== i))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const created = await api.addRequest({
        family_id: Number(familyId),
        aid_type: aidType,
        description,
        beneficiary_ids: selected,
        ...(serviceId ? { service_id: Number(serviceId) } : {}),
        quantity: Number(quantity) || 1,
        ...(expectedCost ? { expected_cost: Number(expectedCost) } : {}),
      }, files)
      clearDraft()
      navigate(`/requests/${created.id}`)
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <>
      <h2>تقديم طلب مساعدة جديد</h2>
      <p className="subtitle">
        <Link className="plain" to="/requests">← عودة إلى الطلبات</Link>
        {' · '}يُحفظ النموذج تلقائياً كمسودة — الرجوع بالخطأ لا يُضيع شيئاً
      </p>

      {restored && (
        <div className="draft-bar">
          📝 استُعيدت مسودة محفوظة تلقائياً {savedAt && `(آخر حفظ ${fmtDraftTime(savedAt)})`} — لم يضِع شيء.
          {files.length === 0 && ' أعد إرفاق الملفات إن وُجدت (لا تُحفظ في المسودة).'}
          <button type="button" onClick={() => { clearDraft(); navigate(0) }}>تجاهل المسودة والبدء من جديد</button>
        </div>
      )}

      <form onSubmit={submit}>
        {/* ١ — بيانات الطلب */}
        <div className="card">
          <h3 style={{ justifyContent: 'space-between' }}>
            ١ · بيانات الطلب
            {savedAt && !restored && <span className="draft-saved">يُحفظ تلقائياً ✓ {fmtDraftTime(savedAt)}</span>}
          </h3>
          <div className="inline" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="field">
              <label>العائلة (الملف)</label>
              <select value={familyId} onChange={(e) => setFamilyId(e.target.value)} required autoFocus>
                <option value="">— اختر الملف —</option>
                {families.map((h) => (
                  <option key={h.id} value={h.id}>{h.file_number} — {h.head_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>نوع المساعدة</label>
              <select value={aidType} onChange={(e) => setAidType(e.target.value)}>
                {Object.entries(AID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 280 }}>
              <label>وصف الطلب</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="المريض مصاب بـ… / أرجو مساعدتي في…" required />
            </div>
          </div>
        </div>

        {/* ٢ — المستفيدون */}
        <div className="card">
          <h3>٢ · المستفيدون — فرد أو أكثر</h3>
          {!familyId && <p className="empty">اختر العائلة أولاً لعرض أفرادها</p>}
          {familyId && members.length === 0 && <p className="empty">لا أفراد مسجّلين على هذا الملف</p>}
          {members.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {members.map((m) => (
                <label key={m.id}
                       style={{
                         display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600,
                         padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                         border: `1.5px solid ${selected.includes(m.id) ? 'var(--teal-500)' : 'var(--grid)'}`,
                         background: selected.includes(m.id) ? 'var(--primary-soft)' : 'transparent',
                       }}>
                  <input type="checkbox" style={{ minWidth: 'auto' }}
                         checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                  {m.name}
                  <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({RELATIONS[m.relation]})</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ٣ — الكلفة المتوقعة */}
        <div className="card">
          <h3>٣ · الكلفة المتوقعة — من كتالوج الأسعار الطبية <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)' }}>(اختياري لكنه أساس حسابات الخزينة)</span></h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div className="field">
              <label>المرض</label>
              <select value={diseaseId} onChange={(e) => { setDiseaseId(e.target.value); setServiceId(''); setCostTouched(false) }}>
                <option value="">— الكل —</option>
                {catalog.diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>الخدمة (عملية / دواء / جلسة)</label>
              <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setCostTouched(false) }}>
                <option value="">— بدون خدمة من الكتالوج —</option>
                {visibleServices.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.unit_price)} / {SERVICE_UNITS[s.unit]}</option>
                ))}
              </select>
            </div>
            {service && service.unit !== 'once' && (
              <div className="field">
                <label>{service.unit === 'month' ? 'عدد الأشهر' : 'عدد الجلسات'}</label>
                <input type="number" min="1" style={{ width: 110, minWidth: 0 }} value={quantity}
                       onChange={(e) => { setQuantity(e.target.value); setCostTouched(false) }} />
              </div>
            )}
            <div className="field">
              <label>الكلفة المتوقعة (ل.س) — قابلة للتعديل</label>
              <input type="number" min="0" value={expectedCost}
                     onChange={(e) => { setExpectedCost(e.target.value); setCostTouched(true) }} />
            </div>
            {expectedCost && <span className="badge blue" style={{ marginBottom: 8 }}>≈ {fmtMoney(expectedCost)}</span>}
          </div>
        </div>

        {/* ٤ — المرفقات */}
        <div className="card">
          <h3>٤ · المرفقات — تقارير طبية، وصفات، فواتير</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="button" className="ghost" style={{ padding: '8px 16px', fontSize: 13 }}
                    onClick={() => fileInput.current?.click()}>
              📎 إضافة ملفات…
            </button>
            <input ref={fileInput} type="file" multiple accept="image/*,.pdf"
                   style={{ display: 'none' }} onChange={addFiles} />
            {files.map((f, i) => (
              <span key={i} className="file-chip">
                {f.name}
                <button type="button" onClick={() => removeFile(i)} title="إزالة">×</button>
              </span>
            ))}
            {files.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>لم تُضف ملفات بعد — تُرفع مع الطلب بعملية واحدة</span>}
          </div>
        </div>

        {/* التقديم */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 30 }}>
          <button type="submit" disabled={busy || !familyId || selected.length === 0} style={{ padding: '12px 32px', fontSize: 15 }}>
            {busy ? 'جارٍ التقديم…' : '✓ تقديم الطلب'}
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/requests')}>إلغاء</button>
          {!familyId && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>اختر العائلة للمتابعة</span>}
          {familyId && selected.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--status-pending)' }}>حدّد مستفيداً واحداً على الأقل</span>}
          {err && <span className="error" style={{ margin: 0 }}>{err}</span>}
        </div>
      </form>
    </>
  )
}
