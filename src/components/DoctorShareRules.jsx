import { useEffect, useState } from 'react'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { ShareRuleDialog } from './ShareRuleDialogs.jsx'
import { ruleText, afterDeleteText } from '../share-rule.js'

// ═══ حصّة الدكتور من الإجراءات ═══
// نسبةٌ عامّة لكل إجراءاته (تُحسب **بعد** خصم المواد)، وحالاتٌ خاصّة لإجراءٍ بعينه
// تغلبها: مبلغٌ ثابت (لا تمسّه المواد) أو نسبةٌ أخرى. وبلا قاعدةٍ تكون حصّته صفراً
// بتحذيرٍ في صفحة المراجعة — لا منع.
//
// الإدارة كلّها هنا للمشرفة: النسبة العامّة، وإضافة/تعديل/حذف القواعد الخاصّة (نافذة).
// والقاعدة الموزَّعة من صفحة الإجراءات قاعدةٌ خاصّة كغيرها، تُعدَّل وتُحذف من هنا.
// كلّ تغييرٍ سطرٌ في «سجلّ التعديلات» أسفل البروفايل وفي تاريخ تسعيرة الإجراء.
//
// ★ تغيير قاعدةٍ هنا يسري على الإجراءات **القادمة** وحدها: كلُّ سطرٍ قائم يحمل
//   لقطة القاعدة لحظة إضافته، ولا يتغيّر ولو عُدّلت موادّه لاحقاً.
const generalOf = (d) => (d.share_kind === 'percent' ? String(Number(d.share_value)) : '')
export default function DoctorShareRules({ doctor, canEdit, onSaved, showToast }) {
  const dlg = useDialogs()
  // قاعدةٌ عامّة «ثابتة» من التصميم السابق تُعرض كما هي حتى تُستبدل بنسبة
  const legacyFixed = doctor.share_kind === 'fixed'
  const [value, setValue] = useState(generalOf(doctor))
  const [rules, setRules] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [dialog, setDialog] = useState(null)   // {rule} — rule: null للإضافة
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // {text, ok}

  const load = () => {
    api.clinic.doctorProcedureShares(doctor.id).then(setRules).catch((e) => setMsg({ text: e.message }))
    if (canEdit && !catalog) api.clinic.procedures().then((r) => setCatalog(r.filter((x) => x.is_active)))
      .catch(() => {})
  }
  useEffect(() => { load() }, [doctor.id])
  useEffect(() => { setValue(generalOf(doctor)) }, [doctor.share_kind, doctor.share_value])

  // التحذير (ثابتٌ أعلى من السعر) يبقى ظاهراً أطول من نجاحٍ عادي
  const notify = (text, warnings = []) => {
    const full = warnings.length ? `${text} — ⚠ ${warnings.join('، ')}` : text
    if (showToast) showToast(full, warnings.length ? 'warning' : 'success', warnings.length ? 8000 : 3500)
    else setMsg({ text: full, ok: true })
  }
  const saveGeneral = async () => {
    const t = value.trim()
    if (t !== '' && (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > 100)) {
      setMsg({ text: /^-/.test(t) ? 'النسبة العامّة: لا يُقبل رقمٌ سالب' : 'النسبة العامّة: رقمٌ بين ٠ و١٠٠' }); return
    }
    setBusy(true); setMsg(null)
    try {
      await api.clinic.setDoctorShare(doctor.id, t === '' ? { share_kind: null } : { share_kind: 'percent', share_value: t })
      notify(t === '' ? 'أُزيلت النسبة العامّة — حصّته صفر حتى تُضبط' : `حُفظت النسبة العامّة ${t}٪`)
      if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }
  const removeRule = async (r) => {
    const ok = await dlg.confirm({
      title: `حذف قاعدة «${r.procedure_name}»`,
      body: `القاعدة الحالية: ${ruleText(r)}.\n${afterDeleteText(doctor)}.\nيسري على الإجراءات القادمة وحدها.`,
      confirmLabel: 'حذف القاعدة', danger: true,
    })
    if (!ok) return
    setBusy(true); setMsg(null)
    try {
      await api.clinic.removeDoctorProcedureShare(doctor.id, r.procedure_id)
      notify(`حُذفت قاعدة «${r.procedure_name}»`)
      load(); if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }

  const generalText = !doctor.share_kind ? null
    : doctor.share_kind === 'percent' ? `${Number(doctor.share_value)}٪ بعد خصم المواد`
    : `مبلغ ثابت ${fmtMoney(doctor.share_value)} (قاعدة قديمة)`

  return (
    <div className="card">
      <h3>حصّة الدكتور من الإجراءات</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        النسبة تُحسب <strong>بعد خصم المواد</strong>: (السعر − المواد) × النسبة. والمبلغ الثابت لا تمسّه
        المواد. والشفاء تأخذ الباقي. تغيير القواعد يسري على الإجراءات القادمة وحدها.
      </p>

      {!doctor.share_kind && (
        <p className="share-warn">⚠ لا نسبة عامّة لهذا الدكتور — حصّته من كل إجراءٍ بلا حالةٍ خاصّة صفر.</p>
      )}
      {legacyFixed && (
        <p className="share-warn">قاعدته العامّة مبلغٌ ثابت من التصميم السابق ({fmtMoney(doctor.share_value)}) —
          سارية حتى تُستبدل بنسبة. المبلغ الثابت مكانه الآن «حالة خاصّة» لإجراء.</p>
      )}

      {canEdit ? (
        <div className="share-general">
          <div className="field">
            <label htmlFor={`gen-share-${doctor.id}`}>النسبة العامّة لكل إجراءاته ٪</label>
            <input id={`gen-share-${doctor.id}`} value={value} inputMode="decimal" placeholder="مثلاً 50"
              onChange={(e) => setValue(toLatinDigits(e.target.value))} />
          </div>
          <button type="button" disabled={busy || value.trim() === generalOf(doctor)} onClick={saveGeneral}>حفظ النسبة</button>
        </div>
      ) : (
        <p>النسبة العامّة: <strong>{generalText || 'بلا قاعدة (صفر)'}</strong></p>
      )}

      <div className="share-rules-head">
        <h4>حالات خاصّة لإجراءات بعينها{rules ? ` (${rules.length})` : ''}</h4>
        {canEdit && <button type="button" disabled={busy || !catalog} onClick={() => setDialog({ rule: null })}>+ إضافة قاعدة</button>}
      </div>
      {!rules ? <p className="empty">جارٍ التحميل…</p>
        : rules.length === 0 ? <p className="empty">لا حالات خاصّة — تُطبَّق النسبة العامّة على كل إجراءاته.</p>
        : (
          <table className="rtable">
            <thead><tr><th>الإجراء</th><th>سعره الحالي</th><th>القاعدة</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rules.map((r) => {
                const above = r.share_kind === 'fixed' && Number(r.share_value) > Number(r.price)
                return (
                  <tr key={r.id}>
                    <td className="rt-title">{r.procedure_name}
                      {!r.procedure_active && <span className="badge" style={{ marginInlineStart: 6 }}>معطَّل</span>}</td>
                    <td className="num" data-label="سعره الحالي">{fmtMoney(r.price)}</td>
                    <td data-label="القاعدة">{ruleText(r)}
                      {above && <span className="badge bad" style={{ marginInlineStart: 6 }}
                        title="المبلغ الثابت أعلى من سعر الإجراء — حصّة الشفاء سالبة">أعلى من السعر</span>}</td>
                    {canEdit && (
                      <td className="rt-actions share-rule-actions">
                        <button type="button" className="ghost" disabled={busy}
                          onClick={() => setDialog({ rule: r })}>تعديل</button>
                        <button type="button" className="ghost danger-text" disabled={busy}
                          onClick={() => removeRule(r)}>حذف</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      {msg && <p className={msg.ok ? 'success-text' : 'error'} style={{ marginTop: 8 }} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      {dialog && (
        <ShareRuleDialog doctor={doctor} rule={dialog.rule} rules={rules} catalog={catalog}
          onClose={() => setDialog(null)}
          onSaved={(out, text) => {
            setDialog(null); notify(text, out?.warnings || []); load(); if (onSaved) onSaved()
          }} />
      )}
    </div>
  )
}
