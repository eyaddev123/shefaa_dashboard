import { useEffect, useState } from 'react'
import { api, fmtDateTime, fmtMoney, toLatinDigits } from '../api.js'

// ═══ حساب الدكتور الشهريّ: راتبٌ ثابت أو سعرٌ للمريض ═══
// للمشرفة كتابةً وللمدير والمشرف العام اطّلاعاً (FUND_* في الخادم) — والطبيب لا يراه، فلا
// يُقرأ من بروفايل الدكتور (d.* يصل لكلّ أدوار العيادات) بل من مساره المحروس.
// يُحسب ويُعرض في «صندوق العيادات ← حسابات الدكاترة» فقط، ولا يُسحب من أيّ صندوق.
const KINDS = [['fixed', 'راتب شهري ثابت'], ['per_patient', 'حسب عدد المرضى']]
const kindText = (k, a) => (k === 'fixed' ? `راتب ثابت ${fmtMoney(a)}` : k === 'per_patient' ? `${fmtMoney(a)} للمريض` : 'بلا')

export default function DoctorPayCard({ doctorId, canEdit, showToast }) {
  const [data, setData] = useState(null)
  const [kind, setKind] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = () => api.clinic.doctorPay(doctorId).then((d) => {
    setData(d); setKind(d.pay_kind || ''); setAmount(d.amount == null ? '' : String(d.amount)); setErr(null)
  }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [doctorId])

  const dirty = data && (kind !== (data.pay_kind || '') || (kind && amount.trim() !== String(data.amount ?? '')))
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api.clinic.setDoctorPay(doctorId, kind ? { pay_kind: kind, amount } : { pay_kind: null })
      showToast(r.pay_kind ? `حُفظ: ${kindText(r.pay_kind, r.amount)}` : 'أُزيل نوع الحساب', 'success', 3500)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <h3>الحساب الشهري</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        يُعرض في «صندوق العيادات ← حسابات الدكاترة» مع حصّة الشفاء منه. المرضى = الكشوف المنتهية.
        لا يُسحب من أيّ صندوق، ولا يراه الدكتور.
      </p>
      {err && <p className="error">{err}</p>}
      {!data ? (!err && <p className="empty">جارٍ التحميل…</p>) : canEdit ? (
        <>
          <div className="seg fund-pay-kind" role="radiogroup" aria-label="نوع الحساب">
            {KINDS.map(([k, label]) => (
              <label key={k} className={kind === k ? 'on' : undefined}><input type="radio" name={`pay-${doctorId}`} checked={kind === k}
                onChange={() => setKind(k)} />{label}</label>
            ))}
          </div>
          {kind && (
            <div className="share-general" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor={`pay-amt-${doctorId}`}>{kind === 'fixed' ? 'الراتب الشهري (ل.س)' : 'سعر المريض الواحد (ل.س)'}</label>
                <input id={`pay-amt-${doctorId}`} value={amount} inputMode="decimal" placeholder="0"
                  onChange={(e) => setAmount(toLatinDigits(e.target.value))} />
              </div>
              <button type="button" disabled={busy || !dirty} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            </div>
          )}
          {data.pay_kind && (
            <button type="button" className="link-btn" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => { setKind(''); setAmount('') }}>إزالة نوع الحساب</button>
          )}
          {!kind && data.pay_kind && (
            <div className="bf-actions"><button type="button" disabled={busy} onClick={save}>تأكيد الإزالة</button></div>
          )}
        </>
      ) : (
        <p>نوع الحساب: <strong>{kindText(data.pay_kind, data.amount)}</strong></p>
      )}
      {data && data.history.length > 0 && (
        <ul className="change-log" style={{ marginTop: 12 }}>
          {data.history.map((h) => (
            <li key={h.id}>
              <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
              <span>{kindText(h.old_kind, h.old_amount)} ← {kindText(h.new_kind, h.new_amount)}</span>
              <span className="muted">— {h.by_name || 'غير معروف'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
