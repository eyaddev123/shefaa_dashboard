import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { fmtPct } from './Punctuality.jsx'

// ═══ «الأبرز» على لوحة تحكم الدكتور ═══
// للمشرفة والمدير والمشرف العام (الخادم يردّ غيرهم 403). بفترة اللوحة نفسها (هالأسبوع من السبت ·
// هالشهر · حرّ)، وأحسن ٥ بكلّ بطاقة مع الاختصاص؛ الاسم يفتح لوحة ذلك الدكتور بالفترة نفسها،
// والدكتور المفتوح مُعلَّمٌ في القوائم. الترتيب كلّه في الخادم (buildHighlights).
// قابلةٌ للطيّ، والطيّ يُحفظ لهذا الجهاز وحده.

const KEY = 'board-highlights-open'
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })} ل.س`
const days = (n) => `${fmtInt(n)} ${n === 1 ? 'يوم' : 'أيام'}`
const WHEN = { week: 'هالأسبوع', month: 'هالشهر', custom: 'بالفترة' }

const CARDS = [
  { key: 'commitment', icon: '🏆', title: 'الأكثر التزاماً بالوقت',
    value: (d) => fmtPct(d.commitment), sub: (d) => `${fmtInt(d.onTime)} من ${days(d.actual)}`,
    empty: (h) => `لا أحد بحضورٍ فعليّ ${days(h.minActualDays)} بعد` },
  { key: 'patients', icon: '🩺', title: 'الأكثر مرضى', value: (d) => fmtInt(d.patients) },
  { key: 'procedures', icon: '💉', title: 'الأكثر إجراءات', value: (d) => fmtInt(d.procedures) },
  { key: 'shifa', icon: '💰', title: 'الأعلى حصّةً للشفاء', value: (d) => fmtMoney(d.shifa) },
  // بطاقتان منفصلتان: دقائق التأخير وحدها، وأيام الغياب وحدها
  { key: 'late', icon: '⏰', title: 'الأكثر تأخيراً',
    value: (d) => `${fmtInt(d.lateMinutes)} د`, sub: (d) => `تأخّر ${days(d.lateDays)}`,
    empty: (_h, when) => `لا تأخير ${when}` },
  { key: 'absent', icon: '❌', title: 'الأكثر غياباً',
    value: (d) => days(d.absent), sub: (d) => `من ${days(d.scheduled)} دوام`,
    empty: (_h, when) => `لا غياب ${when}` },
]

export default function Highlights({ period, from, to, currentId, search = '' }) {
  const [open, setOpen] = useState(readOpen)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const key = `${period}|${period === 'custom' ? `${from}|${to}` : ''}`
  useEffect(() => {
    if (!open || data?.key === key) return
    let alive = true
    setErr(null)
    api.clinic.highlights({ period, from, to })
      .then((d) => { if (alive) setData({ key, ...d }) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [open, key])
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(KEY, v ? '0' : '1') } catch { /* تخزينٌ محجوب: الطيّ لهذه الجلسة فقط */ }
    return !v
  })
  const shown = data?.key === key ? data : null
  const when = WHEN[period] || WHEN.custom

  return (
    <div className="card hl-card">
      <button type="button" className="hl-head" aria-expanded={open} onClick={toggle}>
        <span className="hl-title">الأبرز {when}</span>
        {shown && <span className="hl-range" dir="ltr">{shown.from === shown.to ? shown.from : `${shown.from} ← ${shown.to}`}</span>}
        <span className="hl-chev" aria-hidden="true">{open ? '▾' : '◂'}</span>
      </button>
      {open && (err ? <p className="error">{err}</p> : !shown ? <p className="empty">جارٍ التحميل…</p> : (
        <div className="hl-grid">
          {CARDS.map((c) => (
            <div key={c.key} className="hl-box">
              <h4><span aria-hidden="true">{c.icon}</span> {c.title}</h4>
              {shown[c.key].length === 0 ? <p className="hl-empty">{c.empty ? c.empty(shown, when) : `لا أرقام ${when} بعد`}</p> : (
                <ol className="hl-list">
                  {shown[c.key].map((d) => (
                    <li key={d.doctorId} className={d.doctorId === currentId ? 'hl-me' : undefined}>
                      <div className="hl-who">
                        {d.doctorId === currentId
                          ? <span className="hl-name" aria-current="page">{d.doctor}</span>
                          : <Link to={{ pathname: `/clinic/doctors/${d.doctorId}/dashboard`, search }}>{d.doctor}</Link>}
                        {d.specialty && <span className="hl-spec">{d.specialty}</span>}
                        {c.sub && c.sub(d) && <span className="hl-sub">{c.sub(d)}</span>}
                      </div>
                      <span className="hl-val">{c.value(d)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
