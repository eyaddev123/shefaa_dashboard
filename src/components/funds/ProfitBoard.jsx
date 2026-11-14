import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api.js'
import { Modal, fmtDay } from '../inventory/shared.jsx'

// ═══ «كل المواد وأرباحها» — الصفحة تحت الصندوق (?view=materials)، ونافذة المادة، والرسم ═══
// ربح القطعة ونسبته · المخزون وربحه الجاي · كلّ بيعة بتفاصيلها (بالكبس على المادة) · ربح كلّ يوم برسم.
// مواد الإجراءات، ومواد جلسات الحديد منذ صارت بسعر البيع (2026-11-14). الحساب كلّه بالخادم
// (buildProfitBoard) — هنا عرضٌ وترتيبٌ وبحثٌ محلّي. والنسبة فوق سعر الشراء: ربح ٤٠ على ١٨٠ = ٢٢٪.
// الشكل كشبكة المخزون: بطاقاتٌ محايدة بلا «برقعة ألوان»، وشارةٌ صغيرة للمشكلة وحدها.

export const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })
export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
export const pctText = (p) => (p === null || p === undefined ? null : `${Number(p).toLocaleString('ar-SY', { maximumFractionDigits: 1 })}٪`)
const qtyText = (q, unit) => `${fmtNum(q)} ${unit}`
// «١٤ تشرين الثاني» للأيام و«تشرين الثاني» للأشهر
const shortDay = (k) => new Date(`${k.length === 7 ? `${k}-01` : k}T00:00:00`)
  .toLocaleDateString('ar-SY', k.length === 7 ? { month: 'long' } : { day: 'numeric', month: 'long' })

