import { useCallback, useEffect, useState } from 'react'
import { api, APPOINTMENT_STATUSES, VISIT_TYPES } from '../api.js'
import { AttendanceBadge, usePolling, fmtClock } from '../attendance-ui.jsx'

// ═══════════════════════════════════════════════════════════════════
// «مرضاي» — مرضى الطبيب في يومٍ واحد (طلب المستخدم 2026-11-15: «صفحة للمرضى مع فلترة كل يوم
// يشوف مين المرضى يلي عندو وأسماءهن وكل شي»، و«يعرف مين إجا معاينات ومين إجا مراجعات»).
//   • اليوم بسهمين يقفزان إلى أقرب يومٍ فيه مرضى (prev_day/next_day من الخادم) وتاريخٍ حرّ.
//   • جملة الملخّص فوق، ثمّ ترشيحٌ بنوع الزيارة: الكل · معاينات · مراجعات · إجراء فقط.
//   • لكلّ مريض: رقم دوره، اسمه، جنسه وعمره، نوع الزيارة، الحالة، أوقات الحضور والدخول والانتهاء،
//     ملاحظة الحجز، والإجراءات بأسمائها — بلا موبايل ولا مبلغ ولا إحالة (من الخادم أصلاً).
// اليوم الجاري يتحدّث كلّ ٣٠ ثانية.
// ═══════════════════════════════════════════════════════════════════

