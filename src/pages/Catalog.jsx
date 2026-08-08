import { useEffect, useState } from 'react'
import { api, DISEASE_CATEGORIES, SERVICE_TYPES, SERVICE_UNITS, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'

function NewDiseaseForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', category: 'chronic' })
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try { await api.addDisease(form); setForm({ name: '', category: 'chronic' }); onCreated() }
    catch (ex) { setErr(ex.message) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field"><label>اسم المرض</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
      <div className="field">
        <label>التصنيف</label>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {Object.entries(DISEASE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <button type="submit">إضافة مرض</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function NewServiceForm({ diseases, onCreated }) {
  const blank = { disease_id: '', service_type: 'surgery', name: '', unit_price: '', unit: 'once' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addService({ ...form, disease_id: form.disease_id || null, unit_price: Number(form.unit_price) })
      setForm(blank); onCreated()
    } catch (ex) { setErr(ex.message) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field">
        <label>المرض (اختياري)</label>
        <select value={form.disease_id} onChange={set('disease_id')}>
          <option value="">— عام —</option>
          {diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>النوع</label>
        <select value={form.service_type} onChange={set('service_type')}>
          {Object.entries(SERVICE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label>اسم الخدمة</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="field"><label>السعر (ل.س)</label><input type="number" min="1" value={form.unit_price} onChange={set('unit_price')} required /></div>
      <div className="field">
        <label>الوحدة</label>
        <select value={form.unit} onChange={set('unit')}>
          {Object.entries(SERVICE_UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <button type="submit">إضافة خدمة</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function PriceCell({ service, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState(service.unit_price)
  if (!canEdit) return <span className="num">{fmtMoney(service.unit_price)}</span>
  if (!editing)
    return (
      <span className="num">
        {fmtMoney(service.unit_price)}{' '}
        <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setEditing(true)}>تعديل</button>
      </span>
    )
  const save = async () => {
    try { await api.updateService(service.id, { unit_price: Number(price) }); setEditing(false); onSaved() }
    catch (ex) { alert(ex.message) }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input type="number" style={{ width: 120, minWidth: 0, padding: '4px 8px' }} value={price} onChange={(e) => setPrice(e.target.value)} />
      <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={save}>حفظ</button>
    </span>
  )
}

export default function Catalog() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const { role } = useRole()
  const canEdit = role === 'accountant'

  const load = () => api.catalog().then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>

  const toggleActive = async (s) => {
    try { await api.updateService(s.id, { is_active: !s.is_active }); load() }
    catch (ex) { alert(ex.message) }
  }

  return (
    <>
      <h2>الأسعار الطبية — الكتالوج</h2>
      <p className="subtitle">
        الأمراض والخدمات المسعّرة التي تُبنى عليها الكلفة المتوقعة للطلبات.
        تعديل سعر هنا لا يغيّر الطلبات القديمة — كلفتها محفوظة كنسخة ثابتة.
      </p>

      <div className="card">
        <h3>الخدمات المسعّرة ({data.services.length})</h3>
        {canEdit && <NewServiceForm diseases={data.diseases} onCreated={load} />}
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>الخدمة</th><th>النوع</th><th>المرض</th><th>السعر المعياري</th><th>الوحدة</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {data.services.map((s) => (
              <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.5 }}>
                <td>{s.name}</td>
                <td><span className="badge">{SERVICE_TYPES[s.service_type]}</span></td>
                <td>{s.disease_name || <span style={{ color: 'var(--muted)' }}>عام</span>}</td>
                <td><PriceCell service={s} canEdit={canEdit} onSaved={load} /></td>
                <td>{SERVICE_UNITS[s.unit]}</td>
                <td>
                  {canEdit
                    ? <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => toggleActive(s)}>
                        {s.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                    : (s.is_active ? <span className="badge good">فعّالة</span> : <span className="badge">موقوفة</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>الأمراض ({data.diseases.length})</h3>
        {canEdit && <NewDiseaseForm onCreated={load} />}
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>المرض</th><th>التصنيف</th><th>عدد الخدمات المرتبطة</th></tr></thead>
          <tbody>
            {data.diseases.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.category ? <span className="badge">{DISEASE_CATEGORIES[d.category]}</span> : '—'}</td>
                <td className="num">{data.services.filter((s) => s.disease_id === d.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
