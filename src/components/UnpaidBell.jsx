import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtMoney, openStaffStream } from '../api.js'

// ═══ «إجراءات بانتظار المحاسبة» — جرس الاستقبال الحيّ ═══
// إجراءٌ أضافه الطبيب يبقى «بانتظار المحاسبة» حتى تقبضه الاستقبال. زرٌّ عائمٌ في كلّ صفحة
// (لا في الدرج الجانبي — يختفي على الجوال) يظهر حين يوجد معلّق، ولوحته تسرد المريض والإجراء
// والمبلغ وزرّ «تمت المحاسبة». حيٌّ ببثّ الموظفين: حدث «procedure» بلا أرقام ⇒ إعادة تحميل
// من المسار المحميّ — فالعنصر يختفي فور الدفع من أيّ جهاز استقبال، والجديد يصل بلحظته.
// الاستقبال: جلسات اليوم. المشرفة: كلّ الأيام (والقائمة الكاملة بأفعالها في «المراجعة»).
const POLL_MS = 60000

export default function UnpaidBell({ role }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [paying, setPaying] = useState([])   // متفائل: يختفي فوراً، ويعود إن رُفض
  const [err, setErr] = useState(null)
  const [fresh, setFresh] = useState(false)  // نبضةٌ حين يصل جديد
  const seen = useRef(null)

  const load = useCallback(() => api.clinic.unpaidProcedures().then((d) => {
    const ids = new Set(d.lines.map((l) => String(l.id)))
    if (seen.current && [...ids].some((id) => !seen.current.has(id))) {
      setFresh(true); setTimeout(() => setFresh(false), 2400)
    }
    seen.current = ids
    setData(d)
  }).catch(() => {}), [])

  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    let timer = null
    const close = openStaffStream((name) => {
      if (name !== 'procedure') return
      clearTimeout(timer)
      timer = setTimeout(load, 250)
    })
    return () => { clearInterval(t); clearTimeout(timer); close() }
  }, [load])
  useEffect(() => {
    if (!open) return undefined
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])

  const lines = (data?.lines || []).filter((l) => !paying.includes(String(l.id)))
  const total = lines.reduce((s, l) => s + Number(l.price), 0)

  const pay = async (l) => {
    setErr(null)
    setPaying((p) => [...p, String(l.id)])
    try {
      await api.clinic.markProcedurePaid(l.appointment_id, l.id)
      await load()
    } catch (ex) {
      setErr(`«${l.name}» لـ ${l.patient_name}: ${ex.message}`)
    } finally {
      setPaying((p) => p.filter((x) => x !== String(l.id)))
    }
  }

  if (!data || (lines.length === 0 && !open)) return null
  const number = (l) => (l.flow_mode === 'attendance' ? (l.arrival_number ?? l.queue_number) : l.queue_number)

  return (
    <>
      <button type="button" className={`unpaid-fab${fresh ? ' is-fresh' : ''}`} onClick={() => setOpen(true)}
        aria-label={`إجراءات بانتظار المحاسبة: ${lines.length}`}>
        <span aria-hidden="true">⏳</span> بانتظار المحاسبة
        <span className="unpaid-fab-count">{lines.length.toLocaleString('ar-SY')}</span>
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal-card unpaid-panel" role="dialog" aria-modal="true" aria-labelledby="unpaid-title">
            <div className="unpaid-head">
              <h3 id="unpaid-title">إجراءات بانتظار المحاسبة</h3>
              <span className="unpaid-total">{fmtMoney(total)}</span>
            </div>
            <p className="unpaid-sub">
              {role === 'clinic_admin' ? 'كلّ الأيام — أضافها الأطباء ولم تُقبض بعد.' : 'جلسات اليوم — أضافها الأطباء ولم تُقبض بعد.'}
            </p>
            {err && <p className="error" role="alert">{err}</p>}
            {lines.length === 0 ? <p className="empty">لا شيء بانتظار المحاسبة.</p> : (
              <ul className="unpaid-list">
                {lines.map((l) => (
                  <li key={l.id} className="unpaid-item">
                    <div className="unpaid-who">
                      <span className="unpaid-patient">{l.patient_name}</span>
                      <span className="unpaid-meta">
                        الدور {number(l)} — {l.doctor_name}{l.room ? ` (العيادة ${l.room})` : ''}
                        {l.session_date !== data.today && <> — <span dir="ltr">{l.session_date}</span></>}
                      </span>
                    </div>
                    <div className="unpaid-proc">
                      <span>{l.name}</span>
                      <strong>{fmtMoney(l.price)}</strong>
                    </div>
                    <button type="button" className="unpaid-pay" onClick={() => pay(l)}>تمت المحاسبة</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="bf-actions inv-actions">
              <button type="button" className="ghost" onClick={() => setOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
