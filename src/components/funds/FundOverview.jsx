import { useMemo, useState } from 'react'
import { fmtDay } from '../inventory/shared.jsx'
import { fmtNum, signed, pctText, DailyChart } from './ProfitBoard.jsx'

// ═══ صفحة الصندوق — جوابٌ على أسئلة مسؤولة العيادات بترتيبها (2026-11-14، «نفض» بطلب المستخدم) ═══
//   ١) «قديش عنّا هلأ؟»      المصاري + البضاعة على الرف = كلّ ما نملك (الشراء لا يضيّع المال، يصير بضاعة)
//   ٢) «شو صار بهالفترة؟»     فات · طلع · الصافي — ومن وين فات ولوين طلع بأسطرٍ قليلة، لا خمسين حركة
//   ٣) «المواد عم تربّحنا؟»    ربحنا فعلاً (بيع − كلفة ما انباع) · أكتر المواد ربحاً · اللي عم تنباع بخسارة
//   ٤) «بدّي التفاصيل»        الحركات يوماً بيوم، تُفلتر بالكبس على سطرٍ من (٢)؛ وكلّ المواد صفحةٌ تحت الصندوق
// الحساب كلّه بالخادم (/clinic/fund و/clinic/materials-profit) — هنا التجميع للعرض وحده.

// كلّ حركة إلى «من وين/لوين» بكلام المسؤولة. البيع وتعديله وعكسه سطرٌ واحد صافٍ، والحديد كذلك.
export const GROUPS = [
  { key: 'materials', label: 'مواد الإجراءات', hint: 'ثمن المواد اللي انصرفت على المرضى',
    kinds: ['material_sale', 'material_edit', 'material_reversal'], count: 'material_sale', unit: 'إجراء' },
  { key: 'iron', label: 'جلسات الحديد', hint: 'استرداد الدوا والفاضل',
    kinds: ['iron_drug', 'iron_surplus', 'iron_materials', 'iron_drug_rev', 'iron_surplus_rev', 'iron_materials_rev', 'iron_materials_edit', 'iron_surplus_edit'],
    count: 'iron_surplus', unit: 'جلسة' },
  { key: 'purchase', label: 'شراء مواد', hint: 'صارت بضاعة على الرف', kinds: ['purchase'], count: 'purchase', unit: 'مرة' },
  { key: 'expense', label: 'مصاريف', hint: '', kinds: ['expense'], count: 'expense', unit: 'مصروف' },
  { key: 'opening', label: 'الرصيد الافتتاحي', hint: '', kinds: ['opening'], count: 'opening', unit: '' },
]
const groupOf = (kind) => GROUPS.find((g) => g.kinds.includes(kind))?.key || 'other'

export function groupMovements(movements) {
  const out = GROUPS.map((g) => ({ ...g, amount: 0, n: 0 }))
  for (const m of movements) {
    const g = out.find((x) => x.kinds.includes(m.kind))
    if (!g) continue
    g.amount += m.amount
    if (m.kind === g.count) g.n++
  }
  for (const g of out) g.amount = Math.round(g.amount * 100) / 100
  return { ins: out.filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount),
    outs: out.filter((g) => g.amount < 0).sort((a, b) => a.amount - b.amount) }
}

const Lira = () => <span className="cash-unit">ل.س</span>

// ═══ ١) هلأ ═══
export function NowCard({ fund, stock }) {
  const cash = fund.balance, goods = stock.cost
  const total = Math.round((cash + goods) * 100) / 100
  return (
    <section className="fo-now" aria-label="قديش عنّا هلأ">
      <div className="fo-now-head">
        <h3>قديش عنّا هلأ</h3>
        <span className="fo-muted">بغضّ النظر عن الفترة</span>
      </div>
      <div className="fo-eq">
        <div className="fo-eq-part">
          <span className="fo-eq-label">مصاري بالصندوق</span>
          <strong className={cash < 0 ? 'neg' : ''}>{cash < 0 && '−'}{fmtNum(Math.abs(cash))}<Lira /></strong>
        </div>
        <span className="fo-eq-op" aria-hidden="true">+</span>
        <div className="fo-eq-part">
          <span className="fo-eq-label">بضاعة على الرف</span>
          <strong>{fmtNum(goods)}<Lira /></strong>
          <span className="fo-muted">بسعر شرائها</span>
        </div>
        <span className="fo-eq-op" aria-hidden="true">=</span>
        <div className="fo-eq-part fo-eq-total">
          <span className="fo-eq-label">كل اللي عنّا</span>
          <strong className={total < 0 ? 'neg' : ''}>{total < 0 && '−'}{fmtNum(Math.abs(total))}<Lira /></strong>
        </div>
      </div>
      <p className="fo-now-foot">
        {stock.sale > 0 && <>البضاعة لما تنباع كلّها بتجيب <b>{fmtNum(stock.sale)}</b> — يعني ربح جاي <b>{signed(stock.profit)}</b>.</>}
        {stock.unpriced > 0 && <span className="fo-muted"> ({fmtNum(stock.unpriced)} مواد بلا سعر شراء مش محسوبة.)</span>}
        {!fund.opening && <span className="fo-warn"> الرصيد الافتتاحي ما انكتب بعد — الرقم بيبلّش من الصفر.</span>}
      </p>
    </section>
  )
}

