import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, todayLocal } from '../api.js'
import { matchesAr } from '../arabic-search.js'
import { fmtClock, clockTitle } from '../components/Punctuality.jsx'
import { partsFormula, partsOf, salaryPatientsOf } from '../pay-parts.js'

// ═══ حسابات الدكاترة — لشهر أو يوم أو فترة ═══
// صفحة «تقارير الدكاترة» وتبويب «حسابات الدكاترة» في صندوق العيادات يعرضان هذا نفسه.
// الحساب كلّه في الخادم (buildDoctorAccounts) — هنا عرضٌ وحده:
//   ملخّص الفترة ← بحث وترتيب ← بطاقة لكلّ دكتور فيه نشاط ← من لا نشاط له في سطرٍ أخير.
// «صافي الربح» = ما دخل الشفاء من كشوف الدكتور وإجراءاته − راتبه (كان اسمه «الفرق»).
// الفترة في الرابط (?month= · ?day= · ?from=&to=)؛ البحث والترتيب في الصفحة وحدها.

// المبالغ بالليرة الكاملة (الأسعار بالمئات — الكسر ضجيج)، والنسب بمنزلةٍ عشرية واحدة
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })
const fmtOne = (h) => Number(h || 0).toLocaleString('ar-SY', { maximumFractionDigits: 1 })
// «+١٦٬٠٠٠» و«−٦٠٬٠٠٠» — الإشارة نصّاً: toLocaleString يسبق السالب بعلامة اتجاه تُرسم شرطةً ثانية
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
// «يوم واحد» · «يومان» · «٥ أيام» · «١١ يوماً» — ولا «·» بجانب رقمٍ هنديّ (يُقرأ صفراً)
const daysText = (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${fmtNum(n)} ${n >= 3 && n <= 10 ? 'أيام' : 'يوماً'}`)
// ساعات العمل من الدقائق: «١١:٣٦ ساعة» (ساعة:دقيقة)، والتلميح بالكلمات
const hoursText = (m) => `${fmtClock(m)} ساعة`
const countText = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : `${fmtNum(n)} ${n >= 3 && n <= 10 ? few : many}`)
const procText = (n) => (n ? countText(n, 'إجراء واحد', 'إجراءان', 'إجراءات', 'إجراءً') : 'بلا إجراءات')
const payText = (d) => (d.payKind === 'daily_hourly' ? 'يومية + ساعة'
  : d.payKind === 'fixed' ? 'راتب شهري ثابت'
  : d.payKind === 'per_patient' ? `${fmtNum(d.payAmount)} ل.س للمريض` : null)
const initial = (name) => String(name || '').replace(/^د\.\s*/, '').trim().charAt(0) || '؟'

const shiftMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const shiftDay = (day, n) => {
  const [y, m, d] = day.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')
// «تشرين الثاني ٢٠٢٦» و«الأربعاء ١١ تشرين الثاني» — منتصف النهار UTC فلا يقفز اليوم بفرق التوقيت
const monthLabel = (m) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('ar-SY', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-SY', { day: 'numeric', month: 'long', timeZone: 'UTC' })

const MODES = [['month', 'شهر'], ['day', 'يوم'], ['custom', 'فترة']]
const SORTS = [
  ['profit', 'الأعلى ربحاً', (a, b) => (b.diff ?? -Infinity) - (a.diff ?? -Infinity)],
  ['patients', 'الأكثر مرضى', (a, b) => b.patients - a.patients],
  ['late', 'الأكثر تأخيراً', (a, b) => (b.p?.lateRate ?? -1) - (a.p?.lateRate ?? -1) || (b.p?.late ?? 0) - (a.p?.late ?? 0)],
  ['hours', 'الأكثر حضوراً', (a, b) => b.attendance.days - a.attendance.days || b.attendance.minutes - a.attendance.minutes],
  ['name', 'أبجدياً', (a, b) => a.doctor.localeCompare(b.doctor, 'ar')],
]
const hasActivity = (d) => d.patients > 0 || d.procedures > 0 || d.attendance.days > 0 || d.shifa > 0
  || (d.p && (d.p.scheduled > 0 || d.p.apologized > 0))
const pct = (x) => `${Math.round(x * 100).toLocaleString('ar-SY')}٪`
const minText = (m) => {
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${fmtNum(h)} س${r ? ` ${fmtNum(r)} د` : ''}` : `${fmtNum(r)} د`
}
const dayCount = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : `${fmtNum(n)} ${n <= 10 ? 'أيام' : 'يوماً'}`)

