import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtDateTime } from '../../api.js'
import { fmtDay, fmtQty, stockWords } from './shared.jsx'

// ═══ صفحة المادة — «نفض» 2026-11-12 (قرار المستخدم: مربّعات + قصّة واحدة) ═══
// فوق: مربّعاتٌ كبيرة بكلّ رقمٍ يهمّ، وجنب كلّ رقمٍ يُعدَّل زرّه ظاهراً («تغيير السعر» لا رابطٌ صغير).
// تحت: «شو صار عليها» — قائمةٌ واحدة بالكلام العادي تجمع كشف الحركات وسجلّ سعر البيع وسجلّ سعر
// الشراء، مع مين وإيمتى وليش. الحركات بصفحات من الخادم، والسجلّان كاملان: تغييرات السعر تظهر حتى
// أقدم حركةٍ محمّلة، وكلّها حين لا يبقى شيء.

const PER = 30
const REASON_WORDS = { damaged: 'تالف', expired: 'منتهي الصلاحية', lost: 'ضايع', entry_error: 'غلط بالتسجيل', other: 'غير ذلك' }

// يوم الحدث بتوقيت الجهاز (لا UTC) — مفتاح الترتيب مع الحركات التي يومها movement_date
const localDay = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** حدثٌ واحد بالكلام العادي: { tone, icon, title, details[] } */
function describe(e, unit) {
  const q = (n) => `${fmtQty(Math.abs(n))} ${unit}`
  if (e.kind === 'price') {
    return { tone: 'info', icon: '₤', title: `تغيّر سعر البيع: ${fmtMoney(e.old_price)} ← ${fmtMoney(e.new_price)}`,
      details: [e.note && `«${e.note}»`, 'بيمشي على اللي بينضاف من بعدها، والقديم بيضل بسعره'] }
  }
  if (e.kind === 'cost') {
    return { tone: 'info', icon: '₤', title: `تغيّر سعر الشراء: ${e.old_cost === null ? 'ما كان مكتوب' : fmtMoney(e.old_cost)} ← ${fmtMoney(e.new_cost)}`,
      details: ['انكتب باليد — ما انخصم شي من الصندوق'] }
  }
  switch (e.type) {
    case 'purchase': {
      const total = e.unit_cost !== null ? e.unit_cost * e.quantity : null
      return { tone: 'good', icon: '+', title: `اشترينا ${q(e.quantity)}`,
        details: [e.supplier && `من ${e.supplier}`, e.unit_cost !== null && `بـ ${fmtMoney(e.unit_cost)} للواحدة${total !== null ? ` — المجموع ${fmtMoney(total)}` : ''}`, e.note] }
    }
    case 'opening':
      return { tone: 'good', icon: '+', title: `كانت موجودة ${q(e.quantity)} — رصيد البداية`,
        details: [e.unit_cost !== null && `بسعر شراء ${fmtMoney(e.unit_cost)} للواحدة`, e.supplier && `من ${e.supplier}`, e.note] }
    case 'consumption':
      return { tone: 'out', icon: '−', title: `استُعملت ${q(e.quantity)}${e.procedure_name ? ` — ${e.procedure_name}` : ''}`,
        details: [e.doctor_name && `عند ${e.doctor_name}`, e.patient_name && `للمريض ${e.patient_name}`] }
    case 'iron_return':
      return { tone: 'good', icon: '+', title: `رجعت ${q(e.quantity)} من جلسة حديد انلغت`, details: [e.patient_name && `للمريض ${e.patient_name}`, e.note] }
    case 'adjustment':
      return { tone: 'warn', icon: '≈', title: `صحّحنا العدد بعد الجرد: ${e.quantity > 0 ? 'زادت' : 'نقصت'} ${q(e.quantity)}`,
        // ملاحظة الجرد الآلية («جرد: النظام … — الفعلي …») تكرارٌ للعنوان بأرقامٍ لاتينية: لا تُعرض
        details: [e.reason && `السبب: ${REASON_WORDS[e.reason] || e.reason_label}${e.reason_note ? ` — ${e.reason_note}` : ''}`, e.note && !/^جرد:/.test(e.note) && e.note] }
    default:
      return { tone: 'info', icon: '•', title: `${e.quantity > 0 ? '+' : '−'}${q(e.quantity)}`, details: [e.note] }
  }
}

