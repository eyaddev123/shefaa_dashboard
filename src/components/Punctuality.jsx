import { useState } from 'react'
// ═══ الالتزام بالدوام — قطعٌ مشتركة بين لوحة تحكم الدكتور و«التزامي» في «أعمالي» ═══
// الحساب كلّه في الخادم (server/src/doctor-dashboard.js) — هنا عرضٌ وحده:
//   بالوقت (≤ ١٥ د) أخضر · متأخّر أصفر بدقائقه · غائب أحمر فاتح · اعتذر أحمر ممتلئ · تقديري رمادي
//   (بلا «وصل الطبيب»، بأوّل نداء). الاعتذار من قائمةٍ منفصلة (apologies) — لا يدخل أيّ عدّاد.
// والتقديريّ لا يدخل نسبة الالتزام ولا الترتيب. اليوم الجاري بلا وصولٍ بعد «لم يُحسم» بلا لون.
// دكتور «بمواعيد خاصة» (p.appointmentsBased): لا نسبة ولا تأخير — «بمواعيد خاصة» مكانهما، وأيام
// حضوره زرقاء بوقت وصولها وحده.

export const DAY_LABELS = {
  on_time: 'بالوقت', late: 'متأخّر', absent: 'غائب', estimated: 'تقديري', pending: 'لم يُحسم بعد',
  appointments: 'بمواعيد خاصة',
}
export const APPOINTMENTS_LABEL = 'بمواعيد خاصة'
/** شارة صغيرة «بمواعيد خاصة» — بجانب وقت الوصول أو اسم الدكتور */
export const AppointmentsBadge = () => (
  <span className="badge blue sm" title="يعطي مرضاه مواعيد بنفسه — لا يُحسب عليه تأخير ولا يدخل نسبة الالتزام">
    {APPOINTMENTS_LABEL}</span>
)
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
// السماح من الخادم (LATE_GRACE_MINUTES): «١٥ دقيقة»، «١٠ دقائق»
export const fmtMinutes = (n) => `${Number(n).toLocaleString('ar-SY')} ${n >= 3 && n <= 10 ? 'دقائق' : 'دقيقة'}`
// مدّة الدوام: «٣ س ١٥ د» · «٤٥ د» — للانصراف والساعات
export const fmtDuration = (m) => {
  const h = Math.floor((m || 0) / 60), r = (m || 0) % 60
  const n = (x) => Number(x).toLocaleString('ar-SY')
  return h ? `${n(h)} س${r ? ` ${n(r)} د` : ''}` : `${n(r)} د`
}
// ساعات العمل ساعةً:دقيقة — «١٤:٤٢» = ١٤ ساعة و٤٢ دقيقة (قرار المستخدم: لا كسر عشريّ ١٤٫٧).
// الأرقام الهندية والنقطتان تبقى بترتيبها داخل النصّ العربي (رقمٌ عربيّ مفصولٌ بفاصلٍ مشترك).
export const fmtClock = (m) => {
  const t = Math.max(0, Math.round(m || 0)), h = Math.floor(t / 60), r = t % 60
  return `${h.toLocaleString('ar-SY')}:${r.toLocaleString('ar-SY', { minimumIntegerDigits: 2 })}`
}
export const clockTitle = (m) => {
  const t = Math.max(0, Math.round(m || 0)), h = Math.floor(t / 60), r = t % 60
  return `${h.toLocaleString('ar-SY')} ساعة${r ? ` و${r.toLocaleString('ar-SY')} دقيقة` : ''}`
}
export const fmtPct = (c) => (c === null || c === undefined ? '—' : `${Math.round(c * 100).toLocaleString('ar-SY')}٪`)
const minutes = (n) => `${fmtInt(n)} د`

