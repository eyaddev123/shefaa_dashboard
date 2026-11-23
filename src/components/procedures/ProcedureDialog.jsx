import { useEffect, useState } from 'react'
import MaterialsEditor, { qtyValid, toPayload, materialsValue } from '../MaterialsEditor.jsx'
import ConsumablesCounter from '../ConsumablesCounter.jsx'
import { usualText } from '../../usual-materials.js'
import { ProcedureSpecialties, specialtiesText } from '../../SpecialtyPicker.jsx'
import { useDialogs } from '../../dialogs.jsx'
import { api, fmtMoney, toLatinDigits, fmtDay } from '../../api.js'
import { Modal } from '../inventory/shared.jsx'

// ═══ نافذة الإجراء: إضافة جديد، أو فتح إجراءٍ قائم ═══
// الكتالوج لا يحمل أزراراً على كلّ بطاقة (كانت خمسة أزرار في كلّ صفّ): بطاقةٌ تُفتح فتجمع هنا
// كلّ ما يخصّ الإجراء — الاسم والسعر والمستهلكات والاختصاصات، ثمّ «تطبيق قاعدة على دكاترة»
// و«تاريخ التسعيرة» و«تعطيل». المشرفة تكتب، والمدير يطالع ويرى التاريخ (PRICING_HISTORY_READERS).
// تعديل السعر أو المستهلكات يسري على ما يُضاف بعده فقط — ويُسأل عنه بتأكيدٍ صريح كما كان.

// ═══ الإصدار 3 (قرار المستخدم 2026-11-17): السعر أجرة الإيد، وتقسيمها هنا على الإجراء نفسه ═══
// نسبةٌ للدكتور (مقرّبة لفوق لأقرب 50 كما في الخادم) أو مبلغٌ ثابت، والباقي للشفاء. والمواد والمستهلكات
// فوق الأجرة على المريض — لا تمسّ الحصّتين. قبل «التفعيل» تُكتب «الأجرة الجديدة» بجانب السعر القائم.
const ROUND_STEP = 50
export function splitPreview(fee, kind, value) {
  const f = Number(fee), v = Number(value)
  if (!(f >= 0) || String(fee).trim() === '' || !['percent', 'fixed'].includes(kind) || String(value).trim() === '' || !(v >= 0)) return null
  const raw = kind === 'percent' ? f * (v / 100) : v
  const doctor = kind === 'percent' ? Math.min(raw <= 0 ? 0 : Math.ceil(Math.round(raw * 100) / (ROUND_STEP * 100)) * ROUND_STEP, f) : Math.min(v, f)
  return { doctor, shifa: Math.round((f - doctor) * 100) / 100, over: kind === 'fixed' && v > f }
}
export const splitText = (p) => (!p?.doctor_split_kind ? 'لم تُحدَّد'
  : p.doctor_split_kind === 'percent' ? `${fmtNum(p.doctor_split_value)}% من الأجرة` : `${fmtMoney(p.doctor_split_value)} من الأجرة`)

function SplitFields({ fee, kind, value, onKind, onValue, idp }) {
  const pv = splitPreview(fee, kind, value)
  return (
    <fieldset className="pcx-split">
      <legend>حصّة الدكتور من الأجرة</legend>
      <div className="pcx-split-row">
        <div className="pcx-sort" role="group" aria-label="طريقة التقسيم">
          {[['percent', 'نسبة'], ['fixed', 'مبلغ ثابت']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} className={`rev-flag${kind === k ? ' is-on' : ''}`}
              onClick={() => onKind(k)}>{label}</button>
          ))}
        </div>
        <input id={`${idp}-split`} value={value} inputMode="decimal" placeholder={kind === 'percent' ? 'مثلاً 65' : 'مثلاً 100'}
          aria-label={kind === 'percent' ? 'نسبة الدكتور %' : 'مبلغ الدكتور'} disabled={!kind}
          onChange={(e) => onValue(toLatinDigits(e.target.value))} />
        <span className="pcx-split-unit">{kind === 'percent' ? '%' : kind ? 'ل.س' : ''}</span>
      </div>
      {pv && (pv.over
        ? <p className="error">مبلغ الدكتور أكبر من الأجرة.</p>
        : <p className="pcx-split-out">من أجرة {fmtMoney(fee)}: <strong>الدكتور {fmtMoney(pv.doctor)}</strong> · <strong>الشفاء {fmtMoney(pv.shifa)}</strong></p>)}
    </fieldset>
  )
}

