import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { fmtPct } from './Punctuality.jsx'
import { CC } from './cc-icons.jsx'

// ═══ «الأبرز هالأسبوع» على لوحة القيادة ═══
// كلّ الدكاترة، للمشرفة والمدير والمشرف العام (الخادم يردّ غيرهم 403، والاستقبال لا تصلها البطاقة).
// الأسبوع من السبت، وأحسن ٣ بكلّ بطاقة (الخمسة بكبسة، فلا تدفع جلسات اليوم بعيداً) مع الاختصاص؛
// الأوّل بارزٌ، والاسم يفتح لوحة ذلك الدكتور بالأسبوع نفسه. الترتيب كلّه في الخادم (buildHighlights). يُجلب بطلبه هو فلا يؤخّر أرقام اليوم،
// وقابلٌ للطيّ: الطيّ يُحفظ لهذا الجهاز ولا يُجلب شيءٌ وهو مطويّ.

const KEY = 'board-highlights-open'
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })} ل.س`
const days = (n) => `${fmtInt(n)} ${n === 1 ? 'يوم' : 'أيام'}`
const DOCTOR_LINK = { search: '?period=week' }
const SHORT_LIST = 3

const CARDS = [
  { key: 'commitment', icon: CC.award, tone: 'good', title: 'الأكثر التزاماً بالوقت',
    value: (d) => fmtPct(d.commitment), sub: (d) => `${fmtInt(d.onTime)} من ${days(d.actual)}`,
    empty: (h) => `لا أحد بحضورٍ فعليّ ${days(h.minActualDays)} بعد` },
  { key: 'patients', icon: CC.users, tone: 'teal', title: 'الأكثر مرضى', value: (d) => fmtInt(d.patients) },
  { key: 'procedures', icon: CC.syringe, tone: 'teal', title: 'الأكثر إجراءات', value: (d) => fmtInt(d.procedures) },
  { key: 'shifa', icon: CC.coins, tone: 'teal', title: 'الأعلى حصّةً للشفاء', value: (d) => fmtMoney(d.shifa) },
  // بطاقتان منفصلتان: دقائق التأخير وحدها، وأيام الغياب وحدها
  { key: 'late', icon: CC.clock, tone: 'warn', title: 'الأكثر تأخيراً',
    value: (d) => `${fmtInt(d.lateMinutes)} د`, sub: (d) => `تأخّر ${days(d.lateDays)}`,
    empty: () => 'لا تأخير هالأسبوع' },
  { key: 'absent', icon: CC.userX, tone: 'bad', title: 'الأكثر غياباً',
    value: (d) => days(d.absent), sub: (d) => `من ${days(d.scheduled)} دوام`,
    empty: () => 'لا غياب هالأسبوع' },
]

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

  return (
    <section className="hl-card" aria-label="الأبرز هالأسبوع">
      <button type="button" className="hl-head" aria-expanded={open} onClick={toggle}>
        <span className="hl-mark" aria-hidden="true">{CC.star}</span>
        <span className="hl-title">الأبرز هالأسبوع</span>
        {data && <span className="hl-range" dir="ltr">{data.from === data.to ? data.from : `${data.from} ← ${data.to}`}</span>}
        <span className="hl-chev" aria-hidden="true">{open ? '▾' : '◂'}</span>
      </button>
      {open && (err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <div className="hl-grid">
          {CARDS.map((c) => (
            <div key={c.key} className={`hl-box tone-${c.tone}`}>
              <h4><span className="hl-ico" aria-hidden="true">{c.icon}</span> {c.title}</h4>
              {data[c.key].length === 0 ? <p className="hl-empty">{c.empty ? c.empty(data) : 'لا أرقام هالأسبوع بعد'}</p> : (
                <ol className="hl-list">
                  {data[c.key].slice(0, full ? undefined : SHORT_LIST).map((d) => (
                    <li key={d.doctorId}>
                      <div className="hl-who">
                        <Link to={{ pathname: `/clinic/doctors/${d.doctorId}/dashboard`, ...DOCTOR_LINK }}>{d.doctor}</Link>
                        <span className="hl-sub">{[d.specialty, c.sub && c.sub(d)].filter(Boolean).join('، ')}</span>
                      </div>
                      <span className="hl-val">{c.value(d)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
          {CARDS.some((c) => data[c.key].length > SHORT_LIST) && (
            <button type="button" className="link-btn hl-more" aria-expanded={full} onClick={() => setFull((v) => !v)}>
              {full ? 'الأوائل الثلاثة فقط' : 'عرض الأوائل الخمسة'}
            </button>
          )}
        </div>
      ))}
    </section>
  )
}
