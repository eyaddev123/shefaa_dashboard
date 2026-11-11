import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, dayLabel, fmtTime } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { generateLabel, generateSummary } from '../generate-summary.js'
import { canGenerateSessions, canSeeCashReport, canSeeClinicFunds, canSeeInventory, canSeeProceduresPage, canSeeReferralsPage, isReadOnly } from '../permissions.js'
import RoomBadge from './RoomBadge.jsx'
import Highlights from './Highlights.jsx'
import { CC } from './cc-icons.jsx'

// ═══ لوحة القيادة — العيادات ═══
// أوّل صفحة: تحكي يوم العيادات بنظرة. طلبٌ واحد (/clinic/command) وطلب «الأبرز» بجانبه.
// لا حساب هنا: الخادم يرسل ما يحقّ للدور وحده، وكلّ قسمٍ غاب من الردّ لا يُرسم — فالواجهة لا تقرّر
// صلاحية مالٍ ولا معتذر. تتحدّث بهدوء كلّ دقيقة والصفحة ظاهرة.
// ولا «·» بجانب رقمٍ هنديّ: يُقرأ صفراً — الفواصل هنا عناصر لا نقاط. والصفر نفسه «٠» نقطةٌ تبدو عطلاً
// في بطاقةٍ كبيرة، فاللوحة تقوله كلاماً: ما هو صفرٌ يُحذف من السطر أو يصير جملة.