// ═══ ٢) شو صار بهالفترة ═══
export function PeriodCard({ fund, periodLabel, active, onPick }) {
  const { ins, outs } = useMemo(() => groupMovements(fund.movements), [fund.movements])
  const t = fund.totals
  const row = (g, total) => (
    <li key={g.key}>
      <button type="button" className={`fo-flow-row${active === g.key ? ' on' : ''}`} onClick={() => onPick(active === g.key ? null : g.key)}
        aria-pressed={active === g.key}>
        <span className="fo-flow-name">
          <b>{g.label}</b>
          <span className="fo-muted">{g.n > 0 && g.unit ? `${fmtNum(g.n)} ${g.unit}` : ''}{g.n > 0 && g.unit && g.hint ? ' · ' : ''}{g.hint}</span>
        </span>
        <span className="fo-flow-amt">{fmtNum(Math.abs(g.amount))}</span>
        <span className="fo-flow-bar" aria-hidden="true"><i style={{ width: `${total ? (Math.abs(g.amount) / total) * 100 : 0}%` }} /></span>
      </button>
    </li>
  )
  return (
    <section className="card fo-card" aria-label="شو صار بالفترة">
      <h3 className="fo-h">{periodLabel}: شو صار بالصندوق؟</h3>
      <div className="fo-sum">
        <div><span className="fo-eq-label">فات</span><strong>{fmtNum(t.in)}</strong></div>
        <div><span className="fo-eq-label">طلع</span><strong>{fmtNum(t.out)}</strong></div>
        <div className="fo-sum-net"><span className="fo-eq-label">الصافي</span><strong className={t.net < 0 ? 'neg' : ''}>{signed(t.net)}</strong></div>
      </div>
      {fund.movements.length === 0 ? <p className="empty">ما صار شي بالصندوق بهالفترة.</p> : (
        <div className="fo-flows">
          <div>
            <h4 className="fo-h4">من وين فات</h4>
            {ins.length ? <ul className="fo-flow">{ins.map((g) => row(g, t.in))}</ul> : <p className="fo-muted">ما فات شي.</p>}
          </div>
          <div>
            <h4 className="fo-h4">لوين طلع</h4>
            {outs.length ? <ul className="fo-flow">{outs.map((g) => row(g, t.out))}</ul> : <p className="fo-muted">ما طلع شي.</p>}
            {outs.some((g) => g.key === 'purchase') && (
              <p className="fo-note">الشراء مش خسارة: المصاري صارت بضاعة على الرف، وبترجع لما تنباع.</p>
            )}
          </div>
        </div>
      )}
      <p className="fo-tip fo-muted">اكبس على أي سطر لتشوف حركاته تحت.</p>
    </section>
  )
}

