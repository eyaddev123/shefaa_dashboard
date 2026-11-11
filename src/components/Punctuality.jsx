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

// apologies: تواريخ اعتذار الدكتور (بلا السبب) — يومٌ أحمر مكتوبٌ فيه «اعتذر»
export function DutyCalendar({ from, to, days, apologies = [] }) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const apology = new Set(apologies)
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
          const title = apologized ? 'اعتذر الدكتور عن هذا اليوم' : dayTitle(d)
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

/** أيام التأخير: التاريخ، بداية الدوام، الوصول، كم دقيقة */
export function LateDays({ days }) {
  const late = days.filter((d) => d.status === 'late')
  if (late.length === 0) return <p className="empty">لا أيام تأخير في هذه الفترة.</p>
  return (
    <table className="rtable earn-table pn-late">
      <thead><tr><th>التاريخ</th><th>بداية الدوام</th><th>الوصول</th><th>التأخير</th></tr></thead>
      <tbody>
        {late.map((d) => (
          <tr key={d.date}>
            <td className="rt-title"><span dir="ltr">{d.date}</span> <span className="earn-spec">{WEEK_HEAD[(weekdayOf(d.date) + 1) % 7]}</span></td>
            <td className="num" data-label="بداية الدوام"><span dir="ltr">{d.start}</span></td>
            <td className="num" data-label="الوصول"><span dir="ltr">{d.arrival}</span></td>
            <td className="num pn-late-n" data-label="التأخير">{minutes(d.late)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
