import { useEffect, useState } from 'react'
import { api, fmtDateTime, fmtMoney, toLatinDigits } from '../api.js'

// ═══ حساب الدكتور: يومية + ساعة (قبضان) أو سعرٌ للمريض ═══
// للمشرفة كتابةً وللمدير والمشرف العام اطّلاعاً (FUND_* في الخادم) — والطبيب لا يراه، فلا
// يُقرأ من بروفايل الدكتور (d.* يصل لكلّ أدوار العيادات) بل من مساره المحروس.
// يُحسب ويُعرض في «حسابات الدكاترة» ولوحة الدكتور فقط، ولا يُسحب من أيّ صندوق.
// «راتب شهري ثابت» قديم: يبقى لمن عليه ويُعرض، ولا يُختار من جديد.
// «تحاسبه: يومي / شهري» علامة تنظيمٍ وحدها — لا تغيّر أيّ رقم.
const KINDS = [['daily_hourly', 'يومية + ساعة'], ['per_patient', 'حسب عدد المرضى']]
const LEGACY = ['fixed', 'راتب شهري ثابت (قديم)']
const CYCLES = [['daily', 'يومي'], ['monthly', 'شهري']]
const cycleText = (c) => (c === 'daily' ? 'يومي' : c === 'monthly' ? 'شهري' : null)
const kindText = (k, a, daily, hourly) => {
  if (k === 'daily_hourly') return `يومية ${fmtMoney(daily)} + ساعة ${fmtMoney(hourly)}`
  if (k === 'fixed') return `راتب شهري ثابت ${fmtMoney(a)}`
  if (k === 'per_patient') return `${fmtMoney(a)} للمريض`
  return 'بلا'
}
const historyText = (h, side) => {
  const k = h[`${side}_kind`]
  const t = kindText(k, h[`${side}_amount`], h[`${side}_daily_rate`], h[`${side}_hourly_rate`])
  const c = k && cycleText(h[`${side}_cycle`])
  return c ? `${t} · ${c}` : t
}
const str = (v) => (v == null ? '' : String(v))

export default function DoctorPayCard({ doctorId, canEdit, showToast }) {
  const [data, setData] = useState(null)
  const [kind, setKind] = useState('')
  const [amount, setAmount] = useState('')
  const [daily, setDaily] = useState('')
  const [hourly, setHourly] = useState('')
  const [cycle, setCycle] = useState('monthly')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = () => api.clinic.doctorPay(doctorId).then((d) => {
    const dh = d.pay_kind === 'daily_hourly'
    setData(d); setKind(d.pay_kind || '')
    setAmount(dh ? '' : str(d.amount)); setDaily(dh ? str(d.daily_rate) : ''); setHourly(dh ? str(d.hourly_rate) : '')
    setCycle(d.settle_cycle || 'monthly'); setErr(null)
  }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [doctorId])

  const kinds = data?.pay_kind === 'fixed' ? [...KINDS, LEGACY] : KINDS
  const dirty = data && (kind !== (data.pay_kind || '') || (kind && (
    cycle !== (data.settle_cycle || 'monthly')
    || (kind === 'daily_hourly'
      ? daily.trim() !== str(data.daily_rate) || hourly.trim() !== str(data.hourly_rate)
      : amount.trim() !== str(data.amount)))))
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = !kind ? { pay_kind: null }
        : kind === 'daily_hourly' ? { pay_kind: kind, daily_rate: daily, hourly_rate: hourly, settle_cycle: cycle }
        : { pay_kind: kind, amount, settle_cycle: cycle }
      const r = await api.clinic.setDoctorPay(doctorId, body)
      showToast(r.pay_kind ? `حُفظ: ${kindText(r.pay_kind, r.amount, r.daily_rate, r.hourly_rate)}` : 'أُزيل نوع الحساب', 'success', 3500)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const moneyField = (id, label, value, set) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} inputMode="decimal" placeholder="0"
        onChange={(e) => set(toLatinDigits(e.target.value))} />
    </div>
  )

  return (
    <div className="card">
      <h3>حساب الدكتور</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        يومية + ساعة: الدكتور يقبض الاثنين — أيام حضوره × اليومية + ساعاته (من الحضور للانصراف) × سعر الساعة.
        يُعرض في «حسابات الدكاترة» ولوحة الدكتور مع حصّة الشفاء منه. لا يُسحب من أيّ صندوق، ولا يراه الدكتور.
      </p>
      {err && <p className="error">{err}</p>}
      {!data ? (!err && <p className="empty">جارٍ التحميل…</p>) : canEdit ? (
        <>
          <div className="seg fund-pay-kind" role="radiogroup" aria-label="نوع الحساب">
            {kinds.map(([k, label]) => (
              <label key={k} className={kind === k ? 'on' : undefined}><input type="radio" name={`pay-${doctorId}`} checked={kind === k}
                onChange={() => setKind(k)} />{label}</label>
            ))}
          </div>
          {kind === 'fixed' && (
            <p className="share-warn" style={{ marginTop: 10 }}>
              نوعٌ قديم: يُحسب للشهر الكامل وحده. للانتقال اختر «يومية + ساعة» واكتب الرقمين.
            </p>
          )}
          {kind && (
            <>
              <div className="share-general pay-fields" style={{ marginTop: 12 }}>
                {kind === 'daily_hourly' ? (
                  <>
                    {moneyField(`pay-daily-${doctorId}`, 'اليومية الثابتة (ل.س عن كل يوم حضور)', daily, setDaily)}
                    {moneyField(`pay-hourly-${doctorId}`, 'سعر الساعة (ل.س)', hourly, setHourly)}
                  </>
                ) : moneyField(`pay-amt-${doctorId}`, kind === 'fixed' ? 'الراتب الشهري (ل.س)' : 'سعر المريض الواحد (ل.س)', amount, setAmount)}
              </div>
              <div className="pay-cycle">
                <span id={`pay-cycle-${doctorId}`}>تحاسبه:</span>
                <div className="seg" role="radiogroup" aria-labelledby={`pay-cycle-${doctorId}`}>
                  {CYCLES.map(([c, label]) => (
                    <label key={c} className={cycle === c ? 'on' : undefined}><input type="radio" name={`cycle-${doctorId}`}
                      checked={cycle === c} onChange={() => setCycle(c)} />{label}</label>
                  ))}
                </div>
                <span className="attn-compact-hint">للتنظيم والعرض فقط — لا يغيّر الحساب.</span>
              </div>
              <div className="bf-actions">
                <button type="button" disabled={busy || !dirty} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
              </div>
            </>
          )}
          {data.pay_kind && (
            <button type="button" className="link-btn" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => { setKind(''); setAmount(''); setDaily(''); setHourly('') }}>إزالة نوع الحساب</button>
          )}
          {!kind && data.pay_kind && (
            <div className="bf-actions"><button type="button" disabled={busy} onClick={save}>تأكيد الإزالة</button></div>
          )}
        </>
      ) : (
        <p>نوع الحساب: <strong>{kindText(data.pay_kind, data.amount, data.daily_rate, data.hourly_rate)}</strong>
          {data.pay_kind && <> · تحاسبه: <strong>{cycleText(data.settle_cycle)}</strong></>}</p>
      )}
      {data && data.history.length > 0 && (
        <ul className="change-log" style={{ marginTop: 12 }}>
          {data.history.map((h) => (
            <li key={h.id}>
              <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
              <span>{historyText(h, 'old')} ← {historyText(h, 'new')}</span>
              <span className="muted">— {h.by_name || 'غير معروف'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