function Story({ material, refreshKey, canWrite, onPurchase }) {
  const [pages, setPages] = useState(1)
  const [moves, setMoves] = useState(null)       // { rows, total }
  const [changes, setChanges] = useState(null)   // [{kind:'price'|'cost', ...}]
  const [err, setErr] = useState(null)
  useEffect(() => { setPages(1) }, [material.id, refreshKey])
  useEffect(() => {
    let alive = true
    Promise.all([
      Promise.all(Array.from({ length: pages }, (_, i) => api.inventory.movements(material.id, i + 1, PER))),
      api.inventory.prices(material.id),
      api.inventory.costChanges(material.id).catch(() => []),
    ]).then(([ps, prices, costs]) => {
      if (!alive) return
      setMoves({ rows: ps.flatMap((p) => p.rows), total: ps[0]?.total ?? 0 })
      setChanges([...prices.map((p) => ({ ...p, kind: 'price' })), ...costs.map((c) => ({ ...c, kind: 'cost' }))])
      setErr(null)
    }).catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [material.id, pages, refreshKey])

  if (err) return <p className="error">{err}</p>
  if (!moves || !changes) return <p className="empty">جارٍ التحميل…</p>

  const more = moves.rows.length < moves.total
  const oldest = moves.rows.length ? moves.rows[moves.rows.length - 1].movement_date : null
  const events = [
    ...moves.rows.map((m) => ({ ...m, kind: 'move', day: m.movement_date, at: m.created_at })),
    // ما قبل أقدم حركةٍ محمّلة ينتظر «عرض الأقدم» — كي لا يظهر تغيير سعرٍ في غير مكانه
    ...changes.map((c) => ({ ...c, day: localDay(c.created_at), at: c.created_at }))
      .filter((c) => !more || !oldest || c.day >= oldest),
  ].sort((a, b) => (a.day === b.day ? String(b.at).localeCompare(String(a.at)) : b.day.localeCompare(a.day)))

  if (events.length === 0) {
    return (
      <div className="invx-story-empty">
        <p>ما صار شي على هالمادة لسّا.</p>
        <p className="invx-muted">الشراء بيزيدها، والإجراءات اللي بتستعملها بتنقصها لحالها.</p>
        {canWrite && material.is_active && <button type="button" onClick={onPurchase}>تسجيل شراء</button>}
      </div>
    )
  }
  return (
    <>
      <ol className="invx-story">
        {events.map((e) => {
          const d = describe(e, material.unit)
          return (
            <li key={`${e.kind}-${e.id}`} className={`invx-event tone-${d.tone}`}>
              <span className="invx-event-icon" aria-hidden="true">{d.icon}</span>
              <div className="invx-event-body">
                <div className="invx-event-title">{d.title}</div>
                {d.details.filter(Boolean).map((x) => <div key={x} className="invx-event-detail">{x}</div>)}
                <div className="invx-event-meta">
                  {e.kind === 'move' ? fmtDay(e.movement_date) : fmtDateTime(e.created_at)}
                  {e.created_by_name && <> — {e.created_by_name}</>}
                </div>
              </div>
              {e.kind === 'move' && (
                <div className={`invx-event-after${e.balance_after < 0 ? ' neg' : ''}`}>
                  <span>صار الموجود</span><strong><bdi dir="ltr">{fmtQty(e.balance_after)}</bdi></strong>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {more && (
        <button type="button" className="ghost invx-older" onClick={() => setPages((p) => p + 1)}>
          عرض الأقدم ({(moves.total - moves.rows.length).toLocaleString('ar-SY')} حركة كمان)
        </button>
      )}
    </>
  )
}

function Tile({ label, value, sub, warn, action, onAction, big, tone }) {
  return (
    <div className={`invx-tile${big ? ' is-big' : ''}${tone ? ` tone-${tone}` : ''}`}>
      <span className="invx-tile-label">{label}</span>
      <span className="invx-tile-value">{value}</span>
      {sub && <span className="invx-tile-sub">{sub}</span>}
      {warn && <span className="invx-tile-warn" role="note">⚠ {warn}</span>}
      {action && <button type="button" className="ghost invx-tile-btn" onClick={onAction}>✎ {action}</button>}
    </div>
  )
}

/** صفحة المادة: رأسٌ بالاسم والحالة والأفعال، مربّعات الأرقام، ثمّ «شو صار عليها» */
export default function MaterialCard({ id, refreshKey, canWrite, onBack, onPurchase, onEdit, onEditPrice, onEditCost, onEditAlert, onCount }) {
  const [m, setM] = useState(null)
  const [err, setErr] = useState(null)
  const [lastPrice, setLastPrice] = useState(null)
  useEffect(() => {
    api.inventory.material(id).then((r) => { setM(r); setErr(null) }).catch((e) => setErr(e.message))
    api.inventory.prices(id).then((r) => setLastPrice(r[0] || null)).catch(() => setLastPrice(null))
  }, [id, refreshKey])

  if (err) return <><button type="button" className="link-btn invx-back" onClick={onBack}>→ كل المواد</button><p className="error">{err}</p></>
  if (!m) return <p className="empty">جارٍ التحميل…</p>
  const w = stockWords(m)
  const cons = m.material_kind === 'consumable'
  const write = canWrite && m.is_active
  return (
    <>
      <button type="button" className="link-btn invx-back" onClick={onBack}>→ كل المواد</button>
      <div className="card invx-mhead">
        <div className="invx-mhead-main">
          <h2 className="invx-mtitle">{m.name}</h2>
          <div className="invx-mtags">
            <span className={`invx-pill tone-${w.tone}`}><span className="invx-dot" aria-hidden="true" />{w.label}</span>
            <span className="invx-muted">الوحدة: {m.unit}</span>
          </div>
        </div>
        {canWrite && (
          <div className="invx-mhead-actions">
            {m.is_active && <button type="button" className="invx-primary" onClick={() => onPurchase(m)}>تسجيل شراء</button>}
            <button type="button" className="ghost" onClick={() => onEdit(m)}>تعديل الاسم والوحدة</button>
          </div>
        )}
      </div>

      {cons && (
        <p className="invx-explain invx-explain-card">
          هالمادة استهلاكية (متل القطن والشاش): ما بتنعدّ ولا بتنباع بسعر، وما بتنختار على الإجراء. مشترياتها بتنخصم من
          صندوق العيادات، وقيمتها محسوبة على نوع الإجراء («المستهلكات» بصفحة الإجراءات).
        </p>
      )}

      <div className={`invx-tiles${cons ? ' is-few' : ''}`}>
        {!cons && (
          <Tile big tone={w.tone} label="الموجود هلأ"
            value={<><bdi dir="ltr">{fmtQty(m.balance)}</bdi> <small>{m.unit}</small></>}
            sub={w.tone === 'good' ? null : w.text}
            action={write ? 'صحّحي العدد' : null} onAction={() => onCount(m)} />
        )}
        {!cons && (
          <Tile label="سعر البيع للمريض" value={fmtMoney(m.unit_price)}
            sub={lastPrice ? `آخر تغيير ${fmtDateTime(lastPrice.created_at)}${lastPrice.created_by_name ? ` — ${lastPrice.created_by_name}` : ''}` : 'ما تغيّر من وقت ما انضافت'}
            warn={m.selling_at_loss ? 'عم تنباع بأقلّ من سعر شرائها' : null}
            action={write ? 'تغيير السعر' : null} onAction={() => onEditPrice(m)} />
        )}
        {/* المتوسّط المرجّح قد يكون بكسور (١٩٧٫١٤): يُعرض مقرّباً بكلمة «حوالي» كي لا يبدو خطأً */}
        <Tile label="سعر الشراء (للواحدة)"
          value={m.purchase_price === null ? <span className="invx-tile-none">ما انكتب</span>
            : Number.isInteger(m.purchase_price) ? fmtMoney(m.purchase_price) : <><small>حوالي</small> {fmtMoney(Math.round(m.purchase_price))}</>}
          sub={[m.purchase_price !== null && !Number.isInteger(m.purchase_price) && 'متوسّط الشراءات',
            m.last_cost === null ? 'ما في شراء مسجّل لسّا' : `آخر شراء بـ ${fmtMoney(m.last_cost)}${m.last_cost_date ? ` — ${fmtDay(m.last_cost_date)}` : ''}`].filter(Boolean).join(' — ')}
          warn={m.purchase_price === null && !cons && m.is_active ? 'بيلزم لنعرف الربح ولتنحسب بجلسات الحديد صح' : null}
          action={write ? (m.purchase_price === null ? 'اكتبي السعر' : 'تغيير') : null} onAction={() => onEditCost(m)} />
        {!cons && (
          <Tile label="نبّهيني لما توصل لـ"
            value={m.min_quantity ? <><bdi dir="ltr">{fmtQty(m.min_quantity)}</bdi> <small>{m.unit}</small></> : <span className="invx-tile-none">ما في تنبيه</span>}
            sub={m.min_quantity ? 'بتطلع «قرّبت تخلص» وبيوصلك إشعار' : 'ما رح ننبّهك مهما نقصت'}
            action={write ? 'تغيير' : null} onAction={() => onEditAlert(m)} />
        )}
      </div>
      {!cons && m.stock_value !== null && (
        <p className="invx-footnote invx-mvalue">قيمة الموجود بسعر الشراء: <strong>{fmtMoney(m.stock_value)}</strong></p>
      )}

      <div className="card invx-story-card">
        <h3 className="invx-story-title">شو صار عليها</h3>
        <p className="invx-muted invx-story-hint">كل شراء واستعمال وجرد وتغيير سعر — الأحدث فوق، ومع كل وحدة مين عملها وإيمتى.</p>
        <Story material={m} refreshKey={refreshKey} canWrite={canWrite} onPurchase={() => onPurchase(m)} />
      </div>
    </>
  )
}
