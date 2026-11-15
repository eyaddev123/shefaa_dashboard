import { useCallback, useEffect, useState } from 'react'
import { api, VISIT_TYPES, todayLocal } from '../api.js'
import { AttendanceBadge, usePolling } from '../attendance-ui.jsx'
import BottomSheet from '../components/BottomSheet.jsx'

// ═══════════════════════════════════════════════════════════════════
// «مرضاي» — مرضى الطبيب (doctor-pages-redesign، قرارات المستخدم 2026-11-15)
//   • البحث بالاسم فوق: أيّ مريضٍ زاره ولو مرّة، ولمسةٌ تفتح سجلّه عنده (متى زاره، ونوع كلّ زيارة،
//     وإجراءاتها) — «إذا بحث عن مريض يقدر يشوف السجل تبعو ايمت زارو».
//   • الفترة: اليوم · هذا الأسبوع · هذا الشهر · مدّة (من–إلى، حتى ٩٢ يوماً) — لا سهمٌ ليومٍ سابق/لاحق.
//   • كروتٌ مرتّبة في كلّ الشاشات (جوال، تابلت، لابتوب) مجمّعةً باليوم، الأحدث أوّلاً.
//   • في الكرت ما يهمّ الطبيب: رقم الدور، الاسم، الجنس والعمر، معاينة أو مراجعة، ملاحظة الحجز،
//     الإجراءات — بلا أوقات حجزٍ ولا حضورٍ ولا انصراف ولا حالة كشف («ما بهمّني»)، وبلا موبايل ولا مبلغ.
//     ومن جاءه وحده (الخادم): لا المحجوز الذي لم يصل ولا من لم يحضر — فعدد «زارك» صادق.
//   • جملة ملخّص وترشيحٌ بنوع الزيارة: «مين إجا معاينات ومين إجا مراجعات».
// ═══════════════════════════════════════════════════════════════════

