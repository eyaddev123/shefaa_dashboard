import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../api.js'
import { Modal } from './inventory/shared.jsx'
import { fmtDuration } from './Punctuality.jsx'

// ═══ الحضور والانصراف — على لوحة الدكتور، بفترتها ═══
// جلسةٌ لكلّ سطر: وقت الحضور (زرّ «وصل الطبيب») والانصراف (زرّ «تسجيل انصراف») والمدّة — أساس
// «يومية + ساعة». يومٌ بلا انصراف ظاهرٌ بوضوح: يوميته تُحسب وساعاته لا حتى يُصحَّح.
// المشرفة وحدها تصحّح (canFix): تعبئةً لما نُسي أو تعديلاً، بسببٍ إلزاميّ يُكتب في الأثر مع
// اسمها ووقته. الباقون (المدير والمشرف العام) يطالعون السجلّ والأثر.

const STATE = {
  complete: null,
  no_departure: ['warn', 'انصراف غير مسجَّل'],
  on_duty: ['', 'على الدوام — لم ينصرف بعد'],
  no_arrival: ['', 'لا حضور مسجَّل'],
}
const FIELD = { arrival: 'الحضور', departure: 'الانصراف' }
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
// ولا «·» بجانب رقمٍ هنديّ — يُقرأ صفراً
const days = (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${fmtInt(n)} ${n >= 3 && n <= 10 ? 'أيام' : 'يوماً'}`)

function FixDialog({ s, onClose, onSaved }) {
  const [arrival, setArrival] = useState(s.arrived || '')
  const [departure, setDeparture] = useState(s.departed || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const body = { reason }
  if (arrival && arrival !== s.arrived) body.arrival = arrival
  if (departure && departure !== s.departed) body.departure = departure
  const changed = 'arrival' in body || 'departure' in body
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { await api.clinic.fixDoctorTimes(s.id, body); onSaved() } catch (ex) { setErr(ex.message); setBusy(false) }
  }
  return (
    <Modal title="تصحيح الحضور والانصراف" subtitle={`${s.date} · الدوام ${s.start}–${s.end}`} onClose={onClose} busy={busy} sheet>
      <form onSubmit={save}>
        <div className="share-general pay-fields">
          <div className="field">
            <label htmlFor="fix-arr">وقت الحضور</label>
            <input id="fix-arr" type="time" value={arrival} dir="ltr" onChange={(e) => setArrival(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fix-dep">وقت الانصراف</label>
            <input id="fix-dep" type="time" value={departure} dir="ltr" onChange={(e) => setDeparture(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="fix-reason">سبب التصحيح (إلزاميّ)</label>
          <textarea id="fix-reason" rows={2} maxLength={300} value={reason} required
            placeholder="مثال: الاستقبال نسيت تسجيل الانصراف" onChange={(e) => setReason(e.target.value)} />
        </div>
        <p className="attn-compact-hint">يُحفظ الوقت السابق والسبب واسمك في الأثر. الساعات تُحسب من الحضور للانصراف.</p>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !changed || !reason.trim()}>{busy ? 'جارٍ الحفظ…' : 'احفظ التصحيح'}</button>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  )
}

export default function DoctorTimesCard({ doctorId, period, from, to, canFix, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [reload, setReload] = useState(0)
  const [fixing, setFixing] = useState(null)
  const key = `${doctorId}|${period}|${period === 'custom' ? `${from}|${to}` : ''}`
  useEffect(() => {
    let alive = true
    setErr(null)
    api.clinic.doctorAttendance(doctorId, { period, from, to })
      .then((d) => { if (alive) setData({ key, ...d }) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [key, reload])
  const shown = data?.key === key ? data : null
  const sum = shown?.summary

  return (
    <div className="card dt-card">
      <h3>الحضور والانصراف</h3>
      {err ? <p className="error">{err}</p> : !shown ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <p className="dt-summary">
            حضور {days(sum.days)}، ودوام {fmtDuration(sum.minutes)}
            {sum.noDeparture > 0 && <span className="badge warn sm">انصراف غير مسجَّل: {days(sum.noDeparture)}</span>}
            {sum.onDuty > 0 && <span className="badge sm">على الدوام الآن</span>}
          </p>
          {sum.noDeparture > 0 && (
            <p className="share-warn acc-warn">
              أيام «انصراف غير مسجَّل»: يوميتها محسوبة وساعاتها لا.{canFix ? ' صحّحها من «تصحيح» بجانب اليوم.' : ' تصحّحها المشرفة.'}
            </p>
          )}
          {shown.sessions.length === 0 ? <p className="empty">لا جلسات في هذه الفترة.</p> : (
            <table className="rtable dt-table">
              <thead><tr><th>اليوم</th><th>الدوام</th><th>الحضور</th><th>الانصراف</th><th>المدّة</th><th>الحالة</th>{canFix && <th />}</tr></thead>
              <tbody>
                {shown.sessions.map((s) => {
                  const st = STATE[s.state]
                  return (
                    <tr key={s.id} className={s.state === 'no_departure' ? 'dt-row-warn' : undefined}>
                      <td className="rt-title" dir="ltr">{s.date}</td>
                      <td data-label="الدوام" dir="ltr">{s.start}–{s.end}</td>
                      <td className="num" data-label="الحضور" dir="ltr">{s.arrived || '—'}</td>
                      <td className="num" data-label="الانصراف" dir="ltr">{s.departed || '—'}</td>
                      <td className="num" data-label="المدّة">{s.minutes == null ? '—' : fmtDuration(s.minutes)}</td>
                      <td data-label="الحالة">
                        {st ? <span className={`badge sm ${st[0]}`}>{st[1]}</span> : <span className="muted">مكتمل</span>}
                        {s.history.length > 0 && (
                          <ul className="dt-trail">
                            {s.history.map((h, i) => (
                              <li key={i}>
                                {FIELD[h.field]}: <span dir="ltr">{h.previous || '—'}</span> ← <span dir="ltr">{h.next}</span>
                                {h.reason && <> — {h.reason}</>}
                                <span className="muted"> — {h.by || '—'} {fmtDateTime(h.at)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      {canFix && <td data-label=""><button type="button" className="link-btn" onClick={() => setFixing(s)}>
                        {s.state === 'complete' || s.state === 'on_duty' ? 'تصحيح' : 'تعبئة / تصحيح'}</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      {fixing && <FixDialog s={fixing} onClose={() => setFixing(null)}
        onSaved={() => { setFixing(null); setReload((n) => n + 1); onChanged?.() }} />}
    </div>
  )
}
