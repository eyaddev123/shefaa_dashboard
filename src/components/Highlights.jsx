import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { CC } from './cc-icons.jsx'

// ═══ «هالأسبوع» على لوحة القيادة — الالتزام بالدوام أوّلاً، ثمّ الأوائل ═══
// كلّ الدكاترة، للمشرفة والمدير والمشرف العام (الخادم يردّ غيرهم 403، والاستقبال لا تصلها البطاقة).
// الأسبوع من السبت. الحساب كلّه في الخادم (buildHighlights): roster = ملخّص كلّ دكتورٍ له دوامٌ أو
// اعتذار، والقوائم مرتّبة. والاسم يفتح لوحة الدكتور بالأسبوع نفسه.
//   الالتزام: النسبة الكلّية ⇐ ثلاثة أعمدة (بالوقت دائماً · يتأخّرون · غياب واعتذار) و«بمواعيد خاصة» سطرٌ وحده.
//   الأوائل: الأكثر مرضى · إجراءات · حصّةً للشفاء — بشريطٍ نسبةً إلى الأوّل.
// يُجلب بطلبه فلا يؤخّر أرقام اليوم، وقابلٌ للطيّ (يُحفظ لهذا الجهاز ولا يُجلب شيءٌ وهو مطويّ).
// ولا «٠» بجانب كلمة: الصفر الهنديّ يُقرأ نقطة — ما هو صفرٌ يُحذف أو يصير جملة.

const KEY = 'board-highlights-open'
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })} ل.س`
const days = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : `${fmtInt(n)} ${n <= 10 ? 'أيام' : 'يوماً'}`)
const mins = (m) => {
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${fmtInt(h)} س${r ? ` ${fmtInt(r)} د` : ''}` : `${fmtInt(r)} د`
}
// الوحدة «دوام» = دكتورٌ في يوم: «دوام واحد» · «دوامان» · «٥ دوامات» · «١٤ دواماً»
const shifts = (n) => (n === 1 ? 'دوام واحد' : n === 2 ? 'دوامين' : `${fmtInt(n)} ${n <= 10 ? 'دوامات' : 'دواماً'}`)
const pct = (x) => `${Math.round(x * 100).toLocaleString('ar-SY')}٪`
const docLink = (id) => ({ pathname: `/clinic/doctors/${id}/dashboard`, search: '?period=week' })
const SHORT = 3, SHORT_PEOPLE = 6

const BOARDS = [
  { key: 'patients', icon: CC.users, title: 'الأكثر مرضى', n: (d) => d.patients, value: (d) => fmtInt(d.patients) },
  { key: 'procedures', icon: CC.syringe, title: 'الأكثر إجراءات', n: (d) => d.procedures, value: (d) => fmtInt(d.procedures) },
  { key: 'shifa', icon: CC.coins, title: 'الأعلى حصّةً للشفاء', n: (d) => d.shifa, value: (d) => fmtMoney(d.shifa) },
]

function People({ list, full, render, empty }) {
  if (list.length === 0) return <p className="hl-empty">{empty}</p>
  const shown = full ? list : list.slice(0, SHORT_PEOPLE)
  return (
    <ul className="hl-people">
      {shown.map((d) => <li key={d.doctorId}>{render(d)}</li>)}
      {!full && list.length > shown.length && <li className="hl-people-more">و{fmtInt(list.length - shown.length)} غيرهم</li>}
    </ul>
  )
}

