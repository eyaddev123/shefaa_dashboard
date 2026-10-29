import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ProcedureSpecialties, specialtiesText } from '../SpecialtyPicker.jsx'
import { useDialogs } from '../dialogs.jsx'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import ProcedureReview from './ProcedureReview.jsx'
import ProcedureEarnings from './ProcedureEarnings.jsx'
import { canSeeEarnings } from '../permissions.js'
import { DistributeRuleDialog, PricingHistoryDialog } from '../components/ShareRuleDialogs.jsx'
import { doctorsCount } from '../share-rule.js'

// ═══ العيادات — الإجراءات ═══
// كتالوج عام لكل الدكاترة: اسم وسعر، بلا كمية. مسؤول العيادات يضيف ويعدّل ويعطّل —
// ولا حذف (الحجوزات تشير إليه). تعديل السعر يسري على ما يُضاف بعده فقط: كل حجز
// يحمل نسخة السعر لحظة إضافته. المجلس والمشرف العام والمدير يطالعون فقط.
// ومن كل إجراء: «تطبيق قاعدة على دكاترة» (المشرفة) يكتب قاعدةً خاصّة عند عدّة دكاترة دفعةً
// واحدة، و«تاريخ التسعيرة» (المشرفة والمدير) خطٌّ زمنيّ للسعر والقواعد — يطابق الخادم.
const PRICING_HISTORY_READERS = ['clinic_admin', 'manager']

// من يرى المراجعة (المواد بأسعارها والتقسيم) — يطابق SETTLEMENT_VIEWERS في الخادم.
// الاستقبال غائبٌ عمداً (ولا يرى الصفحة أصلاً): يُدخل الإجراء وموادّه، ولا شأن له بالتقسيم.
// كتالوج المواد واستهلاكها ليسا هنا: صفحة «المخزون» المكان الوحيد لإدارتهما.
const SETTLEMENT_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']
// «المستحقات» تبويبٌ هنا لا صفحةٌ في القائمة: مصدرها لقطات الأسطر نفسها التي تعرضها
// «المراجعة»، ومن يراها يرى الصفحة أصلاً. يُخفى عن المجلس (canSeeEarnings) والخادم يردّه 403.
// التبويب في الرابط (?tab=) فيبقى بعد التحديث، ويُفتح من رابطٍ مباشر.
const TABS = [
  { key: 'catalog', label: 'الإجراءات' },
  { key: 'review', label: 'المراجعة' },
  { key: 'earnings', label: 'المستحقات', allow: canSeeEarnings },
]

function NewProcedureForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', price: '' })
  // «عام» افتراضاً: إجراءٌ جديد يظهر للجميع حتى يُسنده المشرف — لا يختفي بصمت
  const [spec, setSpec] = useState({ isGeneral: true, specialtyIds: [] })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const created = await api.clinic.addProcedure({ name: form.name, price: form.price })
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
      setForm({ name: '', price: '' })
      setSpec({ isGeneral: true, specialtyIds: [] })
      onCreated(form.name.trim())
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  // سطرٌ واحد: الاسم · السعر · الاختصاصات · الزرّ — بارتفاعٍ واحد وعلى خطٍّ واحد
  return (
    <form className="proc-form" onSubmit={submit}>
      <div className="field"><label htmlFor="new-proc-name">اسم الإجراء</label>
        <input id="new-proc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150}
          placeholder="مثال: تخطيط قلب" required /></div>
      {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
      <div className="field"><label htmlFor="new-proc-price">السعر (ل.س)</label>
        <input id="new-proc-price" value={form.price} inputMode="decimal" placeholder="0"
          onChange={(e) => setForm({ ...form, price: toLatinDigits(e.target.value) })} required /></div>
      <ProcedureSpecialties id="new-proc-spec" isGeneral={spec.isGeneral} specialtyIds={spec.specialtyIds}
        canAdd onChange={setSpec} />
      <button type="submit" className="proc-form-btn" disabled={busy}>{busy ? 'جارٍ الإضافة…' : 'إضافة'}</button>
      {err && <p className="error proc-form-err">{err}</p>}
    </form>
  )
}

