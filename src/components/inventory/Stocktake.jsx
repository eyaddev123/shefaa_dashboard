import { useState } from 'react'
import { api } from '../../api.js'
import { matchesAr } from '../../arabic-search.js'
import { EmptyState, REASONS, fmtQty, fmtSigned, materialsCount, parseNum } from './shared.jsx'

// ═══ تسوية الجرد ═══
// تُعبّأ المواد التي عُدّت فقط — الفارغ لا يُحسب. «احسب الفروقات» يسأل الخادم عن
// رصيد كلّ مادة الآن، والتأكيد يُرسل الرصيد الذي رأته المشرفة: إن تحرّك بينهما
// (إجراءٌ استهلك مادة) يرفض الخادم ويُعاد الحساب، فلا يُصحَّح فرقٌ على رقمٍ لم يُرَ.
export default function Stocktake({ materials, onDone, onAddMaterial }) {
  const [counts, setCounts] = useState({})
  const [query, setQuery] = useState('')
  const [diffs, setDiffs] = useState(null)       // { diffs, unchanged }
  const [reasons, setReasons] = useState({})     // id ⇒ { reason, note }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const active = materials.filter((m) => m.is_active)
  const shown = active.filter((m) => matchesAr(m.name, query))
  const filled = Object.entries(counts).filter(([, v]) => String(v).trim() !== '')
  const bad = filled.filter(([, v]) => Number.isNaN(parseNum(v)))

  const compute = async () => {
    setErr(null); setBusy(true)
    try {
      const r = await api.inventory.stocktakePreview(filled.map(([id, counted]) => ({ material_id: Number(id), counted })))
      setDiffs(r)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const confirm = async () => {
    setErr(null)
    const missing = diffs.diffs.find((d) => !reasons[d.material_id]?.reason
      || (reasons[d.material_id].reason === 'other' && !reasons[d.material_id].note?.trim()))
    if (missing) return setErr(`اختر سبب الفرق لـ«${missing.name}»${reasons[missing.material_id]?.reason === 'other' ? ' واكتبه' : ''}`)
    setBusy(true)
    try {
      const items = diffs.diffs.map((d) => ({
        material_id: d.material_id, counted: d.counted, expected: d.system,
        reason: reasons[d.material_id].reason, reason_note: reasons[d.material_id].note || '',
      }))
      const r = await api.inventory.stocktake(items)
      setCounts({}); setDiffs(null); setReasons({})
      onDone(r)
    } catch (ex) {
      // الرصيد تحرّك منذ الحساب: الفروق الجديدة من الخادم نفسه، والأسباب المكتوبة تبقى
      if (ex.data?.code === 'STOCK_CHANGED') setDiffs({ diffs: ex.data.diffs, unchanged: ex.data.unchanged })
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  if (active.length === 0) {
    return (
      <div className="card">
        <EmptyState text="لا مواد مفعّلة لجردها." hint="عرّف المواد أوّلاً أو استوردها من Excel.">
          <button type="button" onClick={onAddMaterial}>+ مادة</button>
        </EmptyState>
      </div>
    )
  }

  // ═══ الخطوة الثانية: الفروق وأسبابها ═══
  if (diffs) {
    const setR = (id, patch) => setReasons({ ...reasons, [id]: { ...reasons[id], ...patch } })
    return (
      <div className="card">
        <h3>الفروقات</h3>
        {diffs.diffs.length === 0 ? (
          <EmptyState text="لا فروق — العدد الفعلي يطابق رصيد النظام."
            hint={`${materialsCount(diffs.unchanged)} مطابقة.`}>
            <button type="button" className="ghost" onClick={() => setDiffs(null)}>رجوع</button>
          </EmptyState>
        ) : (
          <>
            <p className="inv-modal-sub">
              {materialsCount(diffs.diffs.length)} فيها فرق{diffs.unchanged ? `، و${materialsCount(diffs.unchanged)} مطابقة` : ''}.
              السبب إلزاميّ لكلّ مادة.
            </p>
            <table className="inv-table">
              <thead><tr><th>المادة</th><th>رصيد النظام</th><th>الفعلي</th><th>الفرق</th><th>السبب</th></tr></thead>
              <tbody>
                {diffs.diffs.map((d) => {
                  const r = reasons[d.material_id] || {}
                  return (
                    <tr key={d.material_id}>
                      <td>{d.name} <span className="inv-muted">— {d.unit}</span></td>
                      <td className="num" dir="ltr">{fmtQty(d.system)}</td>
                      <td className="num">{fmtQty(d.counted)}</td>
                      <td className={`num inv-qty${d.diff < 0 ? ' neg' : ''}`} dir="ltr">{fmtSigned(d.diff)}</td>
                      <td className="inv-reason-cell">
                        <select value={r.reason || ''} aria-label={`سبب فرق ${d.name}`}
                          onChange={(e) => setR(d.material_id, { reason: e.target.value })}>
                          <option value="">اختر السبب…</option>
                          {REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                        {r.reason === 'other' && (
                          <input value={r.note || ''} placeholder="اكتب السبب" aria-label={`نصّ سبب ${d.name}`}
                            onChange={(e) => setR(d.material_id, { note: e.target.value })} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
        {err && <p className="error">{err}</p>}
        {diffs.diffs.length > 0 && (
          <div className="bf-actions inv-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => { setDiffs(null); setErr(null) }}>رجوع للتعديل</button>
            <button type="button" disabled={busy} onClick={confirm}>{busy ? 'جارٍ التسجيل…' : 'تأكيد التسوية'}</button>
          </div>
        )}
      </div>
    )
  }

  // ═══ الخطوة الأولى: العدد الفعلي ═══
  return (
    <div className="card">
      <div className="inv-toolbar">
        <h3 style={{ margin: 0 }}>العدد الفعلي</h3>
        <input type="search" className="inv-search" value={query} placeholder="ابحث في المواد…" aria-label="ابحث في المواد"
          onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="inv-modal-sub">اكتب العدد للمواد التي عددتها فقط — السطور الفارغة لا تُحسب.</p>
      <table className="inv-table">
        <thead><tr><th>المادة</th><th>الوحدة</th><th>رصيد النظام</th><th>العدد الفعلي</th></tr></thead>
        <tbody>
          {shown.map((m) => {
            const v = counts[m.id] ?? ''
            const invalid = v.trim() !== '' && Number.isNaN(parseNum(v))
            return (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.unit}</td>
                <td className={`num${m.balance < 0 ? ' neg' : ''}`} dir="ltr">{fmtQty(m.balance)}</td>
                <td><input className={`inv-count${invalid ? ' is-bad' : ''}`} value={v} inputMode="decimal"
                  aria-label={`العدد الفعلي لـ${m.name}`} aria-invalid={invalid}
                  onChange={(e) => setCounts({ ...counts, [m.id]: e.target.value })} /></td>
              </tr>
            )
          })}
          {shown.length === 0 && <tr><td colSpan={4} className="empty">لا مادة بهذا الاسم.</td></tr>}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
      <div className="bf-actions inv-actions">
        <span className="inv-muted">{filled.length ? `عُبّئ ${materialsCount(filled.length)}` : ''}</span>
        <button type="button" disabled={busy || filled.length === 0 || bad.length > 0} onClick={compute}>
          {busy ? 'جارٍ الحساب…' : 'احسب الفروقات'}
        </button>
      </div>
    </div>
  )
}
