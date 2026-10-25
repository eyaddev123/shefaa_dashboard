import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, fmtMoney, todayLocal } from '../api.js'
import RoomBadge from '../components/RoomBadge.jsx'
import { useToast } from '../action-feedback.jsx'

// ═══ جرد الصندوق — شاشةٌ داخل النظام، دكتوراً دكتوراً ═══
// الاستقبال (والمشرفة والمدير) بآخر الدوام: ما دخل الصندوق في يوم، بطاقاتٌ فوق ثمّ كتلة لكل
// دكتورٍ حضر عنده مرضى، وفحص التطابق بين الحسابين المستقلّين تحتها.
// الحساب كلّه في الخادم (GET /api/reception/cash-report?format=json) — وهو نفسه ما يُبنى منه
// ملفّ الإكسل، فالشاشة والملفّ لا يختلفان برقم. لا شيء يُجمع هنا.
// اليوم في الرابط (?date=) فيبقى بعد التحديث ويُشارَك.

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY')
const patientsText = (n) => `${fmtNum(n)} ${n === 1 ? 'مريض' : 'مرضى'}`
const AUTO_OPEN_MAX = 3   // حتى ثلاثة دكاترة: الكتل مفتوحة؛ أكثر: مطويّة ويُفتح ما يُراد

function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}

const CARDS = [
  { key: 'total', label: 'إجمالي اليوم', money: true, hero: true },
  { key: 'patients', label: 'عدد المرضى' },
  { key: 'fee', label: 'مجموع الكشوف', money: true },
  { key: 'procTotal', label: 'مجموع الإجراءات', money: true,
    hint: (t) => `عدد الإجراءات: ${fmtNum(t.procCount)}` },
  { key: 'discount', label: 'خصومات الإحالات', money: true,
    hint: (t) => <>عدد الإحالات: {fmtNum(t.referralCount)}<span className="cash-hint-sub">على الجهات لا على الصندوق</span></> },
]

function SummaryTiles({ totals }) {
  return (
    <div className="tiles cash-tiles">
      {CARDS.map((c) => (
        <div key={c.key} className={`tile${c.hero ? ' cash-hero' : ''}`}>
          <div className="label">{c.label}</div>
          <div className="value">{c.money ? <Money value={totals[c.key]} /> : fmtNum(totals[c.key])}</div>
          {c.hint && <div className="hint">{c.hint(totals)}</div>}
        </div>
      ))}
    </div>
  )
}

function LineRow({ l }) {
  return (
    <tr className={l.flagged ? 'cash-flag' : undefined}>
      <td className="num cash-q">{l.queue === '' || l.queue == null ? '—' : fmtNum(l.queue)}</td>
      <td className="cash-name">{l.name}</td>
      <td className="cash-visit">{l.visit}</td>
      <td className="num cash-m">{fmtNum(l.fee)}</td>
      <td className="cash-procs">
        {l.procItems.length === 0 ? <span className="muted">—</span> : l.procItems.map((p, i) => (
          <span key={i} className="cash-proc">{p.name} <span className="muted">{fmtNum(p.price)}</span></span>
        ))}
      </td>
      <td className="cash-ref">
        {l.referral ? (
          <><span className="cash-ref-name">{l.referral}</span>
            {l.discount > 0 && <span className="cash-ref-disc">− {fmtNum(l.discount)}</span>}</>
        ) : <span className="muted">—</span>}
      </td>
      <td className="num cash-m cash-due">{fmtNum(l.total)}</td>
      <td className="cash-notes">
        {l.flags.map((f) => <span key={f} className="badge warn sm">{f}</span>)}
        {l.remarks.length > 0 && <span className="cash-remarks">{l.remarks.join(' · ')}</span>}
        {l.flags.length === 0 && l.remarks.length === 0 && <span className="muted">—</span>}
      </td>
    </tr>
  )
}