const specKey = (sp) => (sp.isGeneral ? 'general' : [...sp.specialtyIds].map(String).sort().join(','))
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const timesText = (n) => (n === 0 ? 'لم يُستعمل بعد' : n === 1 ? 'استُعمل مرّةً واحدة' : n === 2 ? 'استُعمل مرّتين'
  : `استُعمل ${fmtNum(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'مرّات' : 'مرّة'}`)

export default function ProcedureDialog({ proc, feeMode, canEdit, canHistory, seesConsumables, onClose, onSaved, onDistribute, onHistory, onToggle }) {
  const dlg = useDialogs()
  const isNew = !proc
  const [name, setName] = useState(proc?.name || '')
  const [price, setPrice] = useState(proc ? String(Number(proc.price)) : '')
  const [cons, setCons] = useState(proc ? String(Number(proc.consumables_cost || 0)) : '')
  const [kind, setKind] = useState(proc?.doctor_split_kind || '')
  const [splitVal, setSplitVal] = useState(proc?.doctor_split_value != null ? String(Number(proc.doctor_split_value)) : '')
  const [draft, setDraft] = useState(proc?.draft_price != null ? String(Number(proc.draft_price)) : '')
  // الأجرة التي يُقسَّم منها: بعد القلبة السعر نفسه، وقبلها الأجرة الجديدة
  const fee = feeMode ? price : draft
  const splitChanged = kind !== (proc?.doctor_split_kind || '')
    || (kind && Number(splitVal) !== Number(proc?.doctor_split_value ?? NaN))
  const draftChanged = !feeMode && (draft.trim() === '' ? proc?.draft_price != null : Number(draft) !== Number(proc?.draft_price ?? NaN))
  const initialSpec = proc
    ? { isGeneral: !!proc.is_general || !(proc.specialties || []).length,
        specialtyIds: proc.is_general ? [] : (proc.specialties || []).map((x) => String(x.id)) }
    : { isGeneral: true, specialtyIds: [] }
  const [spec, setSpec] = useState(initialSpec)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // ═══ المواد المعتادة (2026-11-23): تُعبّأ وحدها عند إضافة الإجراء (× العدد)، ويعدّلها الدكتور أو الاستقبال ═══
  // بعد القلبة وحدها (قبلها المواد داخل السعر). المعدودة المفعّلة في البحث؛ والمعطّلة القائمة في المعتاد تبقى.
  const initialUsual = (proc?.usual_materials || []).map((m) => ({ material_id: String(m.material_id), name: m.name, unit: m.unit, qty: String(Number(m.qty)) }))
  const [usualMats, setUsualMats] = useState(initialUsual)
  const [usualCons, setUsualCons] = useState(Number(proc?.usual_consumables || 0))
  const [matCatalog, setMatCatalog] = useState(null)
  const withUsual = !!feeMode && canEdit
  useEffect(() => {
    if (!withUsual) return
    // بلا الرصيد: المعتاد قالبٌ لا صرف — فلا يقف ➕ عند رصيد اليوم
    api.clinic.materials().then((r) => setMatCatalog(r.filter((m) => m.is_active !== false && m.material_kind !== 'consumable')
      .map(({ balance: _b, ...m }) => m)))
      .catch(() => setMatCatalog([]))
  }, [withUsual])
  const usualKey = (list, c) => `${list.map((m) => `${m.material_id}:${Number(String(m.qty).replace(/[٫,]/g, '.'))}`).sort().join(',')}|${c}`
  const usualChanged = withUsual && usualKey(usualMats, usualCons) !== usualKey(initialUsual, Number(proc?.usual_consumables || 0))
  const usualBody = () => ({ materials: toPayload(usualMats).map((m) => ({ material_id: Number(m.material_id), qty: m.qty })), consumables: usualCons })

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) return setErr('اكتب اسم الإجراء')
    if (price.trim() === '') return setErr(feeMode ? 'اكتب الأجرة' : 'اكتب السعر')
    if (feeMode && !kind) return setErr('حدّد حصّة الدكتور من الأجرة: نسبة أو مبلغ ثابت')
    if (kind && splitVal.trim() === '') return setErr(kind === 'percent' ? 'اكتب نسبة الدكتور' : 'اكتب مبلغ الدكتور')
    if (splitPreview(fee, kind, splitVal)?.over) return setErr('مبلغ الدكتور أكبر من الأجرة')
    if (withUsual && !qtyValid(usualMats)) return setErr('المواد المعتادة: صحّح الكمّية (رقم أكبر من صفر)')
    const feeBody = {
      ...(kind && (isNew || splitChanged) ? { doctor_split_kind: kind, doctor_split_value: splitVal } : {}),
      ...(!feeMode && (isNew ? draft.trim() !== '' : draftChanged) ? { draft_price: draft.trim() } : {}),
    }
    if (isNew) {
      setBusy(true)
      try {
        const created = await api.clinic.addProcedure({ name, price, consumables_cost: cons, ...feeBody })
        let warn = created?.warnings || []
        if (!spec.isGeneral && created?.id) {
          try {
            await api.clinic.setProcedureSpecialties(created.id, { is_general: false, specialty_ids: spec.specialtyIds.map(Number) })
          } catch (ex) { warn = [...warn, `أُنشئ عامّاً — تعذّر إسناد الاختصاصات (${ex.message})`] }
        }
        if (usualChanged && created?.id) {
          try { await api.clinic.setProcedureUsual(created.id, usualBody()) }
          catch (ex) { warn = [...warn, `أُنشئ بلا مواد معتادة — ${ex.message}`] }
        }
        onSaved(`أُضيف «${name.trim()}»`, warn)
      } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
      return
    }
    const body = {}
    if (name.trim() !== proc.name) body.name = name
    if (Number(price) !== Number(proc.price)) body.price = price
    if (Number(cons || 0) !== Number(proc.consumables_cost || 0)) body.consumables_cost = cons || '0'
    Object.assign(body, feeBody)
    const specChanged = specKey(spec) !== specKey(initialSpec)
    if (Object.keys(body).length === 0 && !specChanged && !usualChanged) return onClose()
    if (body.price !== undefined) {
      const ok = await dlg.confirm({
        title: feeMode ? 'تغيير الأجرة' : 'تغيير السعر',
        body: `تغيير ${feeMode ? 'أجرة' : 'سعر'} «${proc.name}» من ${fmtMoney(proc.price)} إلى ${fmtMoney(price)}؟\n`
          + 'يسري على ما يُضاف بعد الحفظ فقط — ما أُضيف لحجوزات سابقة يبقى بسعره.',
        confirmLabel: 'غيّر السعر',
      })
      if (!ok) return
    }
    if (body.consumables_cost !== undefined) {
      const ok = await dlg.confirm({
        title: 'تغيير المستهلكات',
        body: `تغيير مستهلكات «${proc.name}» من ${fmtMoney(proc.consumables_cost || 0)} إلى ${fmtMoney(cons || 0)}؟\n`
          + 'يسري على ما يُضاف بعد الحفظ فقط — الإجراءات المسجّلة تبقى بقيمتها.',
        confirmLabel: 'غيّر المستهلكات',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const out = Object.keys(body).length ? await api.clinic.updateProcedure(proc.id, body) : null
      if (specChanged) await api.clinic.setProcedureSpecialties(proc.id,
        { is_general: spec.isGeneral, specialty_ids: spec.isGeneral ? [] : spec.specialtyIds.map(Number) })
      if (usualChanged) await api.clinic.setProcedureUsual(proc.id, usualBody())
      onSaved('حُفظ التعديل', out?.warnings || [])
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  // للاطّلاع وحده (المدير والمجلس): البيانات نصّاً، ولا حقول
  if (!canEdit && proc) {
    return (
      <Modal title={proc.name} sheet onClose={onClose}
        subtitle={proc.is_active ? timesText(proc.times_used) : `معطَّل — ${timesText(proc.times_used)}`}>
        <dl className="pcx-facts">
          <div><dt>{feeMode ? 'الأجرة' : 'السعر'}</dt><dd>{fmtMoney(proc.price)}</dd></div>
          {seesConsumables && !feeMode && <div><dt>المستهلكات المقدّرة</dt><dd>{Number(proc.consumables_cost) > 0 ? fmtMoney(proc.consumables_cost) : 'لا شيء'}</dd></div>}
          {seesConsumables && <div><dt>حصّة الدكتور</dt><dd>{splitText(proc)}</dd></div>}
          {seesConsumables && !feeMode && proc.draft_price != null && <div><dt>الأجرة الجديدة</dt><dd>{fmtMoney(proc.draft_price)}</dd></div>}
          {feeMode && <div><dt>المواد المعتادة</dt><dd>{usualText(proc) || 'لا شيء'}</dd></div>}
          <div><dt>الاختصاصات</dt><dd>{specialtiesText(proc)}</dd></div>
        </dl>
        <div className="bf-actions inv-actions">
          {canHistory && <button type="button" className="ghost" onClick={onHistory}>تاريخ التسعيرة</button>}
          <button type="button" onClick={onClose}>إغلاق</button>
        </div>
      </Modal>
    )
  }

  const by = proc && (proc.updated_by_name || proc.created_by_name)
  const at = proc && (proc.updated_at || proc.created_at)
  return (
    <Modal title={isNew ? 'إجراء جديد' : proc.name} sheet onClose={onClose} busy={busy}
      subtitle={isNew
        ? (feeMode ? 'يظهر للاستقبال عند دكاترة اختصاصاته. الأجرة تُقسم بين الدكتور والشفاء، والمواد فوقها على المريض.'
          : 'يظهر للاستقبال عند دكاترة اختصاصاته. والسعر هو ما يدفعه المريض.')
        : `${proc.is_active ? '' : 'معطَّل — '}${timesText(proc.times_used)}${by ? `، آخر تعديل: ${by}` : ''}${at ? ` (${fmtDay(at)})` : ''}`}>
      <form className="inv-form pcx-form" onSubmit={submit}>
        <div className="field"><label htmlFor="pcx-name">اسم الإجراء</label>
          <input id="pcx-name" value={name} maxLength={150} autoFocus={isNew} placeholder="مثال: تخطيط قلب"
            onChange={(e) => setName(e.target.value)} /></div>
        <div className="pcx-row">
          {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
          <div className="field"><label htmlFor="pcx-price">{feeMode ? 'الأجرة — شغل الإيد (ل.س)' : 'السعر الحالي — يشمل المواد (ل.س)'}</label>
            <input id="pcx-price" value={price} inputMode="decimal" placeholder="0"
              onChange={(e) => setPrice(toLatinDigits(e.target.value))} /></div>
          {/* بعد القلبة المستهلكات عدّادٌ على كلّ إجراءٍ مسجّل (الاستقبال أو الدكتور) — لا قيمة ثابتة هنا */}
          {!feeMode && <div className="field"><label htmlFor="pcx-cons">المستهلكات المقدّرة (ل.س)</label>
            <input id="pcx-cons" value={cons} inputMode="decimal" placeholder="0"
              onChange={(e) => setCons(toLatinDigits(e.target.value))} /></div>}
        </div>
        <p className="pcx-hint">
          {feeMode
            ? 'المواد والمستهلكات (بوفيدون، قطن، شاش، كفوف، لاصق) يحدّدها الاستقبال أو الدكتور على كلّ إجراء — تبدأ من «المواد المعتادة» أدناه — وتُضاف على المريض فوق الأجرة، ولا تمسّ حصّة الدكتور.'
            : 'المستهلكات: قطنٌ وشاشٌ وبيتادين يستهلكها الإجراء كلّ مرّة — تُطرح من مبلغه لصندوق العيادات مع المواد.'}
          {!isNew && (feeMode ? ' وتغيير الأجرة أو الحصّة يسري على ما يُضاف بعد الحفظ فقط.'
            : ' وتغيير السعر أو المستهلكات أو الحصّة يسري على ما يُضاف بعد الحفظ فقط.')}</p>
        {feeMode ? (
          <SplitFields idp="pcx" fee={price} kind={kind} value={splitVal}
            onKind={(k) => { setKind(k); setSplitVal('') }} onValue={setSplitVal} />
        ) : (
          <div className="pcx-next">
            <h4>الطريقة الجديدة: أجرة + مواد</h4>
            <p className="pcx-hint">السعر الحالي يشمل المواد. اكتب أجرة شغل الإيد وحدها وحصّة الدكتور منها —
              تبقى جاهزةً ولا تُطبَّق حتى «تفعيل الطريقة الجديدة» في صفحة الإجراءات.</p>
            <div className="field"><label htmlFor="pcx-draft">الأجرة الجديدة (ل.س)</label>
              <div className="pcx-draft-row">
                <input id="pcx-draft" value={draft} inputMode="decimal" placeholder="أجرة شغل الإيد"
                  onChange={(e) => setDraft(toLatinDigits(e.target.value))} />
                {price.trim() !== '' && draft !== price && (
                  <button type="button" className="ghost" onClick={() => setDraft(price)}>نفس السعر الحالي</button>
                )}
              </div></div>
            <SplitFields idp="pcx-n" fee={draft} kind={kind} value={splitVal}
              onKind={(k) => { setKind(k); setSplitVal('') }} onValue={setSplitVal} />
          </div>
        )}
        {withUsual && (
          <fieldset className="pcx-usual">
            <legend>المواد المعتادة</legend>
            <p className="pcx-hint">ما يُصرف بالعادة لإجراءٍ واحد. يطلع جاهزاً للدكتور والاستقبال عند إضافة الإجراء
              (× العدد)، ويزيدون أو ينقّصون حسب الحالة. اتركه فارغاً لإجراءٍ بلا مواد. يسري على ما يُضاف بعد الحفظ فقط.</p>
            <MaterialsEditor withPrice catalog={matCatalog} value={usualMats} onChange={setUsualMats} disabled={busy}
              comboHint="أضف مادة: اكتب اسمها أو اكبس لعرضها كلّها…" />
            <ConsumablesCounter hint={false} label="المستهلكات المعتادة" value={usualCons} onChange={setUsualCons} disabled={busy} />
            {(usualMats.length > 0 || usualCons > 0) && price.trim() !== '' && (
              <p className="pcx-split-out">على المريض بالعادة: أجرة {fmtMoney(price)}
                {usualCons > 0 && ` + مستهلكات ${fmtMoney(usualCons)}`}
                {materialsValue(usualMats, matCatalog) > 0 && ` + مواد ${fmtMoney(materialsValue(usualMats, matCatalog))}`}
                {' = '}<strong>{fmtMoney(Number(price) + usualCons + materialsValue(usualMats, matCatalog))}</strong></p>
            )}
          </fieldset>
        )}
        <ProcedureSpecialties id="pcx-spec" isGeneral={spec.isGeneral} specialtyIds={spec.specialtyIds} canAdd onChange={setSpec} />
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : isNew ? 'إضافة الإجراء' : 'حفظ التعديل'}</button>
        </div>
      </form>
      {!isNew && (
        <div className="pcx-more">
          <h4>أدوات أخرى</h4>
          <div className="pcx-more-btns">
            {/* قواعد الدكاترة لا تدخل الإجراءات بعد القلبة — التقسيم أعلاه وحده */}
            {proc.is_active && !feeMode && <button type="button" className="ghost" disabled={busy} onClick={onDistribute}>تطبيق قاعدة على دكاترة</button>}
            {canHistory && <button type="button" className="ghost" disabled={busy} onClick={onHistory}>تاريخ التسعيرة</button>}
            <button type="button" className={`ghost${proc.is_active ? ' refx-danger' : ''}`} disabled={busy} onClick={onToggle}>
              {proc.is_active ? 'تعطيل الإجراء' : 'تفعيل الإجراء'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