// ═══ الالتزام بالدوام في البطاقة: بالوقت مقابل التأخير، والغياب والاعتذار ═══
// «بمواعيد خاصة»: لا نسبة ولا تأخير — يأتي على مواعيده التي يعطيها لمرضاه.
function PunctStrip({ p }) {
  if (!p) return null
  const extra = (
    <>
      {p.absent > 0 && <span className="dr-pchip is-absent">غاب {dayCount(p.absent)}</span>}
      {p.apologized > 0 && <span className="dr-pchip is-apology">اعتذر {dayCount(p.apologized)}</span>}
    </>
  )
  if (p.appointmentsBased) return (
    <div className="dr-punct is-appt">
      <div className="dr-punct-head"><span>الالتزام بالدوام</span><strong>بمواعيد خاصة</strong></div>
      <p className="dr-punct-sub">يأتي على المواعيد التي يعطيها لمرضاه — لا يُحسب عليه تأخير.</p>
      {(p.absent > 0 || p.apologized > 0) && <div className="dr-punct-chips">{extra}</div>}
    </div>
  )
  if (!p.actual) return (
    <div className="dr-punct">
      <div className="dr-punct-head"><span>الالتزام بالدوام</span><strong className="muted">—</strong></div>
      <p className="dr-punct-sub">{p.estimated ? `لم يُكبس «وصل الطبيب» في أيامه (${dayCount(p.estimated)} بأوّل نداء)` : 'لا حضور مسجَّل في الفترة'}</p>
      {(p.absent > 0 || p.apologized > 0) && <div className="dr-punct-chips">{extra}</div>}
    </div>
  )
  const onW = (p.onTime / p.actual) * 100
  return (
    <div className="dr-punct">
      <div className="dr-punct-head">
        <span>الالتزام بالدوام</span>
        <strong className={p.lateRate > 0.5 ? 'is-bad' : p.lateRate > 0 ? 'is-warn' : 'is-good'}>
          {p.late ? `يتأخّر ${pct(p.lateRate)}` : 'دائماً بالوقت'}</strong>
      </div>
      <div className="dr-punct-bar" role="img" aria-label={`بالوقت ${pct(1 - p.lateRate)}، تأخير ${pct(p.lateRate)}`}>
        {p.onTime > 0 && <span className="on" style={{ width: `${onW}%` }} />}
        {p.late > 0 && <span className="late" style={{ width: `${100 - onW}%` }} />}
      </div>
      {/* بلا «٠»: الصفر الهنديّ بجانب كلمة يُقرأ نقطة — فالجملة تُبنى على ما وقع */}
      <p className="dr-punct-sub">
        {p.late
          ? <>تأخّر في <b>{dayCount(p.late)}</b> من {fmtNum(p.actual)} — متوسّط التأخير <b>{minText(p.avgLate)}</b></>
          : <>بالوقت في كلّ أيامه (<b>{dayCount(p.onTime)}</b>)</>}
      </p>
      {(p.absent > 0 || p.apologized > 0) && <div className="dr-punct-chips">{extra}</div>}
    </div>
  )
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
)

// تحميلٌ مرتبطٌ بمفتاحه: ردّ فترةٍ سابقة لا يُعرض تحت الفترة الجديدة
function useAccounts(query) {
  const key = JSON.stringify(query)
  const [loaded, setLoaded] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setErr(null)
    Promise.all([api.clinic.doctorAccounts(query), api.clinic.doctorsPunctuality(query).catch(() => null)])
      .then(([d, p]) => { if (live) setLoaded({ key, d: { ...d, punct: p?.doctors || null, grace: p?.grace } }) })
      .catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [key])
  return [loaded && loaded.key === key ? loaded.d : null, err]
}

// حقل تاريخٍ بنصٍّ عربيّ: الحقل الأصليّ شفّافٌ فوق النصّ، والضغط يفتح منتقي المتصفّح
function DateField({ type, value, label, onChange, min }) {
  return (
    <label className="dr-date">
      <span>{label}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      <input type={type} value={value || ''} min={min} aria-label={label}
        onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* متصفّحٌ قديم: الحقل نفسه يكفي */ } }}
        onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  )
}

