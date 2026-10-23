import { useEffect, useState } from 'react'
import { api, fmtMoney } from '../api.js'

// ═══ حصّة الدكتور من الإجراءات ═══
// نسبةٌ عامّة لكل إجراءاته (تُحسب **بعد** خصم المواد)، وحالاتٌ خاصّة لإجراءٍ بعينه
// تغلبها: مبلغٌ ثابت (لا تمسّه المواد) أو نسبةٌ أخرى. وبلا قاعدةٍ تكون حصّته صفراً
// بتحذيرٍ في صفحة المراجعة — لا منع.
//
// ★ تغيير قاعدةٍ هنا يسري على الإجراءات **القادمة** وحدها: كلُّ سطرٍ قائم يحمل
//   لقطة القاعدة لحظة إضافته، ولا يتغيّر ولو عُدّلت موادّه لاحقاً.
export default function DoctorShareRules({ doctor, canEdit, onSaved }) {
  // قاعدةٌ عامّة «ثابتة» من التصميم السابق تُعرض كما هي حتى تُستبدل بنسبة
  const legacyFixed = doctor.share_kind === 'fixed'
  const [value, setValue] = useState(doctor.share_kind === 'percent' ? String(Number(doctor.share_value)) : '')
  const [rules, setRules] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [adding, setAdding] = useState({ procedure_id: '', kind: 'fixed', value: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // {text, ok}

  const load = () => {
    api.clinic.doctorProcedureShares(doctor.id).then(setRules).catch((e) => setMsg({ text: e.message }))
    if (canEdit && !catalog) api.clinic.procedures().then((r) => setCatalog(r.filter((x) => x.is_active)))
      .catch(() => {})
  }
  useEffect(() => { load() }, [doctor.id])

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ text: okText, ok: true }); load(); if (onSaved) onSaved() }
    catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }
  const saveGeneral = () => run(() => api.clinic.setDoctorShare(doctor.id,
    value.trim() === '' ? { share_kind: null } : { share_kind: 'percent', share_value: value }),
  value.trim() === '' ? 'أُزيلت النسبة العامّة — حصّته صفر حتى تُضبط' : 'حُفظت النسبة العامّة')
  const addSpecific = () => {
    if (!adding.procedure_id) { setMsg({ text: 'اختر الإجراء' }); return }
    run(async () => {
      await api.clinic.setDoctorProcedureShare(doctor.id, adding.procedure_id,
        { share_kind: adding.kind, share_value: adding.value })
      setAdding({ procedure_id: '', kind: 'fixed', value: '' })
    }, 'حُفظت الحالة الخاصّة')
  }
  const removeSpecific = (r) => run(() => api.clinic.removeDoctorProcedureShare(doctor.id, r.procedure_id),
    `أُزيلت الحالة الخاصّة لـ«${r.procedure_name}» — تُطبَّق عليه النسبة العامّة`)

  const generalText = !doctor.share_kind ? null
    : doctor.share_kind === 'percent' ? `${Number(doctor.share_value)}٪ بعد خصم المواد`
    : `مبلغ ثابت ${fmtMoney(doctor.share_value)} (قاعدة قديمة)`
  const ruled = new Set((rules || []).map((r) => String(r.procedure_id)))

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
        <div className="inline" style={{ alignItems: 'flex-end', gap: 8 }}>
          <div className="field">
            <label>النسبة العامّة لكل إجراءاته ٪</label>
            <input value={value} inputMode="decimal" style={{ width: 110 }} placeholder="مثلاً 50"
              onChange={(e) => setValue(e.target.value)} />
          </div>
          <button type="button" disabled={busy} onClick={saveGeneral}
            style={{ padding: '6px 14px', fontSize: 12.5 }}>حفظ النسبة</button>
        </div>
      ) : (
        <p>النسبة العامّة: <strong>{generalText || 'بلا قاعدة (صفر)'}</strong></p>
      )}

      <h4 style={{ margin: '16px 0 6px' }}>حالات خاصّة لإجراءات بعينها</h4>
      {!rules ? <p className="empty">جارٍ التحميل…</p>
        : rules.length === 0 ? <p className="empty">لا حالات خاصّة — تُطبَّق النسبة العامّة على كل إجراءاته.</p>
        : (
          <table>
            <thead><tr><th>الإجراء</th><th>سعره الحالي</th><th>القاعدة</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.procedure_name}</td>
                  <td className="num">{fmtMoney(r.price)}</td>
                  <td>{r.share_kind === 'percent'
                    ? `${Number(r.share_value)}٪ بعد المواد`
                    : `مبلغ ثابت ${fmtMoney(r.share_value)}`}</td>
                  {canEdit && (
                    <td>
                      <button type="button" className="ghost" disabled={busy}
                        style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => removeSpecific(r)}>إزالة</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {canEdit && (
        <div className="inline" style={{ alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
          <div className="field">
            <label>إجراء</label>
            <select value={adding.procedure_id}
              onChange={(e) => setAdding({ ...adding, procedure_id: e.target.value })}>
              <option value="">— اختر —</option>
              {(catalog || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{ruled.has(String(c.id)) ? ' (له حالة — تُستبدل)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>النوع</label>
            <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
              <option value="fixed">مبلغ ثابت</option>
              <option value="percent">نسبة ٪ مختلفة</option>
            </select>
          </div>
          <div className="field">
            <label>{adding.kind === 'percent' ? 'النسبة ٪' : 'المبلغ'}</label>
            <input value={adding.value} inputMode="decimal" style={{ width: 110 }}
              onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
          </div>
          <button type="button" className="ghost" disabled={busy} onClick={addSpecific}
            style={{ padding: '6px 14px', fontSize: 12.5 }}>إضافة حالة خاصّة</button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'success-text' : 'error'} style={{ marginTop: 8 }}>{msg.text}</p>}
    </div>
  )
}
