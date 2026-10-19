import { useEffect, useState } from 'react'
import { ProcedureSpecialties } from '../SpecialtyPicker.jsx'
import { useDialogs } from '../dialogs.jsx'
import { api, fmtMoney, toLatinDigits, todayLocal } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'

// ═══ العيادات — الإجراءات ═══
// كتالوج عام لكل الدكاترة: اسم وسعر، بلا كمية. مسؤول العيادات يضيف ويعدّل ويعطّل —
// ولا حذف (الحجوزات تشير إليه). تعديل السعر يسري على ما يُضاف بعده فقط: كل حجز
// يحمل نسخة السعر لحظة إضافته. المجلس والمشرف العام والمدير يطالعون فقط.

// من يرى تبويب التسوية — يطابق SETTLEMENT_VIEWERS في الخادم.
// الاستقبال غائبٌ عمداً: يستوفي السعر، ولا شأن له بتقسيمه بعد ذلك.
const SETTLEMENT_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']

function NewProcedureForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', price: '', materials: '' })
  // «عام» افتراضاً: إجراءٌ جديد يظهر للجميع حتى يُسنده المشرف — لا يختفي بصمت
  const [spec, setSpec] = useState({ isGeneral: true, specialtyIds: [] })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const created = await api.clinic.addProcedure({ name: form.name, price: form.price,
        // كلفة المواد اختيارية: إن ضُبطت صارت أسطر هذا الإجراء تُسوّى تلقائياً
        default_materials_cost: form.materials === '' ? null : form.materials })
      // الإنشاء يُولّد الإجراء «عامّاً» (قيمة العمود الافتراضية)، والاختصاصات
      // تُضبط بمسارها الذرّيّ. فلا نناديه إلا إن اختار المشرف غير الافتراضي —
      // وإخفاقه لا يُضيّع الإجراء: نقول إنّه أُنشئ عامّاً ليُسنده من الجدول.
      if (!spec.isGeneral && created?.id) {
        try {
          await api.clinic.setProcedureSpecialties(created.id,
            { is_general: false, specialty_ids: spec.specialtyIds.map(Number) })
        } catch (ex) {
          setErr(`أُنشئ «${form.name.trim()}» لكن تعذّر إسناد الاختصاصات (${ex.message}) — أسنِدها من الجدول.`)
        }
      }
      setForm({ name: '', price: '', materials: '' })
      setSpec({ isGeneral: true, specialtyIds: [] })
      onCreated(form.name.trim())
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
      {/* كلفة المواد اختيارية — إن ضُبطت سُوّيت أسطر هذا الإجراء تلقائياً */}
      <div className="field"><label htmlFor="new-proc-mat">كلفة المواد (اختياري)</label>
        <input id="new-proc-mat" value={form.materials} inputMode="decimal" placeholder="اتركه فارغاً"
          onChange={(e) => setForm({ ...form, materials: toLatinDigits(e.target.value) })} />
        <span className="hint">إن ضُبطت تُسوّى أسطره تلقائياً</span></div>
      <ProcedureSpecialties isGeneral={spec.isGeneral} specialtyIds={spec.specialtyIds}
        canAdd onChange={setSpec} />
      <button type="submit" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة إجراء'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// تعديل الاسم والسعر في الصفّ نفسه