function PeriodBar({ mode, cur, curDay, from, to, data, set }) {
  const pickMode = (m) => set(m === 'day' ? { day: data?.today || todayLocal() }
    : m === 'custom' ? { from: data?.from || todayLocal(), to: data?.to || todayLocal() } : {})
  return (
    <div className="dr-period">
      <div className="dr-seg" role="group" aria-label="الفترة">
        {MODES.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? 'is-on' : ''}
            onClick={() => pickMode(k)}>{label}</button>
        ))}
      </div>
      {mode !== 'custom' ? (
        <div className="dr-nav" role="group" aria-label={mode === 'day' ? 'اليوم' : 'الشهر'}>
          <button type="button" className="dr-step" disabled={!(mode === 'day' ? curDay : cur)}
            onClick={() => set(mode === 'day' ? { day: shiftDay(curDay, -1) } : { month: shiftMonth(cur, -1) })}
            aria-label={mode === 'day' ? 'اليوم السابق' : 'الشهر السابق'}>›</button>
          {mode === 'day'
            ? <DateField type="date" value={curDay} label={curDay ? dayLabel(curDay) : '…'} onChange={(v) => set({ day: v })} />
            : <DateField type="month" value={cur} label={cur ? monthLabel(cur) : '…'} onChange={(v) => set({ month: v })} />}
          <button type="button" className="dr-step" disabled={!(mode === 'day' ? curDay : cur)}
            onClick={() => set(mode === 'day' ? { day: shiftDay(curDay, 1) } : { month: shiftMonth(cur, 1) })}
            aria-label={mode === 'day' ? 'اليوم التالي' : 'الشهر التالي'}>‹</button>
        </div>
      ) : (
        <div className="dr-nav dr-range">
          <span className="dr-range-lbl">من</span>
          <DateField type="date" value={from} label={from ? shortDay(from) : '…'}
            onChange={(v) => set({ from: v, to: v > to ? v : to })} />
          <span className="dr-range-lbl">إلى</span>
          <DateField type="date" value={to} min={from} label={to ? shortDay(to) : '…'} onChange={(v) => set({ from, to: v })} />
        </div>
      )}
    </div>
  )
}

function Summary({ data, active }) {
  const t = data.totals
  const ps = active.map((d) => d.p).filter((p) => p && !p.appointmentsBased)
  const sum = (k) => ps.reduce((n, p) => n + (p[k] || 0), 0)
  const onTime = sum('onTime'), late = sum('late'), actual = onTime + late
  const absent = active.reduce((n, d) => n + (d.p?.absent || 0), 0)
  const apologized = active.reduce((n, d) => n + (d.p?.apologized || 0), 0)
  const appt = active.filter((d) => d.p?.appointmentsBased).length
  const days = active.reduce((s, d) => s + d.attendance.days, 0)
  const minutes = active.reduce((s, d) => s + d.attendance.minutes, 0)
  const present = active.filter((d) => d.attendance.days > 0).length
  return (
    <div className="dr-summary">
      <div className="dr-stat">
        <span className="dr-stat-lbl">الحضور</span>
        <strong className="dr-stat-val">{days ? daysText(days) : '—'}</strong>
        <span className="dr-stat-sub" title={minutes ? clockTitle(minutes) : undefined}>{minutes ? `${hoursText(minutes)} عمل` : 'لا ساعات مسجّلة'}</span>
        {present > 0 && <span className="dr-stat-foot">حضر {present === 1 ? 'دكتورٌ واحد' : present === 2 ? 'دكتوران' : `${fmtNum(present)} ${present <= 10 ? 'دكاترة' : 'دكتوراً'}`}</span>}
      </div>
      <div className="dr-stat">
        <span className="dr-stat-lbl">المرضى</span>
        <strong className="dr-stat-val">{fmtNum(t.patients)}</strong>
        <span className="dr-stat-sub">كشفٌ منتهٍ</span>
        <span className="dr-stat-foot">ومعها {procText(t.procedures)}</span>
      </div>
      <div className="dr-stat">
        <span className="dr-stat-lbl">دخل الشفاء</span>
        <strong className="dr-stat-val">{fmtNum(t.shifa)}<small> ل.س</small></strong>
        <span className="dr-stat-sub">من الكشوفات {fmtNum(t.visitShifa)}</span>
        <span className="dr-stat-foot">ومن الإجراءات {fmtNum(t.procShifa)}</span>
      </div>
      {data.punct && (
        <div className="dr-stat">
          <span className="dr-stat-lbl">الالتزام بالدوام</span>
          <strong className="dr-stat-val">{actual ? pct(onTime / actual) : '—'}<small> بالوقت</small></strong>
          <span className="dr-stat-sub">{actual ? (late ? `تأخير في ${pct(late / actual)} من الأيام` : 'بلا أيّ تأخير') : 'لا حضور مسجَّل'}</span>
          <span className="dr-stat-foot">{[absent && `غياب ${dayCount(absent)}`, apologized && `اعتذار ${dayCount(apologized)}`,
            appt && `${fmtNum(appt)} بمواعيد خاصة`].filter(Boolean).join('، ') || 'لا غياب ولا اعتذار'}</span>
        </div>
      )}
      <div className={`dr-stat dr-stat-hero${t.diff < 0 ? ' is-loss' : ''}`}>
        <span className="dr-stat-lbl">{t.diff < 0 ? 'صافي الخسارة' : 'صافي الربح'}</span>
        <strong className="dr-stat-val">{signed(t.diff)}<small> ل.س</small></strong>
        <span className="dr-stat-sub">{t.salary > 0 ? `بعد رواتب الدكاترة ${fmtNum(t.salary)}` : 'لا رواتب مضبوطة بعد'}</span>
        <span className="dr-stat-foot">الدخل − الرواتب</span>
      </div>
    </div>
  )
}

