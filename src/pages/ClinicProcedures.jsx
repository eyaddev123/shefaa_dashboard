import { useEffect, useState } from 'react'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'

// ═══ العيادات — الإجراءات ═══
// كتالوج عام لكل الدكاترة: اسم وسعر، بلا كمية. مسؤول العيادات يضيف ويعدّل ويعطّل —
// ولا حذف (الحجوزات تشير إليه). تعديل السعر يسري على ما يُضاف بعده فقط: كل حجز
// يحمل نسخة السعر لحظة إضافته. المجلس والمشرف العام والمدير يطالعون فقط.

function NewProcedureForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', price: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      await api.clinic.addProcedure({ name: form.name, price: form.price })
      setForm({ name: '', price: '' }); onCreated(form.name.trim())
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field"><label htmlFor="new-proc-name">اسم الإجراء</label>
        <input id="new-proc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150}
          placeholder="مثال: تخطيط قلب" required /></div>
      {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
      <div className="field"><label htmlFor="new-proc-price">السعر (ل.س)</label>
        <input id="new-proc-price" value={form.price} inputMode="decimal" placeholder="0"
          onChange={(e) => setForm({ ...form, price: toLatinDigits(e.target.value) })} required /></div>
      <button type="submit" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة إجراء'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// تعديل الاسم والسعر في الصفّ نفسه
function EditRow({ proc, onSaved, onCancel }) {
  const [name, setName] = useState(proc.name)
  const [price, setPrice] = useState(String(Number(proc.price)))
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const body = {}
    if (name.trim() !== proc.name) body.name = name
    if (Number(price) !== Number(proc.price) || price.trim() === '') body.price = price
    if (Object.keys(body).length === 0) return onCancel()
    if (body.price !== undefined && !confirm(
      `تغيير سعر «${proc.name}» من ${fmtMoney(proc.price)} إلى ${fmtMoney(price)}؟\n` +
      'يسري على ما يُضاف بعد الحفظ فقط — ما أُضيف لحجوزات سابقة يبقى بسعره.')) return
    setErr(null); setBusy(true)
    try { await api.clinic.updateProcedure(proc.id, body); onSaved() }
    catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <tr className="proc-editing">
      <td><input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} aria-label="اسم الإجراء" /></td>
      <td><input value={price} inputMode="decimal" style={{ width: 130 }} aria-label="السعر"
        onChange={(e) => setPrice(toLatinDigits(e.target.value))} /></td>
      <td colSpan={3}>
        <div className="inline" style={{ gap: 6 }}>
          <button onClick={save} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>حفظ</button>
          <button className="ghost" onClick={onCancel} style={{ padding: '4px 12px', fontSize: 12 }}>إلغاء</button>
        </div>
        {err && <p className="error" style={{ margin: '6px 0 0' }}>{err}</p>}
      </td>
    </tr>
  )
}

export default function ClinicProcedures() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)
  const [toast, showToast] = useToast()
  const { role } = useRole()
  const canEdit = role === 'clinic_admin'

  const load = () => api.clinic.procedures().then((r) => { setList(r); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const toggleActive = async (p) => {
    if (p.is_active && !confirm(`تعطيل «${p.name}»؟\nلا يُضاف بعدها لأي حجز، وما أُضيف سابقاً يبقى كما هو.`)) return
    try {
      await api.clinic.updateProcedure(p.id, { is_active: !p.is_active })
      showToast(p.is_active ? `عُطّل «${p.name}»` : `فُعّل «${p.name}»`, 'success', 3000); load()
    } catch (ex) { showToast(ex.message) }
  }

  if (err && !list) return <p className="error">{err}</p>
  if (!list) return <p className="empty">جارٍ التحميل…</p>

  const active = list.filter((p) => p.is_active).length
  return (
    <>
      <h2>العيادات — الإجراءات</h2>
      <p className="subtitle">
        إجراءات تُضاف على الحجز بعد دخول المريض على الطبيب (تخطيط، تضميد، حقنة…)، لكل الدكاترة.
        <strong> تعديل السعر يسري على ما يُضاف بعده فقط</strong> — كل حجز يحمل سعره لحظة الإضافة.
        لا حذف: الإجراء المُستغنى عنه يُعطَّل.
      </p>
      {toast}

      <div className="card">
        <h3>الكتالوج ({list.length} — المفعَّل {active})</h3>
        {canEdit
          ? <NewProcedureForm onCreated={(name) => { showToast(`أُضيف «${name}»`, 'success', 3000); load() }} />
          : <p className="subtitle" style={{ marginTop: -6 }}>للاطّلاع فقط — يديره مسؤول العيادات.</p>}
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>الإجراء</th><th>السعر الحالي</th><th>الحالة</th><th>استُعمل</th><th>آخر تعديل</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {list.map((p) => editing === p.id ? (
              <EditRow key={p.id} proc={p} onCancel={() => setEditing(null)}
                onSaved={() => { setEditing(null); showToast('حُفظ التعديل', 'success', 3000); load() }} />
            ) : (
              <tr key={p.id} className={p.is_active ? undefined : 'proc-inactive'}>
                <td>{p.name}</td>
                <td className="num">{fmtMoney(p.price)}</td>
                <td>{p.is_active ? <span className="badge good">مفعَّل</span> : <span className="badge">معطَّل</span>}</td>
                <td className="num">{p.times_used} حجز</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.updated_by_name || p.created_by_name || '—'}
                  {(p.updated_at || p.created_at) && (
                    <span dir="ltr" style={{ marginInlineStart: 6 }}>
                      {new Date(p.updated_at || p.created_at).toLocaleDateString('en-CA')}
                    </span>
                  )}
                </td>
                {canEdit && (
                  <td>
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => setEditing(p.id)}>تعديل</button>{' '}
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => toggleActive(p)}>{p.is_active ? 'تعطيل' : 'تفعيل'}</button>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} className="empty">لا إجراءات بعد{canEdit ? ' — أضف أولها أعلاه' : ''}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
