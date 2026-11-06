import { useCallback, useEffect, useState } from 'react'
import { api, fmtMoney, openStaffStream } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { useToast } from '../action-feedback.jsx'
import { PunctualityTiles, DutyCalendar, fmtMinutes, fmtDuration } from '../components/Punctuality.jsx'

// ═══════════════════════════════════════════════════════════════════
// «أعمالي» — صفحة الطبيب المستقلّة في القائمة الجانبية (تحت «شاشتي»)
//
// المكان الوحيد الذي يرى فيه الطبيب أرقاماً ماليّة: اليوم / الأسبوع (من السبت) / الشهر، المرضى
// والإجراءات، والإجراءات المحاسَبة بحصّته من لقطة السطر ومجموعها — من /clinic/my-work، أي حساب
// صفحة المستحقات نفسه لطبيبه وحده (الخادم يأخذ الطبيب من الحساب لا من الطلب).
// ★ hideSplit بمعناه: لا سعر ولا حصّة الشفاء ولا قاعدة التوزيع — حصّته هو فقط.
// وتحتها ما ينتظر المحاسبة بالأسماء (بلا مبالغ)، ومنه يحذف الطبيب سطره قبل أن يُقبض.
// حيّة: حدث «procedure» على بثّ الموظفين (بلا أرقام) ⇒ إعادة تحميل من المسار المحميّ.
// ═══════════════════════════════════════════════════════════════════

