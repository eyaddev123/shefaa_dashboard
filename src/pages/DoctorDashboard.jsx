import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, todayLocal } from '../api.js'
import { PunctualityTiles, DutyCalendar, AttendanceLog, fmtMinutes, AppointmentsBadge, fmtClock, clockTitle } from '../components/Punctuality.jsx'
import DoctorTimesCard from '../components/DoctorTimesCard.jsx'
import { partLines, partsOf } from '../pay-parts.js'
import { useRole } from '../RoleContext.jsx'

// ═══ لوحة تحكم الدكتور ═══
// صفحةٌ لكلّ دكتور (من قائمة الدكاترة)، للمشرفة والمدير والمشرف العام — قراءة وحدها.
// الحساب كلّه في الخادم (GET /api/clinic/doctors/:id/dashboard): الالتزام بالدوام بتعريفاته،
// والمال من حسابات الدكاترة الشهرية نفسها (buildDoctorAccounts) — فـ«هالشهر» هنا = تقرير الدكاترة حرفياً.
// الفترة chips فورية: هالأسبوع (من السبت) · هالشهر · حرّ — وفي الرابط، فزرّ الرجوع يعود إليها.

const PERIODS = [['week', 'هالأسبوع'], ['month', 'هالشهر'], ['custom', 'حرّ']]
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
// الإشارة نصّاً: toLocaleString يسبق السالب بعلامة اتجاه تُرسم شرطةً ثانية
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
const rangeText = (d) => (d.from === d.to ? d.from : `${d.from} ← ${d.to}`)

function FinanceCard({ f }) {
  const a = f.attendance
  const salaryNote = f.noPay ? 'بلا نوع حساب — الراتب صفر'
    : partsOf(f) ? partLines(partsOf(f), f, { patients: f.patients, days: a.days, minutes: a.minutes }).map((l, i) => (
        <span key={l.key}>{i > 0 && <br />}<span title={l.key === 'hours' ? clockTitle(a.minutes) : undefined}>{l.qty}</span>
          {' '}× {fmtNum(l.rate)} = {fmtNum(l.value)}</span>))
    : f.salary === null ? `راتب شهري ثابت ${fmtNum(f.payAmount)} — يُحسب للشهر الكامل` : 'راتب شهري ثابت'
  return (
    <div className="card earn-card">
      <h3>المال {f.settleCycle && <span className="pn-grace">تحاسبه: {f.settleCycle === 'daily' ? 'يومي' : 'شهري'}</span>}</h3>
      {f.hourlyRate > 0 && a.noDeparture > 0 && (
        <p className="share-warn acc-warn" role="alert">
          ⚠ {fmtNum(a.noDeparture)} {a.noDeparture === 1 ? 'يوم' : 'أيام'} «انصراف غير مسجَّل» في الفترة: الساعات لا تُحسب لها —
          فالراتب أقلّ من المستحقّ حتى يُصحَّح (بطاقة «الحضور والانصراف» تحت).
        </p>
      )}
      <div className="tiles earn-tiles fund-tiles pn-fin">
        <div className="tile"><div className="label">الشفاء من الكشوف</div><div className="value"><Money value={f.visitShifa} /></div></div>
        <div className="tile"><div className="label">الشفاء من الإجراءات</div><div className="value"><Money value={f.procShifa} /></div></div>
        <div className="tile"><div className="label">مجموع حصّة الشفاء</div><div className="value"><Money value={f.shifa} /></div></div>
        <div className="tile">
          <div className="label">الراتب</div>
          <div className="value">{f.salary === null ? '—' : <Money value={f.salary} />}</div>
          <div className="pn-sub">{salaryNote}</div>
        </div>
        {f.diff === null ? (
          <div className="tile"><div className="label">الربح / الخسارة</div><div className="value">—</div>
            <div className="pn-sub">{f.payKind === 'fixed' ? 'اختر «هالشهر» لحسابه' : '—'}</div></div>
        ) : (
          <div className={`tile earn-hero ${f.diff < 0 ? 'fund-loss' : 'fund-gain'}`}>
            <div className="label">{f.diff < 0 ? 'خسارة' : 'ربح'}</div>
            <div className="value">{signed(f.diff)}</div>
          </div>
        )}
      </div>
      <p className="earn-note">
        من حسابات الدكاترة الشهرية نفسها: الكشوف = رسم كلّ زيارةٍ حضرت، والإجراءات = حصّة الشفاء من كلّ إجراءٍ قُبض في
        الفترة. الراتب عرضٌ لا يُسحب من أيّ صندوق.
      </p>
    </div>
  )
}

