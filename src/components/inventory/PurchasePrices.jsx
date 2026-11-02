import { useState } from 'react'
import { api, fmtMoney } from '../../api.js'
import { matchesAr } from '../../arabic-search.js'
import { EmptyState, fmtQty, materialsCount, parseNum } from './shared.jsx'

// ═══ أسعار الشراء ═══
// سعر شراء القطعة لكلّ مادة — أساس المتوسّط المرجّح الذي يحسب ربح المواد في «صندوق العيادات».
// الكتابة هنا للمواد الموجودة على الرفّ قبل الصندوق: تُكتب كما هي، **بلا حركة صرف** (لم تُشترَ
// الآن). والشراء الجديد يُحدّث السعر وحده بمزجه مع الموجود حسب الكمية.
// حفظٌ واحد لكلّ ما تغيّر، والفارغ لا يُرسل.
export default function PurchasePrices({ materials, canWrite, onSaved }) {
  const [vals, setVals] = useState({})
  const [query, setQuery] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const missing = materials.filter((m) => m.purchase_price === null).length
  const shown = materials.filter((m) => matchesAr(m.name, query) && (!onlyMissing || m.purchase_price === null))
  const changed = Object.entries(vals).filter(([id, v]) => {
    const m = materials.find((x) => String(x.id) === id)
    return String(v).trim() !== '' && parseNum(v) !== m?.purchase_price
  })
  const bad = changed.filter(([, v]) => Number.isNaN(parseNum(v)))

  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const r = await api.inventory.setPurchasePrices(changed.map(([id, price]) => ({ material_id: Number(id), price })))
      setVals({})
      onSaved(r)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (materials.length === 0) return <div className="card"><EmptyState text="لا مواد بعد." /></div>

  return (
    <div className="card">
      <div className="inv-toolbar">
        <h3 style={{ margin: 0 }}>أسعار الشراء</h3>
        <input type="search" className="inv-search" value={query} placeholder="ابحث في المواد…" aria-label="ابحث في المواد"
          onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="inv-modal-sub">
        سعر شراء القطعة (متوسّط مرجّح). كتابته هنا للمواد الموجودة لا تُخصم من صندوق العيادات —
        والشراء الجديد يُحدّثه وحده ويخصم مبلغه.
      </p>
      {missing > 0 && (
        <button type="button" className={`rev-flag${onlyMissing ? ' is-on' : ''}`} aria-pressed={onlyMissing}
          onClick={() => setOnlyMissing(!onlyMissing)}>
          بلا سعر شراء <span className="rev-flag-n">{missing.toLocaleString('ar-SY')}</span>
        </button>
      )}
      <table className="inv-table rtable" style={{ marginTop: 10 }}>
        <thead><tr><th>المادة</th><th>سعر البيع</th><th>الرصيد</th><th>سعر الشراء (القطعة)</th></tr></thead>
        <tbody>
          {shown.map((m) => {
            const v = vals[m.id] ?? (m.purchase_price === null ? '' : String(m.purchase_price))
            const invalid = String(v).trim() !== '' && Number.isNaN(parseNum(v))
            const loss = m.purchase_price !== null && m.purchase_price >= m.unit_price
            return (
              <tr key={m.id} className={m.is_active ? undefined : 'ro'}>
                <td className="rt-title">{m.name} <span className="inv-muted">— {m.unit}</span>
                  {!m.is_active && <span className="badge sm" style={{ marginInlineStart: 6 }}>غير مفعّلة</span>}</td>
                <td className="num" data-label="سعر البيع">{fmtMoney(m.unit_price)}</td>
                <td className={`num${m.balance < 0 ? ' neg' : ''}`} data-label="الرصيد" dir="ltr">{fmtQty(m.balance)}</td>
                <td data-label="سعر الشراء">
                  {canWrite ? (
                    <input className={`inv-count${invalid ? ' is-bad' : ''}`} value={v} inputMode="decimal" placeholder="—"
                      aria-label={`سعر شراء ${m.name}`} aria-invalid={invalid}
                      onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
                  ) : (m.purchase_price === null ? '—' : fmtMoney(m.purchase_price))}
                  {loss && <span className="badge bad sm" style={{ marginInlineStart: 6 }}
                    title="سعر البيع لا يغطّي سعر الشراء">بخسارة</span>}
                </td>
              </tr>
            )
          })}
          {shown.length === 0 && <tr><td colSpan={4} className="empty">لا مادة هنا.</td></tr>}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
      {canWrite && (
        <div className="bf-actions inv-actions">
          <span className="inv-muted">{changed.length ? `تغيّر ${materialsCount(changed.length)}` : ''}</span>
          <button type="button" disabled={busy || changed.length === 0 || bad.length > 0} onClick={save}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ الأسعار'}
          </button>
        </div>
      )}
    </div>
  )
}