// البطاقة كلّها تفتح وجهتها (لوحة الدكتور في التقارير، البروفايل في الصندوق) — بالنقر وبـ Enter.
// الاسم يبقى رابطاً حقيقياً (فتحٌ في تبويب جديد، قارئ الشاشة)؛ ورابطٌ داخل رابط غير صالح فلا <a> حولها.
function DoctorCard({ d, share, link }) {
  const a = d.attendance
  const pay = payText(d)
  const navigate = useNavigate()
  const open = (e) => {
    if (!link || e.target.closest('a, button')) return
    if (window.getSelection?.().toString()) return   // تحديد نصٍّ لنسخه ليس نقراً
    navigate(link)
  }
  return (
    <article className={`dr-card${link ? ' is-link' : ''}`} onClick={open}
      {...(link ? { role: 'link', tabIndex: 0,
        onKeyDown: (e) => { if (e.key === 'Enter') navigate(link) } } : {})}>
      <header className="dr-card-head">
        <span className="dr-avatar" aria-hidden="true">{initial(d.doctor)}</span>
        <div className="dr-who">
          <h4>{link ? <Link to={link}>{d.doctor}</Link> : d.doctor}</h4>
          <span className="dr-meta">
            {d.specialty && <span>{d.specialty}</span>}
            {!d.active && <span className="dr-off">موقوف</span>}
          </span>
        </div>
        <div className={`dr-profit${d.diff < 0 ? ' is-loss' : ''}`}>
          <span>{d.diff !== null && d.diff < 0 ? 'خسارة' : 'صافي الربح'}</span>
          <strong>{d.diff === null ? '—' : signed(d.diff)}</strong>
        </div>
      </header>

      <div className="dr-figs">
        <div className="dr-fig">
          <span className="dr-fig-lbl">الحضور</span>
          <strong>{a.days ? daysText(a.days) : '—'}</strong>
          <span className="dr-fig-sub" title={a.minutes ? clockTitle(a.minutes) : undefined}>{a.minutes ? hoursText(a.minutes) : a.days ? 'بلا ساعات' : 'لم يحضر'}</span>
        </div>
        <div className="dr-fig">
          <span className="dr-fig-lbl">المرضى</span>
          <strong>{fmtNum(d.patients)}</strong>
          <span className="dr-fig-sub">{procText(d.procedures)}</span>
        </div>
        <div className="dr-fig">
          <span className="dr-fig-lbl">دخل الشفاء</span>
          <strong>{fmtNum(d.shifa)}</strong>
          <span className="dr-fig-sub">كشوفات {fmtNum(d.visitShifa)}</span>
          {d.procShifa > 0 && <span className="dr-fig-sub">إجراءات {fmtNum(d.procShifa)}</span>}
        </div>
      </div>

      <PunctStrip p={d.p} />

      <div className="dr-share" title="حصّته من دخل الشفاء في الفترة">
        <div className="dr-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}
          aria-label="حصّته من دخل الفترة"><span style={{ width: `${Math.max(share, share > 0 ? 2 : 0)}%` }} /></div>
        <span className="dr-share-txt">{fmtOne(share)}٪ من دخل الفترة</span>
      </div>

      {(a.noDeparture > 0 || a.onDuty > 0) && (
        <div className="dr-flags">
          {a.noDeparture > 0 && (
            <span className="badge warn sm" title="هذه الأيام بلا ساعات حتى يُصحَّح الانصراف">
              انصراف غير مسجَّل في {a.noDeparture === 1 ? 'يوم واحد' : a.noDeparture === 2 ? 'يومين' : daysText(a.noDeparture)}</span>
          )}
          {a.onDuty > 0 && <span className="badge blue sm">في الدوام الآن</span>}
        </div>
      )}

      <footer className="dr-pay">
        <span className="dr-pay-lbl">الراتب</span>
        {d.noPay ? <span className="dr-pay-none">لم يُضبط بعد</span>
          : d.salary === null ? <span className="dr-pay-none" title="الراتب الشهري الثابت يُحسب للشهر الكامل وحده">للشهر الكامل وحده</span>
          : (
            <span className="dr-pay-val">
              <strong>{fmtNum(d.salary)}</strong>
              {partsOf(d)
                ? <small>{partsFormula(partsOf(d), d, { patients: salaryPatientsOf(d), days: a.days, minutes: a.minutes })}</small>
                : pay && <small>{pay}</small>}
            </span>
          )}
        {d.settleCycle && <span className="dr-cycle">تحاسبه {d.settleCycle === 'daily' ? 'يومياً' : 'شهرياً'}</span>}
      </footer>
    </article>
  )
}

