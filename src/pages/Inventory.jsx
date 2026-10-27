import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtMoney } from '../api.js'
import { matchesAr } from '../arabic-search.js'
import { useToast } from '../action-feedback.jsx'
import { EmptyState, fmtQty, materialsCount, stockStatus } from '../components/inventory/shared.jsx'
import {
  ImportDialog, LossDialog, MaterialDialog, PriceDialog, PurchaseDialog,
} from '../components/inventory/InventoryDialogs.jsx'
import MaterialCard from '../components/inventory/MaterialCard.jsx'
import Stocktake from '../components/inventory/Stocktake.jsx'
import Reports from '../components/inventory/Reports.jsx'

// ═══ المخزون — دفتر حركات المواد ═══
// الرصيد مجموع الحركات: الشراء يُدخل، ومواد الإجراءات تُخرج تلقائياً، والجرد يصحّح.
// مشرفة العيادات وحدها (الخادم يردّ 403 لغيرها)؛ الاستقبال والطبيب لا يتغيّر عليهما شيء.

const TABS = [['materials', 'المواد'], ['stocktake', 'تسوية جرد'], ['reports', 'التقارير']]
const FILTERS = [['all', 'الكل'], ['low', 'تحتاج شراء'], ['inactive', 'غير مفعّلة']]

