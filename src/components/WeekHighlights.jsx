import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { fmtPct } from './Punctuality.jsx'

// ═══ «الأبرز هالأسبوع» على اللوحة اليومية ═══
// للمشرفة والمدير والمشرف العام (الخادم يردّ غيرهم 403). الأسبوع من السبت إلى الآن، وأحسن ٥ بكلّ
// بطاقة مع الاختصاص؛ الاسم يفتح لوحة الدكتور. الترتيب كلّه في الخادم (buildHighlights).
// قابلةٌ للطيّ، والطيّ يُحفظ لهذا الجهاز وحده — لا تزاحم اللوحة لمن لا يريدها.

const KEY = 'board-highlights-open'
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })} ل.س`
const days = (n) => `${fmtInt(n)} ${n === 1 ? 'يوم' : 'أيام'}`

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
    empty: () => 'لا تأخير هالأسبوع' },
  { key: 'absent', icon: '❌', title: 'الأكثر غياباً',
    value: (d) => days(d.absent), sub: (d) => `من ${days(d.scheduled)} دوام`,
    empty: () => 'لا غياب هالأسبوع' },
]

export default function WeekHighlights() {
  const [open, setOpen] = useState(readOpen)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!open || data) return
    api.clinic.highlights().then(setData).catch((e) => setErr(e.message))
  }, [open])
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(KEY, v ? '0' : '1') } catch { /* تخزينٌ محجوب: الطيّ لهذه الجلسة فقط */ }
    return !v
  })

  return (
    <div className="card hl-card">
      <button type="button" className="hl-head" aria-expanded={open} onClick={toggle}>
        <span className="hl-title">الأبرز هالأسبوع</span>
        {data && <span className="hl-range" dir="ltr">{data.from} ← {data.to}</span>}
        <span className="hl-chev" aria-hidden="true">{open ? '▾' : '◂'}</span>
      </button>
      {open && (err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <div className="hl-grid">
          {CARDS.map((c) => (
            <div key={c.key} className="hl-box">
              <h4><span aria-hidden="true">{c.icon}</span> {c.title}</h4>
              {data[c.key].length === 0 ? <p className="hl-empty">{c.empty ? c.empty(data) : 'لا أرقام هالأسبوع بعد'}</p> : (
                <ol className="hl-list">
                  {data[c.key].map((d) => (
                    <li key={d.doctorId}>
                      <div className="hl-who">
                        <Link to={`/clinic/doctors/${d.doctorId}/dashboard`}>{d.doctor}</Link>
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
