import { fmtMoney } from '../api.js'

// شريط الوضع المالي: مصروف / ملتزَم به / متاح — من إجمالي الإيرادات
export default function FinanceBar({ treasury }) {
  const { incomeTotal, spentTotal, committedTotal, available } = treasury
  const total = Math.max(1, incomeTotal)
  const pct = (n) => `${Math.max(0, (n / total) * 100)}%`
  const deficit = available < 0

  return (
    <div className="finance-bar-wrap">
      <div className="finance-bar">
        <div className="seg spent" style={{ width: pct(spentTotal) }} title={`مصروف: ${fmtMoney(spentTotal)}`} />
        <div className="seg committed" style={{ width: pct(committedTotal) }} title={`ملتزَم به: ${fmtMoney(committedTotal)}`} />
        <div className="seg available" style={{ width: pct(Math.max(0, available)) }} title={`متاح: ${fmtMoney(available)}`} />
      </div>
      <div className="finance-legend">
        <span><i className="dot spent" /> مصروف {fmtMoney(spentTotal)}</span>
        <span><i className="dot committed" /> ملتزَم به {fmtMoney(committedTotal)}</span>
        <span className={deficit ? 'deficit' : ''}>
          <i className="dot available" /> متاح للقرارات الجديدة <strong>{fmtMoney(available)}</strong>
          {deficit && ' ⚠️ عجز'}
        </span>
      </div>
    </div>
  )
}
