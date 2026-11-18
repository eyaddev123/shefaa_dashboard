import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtMoney, openStaffStream, todayLocal, fmtDay, fmtMonth } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { useToast } from '../action-feedback.jsx'
import { fmtDuration, fmtMinutes, clockTitle } from '../components/Punctuality.jsx'
import { PeriodBar, weekStartOf, shiftDay } from './DoctorAccounts.jsx'
import { partLines, partsOf } from '../pay-parts.js'
import { useFeeMode } from '../fee-mode.js'

// ═══════════════════════════════════════════════════════════════════
// «أعمالي» — أرقام الطبيب عن نفسه (doctor-pages-redesign، 2026-11-15)
//
// مبنيّةٌ على أسئلته بترتيبها — بأداة فترةٍ واحدة فوق (اليوم · هذا الأسبوع · هذا الشهر · الشهر
// الماضي) تحكم الصفحة كلّها، بدل ثلاث أدوات كانت لكلّ قسمٍ أداته:
//   ١) «كم عملت؟»     — المرضى (والإجراءات لمن له إجراءات).
//   ٢) «كم يحقّ لي؟»   — حصّته من الإجراءات المحاسَبة بسطورها، وما ينتظر المحاسبة اليوم (يحذف سطره
//                        قبل القبض)، وراتب الشهر بمكوّناته. الراتب شهريّ بطبيعته: اليوم والأسبوع
//                        يعرضان راتب الشهر الجاري، و«الشهر الماضي» راتبه.
//   ٣) «كيف دوامي؟»   — جملةٌ واحدة، ثمّ جدول أيامٍ واحد يجمع الوصول والانصراف والمدّة والحالة
//                        (كانا جدولين: «التزامي» بتقويمٍ ملوّن و«راتبي وحضوري»).
//   ٤) «كيف تُحسب حصّتي؟» — مطويّ تحت، لمن له إجراءات.
// من لا إجراءات لاختصاصه (has_procedures = false): لا ذكر للإجراءات أصلاً.
// الشكل محايد: بطاقات بحدٍّ رفيع، أرقامٌ بلون النصّ، ولا ألوان إلا لتنبيهٍ حقيقيّ.
// ═══════════════════════════════════════════════════════════════════

// شريط الفترة كصفحة الأجور (طلب المستخدم 2026-11-18): يوم ثمّ أسبوع (من السبت) ثمّ شهر ثمّ فترة، بأسهم.
// كلّها مدى من–إلى للخادم (أعمالي والتزامي وراتبي)، والفترة في الرابط. الافتراضيّ اليوم.
const MODES = [['day', 'يوم'], ['week', 'أسبوع'], ['month', 'شهر'], ['custom', 'فترة']]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, MONTH_RE = /^\d{4}-\d{2}$/
const monthSpan = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return { from: `${m}-01`, to: `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}` }
}
function usePeriod() {
  const [params, setParams] = useSearchParams()
  const today = todayLocal()
  const get = (k, re) => (re.test(params.get(k) || '') ? params.get(k) : null)
  const from = get('from', DAY_RE), to = get('to', DAY_RE) || from
  const week = get('week', DAY_RE) && weekStartOf(get('week', DAY_RE))
  const month = get('month', MONTH_RE), day = get('day', DAY_RE) || today
  const mode = from ? 'custom' : week ? 'week' : month ? 'month' : 'day'
  const range = mode === 'custom' ? { from, to } : mode === 'week' ? { from: week, to: shiftDay(week, 6) }
    : mode === 'month' ? monthSpan(month) : { from: day, to: day }
  // من PeriodBar: { day } | { week } | { month } | { from, to } | {} (شهر ⇒ الجاري)
  const set = (p) => {
    const next = new URLSearchParams()
    const patch = Object.keys(p).length === 0 ? { month: today.slice(0, 7) } : p
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v)
    setParams(next, { replace: true })
  }
  return { mode, range, today, day, week, month: month || today.slice(0, 7), from, to, set }
}
const rangeTitle = (r) => (r.from === r.to ? fmtDay(`${r.from}T12:00:00`, { weekday: true, year: false })
  : `من ${fmtDay(`${r.from}T12:00:00`, { year: false })} إلى ${fmtDay(`${r.to}T12:00:00`, { year: false })}`)