/** بطاقات الالتزام: أيام الدوام / حضر / غاب، النسبة، متوسّط التأخير */
export function PunctualityTiles({ p, extra = null, apologized = 0 }) {
  const appt = !!p.appointmentsBased
  return (
    <div className={`tiles earn-tiles pn-tiles${extra ? '' : ' pn-3'}`}>
      <div className="tile pn-days">
        <div className="label">أيام الدوام</div>
        <div className="value">{fmtInt(p.scheduled)}</div>
        <div className="pn-split">
          <span>حضر <strong>{fmtInt(p.attended)}</strong></span>
          <span className={p.absent ? 'pn-bad' : ''}>غاب <strong>{fmtInt(p.absent)}</strong></span>
          {apologized > 0 && <span className="pn-bad">اعتذر <strong>{fmtInt(apologized)}</strong></span>}
        </div>
      </div>
      <div className="tile earn-hero">
        <div className="label">نسبة الالتزام</div>
        {appt ? <>
          <div className="value pn-appt-value">{APPOINTMENTS_LABEL}</div>
          <div className="pn-sub">يأتي على مواعيده مع مرضاه — لا تُحسب له نسبة التزام</div>
        </> : <>
          <div className="value">{fmtPct(p.commitment)}</div>
          <div className="pn-sub">{p.actual
            ? `${fmtInt(p.onTime)} بالوقت من ${fmtInt(p.actual)} ${p.actual === 1 ? 'يوم' : 'أيام'} حضورٍ فعلي`
            : 'لا حضور فعليّ مسجَّل بعد'}</div>
        </>}
      </div>
      <div className="tile">
        <div className="label">متوسّط التأخير</div>
        <div className="value">{appt || p.avgLate === null ? '—' : minutes(p.avgLate)}</div>
        <div className="pn-sub">{appt ? APPOINTMENTS_LABEL
          : p.late ? `${fmtInt(p.late)} ${p.late === 1 ? 'يوم' : 'أيام'} تأخير` : 'لا تأخير'}</div>
      </div>
      {extra}
    </div>
  )
}

// ═══ التقويم: أسابيع تبدأ السبت، كلّ يوم دوامٍ بلونه ═══
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const weekdayOf = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0 الأحد … 6 السبت
}
const WEEK_HEAD = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة']
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول',
  'تشرين الأول', 'تشرين الثاني', 'كانون الأول']

const dayTitle = (d) => {
  if (!d) return ''
  const head = `${DAY_LABELS[d.status]} · بداية الدوام ${d.start}`
  if (!d.arrival) return head
  const how = d.status === 'estimated' ? ' (أوّل نداء — بلا «وصل الطبيب»)' : ''
  return `${head} · الوصول ${d.arrival}${how}${d.late ? ` · ${d.late} د` : ''}`
}

// apologies: [{ date, reason }] — يومٌ أحمر مكتوبٌ فيه «اعتذر»، والسبب في التلميح
export function DutyCalendar({ from, to, days, apologies = [] }) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const apology = new Map(apologies.map((x) => [x.date, x.reason]))
  const first = addDays(from, -((weekdayOf(from) + 1) % 7))
  const cells = []
  for (let d = first; d <= to || cells.length % 7; d = addDays(d, 1)) cells.push(d)
  return (
    <div className="pn-cal-wrap">
      <div className="pn-cal" role="grid" aria-label="تقويم الدوام">
        {WEEK_HEAD.map((h) => <div key={h} className="pn-cal-head" role="columnheader">{h}</div>)}
        {cells.map((ymd) => {
          const out = ymd < from || ymd > to
          const apologized = !out && apology.has(ymd)
          const d = apologized ? null : byDate.get(ymd)
          const dayN = Number(ymd.slice(8))
          const title = apologized ? `اعتذر${apology.get(ymd) ? `: ${apology.get(ymd)}` : ' (بلا سبب مكتوب)'}` : dayTitle(d)
          // كلمةٌ في الخانة نفسها — فلا يُقرأ اليوم باللون وحده
          const tag = apologized ? 'اعتذر' : d?.status === 'late' ? `+${fmtDuration(d.late)}`
            : d?.status === 'absent' ? 'غاب' : null
          return (
            <div key={ymd} role="gridcell" title={title}
              className={`pn-cell${out ? ' is-out' : ''}${apologized ? ' is-apology' : d ? ` is-${d.status}` : ''}`}
              aria-label={title ? `${ymd}: ${title}` : ymd}>
              <span className="pn-cell-n">{dayN.toLocaleString('ar-SY')}</span>
              {tag ? <span className="pn-cell-tag">{tag}</span>
                : dayN === 1 && !out && <span className="pn-cell-m">{MONTHS[Number(ymd.slice(5, 7)) - 1]}</span>}
              {d?.status === 'estimated' && <span className="pn-cell-mark" aria-hidden="true">≈</span>}
            </div>
          )
        })}
      </div>
      <div className="pn-legend">
        <span><i className="is-on_time" /> بالوقت</span>
        <span><i className="is-late" /> متأخّر (بدقائقه)</span>
        <span><i className="is-absent" /> غائب</span>
        {apology.size > 0 && <span><i className="is-apology" /> اعتذر</span>}
        <span><i className="is-estimated" /> تقديري ≈</span>
        {days.some((d) => d.status === 'appointments') && <span><i className="is-appointments" /> {APPOINTMENTS_LABEL}</span>}
      </div>
      {days.some((d) => d.status === 'estimated') && (
        <p className="earn-note">≈ تقديري: لم يُكبس «وصل الطبيب» فاعتُمد أوّل نداء — لا يدخل نسبة الالتزام ولا الترتيب.</p>
      )}
    </div>
  )
}

