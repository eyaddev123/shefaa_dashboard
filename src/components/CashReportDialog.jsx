import { useEffect, useState } from 'react'
import { api, todayLocal } from '../api.js'

// ═══ نافذة «جرد الصندوق» — من داخل النظام لا من المتصفّح ═══
// الاستقبال (والمشرف والمدير) بآخر الدوام: يختار اليوم والعيادة فيُنزَّل ملفّ إكسل يُطابَق به الصندوق.
// الحساب كلّه في الخادم (GET /api/reception/cash-report) — النافذة تختار وتُنزّل فقط.
// «العيادة» = غرفة الدكتور، والقائمة من غرف دكاترة ذلك اليوم.
export default function CashReportDialog({ onClose }) {
  const [date, setDate] = useState(todayLocal())
  const [clinicId, setClinicId] = useState('')
  const [clinics, setClinics] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setClinics([])
    if (!date) return undefined
    api.clinic.cashReportClinics(date)
      .then((r) => {
        if (!alive) return
        setClinics(r.clinics || [])
        // عيادةٌ مختارة لا دوام لها في اليوم الجديد ⇒ رجوعٌ إلى «كل العيادات»
        setClinicId((c) => ((r.clinics || []).indexOf(c) === -1 ? '' : c))
      })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [date])

  const download = async () => {
    setBusy(true); setErr(null)
    try {
      await api.clinic.cashReport({ date, clinicId })
      onClose()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cash-title">
        <h3 id="cash-title">جرد الصندوق</h3>
        <p className="subtitle" style={{ marginTop: 4 }}>
          ملفّ إكسل بما دخل الصندوق: الملخّص لكل عيادة، والتفاصيل مريضاً مريضاً، وحسب الدكتور.
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="cash-date">التاريخ</label>
          <input id="cash-date" type="date" value={date} max={todayLocal()}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="cash-clinic">العيادة</label>
          <select id="cash-clinic" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            <option value="">كل العيادات</option>
            {clinics.map((c) => <option key={c} value={c}>العيادة {c}</option>)}
          </select>
        </div>

        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        <div className="bf-actions" style={{ marginTop: 16 }}>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="button" disabled={busy || !date} onClick={download}>
            {busy ? 'جارٍ التحضير…' : '⬇ تحميل Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