// ═══ الرسم: عمودٌ لكلّ يوم (أو شهر) — البيع خفيف خلف الربح ═══
export function DailyChart({ daily, title = 'الربح اليومي' }) {
  const [hover, setHover] = useState(null)
  const pts = daily.points
  const max = Math.max(1, ...pts.map((p) => Math.max(p.sales, Math.abs(p.profit))))
  const any = pts.some((p) => p.sales > 0)
  const shown = hover !== null ? pts[hover] : null
  const step = Math.ceil(pts.length / 8)   // تسمياتٌ قليلة تحت الأعمدة: لا تتزاحم على الجوال
  return (
    <div className="fx-chart-wrap">
      <div className="fx-chart-head">
        <h3>{daily.unit === 'month' ? 'الربح الشهري' : title}</h3>
        <span className="fx-chart-read" aria-live="polite">
          {shown ? <><strong>{shortDay(shown.key)}</strong> · المبيعات {fmtNum(shown.sales)} · الربح {signed(shown.profit)}</>
            : any ? 'مرّر المؤشّر أو المس عموداً لعرض قيمته' : 'لا مبيعات في هذه الفترة'}
        </span>
      </div>
      <div className="fx-chart" role="img" aria-label={`ربح المواد ${pts.length} ${daily.unit === 'month' ? 'شهر' : 'يوم'}`}
        onMouseLeave={() => setHover(null)}>
        {pts.map((p, i) => (
          <button type="button" key={p.key} className={`fx-col${hover === i ? ' on' : ''}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
            aria-label={`${shortDay(p.key)}: المبيعات ${fmtNum(p.sales)}، الربح ${fmtNum(p.profit)}`}>
            <span className="fx-bar fx-bar-sale" style={{ height: `${(p.sales / max) * 100}%` }} />
            <span className={`fx-bar fx-bar-profit${p.profit < 0 ? ' neg' : ''}`} style={{ height: `${(Math.abs(p.profit) / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="fx-chart-axis" aria-hidden="true">
        {pts.map((p, i) => <span key={p.key}>{i % step === 0 ? shortDay(p.key) : ''}</span>)}
      </div>
      <div className="fx-legend" aria-hidden="true">
        <span><i className="fx-key fx-key-sale" />المبيعات</span><span><i className="fx-key fx-key-profit" />الربح</span>
      </div>
    </div>
  )
}

// ═══ بطاقات المواد: ترتيب وبحث وفلتر ═══
const SORTS = [
  ['profit', 'الأعلى ربحاً', (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity)],
  ['pct', 'أعلى نسبة', (a, b) => (b.unitPct ?? -Infinity) - (a.unitPct ?? -Infinity)],
  ['low', 'الأقل ربحاً', (a, b) => (a.unitPct ?? Infinity) - (b.unitPct ?? Infinity)],
  ['qty', 'الأكثر مبيعاً', (a, b) => b.qty - a.qty],
  ['stock', 'ربح المخزون', (a, b) => (b.stockProfit ?? -Infinity) - (a.stockProfit ?? -Infinity)],
  ['name', 'أبجدياً', (a, b) => a.name.localeCompare(b.name, 'ar')],
]
const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()

export function MaterialsView({ data, query, periodLabel, onBack, initial = null }) {
  const [sort, setSort] = useState('profit')
  const soldCount = data.rows.filter((r) => r.qty > 0).length
  // ٤٤ مادة وأغلبها لم يُبَع في الفترة: تبدأ القائمة بالمبيع (إن وُجد)، والخيار يُظهر الكلّ ومخزونه
  const [onlySold, setOnlySold] = useState(soldCount > 0)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(initial)
  const list = useMemo(() => {
    const cmp = SORTS.find(([k]) => k === sort)[2]
    const nq = norm(q)
    return data.rows.filter((r) => (!onlySold || r.qty > 0) && (!nq || norm(r.name).includes(nq)))
      .sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'ar'))
  }, [data.rows, sort, onlySold, q])

  return (
    <div className="card fx-card">
      <button type="button" className="link-btn fo-back" onClick={onBack}>→ العودة إلى الملخّص</button>
      <div className="fx-mat-head">
        <h3>جميع المواد وأرباحها — {periodLabel}</h3>
        <input className="fx-search" type="search" placeholder="ابحث عن مادة…" value={q} onChange={(e) => setQ(e.target.value)}
          aria-label="البحث عن مادة" />
      </div>
      <div className="fx-controls">
        <div className="earn-periods" role="group" aria-label="الترتيب">
          {SORTS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} className={`rev-flag${sort === k ? ' is-on' : ''}`}
              onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>
        <label className="fx-only">
          <input type="checkbox" checked={onlySold} onChange={(e) => setOnlySold(e.target.checked)} />
          المبيعة في هذه الفترة فقط ({fmtInt(soldCount)})
        </label>
      </div>
      {list.length === 0 ? <p className="empty">{q ? 'لا توجد مادة بهذا الاسم.' : onlySold ? 'لم يُبَع شيء في هذه الفترة.' : 'لا مواد بعد.'}</p> : (
        <div className="fx-grid">
          {list.map((r) => <MaterialProfitCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
        </div>
      )}
      {data.missing > 0 && (
        <p className="share-warn">⚠ {data.missing === 1 ? 'مادةٌ واحدة بيعت' : `${fmtInt(data.missing)} مواد بيعت`} دون سعر شراء — قيمة بيعها محسوبة وربحها غير محسوب.
          يُدخَل سعر شرائها من صفحة المخزون.</p>
      )}
      <p className="earn-note">
        ربح القطعة = سعر البيع الحالي − متوسّط سعر الشراء الحالي، والنسبة فوق سعر الشراء. ربح الفترة من مواد الإجراءات المقبوضة (بيوم القبض)
        ومواد جلسات الحديد (بيوم الجلسة)، بكلفة القطعة لحظة صرفها، فالشراء اللاحق لا يغيّر ربح ما بيع. جلسات الحديد قبل ١٤ تشرين الثاني ٢٠٢٦
        طُرحت موادّها بسعر الشراء فلا ربح لها.
      </p>
      {open && <MaterialProfitDialog row={open} query={query} onClose={() => setOpen(null)} />}
    </div>
  )
}

function MaterialProfitCard({ r, onOpen }) {
  const loss = r.unitProfit !== null && r.unitProfit <= 0
  return (
    <button type="button" className={`fx-mat${r.active ? '' : ' is-off'}`} onClick={onOpen}>
      <span className="fx-mat-top">
        <span className="fx-mat-name">
          <strong>{r.name}</strong> <span className="fx-unit">{r.unit}</span>
          {r.avgCost === null && <span className="invx-tag is-warn">بلا سعر شراء</span>}
          {loss && <span className="invx-tag is-bad">تُباع بخسارة</span>}
          {!r.active && <span className="invx-tag">موقوفة</span>}
        </span>
        {r.qty > 0 && r.profit !== null && <span className="fx-mat-profit"><span className="fo-muted">الربح</span> {signed(r.profit)}</span>}
      </span>
      <span className="fx-mat-prices">
        {r.avgCost === null ? <>سعر البيع <b>{fmtNum(r.unitPrice)}</b> · سعر الشراء غير مُدخَل</>
          : <>الشراء <b>{fmtNum(r.avgCost)}</b> ← البيع <b>{fmtNum(r.unitPrice)}</b> · <b>{signed(r.unitProfit)}</b> للقطعة
            {pctText(r.unitPct) && <span className="fx-pct">{pctText(r.unitPct)}</span>}</>}
      </span>
      <span className="fx-mat-stock">
        {r.qty > 0 ? <>بيع منها {qtyText(r.qty, r.unit)}</> : <span className="muted">لم تُبَع في الفترة</span>}
        {' · '}في المخزون {qtyText(r.balance, r.unit)}
        {r.balance > 0 && r.stockProfit !== null && <> (ربحه المتوقّع {signed(r.stockProfit)})</>}
      </span>
    </button>
  )
}

// ═══ مادةٌ واحدة: كلّ بيعة وكلّ شراء بالفترة ═══
export function MaterialProfitDialog({ row, query, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    api.clinic.materialProfit(row.id, query).then((d) => { if (live) setData(d) }).catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [row.id, JSON.stringify(query)]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = data?.material || row
  return (
    <Modal title={m.name} subtitle={data ? `الفترة: ${data.from === data.to ? data.from : `${data.from} ← ${data.to}`} · الوحدة: ${row.unit}` : row.unit} onClose={onClose} wide sheet>
      <div className="fx-dlg-tiles">
        <div><span className="fx-label">سعر الشراء</span><b>{m.avgCost === null ? '—' : fmtNum(m.avgCost)}</b></div>
        <div><span className="fx-label">سعر البيع</span><b>{fmtNum(m.unitPrice)}</b></div>
        <div><span className="fx-label">ربح القطعة</span><b>{m.unitProfit === null ? '—' : signed(m.unitProfit)}</b>
          {pctText(m.unitPct) && <span className="fx-pct">{pctText(m.unitPct)}</span>}</div>
        <div><span className="fx-label">الربح في الفترة</span><b>{m.profit === null ? '—' : signed(m.profit)}</b></div>
      </div>
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          {data.sales.length > 0 && <DailyChart daily={data.daily} title="ربحها اليومي" />}
          <h4 className="fx-dlg-h">المبيعات ({fmtInt(data.sales.length)})</h4>
          {data.sales.length === 0 ? <p className="empty">لم تُبَع في هذه الفترة.</p> : (
            <ul className="fx-sales">
              {data.sales.map((s) => (
                <li key={s.id}>
                  <div className="fx-sale-main">
                    <strong>{s.procedure}</strong>
                    <span className="fx-sub">{fmtDay(s.day)}{s.doctor && ` · ${s.doctor}`}{s.patient && ` · ${s.patient}`}</span>
                  </div>
                  <div className="fx-sale-nums">
                    <span>{qtyText(s.qty, row.unit)} × {fmtNum(s.unitPrice)} = <b>{fmtNum(s.sale)}</b></span>
                    <span className="fx-sub">
                      {s.cost === null ? 'الكلفة غير معروفة (لا سعر شراء)'
                        : <>الكلفة {fmtNum(s.cost)}{s.estimated && ' (تقديرية)'} · الربح <b className={s.profit < 0 ? 'neg' : ''}>{signed(s.profit)}</b></>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h4 className="fx-dlg-h">المشتريات ({fmtInt(data.purchases.length)})</h4>
          {data.purchases.length === 0 ? <p className="empty">لم تُشترَ في هذه الفترة.</p> : (
            <ul className="fx-sales">
              {data.purchases.map((p) => (
                <li key={p.id}>
                  <div className="fx-sale-main">
                    <strong>{p.kind === 'opening' ? 'رصيد افتتاحي' : 'شراء'}</strong>
                    <span className="fx-sub">{fmtDay(p.day)}{p.supplier && ` · ${p.supplier}`}{p.by && ` · ${p.by}`}</span>
                  </div>
                  <div className="fx-sale-nums">
                    <span>{qtyText(p.qty, row.unit)} × {p.unitCost === null ? '—' : fmtNum(p.unitCost)}
                      {p.total !== null && <> = <b>{fmtNum(p.total)}</b></>}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="bf-actions inv-actions"><button type="button" className="ghost" onClick={onClose}>إغلاق</button></div>
    </Modal>
  )
}
