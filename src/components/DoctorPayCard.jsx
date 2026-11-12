import { useEffect, useState } from 'react'
import { api, fmtDateTime, fmtMoney, toLatinDigits } from '../api.js'
import { PAY_PARTS, partsTitle, ratesText } from '../pay-parts.js'

// ═══ راتب الدكتور: مكوّنات تختارها المشرفة — مرضى · أيام · ساعات (2026-11-12) ═══
// الراتب = مجموع المكوّنات المختارة، ولكلٍّ سعره: المريض المنتهي كشفه · يوم الحضور · ساعة الدوام
// (من «وصل الطبيب» إلى «انصرف»). فيغطّي مرضى، أيام، ساعات، أيام + ساعات، مرضى + ساعات… وأيّ جمع.
// للمشرفة كتابةً وللمدير والمشرف العام اطّلاعاً (FUND_* في الخادم) — والطبيب لا يرى هذه البطاقة،
// فلا يُقرأ من بروفايل الدكتور (d.* يصل لكلّ أدوار العيادات) بل من مساره المحروس.
// يُحسب ويُعرض في «حسابات الدكاترة» ولوحة الدكتور و«راتبي» فقط، ولا يُسحب من أيّ صندوق.
// يُكتب دائماً بنوع `mixed`؛ «يومية + ساعة» و«حسب عدد المرضى» القديمان يُقرآن مكوّناتٍ ويتحوّلان عند الحفظ.
// «راتب شهري ثابت» أقدم منهما: يبقى لمن عليه ويُعرض، ولا يُختار من جديد.
const CYCLES = [['daily', 'يومي'], ['monthly', 'شهري']]
const cycleText = (c) => (c === 'daily' ? 'يومي' : c === 'monthly' ? 'شهري' : null)
const EXAMPLE = { patients: 20, days: 4, minutes: 12 * 60 }
const EXAMPLE_QTY = { patients: '٢٠ مريضاً', days: '٤ أيام', hours: '١٢ ساعة' }
const str = (v) => (v == null || Number(v) === 0 ? '' : String(v))
const toNum = (v) => { const n = Number(String(v || '').replace(/[,،٬\s]/g, '')); return Number.isFinite(n) ? n : NaN }

// إعدادٌ (من GET أو من سطر سجلّ) ⇒ { parts, patientRate, dailyRate, hourlyRate }
function partsOf(kind, amount, daily, hourly) {
  if (!kind || kind === 'fixed') return null
  const r = {
    patientRate: kind === 'daily_hourly' ? 0 : Number(amount || 0),
    dailyRate: kind === 'per_patient' ? 0 : Number(daily || 0),
    hourlyRate: kind === 'per_patient' ? 0 : Number(hourly || 0),
  }
  return { ...r, parts: PAY_PARTS.filter((p) => r[p.rate] > 0).map((p) => p.key) }
}
function settingText(kind, amount, daily, hourly) {
  if (!kind) return 'بلا'
  if (kind === 'fixed') return `راتب شهري ثابت ${fmtMoney(amount)}`
  const p = partsOf(kind, amount, daily, hourly)
  return p.parts.length ? `${partsTitle(p.parts)}: ${ratesText(p.parts, p)}` : 'بلا أسعار'
}
const historyText = (h, side) => {
  const k = h[`${side}_kind`]
  const t = settingText(k, h[`${side}_amount`], h[`${side}_daily_rate`], h[`${side}_hourly_rate`])
  const c = k && cycleText(h[`${side}_cycle`])
  return c ? `${t} · ${c}` : t
}