// تعديل الاسم والسعر والاختصاصات في الصفّ نفسه — بنفس مكوّن الإضافة
const specKey = (sp) => (sp.isGeneral ? 'general' : [...sp.specialtyIds].map(String).sort().join(','))
function EditRow({ proc, onSaved, onCancel }) {
  // onSaved(warnings): سعرٌ نزل تحت مبلغٍ ثابت عند دكتور يرجع بتحذيرٍ من الخادم
  const dlg = useDialogs()
  const [name, setName] = useState(proc.name)
  const [price, setPrice] = useState(String(Number(proc.price)))
  const initialSpec = {
    isGeneral: !!proc.is_general || !(proc.specialties || []).length,
    specialtyIds: proc.is_general ? [] : (proc.specialties || []).map((x) => String(x.id)),
  }
  const [spec, setSpec] = useState(initialSpec)
  const specChanged = specKey(spec) !== specKey(initialSpec)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const body = {}
    if (name.trim() !== proc.name) body.name = name
    if (Number(price) !== Number(proc.price) || price.trim() === '') body.price = price
    if (Object.keys(body).length === 0 && !specChanged) return onCancel()
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
    try {
      const out = Object.keys(body).length ? await api.clinic.updateProcedure(proc.id, body) : null
      // الاختصاصات بمسارها الذرّيّ (مسحٌ ثمّ إدراج في معاملةٍ واحدة)
      if (specChanged) await api.clinic.setProcedureSpecialties(proc.id,
        { is_general: spec.isGeneral, specialty_ids: spec.isGeneral ? [] : spec.specialtyIds.map(Number) })
      onSaved(out?.warnings || [])
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }
  return (
    <tr className="proc-editing">
      <td className="rt-full"><input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} aria-label="اسم الإجراء" /></td>
      <td className="rt-full"><input value={price} inputMode="decimal" style={{ width: 130 }} aria-label="السعر"
        onChange={(e) => setPrice(toLatinDigits(e.target.value))} /></td>
      <td className="proc-edit-spec rt-full">
        <ProcedureSpecialties id={`edit-spec-${proc.id}`} hideLabel isGeneral={spec.isGeneral}
          specialtyIds={spec.specialtyIds} canAdd onChange={setSpec} />
      </td>
      <td colSpan={4} className="rt-full">
        <div className="inline proc-edit-actions" style={{ gap: 6 }}>
          <button onClick={save} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>حفظ</button>
          <button className="ghost" onClick={onCancel} style={{ padding: '4px 12px', fontSize: 12 }}>إلغاء</button>
        </div>
        {err && <p className="error" style={{ margin: '6px 0 0' }}>{err}</p>}
      </td>
    </tr>
  )
}