const REFRESH_MS = 60000
const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })
function Money({ value }) {
  // سالبٌ بجانب رقمٍ هنديّ: bdi باتجاهٍ صريح كي لا تقفز الإشارة
  return <bdi dir="rtl" className="cc-money">{Number(value) === 0 ? 'صفر' : fmtNum(value)}<span className="cash-unit">ل.س</span></bdi>
}
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${fmtNum(n)} ${few}` : `${fmtNum(n)} ${many}`)

const STATE = {
  open: ['good', 'شغّالة'], ready: ['blue', 'جاهزة'], done: ['', 'منتهية'],
  apologized: ['bad', 'معتذر'], cancelled: ['', 'ملغاة'],
}

function SessionsMix({ s }) {
  const parts = [['open', 'شغّالة', s.open], ['ready', 'جاهزة', s.ready], ['done', 'منتهية', s.done]]
  return (
    <>
      {s.total > 0 && (
        <div className="cc-mix" aria-hidden="true">
          {parts.map(([k, , n]) => n > 0 && <span key={k} className={`m-${k}`} style={{ flexGrow: n }} />)}
        </div>
      )}
      <div className="cc-legend">
        {s.total === 0 && <span className="is-zero">لم تُولَّد بعد</span>}
        {parts.map(([k, label, n]) => n > 0 && <span key={k}><i className={`m-${k}`} />{label} <b>{fmtNum(n)}</b></span>)}
      </div>
    </>
  )
}

function Stat({ icon, label, value, to, children, tone }) {
  const body = (
    <>
      <div className="cc-stat-top">
        <span className={`cc-ico ${tone ? `tone-${tone}` : ''}`} aria-hidden="true">{icon}</span>
        <span className="cc-stat-label">{label}</span>
      </div>
      <div className={`cc-stat-value ${value ? '' : 'is-none'}`}>{value ? fmtNum(value) : 'لا شيء'}</div>
      <div className="cc-stat-sub">{children}</div>
    </>
  )
  return to ? <Link to={to} className="cc-stat">{body}</Link> : <div className="cc-stat">{body}</div>
}

function DayStats({ d }) {
  const ap = d.apologies
  return (
    <div className={`cc-stats ${ap ? 'n4' : 'n3'}`}>
      <Stat icon={CC.calendar} label="جلسات اليوم" value={d.sessions.total} to="/clinic/board">
        <SessionsMix s={d.sessions} />
      </Stat>
      <Stat icon={CC.users} label="مرضى اليوم" value={d.patients.total}>
        <div className="cc-legend">
          {d.patients.total === 0 && <span className="is-zero">لا حجوزات بعد</span>}
          {d.patients.waiting > 0 && <span className="is-strong">بالانتظار الآن <b>{fmtNum(d.patients.waiting)}</b></span>}
          {d.patients.inService > 0 && <span>قيد الكشف <b>{fmtNum(d.patients.inService)}</b></span>}
          {d.patients.finished > 0 && <span>انتهوا <b>{fmtNum(d.patients.finished)}</b></span>}
        </div>
      </Stat>
      <Stat icon={CC.syringe} label="إجراءات اليوم" value={d.procedures.total}>
        <div className="cc-legend">
          {d.procedures.unpaid > 0
            ? <span className="is-warn">بانتظار المحاسبة <b>{fmtNum(d.procedures.unpaid)}</b></span>
            : <span className="is-zero">{d.procedures.total ? 'كلّها محاسَبة' : 'لا إجراءات بعد'}</span>}
          {d.iron?.count > 0 && <span className="is-strong">جلسات الحديد <b>{fmtNum(d.iron.count)}</b></span>}
        </div>
      </Stat>
      {ap && (
        <Stat icon={CC.userX} label="معتذرون اليوم" value={ap.total} tone={ap.total ? 'warn' : ''}>
          <div className="cc-names">
            {ap.total === 0 ? <span className="is-zero">لا اعتذارات اليوم</span>
              : ap.doctors.slice(0, 2).map((x) => <span key={x.doctorId}>{x.doctor}</span>)}
            {ap.total > 2 && <span className="is-zero">و{fmtNum(ap.total - 2)} غيرهم</span>}
          </div>
        </Stat>
      )}
    </div>
  )
}

function EmptyDay({ today, doctorsActive, canGenerate, busy, onGenerate }) {
  return (
    <div className="cc-empty">
      <span className="cc-empty-art" aria-hidden="true">{CC.calendar}</span>
      <h4>لا جلسات اليوم بعد</h4>
      <p>
        {canGenerate
          ? `تُولَّد الجلسات من جداول دوام ${plural(doctorsActive, 'الدكتور الفعّال', 'الدكتورين الفعّالين', 'دكاترة فعّالين', 'دكتوراً فعّالاً')}، ومن وافق دوامه اليوم ولم يعتذر تظهر جلسته هنا.`
          : 'حين تولّد المشرفة جلسات اليوم تظهر هنا مع الدور الحالي لكلّ دكتور.'}
      </p>
      {canGenerate && <button type="button" onClick={onGenerate} disabled={busy}>{busy ? 'جارٍ التوليد…' : generateLabel(today)}</button>}
    </div>
  )
}

// ترتيب البطاقات: الشغّالة أوّلاً، ثمّ الجاهزة، ثمّ المنتهية، والمعتذر والملغاة آخراً
const ORDER = { open: 0, ready: 1, done: 2, apologized: 3, cancelled: 4 }

function SessionCard({ s }) {
  const [cls, label] = STATE[s.state] || STATE.done
  const quiet = s.state === 'done' || s.state === 'cancelled' || s.state === 'apologized'
  const live = s.state === 'open'   // نقطة الشارة تنبض
  return (
    <Link to={`/clinic/session/${s.id}`} className={`cc-scard is-${s.state}${quiet ? ' is-quiet' : ''}`}>
      <div className="cc-scard-top">
        <div className="cc-scard-who">
          <strong>{s.doctor}</strong>
          <span className="cc-sub">{s.specialty && <span>{s.specialty}</span>}<RoomBadge room={s.room} /></span>
        </div>
        <span className={`badge ${cls}${live ? ' cc-badge-live' : ''}`}>{label}</span>
      </div>
      {s.state === 'apologized' || s.state === 'cancelled' ? (
        <p className="cc-scard-note">{s.state === 'apologized' ? 'اعتذر الدكتور عن اليوم' : 'الجلسة ملغاة'}</p>
      ) : (
        <div className="cc-scard-mid">
          <div className="cc-scard-turn">
            <span>الدور الآن</span>
            <strong className={s.current === null ? 'is-none' : ''}>{s.current === null ? '—' : fmtNum(s.current)}</strong>
          </div>
          <div className="cc-scard-wait">
            <span>بالانتظار</span>
            <strong className={s.waiting ? '' : 'is-none'}>{s.waiting ? fmtNum(s.waiting) : '—'}</strong>
          </div>
          <div className="cc-scard-time"><bdi dir="ltr">{fmtTime(s.start)} – {fmtTime(s.end)}</bdi></div>
        </div>
      )}
      {s.total > 0 && s.state !== 'apologized' && s.state !== 'cancelled' && (
        <div className="cc-progress">
          <div className="cc-track"><span style={{ width: `${(s.finished / s.total) * 100}%` }} /></div>
          <span className="cc-progress-n">{s.finished ? `انتهى ${fmtNum(s.finished)} من ${fmtNum(s.total)}` : `${plural(s.total, 'مريض واحد', 'مريضان', 'مرضى', 'مريضاً')} — لم يبدأ`}</span>
        </div>
      )}
    </Link>
  )
}

function SessionsCard({ sessions, today, doctorsActive, canGenerate, busy, onGenerate }) {
  const sorted = [...sessions].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || a.start.localeCompare(b.start))
  const count = (st) => sessions.filter((x) => x.state === st).length
  return (
    <div className="card cc-panel cc-sessions">
      <div className="cc-panel-head">
        <h3>جلسات اليوم</h3>
        {sessions.length > 0 && (
          <div className="cc-scount">
            {count('open') > 0 && <span className="is-open"><i className="cc-live" aria-hidden="true" />شغّالة {fmtNum(count('open'))}</span>}
            {count('ready') > 0 && <span className="is-ready">جاهزة {fmtNum(count('ready'))}</span>}
            {count('done') > 0 && <span>منتهية {fmtNum(count('done'))}</span>}
          </div>
        )}
        {sessions.length > 0 && <Link className="plain" to="/clinic/board">اللوحة اليومية</Link>}
      </div>
      {sessions.length === 0
        ? <EmptyDay today={today} doctorsActive={doctorsActive} canGenerate={canGenerate} busy={busy} onGenerate={onGenerate} />
        : <div className="cc-scards">{sorted.map((s) => <SessionCard key={s.id} s={s} />)}</div>}
    </div>
  )
}

// إحالات اليوم (الخادم يرسلها لقرّاء الإحالات وحدهم): الزيارات المحالة التي حضر أصحابها، وما على الجهات
function FinanceCard({ f, r, role }) {
  return (
    <div className="card cc-panel cc-finance">
      <div className="cc-panel-head"><h3>لمحة مالية</h3></div>
      <div className="cc-fin-row">
        <span className="cc-ico" aria-hidden="true">{CC.wallet}</span>
        <div>
          <div className="cc-fin-label">صندوق العيادات</div>
          <div className={`cc-fin-value ${f.fundBalance < 0 ? 'neg' : ''}`}><Money value={f.fundBalance} /></div>
          {!f.openingSet && <div className="cc-fin-note">الرصيد الافتتاحي لم يُضبط بعد</div>}
        </div>
        {canSeeClinicFunds(role) && <Link className="plain" to="/clinic/fund">الصندوق</Link>}
      </div>
      {'receipts' in f && (
        <div className="cc-fin-row">
          <span className="cc-ico" aria-hidden="true">{CC.receipt}</span>
          <div>
            <div className="cc-fin-label">مقبوضات اليوم</div>
            <div className="cc-fin-value"><Money value={f.receipts} /></div>
            <div className="cc-fin-note">{f.receiptsPatients ? `من ${plural(f.receiptsPatients, 'مريض واحد', 'مريضين', 'مرضى', 'مريضاً')}` : 'لا مقبوضات بعد'}</div>
          </div>
          {canSeeCashReport(role) && <Link className="plain" to="/clinic/cash-report">الجرد</Link>}
        </div>
      )}
      {r && (
        <div className="cc-fin-row">
          <span className="cc-ico" aria-hidden="true">{CC.referral}</span>
          <div>
            <div className="cc-fin-label">إحالات اليوم</div>
            <div className="cc-fin-value"><Money value={r.due} /></div>
            <div className="cc-fin-note">
              {r.visits ? `مستحقّ على ${plural(r.sourcesCount, 'جهة واحدة', 'جهتين', 'جهات', 'جهة')} عن ${plural(r.visits, 'مريض واحد', 'مريضين', 'مرضى', 'مريضاً')}`
                : 'لا إحالات اليوم بعد'}
            </div>
            {r.sources.length > 0 && (
              <ul className="cc-ref-list">
                {r.sources.map((x) => (
                  <li key={x.id}><span>{x.name}</span><b>{plural(x.visits, 'مريض واحد', 'مريضان', 'مرضى', 'مريضاً')}</b><Money value={x.due} /></li>
                ))}
                {r.sourcesCount > r.sources.length && <li className="cc-ref-more">و{plural(r.sourcesCount - r.sources.length, 'جهة واحدة', 'جهتان', 'جهات', 'جهة')} غيرها</li>}
              </ul>
            )}
          </div>
          {canSeeReferralsPage(role) && <Link className="plain" to="/clinic/referrals">الإحالات</Link>}
        </div>
      )}
    </div>
  )
}

function Alert({ icon, tone = 'warn', title, children }) {
  return (
    <li className={`cc-alert tone-${tone}`}>
      <span className="cc-ico" aria-hidden="true">{icon}</span>
      <div>
        <div className="cc-alert-title">{title}</div>
        {children && <div className="cc-alert-body">{children}</div>}
      </div>
    </li>
  )
}

function AlertsCard({ a, role }) {
  const { unpaid, lowStock, noDeparture } = a
  const none = !unpaid.n && !lowStock?.n && !noDeparture?.days
  return (
    <div className="card cc-panel cc-alerts">
      <div className="cc-panel-head"><h3>تنبيهات تشغيلية</h3></div>
      {none ? (
        <p className="cc-allclear"><span aria-hidden="true">{CC.check}</span> لا شيء ينتظرك الآن</p>
      ) : (
        <ul>
          {unpaid.n > 0 && (
            <Alert icon={CC.receipt} title={<>{plural(unpaid.n, 'إجراء واحد', 'إجراءان', 'إجراءات', 'إجراءً')} بانتظار المحاسبة</>}>
              <Money value={unpaid.total} />
              {canSeeProceduresPage(role) && <Link className="plain" to="/clinic/procedures?tab=review">المراجعة</Link>}
            </Alert>
          )}
          {lowStock?.n > 0 && (
            <Alert icon={CC.box} title={<>{plural(lowStock.n, 'مادة واحدة', 'مادتان', 'مواد', 'مادة')} عند الحدّ الأدنى أو تحته</>}>
              {lowStock.items.map((m) => (
                canSeeInventory(role)
                  ? <Link key={m.id} className="plain" to={`/inventory?material=${m.id}`}>{m.name}</Link>
                  : <span key={m.id}>{m.name}</span>
              ))}
              {lowStock.n > lowStock.items.length && <Link className="plain" to="/inventory">الكلّ</Link>}
            </Alert>
          )}
          {noDeparture?.days > 0 && (
            <Alert icon={CC.logout} title={<>{plural(noDeparture.days, 'يوم واحد', 'يومان', 'أيام', 'يوماً')} بلا انصراف مسجَّل هالشهر</>}>
              {noDeparture.doctors.map((d) => (
                <Link key={d.doctorId} className="plain" to={`/clinic/doctors/${d.doctorId}/dashboard?period=month`}>{d.doctor}</Link>
              ))}
              {noDeparture.doctorsCount > noDeparture.doctors.length && <span>و{fmtNum(noDeparture.doctorsCount - noDeparture.doctors.length)} غيرهم</span>}
            </Alert>
          )}
        </ul>
      )}
    </div>
  )
}

export default function ClinicCommand() {
  const { user, clinicRole: role } = useRole()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toastNode, showToast] = useToast()

  const load = useCallback(() => api.clinic.command().then((d) => { setData(d); setErr(null) }), [])
  useEffect(() => {
    let alive = true
    load().catch((e) => { if (alive) setErr(e.message) })
    // تحديثٌ صامت: خطؤه لا يمحو ما على الشاشة
    const t = setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => {}) }, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [load])

  const generate = async () => {
    setBusy(true)
    try {
      const r = await api.clinic.generateSessions(data.today)
      await load()
      showToast(generateSummary(data.today, r), r.created?.length ? 'success' : 'info')
    } catch (ex) { showToast(ex.message) } finally { setBusy(false) }
  }

  if (err && !data) return <p className="error">تعذّر تحميل اللوحة: {err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>
  const { weekday, day, month } = dayLabel(data.today)
  const canSeeHighlights = 'apologies' in data.day   // نفس قرّاء لوحة الدكتور — والخادم هو الحارس

  return (
    <div className="cc">
      <header className="cc-head">
        <div>
          <h2>لوحة القيادة — العيادات</h2>
          <p className="subtitle">أهلاً {user.display_name}</p>
        </div>
        <div className="cc-head-side">
          {isReadOnly(role) && <span className="cc-readonly"><span aria-hidden="true">{CC.eye}</span> اطّلاع فقط</span>}
          <span className="cc-date">{weekday} <bdi dir="ltr">{day}/{month}</bdi></span>
        </div>
      </header>

      <DayStats d={data.day} />

      <div className="cc-grid">
        <SessionsCard sessions={data.sessions} today={data.today} doctorsActive={data.doctorsActive}
          canGenerate={canGenerateSessions(role)} busy={busy} onGenerate={generate} />
        <div className="cc-side">
          {data.finance && <FinanceCard f={data.finance} r={data.referrals} role={role} />}
          <AlertsCard a={data.alerts} role={role} />
        </div>
      </div>
      {canSeeHighlights && <Highlights />}
      {toastNode}
    </div>
  )
}