// ═══ ٣) ربح المواد ═══
export function ProfitCard({ profit, periodLabel, onAll, onOpen }) {
  const t = profit.totals
  const sold = profit.rows.filter((r) => r.qty > 0)
  const top = sold.filter((r) => r.profit !== null && r.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 5)
  const maxTop = Math.max(1, ...top.map((r) => r.profit))
  const losers = profit.rows.filter((r) => r.active && r.unitProfit !== null && r.unitProfit <= 0)
  const days = profit.daily.points.length
  return (
    <section className="card fo-card" aria-label="ربح المواد">
      <div className="fo-card-head">
        <h3 className="fo-h">{periodLabel}: المواد عم تربّحنا؟</h3>
        <button type="button" className="ghost fo-link" onClick={onAll}>كل المواد وأرباحها ←</button>
      </div>
      {sold.length === 0 ? <p className="empty">ما انباع مواد بهالفترة.</p> : (
        <>
          <p className="fo-sentence">
            بعنا مواد بـ <b>{fmtNum(t.sales)}</b> وكلّفتنا <b>{fmtNum(t.cost)}</b> — <span className="fo-big-inline">ربحنا {signed(t.profit)}</span>
            {pctText(t.pct) && <span className="fx-pct">{pctText(t.pct)} فوق الشراء</span>}
          </p>
          {profit.missing > 0 && <p className="fo-muted">({fmtNum(profit.missing)} مواد انباعت بلا سعر شراء — بيعها محسوب وربحها لا.)</p>}
          <div className="fo-profit-grid">
            <div>
              <h4 className="fo-h4">أكتر المواد ربحاً</h4>
              <ol className="fo-rank">
                {top.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpen(r)}>
                      <span className="fo-rank-name"><b>{r.name}</b><span className="fo-muted">انباع {fmtNum(r.qty)} {r.unit}</span></span>
                      <span className="fo-rank-amt">{signed(r.profit)}</span>
                      <span className="fo-flow-bar" aria-hidden="true"><i style={{ width: `${(r.profit / maxTop) * 100}%` }} /></span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            {days > 1 && <div className="fo-chart"><DailyChart daily={profit.daily} /></div>}
          </div>
        </>
      )}
      {losers.length > 0 && (
        <div className="fo-alert" role="note">
          <b>{losers.length === 1 ? 'مادة وحدة عم تنباع' : `${fmtNum(losers.length)} مواد عم تنباع`} بأقل من سعر شرائها:</b>{' '}
          {losers.slice(0, 4).map((r, i) => (
            <span key={r.id}>{i > 0 && '، '}<button type="button" className="link-btn" onClick={() => onOpen(r)}>{r.name}</button>
              {' '}<span className="fo-muted">(منشتريها {fmtNum(r.avgCost)} ومنبيعها {fmtNum(r.unitPrice)})</span></span>
          ))}
          {losers.length > 4 && ' …'} — غيّر سعر البيع من صفحة المخزون.
        </div>
      )}
    </section>
  )
}

// ═══ ٤) الحركات يوماً بيوم — فلترة فوق، وكلّ حركة سطرٌ واحد: «قديش · بسبب شو» (ملاحظة المستخدم) ═══
const DAYS_SHOWN = 5
// أسماء الفلاتر بكلام المسؤولة: الداخل من وين، والمسحوب لأيش
const FILTER_LABEL = { materials: 'داخل من المواد', iron: 'داخل من الحديد', purchase: 'مسحوب لشراء مواد',
  expense: 'مصاريف', opening: 'الرصيد الافتتاحي' }

/** سطر الحركة بكلمات: «تجبير — مريم · د. أحمد»، «شراء رايسك: ١٠ × ٢٤٠ من مستودع الأمل»، «مصروف: فطور للدكاترة» */
function moveText(m) {
  if (m.line) return `${m.kind === 'material_sale' ? '' : `${m.label}: `}${m.line.procedure} — ${m.line.patient}${m.line.doctor ? ` · ${m.line.doctor}` : ''}`
  if (m.purchase) return `شراء ${m.purchase.material}: ${fmtNum(m.purchase.qty)} ${m.purchase.unit} × ${fmtNum(m.purchase.unitCost)}${m.purchase.supplier ? ` من ${m.purchase.supplier}` : ''}`
  if (m.iron) return `${m.label} — ${m.iron.patient}${m.kind.endsWith('_rev') && m.iron.cancelReason ? ` · سبب الإلغاء: ${m.iron.cancelReason}` : ''}`
  if (m.kind === 'expense') return `مصروف: ${m.reason || '—'}`
  return m.reason ? `${m.label}: ${m.reason}` : m.label
}
function Line({ amount, children, by, sub = false }) {
  return (
    <li className={`fo-line${sub ? ' is-sub' : ''}`}>
      <span className={`fo-line-amt${amount < 0 ? ' neg' : ''}`}>{signed(amount)}</span>
      <span className="fo-line-what">{children}</span>
      {by && <span className="fo-line-by">{by}</span>}
    </li>
  )
}

