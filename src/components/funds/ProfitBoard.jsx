import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api.js'
import { Modal, fmtDay } from '../inventory/shared.jsx'

// ═══ ربح المواد بين الشراء والبيع — قلب صفحة الصندوق (2026-11-14، قرارات المستخدم) ═══
// ربح القطعة ونسبته · ربح المخزون الموجود · كلّ بيعة بتفاصيلها (بالكبس على المادة) · ربح كلّ يوم برسم.
// مواد الإجراءات وحدها: مواد الحديد بسعر الشراء فربحها صفر (القرار). الحساب كلّه بالخادم
// (buildProfitBoard) — هنا عرضٌ وترتيبٌ وبحثٌ محلّي. والنسبة فوق سعر الشراء: ربح ٤٠ على ١٨٠ = ٢٢٪.
// الشكل كشبكة المخزون: بطاقاتٌ محايدة بلا «برقعة ألوان»، وشارةٌ صغيرة للمشكلة وحدها.

export const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 0 })
export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
const pctText = (p) => (p === null || p === undefined ? null : `${Number(p).toLocaleString('ar-SY', { maximumFractionDigits: 1 })}٪`)
const qtyText = (q, unit) => `${fmtNum(q)} ${unit}`
// «١٤ تشرين الثاني» للأيام و«تشرين الثاني» للأشهر
const shortDay = (k) => new Date(`${k.length === 7 ? `${k}-01` : k}T00:00:00`)
  .toLocaleDateString('ar-SY', k.length === 7 ? { month: 'long' } : { day: 'numeric', month: 'long' })

// ═══ البطاقات العلوية: ربح الفترة · المخزون ═══
export function ProfitHero({ data }) {
  const t = data.totals, s = data.stock
  return (
    <>
      <div className="fx-hero-card">
        <span className="fx-label">ربح المواد بهالفترة</span>
        <strong className={`fx-big${t.profit < 0 ? ' neg' : ''}`}>{signed(t.profit)}<span className="cash-unit">ل.س</span></strong>
        <span className="fx-line">
          {pctText(t.pct) ? <>{pctText(t.pct)} فوق سعر الشراء</> : 'ما انباع شي بسعر شراء معروف'}
        </span>
        <span className="fx-sub">بعنا بـ {fmtNum(t.sales)} · كلّفت {fmtNum(t.cost)}</span>
      </div>
      <div className="fx-hero-card">
        <span className="fx-label">المخزون الموجود هلأ</span>
        <strong className="fx-big">{signed(s.profit)}<span className="cash-unit">ل.س</span></strong>
        <span className="fx-line">ربح جاي لما ينباع كلّه{pctText(s.pct) && ` (${pctText(s.pct)})`}</span>
        <span className="fx-sub">كلّفنا {fmtNum(s.cost)} · بينباع بـ {fmtNum(s.sale)}</span>
        {s.unpriced > 0 && <span className="invx-tag is-warn fx-hero-tag">{fmtInt(s.unpriced)} بلا سعر شراء — خارج الحساب</span>}
      </div>
    </>
  )
}