export default function ClinicProcedures() {
  const dlg = useDialogs()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)
  const [params, setParams] = useSearchParams()
  const [toast, showToast] = useToast()
  const { role } = useRole()
  const tabs = SETTLEMENT_VIEWERS.includes(role) ? TABS.filter((t) => !t.allow || t.allow(role)) : []
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'catalog'
  // تبديل التبويب يمسح معاملات التبويب السابق (فترة المستحقات ودكتورها)
  const setTab = (key) => setParams(key === 'catalog' ? {} : { tab: key }, { replace: true })
  const canEdit = role === 'clinic_admin'
  const canHistory = PRICING_HISTORY_READERS.includes(role)
  const [distributing, setDistributing] = useState(null)   // الإجراء الذي تُوزَّع قاعدته
  const [historyOf, setHistoryOf] = useState(null)

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
        الاستقبال يضيف الإجراء على الحجز بعد دخول المريض، ومعه المواد المستعملة فعلاً بكمّياتها؛
        فتُحسب المواد وحصّة الدكتور وحصّة الشفاء <strong>فوراً</strong> وتُثبَّت، وتنزل المواد من رصيد
        المخزون تلقائياً. والمريض يدفع سعر الإجراء كما هو دائماً. تعديل الأسعار والقواعد يسري على ما
        يُضاف بعده فقط. لا حذف: المُستغنى عنه يُعطَّل. كتالوج المواد وأسعارها واستهلاكها في صفحة <Link to="/inventory">«المخزون»</Link>.
      </p>
      {toast}

      {/* الصفحة لا يراها الاستقبال أصلاً — والخادم يرفض مساراتها بـ403 لا الواجهة وحدها */}
      {tabs.length > 0 && (
        <div className="inline proc-tabs" role="tablist" style={{ gap: 8, marginBottom: 14 }}>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              className={tab === t.key ? '' : 'ghost'} style={{ padding: '6px 16px' }}
              onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      )}

      {tab === 'review' ? <ProcedureReview canEdit={canEdit} showToast={showToast} />
      : tab === 'earnings' ? <ProcedureEarnings showToast={showToast} />
      : (
      <div className="card">
        <h3>الكتالوج ({list.length} — المفعَّل {active})</h3>
        {canEdit
          ? <NewProcedureForm onCreated={(name) => { showToast(`أُضيف «${name}»`, 'success', 3000); load() }} />
          : <p className="subtitle" style={{ marginTop: -6 }}>للاطّلاع فقط — يديره مسؤول العيادات.</p>}
        <table className="rtable" style={{ marginTop: 14 }}>
          <thead>
            <tr><th>الإجراء</th><th>السعر الحالي</th><th>الاختصاصات</th><th>الحالة</th><th>استُعمل</th><th>آخر تعديل</th>{canHistory && <th></th>}</tr>
          </thead>
          <tbody>
            {list.map((p) => editing === p.id ? (
              <EditRow key={p.id} proc={p} onCancel={() => setEditing(null)}
                onSaved={(warnings) => {
                  setEditing(null); load()
                  if (warnings.length) showToast(`حُفظ التعديل — ⚠ ${warnings.join('، ')}`, 'warning', 8000)
                  else showToast('حُفظ التعديل', 'success', 3000)
                }} />
            ) : (
              <tr key={p.id} className={p.is_active ? undefined : 'proc-inactive'}>
                <td className="rt-title">{p.name}</td>
                <td className="num" data-label="السعر الحالي">{fmtMoney(p.price)}</td>
                <td className="proc-spec-cell rt-full" data-label="الاختصاصات">
                  {specialtiesText(p) === 'عام' ? <span className="badge">عام</span> : specialtiesText(p)}
                </td>
                <td className="rt-badge">{p.is_active ? <span className="badge good">مفعَّل</span> : <span className="badge">معطَّل</span>}</td>
                <td className="num" data-label="استُعمل">{p.times_used} حجز</td>
                <td className="proc-meta-cell" data-label="آخر تعديل" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.updated_by_name || p.created_by_name || '—'}
                  {(p.updated_at || p.created_at) && (
                    <span dir="ltr" style={{ marginInlineStart: 6 }}>
                      {new Date(p.updated_at || p.created_at).toLocaleDateString('en-CA')}
                    </span>
                  )}
                </td>
                {canHistory && (
                  <td className="proc-actions-cell rt-actions">
                    {canEdit && <>
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                        onClick={() => setEditing(p.id)}>تعديل</button>{' '}
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                        onClick={() => toggleActive(p)}>{p.is_active ? 'تعطيل' : 'تفعيل'}</button>{' '}
                      {/* القاعدة الموزَّعة تُكتب لإجراءٍ مفعَّل وحده — المعطَّل لا يُضاف لحجز أصلاً */}
                      {p.is_active && (
                        <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                          onClick={() => setDistributing(p)}>تطبيق قاعدة على دكاترة</button>
                      )}{' '}
                    </>}
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => setHistoryOf(p)}>تاريخ التسعيرة</button>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={canHistory ? 7 : 6} className="empty">لا إجراءات بعد{canEdit ? ' — أضف أولها أعلاه' : ''}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {distributing && (
        <DistributeRuleDialog procedure={distributing} onClose={() => setDistributing(null)}
          onDone={(out) => {
            setDistributing(null)
            const parts = [out.added && `أُضيفت عند ${doctorsCount(out.added)}`, out.replaced && `استُبدلت عند ${doctorsCount(out.replaced)}`,
              out.skipped && `تُخطّي ${doctorsCount(out.skipped)}`].filter(Boolean)
            const text = `«${out.procedure_name}»: ${parts.join('، ') || 'لا تغيير'}`
            if (out.warnings?.length) showToast(`${text} — ⚠ ${out.warnings.join('، ')}`, 'warning', 8000)
            else showToast(text, 'success', 4500)
          }} />
      )}
      {historyOf && <PricingHistoryDialog procedure={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  )
}