// سطر التفصيل تحت الاسم: ما لا قيمة له عند الدكتور لا يظهر أصلاً (لا «الإجراءات: ٠»).
// لا «·» بجانب رقم: الصفر العربي «٠» نقطةٌ هو الآخر، فيُقرأ «٣ · ٩٠» «٣٠٩٠». العدد بين قوسين بعد
// العنوان، والعناصر يفصلها خطٌّ رفيع لا نقطة. والمبلغ <bdi dir="rtl">: بلا حرفٍ عربي فيه يُعزَل
// يساراً فتنتقل «−» إلى يسار الرقم.
function Breakdown({ t }) {
  const item = (label, count, amount) => (
    <>{label} (<bdi>{fmtNum(count)}</bdi>): <bdi dir="rtl">{amount}</bdi></>
  )
  return (
    <span className="cash-doc-break">
      <span>{item('الكشوف', t.patients, `${fmtNum(t.fee)} ل.س`)}</span>
      {t.procCount > 0 && <span>{item('الإجراءات', t.procCount, `${fmtNum(t.procTotal)} ل.س`)}</span>}
      {t.referralCount > 0 && (
        <span className="cash-doc-break-ref">
          {item('الإحالات', t.referralCount, `− ${fmtNum(t.discount)} ل.س`)} على الجهات
        </span>
      )}
    </span>
  )
}