const n = (x) => Number(x || 0).toLocaleString('ar-SY')
const dayTitle = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long' })
const longDay = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
// جمع المعدود: «مريض واحد»، «مريضان»، «٣ مرضى»، «١١ مريضاً»
const count = (k, [one, two, few, many]) => (k === 1 ? one : k === 2 ? two : `${n(k)} ${k >= 3 && k <= 10 ? few : many}`)
const PATIENTS = ['مريض واحد', 'مريضان', 'مرضى', 'مريضاً']
const AGE = ['سنة واحدة', 'سنتان', 'سنوات', 'سنة']
const TIMES = ['مرّة واحدة', 'مرّتين', 'مرّات', 'مرّة']
const GENDER = { male: 'ذكر', female: 'أنثى' }
const PERIODS = [['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['custom', 'مدّة']]
const FILTERS = [['all', 'الكل'], ['consultation', 'معاينات'], ['followup', 'مراجعات'], ['procedure_only', 'إجراء فقط']]
const who = (p) => [GENDER[p.gender], p.age != null && (p.age < 1 ? 'أقلّ من سنة' : count(p.age, AGE))].filter(Boolean).join('، ')
const minus = (ymd, days) => {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10)
}

function Summary({ patients }) {
  const by = (k) => patients.filter((p) => p.visit_type === k).length
  const parts = [
    by('consultation') && count(by('consultation'), ['معاينة واحدة', 'معاينتان', 'معاينات', 'معاينة']),
    by('followup') && count(by('followup'), ['مراجعة واحدة', 'مراجعتان', 'مراجعات', 'مراجعة']),
    by('procedure_only') && `${n(by('procedure_only'))} «إجراء فقط»`,
  ].filter(Boolean)
  return (
    <p className="mp-summary">
      <strong>{count(patients.length, PATIENTS)}</strong>
      {parts.length > 0 && <>: {parts.join('، ')}</>}.
    </p>
  )
}

const Procs = ({ list }) => (list.length === 0 ? null : (
  <span className="mp-card-procs">{list.map((x, i) => (
    <span key={i}>{x.name}{!x.paid && <small> (بانتظار المحاسبة)</small>}</span>
  ))}</span>
))

// كرت زيارة: ما يهمّ الطبيب وحده — ولمسةٌ تفتح سجلّ المريض
function VisitCard({ p, onOpen }) {
  return (
    <button type="button" className="mp-card" onClick={() => onOpen(p.patient_id)} title="سجلّ المريض عندك">
      <span className="mp-card-top">
        <span className="mp-card-num">{p.number == null ? 'بلا دور بعد' : `الدور ${n(p.number)}`}</span>
        <span className={`dk-vt is-${p.visit_type}`}>{VISIT_TYPES[p.visit_type] || p.visit_type}</span>
      </span>
      <strong className="mp-card-name">{p.full_name}<AttendanceBadge priority={p.priority} /></strong>
      {who(p) && <span className="mp-card-who">{who(p)}</span>}
      {p.reason && <span className="mp-card-note">ملاحظة الحجز: {p.reason}</span>}
      <Procs list={p.procedures} />
    </button>
  )
}

// سجلّ المريض عند هذا الطبيب: كلّ زياراته، الأحدث أوّلاً
function HistorySheet({ patientId, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.clinic.myPatientHistory(patientId).then(setData).catch((e) => setErr(e.message))
  }, [patientId])
  const p = data?.patient
  return (
    <BottomSheet title={p ? p.full_name : 'سجلّ المريض'}
      subtitle={p ? [who(p), `زارك ${count(data.visits.length, TIMES)}`].filter(Boolean).join(' — ') : undefined}
      onClose={onClose}>
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <ul className="mp-history">
          {data.visits.map((v) => (
            <li key={v.id} className="mp-visit">
              <div className="mp-visit-head">
                <strong>{longDay(v.date)}</strong>
                <span className={`dk-vt is-${v.visit_type}`}>{VISIT_TYPES[v.visit_type] || v.visit_type}</span>
              </div>
              {v.reason && <span className="mp-card-note">ملاحظة الحجز: {v.reason}</span>}
              <Procs list={v.procedures} />
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  )
}

export default function MyPatientsPage() {
  const today = todayLocal()
  const [period, setPeriod] = useState('today')
  const [from, setFrom] = useState(minus(today, 6))
  const [to, setTo] = useState(today)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [open, setOpen] = useState(null)       // patient_id سجلّه مفتوح

  const key = period === 'custom' ? `${from}|${to}` : period
  const load = useCallback(() => api.clinic.myPatients(period === 'custom' ? { from, to } : { period })
    .then((d) => { setData({ key, d }); setErr(null) })
    .catch((e) => setErr(e.message)), [key])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFilter('all'); load() }, [load])
  const shown = data?.key === key ? data.d : null
  usePolling(load, period === 'today', 30000)

  // البحث وهو يكتب (حرفان فأكثر)، بمهلةٍ قصيرة
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setFound(null); return undefined }
    const id = setTimeout(() => {
      api.clinic.myPatientsSearch(t).then((r) => setFound({ q: t, results: r.results })).catch((e) => setErr(e.message))
    }, 250)
    return () => clearTimeout(id)
  }, [q])
  const searching = q.trim().length >= 2

  const patients = shown?.patients || []
  const kinds = FILTERS.filter(([k]) => k === 'all' || patients.some((p) => p.visit_type === k))
  const list = filter === 'all' ? patients : patients.filter((p) => p.visit_type === filter)
  const days = [...new Set(list.map((p) => p.date))]
  const manyDays = shown && shown.from !== shown.to

  return (
    <div className="dp mp">
      <h2>مرضاي</h2>
      <p className="subtitle">مرضاك في الفترة التي تختارها، والبحث عن أيّ مريضٍ زارك وسجلّه عندك</p>

      <div className="card mp-bar">
        <input type="search" className="mp-search" placeholder="ابحث عن مريض بالاسم…" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="البحث عن مريض" />
        {!searching && (
          <div className="mp-bar-row">
            <div className="dp-period" role="group" aria-label="الفترة">
              {PERIODS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={period === k} className={period === k ? 'is-on' : ''}
                  onClick={() => setPeriod(k)}>{label}</button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="mp-range">
                <label>من <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
                <label>إلى <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
              </div>
            )}
          </div>
        )}
      </div>

      {err && <p className="error">{err}</p>}

      {searching ? (
        !found || found.q !== q.trim() ? <p className="empty">جارٍ البحث…</p>
          : found.results.length === 0 ? <div className="card"><p className="empty">لا مريض بهذا الاسم زارك.</p></div> : (
            <div className="mp-grid">
              {found.results.map((r) => (
                <button key={r.patient_id} type="button" className="mp-card" onClick={() => setOpen(r.patient_id)}>
                  <strong className="mp-card-name">{r.full_name}</strong>
                  {who(r) && <span className="mp-card-who">{who(r)}</span>}
                  <span className="mp-card-note">زارك {count(r.visits, TIMES)} — آخرها {dayTitle(r.last_visit)}</span>
                  <span className="mp-card-open">عرض السجلّ</span>
                </button>
              ))}
            </div>
          )
      ) : !shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : patients.length === 0 ? (
        <div className="card"><p className="empty">لا مرضى في هذه الفترة.</p></div>
      ) : (
        <>
          <div className="mp-head">
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
          </div>
          {days.map((d) => {
            const dayList = list.filter((p) => p.date === d)
            return (
              <section key={d} className="mp-day-group">
                {manyDays && <h3 className="mp-day-title">{dayTitle(d)} <span className="dk-count">— {count(dayList.length, PATIENTS)}</span></h3>}
                <div className="mp-grid">
                  {dayList.map((p) => <VisitCard key={p.id} p={p} onOpen={setOpen} />)}
                </div>
              </section>
            )
          })}
        </>
      )}

      {open && <HistorySheet patientId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