const n = (x) => Number(x || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const monthTitle = (m) => (m ? fmtMonth(m) : '')
const count = (k, [one, two, few, many]) => (k === 1 ? one : k === 2 ? two : `${n(k)} ${k >= 3 && k <= 10 ? few : many}`)
const DAYS = ['يوم واحد', 'يومان', 'أيام', 'يوماً']
const dayName = (ymd) => fmtDay(`${ymd}T12:00:00`, { weekday: true, year: false })

// ═══ ١) كم عملت ═══
function WorkCard({ work, withProcedures }) {
  return (
    <section className="card dw-card" aria-label="عملي">
      <h3 className="dw-h">عملي</h3>
      <div className="dw-nums">
        <div className="dw-num"><strong>{n(work.patients)}</strong><span>المرضى</span></div>
        {withProcedures && <div className="dw-num"><strong>{n(work.procedures)}</strong><span>الإجراءات المحاسَبة</span></div>}
      </div>
    </section>
  )
}

// ═══ ٢) كم يحقّ لي ═══
function SalaryBlock({ sal }) {
  const a = sal.attendance, s = sal.salary
  const parts = partsOf(s)
  return (
    <div className="dk-salary dw-sub">
      <div className="dw-row dw-row-head">
        <span>الراتب — {sal.month ? monthTitle(sal.month) : rangeTitle(sal)}</span>
        <strong>{s ? <>{s.total === 0 ? 'صفر' : n(s.total)} ل.س</> : '—'}</strong>
      </div>
      {!s ? <p className="dk-sal-unset">لم تُحدَّد إعدادات راتبك بعد — تحدّدها مشرفة العيادات.</p> : (
        <>
          {parts ? (
            <ul className="dk-sal-calc">
              {partLines(parts, s, { patients: s.patients, days: a.days, minutes: a.minutes }).map((l) => (
                <li key={l.key}>
                  <span><span title={l.key === 'hours' ? clockTitle(a.minutes) : undefined}>{l.qty}</span> × {n(l.rate)}</span>
                  <b>{n(l.value)} ل.س</b>
                </li>
              ))}
            </ul>
          ) : <p className="dk-sal-line">راتب شهري ثابت</p>}
          {/* يومٌ بلا انصراف: ساعاته لا تُحسب — يُقال هنا لأنّه يفسّر رقم الراتب */}
          {a.noDeparture > 0 && (
            <p className="dw-warn" role="alert">
              {count(a.noDeparture, DAYS)} «انصراف غير مسجَّل»: {parts?.includes('hours') ? 'ساعاتها لا تُحسب، ' : ''}وتصحّحها المشرفة.
            </p>
          )}
          <p className="dw-note">{sal.to >= sal.today ? 'حسب الحضور المسجَّل حتى الآن.' : 'حسب الحضور المسجَّل في تلك الفترة.'}</p>
        </>
      )}
    </div>
  )
}

function DuesCard({ work, sal, salErr, withProcedures, pending, onRemove }) {
  return (
    <section className="card dw-card" aria-label="مستحقّاتي">
      <h3 className="dw-h">مستحقّاتي</h3>
      {withProcedures && work && (
        <div className="dw-sub">
          <div className="dk-work-total dw-row dw-row-head">
            <span>حصّتك من الإجراءات المحاسَبة</span>
            <strong>{fmtMoney(work.total_share)}</strong>
          </div>
          {work.lines.length > 0 && (
            <details className="dw-details">
              <summary>تفاصيل {count(work.lines.length, ['إجراء واحد', 'إجراءين', 'إجراءات', 'إجراءً'])}</summary>
              <ul className="dw-lines">
                {work.lines.map((l) => (
                  <li key={l.id}>
                    <span>{l.procedure} <small>— {l.patient}</small></span>
                    <b>{fmtMoney(l.doctor_share)}</b>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {pending.length > 0 && (
            <div className="dw-pending">
              <p className="dw-note">بانتظار المحاسبة اليوم — تُحتسب لك حين تقبضها الاستقبال، وتحذف ما أضفته أنت قبل ذلك:</p>
              <ul className="dw-lines">
                {pending.map((l) => (
                  <li key={l.id}>
                    <span>{l.name} <small>— {l.patient_name}</small></span>
                    {l.mine && (
                      <button type="button" className="ghost dw-x"
                        aria-label={`حذف ${l.name} عن ${l.patient_name}`} onClick={() => onRemove(l)}>حذف</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {salErr ? <p className="error">{salErr}</p> : sal ? <SalaryBlock sal={sal} /> : <p className="empty">جارٍ التحميل…</p>}
    </section>
  )
}

// ═══ ٣) كيف دوامي ═══
// جملةٌ ثمّ جدول أيامٍ واحد: من «التزامي» (الحالة والتأخير) ومن «راتبي» (الانصراف والمدّة) بالتاريخ.
// التأخير بالساعات والدقائق (طلب المستخدم 2026-11-18: «التأخير يكون ساعة و40 دقيقة»): 46 ⇒ «46 دقيقة»،
// 100 ⇒ «ساعة و40 دقيقة»، 628 ⇒ «10 ساعات و28 دقيقة». المدّة تبقى مختصرة (fmtDuration) بقراره.
const hoursWord = (h) => (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${n(h)} ${h >= 3 && h <= 10 ? 'ساعات' : 'ساعة'}`)
const minsWord = (m) => (m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : `${n(m)} ${m >= 3 && m <= 10 ? 'دقائق' : 'دقيقة'}`)
export const lateText = (min) => {
  const t = Math.max(0, Math.round(Number(min) || 0)), h = Math.floor(t / 60), m = t % 60
  return h === 0 ? minsWord(m) : m === 0 ? hoursWord(h) : `${hoursWord(h)} و${minsWord(m)}`
}
const STATE = {
  on_time: () => 'بالوقت',
  late: (d) => `متأخّر ${lateText(d.late)}`,
  absent: () => 'لم يحضر',
  estimated: () => 'بلا تسجيل وصول',
  pending: () => 'لم يصل بعد',
  appointments: () => 'بمواعيد خاصة',
}
// (جُرِّب تقويم الدوام هنا 2026-11-18 ثمّ أُزيل بطلب المستخدم: «طلع ما حلو… ما عاد بدنا ياه» — يبقى الجدول)
function DutyCard({ punct, sal, mode, from, to }) {
  const p = punct.punctuality
  const days = punct.days.filter((d) => d.date >= from && d.date <= to)
  const times = new Map((sal?.days || []).map((d) => [d.date, d]))
  let sentence
  if (mode === 'day') {
    const d = days[0]
    const isToday = from === punct.today
    const w = isToday ? 'اليوم' : `يوم ${dayName(from)}`
    sentence = !d ? `لا دوام لك ${w}.`
      : d.status === 'pending' ? `دوامك اليوم يبدأ ${d.start}، ولم يُسجَّل وصولك بعد.`
      : d.status === 'on_time' ? `وصلتَ ${w} ${d.arrival} — بالوقت.`
      : d.status === 'late' ? `وصلتَ ${w} ${d.arrival} — بعد بداية الدوام بـ${lateText(d.late)}.`
      : d.status === 'absent' ? `لم يُسجَّل حضورك ${w}.`
      : d.arrival ? `وصلتَ ${w} ${d.arrival}.` : `لم يُسجَّل وصولك ${w}.`
  } else {
    const att = days.filter((d) => ['on_time', 'late', 'estimated', 'appointments'].includes(d.status)).length
    const sched = days.filter((d) => d.status !== 'pending').length
    const lateDays = days.filter((d) => d.status === 'late')
    const onTime = days.filter((d) => d.status === 'on_time').length
    const lateAvg = lateDays.length ? Math.round(lateDays.reduce((t, d) => t + d.late, 0) / lateDays.length) : 0
    const attended = att === sched ? <>حضرتَ كلّ أيام دوامك ({count(sched, DAYS)})</>
      : att === 0 ? <>لم يُسجَّل حضورك في أيٍّ من أيام دوامك ({count(sched, DAYS)})</>
      : <>حضرتَ {n(att)} من {count(sched, DAYS)} دوام</>
    const punctual = p.appointmentsBased ? ' — وأنت «بمواعيد خاصة» فلا يُحسب عليك تأخير.'
      : att === 0 ? '.'
      : lateDays.length === 0 ? '، ووصلتَ بالوقت فيها كلّها.'
      : onTime === 0 ? <>، وتأخّرتَ فيها كلّها بمتوسّط {lateText(lateAvg)}.</>
      : <>، وصلتَ بالوقت في {count(onTime, DAYS)} وتأخّرتَ {count(lateDays.length, DAYS)} بمتوسّط {lateText(lateAvg)}.</>
    sentence = sched === 0 ? 'لا أيام دوام في هذه الفترة.' : <>{attended}{punctual}</>
  }
  return (
    <section className="card dw-card" aria-label="دوامي">
      <h3 className="dw-h">دوامي</h3>
      <p className="dw-sentence">{sentence}</p>
      {/* كلّ يومٍ سطران (طلب المستخدم 2026-11-18، بدل كرتٍ بأربع خاناتٍ معنونة): اليوم والحالة بلونها،
          ثمّ الوصول والانصراف والمدّة بخطٍّ صغير */}
      {days.length > 0 && mode !== 'day' && (
        <ul className="dw-days">
          {days.map((d) => {
            const t = times.get(d.date)
            const arrival = d.arrival || t?.arrived
            return (
              <li key={d.date} className={`dw-day is-${d.status}`}>
                <div className="dw-day-top">
                  <strong>{dayName(d.date)}</strong>
                  <span className={`dw-state is-${d.status}`}>{(STATE[d.status] || (() => d.status))(d)}</span>
                </div>
                <div className="dw-day-sub">
                  {!arrival ? 'لا وصول مسجَّل' : <>
                    وصول <bdi dir="ltr">{arrival}</bdi>
                    {t?.departed ? <>، انصراف <bdi dir="ltr">{t.departed}</bdi></>
                      : t?.state === 'no_departure' ? <>، <span className="dw-warn-text">انصراف غير مسجَّل</span></> : null}
                    {t?.minutes != null && <>، {fmtDuration(t.minutes)}</>}
                  </>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="dw-note">{p.appointmentsBased
        ? 'يُسجَّل وصولك بكبسة «وصل الطبيب» عند الاستقبال ليُحسب يوم حضورك.'
        : `«بالوقت» = خلال ${fmtMinutes(punct.grace)} من بداية الدوام، بكبسة «وصل الطبيب» عند الاستقبال.`}</p>
    </section>
  )
}

// ═══ ٤) كيف تُحسب حصّتي — مطويّ ═══
const ruleText = (r) => (r.kind !== 'percent' ? `مبلغ ثابت ${fmtMoney(r.value)}`
  : r.value === 0 ? 'بلا حصّة' : `${n(r.value)}% بعد المواد`)
function ShareRule() {
  const [rule, setRule] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.clinic.myShareRule().then(setRule).catch((e) => setErr(e.message)) }, [])
  return (
    <details className="card dk-rule dw-card">
      <summary className="dw-h">كيف تُحسب حصّتي من الإجراءات؟</summary>
      {err ? <p className="error">{err}</p> : !rule ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <p className="dk-rule-general"><span>القاعدة العامّة</span>
            <strong>{rule.general ? ruleText(rule.general) : 'لم تُحدَّد بعد'}</strong></p>
          {rule.procedures?.length > 0 && (
            <>
              <p className="dk-rule-note">قواعد خاصّة تغلب العامّة في هذه الإجراءات:</p>
              <ul className="dk-rule-list">
                {rule.procedures.map((p) => <li key={p.name}><span>{p.name}</span><strong>{ruleText(p)}</strong></li>)}
              </ul>
            </>
          )}
          <p className="dk-rule-note">للاطّلاع — تعدّلها مشرفة العيادات.</p>
        </>
      )}
    </details>
  )
}

// كلّ قسمٍ يحمّل وحده ويفشل وحده: تعطّل الالتزام لا يُخفي الراتب (كما كانت الأقسام القديمة)
function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, err: null })
  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data, err: null }))
    fn().then((data) => { if (alive) setState({ data, err: null }) })
      .catch((e) => { if (alive) setState({ data: null, err: e.message }) })
    return () => { alive = false }
  }, deps)  // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

export default function MyWorkPage() {
  const dialogs = useDialogs()
  const [toast, showToast] = useToast()
  const { mode, range, today, day, week, month, from, to, set } = usePeriod()
  const rk = `${range.from}|${range.to}`
  const [profile, setProfile] = useState(null)
  const [mine, setMine] = useState(null)
  const [key, setKey] = useState(0)

  useEffect(() => { api.clinic.myProfile().then(setProfile).catch(() => setProfile({})) }, [])
  const loadMine = useCallback(() => api.clinic.myProcedures().then(setMine).catch(() => {}), [])
  useEffect(() => { loadMine() }, [loadMine])
  const W = useLoad(() => api.clinic.myWork(range), [rk, key])
  const P = useLoad(() => api.clinic.myPunctuality(range), [rk])
  const S = useLoad(() => api.clinic.mySalary(range), [rk, key])
  // حيّة: حدث «procedure» على بثّ الموظفين (بلا أرقام) ⇒ إعادة تحميل من المسارات المحميّة
  useEffect(() => {
    let timer = null
    const close = openStaffStream((name) => {
      if (name !== 'procedure') return
      clearTimeout(timer)
      timer = setTimeout(() => { loadMine(); setKey((k) => k + 1) }, 250)
    })
    return () => { clearTimeout(timer); close() }
  }, [loadMine])

  const remove = async (line) => {
    const ok = await dialogs.confirm({
      title: 'حذف الإجراء؟', body: `«${line.name}» عن ${line.patient_name} — لم يُحاسَب بعد.`,
      confirmLabel: 'حذف', danger: true })
    if (!ok) return
    try {
      await api.clinic.removeAppointmentProcedure(line.appointment_id, line.id, '')
      showToast(`حُذف «${line.name}»`, 'success', 3000)
      loadMine(); setKey((k) => k + 1)
    } catch (ex) { showToast(`لم يُحذف «${line.name}»: ${ex.message}`) }
  }

  const withProcedures = profile?.has_procedures !== false || (mine?.lines || []).length > 0
  // «كيف تُحسب حصّتي» تشرح قواعد الطريقة القديمة — بعد «أجرة + مواد» لا تنطبق فتُخفى
  const { since: feeMode, loading: feeLoading } = useFeeMode()
  // كلّ ردٍّ يُعرض تحت فترته وحدها (ردّ فترةٍ سابقة لا يظهر تحت الجديدة)
  const mine_ = (x) => x && x.from === range.from && x.to === range.to
  const work = mine_(W.data) ? W.data : null
  const punct = mine_(P.data) ? P.data : null
  const sal = mine_(S.data) ? S.data : null
  const pending = (mine?.lines || []).filter((l) => !l.paid_at)
  const failed = (err) => <section className="card dw-card"><p className="error">{err}</p></section>

  return (
    <div className="dp dw dk-work-page">
      <div className="dw-top">
        <div>
          <h2>أعمالي</h2>
          <p className="subtitle">ما أنجزتَه، وما يحقّ لك، والتزامك بالدوام</p>
        </div>
      </div>
      <div className="dw-period">
        <PeriodBar mode={mode} cur={month} curDay={mode === 'week' ? week : day} from={from} to={to}
          data={{ today, from: range.from, to: range.to }} set={set} modes={MODES} />
      </div>
      {toast}
      {W.err ? failed(W.err) : !work ? <p className="empty">جارٍ التحميل…</p> : <WorkCard work={work} withProcedures={withProcedures} />}
      {S.err && !work ? failed(S.err) : (
        <DuesCard work={work} sal={sal} salErr={S.err} withProcedures={withProcedures} pending={pending} onRemove={remove} />
      )}
      {P.err ? failed(P.err) : punct && <DutyCard punct={punct} sal={sal} mode={mode} from={range.from} to={range.to} />}
      {withProcedures && !feeMode && !feeLoading && <ShareRule />}
    </div>
  )
}
