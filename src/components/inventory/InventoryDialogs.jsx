import { useMemo, useRef, useState } from 'react'
import { api, fmtMoney, todayLocal } from '../../api.js'
import { matchesAr } from '../../arabic-search.js'
import { useDialogs } from '../../dialogs.jsx'
import {
  Modal, UnitSelect, unitPayload, unitChosen, fmtQty, fmtPct, parseNum, materialsCount, REASONS,
} from './shared.jsx'

const opt = <span className="opt">(اختياري)</span>

// ═══════════════════════════════════════════════════════════════════
// مادة جديدة / تعديل مادة
// سعر البيع يُكتب عند التعريف فقط؛ تعديله بعدها من «تعديل سعر البيع» ليُحفظ في السجلّ.
// النوع: «معدودة» (لها رصيد وتُختار على الإجراء بكمّيتها) أو «استهلاكية» (قطن، شاش، بيتادين —
// بلا رصيد ولا سعر بيع؛ قيمتها مقدّرةٌ على نوع الإجراء، ومشترياتها «شراء» يُخصم من الصندوق).
// ═══════════════════════════════════════════════════════════════════
export function MaterialDialog({ material, units, onClose, onSaved }) {
  const dlg = useDialogs()
  const editing = !!material
  const [name, setName] = useState(material?.name || '')
  const [unit, setUnit] = useState({ unit_id: material ? String(material.unit_id) : '', unit: '' })
  const [price, setPrice] = useState('')
  const [min, setMin] = useState(material && material.min_quantity ? String(material.min_quantity) : '')
  const [active, setActive] = useState(material ? material.is_active : true)
  const [kind, setKind] = useState(material?.material_kind || 'counted')
  const consumable = kind === 'consumable'
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
    if (editing && kind !== (material.material_kind || 'counted')) {
      const ok = await dlg.confirm({
        title: 'تغيير نوع المادة',
        body: consumable
          ? `«${material.name}» استهلاكية؟\nتختفي من قائمة مواد الإجراء (قيمتها تُقدَّر على نوع الإجراء)، ولا رصيد لها ولا تنبيه. ما سُجّل منها على إجراءاتٍ سابقة يبقى كما هو.`
          : `«${material.name}» معدودة؟\nتعود لقائمة مواد الإجراء ويُحسب رصيدها من حركاتها — راجعي الرصيد بتسوية جرد إن اشتريتِها وهي استهلاكية.`,
        confirmLabel: 'غيّر النوع',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      let saved
      if (editing) {
        const body = { name, min_quantity: min, is_active: active, material_kind: kind }
        if (!unitLocked && String(unit.unit_id) !== String(material.unit_id)) Object.assign(body, unitPayload(unit))
        saved = await api.inventory.updateMaterial(material.id, body)
      } else {
        saved = await api.inventory.addMaterial({
          name, ...unitPayload(unit), material_kind: kind,
          ...(consumable ? {} : { unit_price: price, min_quantity: min, opening_quantity: qty, opening_unit_cost: cost, supplier }),
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
        <div className="field" role="radiogroup" aria-label="نوع المادة">
          <label>نوع المادة</label>
          <div className="inv-kind">
            <label className={kind === 'counted' ? 'is-on' : undefined}>
              <input type="radio" name="md-kind" value="counted" checked={!consumable} onChange={() => setKind('counted')} />
              بتنعدّ <span className="hint">إلها كمية على الرف، وبتنضاف على الإجراء بعددها (أمبولات، سيرنغات، جبائر…)</span>
            </label>
            <label className={consumable ? 'is-on' : undefined}>
              <input type="radio" name="md-kind" value="consumable" checked={consumable} onChange={() => setKind('consumable')} />
              استهلاكية <span className="hint">قطن، شاش، بيتادين — ما بتنعدّ، قيمتها محسوبة على نوع الإجراء</span>
            </label>
          </div>
        </div>
        <div className="inv-form-row">
          <div className="field"><label htmlFor="md-unit">الوحدة</label>
            {unitLocked
              ? <><input id="md-unit" value={material.unit} disabled />
                  <span className="hint">للمادة حركات بهذه الوحدة — لا تُغيَّر.</span></>
              : <UnitSelect id="md-unit" units={units} value={unit} onChange={setUnit} disabled={busy} />}
          </div>
          {!editing && !consumable && (
            <div className="field"><label htmlFor="md-price">سعر البيع للمريض (ل.س)</label>
              <input id="md-price" value={price} inputMode="decimal" placeholder="0"
                onChange={(e) => setPrice(e.target.value)} /></div>
          )}
        </div>
        {consumable ? (
          <p className="hint inv-note">بلا رصيد ولا حدّ أدنى: مشترياتها تُسجَّل من «تسجيل شراء» فتُخصم من صندوق العيادات،
            ويقابلها «المستردّ» من الإجراءات في تقرير المستهلكات (صندوق العيادات).</p>
        ) : (
          <div className="field"><label htmlFor="md-min">نبّهيني لما توصل لـ {opt}</label>
            <input id="md-min" value={min} inputMode="decimal" placeholder="بلا تنبيه"
              onChange={(e) => setMin(e.target.value)} />
            <span className="hint">لما يوصل الموجود لهالعدد أو أقلّ، بتطلع «قرّبت تخلص» وبيوصلك إشعار.</span></div>
        )}
        {editing && (
          <div className="field-check"><label>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> شغّالة
          </label><span className="hint">إذا شلتي الإشارة بتنوقف: ما بتظهر للاستقبال، والموجود منها وقصّتها بيضلّوا.</span></div>
        )}
        {!editing && !consumable && (
          <details className="inv-optional">
            <summary>في منها هلأ على الرف؟ {opt}</summary>
            <div className="inv-form-row">
              <div className="field"><label htmlFor="md-qty">الكمّية</label>
                <input id="md-qty" value={qty} inputMode="decimal" placeholder="0" onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label htmlFor="md-cost">سعر شراء الوحدة {opt}</label>
                <input id="md-cost" value={cost} inputMode="decimal" placeholder="—" onChange={(e) => setCost(e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="md-sup">المورّد {opt}</label>
              <input id="md-sup" value={supplier} maxLength={150} onChange={(e) => setSupplier(e.target.value)} /></div>
            <span className="hint">بتنسجّل رصيد بداية — ما بتنخصم من الصندوق.</span>
          </details>
        )}
        {editing && !consumable && <p className="hint inv-note">السعر والتنبيه بيتغيّروا من مربّعاتهم بصفحة المادة («تغيير السعر») — وكل تغيير بينحفظ بـ«شو صار عليها».</p>}
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
    if (c === null || Number.isNaN(c)) return setErr('اكتب سعر شراء القطعة — يُخصم المبلغ من صندوق العيادات')
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
          <div className="field"><label htmlFor="pd-cost">سعر شراء القطعة</label>
            <input id="pd-cost" value={cost} inputMode="decimal" placeholder="—" onChange={(e) => setCost(e.target.value)} /></div>
        </div>
        {total !== null && <p className="inv-total">المجموع: <strong>{fmtMoney(total)}</strong> — يُخصم من صندوق العيادات</p>}

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
// تغيير سعر البيع — يسري على ما يُضاف بعده، ويُحفظ في «شو صار عليها»
// ═══════════════════════════════════════════════════════════════════
export function PriceDialog({ material, onClose, onSaved }) {
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const p = parseNum(price)
  const cost = material.purchase_price ?? material.last_cost
  const belowCost = cost !== null && cost !== undefined && p !== null && !Number.isNaN(p) && p <= cost

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (p === null) return setErr('اكتبي السعر الجديد')
    if (Number.isNaN(p)) return setErr('السعر رقم بس — مثال: 250')
    setBusy(true)
    try { onSaved(await api.inventory.setPrice(material.id, { price, note })) }
    catch (ex) { setErr(ex.data?.code === 'SAME_PRICE' ? 'هاد نفس السعر الحالي — ما تغيّر شي' : ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="تغيير سعر البيع" subtitle={material.name} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form invx-form">
        <div className="invx-now">
          <span>السعر هلأ</span><strong>{fmtMoney(material.unit_price)}</strong>
          {cost !== null && cost !== undefined && <span className="invx-muted">سعر شرائها {fmtMoney(cost)}</span>}
        </div>
        <div className="field"><label htmlFor="pr-new">السعر الجديد للمريض (ل.س)</label>
          <input id="pr-new" className="invx-big-input" value={price} inputMode="decimal" autoFocus placeholder="مثال: 250"
            onChange={(e) => setPrice(e.target.value)} />
          {belowCost && <span className="hint inv-hint-bad">⚠ هالسعر أقلّ من سعر شرائها ({fmtMoney(cost)}) — رح تنباع بخسارة.</span>}
        </div>
        <div className="field"><label htmlFor="pr-note">ليش تغيّر؟ {opt}</label>
          <input id="pr-note" value={note} placeholder="مثال: غلاء السوق" onChange={(e) => setNote(e.target.value)} /></div>
        <p className="hint inv-note">السعر الجديد بيمشي على اللي بينضاف للإجراءات من هلأ. اللي انسجّل قبل بيضل بسعره القديم.</p>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ السعر الجديد'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══ تغيير سعر الشراء (للواحدة) — يُكتب باليد بلا حركة في الصندوق، ويُحفظ في السجلّ ═══
export function CostDialog({ material, onClose, onSaved }) {
  const [price, setPrice] = useState(material.purchase_price === null ? '' : String(material.purchase_price))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    const v = parseNum(price)
    if (v === null) return setErr('اكتبي سعر الشراء')
    if (Number.isNaN(v)) return setErr('السعر رقم بس — مثال: 180')
    if (v === material.purchase_price) return setErr('هاد نفس السعر الحالي — ما تغيّر شي')
    setBusy(true)
    try { await api.inventory.setPurchasePrices([{ material_id: material.id, price }]); onSaved(v) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={material.purchase_price === null ? 'كتابة سعر الشراء' : 'تغيير سعر الشراء'} subtitle={material.name} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form invx-form">
        <div className="invx-now">
          <span>سعر الشراء هلأ</span><strong>{material.purchase_price === null ? 'ما انكتب' : fmtMoney(material.purchase_price)}</strong>
          {material.last_cost !== null && <span className="invx-muted">آخر شراء بـ {fmtMoney(material.last_cost)}</span>}
        </div>
        <div className="field"><label htmlFor="cs-new">بكم اشترينا الواحدة؟ (ل.س)</label>
          <input id="cs-new" className="invx-big-input" value={price} inputMode="decimal" autoFocus placeholder="مثال: 180"
            onChange={(e) => setPrice(e.target.value)} /></div>
        <p className="hint inv-note">هاد بس تسجيل للسعر — ما بينخصم شي من صندوق العيادات. لما تسجّلي شراء جديد، السعر بيتحدّث لحاله.</p>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══ «نبّهيني لما توصل لـ» — الحدّ الأدنى بالكلام العادي؛ الفارغ أو الصفر = بلا تنبيه ═══
export function AlertDialog({ material, onClose, onSaved }) {
  const [min, setMin] = useState(material.min_quantity ? String(material.min_quantity) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (min.trim() !== '' && Number.isNaN(parseNum(min))) return setErr('العدد رقم بس — مثال: 5')
    setBusy(true)
    try { onSaved(await api.inventory.updateMaterial(material.id, { min_quantity: min.trim() === '' ? 0 : min })) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="إيمتى ننبّهك؟" subtitle={material.name} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="inv-form invx-form">
        <div className="field"><label htmlFor="al-min">نبّهيني لما يوصل الموجود لـ ({material.unit})</label>
          <input id="al-min" className="invx-big-input" value={min} inputMode="decimal" autoFocus placeholder="مثال: 5"
            onChange={(e) => setMin(e.target.value)} />
          <span className="hint">لما يوصل الموجود لهالعدد أو أقلّ، المادة بتطلع «قرّبت تخلص» وبيوصلك إشعار. خلّيه فاضي إذا ما بدّك تنبيه.</span></div>
        <p className="invx-muted">الموجود هلأ: <bdi dir="ltr">{fmtQty(material.balance)}</bdi> {material.unit}</p>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══ «عدّيتي الرف؟» — جرد مادةٍ واحدة من صفحتها، بمسار الجرد نفسه (معاينة ثمّ تأكيد بالرصيد المرئيّ) ═══
export function CountDialog({ material, onClose, onSaved }) {
  const [counted, setCounted] = useState('')
  const [diff, setDiff] = useState(null)          // سطر الفرق من المعاينة
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const check = async (e) => {
    e.preventDefault()
    setErr(null)
    const v = parseNum(counted)
    if (v === null) return setErr('اكتبي كم عدّيتي على الرف')
    if (Number.isNaN(v)) return setErr('العدد رقم بس — مثال: 12')
    setBusy(true)
    try {
      const r = await api.inventory.stocktakePreview([{ material_id: material.id, counted }])
      if (r.diffs.length === 0) { onSaved(`العدد مطابق — الموجود ${fmtQty(v)} ${material.unit} متل ما هو مسجّل، ما في شي يتصحّح`); return }
      setDiff(r.diffs[0])
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const confirm = async () => {
    setErr(null)
    if (!reason) return setErr('اختاري سبب الفرق')
    if (reason === 'other' && !note.trim()) return setErr('اكتبي السبب')
    setBusy(true)
    try {
      await api.inventory.stocktake([{ material_id: material.id, counted: diff.counted, expected: diff.system, reason, reason_note: note }])
      onSaved(`انصحّح العدد — الموجود من «${material.name}» صار ${fmtQty(diff.counted)} ${material.unit}`)
    } catch (ex) {
      if (ex.data?.code === 'STOCK_CHANGED' && ex.data.diffs?.[0]) setDiff(ex.data.diffs[0])
      setErr(ex.message)
    } finally { setBusy(false) }
  }
  const delta = diff ? diff.counted - diff.system : 0
  return (
    <Modal title="عدّيتي الرف؟" subtitle={material.name} onClose={onClose} busy={busy}>
      {!diff ? (
        <form onSubmit={check} className="inv-form invx-form">
          <div className="invx-now"><span>المسجّل بالنظام</span><strong><bdi dir="ltr">{fmtQty(material.balance)}</bdi> {material.unit}</strong></div>
          <div className="field"><label htmlFor="ct-n">كم {material.unit} لقيتي فعلاً على الرف؟</label>
            <input id="ct-n" className="invx-big-input" value={counted} inputMode="decimal" autoFocus placeholder="العدد"
              onChange={(e) => setCounted(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="bf-actions inv-actions">
            <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
            <button type="submit" disabled={busy}>{busy ? 'لحظة…' : 'التالي'}</button>
          </div>
        </form>
      ) : (
        <div className="inv-form invx-form">
          <div className={`invx-diff ${delta < 0 ? 'is-less' : 'is-more'}`}>
            المسجّل <strong><bdi dir="ltr">{fmtQty(diff.system)}</bdi></strong> — لقيتي <strong><bdi dir="ltr">{fmtQty(diff.counted)}</bdi></strong>
            <span>{delta < 0 ? `ناقص ${fmtQty(-delta)}` : `زايد ${fmtQty(delta)}`} {material.unit}</span>
          </div>
          <fieldset className="invx-reasons">
            <legend>ليش في فرق؟</legend>
            {REASONS.map(([k, label]) => (
              <label key={k} className={reason === k ? 'is-on' : undefined}>
                <input type="radio" name="ct-reason" value={k} checked={reason === k} onChange={() => setReason(k)} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field"><label htmlFor="ct-note">ملاحظة {reason === 'other' ? '' : opt}</label>
            <input id="ct-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="bf-actions inv-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => { setDiff(null); setErr(null) }}>رجوع</button>
            <button type="button" disabled={busy} onClick={confirm}>{busy ? 'جارٍ الحفظ…' : `صحّحي الموجود لـ ${fmtQty(diff.counted)}`}</button>
          </div>
        </div>
      )}
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
      <p className="inv-note">كل {unit} بتنضاف لإجراء بهالسعر بتنحسب بأقلّ من كلفتها. غيّري السعر هلأ أو بعدين من صفحة المادة.</p>
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
  consumable: { cls: 'good', row: 'inv-imp-new', label: 'استهلاكية — تُضاف بلا رصيد' },
  purchase: { cls: 'blue', row: 'inv-imp-buy', label: 'موجودة — شراء' },
  opening: { cls: 'blue', row: 'inv-imp-buy', label: 'موجودة — رصيد افتتاحي' },
  skipped: { cls: '', row: 'inv-imp-skip', label: 'تخطٍّ' },
  rejected: { cls: 'bad', row: 'inv-imp-bad', label: 'لن تُستورد' },
}

const IMPORT_KINDS = { counted: 'معدودة', consumable: 'استهلاكية' }

// أثر السطر على الرصيد والصندوق: ما سيحدث بالضبط إن أُكّد
function importEffect(r) {
  if (r.status === 'purchase') return `يُخصم ${fmtMoney(r.fund_deduction)} من الصندوق`
  if (r.status === 'opening' || (r.status === 'new' && r.qty !== null)) return 'رصيد افتتاحي — بلا خصم من الصندوق'
  return null
}

export function ImportDialog({ onClose, onDone, showToast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  // جرد قائم مشترى من زمان هو الاستخدام الأساسي — فالافتراضي بلا خصم
  const [asOpening, setAsOpening] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  const load = async (f) => {
    if (!f) return
    setFile(f); setErr(null); setPreview(null); setBusy(true)
    try { setPreview(await api.inventory.importPreview(f, asOpening)) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  // الخيار يغيّر تصنيف الأسطر وبصمتها: معاينةٌ جديدة، فلا يُؤكَّد إلا ما عُرض
  const toggleOpening = async (checked) => {
    setAsOpening(checked); setErr(null); setBusy(true)
    try { setPreview(await api.inventory.importPreview(file, checked)) }
    catch (ex) { setAsOpening(preview.as_opening); setErr(ex.message) } finally { setBusy(false) }
  }
  const commit = async () => {
    setErr(null); setBusy(true)
    try { onDone(await api.inventory.importCommit(file, preview.fingerprint, preview.as_opening)) }
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
  const doable = s ? s.new + s.consumable + s.purchase + s.opening : 0
  return (
    <Modal title="استيراد المواد من Excel" onClose={onClose} busy={busy} wide={!!preview}>
      {!preview && (
        <>
          <p className="inv-modal-sub">
            سطرٌ لكل مادة: الاسم والوحدة وسعر البيع ونوعها، والكمّية الموجودة إن وُجدت. المادة الموجودة لا تُضاف
            مرّتين — وتختار في المعاينة: كمّيتها رصيدٌ افتتاحيّ أو شراءٌ يُخصم من الصندوق.
          </p>
          <button type="button" className="ghost" onClick={template}>⬇ تنزيل القالب</button>
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
            {s.consumable > 0 && <span className="badge good">{s.consumable.toLocaleString('ar-SY')} استهلاكية</span>}
            {preview.as_opening
              ? <span className="badge blue">{s.opening.toLocaleString('ar-SY')} رصيد على موجودة</span>
              : <span className="badge blue">{s.purchase.toLocaleString('ar-SY')} شراء على موجودة</span>}
            {s.skipped > 0 && <span className="badge">{s.skipped.toLocaleString('ar-SY')} تخطٍّ</span>}
            <span className={`badge${s.rejected ? ' bad' : ''}`}>{s.rejected.toLocaleString('ar-SY')} مرفوضة</span>
            {s.new_units > 0 && <span className="inv-muted">· {s.new_units.toLocaleString('ar-SY')} وحدة جديدة</span>}
          </div>
          <div className="field-check inv-imp-opening"><label>
            <input type="checkbox" checked={asOpening} disabled={busy} onChange={(e) => toggleOpening(e.target.checked)} />
            تسجيل الكميات كرصيد افتتاحي (بلا خصم من صندوق العيادات)
          </label>
            <span className="hint">
              {preview.as_opening ? 'لا حركة خصم من الصندوق لأيّ سطر — جردٌ قائم مشترى من قبل.'
                : `كمّية المادة الموجودة شراءٌ يُخصم من الصندوق — المجموع ${fmtMoney(s.fund_deduction)}.`}
            </span>
          </div>
          {!preview.kind_column && (
            <p className="inv-modal-sub">الملف بالقالب القديم بلا عمود «نوع المادة» — كلّ المواد الجديدة تُضاف معدودة.</p>
          )}
          <div className="inv-imp-table">
            <table className="rtable">
              <thead><tr><th>السطر</th><th>المادة</th><th>الوحدة</th><th>النوع</th><th>سعر البيع</th><th>الكمّية</th>
                <th>سعر الشراء</th><th>النتيجة</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => {
                  const st = ROW_STATUS[r.status]
                  const effect = importEffect(r)
                  return (
                    <tr key={r.row} className={st.row}>
                      <td className="num" data-label="السطر">{r.row.toLocaleString('ar-SY')}</td>
                      <td className="rt-title">{r.name || <span className="inv-muted">—</span>}</td>
                      <td data-label="الوحدة">{r.unit || '—'}</td>
                      <td data-label="النوع">{IMPORT_KINDS[r.kind] || '—'}</td>
                      <td className="num" data-label="سعر البيع">{r.sale_price === null ? '—' : fmtQty(r.sale_price)}</td>
                      <td className="num" data-label="الكمّية">{r.qty === null ? '—' : fmtQty(r.qty)}</td>
                      <td className="num" data-label="سعر الشراء">{r.unit_cost === null ? '—' : fmtQty(r.unit_cost)}</td>
                      <td className="rt-full inv-imp-result">
                        <span className={`badge sm ${st.cls}`}>{st.label}</span>
                        {effect && <span className="inv-imp-note">{effect}</span>}
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
          onClick={() => { setPreview(null); setFile(null); setErr(null); setAsOpening(true) }}>ملف آخر</button>}
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