const n = (x) => Number(x || 0).toLocaleString('ar-SY')
const dayTitle = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('ar-SY',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
// جمع المعدود: «مريض واحد»، «مريضان»، «٣ مرضى»، «١١ مريضاً»
const count = (k, [one, two, few, many]) => (k === 1 ? one : k === 2 ? two : `${n(k)} ${k >= 3 && k <= 10 ? few : many}`)
const PATIENTS = ['مريض واحد', 'مريضان', 'مرضى', 'مريضاً']
const AGE = ['سنة واحدة', 'سنتان', 'سنوات', 'سنة']
const STATUS = { ...APPOINTMENT_STATUSES, waiting: 'لم يحضر بعد', arrived: 'حاضر — بانتظار الدور', waiting_return: 'خارج مؤقتاً' }
const GENDER = { male: 'ذكر', female: 'أنثى' }
const FILTERS = [['all', 'الكل'], ['consultation', 'معاينات'], ['followup', 'مراجعات'], ['procedure_only', 'إجراء فقط']]

function Summary({ patients }) {
  const by = (k) => patients.filter((p) => p.visit_type === k).length
  const done = patients.filter((p) => p.status === 'done').length
  const absent = patients.filter((p) => p.status === 'no_show').length
  const parts = [
    by('consultation') && count(by('consultation'), ['معاينة واحدة', 'معاينتان', 'معاينات', 'معاينة']),
    by('followup') && count(by('followup'), ['مراجعة واحدة', 'مراجعتان', 'مراجعات', 'مراجعة']),
    by('procedure_only') && `${n(by('procedure_only'))} «إجراء فقط»`,
  ].filter(Boolean)
  return (
    <p className="mp-summary">
      <strong>{count(patients.length, PATIENTS)}</strong>
      {parts.length > 0 && <>: {parts.join('، ')}</>}.
      {' '}{done > 0 && <>انتهى كشف {count(done, PATIENTS)}</>}
      {absent > 0 && <>{done > 0 ? '، و' : ''}لم يحضر {count(absent, PATIENTS)}</>}
      {(done > 0 || absent > 0) && '.'}
    </p>
  )
}

export default function MyPatientsPage() {
  const [date, setDate] = useState(null)        // null = اليوم (من الخادم)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('all')
  const load = useCallback(() => api.clinic.myPatients(date).then((d) => { setData(d); setErr(null) })
    .catch((e) => setErr(e.message)), [date])
  useEffect(() => { load() }, [load])
  const shown = data && (date === null || data.date === date) ? data : null
  usePolling(load, !!shown && shown.date === shown.today, 30000)
  useEffect(() => { setFilter('all') }, [date])

  const patients = shown?.patients || []
  const kinds = FILTERS.filter(([k]) => k === 'all' || patients.some((p) => p.visit_type === k))
  const list = filter === 'all' ? patients : patients.filter((p) => p.visit_type === filter)
  const withProcs = patients.some((p) => p.procedures.length > 0)

  return (
    <div className="dp mp">
      <h2>مرضاي</h2>
      <p className="subtitle">مرضاك في يومٍ واحد — بأسمائهم ونوع زيارتهم وحالتهم</p>

      <div className="card mp-day" role="group" aria-label="اليوم">
        <button type="button" className="ghost mp-arrow" disabled={!shown?.prev_day}
          title="أقرب يومٍ قبله فيه مرضى" onClick={() => setDate(shown.prev_day)}>يومٌ سابق</button>
        <div className="mp-day-mid">
          <strong>{shown ? dayTitle(shown.date) : '…'}</strong>
          <input type="date" aria-label="اختيار يوم" value={shown?.date || ''} max={shown?.today}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
          {shown && shown.date !== shown.today && (
            <button type="button" className="ghost mp-today" onClick={() => setDate(null)}>اليوم</button>
          )}
        </div>
        <button type="button" className="ghost mp-arrow" disabled={!shown?.next_day}
          title="أقرب يومٍ بعده فيه مرضى" onClick={() => setDate(shown.next_day)}>يومٌ لاحق</button>
      </div>

      {err && <p className="error">{err}</p>}
      {!shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : patients.length === 0 ? (
        <div className="card"><p className="empty">
          {shown.sessions.length === 0 ? 'لا دوام لك في هذا اليوم.' : 'لا مرضى في هذا اليوم.'}</p></div>
      ) : (
        <div className="card">
          <Summary patients={patients} />
          {kinds.length > 2 && (
            <div className="mp-filter" role="group" aria-label="نوع الزيارة">
              {kinds.map(([k, label]) => {
                const c = k === 'all' ? patients.length : patients.filter((p) => p.visit_type === k).length
                return (
                  <button key={k} type="button" aria-pressed={filter === k} className={filter === k ? 'is-on' : ''}
                    onClick={() => setFilter(k)}>{label} <span className="dk-count">{n(c)}</span></button>
                )
              })}
            </div>
          )}
          <table className="rtable mp-table">
            <thead>
              <tr>
                <th>الدور</th><th>المريض</th><th>الزيارة</th><th>الحالة</th><th>الأوقات</th>
                {withProcs && <th>الإجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="num mp-num" data-label="الدور">{p.number == null ? '—' : n(p.number)}</td>
                  <td className="rt-title">
                    <div className="mp-who">
                      <strong>{p.full_name}<AttendanceBadge priority={p.priority} /></strong>
                      <small>{[GENDER[p.gender], p.age != null && (p.age < 1 ? 'أقلّ من سنة' : count(p.age, AGE))].filter(Boolean).join('، ')}</small>
                      {p.reason && <small className="mp-note">ملاحظة الحجز: {p.reason}</small>}
                    </div>
                  </td>
                  <td data-label="الزيارة"><span className={`dk-vt is-${p.visit_type}`}>{VISIT_TYPES[p.visit_type] || p.visit_type}</span></td>
                  <td data-label="الحالة" className={`mp-status is-${p.status}`}>{STATUS[p.status] || p.status}</td>
                  <td data-label="الأوقات" className="mp-times">
                    {[p.arrived_at && `حضر ${fmtClock(p.arrived_at)}`, p.started_at && `دخل ${fmtClock(p.started_at)}`,
                      p.done_at && `انتهى ${fmtClock(p.done_at)}`].filter(Boolean).join('، ') || '—'}
                  </td>
                  {withProcs && (
                    <td data-label="الإجراءات">
                      {p.procedures.length === 0 ? '—' : (
                        <div className="mp-procs">{p.procedures.map((x, i) => (
                          <span key={i}>{x.name}{!x.paid && <small> (بانتظار المحاسبة)</small>}</span>
                        ))}</div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