function DoctorBlock({ d, open, onToggle }) {
  const id = `cash-doc-${d.key}`
  const t = d.totals
  return (
    <section className={`card cash-doc${open ? ' is-open' : ''}`}>
      <button type="button" className="cash-doc-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="cash-chev" aria-hidden="true">‹</span>
        <span className="cash-doc-who">
          <strong>{d.doctor || 'بلا دكتور'}</strong>
          <span className="cash-doc-spec">{d.specialty || '—'}</span>
        </span>
        <RoomBadge room={d.room} />
        {d.flagged > 0 && <span className="badge warn sm">{fmtNum(d.flagged)} للمراجعة</span>}
        <span className="cash-doc-count">{patientsText(t.patients)}</span>
        <span className="cash-doc-total"><Money value={t.total} /></span>
        <Breakdown t={t} />
      </button>
      {open && (
        <div className="cash-doc-body" id={id}>
          <table className="cash-table">
            {/* عرضٌ ثابت للأعمدة: الكتل كلّها تصطفّ عموداً تحت عمود مهما اختلف محتواها */}
            <colgroup>
              <col className="c-q" /><col className="c-name" /><col className="c-visit" /><col className="c-fee" />
              <col className="c-procs" /><col className="c-ref" /><col className="c-due" /><col className="c-notes" />
            </colgroup>
            <thead>
              <tr>
                <th>الدور</th><th>الاسم</th><th>الزيارة</th><th>الكشف</th><th>الإجراءات</th>
                <th>الإحالة</th><th>المطلوب</th><th>الملاحظات</th>
              </tr>
            </thead>
            <tbody>{d.rows.map((l) => <LineRow key={l.id} l={l} />)}</tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>مجموع الدكتور</td>
                <td className="num cash-m">{fmtNum(t.fee)}</td>
                <td className="num">{fmtNum(t.procTotal)}</td>
                <td className="num">{t.discount > 0 ? `− ${fmtNum(t.discount)}` : ''}</td>
                <td className="num cash-m cash-due">{fmtNum(t.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function GrandTotal({ data }) {
  const { totals, check } = data
  const patientsOff = check.independentPatients !== totals.patients
  return (
    <div className="card cash-grand">
      <div className="cash-grand-row">
        <div>
          <div className="cash-grand-label">المجموع الكلي</div>
          {/* فواصل خطّية لا «·»: الصفر العربي نقطة فيلتبس بها (انظر Breakdown) */}
          <div className="cash-grand-sub">
            <span>{patientsText(totals.patients)}</span>
            <span>كشوف <bdi>{fmtNum(totals.fee)}</bdi></span>
            <span>إجراءات <bdi>{fmtNum(totals.procTotal)}</bdi></span>
            {totals.discount > 0 && <span>خصومات الإحالات <bdi dir="rtl">− {fmtNum(totals.discount)}</bdi></span>}
          </div>
        </div>
        <div className="cash-grand-value"><Money value={totals.total} /></div>
      </div>
      {check.ok ? (
        <p className="cash-check ok">✓ الحسابان المستقلّان متطابقان</p>
      ) : (
        <div className="cash-check bad" role="alert">
          {check.diff !== 0 && <div>⚠ فرق بالمجموع: {fmtMoney(check.diff)}</div>}
          {patientsOff && <div>⚠ فرق بعدد المرضى: {fmtNum(totals.patients)} مقابل {fmtNum(check.independentPatients)}</div>}
          <div className="cash-check-hint">لا تعتمد هذا الجرد قبل مراجعة الإدارة — الحساب من الأسطر لا يطابق تجميع القاعدة.</div>
        </div>
      )}
    </div>
  )
}

export default function CashReport() {
  const navigate = useNavigate()
  const location = useLocation()
  const [toast, showToast] = useToast()
  const [params, setParams] = useSearchParams()
  const today = todayLocal()
  const date = params.get('date') || today
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({})
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null); setErr(null)
    api.clinic.cashReportData({ date })
      .then((d) => {
        if (!alive) return
        setData(d)
        const auto = d.doctors.length <= AUTO_OPEN_MAX
        setOpen(Object.fromEntries(d.doctors.map((x) => [x.key, auto])))
      })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [date])

  const setDate = (v) => setParams(v && v !== today ? { date: v } : {}, { replace: true })
  const back = () => (location.state?.from ? navigate(-1) : navigate('/clinic/board'))
  const download = async () => {
    setDownloading(true)
    try { const name = await api.clinic.cashReport({ date }); showToast(`نُزّل ${name}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) }
    finally { setDownloading(false) }
  }

  const docs = data?.doctors || []
  const allOpen = docs.length > 0 && docs.every((d) => open[d.key])
  const setAll = (v) => setOpen(Object.fromEntries(docs.map((d) => [d.key, v])))

  return (
    <>
      {toast}
      <div className="page-head cash-head">
        <div>
          <h2>جرد الصندوق</h2>
          <p className="subtitle">
            ما دخل الصندوق {date === today ? 'اليوم' : <>يوم <bdi dir="ltr">{date}</bdi></>} — دكتوراً دكتوراً، من حضر وحده
          </p>
        </div>
        <div className="cash-head-actions">
          <input type="date" aria-label="التاريخ" value={date} max={today}
            onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="ghost" disabled={downloading || !data} onClick={download}>
            {downloading ? 'جارٍ التحضير…' : '⬇ تحميل Excel'}
          </button>
          <button type="button" className="ghost" onClick={back}>→ رجوع</button>
        </div>
      </div>

      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : docs.length === 0 ? (
          <div className="card cash-empty">
            <span className="cash-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" />
              </svg>
            </span>
            <p className="inv-empty-text">لا حركة في الصندوق {date === today ? 'اليوم' : 'في هذا اليوم'}</p>
            <p className="inv-empty-hint">
              {date === today ? 'لم يحضر أيّ مريض بعد' : <>لم يحضر أيّ مريض يوم <bdi dir="ltr">{date}</bdi></>}
              {' '}— الجرد يعدّ من حضر ودفع وحده.
            </p>
            {date !== today && (
              <div className="inv-empty-actions">
                <button type="button" className="ghost" onClick={() => setDate(today)}>ارجع لليوم</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <SummaryTiles totals={data.totals} />
            <div className="cash-docs-head">
              <h3>دكاترة {date === today ? 'اليوم' : 'اليوم المحدّد'} <span className="muted">({fmtNum(docs.length)})</span></h3>
              {data.flagged > 0 && <span className="badge warn">{fmtNum(data.flagged)} سطر للمراجعة</span>}
              <button type="button" className="link-btn" onClick={() => setAll(!allOpen)}>
                {allOpen ? 'طيّ الكل' : 'فتح الكل'}
              </button>
            </div>
            {docs.map((d) => (
              <DoctorBlock key={d.key} d={d} open={!!open[d.key]}
                onToggle={() => setOpen((o) => ({ ...o, [d.key]: !o[d.key] }))} />
            ))}
            <GrandTotal data={data} />
          </>
        )}
    </>
  )
}
