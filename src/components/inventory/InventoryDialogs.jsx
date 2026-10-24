import { useMemo, useRef, useState } from 'react'
import { api, fmtMoney, todayLocal } from '../../api.js'
import { matchesAr } from '../../arabic-search.js'
import { useDialogs } from '../../dialogs.jsx'
import {
  Modal, UnitSelect, unitPayload, unitChosen, fmtQty, fmtPct, parseNum, materialsCount,
} from './shared.jsx'

const opt = <span className="opt">(اختياري)</span>

// ═══════════════════════════════════════════════════════════════════
// مادة جديدة / تعديل مادة
// سعر البيع يُكتب عند التعريف فقط؛ تعديله بعدها من «تعديل سعر البيع» ليُحفظ في السجلّ.
// ═══════════════════════════════════════════════════════════════════
export function MaterialDialog({ material, units, onClose, onSaved }) {
  const dlg = useDialogs()
  const editing = !!material
  const [name, setName] = useState(material?.name || '')
  const [unit, setUnit] = useState({ unit_id: material ? String(material.unit_id) : '', unit: '' })
  const [price, setPrice] = useState('')
  const [min, setMin] = useState(material && material.min_quantity ? String(material.min_quantity) : '')
  const [active, setActive] = useState(material ? material.is_active : true)
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const unitLocked = editing && material.movements > 0

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) return setErr('اكتب اسم المادة')
    if (!unitChosen(unit)) return setErr('اختر الوحدة أو أضف وحدة جديدة')
    if (editing && material.is_active && !active) {
      const ok = await dlg.confirm({
        title: 'تعطيل المادة',
        body: `تعطيل «${material.name}»؟\nتختفي من بحث الاستقبال فلا تُضاف لإجراءٍ جديد، ويبقى رصيدها وحركاتها كما هي.`,
        confirmLabel: 'تعطيل', danger: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      let saved
      if (editing) {
        const body = { name, min_quantity: min, is_active: active }
        if (!unitLocked && String(unit.unit_id) !== String(material.unit_id)) Object.assign(body, unitPayload(unit))
        saved = await api.inventory.updateMaterial(material.id, body)
      } else {
        saved = await api.inventory.addMaterial({
          name, ...unitPayload(unit), unit_price: price, min_quantity: min,
          opening_quantity: qty, opening_unit_cost: cost, supplier,
        })
      }
      onSaved(saved, editing)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={editing ? `تعديل «${material.name}»` : 'مادة جديدة'} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form">
        <div className="field"><label htmlFor="md-name">اسم المادة</label>
          <input id="md-name" value={name} maxLength={150} autoFocus placeholder="مثال: شاش معقّم"
            onChange={(e) => setName(e.target.value)} /></div>
        <div className="inv-form-row">
          <div className="field"><label htmlFor="md-unit">الوحدة</label>
            {unitLocked
              ? <><input id="md-unit" value={material.unit} disabled />
                  <span className="hint">للمادة حركات بهذه الوحدة — لا تُغيَّر.</span></>
              : <UnitSelect id="md-unit" units={units} value={unit} onChange={setUnit} disabled={busy} />}
          </div>
          {!editing && (
            <div className="field"><label htmlFor="md-price">سعر البيع للمريض (ل.س)</label>
              <input id="md-price" value={price} inputMode="decimal" placeholder="0"
                onChange={(e) => setPrice(e.target.value)} /></div>
          )}
        </div>
        <div className="field"><label htmlFor="md-min">الحدّ الأدنى {opt}</label>
          <input id="md-min" value={min} inputMode="decimal" placeholder="بلا تنبيه"
            onChange={(e) => setMin(e.target.value)} />
          <span className="hint">حين يصل الرصيد إليه أو دونه تظهر المادة «تحتاج شراء» ويصلك إشعار.</span></div>
        {editing && (
          <div className="field-check"><label>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> مفعّلة
          </label><span className="hint">المعطّلة لا تظهر للاستقبال، ورصيدها باقٍ.</span></div>
        )}
        {!editing && (
          <details className="inv-optional">
            <summary>كمّية موجودة الآن {opt}</summary>
            <div className="inv-form-row">
              <div className="field"><label htmlFor="md-qty">الكمّية</label>
                <input id="md-qty" value={qty} inputMode="decimal" placeholder="0" onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label htmlFor="md-cost">سعر شراء الوحدة {opt}</label>
                <input id="md-cost" value={cost} inputMode="decimal" placeholder="—" onChange={(e) => setCost(e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="md-sup">المورّد {opt}</label>
              <input id="md-sup" value={supplier} maxLength={150} onChange={(e) => setSupplier(e.target.value)} /></div>
            <span className="hint">تُسجَّل رصيداً افتتاحياً للمادة.</span>
          </details>
        )}
        {editing && <p className="hint inv-note">سعر البيع يُعدَّل من كرت المادة («تعديل سعر البيع») ليُحفظ في سجلّ الأسعار.</p>}
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إضافة المادة'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// تسجيل شراء — المادة بالبحث (أو مادة جديدة في المودال نفسه)
// ═══════════════════════════════════════════════════════════════════
export function PurchaseDialog({ materials, units, initialId, onClose, onDone, onMaterialCreated }) {
  const [materialId, setMaterialId] = useState(initialId ? String(initialId) : '')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newMat, setNewMat] = useState({ name: '', unit: { unit_id: '', unit: '' }, price: '' })
  const [created, setCreated] = useState(null)
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const qtyRef = useRef(null)

  const all = useMemo(() => (created ? [...materials, created] : materials), [materials, created])
  const chosen = all.find((m) => String(m.id) === materialId)
  const results = query.trim() ? all.filter((m) => m.is_active && matchesAr(m.name, query)).slice(0, 8) : []
  const q = parseNum(qty), c = parseNum(cost)
  const total = q > 0 && c >= 0 && c !== null ? q * c : null

  const pick = (m) => { setMaterialId(String(m.id)); setQuery(''); setTimeout(() => qtyRef.current?.focus(), 0) }

  const createMaterial = async () => {
    setErr(null)
    if (!newMat.name.trim() || !unitChosen(newMat.unit) || newMat.price.trim() === '')
      return setErr('للمادة الجديدة: الاسم والوحدة وسعر البيع')
    setBusy(true)
    try {
      const m = await api.inventory.addMaterial({ name: newMat.name, ...unitPayload(newMat.unit), unit_price: newMat.price })
      setCreated(m); setMaterialId(String(m.id)); setCreating(false)
      onMaterialCreated?.(m)
      setTimeout(() => qtyRef.current?.focus(), 0)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!chosen) return setErr('اختر المادة')
    if (!(q > 0)) return setErr('اكتب الكمّية')
    setBusy(true)
    try {
      const r = await api.inventory.purchase({ material_id: chosen.id, quantity: qty, unit_cost: cost, supplier, date, note })
      onDone(r, chosen)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="تسجيل شراء" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form">
        <div className="field">
          <label htmlFor="pd-mat">المادة</label>
          {chosen ? (
            <div className="inv-chosen">
              <span><strong>{chosen.name}</strong> <span className="inv-muted">— {chosen.unit} · الرصيد {fmtQty(chosen.balance ?? 0)}</span></span>
              {!initialId && <button type="button" className="link-btn" onClick={() => setMaterialId('')}>تغيير</button>}
            </div>
          ) : creating ? (
            <div className="inv-subform">
              <div className="inv-form-row">
                <div className="field"><label htmlFor="pd-nm">اسم المادة الجديدة</label>
                  <input id="pd-nm" autoFocus value={newMat.name} maxLength={150}
                    onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="pd-nu">الوحدة</label>
                  <UnitSelect id="pd-nu" units={units} value={newMat.unit} onChange={(u) => setNewMat({ ...newMat, unit: u })} /></div>
              </div>
              <div className="inv-form-row">
                <div className="field"><label htmlFor="pd-np">سعر البيع للمريض (ل.س)</label>
                  <input id="pd-np" value={newMat.price} inputMode="decimal" placeholder="0"
                    onChange={(e) => setNewMat({ ...newMat, price: e.target.value })} /></div>
                <div className="inv-subform-actions">
                  <button type="button" className="ghost" disabled={busy} onClick={() => setCreating(false)}>إلغاء</button>
                  <button type="button" disabled={busy} onClick={createMaterial}>إضافة واختيار</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mat-search inv-search-wide">
              <input id="pd-mat" type="search" autoFocus value={query} placeholder="ابحث باسم المادة…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (results[0]) pick(results[0]) } }} />
              {query.trim() !== '' && (
                <ul className="mat-results" role="listbox">
                  {results.map((m) => (
                    <li key={m.id}><button type="button" onClick={() => pick(m)}>
                      {m.name} <span className="mat-unit">— {m.unit} · الرصيد {fmtQty(m.balance)}</span>
                    </button></li>
                  ))}
                  {results.length === 0 && <li className="mat-none">لا مادة بهذا الاسم.</li>}
                  <li><button type="button" className="inv-add-new"
                    onClick={() => { setCreating(true); setNewMat({ ...newMat, name: query }) }}>
                    + مادة جديدة{query.trim() ? `: «${query.trim()}»` : ''}</button></li>
                </ul>
              )}
              {query.trim() === '' && (
                <button type="button" className="link-btn inv-new-link" onClick={() => setCreating(true)}>+ مادة جديدة</button>
              )}
            </div>
          )}
        </div>

        <div className="inv-form-row">
          <div className="field"><label htmlFor="pd-qty">الكمّية{chosen ? ` (${chosen.unit})` : ''}</label>
            <input id="pd-qty" ref={qtyRef} value={qty} inputMode="decimal" placeholder="0" onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field"><label htmlFor="pd-cost">سعر شراء الوحدة {opt}</label>
            <input id="pd-cost" value={cost} inputMode="decimal" placeholder="—" onChange={(e) => setCost(e.target.value)} /></div>
        </div>
        {total !== null && <p className="inv-total">المجموع: <strong>{fmtMoney(total)}</strong></p>}

        <details className="inv-optional">
          <summary>المورّد والتاريخ والملاحظة {opt}</summary>
          <div className="inv-form-row">
            <div className="field"><label htmlFor="pd-sup">المورّد</label>
              <input id="pd-sup" value={supplier} maxLength={150} onChange={(e) => setSupplier(e.target.value)} /></div>
            <div className="field"><label htmlFor="pd-date">التاريخ</label>
              <input id="pd-date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="pd-note">ملاحظة</label>
            <input id="pd-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </details>

        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy || creating}>{busy ? 'جارٍ التسجيل…' : 'تسجيل الشراء'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// تعديل سعر البيع — يسري على ما يُضاف بعده، ويُحفظ في سجلّ الأسعار
// ═══════════════════════════════════════════════════════════════════
export function PriceDialog({ material, onClose, onSaved }) {
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const p = parseNum(price)
  const belowCost = material.last_cost !== null && p !== null && !Number.isNaN(p) && p <= material.last_cost

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try { onSaved(await api.inventory.setPrice(material.id, { price, note })) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="تعديل سعر البيع" subtitle={material.name} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form">
        <dl className="inv-facts">
          <div><dt>السعر الحالي</dt><dd>{fmtMoney(material.unit_price)}</dd></div>
          <div><dt>آخر سعر شراء</dt><dd>{material.last_cost === null ? '—' : fmtMoney(material.last_cost)}</dd></div>
        </dl>
        <div className="field"><label htmlFor="pr-new">السعر الجديد (ل.س)</label>
          <input id="pr-new" value={price} inputMode="decimal" autoFocus onChange={(e) => setPrice(e.target.value)} />
          {belowCost && <span className="hint inv-hint-bad">لا يغطّي آخر سعر شراء ({fmtMoney(material.last_cost)}).</span>}
        </div>
        <div className="field"><label htmlFor="pr-note">ملاحظة {opt}</label>
          <input id="pr-note" value={note} placeholder="مثال: غلاء السوق" onChange={(e) => setNote(e.target.value)} /></div>
        <p className="hint inv-note">يسري على ما يُضاف للإجراءات بعد الحفظ — الإجراءات المسجّلة تبقى بسعرها.</p>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy || !price.trim()}>{busy ? 'جارٍ الحفظ…' : 'حفظ السعر'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══ تنبيه البيع بخسارة — بعد شراءٍ رفع السعر فوق سعر البيع ═══
export function LossDialog({ name, unit, warning, onEditPrice, onLater }) {
  const w = warning
  return (
    <Modal title="سعر البيع لا يغطّي سعر الشراء" subtitle={name} onClose={onLater}>
      <dl className="inv-facts">
        <div><dt>سعر الشراء السابق</dt><dd>{w.old_cost === null ? '—' : fmtMoney(w.old_cost)}</dd></div>
        <div><dt>سعر الشراء الجديد</dt><dd>{fmtMoney(w.new_cost)}{w.increase_pct !== null &&
          <span className="inv-up"> · زيادة {fmtPct(w.increase_pct)}</span>}</dd></div>
        <div><dt>سعر البيع الحالي</dt><dd className="neg">{fmtMoney(w.sale_price)}</dd></div>
      </dl>
      <p className="inv-note">كلّ {unit} تُضاف لإجراءٍ بهذا السعر تُحسب بأقلّ من كلفتها.</p>
      <div className="bf-actions inv-actions">
        <button type="button" className="ghost" onClick={onLater}>لاحقاً</button>
        <button type="button" onClick={onEditPrice}>تعديل السعر الآن</button>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// استيراد Excel: القالب ← الملف ← معاينة (لا يُكتب شيء) ← تأكيد
// ═══════════════════════════════════════════════════════════════════
const ROW_STATUS = {
  new: { cls: 'good', row: 'inv-imp-new', label: 'تُضاف' },
  purchase: { cls: 'blue', row: 'inv-imp-buy', label: 'موجودة — شراء' },
  rejected: { cls: 'bad', row: 'inv-imp-bad', label: 'لن تُستورد' },
}

export function ImportDialog({ onClose, onDone, showToast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  const load = async (f) => {
    if (!f) return
    setFile(f); setErr(null); setPreview(null); setBusy(true)
    try { setPreview(await api.inventory.importPreview(f)) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const commit = async () => {
    setErr(null); setBusy(true)
    try { onDone(await api.inventory.importCommit(file, preview.fingerprint)) }
    catch (ex) {
      // المعاينة قديمة: الجديدة تأتي مع الخطأ — تُعرض لتُراجَع ثمّ يُؤكَّد ثانيةً
      if (ex.data?.code === 'PREVIEW_STALE' && ex.data.rows) setPreview(ex.data)
      setErr(ex.message)
    } finally { setBusy(false) }
  }
  const template = async () => {
    try { await api.inventory.template() } catch (ex) { showToast(ex.message) }
  }

  const s = preview?.summary
  const doable = s ? s.new + s.purchase : 0
  return (
    <Modal title="استيراد المواد من Excel" onClose={onClose} busy={busy} wide={!!preview}>
      {!preview && (
        <>
          <p className="inv-modal-sub">
            سطرٌ لكل مادة: الاسم والوحدة وسعر البيع، والكمّية الموجودة إن وُجدت. المادة الموجودة لا تُضاف مرّتين —
            كمّيتها تُسجَّل شراءً عليها.
          </p>
          <button type="button" className="ghost" onClick={template}>⬇ تحميل القالب</button>
          <div className={`dropzone inv-drop${drag ? ' drag' : ''}`} role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files[0]) }}>
            {busy ? 'جارٍ قراءة الملف…' : file ? file.name : 'اختر ملف Excel أو اسحبه إلى هنا'}
          </div>
          <input ref={inputRef} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { load(e.target.files[0]); e.target.value = '' }} />
        </>
      )}

      {preview && (
        <>
          <p className="inv-modal-sub">{file?.name} — معاينة فقط، لم يُكتب شيء بعد.</p>
          <div className="inv-imp-summary">
            <span className="badge good">{materialsCount(s.new)} جديدة</span>
            <span className="badge blue">{s.purchase.toLocaleString('ar-SY')} شراء على موجودة</span>
            <span className={`badge${s.rejected ? ' bad' : ''}`}>{s.rejected.toLocaleString('ar-SY')} مرفوضة</span>
            {s.new_units > 0 && <span className="inv-muted">· {s.new_units.toLocaleString('ar-SY')} وحدة جديدة</span>}
          </div>
          <div className="inv-imp-table">
            <table>
              <thead><tr><th>السطر</th><th>المادة</th><th>الوحدة</th><th>سعر البيع</th><th>الكمّية</th>
                <th>سعر الشراء</th><th>النتيجة</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => {
                  const st = ROW_STATUS[r.status]
                  return (
                    <tr key={r.row} className={st.row}>
                      <td className="num">{r.row.toLocaleString('ar-SY')}</td>
                      <td>{r.name || <span className="inv-muted">—</span>}</td>
                      <td>{r.unit || '—'}</td>
                      <td className="num">{r.sale_price === null ? '—' : fmtQty(r.sale_price)}</td>
                      <td className="num">{r.qty === null ? '—' : fmtQty(r.qty)}</td>
                      <td className="num">{r.unit_cost === null ? '—' : fmtQty(r.unit_cost)}</td>
                      <td>
                        <span className={`badge sm ${st.cls}`}>{st.label}</span>
                        {r.reasons.map((x) => <span key={x} className="inv-imp-reason">{x}</span>)}
                        {r.notes.map((x) => <span key={x} className="inv-imp-note">{x}</span>)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {err && <p className="error">{err}</p>}
      <div className="bf-actions inv-actions">
        {preview && <button type="button" className="ghost" disabled={busy}
          onClick={() => { setPreview(null); setFile(null); setErr(null) }}>ملف آخر</button>}
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
        {preview && (
          <button type="button" disabled={busy || doable === 0} onClick={commit}>
            {busy ? 'جارٍ الاستيراد…' : `تأكيد الاستيراد (${doable.toLocaleString('ar-SY')})`}
          </button>
        )}
      </div>
    </Modal>
  )
}