// linkDashboard: صفحة «تقارير الدكاترة» تفتح لوحة الدكتور من اسمه (بدل البروفايل للمشرفة في الصندوق)
export function DoctorsTab({ canWrite, linkDashboard = false }) {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : null
  const day = isDay(params.get('day')) ? params.get('day') : null
  const from = isDay(params.get('from')) ? params.get('from') : null
  const to = isDay(params.get('to')) ? params.get('to') : from
  const mode = from ? 'custom' : day ? 'day' : 'month'
  const query = mode === 'custom' ? { from, to } : mode === 'day' ? { from: day, to: day } : { month }
  const [data, err] = useAccounts(query)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('profit')

  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const k of ['month', 'day', 'from', 'to']) next.delete(k)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v)
    setParams(next, { replace: true })
  }
  const cur = data?.month || month
  const curDay = day || data?.from
  const dashQuery = mode === 'month' && data?.month === todayLocal().slice(0, 7)
    ? 'period=month' : `period=custom&from=${data?.from}&to=${data?.to}`
  const linkOf = (d) => (linkDashboard ? `/clinic/doctors/${d.doctorId}/dashboard?${dashQuery}`
    : canWrite ? `/clinic/doctors/${d.doctorId}` : null)

  const { active, idle, shown } = useMemo(() => {
    if (!data) return { active: [], idle: [], shown: [] }
    const withP = data.doctors.map((d) => ({ ...d, p: data.punct?.[d.doctorId] || null }))
    const act = withP.filter(hasActivity)
    const cmp = SORTS.find(([k]) => k === sort)[2]
    return {
      active: act,
      idle: withP.filter((d) => !hasActivity(d)),
      shown: act.filter((d) => matchesAr(`${d.doctor} ${d.specialty}`, search)).sort(cmp),
    }
  }, [data, search, sort])
  const searching = search.trim() !== ''
  const shareOf = (d) => (data.totals.shifa > 0 ? Math.round((d.shifa / data.totals.shifa) * 1000) / 10 : 0)

  return (
    <div className="dr">
      <PeriodBar mode={mode} cur={cur} curDay={curDay} from={from} to={to} data={data} set={set} />

      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.doctors.length === 0 ? <p className="empty">لا دكاترة في هذه الفترة.</p> : (
          <>
            <Summary data={data} active={active} />

            {data.noDeparture > 0 && (
              <p className="dr-note is-warn" role="alert">
                {data.noDeparture === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.noDeparture)} دكاترة`} يُحسب لهم بالساعة عندهم أيامٌ بلا
                انصراف: ساعاتها لا تُحسب، فراتبهم أقلّ من المستحقّ حتى يُصحَّح الانصراف
                {canWrite ? ' (لوحة الدكتور ← الحضور والانصراف).' : '.'}
              </p>
            )}

            <div className="dr-tools">
              <div className="dr-search" role="search">
                <SearchIcon />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث باسم الدكتور أو الاختصاص…" aria-label="ابحث في الدكاترة" />
                {searching && <button type="button" className="dr-clear" aria-label="مسح البحث" onClick={() => setSearch('')}>×</button>}
              </div>
              <div className="dr-sort" role="group" aria-label="الترتيب">
                {SORTS.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={sort === k} className={sort === k ? 'is-on' : ''}
                    onClick={() => setSort(k)}>{label}</button>
                ))}
              </div>
              <span className="dr-count" aria-live="polite">
                {searching ? `${fmtNum(shown.length)} من ${fmtNum(active.length)}` : `${fmtNum(active.length)} دكتور بنشاط`}
              </span>
            </div>

            {shown.length === 0 ? (
              <div className="dr-empty">
                {searching ? <>
                  <strong>ما في دكتور بهالاسم</strong>
                  <span>لا نتائج لـ «{search.trim()}» بين دكاترة هذه الفترة.</span>
                  <button type="button" className="ghost" onClick={() => setSearch('')}>مسح البحث</button>
                </> : <strong>لا نشاط لأيّ دكتور في هذه الفترة.</strong>}
              </div>
            ) : (
              <div className="dr-grid">
                {shown.map((d) => <DoctorCard key={d.doctorId} d={d} share={shareOf(d)} link={linkOf(d)} />)}
              </div>
            )}

            {idle.length > 0 && !searching && (
              <div className="dr-idle">
                <span className="dr-idle-lbl">بلا نشاط في هذه الفترة:</span>
                {idle.map((d) => {
                  const l = linkOf(d)
                  return l ? <Link key={d.doctorId} to={l} className="dr-chip">{d.doctor}</Link>
                    : <span key={d.doctorId} className="dr-chip">{d.doctor}</span>
                })}
              </div>
            )}

            {data.iron?.count > 0 && (
              <p className="dr-note iron-revenue">
                جلسات الحديد ({fmtNum(data.iron.count)}) أدخلت للشفاء <strong>{fmtNum(data.iron.shifa)} ل.س</strong> خارج حساب الدكاترة —
                فدخل الشفاء كلّه مع الحديد <strong>{fmtNum(data.revenue)} ل.س</strong>.
              </p>
            )}
            {data.noPay > 0 && (
              <p className="dr-note">
                {data.noPay === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.noPay)} دكاترة`} لم يُضبط راتبهم بعد، فراتبهم صفرٌ هنا وربحهم = دخلهم كاملاً.
                {canWrite && ' يُضبط من بروفايل الدكتور ← حساب الدكتور.'}
              </p>
            )}
            {data.fixedPartial > 0 && (
              <p className="dr-note">
                {data.fixedPartial === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.fixedPartial)} دكاترة`} على «راتب شهري ثابت» القديم —
                يُحسب للشهر الكامل وحده، فهو خارج مجموع هذه الفترة.
              </p>
            )}

            <details className="dr-how">
              <summary>كيف تُحسب هذه الأرقام؟</summary>
              <dl>
                <dt>الحضور</dt>
                <dd>الأيام التي سُجّل فيها وصول الدكتور، والساعات من الوصول إلى الانصراف. يومٌ بلا انصراف يُعدّ يوماً بلا ساعات.</dd>
                <dt>المرضى</dt>
                <dd>الكشوف التي انتهت في جلسات الفترة. الإجراءات تُعدّ وحدها.</dd>
                <dt>دخل الشفاء</dt>
                <dd>من الكشوفات: رسم كلّ زيارةٍ حضرت (كما في الجرد). ومن الإجراءات: حصّة الشفاء من كلّ إجراءٍ قُبض في الفترة.</dd>
                <dt>الالتزام بالدوام</dt>
                <dd>من زرّ «وصل الطبيب»: بالوقت حتى {fmtNum(data.grace ?? 20)} دقيقة من بداية الدوام، وبعدها تأخير. نسبة التأخير = أيام التأخير ÷ أيام الحضور المسجَّل.
                  الغياب = يوم دوامٍ بلا وصول ولا مريض، والاعتذار لا يُعدّ غياباً. «بمواعيد خاصة» يأتي على مواعيده مع مرضاه فلا يُحسب عليه تأخير.</dd>
                <dt>صافي الربح</dt>
                <dd>دخل الشفاء من الدكتور ناقص راتبه. للعرض فقط: الراتب لا يُسحب من الإيرادات ولا يمسّ الجرد ولا الصندوق.</dd>
                <dt>الراتب</dt>
                <dd>بإعداد الدكتور الحالي: مجموع ما اختير له من المرضى × سعر المريض، والأيام × اليومية، والساعات × سعر الساعة.</dd>
              </dl>
            </details>
          </>
        )}
    </div>
  )
}