// ═══ سجلّ الحضور: كلّ يومٍ في الفترة بحالته وتفاصيله — عدّاداتٌ تُرشِّح ═══
// الاعتذار من apologies (بسببه)، والباقي من days. الترتيب بالتاريخ.
const LOG_KINDS = [
  ['apology', 'اعتذر'], ['absent', 'غاب'], ['late', 'تأخّر'], ['on_time', 'بالوقت'],
  ['estimated', 'تقديري'], ['appointments', APPOINTMENTS_LABEL], ['pending', 'لم يُحسم'],
]
const longDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('ar-SY', { weekday: 'long', timeZone: 'UTC' })
const T = ({ v }) => <bdi dir="ltr" className="pn-log-t">{v}</bdi>

function LogDetail({ e }) {
  if (e.status === 'apology') return <>
    {e.reason ? <span className="pn-log-reason">«{e.reason}»</span> : <span className="muted">بلا سبب مكتوب</span>}
    {e.upcoming && <span className="badge blue sm">قادم</span>}
  </>
  if (e.status === 'late') return <>وصل <T v={e.arrival} /> والدوام <T v={e.start} /> — <strong className="pn-late-n">تأخّر {fmtDuration(e.late)}</strong></>
  if (e.status === 'on_time') return <>وصل <T v={e.arrival} /> والدوام <T v={e.start} /></>
  if (e.status === 'absent') return <>لا «وصل الطبيب» ولا مريضٌ خُدم — الدوام <T v={e.start} /></>
  if (e.status === 'estimated') return <>أوّل نداء <T v={e.arrival} /> بلا «وصل الطبيب» — الدوام <T v={e.start} /></>
  if (e.status === 'appointments') return <>وصل <T v={e.arrival} /> — {APPOINTMENTS_LABEL}</>
  return <>اليوم — لم يصل بعد (الدوام <T v={e.start} />)</>
}

export function AttendanceLog({ days, apologies = [], today }) {
  const [filter, setFilter] = useState('all')
  const entries = [
    ...days.map((d) => ({ ...d })),
    ...apologies.map((x) => ({ date: x.date, status: 'apology', reason: x.reason, upcoming: !!today && x.date > today })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const count = (k) => entries.filter((e) => e.status === k).length
  const kinds = LOG_KINDS.filter(([k]) => count(k) > 0)
  const lateTotal = entries.filter((e) => e.status === 'late').reduce((t, e) => t + (e.late || 0), 0)
  const shown = filter === 'all' ? entries : entries.filter((e) => e.status === filter)
  if (entries.length === 0) return <p className="empty">لا أيام دوام ولا اعتذارات في هذه الفترة.</p>
  return (
    <div className="pn-log">
      <div className="pn-log-filters" role="group" aria-label="ترشيح السجلّ">
        <button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? 'is-on' : ''}
          onClick={() => setFilter('all')}>الكل <b>{fmtInt(entries.length)}</b></button>
        {kinds.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} className={`is-${k}${filter === k ? ' is-on' : ''}`}
            onClick={() => setFilter(filter === k ? 'all' : k)}>{label} <b>{fmtInt(count(k))}</b></button>
        ))}
      </div>
      {lateTotal > 0 && (filter === 'all' || filter === 'late') && (
        <p className="pn-log-total">مجموع التأخير في الفترة: <strong>{fmtDuration(lateTotal)}</strong></p>
      )}
      <ul className="pn-log-list">
        {shown.map((e) => (
          <li key={`${e.date}-${e.status}`} className={`pn-log-row is-${e.status}`}>
            <div className="pn-log-date">
              <strong>{Number(e.date.slice(8)).toLocaleString('ar-SY')}</strong>
              <span>{MONTHS[Number(e.date.slice(5, 7)) - 1]}</span>
              <span>{longDay(e.date)}</span>
            </div>
            <span className={`pn-log-badge is-${e.status}`}>{e.status === 'apology' ? 'اعتذر' : DAY_LABELS[e.status]}</span>
            <div className="pn-log-detail"><LogDetail e={e} /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