function MaterialsTable({ data, onOpen, onPurchase, onEdit, onAdd, onImport, onBuyAny }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const { materials, summary } = data

  const shown = materials.filter((m) => matchesAr(m.name, query)
    && (filter === 'all' || (filter === 'low' ? m.needs_purchase : !m.is_active)))

  return (
    <div className="card">
      <div className="inv-toolbar">
        <div className="inv-actions-top">
          <button type="button" onClick={onBuyAny}>تسجيل شراء</button>
          <button type="button" className="ghost" onClick={onAdd}>+ مادة</button>
          <button type="button" className="ghost" onClick={onImport}>استيراد Excel</button>
        </div>
        {materials.length > 0 && (
          <div className="inv-filters">
            <input type="search" className="inv-search" value={query} placeholder="ابحث بالاسم…" aria-label="ابحث بالاسم"
              onChange={(e) => setQuery(e.target.value)} />
            <div className="inv-chips" role="group" aria-label="تصفية">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k}
                  className={`rev-flag${filter === k ? ' is-on' : ''}`} onClick={() => setFilter(k)}>
                  {label}
                  {k === 'low' && summary.needs_purchase > 0 && <span className="rev-flag-n">{summary.needs_purchase.toLocaleString('ar-SY')}</span>}
                  {k === 'inactive' && summary.inactive > 0 && <span className="rev-flag-n">{summary.inactive.toLocaleString('ar-SY')}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {summary.needs_purchase > 0 && filter !== 'low' && (
        <button type="button" className="inv-banner" onClick={() => setFilter('low')}>
          {materialsCount(summary.needs_purchase)} {summary.needs_purchase === 1 ? 'وصلت' : summary.needs_purchase === 2 ? 'وصلتا' : 'وصلت'} للحدّ الأدنى
          <span className="inv-banner-link">اعرضها</span>
        </button>
      )}

      {materials.length === 0 ? (
        <EmptyState text="لا مواد بعد."
          hint="عرّف المواد واحدةً واحدة، أو استوردها كلّها من ملف Excel بأرصدتها الحالية.">
          <button type="button" onClick={onImport}>استيراد Excel</button>
          <button type="button" className="ghost" onClick={onAdd}>+ مادة</button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState text={filter === 'low' ? 'لا مادة تحتاج شراء الآن.' : filter === 'inactive' ? 'لا مواد غير مفعّلة.' : 'لا مادة بهذا الاسم.'}>
          <button type="button" className="ghost" onClick={() => { setQuery(''); setFilter('all') }}>عرض الكل</button>
        </EmptyState>
      ) : (
        <table className="inv-table inv-materials rtable">
          <thead><tr>
            <th>المادة</th><th>الوحدة</th><th>الرصيد</th><th>القيمة</th><th>سعر البيع</th><th>الحدّ الأدنى</th><th>الحالة</th><th></th>
          </tr></thead>
          <tbody>
            {shown.map((m) => {
              const st = stockStatus(m)
              return (
                <tr key={m.id} className={`clickable${m.is_active ? '' : ' proc-inactive'}`} onClick={() => onOpen(m.id)}>
                  <td className="inv-name rt-title">{m.name}</td>
                  <td data-label="الوحدة">{m.unit}</td>
                  <td className={`num inv-balance${m.balance < 0 ? ' neg' : ''}`} data-label="الرصيد">
                    <bdi dir="ltr">{fmtQty(m.balance)}</bdi></td>
                  <td className="num" data-label="القيمة">{m.stock_value === null ? '—' : fmtMoney(m.stock_value)}</td>
                  <td className="num" data-label="سعر البيع">{fmtMoney(m.unit_price)}</td>
                  <td className="num" data-label="الحدّ الأدنى">{m.min_quantity ? fmtQty(m.min_quantity) : '—'}</td>
                  <td className="rt-badge">
                    <div className="inv-status">
                      <span className={`badge sm ${st.cls}`}>{st.label}</span>
                      {m.selling_at_loss && m.is_active && <span className="badge sm bad">بيع بخسارة</span>}
                    </div>
                  </td>
                  <td className="inv-row-actions rt-actions" onClick={(e) => e.stopPropagation()}>
                    {m.is_active && <button type="button" className="ghost" onClick={() => onPurchase(m)}>شراء</button>}
                    <button type="button" className="ghost" onClick={() => onOpen(m.id)}>الكرت</button>
                    <button type="button" className="ghost" onClick={() => onEdit(m)}>تعديل</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {materials.length > 0 && (
        <p className="inv-footnote">
          قيمة المخزون بسعر آخر شراء: <strong>{fmtMoney(summary.stock_value)}</strong>
          <span className="inv-muted"> — المواد بلا سعر شراء لا تدخل فيها.</span>
        </p>
      )}
    </div>
  )
}

export default function Inventory() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('materials')
  const [data, setData] = useState(null)
  const [units, setUnits] = useState([])
  const [err, setErr] = useState(null)
  const [dialog, setDialog] = useState(null)   // { kind, material?, warning? }
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, showToast] = useToast()
  const openId = params.get('material')

  const load = useCallback(() => Promise.all([api.inventory.materials(), api.inventory.units()])
    .then(([d, u]) => { setData(d); setUnits(u); setErr(null) })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  const refresh = () => { load(); setRefreshKey((k) => k + 1) }
  const close = () => setDialog(null)
  const openCard = (id) => { setTab('materials'); setParams({ material: String(id) }) }
  const backToList = () => setParams({})

  const afterPurchase = (r, m) => {
    refresh()
    showToast(`سُجّل الشراء — رصيد «${r.material_name}» صار ${fmtQty(r.balance)} ${r.unit}`, 'success', 5000)
    if (r.loss_warning) setDialog({ kind: 'loss', material: m, warning: r.loss_warning, name: r.material_name, unit: r.unit })
    else close()
  }

  if (err && !data) return <><h2>المخزون</h2><p className="error">{err}</p></>
  if (!data) return <><h2>المخزون</h2><p className="empty">جارٍ التحميل…</p></>

  return (
    <>
      <h2>المخزون</h2>
      <p className="subtitle">
        الرصيد مجموع حركات كلّ مادة: الشراء يُدخل، والمواد المضافة على الإجراءات تُخرج تلقائياً، والجرد يصحّح.
      </p>
      {toast}

      <div className="inline proc-tabs inv-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? '' : 'ghost'}
            onClick={() => { setTab(k); if (openId) backToList() }}>{label}</button>
        ))}
      </div>

      {tab === 'materials' && (openId ? (
        <MaterialCard id={openId} refreshKey={refreshKey} onBack={backToList}
          onPurchase={(m) => setDialog({ kind: 'purchase', material: m })}
          onEdit={(m) => setDialog({ kind: 'edit', material: m })}
          onEditPrice={(m) => setDialog({ kind: 'price', material: m })} />
      ) : (
        <MaterialsTable data={data} onOpen={openCard}
          onPurchase={(m) => setDialog({ kind: 'purchase', material: m })}
          onBuyAny={() => setDialog({ kind: 'purchase' })}
          onEdit={(m) => setDialog({ kind: 'edit', material: m })}
          onAdd={() => setDialog({ kind: 'add' })}
          onImport={() => setDialog({ kind: 'import' })} />
      ))}
      {tab === 'stocktake' && (
        <Stocktake materials={data.materials} onAddMaterial={() => setDialog({ kind: 'add' })}
          onDone={(r) => { refresh(); showToast(`سُجّلت ${r.count === 1 ? 'تسويةٌ واحدة' : r.count === 2 ? 'تسويتان' : `${r.count.toLocaleString('ar-SY')} تسويات`} — الأرصدة صارت العدد الفعلي`, 'success', 5000) }} />
      )}
      {tab === 'reports' && <Reports showToast={showToast} />}

      {dialog?.kind === 'add' && (
        <MaterialDialog units={units} onClose={close}
          onSaved={(m) => { close(); refresh(); showToast(`أُضيفت «${m.name}»`, 'success', 3000) }} />
      )}
      {dialog?.kind === 'edit' && (
        <MaterialDialog material={data.materials.find((x) => String(x.id) === String(dialog.material.id)) || dialog.material}
          units={units} onClose={close}
          onSaved={() => { close(); refresh(); showToast('حُفظ التعديل', 'success', 3000) }} />
      )}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog materials={data.materials} units={units} initialId={dialog.material?.id}
          onClose={close} onDone={afterPurchase} onMaterialCreated={() => load()} />
      )}
      {dialog?.kind === 'price' && (
        <PriceDialog material={dialog.material} onClose={close}
          onSaved={(m) => { close(); refresh(); showToast(`سعر «${m.name}» صار ${fmtMoney(m.unit_price)}`, 'success', 4000) }} />
      )}
      {dialog?.kind === 'loss' && (
        <LossDialog name={dialog.name} unit={dialog.unit} warning={dialog.warning} onLater={close}
          onEditPrice={async () => {
            try { setDialog({ kind: 'price', material: await api.inventory.material(dialog.material.id) }) }
            catch (ex) { showToast(ex.message) }
          }} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog onClose={close} showToast={showToast}
          onDone={(r) => {
            close(); refresh()
            showToast(`تمّ الاستيراد: ${materialsCount(r.new)} جديدة و${r.purchase.toLocaleString('ar-SY')} شراء`
              + (r.rejected ? ` — وتُجوهل ${r.rejected.toLocaleString('ar-SY')} سطراً مرفوضاً` : ''), 'success', 6000)
          }} />
      )}
    </>
  )
}
