// ═══ الالتزام بالدوام — قطعٌ مشتركة بين لوحة تحكم الدكتور و«التزامي» في «أعمالي» ═══
// الحساب كلّه في الخادم (server/src/doctor-dashboard.js) — هنا عرضٌ وحده:
//   بالوقت (≤ ١٠ د) أخضر · متأخّر أصفر · غائب أحمر · تقديري رمادي (بلا «وصل الطبيب»، بأوّل نداء)
// والتقديريّ لا يدخل نسبة الالتزام ولا الترتيب. اليوم الجاري بلا وصولٍ بعد «لم يُحسم» بلا لون.

export const DAY_LABELS = {
  on_time: 'بالوقت', late: 'متأخّر', absent: 'غائب', estimated: 'تقديري', pending: 'لم يُحسم بعد',
}
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
export function PunctualityTiles({ p, extra = null }) {
  return (
    <div className={`tiles earn-tiles pn-tiles${extra ? '' : ' pn-3'}`}>
      <div className="tile pn-days">
        <div className="label">أيام الدوام</div>
        <div className="value">{fmtInt(p.scheduled)}</div>
        <div className="pn-split">
          <span>حضر <strong>{fmtInt(p.attended)}</strong></span>
          <span className={p.absent ? 'pn-bad' : ''}>غاب <strong>{fmtInt(p.absent)}</strong></span>
        </div>
      </div>
      <div className="tile earn-hero">
        <div className="label">نسبة الالتزام</div>
        <div className="value">{fmtPct(p.commitment)}</div>
        <div className="pn-sub">{p.actual
          ? `${fmtInt(p.onTime)} بالوقت من ${fmtInt(p.actual)} ${p.actual === 1 ? 'يوم' : 'أيام'} حضورٍ فعلي`
          : 'لا حضور فعليّ مسجَّل بعد'}</div>
      </div>
      <div className="tile">
        <div className="label">متوسّط التأخير</div>
        <div className="value">{p.avgLate === null ? '—' : minutes(p.avgLate)}</div>
        <div className="pn-sub">{p.late ? `${fmtInt(p.late)} ${p.late === 1 ? 'يوم' : 'أيام'} تأخير` : 'لا تأخير'}</div>
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

export function DutyCalendar({ from, to, days }) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const first = addDays(from, -((weekdayOf(from) + 1) % 7))
  const cells = []
  for (let d = first; d <= to || cells.length % 7; d = addDays(d, 1)) cells.push(d)
  return (
    <div className="pn-cal-wrap">
      <div className="pn-cal" role="grid" aria-label="تقويم الدوام">
        {WEEK_HEAD.map((h) => <div key={h} className="pn-cal-head" role="columnheader">{h}</div>)}
        {cells.map((ymd) => {
          const d = byDate.get(ymd)
          const out = ymd < from || ymd > to
          const dayN = Number(ymd.slice(8))
          return (
            <div key={ymd} role="gridcell" title={dayTitle(d)}
              className={`pn-cell${out ? ' is-out' : ''}${d ? ` is-${d.status}` : ''}`}
              aria-label={d ? `${ymd}: ${dayTitle(d)}` : ymd}>
              <span className="pn-cell-n">{dayN.toLocaleString('ar-SY')}</span>
              {dayN === 1 && !out && <span className="pn-cell-m">{MONTHS[Number(ymd.slice(5, 7)) - 1]}</span>}
              {d?.status === 'estimated' && <span className="pn-cell-mark" aria-hidden="true">≈</span>}
            </div>
          )
        })}
      </div>
      <div className="pn-legend">
        <span><i className="is-on_time" /> بالوقت</span>
        <span><i className="is-late" /> متأخّر</span>
        <span><i className="is-absent" /> غائب</span>
        <span><i className="is-estimated" /> تقديري ≈</span>
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