function Punctuality({ data, full }) {
  const roster = data.roster || []
  const timed = roster.filter((d) => !d.appointmentsBased)
  const sum = (k, list = timed) => list.reduce((t, d) => t + (d[k] || 0), 0)
  const onTime = sum('onTime'), late = sum('late'), actual = onTime + late
  const absent = sum('absent', roster), apologized = sum('apologized', roster)
  const always = timed.filter((d) => d.actual > 0 && d.late === 0)
  const lateList = timed.filter((d) => d.late > 0)
    .sort((a, b) => b.late / b.actual - a.late / a.actual || b.lateMinutes - a.lateMinutes)
  const away = roster.filter((d) => d.absent > 0 || d.apologized > 0)
    .sort((a, b) => b.absent - a.absent || b.apologized - a.apologized)
  const appt = roster.filter((d) => d.appointmentsBased)
  const onW = actual ? (onTime / actual) * 100 : 0

  return (
    <div className="hl-punct">
      {/* بكلامٍ لا بنسبةٍ وحدها: الوحدة «دوام» (دكتور × يوم) لا «يوم» — ١٤ يوماً في أسبوعٍ من ٥ أيام كانت تُربك */}
      <div className="hl-punct-sum">
        <span className="hl-punct-lbl">الالتزام بالدوام هالأسبوع</span>
        {actual ? <>
          <p className="hl-punct-lead">
            من أصل <b>{shifts(actual)}</b> سُجّل فيها وصول الدكتور، وصل <b className="is-on">{fmtInt(onTime)}</b> بالوقت
            {late > 0 && <> و<b className="is-late">{fmtInt(late)}</b> متأخّراً</>}.
          </p>
          <div className="hl-punct-barrow">
            <div className="hl-punct-bar" role="img" aria-label={`بالوقت ${pct(onTime / actual)}، تأخير ${pct(late / actual)}`}>
              {onTime > 0 && <span className="on" style={{ width: `${onW}%` }} />}
              {late > 0 && <span className="late" style={{ width: `${100 - onW}%` }} />}
            </div>
            <span className="hl-punct-pct">{pct(onTime / actual)} بالوقت</span>
          </div>
        </> : <p className="hl-punct-lead">لم يُسجَّل وصول أيّ دكتور هالأسبوع بعد.</p>}
        <ul className="hl-punct-legend">
          <li className="is-on"><i /><b>بالوقت</b><span>{onTime ? shifts(onTime) : '—'}</span>
            <small>وصل خلال {fmtInt(data.grace ?? 20)} دقيقة من بداية دوامه</small></li>
          <li className="is-late"><i /><b>تأخّر</b><span>{late ? shifts(late) : '—'}</span>
            <small>وصل بعد أكثر من {fmtInt(data.grace ?? 20)} دقيقة</small></li>
          <li className="is-apology"><i /><b>اعتذر</b><span>{apologized ? shifts(apologized) : '—'}</span>
            <small>اعتذر مسبقاً عن دوامه</small></li>
          <li className="is-absent"><i /><b>غاب</b><span>{absent ? shifts(absent) : '—'}</span>
            <small>لم يأتِ ولم يعتذر</small></li>
        </ul>
        <span className="hl-punct-note">وقت الوصول = لحظة كبس الاستقبال «وصل الطبيب». اضغط اسم أيّ دكتور لترى أيامه.</span>
      </div>

      <div className="hl-punct-cols">
        <div className="hl-col is-on">
          <h5>بالوقت دائماً</h5>
          <People list={always} full={full} empty="لا أحد بعد"
            render={(d) => <><Link to={docLink(d.doctorId)}>{d.doctor}</Link><span>بالوقت {days(d.onTime)}</span></>} />
        </div>
        <div className="hl-col is-late">
          <h5>يتأخّرون</h5>
          <People list={lateList} full={full} empty="لا تأخير هالأسبوع"
            render={(d) => <>
              <Link to={docLink(d.doctorId)}>{d.doctor}</Link>
              <span>تأخّر {days(d.late)} من {fmtInt(d.actual)}، متوسّط <b>{mins(d.avgLate)}</b></span>
            </>} />
        </div>
        <div className="hl-col is-away">
          <h5>غياب واعتذار</h5>
          <People list={away} full={full} empty="لا غياب ولا اعتذار"
            render={(d) => <>
              <Link to={docLink(d.doctorId)}>{d.doctor}</Link>
              <span>{[d.absent && `غاب ${days(d.absent)}`, d.apologized && `اعتذر ${days(d.apologized)}`].filter(Boolean).join('، ')}</span>
            </>} />
        </div>
      </div>

      {appt.length > 0 && (
        <p className="hl-appt">
          <span className="badge blue sm">بمواعيد خاصة</span>
          <span>يأتون على المواعيد التي يعطونها لمرضاهم — لا يُحسب عليهم تأخير:</span>
          {appt.map((d) => <Link key={d.doctorId} to={docLink(d.doctorId)}>{d.doctor}</Link>)}
        </p>
      )}
    </div>
  )
}

export default function Highlights() {
  const [open, setOpen] = useState(readOpen)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!open || data) return
    let alive = true
    setErr(null)
    api.clinic.highlights({ period: 'week' })
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [open])
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(KEY, v ? '0' : '1') } catch { /* تخزينٌ محجوب: الطيّ لهذه الجلسة فقط */ }
    return !v
  })
  const longer = data && (BOARDS.some((b) => (data[b.key] || []).length > SHORT) || (data.roster || []).length > SHORT_PEOPLE)

  return (
    <section className="hl-card" aria-label="هالأسبوع">
      <button type="button" className="hl-head" aria-expanded={open} onClick={toggle}>
        <span className="hl-mark" aria-hidden="true">{CC.star}</span>
        <span className="hl-title">هالأسبوع</span>
        {data && <span className="hl-range" dir="ltr">{data.from === data.to ? data.from : `${data.from} ← ${data.to}`}</span>}
        <span className="hl-chev" aria-hidden="true">{open ? '▾' : '◂'}</span>
      </button>
      {open && (err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <div className="hl-body">
          <Punctuality data={data} full={full} />
          <div className="hl-grid">
            {BOARDS.map((b) => {
              const list = data[b.key] || []
              const top = list.length ? b.n(list[0]) : 0
              return (
                <div key={b.key} className="hl-box">
                  <h4><span className="hl-ico" aria-hidden="true">{b.icon}</span> {b.title}</h4>
                  {list.length === 0 ? <p className="hl-empty">لا أرقام هالأسبوع بعد</p> : (
                    <ol className="hl-list">
                      {list.slice(0, full ? undefined : SHORT).map((d) => (
                        <li key={d.doctorId}>
                          <div className="hl-who">
                            <Link to={docLink(d.doctorId)}>{d.doctor}</Link>
                            {d.specialty && <span className="hl-sub">{d.specialty}</span>}
                          </div>
                          <span className="hl-val">{b.value(d)}</span>
                          <span className="hl-bar" aria-hidden="true"><i style={{ width: `${top ? (b.n(d) / top) * 100 : 0}%` }} /></span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </div>
          {longer && (
            <button type="button" className="link-btn hl-more" aria-expanded={full} onClick={() => setFull((v) => !v)}>
              {full ? 'عرضٌ مختصر' : 'عرض الكلّ'}
            </button>
          )}
        </div>
      ))}
    </section>
  )
}
