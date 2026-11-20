import { fmtDay, fmtMonth } from '../../api.js'

// ═══ «أرباح الشفاء من الأطباء» — ورقة A4 تُطبع من «تقارير الدكاترة» بكبسة (طلب المستخدم 2026-11-20) ═══
// «قديش جبلنا مصاري الدكتور، وقديش أخد منّا بآخر الشهر، وقديش ربحنا» — ثلاثة أرقام لكلّ دكتور، بلا تفصيل:
//   جاب  = الكشوفات + الإجراءات بعد المواد (حصّة الشفاء + حصّته) — المواد كلفةٌ لا دخل
//   أخد  = كلّ ما يأخذه منّا = «المستحقّ للطبيب»: الراتب بمكوّناته (شهري/يومي/ساعات/مرضى) + حصّته من الإجراءات والخدمات
//   الربح = جاب − أخد  (= «صافي الربح» في البطاقة ناقص حصّته من الخدمات)
// الأرقام من حساب «تقارير الدكاترة» نفسه (/clinic/accounts) — لا حساب جديد في الخادم.

const BRAND = 'مجمع عيادات الشفاء الطبي'
export const PROFIT_TITLE = 'أرباح الشفاء من الأطباء'
const n = (v) => Number(v || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 0 })
const signed = (v) => `${v < 0 ? '−' : ''}${n(Math.abs(v))}`
const day = (d) => fmtDay(`${d}T12:00:00Z`, { utc: true })

/** سطر الدكتور: جاب/أخد/الربح — noPay: لا راتب مضبوط (أخد = حصصه وحدها) */
export function profitRow(d) {
  const brought = (d.visitShifa || 0) + (d.procShifa || 0) + (d.procDoctor || 0)
  const shares = (d.procDoctor || 0) + (d.ironDoctor || 0)
  const took = d.due === null || d.due === undefined ? shares : d.due
  return { id: d.doctorId, doctor: d.doctor, specialty: d.specialty, brought, took, profit: brought - took,
    noSalary: d.due === null || d.due === undefined || !!d.noPay }
}

/** الفترة بالكلام: «شهر 11/2026» أو «من 1/11/2026 إلى 20/11/2026» */
export const periodText = (data) => (data.month ? `شهر ${fmtMonth(data.month)}`
  : data.from === data.to ? `يوم ${day(data.from)}` : `من ${day(data.from)} إلى ${day(data.to)}`)

export default function ProfitSheet({ data, rows, printedAt }) {
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  const total = { brought: sum('brought'), took: sum('took'), profit: sum('profit') }
  const noSalary = rows.filter((r) => r.noSalary).length
  return (
    <article className="pay-sheet prf-sheet" dir="rtl">
      <header className="pay-head" data-unit>
        <div className="pay-brand">{BRAND}</div>
        <h1>{PROFIT_TITLE}</h1>
        <div className="prf-period">{periodText(data)}</div>
      </header>

      <table className="pay-table prf-table">
        <thead><tr data-unit>
          <th className="pay-num">#</th><th>الطبيب</th>
          <th className="prf-amt">جاب للشفاء<small>الكشوفات والإجراءات</small></th>
          <th className="prf-amt">أخد من الشفاء<small>راتبه وحصصه</small></th>
          <th className="prf-amt">ربح الشفاء</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-unit>
              <td className="pay-num">{n(i + 1)}</td>
              <td className="pay-name">{r.doctor}{r.noSalary && <sup> *</sup>}{r.specialty && <small className="prf-spec"> — {r.specialty}</small>}</td>
              <td className="prf-amt">{n(r.brought)}</td>
              <td className="prf-amt">{n(r.took)}</td>
              <td className={`prf-amt prf-profit${r.profit < 0 ? ' is-loss' : ''}`}>{signed(r.profit)}</td>
            </tr>
          ))}
          <tr className="prf-total" data-unit>
            <td colSpan={2}>المجموع ({n(rows.length)} طبيب)</td>
            <td className="prf-amt">{n(total.brought)}</td>
            <td className="prf-amt">{n(total.took)}</td>
            <td className={`prf-amt prf-profit${total.profit < 0 ? ' is-loss' : ''}`}>{signed(total.profit)}</td>
          </tr>
        </tbody>
      </table>

      <div className="prf-notes" data-unit>
        <p>جاب = الكشوفات + الإجراءات بعد حقّ المواد. أخد = كلّ ما يأخذه الطبيب منّا في الفترة: راتبه (شهري أو يومية أو ساعات أو مرضى) وحصّته من الإجراءات وخدمات العيادة. الربح = جاب − أخد. المبالغ بالليرة السورية.</p>
        {noSalary > 0 && <p>* بلا راتب مضبوط للفترة: «أخد» حصصه وحدها.</p>}
        {printedAt && <p className="pay-printed">أُعدّ التقرير: {printedAt}</p>}
      </div>
    </article>
  )
}
