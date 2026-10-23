import { useEffect, useState } from 'react'
import { useDialogs } from '../dialogs.jsx'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { matchesAr } from '../arabic-search.js'

// ═══ كتالوج المواد ═══
// اسم ووحدة وسعر وحدة. منفصلٌ عن الإجراءات تماماً: لا وصفات ولا قوائم مواد لكل
// إجراء — الاستقبال يختار من الكتالوج كلّه ما استُعمل فعلاً.
// تعديل السعر يسري على ما يُضاف بعده فقط، والتعطيل يُخفي المادة من بحث الاستقبال
// ولا يمسّ سطراً قائماً. لا حذف.

// اقتراحاتٌ لا قائمة مغلقة: «أمبولة» و«زوج» و«متر» كلّها واردة
const UNIT_SUGGESTIONS = ['قطعة', 'علبة', 'أمبولة', 'كيس', 'متر', 'زوج', 'لفّة', 'عبوة']

function UnitInput({ id, value, onChange }) {
  return (
    <>
      <input id={id} value={value} list="material-units" maxLength={30} placeholder="قطعة، علبة…"
        onChange={(e) => onChange(e.target.value)} required style={{ width: 120 }} />
      <datalist id="material-units">
        {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
      </datalist>
    </>
  )
}

function NewMaterialForm({ onCreated }) {
  const blank = { name: '', unit: '', unit_price: '' }
  const [form, setForm] = useState(blank)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      await api.clinic.addMaterial(form)
      onCreated(form.name.trim()); setForm(blank)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field"><label htmlFor="new-mat-name">اسم المادة</label>
        <input id="new-mat-name" value={form.name} maxLength={150} placeholder="مثال: جبس" required
          onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="new-mat-unit">الوحدة</label>
        <UnitInput id="new-mat-unit" value={form.unit} onChange={(unit) => setForm({ ...form, unit })} /></div>
      {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
      <div className="field"><label htmlFor="new-mat-price">سعر الوحدة (ل.س)</label>
        <input id="new-mat-price" value={form.unit_price} inputMode="decimal" placeholder="0" required
          style={{ width: 130 }} onChange={(e) => setForm({ ...form, unit_price: toLatinDigits(e.target.value) })} /></div>
      <button type="submit" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة مادة'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function EditMaterialRow({ m, onSaved, onCancel }) {
  const dlg = useDialogs()
  const [name, setName] = useState(m.name)
  const [unit, setUnit] = useState(m.unit)
  const [price, setPrice] = useState(String(Number(m.unit_price)))
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const body = {}
    if (name.trim() !== m.name) body.name = name
    if (unit.trim() !== m.unit) body.unit = unit
    if (Number(price) !== Number(m.unit_price) || price.trim() === '') body.unit_price = price
    if (Object.keys(body).length === 0) return onCancel()
    if (body.unit_price !== undefined) {
      const ok = await dlg.confirm({
        title: 'تغيير سعر المادة',
        body: `تغيير سعر «${m.name}» من ${fmtMoney(m.unit_price)} إلى ${fmtMoney(price)}؟\n`
          + 'يسري على ما يُضاف بعد الحفظ فقط — الإجراءات المسجّلة تبقى بسعرها.',
        confirmLabel: 'غيّر السعر',
      })
      if (!ok) return
    }
    setErr(null); setBusy(true)
    try { await api.clinic.updateMaterial(m.id, body); onSaved() }
    catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <tr className="proc-editing">
      <td><input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} aria-label="اسم المادة" /></td>
      <td><UnitInput value={unit} onChange={setUnit} /></td>
      <td><input value={price} inputMode="decimal" style={{ width: 120 }} aria-label="سعر الوحدة"
        onChange={(e) => setPrice(toLatinDigits(e.target.value))} /></td>
      <td colSpan={4}>
        <div className="inline" style={{ gap: 6 }}>
          <button onClick={save} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>حفظ</button>
          <button className="ghost" onClick={onCancel} style={{ padding: '4px 12px', fontSize: 12 }}>إلغاء</button>
        </div>
        {err && <p className="error" style={{ margin: '6px 0 0' }}>{err}</p>}
      </td>
    </tr>
  )
}

export default function MaterialsCatalog({ canEdit, showToast }) {
  const dlg = useDialogs()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)
  const [query, setQuery] = useState('')

  const load = () => api.clinic.materials().then((r) => { setList(r); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const toggleActive = async (m) => {
    if (m.is_active) {
      const ok = await dlg.confirm({
        title: 'تعطيل المادة',
        body: `تعطيل «${m.name}»؟\nتختفي من بحث الاستقبال فلا تُضاف لإجراءٍ جديد،\nوالإجراءات المسجّلة التي استعملتها تبقى كما هي تماماً.`,
        confirmLabel: 'تعطيل', danger: true,
      })
      if (!ok) return
    }
    try {
      await api.clinic.updateMaterial(m.id, { is_active: !m.is_active })
      showToast(m.is_active ? `عُطّلت «${m.name}»` : `فُعّلت «${m.name}»`, 'success', 3000); load()
    } catch (ex) { showToast(ex.message) }
  }

  if (err && !list) return <p className="error">{err}</p>
  if (!list) return <p className="empty">جارٍ التحميل…</p>

  const shown = list.filter((m) => matchesAr(m.name, query))
  const active = list.filter((m) => m.is_active).length
  return (
    <div className="card">
      <h3>كتالوج المواد ({list.length} — المفعَّل {active})</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        الاستقبال يختار منها ما استُعمل في كل إجراء بكمّيته (ويراها بلا أسعار). لا ربط بين المواد والإجراءات.
      </p>
      {canEdit
        ? <NewMaterialForm onCreated={(name) => { showToast(`أُضيفت «${name}»`, 'success', 3000); load() }} />
        : <p className="subtitle">للاطّلاع فقط — يديره مسؤول العيادات.</p>}
      <input type="search" value={query} placeholder="ابحث في المواد…" aria-label="ابحث في المواد"
        onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320, marginTop: 14 }} />
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr><th>المادة</th><th>الوحدة</th><th>سعر الوحدة</th><th>الحالة</th><th>استُعملت</th><th>آخر تعديل</th>{canEdit && <th></th>}</tr>
        </thead>
        <tbody>
          {shown.map((m) => editing === m.id ? (
            <EditMaterialRow key={m.id} m={m} onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); showToast('حُفظ التعديل', 'success', 3000); load() }} />
          ) : (
            <tr key={m.id} className={m.is_active ? undefined : 'proc-inactive'}>
              <td>{m.name}</td>
              <td>{m.unit}</td>
              <td className="num">{fmtMoney(m.unit_price)}</td>
              <td>{m.is_active ? <span className="badge good">مفعَّلة</span> : <span className="badge">معطَّلة</span>}</td>
              <td className="num">{m.times_used} إجراء</td>
              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {m.updated_by_name || m.created_by_name || '—'}
                {(m.updated_at || m.created_at) && (
                  <span dir="ltr" style={{ marginInlineStart: 6 }}>
                    {new Date(m.updated_at || m.created_at).toLocaleDateString('en-CA')}
                  </span>
                )}
              </td>
              {canEdit && (
                <td>
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    onClick={() => setEditing(m.id)}>تعديل</button>{' '}
                  <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                    onClick={() => toggleActive(m)}>{m.is_active ? 'تعطيل' : 'تفعيل'}</button>
                </td>
              )}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={canEdit ? 7 : 6} className="empty">
              {list.length === 0 ? `لا مواد بعد${canEdit ? ' — أضف أولها أعلاه' : ''}` : 'لا مادة بهذا الاسم.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
