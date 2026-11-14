import { useState } from 'react'
import { ProcedureSpecialties, specialtiesText } from '../../SpecialtyPicker.jsx'
import { useDialogs } from '../../dialogs.jsx'
import { api, fmtMoney, toLatinDigits } from '../../api.js'
import { Modal } from '../inventory/shared.jsx'

// ═══ نافذة الإجراء: إضافة جديد، أو فتح إجراءٍ قائم ═══
// الكتالوج لا يحمل أزراراً على كلّ بطاقة (كانت خمسة أزرار في كلّ صفّ): بطاقةٌ تُفتح فتجمع هنا
// كلّ ما يخصّ الإجراء — الاسم والسعر والمستهلكات والاختصاصات، ثمّ «تطبيق قاعدة على دكاترة»
// و«تاريخ التسعيرة» و«تعطيل». المشرفة تكتب، والمدير يطالع ويرى التاريخ (PRICING_HISTORY_READERS).
// تعديل السعر أو المستهلكات يسري على ما يُضاف بعده فقط — ويُسأل عنه بتأكيدٍ صريح كما كان.

const specKey = (sp) => (sp.isGeneral ? 'general' : [...sp.specialtyIds].map(String).sort().join(','))
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const timesText = (n) => (n === 0 ? 'لم يُستعمل بعد' : n === 1 ? 'استُعمل مرّةً واحدة' : n === 2 ? 'استُعمل مرّتين'
  : `استُعمل ${fmtNum(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'مرّات' : 'مرّة'}`)

export default function ProcedureDialog({ proc, canEdit, canHistory, seesConsumables, onClose, onSaved, onDistribute, onHistory, onToggle }) {
  const dlg = useDialogs()
  const isNew = !proc
  const [name, setName] = useState(proc?.name || '')
  const [price, setPrice] = useState(proc ? String(Number(proc.price)) : '')
  const [cons, setCons] = useState(proc ? String(Number(proc.consumables_cost || 0)) : '')
  const initialSpec = proc
    ? { isGeneral: !!proc.is_general || !(proc.specialties || []).length,
        specialtyIds: proc.is_general ? [] : (proc.specialties || []).map((x) => String(x.id)) }
    : { isGeneral: true, specialtyIds: [] }
  const [spec, setSpec] = useState(initialSpec)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) return setErr('اكتب اسم الإجراء')
    if (price.trim() === '') return setErr('اكتب السعر')
    if (isNew) {
      setBusy(true)
      try {
        const created = await api.clinic.addProcedure({ name, price, consumables_cost: cons })
        let warn = created?.warnings || []
        if (!spec.isGeneral && created?.id) {
          try {
            await api.clinic.setProcedureSpecialties(created.id, { is_general: false, specialty_ids: spec.specialtyIds.map(Number) })
          } catch (ex) { warn = [...warn, `أُنشئ عامّاً — تعذّر إسناد الاختصاصات (${ex.message})`] }
        }
        onSaved(`أُضيف «${name.trim()}»`, warn)
      } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
      return
    }
    const body = {}
    if (name.trim() !== proc.name) body.name = name
    if (Number(price) !== Number(proc.price)) body.price = price
    if (Number(cons || 0) !== Number(proc.consumables_cost || 0)) body.consumables_cost = cons || '0'
    const specChanged = specKey(spec) !== specKey(initialSpec)
    if (Object.keys(body).length === 0 && !specChanged) return onClose()
    if (body.price !== undefined) {
      const ok = await dlg.confirm({
        title: 'تغيير السعر',
        body: `تغيير سعر «${proc.name}» من ${fmtMoney(proc.price)} إلى ${fmtMoney(price)}؟\n`
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
      onSaved('حُفظ التعديل', out?.warnings || [])
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  // للاطّلاع وحده (المدير والمجلس): البيانات نصّاً، ولا حقول
  if (!canEdit && proc) {
    return (
      <Modal title={proc.name} sheet onClose={onClose}
        subtitle={proc.is_active ? timesText(proc.times_used) : `معطَّل — ${timesText(proc.times_used)}`}>
        <dl className="pcx-facts">
          <div><dt>السعر</dt><dd>{fmtMoney(proc.price)}</dd></div>
          {seesConsumables && <div><dt>المستهلكات المقدّرة</dt><dd>{Number(proc.consumables_cost) > 0 ? fmtMoney(proc.consumables_cost) : 'لا شيء'}</dd></div>}
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
        ? 'يظهر للاستقبال عند دكاترة اختصاصاته. والسعر هو ما يدفعه المريض.'
        : `${proc.is_active ? '' : 'معطَّل — '}${timesText(proc.times_used)}${by ? `، آخر تعديل: ${by}` : ''}${at ? ` (${new Date(at).toLocaleDateString('ar-SY', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}`}>
      <form className="inv-form pcx-form" onSubmit={submit}>
        <div className="field"><label htmlFor="pcx-name">اسم الإجراء</label>
          <input id="pcx-name" value={name} maxLength={150} autoFocus={isNew} placeholder="مثال: تخطيط قلب"
            onChange={(e) => setName(e.target.value)} /></div>
        <div className="pcx-row">
          {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
          <div className="field"><label htmlFor="pcx-price">السعر (ل.س)</label>
            <input id="pcx-price" value={price} inputMode="decimal" placeholder="0"
              onChange={(e) => setPrice(toLatinDigits(e.target.value))} /></div>
          <div className="field"><label htmlFor="pcx-cons">المستهلكات المقدّرة (ل.س)</label>
            <input id="pcx-cons" value={cons} inputMode="decimal" placeholder="0"
              onChange={(e) => setCons(toLatinDigits(e.target.value))} /></div>
        </div>
        <p className="pcx-hint">المستهلكات: قطنٌ وشاشٌ وبيتادين يستهلكها الإجراء كلّ مرّة — تُطرح من مبلغه لصندوق العيادات مع المواد.
          {!isNew && ' وتغيير السعر أو المستهلكات يسري على ما يُضاف بعد الحفظ فقط.'}</p>
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
            {proc.is_active && <button type="button" className="ghost" disabled={busy} onClick={onDistribute}>تطبيق قاعدة على دكاترة</button>}
            {canHistory && <button type="button" className="ghost" disabled={busy} onClick={onHistory}>تاريخ التسعيرة</button>}
            <button type="button" className={`ghost${proc.is_active ? ' refx-danger' : ''}`} disabled={busy} onClick={onToggle}>
              {proc.is_active ? 'تعطيل الإجراء' : 'تفعيل الإجراء'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
