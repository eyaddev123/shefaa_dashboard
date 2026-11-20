import { fmtDay } from '../../api.js'

// ═══ «مستحقات الإحالات» — PDF من صفحة الإحالات (طلب المستخدم 2026-11-20) ═══
// «أسماء الأشخاص مع إحالاتهم لهالشهر، وقديش بيترتّب على الجمعية يلّي عم ناخد منها»: ورقةٌ لكلّ جهة تبدأ صفحةً،
// زيارةٌ في سطر (كالشاشة) برقم ورقتها، وآخرها المستحقّ لنا عليها؛ وكلّ الجهات ⇒ ورقة ملخّصٍ أوّلاً (كالإكسل).
// الأرقام من GET /clinic/referrals/report نفسه — لقطات الخصم، لا حساب هنا إلا الجمع.

const BRAND = 'مجمع عيادات الشفاء الطبي'
export const REFERRALS_TITLE = 'مستحقات الإحالات'
const n = (v) => Number(v || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const day = (d) => fmtDay(`${d}T12:00:00Z`, { utc: true })
const shortDay = (d) => fmtDay(`${d}T12:00:00Z`, { utc: true, year: false })
export const rangeText = (from, to) => (from === to ? `يوم ${day(from)}` : `من ${day(from)} إلى ${day(to)}`)

function Head({ title, source, from, to }) {
  return (
    <header className="pay-head" data-unit>
      <div className="pay-brand">{BRAND}</div>
      <h1>{title}</h1>
      <div className="pay-meta">
        {source && <div><span>الجهة</span><strong>{source}</strong></div>}
        <div><span>الفترة</span><strong>{rangeText(from, to)}</strong></div>
      </div>
    </header>
  )
}

/** ملخّص كلّ الجهات: جهةٌ في سطر — والمجموع يعدّ الزيارة مرّةً ولو أحالتها جهتان */
export function ReferralsSummarySheet({ totals, visits, from, to, printedAt }) {
  const due = totals.reduce((s, t) => s + t.due, 0)
  return (
    <article className="pay-sheet ref-sheet" dir="rtl">
      <Head title={`${REFERRALS_TITLE} — كلّ الجهات`} from={from} to={to} />
      <table className="pay-table ref-sum">
        <thead><tr data-unit><th className="pay-num">#</th><th>الجهة</th><th className="ref-cnt">الزيارات</th><th className="ref-amt">المستحقّ لنا</th></tr></thead>
        <tbody>
          {totals.map((t, i) => (
            <tr key={t.source_id} data-unit><td className="pay-num">{n(i + 1)}</td><td>{t.source}</td>
              <td className="ref-cnt">{n(t.visits)}</td><td className="ref-amt">{n(t.due)}</td></tr>
          ))}
          <tr className="ref-total" data-unit><td colSpan={2}>المجموع ({n(totals.length)} جهة)</td>
            <td className="ref-cnt">{n(visits)}</td><td className="ref-amt">{n(due)}</td></tr>
        </tbody>
      </table>
      <p className="ref-note" data-unit>تفصيل كلّ جهة في الصفحات التالية: كلّ جهةٍ بصفحةٍ تبدأ وحدها.</p>
      {printedAt && <p className="pay-printed">أُعدّ الكشف: {printedAt}</p>}
    </article>
  )
}

/** كشف جهةٍ واحدة: visits من groupVisits (زيارةٌ وجهةٌ في سطر) بترتيب التاريخ */
export function ReferralsSourceSheet({ source, visits, from, to, printedAt }) {
  const due = visits.reduce((s, v) => s + v.due, 0)
  const original = visits.reduce((s, v) => s + v.original, 0)
  const patients = new Set(visits.map((v) => v.patient)).size
  const missing = visits.filter((v) => !v.doc).length
  return (
    <article className="pay-sheet ref-sheet" dir="rtl">
      <Head title={REFERRALS_TITLE} source={source} from={from} to={to} />
      <h2 className="pay-h2" data-unit>الزيارات ({n(visits.length)} زيارة لـ{n(patients)} مريض)</h2>
      <table className="pay-table ref-table">
        <thead><tr data-unit>
          <th className="pay-num">#</th><th className="ref-date">التاريخ</th><th>اسم المريض</th><th>الطبيب</th>
          <th>الكشف / الإجراء</th><th className="ref-amt">السعر</th><th className="ref-amt">على الجهة</th><th className="ref-doc">رقم الورقة</th>
        </tr></thead>
        <tbody>
          {visits.map((v, i) => (
            <tr key={v.key} data-unit>
              <td className="pay-num">{n(i + 1)}</td>
              <td className="ref-date">{shortDay(v.date)}</td>
              <td className="pay-name">{v.patient}</td>
              <td>{v.doctor || '—'}</td>
              <td className="ref-items">{v.items.map((l) => (l.kind === 'procedure' ? l.item.replace(/^إجراء:\s*/, '') : l.item)).join('، ')}</td>
              <td className="ref-amt">{n(v.original)}</td>
              <td className="ref-amt ref-due">{n(v.due)}</td>
              <td className="ref-doc">{v.doc || '—'}</td>
            </tr>
          ))}
          <tr className="ref-total" data-unit>
            <td colSpan={5}>المستحقّ لنا على {source}</td>
            <td className="ref-amt">{n(original)}</td>
            <td className="ref-amt">{n(due)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="ref-notes" data-unit>
        <p>«السعر» قبل الخصم، و«على الجهة» ما خصمناه للمريض بورقة الإحالة فهو مستحقٌّ لنا على الجهة. المبالغ بالليرة السورية.</p>
        {missing > 0 && <p>{n(missing)} زيارة بلا رقم ورقة.</p>}
        {printedAt && <p className="pay-printed">أُعدّ الكشف: {printedAt}</p>}
      </div>
    </article>
  )
}
