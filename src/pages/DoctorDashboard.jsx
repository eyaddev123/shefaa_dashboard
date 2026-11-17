import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, todayLocal, fmtDay } from '../api.js'
import { PunctualityTiles, DutyCalendar, AttendanceLog, fmtMinutes, AppointmentsBadge, fmtClock, clockTitle } from '../components/Punctuality.jsx'
import DoctorTimesCard from '../components/DoctorTimesCard.jsx'
import { partLines, partsOf, salaryPatientsOf, accountLines } from '../pay-parts.js'
import { DueBlock } from './DoctorAccounts.jsx'
import { useRole } from '../RoleContext.jsx'

// ═══ لوحة تحكم الدكتور ═══
// صفحةٌ لكلّ دكتور (من قائمة الدكاترة)، للمشرفة والمدير والمشرف العام — قراءة وحدها.
// الحساب كلّه في الخادم (GET /api/clinic/doctors/:id/dashboard): الالتزام بالدوام بتعريفاته،
// والمال من حسابات الدكاترة الشهرية نفسها (buildDoctorAccounts) — فـ«هالشهر» هنا = تقرير الدكاترة حرفياً.
// الفترة chips فورية: هالأسبوع (من السبت) · هالشهر · حرّ — وفي الرابط، فزرّ الرجوع يعود إليها.

const PERIODS = [['week', 'هالأسبوع'], ['month', 'هالشهر'], ['custom', 'حرّ']]
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
// الإشارة نصّاً: toLocaleString يسبق السالب بعلامة اتجاه تُرسم شرطةً ثانية
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
const rangeText = (d) => (d.from === d.to ? d.from : `${d.from} ← ${d.to}`)

function FinanceCard({ f }) {
  const a = f.attendance
  const salaryNote = f.noPay ? 'بلا نوع حساب — الراتب صفر'
    : partsOf(f) ? partLines(partsOf(f), f, { patients: salaryPatientsOf(f), days: a.days, minutes: a.minutes }).map((l, i) => (
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
      <div className="dd-due"><DueBlock d={f} /></div>
      <p className="earn-note">
        من حسابات الدكاترة الشهرية نفسها: الكشوف = رسم كلّ زيارةٍ حضرت، والإجراءات = حصّة الشفاء من كلّ إجراءٍ قُبض في
        الفترة. «المستحقّ للدكتور» = راتبه + حصّته من الإجراءات والحديد، وهو عرضٌ لا يُسحب من أيّ صندوق.
      </p>
    </div>
  )
}

// ═══ الحساب يوماً بيوم: ما يُستحقّ له كلّ يوم وبماذا (طلب المستخدم 2026-11-14) ═══
// سطرٌ لكلّ يومٍ فيه حضورٌ أو مريضٌ أو إجراءٌ أو حديد؛ الضغط يفتح تفصيله: مكوّنات الراتب وكلّ إجراءٍ بمريضه وحصّته.
const dayName = (d) => fmtDay(`${d}T12:00:00Z`, { weekday: true, year: false, utc: true })
function DayAccounts({ days, f }) {
  const [open, setOpen] = useState(null)
  if (!days?.length) return <p className="empty">لا حضور ولا مرضى ولا إجراءات في هذه الفترة.</p>
  const daily = f.settleCycle === 'daily'
  const total = days.reduce((t, d) => t + (d.due ?? 0), 0)
  return (
    <div className="dd-days">
      <div className="dd-days-head" aria-hidden="true">
        <span>اليوم</span><span>الحضور</span><span>المرضى</span><span>الإجراءات</span><span>{daily ? 'يُدفع له' : 'المستحقّ'}</span>
      </div>
      {days.map((d) => {
        const a = d.attendance
        const isOpen = open === d.date
        const lines = accountLines({ ...f, ...d }, { patients: salaryPatientsOf({ ...f, ...d }), days: a.days, minutes: a.minutes })
        return (
          <div key={d.date} className={`dd-day${isOpen ? ' is-open' : ''}`}>
            <button type="button" className="dd-day-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.date)}>
              <span className="dd-day-date">{dayName(d.date)}</span>
              <span title={a.minutes ? clockTitle(a.minutes) : undefined}>
                {a.days ? (a.minutes ? `${fmtClock(a.minutes)} ساعة` : a.onDuty ? 'في الدوام' : 'بلا انصراف') : '—'}</span>
              <span>{d.patients ? fmtNum(d.patients) : '—'}</span>
              <span>{d.procedures || d.ironCount ? fmtNum(d.procedures + d.ironCount) : '—'}</span>
              <strong>{d.due === null ? '—' : fmtNum(d.due)}</strong>
            </button>
            {isOpen && (
              <div className="dd-day-body">
                <ul className="dr-due-lines">
                  {f.noPay && <li className="is-muted"><span className="dr-due-k">الراتب</span><span className="dr-due-q">لم يُضبط بعد</span><b>—</b></li>}
                  {!partsOf(f) && f.payKind === 'fixed' && <li className="is-muted"><span className="dr-due-k">راتب شهري ثابت</span>
                    <span className="dr-due-q">لا يُقسَم على الأيام</span><b>—</b></li>}
                  {lines.map((l) => (
                    <li key={l.key}><span className="dr-due-k">{l.label}</span>
                      <span className="dr-due-q">{l.qty}{l.rate != null ? ` × ${fmtNum(l.rate)}` : ' — حصّته'}</span>
                      <b>{l.value ? fmtNum(l.value) : 'صفر'}</b></li>
                  ))}
                </ul>
                {d.items.length > 0 && (
                  <ul className="dd-items">
                    {d.items.map((it) => (
                      <li key={`${it.kind}-${it.id}`}>
                        <span>{it.name}</span><span className="muted">{it.patient}</span><b>{it.share ? fmtNum(it.share) : 'صفر'}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )
      })}
      <div className="dd-days-foot">
        <span>المجموع — {days.length === 1 ? 'يوم واحد' : days.length === 2 ? 'يومان' : `${fmtNum(days.length)} ${days.length <= 10 ? 'أيام' : 'يوماً'}`}</span>
        <strong>{f.due === null ? '—' : <Money value={f.due} />}</strong>
      </div>
      {f.due !== null && Math.abs(total - f.due) >= 1 && (
        <p className="earn-note">الفرق بين مجموع الأيام ومستحقّ الفترة من تقريب الساعات لكلّ يومٍ وحده.</p>
      )}
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

          <div className="card">
            <h3>الحساب يوماً بيوم
              {shown.finance.settleCycle === 'daily' && <span className="pn-grace">يُحاسَب يومياً — ما يُدفع له في كلّ يوم</span>}</h3>
            <DayAccounts days={shown.accountDays} f={shown.finance} />
          </div>

          <DoctorTimesCard doctorId={id} period={period} from={from} to={to} canFix={role === 'clinic_admin'}
            onChanged={() => setReload((n) => n + 1)} />

          <div className="pn-grid">
            <div className="card">
              <h3>تقويم الدوام</h3>
              <DutyCalendar from={shown.from} to={shown.to} days={shown.days} apologies={shown.apologies || []} />
            </div>
            <div className="card">
              <h3>أكثر 5 إجراءات</h3>
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