// ═══ المحتوى — كما بُني في التبويب، منقولاً بلا إعادة بناء ═══
// اليوم / الأسبوع (من السبت) / الشهر: chips فورية بلا زرّ تطبيق. بطاقتا ملخّص (المرضى، الإجراءات)،
// ثمّ الإجراءات المقبوضة بحصّته من لقطة السطر، ثمّ المجموع — من /clinic/my-work، أي حساب صفحة
// المستحقات نفسه. وتحتها ما ينتظر المحاسبة بالأسماء وحدها (بلا مبالغ)، ومنه يحذف الطبيب سطره.
const WORK_PERIODS = [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']]

function MyWork({ reloadKey, pending, onRemove }) {
  const [period, setPeriod] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    api.clinic.myWork(period).then((d) => { if (alive) { setData(d); setErr(null) } })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [period, reloadKey])
  const shown = data && data.period === period ? data : null
  return (
    <div className="dk-work">
      <div className="dk-chips-filter" role="group" aria-label="الفترة">
        {WORK_PERIODS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={period === k}
            className={`dk-filter${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : (
        <>
          <div className="dk-stats">
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.patients.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">المرضى</span>
            </div>
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.procedures.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">الإجراءات</span>
            </div>
          </div>
          <div className="card dk-work-list">
            <h3>الإجراءات المحاسَبة <span className="dk-work-range" dir="ltr">
              {shown.from === shown.to ? shown.from : `${shown.from} — ${shown.to}`}</span></h3>
            {shown.lines.length === 0 ? <p className="empty">لا إجراءات محاسَبة في هذه الفترة.</p> : (
              <ul className="dk-lines">
                {shown.lines.map((l) => (
                  <li key={l.id} className="dk-line is-paid">
                    <div className="dk-line-main">
                      <span className="dk-line-proc">{l.procedure}</span>
                      <span className="dk-line-patient">{l.patient}</span>
                    </div>
                    <span className="dk-line-share">{fmtMoney(l.doctor_share)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="dk-work-total">
              <span>مجموع حصّتك</span>
              <strong>{fmtMoney(shown.total_share)}</strong>
            </div>
          </div>
        </>
      )}
      {pending.length > 0 && (
        <div className="card dk-work-pending">
          <h3>بانتظار المحاسبة <span className="dk-group-count">{pending.length.toLocaleString('ar-SY')}</span></h3>
          <p className="dk-hint">تُحتسب لك حين تقبضها الاستقبال. تحذف ما أضفته أنت قبل ذلك.</p>
          <ul className="dk-lines">
            {pending.map((l) => (
              <li key={l.id} className="dk-line is-unpaid">
                <div className="dk-line-main">
                  <span className="dk-line-proc">⏳ {l.name}</span>
                  <span className="dk-line-patient">{l.patient_name}</span>
                </div>
                {l.mine && (
                  <button type="button" className="ghost dk-line-x"
                    aria-label={`حذف ${l.name} عن ${l.patient_name}`} onClick={() => onRemove(l)}>حذف</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ═══ «التزامي» — أرقامه هو وحده: نسبة الالتزام ومتوسّط التأخير والتقويم الملوّن ═══
// بتعريفات لوحة الإدارة نفسها (GET /clinic/my-punctuality) — بلا ترتيب ولا أيّ دكتورٍ آخر.
const PUNCT_PERIODS = [['week', 'هالأسبوع'], ['month', 'هالشهر']]
function MyPunctuality() {
  const [period, setPeriod] = useState('week')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    api.clinic.myPunctuality(period).then((d) => { if (alive) { setData(d); setErr(null) } })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [period])
  const shown = data && data.period === period ? data : null
  return (
    <div className="card dk-punct">
      <h3>التزامي بالدوام</h3>
      <div className="dk-chips-filter" role="group" aria-label="فترة الالتزام">
        {PUNCT_PERIODS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={period === k}
            className={`dk-filter${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : (
        <>
          <PunctualityTiles p={shown.punctuality} />
          <DutyCalendar from={shown.from} to={shown.to} days={shown.days} />
          <p className="dk-hint">بالوقت = وصلت خلال {fmtMinutes(shown.grace)} من بداية الدوام أو قبلها، بكبسة
            «وصل الطبيب» عند الاستقبال.</p>
        </>
      )}
    </div>
  )
}

// ═══ «راتبي وحضوري» — أرقامه هو وحده، قراءةً (GET /clinic/my-salary: الدكتور من الحساب) ═══
// الشهر بسهمين، ولا شهرٌ بعد الجاري. الحساب كلّه في الخادم — هنا عرضٌ وحده.
// ولا «·» ولا «٠» بجانب الأرقام: الفراغ جملة.
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const daysText = (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${fmtInt(n)} ${n >= 3 && n <= 10 ? 'أيام' : 'يوماً'}`)
const shiftMonth = (m, by) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function SalaryLines({ s }) {
  if (s.kind === 'per_patient') return <p className="dk-sal-line">{fmtInt(s.patients)} مريض × {fmtInt(s.rate)} ل.س</p>
  if (s.kind !== 'daily_hourly') return <p className="dk-sal-line">راتب شهري ثابت</p>
  return null
}

function MySalary() {
  const [month, setMonth] = useState(null)   // null = الشهر الجاري من الخادم
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    setErr(null)
    api.clinic.mySalary(month).then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [month])
  const shown = data && (month === null || data.month === month) ? data : null
  const a = shown?.attendance, s = shown?.salary
  const dh = s?.kind === 'daily_hourly'
  return (
    <div className="card dk-salary">
      <div className="dk-sal-head">
        <h3>راتبي وحضوري</h3>
        {shown && (
          <div className="dk-sal-month" role="group" aria-label="الشهر">
            <button type="button" className="ghost" aria-label="الشهر السابق" onClick={() => setMonth(shiftMonth(shown.month, -1))}>‹</button>
            <span dir="ltr">{shown.month}</span>
            <button type="button" className="ghost" aria-label="الشهر التالي" disabled={shown.month >= shown.today.slice(0, 7)}
              onClick={() => setMonth(shiftMonth(shown.month, 1))}>›</button>
          </div>
        )}
      </div>
      {err ? <p className="error">{err}</p> : !shown ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <div className="tiles earn-tiles pn-tiles pn-3">
            <div className="tile">
              <div className="label">أيام الحضور</div>
              <div className="value">{a.days ? fmtInt(a.days) : 'لا أيام'}</div>
            </div>
            <div className="tile">
              <div className="label">ساعات الدوام</div>
              <div className="value">{a.minutes ? fmtDuration(a.minutes) : 'لا ساعات'}</div>
              {a.noDeparture > 0 && <div className="pn-sub">بلا أيام «انصراف غير مسجَّل»</div>}
            </div>
            <div className="tile earn-hero">
              <div className="label">الراتب المحسوب</div>
              <div className="value">{s ? <>{s.total === 0 ? 'صفر' : fmtInt(s.total)}<span className="cash-unit">ل.س</span></> : '—'}</div>
              {s && <div className="pn-sub">حسب الحضور المسجَّل</div>}
            </div>
          </div>
          {!s && <p className="dk-sal-unset">لم تُحدد إعدادات الراتب بعد</p>}
          {s && dh && (
            <ul className="dk-sal-calc">
              {s.dailyRate > 0 && <li><span>{daysText(a.days)} × {fmtInt(s.dailyRate)}</span><b>{fmtInt(s.salaryDays)} ل.س</b></li>}
              {s.hourlyRate > 0 && <li><span>{fmtInt(a.hours)} ساعة × {fmtInt(s.hourlyRate)}</span><b>{fmtInt(s.salaryHours)} ل.س</b></li>}
            </ul>
          )}
          {s && <SalaryLines s={s} />}
          {a.noDeparture > 0 && (
            <p className="share-warn acc-warn" role="alert">
              {daysText(a.noDeparture)} «انصراف غير مسجَّل»: {dh && s.hourlyRate > 0 ? 'اليومية محسوبة والساعات لا، ' : ''}وتصحّحها المشرفة.
            </p>
          )}
          {shown.days.length === 0 ? <p className="empty">لا حضور مسجَّل في هذا الشهر.</p> : (
            <table className="rtable dt-table">
              <thead><tr><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>المدّة</th><th>الحالة</th></tr></thead>
              <tbody>
                {shown.days.map((d) => (
                  <tr key={d.id} className={d.state === 'no_departure' ? 'dt-row-warn' : undefined}>
                    <td className="rt-title" dir="ltr">{d.date}</td>
                    <td className="num" data-label="الحضور" dir="ltr">{d.arrived}</td>
                    <td className="num" data-label="الانصراف" dir="ltr">{d.departed || '—'}</td>
                    <td className="num" data-label="المدّة">{d.minutes == null ? '—' : fmtDuration(d.minutes)}</td>
                    <td data-label="الحالة">
                      {d.state === 'no_departure' ? <span className="badge warn sm">انصراف غير مسجَّل</span>
                        : d.state === 'on_duty' ? <span className="badge sm">على الدوام</span>
                        : <span className="muted">مكتمل</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

export default function MyWorkPage() {
  const dialogs = useDialogs()
  const [toast, showToast] = useToast()
  const [mine, setMine] = useState(null)
  const [key, setKey] = useState(0)
  const loadMine = useCallback(() => api.clinic.myProcedures().then(setMine).catch(() => {}), [])
  useEffect(() => { loadMine() }, [loadMine])
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

  const pending = (mine?.lines || []).filter((l) => !l.paid_at)
  return (
    <div className="dk-work-page">
      <h2>أعمالي</h2>
      <p className="subtitle">مرضاك وإجراءاتك المحاسَبة وحصّتك — لليوم أو الأسبوع أو الشهر، والتزامك بالدوام، وراتبك وحضورك</p>
      {toast}
      <MyWork reloadKey={key} pending={pending} onRemove={remove} />
      <MyPunctuality />
      <MySalary />
    </div>
  )
}
