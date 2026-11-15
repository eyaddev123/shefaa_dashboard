import { useCallback, useEffect, useState } from 'react'
import { api, fmtMoney, openStaffStream, todayLocal } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { useToast } from '../action-feedback.jsx'
import { fmtDuration, fmtMinutes, clockTitle } from '../components/Punctuality.jsx'
import { partLines, partsOf } from '../pay-parts.js'

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

const PERIODS = [['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['last_month', 'الشهر الماضي']]
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول',
  'تشرين الأول', 'تشرين الثاني', 'كانون الأول']
const n = (x) => Number(x || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const monthTitle = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)).toLocaleString('ar-SY', { useGrouping: false })}` : '')
const count = (k, [one, two, few, many]) => (k === 1 ? one : k === 2 ? two : `${n(k)} ${k >= 3 && k <= 10 ? few : many}`)
const DAYS = ['يوم واحد', 'يومان', 'أيام', 'يوماً']
const dayName = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long' })

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
        <span>الراتب — {monthTitle(sal.month)}</span>
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
          <p className="dw-note">{sal.month === sal.today?.slice(0, 7) ? 'حسب الحضور المسجَّل حتى الآن.' : 'حسب الحضور المسجَّل في ذلك الشهر.'}</p>
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
const STATE = {
  on_time: () => 'بالوقت',
  late: (d) => `متأخّر ${fmtMinutes(d.late)}`,
  absent: () => 'لم يحضر',
  estimated: () => 'بلا تسجيل وصول',
  pending: () => 'لم يصل بعد',
  appointments: () => 'بمواعيد خاصة',
}
function DutyCard({ punct, sal, period, from, to }) {
  const p = punct.punctuality
  const days = punct.days.filter((d) => d.date >= from && d.date <= to)
  const times = new Map((sal?.days || []).map((d) => [d.date, d]))
  const today = days.find((d) => d.date === punct.today)
  let sentence
  if (period === 'today') {
    sentence = !today ? 'لا دوام لك اليوم.'
      : today.status === 'pending' ? `دوامك اليوم يبدأ ${today.start}، ولم يُسجَّل وصولك بعد.`
      : today.status === 'on_time' ? `وصلتَ اليوم ${today.arrival} — بالوقت.`
      : today.status === 'late' ? `وصلتَ اليوم ${today.arrival} — بعد بداية الدوام بـ${fmtMinutes(today.late)}.`
      : today.arrival ? `وصلتَ اليوم ${today.arrival}.` : 'لم يُسجَّل وصولك اليوم.'
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
      : onTime === 0 ? <>، وتأخّرتَ فيها كلّها بمتوسّط {fmtMinutes(lateAvg)}.</>
      : <>، وصلتَ بالوقت في {count(onTime, DAYS)} وتأخّرتَ {count(lateDays.length, DAYS)} بمتوسّط {fmtMinutes(lateAvg)}.</>
    sentence = sched === 0 ? 'لا أيام دوام في هذه الفترة.' : <>{attended}{punctual}</>
  }
  return (
    <section className="card dw-card" aria-label="دوامي">
      <h3 className="dw-h">دوامي</h3>
      <p className="dw-sentence">{sentence}</p>
      {days.length > 0 && period !== 'today' && (
        <table className="rtable dw-days">
          <thead><tr><th>اليوم</th><th>الوصول</th><th>الانصراف</th><th>المدّة</th><th>الحالة</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const t = times.get(d.date)
              return (
                <tr key={d.date}>
                  <td className="rt-title">{dayName(d.date)}</td>
                  <td className="num" data-label="الوصول" dir="ltr">{d.arrival || '—'}</td>
                  <td className="num" data-label="الانصراف" dir="ltr">{t?.departed || '—'}</td>
                  <td className="num" data-label="المدّة">{t?.minutes == null ? '—' : fmtDuration(t.minutes)}</td>
                  <td data-label="الحالة" className={`dw-state is-${d.status}`}>
                    {(STATE[d.status] || (() => d.status))(d)}
                    {t?.state === 'no_departure' && <small>، انصراف غير مسجَّل</small>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="dw-note">{p.appointmentsBased
        ? 'يُسجَّل وصولك بكبسة «وصل الطبيب» عند الاستقبال ليُحسب يوم حضورك.'
        : `«بالوقت» = خلال ${fmtMinutes(punct.grace)} من بداية الدوام، بكبسة «وصل الطبيب» عند الاستقبال.`}</p>
    </section>
  )
}

// ═══ ٤) كيف تُحسب حصّتي — مطويّ ═══
const ruleText = (r) => (r.kind !== 'percent' ? `مبلغ ثابت ${fmtMoney(r.value)}`
  : r.value === 0 ? 'بلا حصّة' : `${n(r.value)}٪ بعد المواد`)
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

// الشهر السابق للشهر الجاري ('YYYY-MM') — لراتب «الشهر الماضي»
const lastMonth = () => {
  const [y, m] = todayLocal().split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
  const [period, setPeriod] = useState('today')
  const [profile, setProfile] = useState(null)
  const [mine, setMine] = useState(null)
  const [key, setKey] = useState(0)

  useEffect(() => { api.clinic.myProfile().then(setProfile).catch(() => setProfile({})) }, [])
  const loadMine = useCallback(() => api.clinic.myProcedures().then(setMine).catch(() => {}), [])
  useEffect(() => { loadMine() }, [loadMine])
  const pp = period === 'month' || period === 'last_month' ? period : 'week'
  const salMonth = period === 'last_month' ? lastMonth() : null
  const W = useLoad(() => api.clinic.myWork(period), [period, key])
  const P = useLoad(() => api.clinic.myPunctuality(pp), [pp])
  const S = useLoad(() => api.clinic.mySalary(salMonth), [salMonth, key])
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
  const work = W.data && W.data.period === period ? W.data : null
  const punct = P.data && P.data.period === pp ? P.data : null
  // الراتب المعروض يطابق الفترة: «الشهر الماضي» شهرُه، وغيره الشهر الجاري
  const sal = S.data && (salMonth ? S.data.month === salMonth : S.data.month === S.data.today?.slice(0, 7)) ? S.data : null
  const pending = (mine?.lines || []).filter((l) => !l.paid_at)
  // مدى «دوامي»: مدى العمل إن وصل، وإلا مدى الالتزام نفسه
  const range = work ? { from: work.from, to: work.to }
    : punct ? (period === 'today' ? { from: punct.today, to: punct.today } : { from: punct.from, to: punct.to }) : null
  const failed = (err) => <section className="card dw-card"><p className="error">{err}</p></section>

  return (
    <div className="dp dw dk-work-page">
      <div className="dw-top">
        <div>
          <h2>أعمالي</h2>
          <p className="subtitle">ما أنجزتَه، وما يحقّ لك، والتزامك بالدوام</p>
        </div>
        <div className="dp-period" role="group" aria-label="الفترة">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={period === k} className={period === k ? 'is-on' : ''}
              onClick={() => setPeriod(k)}>{label}</button>
          ))}
        </div>
      </div>
      {toast}
      {W.err ? failed(W.err) : !work ? <p className="empty">جارٍ التحميل…</p> : <WorkCard work={work} withProcedures={withProcedures} />}
      {S.err && !work ? failed(S.err) : (
        <DuesCard work={work} sal={sal} salErr={S.err} withProcedures={withProcedures} pending={pending} onRemove={remove} />
      )}
      {P.err ? failed(P.err) : punct && range && <DutyCard punct={punct} sal={sal} period={period} from={range.from} to={range.to} />}
      {withProcedures && <ShareRule />}
    </div>
  )
}
