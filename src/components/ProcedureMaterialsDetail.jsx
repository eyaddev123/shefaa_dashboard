// ═══ تفصيل مواد سطر الإجراء: المبيع والشراء والربح — للعرض وحده ═══
// كجدول مواد جلسة الحديد. المطروح من سعر الإجراء هو قيمة المبيع (كما main)؛ سعر الشراء وكلفته وربحه
// معلومةٌ محاسبية مجمّدة لحظة الصرف لا تدخل أيّ تقسيم. الخادم لا يرسلها إلا للإدارة، فالمكوّن لا يظهر
// لغيرها أصلاً (hasPurchaseDetail).
// مادةٌ بلا سعر شراء، أو صُرفت قبل تفعيل التفصيل، أو المستهلكات: «—» وخارج الكلفة والربح.

const fmt = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const qty = (q) => Number(q).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const has = (v) => v !== null && v !== undefined

// شكلان من الخادم: المراجعة (snake_case) والمستحقات (camelCase) — يُوحَّدان هنا
const norm = (m) => ({
  name: m.name, unit: m.unit, qty: Number(m.qty),
  unitPrice: Number(m.unitPrice ?? m.unit_price ?? 0), sale: Number(m.cost || 0),
  purchaseUnit: m.purchaseUnit ?? m.purchase_unit ?? null,
  purchaseCost: m.purchaseCost ?? m.purchase_cost ?? null,
  profit: m.profit ?? null,
  tracked: (m.purchaseTracked ?? m.purchase_tracked) !== false,
})

/** يعرف المكوّن إن كان الردّ يحمل تفصيل الشراء (الإدارة وحدها) */
export const hasPurchaseDetail = (line) => Boolean(line && line.purchase)

/**
 * @param {{items:object[], consumables?:number, legacy?:number, summary:{cost:number, profit:number, unknown:number, unknownSale:number, old:number}}} p
 */
export default function ProcedureMaterialsDetail({ items, consumables = 0, legacy = 0, summary }) {
  const rows = (items || []).map(norm)
  if (rows.length === 0 && !consumables && !legacy) return null
  const saleTotal = rows.reduce((t, m) => t + m.sale, 0) + Number(consumables || 0) + Number(legacy || 0)
  const outside = [
    summary.unknown > 0 && `${fmt(summary.unknown)} ${summary.unknown === 1 ? 'مادة' : 'مواد'} بلا سعر شراء (مبيعها ${fmt(summary.unknownSale)})`,
    consumables > 0 && `مستهلكات ${fmt(consumables)}`,
    legacy > 0 && `مواد سابقة ${fmt(legacy)}`,
  ].filter(Boolean)
  return (
    <div className="proc-mat-detail">
      <table className="iron-mat-table proc-mat-table">
        <thead>
          <tr><th>المادة</th><th className="num">الكمية</th><th className="num col-unit">سعر المبيع</th>
            <th className="num">قيمة المبيع</th><th className="num col-unit">سعر الشراء</th>
            <th className="num">كلفة الشراء</th><th className="num">الربح</th></tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={i}>
              <td>{m.name}
                {!has(m.purchaseCost) && <> <span className={`badge sm ${m.tracked ? 'warn' : ''}`}
                  title={m.tracked ? 'لم يكن لها سعر شراء لحظة الصرف' : 'صُرفت قبل تفعيل تفصيل الشراء — لا تُخترع لها كلفة'}>
                  {m.tracked ? 'بلا سعر شراء' : 'قبل التفعيل'}</span></>}
              </td>
              <td className="num">{qty(m.qty)} <small>{m.unit}</small></td>
              <td className="num col-unit">{fmt(m.unitPrice)}</td>
              <td className="num">{fmt(m.sale)}</td>
              <td className="num col-unit">{has(m.purchaseUnit) ? fmt(m.purchaseUnit) : '—'}</td>
              <td className="num">{has(m.purchaseCost) ? fmt(m.purchaseCost) : '—'}</td>
              <td className="num">{has(m.profit) ? fmt(m.profit) : '—'}</td>
            </tr>
          ))}
          {consumables > 0 && (
            <tr className="proc-mat-extra">
              <td>مستهلكات <span className="badge sm warn" title="تقديرٌ على الإجراء لا مادةٌ معدودة">بلا سعر شراء</span></td>
              <td className="num">—</td><td className="num col-unit">—</td>
              <td className="num">{fmt(consumables)}</td>
              <td className="num col-unit">—</td><td className="num">—</td><td className="num">—</td>
            </tr>
          )}
          {legacy > 0 && (
            <tr className="proc-mat-extra">
              <td>مواد سابقة (إجمالي)</td>
              <td className="num">—</td><td className="num col-unit">—</td>
              <td className="num">{fmt(legacy)}</td>
              <td className="num col-unit">—</td><td className="num">—</td><td className="num">—</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>المجموع</td><td className="col-unit"></td><td className="num">{fmt(saleTotal)}</td>
            <td className="col-unit"></td><td className="num">{fmt(summary.cost)}</td><td className="num">{fmt(summary.profit)}</td></tr>
        </tfoot>
      </table>
      <p className="earn-note">
        قيمة المبيع هي ما طُرح من سعر الإجراء (والتقسيم عليها)؛ سعر الشراء والربح للعلم وحده، مجمّدان لحظة الصرف.
        {outside.length > 0 && <> الكلفة والربح لما عُرف سعر شرائه — خارجهما: {outside.join('، ')}.</>}
      </p>
    </div>
  )
}
