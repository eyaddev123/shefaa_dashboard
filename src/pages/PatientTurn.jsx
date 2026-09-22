import { useState } from 'react'
import { api, APPOINTMENT_STATUSES, fmtTime } from '../api.js'

export default function PatientTurn() {
  const [mobile, setMobile] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true); setResult(null)
    try {
      const r = await api.clinic.myTurn({ mobile, access_code: accessCode })
      setResult(r)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="patient-turn-page">
      <div className="patient-turn-card">
        <div className="patient-turn-logo">🏥</div>
        <h1>جمعية الشفاء الخيرية</h1>
        <p className="subtitle">اعرف دورك في العيادة</p>

        <form onSubmit={submit}>
          <div className="field">
            <label>رقم الموبايل</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" required autoFocus />
          </div>
          <div className="field">
            {/* رمز وصول من 6 أرقام لا رمز البطاقة: البطاقة تُخمَّن بالعدّ، والرمز لا.
                inputMode=numeric يفتح لوحة الأرقام — أكثر المرضى كبار بالعمر. */}
            <label>رمز الوصول</label>
            <input value={accessCode} onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ''))}
                   dir="ltr" required inputMode="numeric" maxLength={6} autoComplete="off"
                   placeholder="٦ أرقام مطبوعة على بطاقتك" />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%', padding: '13px', fontSize: 15 }}>
            {busy ? 'جارٍ البحث…' : 'اعرض دوري'}
          </button>
        </form>

        {err && <p className="error">{err}</p>}

        {result && (
          <div className="patient-turn-result">
            <div className="ptr-doctor">{result.doctor_name} — {result.specialty || '—'}</div>
            <div className="ptr-number">{result.queue_number}</div>
            <div className="ptr-status">{APPOINTMENT_STATUSES[result.status] || result.status}</div>
            {['waiting', 'arrived', 'in_service'].includes(result.status) && (
              <div className="ptr-wait">
                {result.ahead_count === 0
                  ? 'دورك التالي مباشرة'
                  : <>أمامك <strong>{result.ahead_count}</strong> — الوقت المتوقع ~<strong>{result.wait_minutes}</strong> دقيقة</>}
              </div>
            )}

            {/* شفافية الانزياح: المريض يرى موعده الأصلي والجديد وسبب كل تأجيل */}
            {result.delay_minutes > 0 && (
              <div className="ptr-delay">
                <div className="ptr-delay-times">
                  موعدك: <s dir="ltr">{fmtTime(result.original_slot_time)}</s>
                  {' → '}<strong dir="ltr">{fmtTime(result.slot_time)}</strong>
                </div>
                <div className="ptr-delay-total">تأخّر {result.delay_minutes} دقيقة</div>
                <ul className="ptr-delay-list">
                  {result.delays.map((d, i) => (
                    <li key={i}>
                      تأجّل <strong>{d.minutes}</strong> دقيقة بسبب {d.label}
                      {d.times > 1 && ` (${d.times} حالات)`}
                    </li>
                  ))}
                </ul>
                <p className="ptr-delay-note">
                  نعتذر عن التأخير — الحالات الإسعافية وكبار السن والرضّع تُقدَّم لضرورتها. رقم دورك لم يتغيّر.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