// ═══ الرسم: عمودٌ لكلّ يوم (أو شهر) — البيع خفيف خلف الربح ═══
export function DailyChart({ daily, title = 'ربح كل يوم' }) {
  const [hover, setHover] = useState(null)
  const pts = daily.points
  const max = Math.max(1, ...pts.map((p) => Math.max(p.sales, Math.abs(p.profit))))
  const any = pts.some((p) => p.sales > 0)
  const shown = hover !== null ? pts[hover] : null
  const step = Math.ceil(pts.length / 8)   // تسمياتٌ قليلة تحت الأعمدة: لا تتزاحم على الجوال
  return (
    <div className="fx-chart-wrap">
      <div className="fx-chart-head">
        <h3>{daily.unit === 'month' ? 'ربح كل شهر' : title}</h3>
        <span className="fx-chart-read" aria-live="polite">
          {shown ? <><strong>{shortDay(shown.key)}</strong> · بعنا {fmtNum(shown.sales)} · ربحنا {signed(shown.profit)}</>
            : any ? 'مرّر أو المس عموداً لتشوف رقمه' : 'ما انباع شي بهالفترة'}
        </span>
      </div>
      <div className="fx-chart" role="img" aria-label={`ربح المواد ${pts.length} ${daily.unit === 'month' ? 'شهر' : 'يوم'}`}
        onMouseLeave={() => setHover(null)}>
        {pts.map((p, i) => (
          <button type="button" key={p.key} className={`fx-col${hover === i ? ' on' : ''}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
            aria-label={`${shortDay(p.key)}: بعنا ${fmtNum(p.sales)}، ربحنا ${fmtNum(p.profit)}`}>
            <span className="fx-bar fx-bar-sale" style={{ height: `${(p.sales / max) * 100}%` }} />
            <span className={`fx-bar fx-bar-profit${p.profit < 0 ? ' neg' : ''}`} style={{ height: `${(Math.abs(p.profit) / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="fx-chart-axis" aria-hidden="true">
        {pts.map((p, i) => <span key={p.key}>{i % step === 0 ? shortDay(p.key) : ''}</span>)}
      </div>
      <div className="fx-legend" aria-hidden="true">
        <span><i className="fx-key fx-key-sale" />البيع</span><span><i className="fx-key fx-key-profit" />الربح</span>
      </div>
    </div>
  )
}

// ═══ بطاقات المواد: ترتيب وبحث وفلتر ═══
const SORTS = [
  ['profit', 'الأربح بالفترة', (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity)],
  ['pct', 'أعلى نسبة', (a, b) => (b.unitPct ?? -Infinity) - (a.unitPct ?? -Infinity)],
  ['low', 'الأقل ربحاً', (a, b) => (a.unitPct ?? Infinity) - (b.unitPct ?? Infinity)],
  ['qty', 'الأكثر مبيعاً', (a, b) => b.qty - a.qty],
  ['stock', 'ربح المخزون', (a, b) => (b.stockProfit ?? -Infinity) - (a.stockProfit ?? -Infinity)],
  ['name', 'الأبجدية', (a, b) => a.name.localeCompare(b.name, 'ar')],
]
const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()

export function MaterialsProfit({ data, query }) {
  const [sort, setSort] = useState('profit')
  const soldCount = data.rows.filter((r) => r.qty > 0).length
  // ٤٤ مادة وأغلبها ما انباع بالفترة: يبدأ باللي انباع (إن وُجد)، والكبسة تُري الكلّ ومخزونها
  const [onlySold, setOnlySold] = useState(soldCount > 0)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const list = useMemo(() => {
    const cmp = SORTS.find(([k]) => k === sort)[2]
    const nq = norm(q)
    return data.rows.filter((r) => (!onlySold || r.qty > 0) && (!nq || norm(r.name).includes(nq)))
      .sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'ar'))
  }, [data.rows, sort, onlySold, q])

  return (
    <div className="card fx-card">
      <div className="fx-mat-head">
        <h3>المواد — منشتري بكم ومنبيع بكم</h3>
        <input className="fx-search" type="search" placeholder="دوّر على مادة…" value={q} onChange={(e) => setQ(e.target.value)}
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
          بس اللي انباع بهالفترة ({fmtInt(soldCount)})
        </label>
      </div>
      {list.length === 0 ? <p className="empty">{q ? 'ما في مادة بهالاسم.' : onlySold ? 'ما انباع شي بهالفترة.' : 'لا مواد بعد.'}</p> : (
        <div className="fx-grid">
          {list.map((r) => <MaterialProfitCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
        </div>
      )}
      {data.missing > 0 && (
        <p className="share-warn">⚠ {data.missing === 1 ? 'مادةٌ وحدة انباعت' : `${fmtInt(data.missing)} مواد انباعت`} بلا سعر شراء — بيعها محسوب وربحها لا.
          اكتب سعر شرائها من صفحة المخزون.</p>
      )}
      <p className="earn-note">
        ربح القطعة = سعر البيع هلأ − متوسّط سعر الشراء هلأ، والنسبة فوق سعر الشراء. ربح الفترة من مواد الإجراءات المقبوضة (بيوم القبض)
        بكلفة القطعة لحظة ما انضافت على الإجراء — فشراءٌ لاحق ما بيغيّر ربح شي انباع. مواد جلسات الحديد بتنطرح بسعر الشراء فما إلها ربح،
        وفاضل الحديد بيبيّن بحركات الصندوق. المستهلكات بتبويبها.
      </p>
      {open && <MaterialProfitDialog row={open} query={query} onClose={() => setOpen(null)} />}
    </div>
  )
}

function MaterialProfitCard({ r, onOpen }) {
  const loss = r.unitProfit !== null && r.unitProfit <= 0
  return (
    <button type="button" className={`fx-mat${r.active ? '' : ' is-off'}`} onClick={onOpen}>
      <span className="fx-mat-name">
        <strong>{r.name}</strong> <span className="fx-unit">{r.unit}</span>
        {r.avgCost === null && <span className="invx-tag is-warn">بلا سعر شراء</span>}
        {loss && <span className="invx-tag is-bad">عم تنباع بخسارة</span>}
        {r.estimated && <span className="invx-tag is-warn" title="انباعت قبل تثبيت الكلفة — قُدّرت بسعر الشراء الحالي">تقديري</span>}
        {!r.active && <span className="invx-tag">موقوفة</span>}
      </span>
      <span className="fx-mat-prices">
        <span>منشتريها بـ <b>{r.avgCost === null ? '—' : fmtNum(r.avgCost)}</b></span>
        <span>منبيعها بـ <b>{fmtNum(r.unitPrice)}</b></span>
      </span>
      <span className="fx-mat-unit">
        {r.unitProfit === null ? <span className="muted">ربح القطعة: بدّه سعر شراء</span>
          : <>ربح القطعة <b>{signed(r.unitProfit)}</b>{pctText(r.unitPct) && <span className="fx-pct">{pctText(r.unitPct)}</span>}</>}
      </span>
      <span className="fx-mat-period">
        {r.qty > 0
          ? <>بهالفترة انباع {qtyText(r.qty, r.unit)} · {r.profit === null ? 'ربحها بدّه سعر شراء' : <>ربحنا <b>{signed(r.profit)}</b></>}</>
          : <span className="muted">ما انباعت بهالفترة</span>}
      </span>
      <span className="fx-mat-stock">
        الموجود {qtyText(r.balance, r.unit)}
        {r.balance > 0 && r.stockProfit !== null && <> · لما ينباع <b>{signed(r.stockProfit)}</b></>}
      </span>
    </button>
  )
}

// ═══ مادةٌ واحدة: كلّ بيعة وكلّ شراء بالفترة ═══
function MaterialProfitDialog({ row, query, onClose }) {
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
        <div><span className="fx-label">منشتريها بـ</span><b>{m.avgCost === null ? '—' : fmtNum(m.avgCost)}</b></div>
        <div><span className="fx-label">منبيعها بـ</span><b>{fmtNum(m.unitPrice)}</b></div>
        <div><span className="fx-label">ربح القطعة</span><b>{m.unitProfit === null ? '—' : signed(m.unitProfit)}</b>
          {pctText(m.unitPct) && <span className="fx-pct">{pctText(m.unitPct)}</span>}</div>
        <div><span className="fx-label">ربحنا بالفترة</span><b>{m.profit === null ? '—' : signed(m.profit)}</b></div>
      </div>
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          {data.sales.length > 0 && <DailyChart daily={data.daily} title="ربحها كل يوم" />}
          <h4 className="fx-dlg-h">كل بيعة ({fmtInt(data.sales.length)})</h4>
          {data.sales.length === 0 ? <p className="empty">ما انباعت بهالفترة.</p> : (
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
                      {s.cost === null ? 'كلفتها مجهولة (بلا سعر شراء)'
                        : <>كلّفت {fmtNum(s.cost)}{s.estimated && ' (تقديري)'} · ربح <b className={s.profit < 0 ? 'neg' : ''}>{signed(s.profit)}</b></>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h4 className="fx-dlg-h">كل شراء ({fmtInt(data.purchases.length)})</h4>
          {data.purchases.length === 0 ? <p className="empty">ما انشرت بهالفترة.</p> : (
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
      <div className="bf-actions inv-actions"><button type="button" className="ghost" onClick={onClose}>سكّر</button></div>
    </Modal>
  )
}