export default function DoctorPayCard({ doctorId, canEdit, showToast }) {
  const [data, setData] = useState(null)
  const [on, setOn] = useState({ patients: false, days: false, hours: false })
  const [rate, setRate] = useState({ patients: '', days: '', hours: '' })
  const [cycle, setCycle] = useState('monthly')
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const fromData = (d) => {
    const p = partsOf(d.pay_kind, d.amount, d.daily_rate, d.hourly_rate)
    setOn({ patients: !!p?.parts.includes('patients'), days: !!p?.parts.includes('days'), hours: !!p?.parts.includes('hours') })
    setRate({ patients: str(p?.patientRate), days: str(p?.dailyRate), hours: str(p?.hourlyRate) })
    setCycle(d.settle_cycle || 'monthly'); setRemoving(false)
  }
  const load = () => api.clinic.doctorPay(doctorId).then((d) => { setData(d); fromData(d); setErr(null) })
    .catch((e) => setErr(e.message))
  useEffect(() => { load() }, [doctorId])

  const saved = data && partsOf(data.pay_kind, data.amount, data.daily_rate, data.hourly_rate)
  const legacy = data?.pay_kind === 'fixed'
  const chosen = PAY_PARTS.filter((p) => on[p.key])
  const value = (k) => (on[k] ? toNum(rate[k]) : 0)
  const bad = chosen.filter((p) => !(value(p.key) > 0))
  const dirty = !!data && !removing && (legacy || !saved
    || cycle !== (data.settle_cycle || 'monthly')
    || value('patients') !== saved.patientRate || value('days') !== saved.dailyRate || value('hours') !== saved.hourlyRate)
  const canSave = chosen.length > 0 && bad.length === 0 && dirty
  const example = chosen.length > 0 && bad.length === 0
    ? chosen.reduce((t, p) => t + value(p.key) * (p.key === 'hours' ? EXAMPLE.minutes / 60 : EXAMPLE[p.key]), 0) : null

  const save = async (remove = false) => {
    setBusy(true); setErr(null)
    try {
      const body = remove ? { pay_kind: null }
        : { pay_kind: 'mixed', amount: value('patients'), daily_rate: value('days'), hourly_rate: value('hours'), settle_cycle: cycle }
      const r = await api.clinic.setDoctorPay(doctorId, body)
      showToast(r.pay_kind ? `حُفظ الراتب: ${settingText(r.pay_kind, r.amount, r.daily_rate, r.hourly_rate)}` : 'أُزيل الراتب', 'success', 3500)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const summary = !data?.pay_kind ? null : legacy
    ? <>راتب شهري ثابت <strong>{fmtMoney(data.amount)}</strong></>
    : <><strong>{partsTitle(saved.parts)}</strong> — {ratesText(saved.parts, saved)}</>

  return (
    <section className="card pf-card pay-card" id="pf-pay" aria-labelledby="pf-pay-h">
      <header className="pf-card-head">
        <div>
          <h3 id="pf-pay-h">الراتب</h3>
          <p className="pf-card-sub">{canEdit ? 'اختاري ما يُحسب منه راتب الدكتور — واحداً أو أكثر، والراتب مجموعها.'
            : 'ما يُحسب منه راتب الدكتور. لا يراه الدكتور، ولا يُسحب من أيّ صندوق.'}</p>
        </div>
        {data?.pay_kind
          ? <span className="badge good">{legacy ? 'راتب ثابت (قديم)' : partsTitle(saved.parts)}</span>
          : data && <span className="badge warn">لم يُضبط بعد</span>}
      </header>
      {err && <p className="error">{err}</p>}
      {!data ? (!err && <p className="empty">جارٍ التحميل…</p>) : canEdit ? (
        <>
          {legacy && (
            <p className="share-warn">
              عليه «راتب شهري ثابت» قديم ({fmtMoney(data.amount)}) — يُحسب للشهر الكامل وحده. اختاري المكوّنات تحت واحفظي للانتقال.
            </p>
          )}
          <div className="pay-parts" role="group" aria-label="مكوّنات الراتب">
            {PAY_PARTS.map((p) => {
              const isOn = on[p.key]
              const invalid = isOn && rate[p.key] !== '' && !(toNum(rate[p.key]) > 0)
              return (
                <div key={p.key} className={`pay-part${isOn ? ' on' : ''}`}>
                  <label className="pay-part-toggle">
                    <input type="checkbox" checked={isOn} disabled={busy}
                      onChange={(e) => { setOn((o) => ({ ...o, [p.key]: e.target.checked })); setRemoving(false) }} />
                    <span className="pay-part-check" aria-hidden="true" />
                    <span className="pay-part-text">
                      <span className="pay-part-name">{p.label}</span>
                      <span className="pay-part-unit">{p.unit}</span>
                    </span>
                  </label>
                  {isOn && (
                    <div className="pay-part-rate">
                      <input aria-label={`السعر ${p.unit} (ل.س)`} value={rate[p.key]} inputMode="decimal"
                        placeholder="السعر" aria-invalid={invalid || undefined}
                        onChange={(e) => setRate((r) => ({ ...r, [p.key]: toLatinDigits(e.target.value) }))} />
                      <span className="pay-part-cur">ل.س</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={`pay-formula${chosen.length && !bad.length ? '' : ' muted-box'}`} aria-live="polite">
            {chosen.length === 0 ? 'لم يُختر شيء — اختاري مكوّناً واحداً على الأقلّ.'
              : bad.length ? `اكتبي سعر ${bad.map((p) => p.label).join(' و')}.`
              : (
                <>
                  <div className="pay-formula-main">
                    <span className="pay-formula-lbl">الراتب =</span>
                    {chosen.map((p, i) => (
                      <span key={p.key} className="pay-term">{i > 0 && <i>+</i>}{p.label} × {fmtMoney(value(p.key))}</span>
                    ))}
                  </div>
                  <div className="pay-example">
                    مثلاً {chosen.map((p) => EXAMPLE_QTY[p.key]).join(' و')} ⇐ <strong>{fmtMoney(example)}</strong>
                  </div>
                </>
              )}
          </div>
          {on.hours && <p className="pf-note">الساعات من «وصل الطبيب» إلى «انصرف» — يومٌ بلا انصراف مسجَّل لا ساعات له حتى يُصحَّح.</p>}
          {on.patients && <p className="pf-note">المرضى: الكشوف المنتهية في الفترة — الإجراءات وحدها لا تُعدّ.</p>}

          <div className="pay-foot">
            <div className="pay-cycle">
              <span id={`pay-cycle-${doctorId}`}>تحاسبيه:</span>
              <div className="seg" role="radiogroup" aria-labelledby={`pay-cycle-${doctorId}`}>
                {CYCLES.map(([c, label]) => (
                  <label key={c} className={cycle === c ? 'on' : undefined}><input type="radio" name={`cycle-${doctorId}`}
                    checked={cycle === c} onChange={() => setCycle(c)} />{label}</label>
                ))}
              </div>
              <span className="attn-compact-hint">للتنظيم فقط — لا يغيّر الحساب.</span>
            </div>
            <div className="pay-actions">
              {removing ? (
                <>
                  <span className="muted">يصير راتبه صفراً في كلّ الحسابات.</span>
                  <button type="button" className="ghost" disabled={busy} onClick={() => setRemoving(false)}>تراجع</button>
                  <button type="button" className="danger" disabled={busy} onClick={() => save(true)}>تأكيد الإزالة</button>
                </>
              ) : (
                <>
                  {data.pay_kind && (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => setRemoving(true)}>إزالة الراتب</button>
                  )}
                  <button type="button" disabled={busy || !canSave} onClick={() => save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ الراتب'}</button>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="pay-readonly">{summary || 'لم يُضبط الراتب بعد.'}
          {data.pay_kind && <> · تحاسبه: <strong>{cycleText(data.settle_cycle)}</strong></>}</p>
      )}
      {data && data.history.length > 0 && (
        <details className="pf-history">
          <summary>سجلّ تعديلات الراتب ({data.history.length})</summary>
          <ul className="change-log">
            {data.history.map((h) => (
              <li key={h.id}>
                <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
                <span>{historyText(h, 'old')} ← {historyText(h, 'new')}</span>
                <span className="muted">— {h.by_name || 'غير معروف'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