function EditRow({ proc, onSaved, onCancel }) {
  const dlg = useDialogs()
  const [name, setName] = useState(proc.name)
  const [price, setPrice] = useState(String(Number(proc.price)))
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const body = {}
    if (name.trim() !== proc.name) body.name = name
    if (Number(price) !== Number(proc.price) || price.trim() === '') body.price = price
    if (Object.keys(body).length === 0) return onCancel()
    if (body.price !== undefined) {
      const ok = await dlg.confirm({
        title: 'تغيير السعر',
        body: `تغيير سعر «${proc.name}» من ${fmtMoney(proc.price)} إلى ${fmtMoney(price)}؟\n`
          + 'يسري على ما يُضاف بعد الحفظ فقط — ما أُضيف لحجوزات سابقة يبقى بسعره.',
        confirmLabel: 'غيّر السعر',
      })
      if (!ok) return
    }
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

// ═══════════════════════════════════════════════════════════════════
// المرحلة الثانية: «بحاجة تسوية»
//
// الاستقبال لا يرى هذا التبويب إطلاقاً (والخادم يرفضه بـ403): هو يستوفي
// السعر من المريض، وما يجري بعده بين الدكتور والجمعية ليس من شأنه.
// ═══════════════════════════════════════════════════════════════════
function SettlementTab({ canEdit, showToast }) {
  const [date, setDate] = useState(() => todayLocal())
  const [scope, setScope] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [edits, setEdits] = useState({})     // lineId → {materials, doctor}
  const [busy, setBusy] = useState(null)

  const load = () => api.clinic.pendingProcedures(date, scope)
    .then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { setData(null); load() }, [date, scope])

  const field = (id, key, fallback) => {
    const e = edits[id]
    return e && e[key] !== undefined ? e[key] : fallback
  }
  const setField = (id, key, v) =>
    setEdits((p) => ({ ...p, [id]: { ...(p[id] || {}), [key]: v } }))

  const settle = async (line) => {
    const materials = field(line.id, 'materials',
      line.materials_cost ?? line.default_materials_cost ?? '')
    if (materials === '' || materials === null) {
      showToast('أدخل كلفة المواد (ويمكن أن تكون صفراً)'); return
    }
    setBusy(line.id)
    try {
      const body = { materials_cost: materials }
      // حصّة الدكتور تُرسَل فقط إن غيّرها المشرف — وإلا حُسبت من القاعدة
      const d = edits[line.id] && edits[line.id].doctor
      if (d !== undefined && d !== '') body.doctor_share = d
      const r = await api.clinic.settleProcedure(line.id, body)
      setEdits((p) => { const n = { ...p }; delete n[line.id]; return n })
      // التحذير يُعرض ولا يمنع: الحفظ تمّ
      if (r.warnings && r.warnings.length) showToast(`حُفظ — ⚠ ${r.warnings[0]}`, 'warn', 7000)
      else showToast('سُوّي السطر', 'success', 3000)
      await load()
    } catch (ex) { showToast(ex.message) }
    finally { setBusy(null) }
  }

  const counts = data?.counts || {}
  const money = (v) => Number(v || 0).toLocaleString('en-US')

  return (
    <div className="card">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h3 style={{ margin: 0 }}>التسوية</h3>
        <div className="inline" style={{ alignItems: 'center', gap: 8 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* العدّادان: اليوم، والمتروك من قبل — وإلّا ضاع قديمُ الأمس بصمت */}
      <div className="inline" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className={scope === 'today' ? '' : 'ghost'}
          style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setScope('today')}>
          اليوم: {counts.today_count ?? 0} إجراء
        </button>
        <button type="button" className={scope === 'old' ? '' : 'ghost'}
          style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setScope('old')}>
          وقديمة: {counts.old_count ?? 0}
        </button>
        <button type="button" className={scope === 'auto' ? '' : 'ghost'}
          style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setScope('auto')}>
          مسوّى تلقائياً: {counts.auto_count ?? 0}
        </button>
      </div>

      {err && <p className="error">{err}</p>}
      {!data ? <p className="empty">جارٍ التحميل…</p>
        : data.lines.length === 0 ? (
          <p className="empty" style={{ marginTop: 12 }}>
            {scope === 'auto' ? 'لا أسطر مسوّاة تلقائياً في هذا اليوم.' : 'لا أسطر بحاجة تسوية.'}
          </p>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>التاريخ</th><th>الدكتور</th><th>المريض</th><th>الإجراء</th>
                <th>السعر</th><th>المواد</th><th>حصّة الدكتور</th><th>الشفاء</th><th>القاعدة</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const materials = field(l.id, 'materials',
                  l.materials_cost ?? l.default_materials_cost ?? '')
                const docOverride = field(l.id, 'doctor', '')
                // المعروض: تجاوز المشرف إن كتبه، وإلا المقترح من القاعدة
                const doc = docOverride !== '' ? Number(docOverride) : Number(l.suggested.doctor)
                const shifa = Number(l.price_snapshot) - Number(materials || 0) - doc
                return (
                  <tr key={l.id} className={shifa < 0 ? 'row-warn' : ''}>
                    <td className="num">{l.session_date}</td>
                    <td>{l.doctor_name}</td>
                    <td>{l.patient_name}</td>
                    <td>{l.name_snapshot}</td>
                    <td className="num">{money(l.price_snapshot)}</td>
                    <td>
                      <input type="number" min="0" step="1" value={materials} disabled={!canEdit}
                        style={{ width: 100 }}
                        onChange={(e) => setField(l.id, 'materials', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" min="0" step="1" disabled={!canEdit}
                        placeholder={money(l.suggested.doctor)} value={docOverride}
                        style={{ width: 110 }}
                        title="اتركه فارغاً لتُحسب من القاعدة"
                        onChange={(e) => setField(l.id, 'doctor', e.target.value)} />
                    </td>
                    <td className={`num ${shifa < 0 ? 'error' : ''}`}>{money(shifa)}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{l.rule_label}</td>
                    <td>
                      {canEdit && (
                        <button type="button" className="ghost"
                          style={{ padding: '3px 10px', fontSize: 11.5 }}
                          disabled={busy === l.id} onClick={() => settle(l)}>
                          {busy === l.id ? '…' : l.settled_at ? 'تعديل' : 'تسوية'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </div>
  )
}

export default function ClinicProcedures() {
  const dlg = useDialogs()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)
  const [tab, setTab] = useState('catalog')
  const [toast, showToast] = useToast()
  const { role } = useRole()
  const canEdit = role === 'clinic_admin'

  const load = () => api.clinic.procedures().then((r) => { setList(r); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const toggleActive = async (p) => {
    if (p.is_active) {
      const ok = await dlg.confirm({
        title: 'تعطيل الإجراء',
        body: `تعطيل «${p.name}»؟\nلا يُضاف بعدها لأي حجز، وما أُضيف سابقاً يبقى كما هو.`,
        confirmLabel: 'تعطيل', danger: true,
      })
      if (!ok) return
    }
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

      {/* الاستقبال لا يرى تبويب التسوية — والخادم يرفضه بـ403 لا الواجهة وحدها */}
      {SETTLEMENT_VIEWERS.includes(role) && (
        <div className="inline" style={{ gap: 8, marginBottom: 14 }}>
          <button type="button" className={tab === 'catalog' ? '' : 'ghost'}
            style={{ padding: '6px 16px' }} onClick={() => setTab('catalog')}>الكتالوج</button>
          <button type="button" className={tab === 'settle' ? '' : 'ghost'}
            style={{ padding: '6px 16px' }} onClick={() => setTab('settle')}>بحاجة تسوية</button>
        </div>
      )}

      {tab === 'settle' && SETTLEMENT_VIEWERS.includes(role) ? (
        <SettlementTab canEdit={canEdit} showToast={showToast} />
      ) : (
      <div className="card">
        <h3>الكتالوج ({list.length} — المفعَّل {active})</h3>
        {canEdit
          ? <NewProcedureForm onCreated={(name) => { showToast(`أُضيف «${name}»`, 'success', 3000); load() }} />
          : <p className="subtitle" style={{ marginTop: -6 }}>للاطّلاع فقط — يديره مسؤول العيادات.</p>}
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>الإجراء</th><th>السعر الحالي</th><th>كلفة المواد</th><th>الحالة</th><th>استُعمل</th><th>آخر تعديل</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {list.map((p) => editing === p.id ? (
              <EditRow key={p.id} proc={p} onCancel={() => setEditing(null)}
                onSaved={() => { setEditing(null); showToast('حُفظ التعديل', 'success', 3000); load() }} />
            ) : (
              <tr key={p.id} className={p.is_active ? undefined : 'proc-inactive'}>
                <td>{p.name}</td>
                <td className="num">{fmtMoney(p.price)}</td>
                <td className="num">
                  {p.default_materials_cost === null || p.default_materials_cost === undefined
                    ? <span className="muted">—</span>
                    : <>{fmtMoney(p.default_materials_cost)}
                        <span className="badge good" style={{ marginInlineStart: 5 }}>تلقائي</span></>}
                </td>
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
      )}
    </>
  )
}