function TopProcedures({ list }) {
  if (list.length === 0) return <p className="empty">لا إجراءات مقبوضة في هذه الفترة.</p>
  const max = list[0].n
  return (
    <div className="barlist">
      {list.map((p) => (
        <div className="row" key={p.name}>
          <span className="name">{p.name}</span>
          <div className="track"><div className="fill" style={{ width: `${(p.n / max) * 100}%` }} /></div>
          <span className="num">{fmtNum(p.n)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DoctorDashboard() {
  const { id } = useParams()
  const { clinicRole: role } = useRole()
  const [params, setParams] = useSearchParams()
  const period = PERIODS.some(([k]) => k === params.get('period')) ? params.get('period') : 'week'
  const from = params.get('from') || todayLocal()
  const to = params.get('to') || from
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [reload, setReload] = useState(0)
  const key = `${id}|${period}|${period === 'custom' ? `${from}|${to}` : ''}`

  useEffect(() => {
    let alive = true
    setErr(null)
    api.clinic.doctorDashboard(id, { period, from, to })
      .then((d) => { if (alive) setData({ key, ...d }) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [key, reload])

  const update = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  const pick = (k) => update(k === 'custom'
    ? { period: 'custom', from: data?.from || todayLocal(), to: data?.to || todayLocal() }
    : { period: k === 'week' ? null : k, from: null, to: null })

  const shown = data?.key === key ? data : null
  const doc = shown?.doctor || data?.doctor

  return (
    <>
      <Link className="plain earn-back-link" to="/clinic/doctors">→ الدكاترة</Link>
      <h2>{doc ? doc.name : 'لوحة الدكتور'}{doc?.specialty && <span className="pn-spec">{doc.specialty}</span>}
        {doc?.appointmentsBased && <> <AppointmentsBadge /></>}</h2>
      <p className="subtitle">
        الالتزام بالدوام وأرقام الدكتور — للاطّلاع.
        {doc && <> <Link to={`/clinic/doctors/${doc.id}`}>البروفايل والدوام</Link></>}
      </p>

      <div className="earn-periods" role="group" aria-label="الفترة">
        {PERIODS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={period === k}
            className={`rev-flag${period === k ? ' is-on' : ''}`} onClick={() => pick(k)}>{label}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="dd-from">من</label>
            <input id="dd-from" type="date" value={from}
              onChange={(e) => e.target.value && update({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} /></div>
          <div className="field"><label htmlFor="dd-to">إلى</label>
            <input id="dd-to" type="date" value={to} min={from}
              onChange={(e) => e.target.value && update({ to: e.target.value })} /></div>
        </div>
      )}
      {shown && <p className="earn-range">الفترة: <span dir="ltr">{rangeText(shown)}</span></p>}

      {err ? <p className="error">{err}</p> : !shown ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <PunctualityTiles p={shown.punctuality} apologized={(shown.apologies || []).filter((x) => x.date <= shown.today).length} extra={<>
            <div className="tile"><div className="label">المرضى</div><div className="value">{fmtNum(shown.finance.patients)}</div>
              <div className="pn-sub">الكشوف المنتهية</div></div>
            <div className="tile"><div className="label">الإجراءات</div><div className="value">{fmtNum(shown.finance.procedures)}</div>
              <div className="pn-sub">المقبوضة في الفترة</div></div>
          </>} />

          <FinanceCard f={shown.finance} />

          <DoctorTimesCard doctorId={id} period={period} from={from} to={to} canFix={role === 'clinic_admin'}
            onChanged={() => setReload((n) => n + 1)} />

          <div className="pn-grid">
            <div className="card">
              <h3>تقويم الدوام</h3>
              <DutyCalendar from={shown.from} to={shown.to} days={shown.days} apologies={shown.apologies || []} />
            </div>
            <div className="card">
              <h3>أكثر ٥ إجراءات</h3>
              <TopProcedures list={shown.topProcedures} />
            </div>
          </div>

          <div className="card">
            <h3>سجلّ الحضور
              {shown.punctuality.appointmentsBased ? <> <AppointmentsBadge /></>
                : <span className="pn-grace">التأخير بعد {fmtMinutes(shown.grace)} من بداية الدوام</span>}</h3>
            <AttendanceLog days={shown.days} apologies={shown.apologies || []} today={shown.today} />
          </div>
        </>
      )}
    </>
  )
}