// يومٌ فيه عشرات الإجراءات: «مواد الإجراءات» و«جلسات الحديد» سطرٌ واحد بمجموعه يُفتح بكبسة
const COLLAPSE = ['materials', 'iron']
function DayLines({ items, dayKey, open, onToggle, collapse }) {
  const rows = []
  for (const key of collapse ? COLLAPSE : []) {
    const its = items.filter((m) => groupOf(m.kind) === key)
    if (its.length > 1) rows.push({ key, items: its })
    else if (its.length === 1) rows.push({ key: its[0].id, single: its[0] })
  }
  for (const m of items) if (!collapse || !COLLAPSE.includes(groupOf(m.kind))) rows.push({ key: m.id, single: m })
  return (
    <ul className="fo-lines">
      {rows.map((r) => {
        if (r.single) return <Line key={r.key} amount={r.single.amount} by={r.single.by}>{moveText(r.single)}</Line>
        const g = GROUPS.find((x) => x.key === r.key)
        const sum = Math.round(r.items.reduce((t, m) => t + m.amount, 0) * 100) / 100
        const n = r.items.filter((m) => m.kind === g.count).length || r.items.length
        const k = `${dayKey}:${r.key}`, isOpen = open.has(k)
        return [
          <li key={r.key} className="fo-line is-group">
            <span className={`fo-line-amt${sum < 0 ? ' neg' : ''}`}>{signed(sum)}</span>
            <button type="button" className="fo-line-what fo-line-toggle" aria-expanded={isOpen} onClick={() => onToggle(k)}>
              {g.label} — {fmtNum(n)} {g.unit} <span className="fo-group-toggle">{isOpen ? '▴ خبّي' : '▾ شوفها'}</span>
            </button>
          </li>,
          ...(isOpen ? r.items.map((m) => <Line key={m.id} amount={m.amount} by={m.by} sub>{moveText(m)}</Line>) : []),
        ]
      })}
    </ul>
  )
}

export function Movements({ fund, filter, onFilter }) {
  const [allDays, setAllDays] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  // الفلاتر: «الكل» ثمّ كلّ نوعٍ فيه حركات بالفترة، بعدده ومجموعه
  const chips = useMemo(() => GROUPS.map((g) => {
    const its = fund.movements.filter((m) => g.kinds.includes(m.kind))
    return { key: g.key, label: FILTER_LABEL[g.key], n: its.length, sum: Math.round(its.reduce((t, m) => t + m.amount, 0) * 100) / 100 }
  }).filter((c) => c.n > 0), [fund.movements])
  const list = filter ? fund.movements.filter((m) => groupOf(m.kind) === filter) : fund.movements
  const days = useMemo(() => {
    const map = new Map()
    for (const m of list) {
      const d = map.get(m.date) || { date: m.date, net: 0, items: [] }
      d.net = Math.round((d.net + m.amount) * 100) / 100; d.items.push(m); map.set(m.date, d)
    }
    return [...map.values()]
  }, [list])
  const shown = allDays ? days : days.slice(0, DAYS_SHOWN)
  const total = Math.round(list.reduce((t, m) => t + m.amount, 0) * 100) / 100
  return (
    <section className="card fo-card" id="fo-moves" aria-label="الحركات">
      <h3 className="fo-h">حركة الصندوق</h3>
      <div className="fo-filters" role="group" aria-label="فلترة الحركات">
        <button type="button" aria-pressed={!filter} className={`fo-filter${!filter ? ' on' : ''}`} onClick={() => onFilter(null)}>
          الكل <span>{fmtNum(fund.movements.length)}</span></button>
        {chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={filter === c.key} className={`fo-filter${filter === c.key ? ' on' : ''}`}
            onClick={() => onFilter(filter === c.key ? null : c.key)}>
            {c.label} <span className={c.sum < 0 ? 'neg' : ''}>{signed(c.sum)}</span></button>
        ))}
      </div>
      {filter && <p className="fo-filter-sum">المجموع: <b className={total < 0 ? 'neg' : ''}>{signed(total)}</b> · {fmtNum(list.length)} حركة</p>}
      {days.length === 0 ? <p className="empty">ما في حركات.</p> : shown.map((d) => (
        <div key={d.date} className="fo-day">
          <div className="fo-day-head"><b>{fmtDay(d.date)}</b><span className={d.net < 0 ? 'neg' : ''}>{signed(d.net)}</span></div>
          {/* مفلترٌ بنوعٍ واحد: الحركات مفرودة — المسؤولة طلبتها بالاسم */}
          <DayLines items={d.items} dayKey={d.date} open={open} onToggle={toggle} collapse={!filter} />
        </div>
      ))}
      {days.length > DAYS_SHOWN && (
        <button type="button" className="ghost fx-more" onClick={() => setAllDays((v) => !v)}>
          {allDays ? 'أخفِ الأيام الأقدم' : `باقي الأيام (${fmtNum(days.length - DAYS_SHOWN)})`}</button>
      )}
    </section>
  )
}
