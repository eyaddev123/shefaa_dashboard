import { useCallback, useEffect, useRef, useState } from 'react'
import { api, openStaffStream } from '../api.js'
import { playRing, primeOnFirstGesture } from '../doctor-alert.js'

// ═══ «الدكتور يحتاج ممرضة» — تنبيهٌ وامض للاستقبال في كلّ صفحة ═══
// قرارات المستخدم 2026-11-15: شريطٌ أعلى الشاشة في أيّ صفحةٍ تكون فيها الاستقبال (والمشرفة)، يومض
// حتى تكبس «أرسلنا ممرضة»؛ ورنّةٌ قصيرة **مرّةً واحدة** عند وصول الطلب؛ وبلا تسجيلٍ في القاعدة.
// حيٌّ ببثّ الموظفين (nurse_call) وتحديثٍ كلّ ٣٠ ثانية احتياطاً. «أرسلنا» من أيّ جهاز تُطفئه من الكلّ.
const POLL_MS = 30000
const minutesAgo = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000))
const ago = (m) => (m < 1 ? 'الآن' : m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين'
  : `منذ ${m.toLocaleString('ar-SY-u-nu-latn')} ${m <= 10 ? 'دقائق' : 'دقيقة'}`)

export default function NurseCallAlert() {
  const [calls, setCalls] = useState([])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [now, setNow] = useState(Date.now())
  const seen = useRef(null)

  const load = useCallback(() => api.clinic.nurseCalls().then((d) => {
    const ids = new Set(d.calls.map((c) => c.doctor_id))
    // رنّةٌ مرّةً واحدة لكلّ طلبٍ جديد — لا عند أوّل تحميل (طلبٌ قديم فُتحت الصفحة عليه)
    if (seen.current && [...ids].some((id) => !seen.current.has(id))) playRing()
    seen.current = ids
    setCalls(d.calls)
  }).catch(() => {}), [])

  useEffect(() => primeOnFirstGesture(), [])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const close = openStaffStream((name) => { if (name === 'nurse_call') load() })
    return () => { clearInterval(t); close() }
  }, [load])
  useEffect(() => {
    if (calls.length === 0) return undefined
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [calls.length])

  const ack = async (c) => {
    setBusy(c.doctor_id); setErr(null)
    try { await api.clinic.ackNurseCall(c.doctor_id) } catch (ex) { if (ex.data?.code !== 'NO_CALL') setErr(ex.message) }
    finally { setBusy(null); load() }
  }

  if (calls.length === 0) return null
  return (
    <div className="nurse-alerts" role="alert" aria-live="assertive">
      {calls.map((c) => (
        <div key={c.doctor_id} className="nurse-alert">
          <span className="nurse-alert-text">
            <strong>{c.doctor_name}</strong>{c.room ? <> — العيادة {c.room}</> : null} — يحتاج ممرضة
            <small> ({ago(minutesAgo(c.requested_at, now))})</small>
          </span>
          <button type="button" className="nurse-alert-btn" disabled={busy === c.doctor_id} onClick={() => ack(c)}>
            أرسلنا ممرضة
          </button>
        </div>
      ))}
      {err && <p className="nurse-alert-err">{err}</p>}
    </div>
  )
}
