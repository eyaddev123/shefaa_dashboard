import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtMoney } from '../api.js'
import { matchesAr } from '../arabic-search.js'
import { useToast } from '../action-feedback.jsx'
import { useRole } from '../RoleContext.jsx'
import { canWriteInventory, inventoryView } from '../permissions.js'
import { EmptyState, MoreMenu, fmtQty, materialsCount, stockWords } from '../components/inventory/shared.jsx'
import {
  AlertDialog, CostDialog, CountDialog, ImportDialog, LossDialog, MaterialDialog, PriceDialog, PurchaseDialog,
} from '../components/inventory/InventoryDialogs.jsx'
import MaterialCard from '../components/inventory/MaterialCard.jsx'
import Stocktake from '../components/inventory/Stocktake.jsx'
import Reports from '../components/inventory/Reports.jsx'
import PurchasePrices from '../components/inventory/PurchasePrices.jsx'

// ═══ المخزون — دفتر حركات المواد، والمكان الوحيد لإدارة الكتالوج ═══
// «نفض» 2026-11-12 لمستعملين غير تقنيين: عدّاداتٌ تصير فلاتر، وكلّ مادة سطرٌ واحد بالكلام العادي
// («قرّبت تخلص» · «خلصت»)، وزرّان فقط فوق (تسجيل شراء · مادة جديدة) والباقي تحت «المزيد». الجرد
// وأسعار الشراء والتقارير شاشاتٌ فرعية برجوعٍ واحد (?view=) بدل التبويبات، والمادة صفحتها (?material=).
// الرصيد مجموع الحركات: الشراء يُدخل، ومواد الإجراءات تُخرج تلقائياً، والجرد يصحّح.
// ثلاث عيون على الصفحة نفسها (والخادم هو الحارس — هنا إخفاء ما لا يُفيد الضغط عليه):
// · المشرفة تكتب كلّ شيء.
// · المدير والمشرف العام: الشاشة نفسها بلا زرّ كتابة واحد، وبلا تبويب الجرد.
// · المجلس: الكتالوج بأسعاره (بلا أرصدة) وتقرير الاستهلاك بقيمة البيع — ما كان يراه في
//   تبويبَي «المواد» و«استهلاك المواد» بصفحة الإجراءات قبل نقلهما إلى هنا.

const TABS = [['materials', 'المواد'], ['costs', 'أسعار الشراء'], ['stocktake', 'تسوية جرد'], ['reports', 'التقارير']]
const isConsumable = (m) => m.material_kind === 'consumable'

// ═══ العدّادات: كلّ عدّادٍ فلتر بضغطة ═══
// «قرّبت تخلص» و«خلصت» منفصلان: الثاني أعجل. والاستهلاكية والموقوفة فلتران ثانويان تحتها.
const COUNTERS = [
  ['all', 'كل المواد', ''],
  ['low', 'قرّبت تخلص', 'warn'],
  ['out', 'خلصت', 'bad'],
  ['nocost', 'بلا سعر شراء', 'info'],
]
const matches = (m, f) => (f === 'all' ? true : f === 'nocost' ? m.no_purchase_price : stockWords(m).filter === f)
const EMPTY_TEXT = {
  low: 'ولا مادة قرّبت تخلص — كلّه تمام.', out: 'ولا مادة خلصت.', nocost: 'كلّ المواد إلها سعر شراء.',
  consumable: 'ما في مواد استهلاكية.', inactive: 'ما في مواد موقوفة.', all: 'ما في مادة بهالاسم.',
}

function MaterialRow({ m, canWrite, onOpen, onPurchase }) {
  const w = stockWords(m)
  const cons = isConsumable(m)
  return (
    <li className={`invx-row tone-${w.tone}`}>
      <button type="button" className="invx-open" onClick={() => onOpen(m.id)} aria-label={`${m.name} — ${w.text}`}>
        <span className="invx-name">{m.name}<span className="invx-unit">{m.unit}</span></span>
        <span className={`invx-stock tone-${w.tone}`}><span className="invx-dot" aria-hidden="true" />{w.text}</span>
        <span className="invx-price">
          {cons ? <span className="invx-muted">بلا سعر بيع</span> : <>يُباع بـ <strong>{fmtMoney(m.unit_price)}</strong></>}
        </span>
        {(m.no_purchase_price || (m.selling_at_loss && m.is_active)) && (
          <span className="invx-flags">
            {m.no_purchase_price && <span className="invx-flag info">بلا سعر شراء</span>}
            {m.selling_at_loss && m.is_active && <span className="invx-flag bad">عم تنباع بأقلّ من سعر شرائها</span>}
          </span>
        )}
      </button>
      {canWrite && m.is_active && (
        <button type="button" className="ghost invx-buy" onClick={() => onPurchase(m)}>شراء</button>
      )}
    </li>
  )
}

function MaterialsList({ data, canWrite, onOpen, onPurchase, onAdd, onImport }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const filter = params.get('show') || 'all'
  const setFilter = (f) => setParams(f === 'all' ? {} : { show: f }, { replace: true })
  const { materials, summary } = data
  const count = (f) => materials.filter((m) => matches(m, f)).length
  const secondary = [['consumable', 'استهلاكية'], ['inactive', 'موقوفة']].filter(([k]) => count(k) > 0)
  const shown = materials.filter((m) => matchesAr(m.name, query) && matches(m, filter))

  if (materials.length === 0) {
    return (
      <div className="card">
        {canWrite ? (
          <EmptyState text="ما في مواد لسّا." hint="ضيفي المواد واحدة واحدة، أو كلّها مرّة وحدة من ملف Excel.">
            <button type="button" onClick={onAdd}>+ مادة جديدة</button>
            <button type="button" className="ghost" onClick={onImport}>استيراد من Excel</button>
          </EmptyState>
        ) : <EmptyState text="ما في مواد لسّا." hint="بتضيفها مشرفة العيادات من هالصفحة." />}
      </div>
    )
  }
  return (
    <>
      <div className="invx-counters" role="group" aria-label="عرض">
        {COUNTERS.map(([k, label, tone]) => {
          const n = k === 'all' ? materials.length : count(k)
          return (
            <button key={k} type="button" aria-pressed={filter === k}
              className={`invx-counter${tone ? ` tone-${tone}` : ''}${filter === k ? ' is-on' : ''}${n === 0 && k !== 'all' ? ' is-zero' : ''}`}
              onClick={() => setFilter(filter === k ? 'all' : k)}>
              <span className="invx-counter-n">{n.toLocaleString('ar-SY')}</span>
              <span className="invx-counter-label">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="card invx-card">
        <div className="invx-searchbar">
          <input type="search" className="invx-search" value={query} placeholder="دوّري على مادة بالاسم…" aria-label="دوّري على مادة بالاسم"
            onChange={(e) => setQuery(e.target.value)} />
          {secondary.length > 0 && (
            <div className="invx-chips" role="group" aria-label="عرض ثانوي">
              {secondary.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} className={`invx-chip${filter === k ? ' is-on' : ''}`}
                  onClick={() => setFilter(filter === k ? 'all' : k)}>
                  {label} <span className="invx-chip-n">{count(k).toLocaleString('ar-SY')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {filter === 'nocost' && shown.length > 0 && (
          <p className="invx-explain">
            سعر الشراء بيلزم لنعرف ربح المواد، ولتنحسب المواد بجلسات الحديد صح. فوتي على المادة واضغطي «تغيير» جنب سعر الشراء —
            {canWrite ? ' أو عبّيهم كلّهم مرّة وحدة من «المزيد ← أسعار الشراء».' : ''}
          </p>
        )}
        {filter === 'low' && shown.length > 0 && (
          <p className="invx-explain">هدول وصلوا للعدد اللي طلبتي ننبّهك عنده. سجّلي شراء لما توصل البضاعة.</p>
        )}

        {shown.length === 0 ? (
          <EmptyState text={query ? 'ما في مادة بهالاسم.' : EMPTY_TEXT[filter]}>
            {(query || filter !== 'all') && (
              <button type="button" className="ghost" onClick={() => { setQuery(''); setFilter('all') }}>عرض كل المواد</button>
            )}
          </EmptyState>
        ) : (
          <ul className="invx-list">
            {shown.map((m) => <MaterialRow key={m.id} m={m} canWrite={canWrite} onOpen={onOpen} onPurchase={onPurchase} />)}
          </ul>
        )}
        <p className="invx-footnote">
          قيمة الموجود بسعر الشراء: <strong>{fmtMoney(summary.stock_value)}</strong>
          {summary.no_purchase_price > 0 && <span className="invx-muted"> — من غير المواد اللي ما إلها سعر شراء</span>}
        </p>
      </div>
    </>
  )
}

/** رأس شاشةٍ فرعية (جرد · أسعار الشراء · التقارير): رجوعٌ واحد واضح بدل التبويبات */
function SubView({ title, hint, onBack, children }) {
  return (
    <>
      <button type="button" className="link-btn invx-back" onClick={onBack}>→ كل المواد</button>
      <h2 className="invx-sub-title">{title}</h2>
      {hint && <p className="subtitle">{hint}</p>}
      {children}
    </>
  )
}

// ═══ الكتالوج بعين المجلس: بأسعاره بلا أرصدة ═══
// المصدر GET /api/clinic/materials نفسه الذي كان يغذّي تبويب «المواد» القديم — فالأعمدة
// هي نفسها: المادة والوحدة وسعر الوحدة والحالة وعدد الإجراءات وآخر تعديل.
function CatalogTable({ list }) {
  const [query, setQuery] = useState('')
  const shown = list.filter((m) => matchesAr(m.name, query))
  const active = list.filter((m) => m.is_active).length
  return (
    <div className="card">
      <div className="inv-toolbar">
        <h3 style={{ margin: 0 }}>كتالوج المواد ({list.length.toLocaleString('ar-SY')} — المفعَّل {active.toLocaleString('ar-SY')})</h3>
        {list.length > 0 && (
          <input type="search" className="inv-search" value={query} placeholder="ابحث بالاسم…" aria-label="ابحث بالاسم"
            onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>
      {list.length === 0 ? <EmptyState text="لا مواد بعد." hint="تعرّفها مشرفة العيادات من هذه الصفحة." />
        : shown.length === 0 ? (
          <EmptyState text="لا مادة بهذا الاسم.">
            <button type="button" className="ghost" onClick={() => setQuery('')}>عرض الكل</button>
          </EmptyState>
        ) : (
          <table className="inv-table rtable">
            <thead><tr><th>المادة</th><th>الوحدة</th><th>سعر الوحدة</th><th>الحالة</th><th>استُعملت</th><th>آخر تعديل</th></tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} className={m.is_active ? undefined : 'proc-inactive'}>
                  <td className="inv-name rt-title">{m.name}
                    {isConsumable(m) && <span className="badge sm kind-badge" style={{ marginInlineStart: 6 }}>استهلاكية</span>}</td>
                  <td data-label="الوحدة">{m.unit}</td>
                  <td className="num" data-label="سعر الوحدة">{fmtMoney(m.unit_price)}</td>
                  <td className="rt-badge">
                    {m.is_active ? <span className="badge sm good">مفعَّلة</span> : <span className="badge sm">معطَّلة</span>}
                  </td>
                  <td className="num" data-label="استُعملت">{m.times_used.toLocaleString('ar-SY')} إجراء</td>
                  <td className="inv-who rt-full" data-label="آخر تعديل">
                    {m.updated_by_name || m.created_by_name || '—'}
                    {(m.updated_at || m.created_at) && (
                      <span dir="ltr" style={{ marginInlineStart: 6 }}>
                        {new Date(m.updated_at || m.created_at).toLocaleDateString('en-CA')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}

export default function Inventory() {
  const { clinicRole: role } = useRole()
  const canWrite = canWriteInventory(role)
  const view = inventoryView(role)
  if (view === 'catalog') return <InventoryCatalogView />
  return <InventoryFull canWrite={canWrite} />
}

// المجلس: تبويبان — الكتالوج، والتقارير (الاستهلاك بقيمة البيع وحده)
function InventoryCatalogView() {
  const [tab, setTab] = useState('materials')
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [toast, showToast] = useToast()
  useEffect(() => {
    api.clinic.materials().then((r) => { setList(r); setErr(null) }).catch((e) => setErr(e.message))
  }, [])
  return (
    <>
      <h2>المخزون</h2>
      <p className="subtitle">
        كتالوج المواد بأسعار البيع للمريض، واستهلاكها من الإجراءات. للاطّلاع فقط — تديره مشرفة العيادات.
      </p>
      {toast}
      <div className="inline proc-tabs inv-tabs" role="tablist">
        {TABS.filter(([k]) => k !== 'stocktake' && k !== 'costs').map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'materials' && (err && !list ? <p className="error">{err}</p>
        : !list ? <p className="empty">جارٍ التحميل…</p> : <CatalogTable list={list} />)}
      {tab === 'reports' && <Reports showToast={showToast} withCost={false} />}
    </>
  )
}

const VIEWS = {
  stocktake: { title: 'جرد الرفوف', hint: 'عدّي الموجود فعلاً على الرف واكتبيه جنب كل مادة عدّيتيها — الفاضي ما بيتحسب. منحسبلك الفرق قبل ما نصحّح.' },
  costs: { title: 'أسعار الشراء', hint: 'سعر شراء الواحدة لكل مادة — عبّيهم كلّهم مرّة وحدة. كتابتهم هون ما بتخصم شي من الصندوق.' },
  reports: { title: 'التقارير', hint: 'شو انصرف من المواد وشو انشرى، لفترة بتختاريها.' },
}

function InventoryFull({ canWrite }) {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [units, setUnits] = useState([])
  const [err, setErr] = useState(null)
  const [dialog, setDialog] = useState(null)   // { kind, material?, warning? }
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, showToast] = useToast()
  const openId = params.get('material')
  const view = VIEWS[params.get('view')] ? params.get('view') : null

  // الوحدات لنوافذ الكتابة وحدها
  const load = useCallback(() => Promise.all([api.inventory.materials(), canWrite ? api.inventory.units() : []])
    .then(([d, u]) => { setData(d); setUnits(u); setErr(null) })
    .catch((e) => setErr(e.message)), [canWrite])
  useEffect(() => { load() }, [load])

  const refresh = () => { load(); setRefreshKey((k) => k + 1) }
  const close = () => setDialog(null)
  const go = (next) => { setParams(next); window.scrollTo({ top: 0 }) }
  const openCard = (id) => go({ material: String(id) })
  const backToList = () => go({})

  const afterPurchase = (r, m) => {
    refresh()
    showToast(`انسجّل الشراء — «${r.material_name}» صار الموجود منها ${fmtQty(r.balance)} ${r.unit}`, 'success', 5000)
    if (r.loss_warning) setDialog({ kind: 'loss', material: m, warning: r.loss_warning, name: r.material_name, unit: r.unit })
    else close()
  }

  if (err && !data) return <><h2>المخزون</h2><p className="error">{err}</p></>
  if (!data) return <><h2>المخزون</h2><p className="empty">جارٍ التحميل…</p></>

  const more = [
    ...(canWrite ? [
      { label: 'جرد الرفوف', hint: 'عدّيتي الرفوف؟ صحّحي الكميات', onClick: () => go({ view: 'stocktake' }) },
      { label: 'أسعار الشراء', hint: 'عبّي أسعار الشراء كلّها مرّة وحدة', onClick: () => go({ view: 'costs' }) },
    ] : [{ label: 'أسعار الشراء', hint: 'سعر شراء كل مادة', onClick: () => go({ view: 'costs' }) }]),
    { label: 'التقارير', hint: 'شو انصرف وشو انشرى', onClick: () => go({ view: 'reports' }) },
    ...(canWrite ? [
      { label: 'استيراد من Excel', hint: 'ضيفي مواد كثيرة مرّة وحدة', onClick: () => setDialog({ kind: 'import' }) },
      { label: 'تنزيل قالب Excel', hint: 'الملف الفاضي اللي بتعبّيه', onClick: () => api.inventory.template().catch((ex) => showToast(ex.message)) },
    ] : []),
  ]

  return (
    <>
      {toast}
      {openId ? (
        <MaterialCard id={openId} refreshKey={refreshKey} onBack={backToList} canWrite={canWrite}
          onPurchase={(m) => setDialog({ kind: 'purchase', material: m })}
          onEdit={(m) => setDialog({ kind: 'edit', material: m })}
          onEditPrice={(m) => setDialog({ kind: 'price', material: m })}
          onEditCost={(m) => setDialog({ kind: 'cost', material: m })}
          onEditAlert={(m) => setDialog({ kind: 'alert', material: m })}
          onCount={(m) => setDialog({ kind: 'count', material: m })} />
      ) : view ? (
        <SubView title={VIEWS[view].title} hint={view === 'costs' && !canWrite ? 'سعر شراء الواحدة لكل مادة — للاطّلاع.' : VIEWS[view].hint} onBack={backToList}>
          {view === 'stocktake' && canWrite && (
            <Stocktake materials={data.materials} onAddMaterial={() => setDialog({ kind: 'add' })}
              onDone={(r) => { refresh(); showToast(`انصحّح العدد ${r.count === 1 ? 'لمادة وحدة' : r.count === 2 ? 'لمادتين' : `لـ ${materialsCount(r.count)}`} — الموجود صار متل الرف`, 'success', 5000) }} />
          )}
          {view === 'costs' && (
            <PurchasePrices materials={data.materials} canWrite={canWrite} initialOnlyMissing={data.summary.no_purchase_price > 0}
              onSaved={(r) => { refresh(); showToast(r.changed ? `انحفظ سعر شراء ${materialsCount(r.changed)}` : 'ما تغيّر شي', 'success', 4000) }} />
          )}
          {view === 'reports' && <Reports showToast={showToast} withCost />}
        </SubView>
      ) : (
        <>
          <div className="invx-head">
            <div>
              <h2>المخزون</h2>
              <p className="subtitle">
                كل مواد العيادات: شو موجود منها، وبكم بتنباع، وبكم انشرت. اضغطي على أيّ مادة لتشوفي كل شي عنها.
                {!canWrite && ' للاطّلاع فقط — بتديره مشرفة العيادات.'}
              </p>
            </div>
            <div className="invx-head-actions">
              {canWrite && <button type="button" className="invx-primary" onClick={() => setDialog({ kind: 'purchase' })}>تسجيل شراء</button>}
              {canWrite && <button type="button" className="ghost" onClick={() => setDialog({ kind: 'add' })}>+ مادة جديدة</button>}
              <MoreMenu items={more} />
            </div>
          </div>
          <MaterialsList data={data} canWrite={canWrite} onOpen={openCard}
            onPurchase={(m) => setDialog({ kind: 'purchase', material: m })}
            onAdd={() => setDialog({ kind: 'add' })}
            onImport={() => setDialog({ kind: 'import' })} />
        </>
      )}

      {dialog?.kind === 'add' && (
        <MaterialDialog units={units} onClose={close}
          onSaved={(m) => { close(); refresh(); showToast(`انضافت «${m.name}»`, 'success', 3000) }} />
      )}
      {dialog?.kind === 'edit' && (
        <MaterialDialog material={data.materials.find((x) => String(x.id) === String(dialog.material.id)) || dialog.material}
          units={units} onClose={close}
          onSaved={() => { close(); refresh(); showToast('انحفظ التعديل', 'success', 3000) }} />
      )}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog materials={data.materials} units={units} initialId={dialog.material?.id}
          onClose={close} onDone={afterPurchase} onMaterialCreated={() => load()} />
      )}
      {dialog?.kind === 'price' && (
        <PriceDialog material={dialog.material} onClose={close}
          onSaved={(m) => { close(); refresh(); showToast(`سعر بيع «${m.name}» صار ${fmtMoney(m.unit_price)}`, 'success', 4000) }} />
      )}
      {dialog?.kind === 'cost' && (
        <CostDialog material={dialog.material} onClose={close}
          onSaved={(price) => { close(); refresh(); showToast(`سعر شراء «${dialog.material.name}» صار ${fmtMoney(price)}`, 'success', 4000) }} />
      )}
      {dialog?.kind === 'alert' && (
        <AlertDialog material={dialog.material} onClose={close}
          onSaved={(m) => { close(); refresh(); showToast(m.min_quantity ? `رح ننبّهك لما «${m.name}» توصل لـ ${fmtQty(m.min_quantity)}` : `ما في تنبيه على «${m.name}»`, 'success', 4000) }} />
      )}
      {dialog?.kind === 'count' && (
        <CountDialog material={dialog.material} onClose={close}
          onSaved={(msg) => { close(); refresh(); showToast(msg, 'success', 5000) }} />
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
            const n = (v) => v.toLocaleString('ar-SY')
            showToast(`تمّ الاستيراد: ${materialsCount(r.new)} جديدة`
              + (r.consumable ? ` و${n(r.consumable)} استهلاكية` : '')
              + (r.opening ? ` و${n(r.opening)} رصيد افتتاحي على موجودة` : '')
              + (r.purchase ? ` و${n(r.purchase)} شراء` : '')
              + (r.skipped ? ` — تخطٍّ: ${n(r.skipped)}` : '')
              + (r.rejected ? ` — وتُجوهل ${r.rejected.toLocaleString('ar-SY')} سطراً مرفوضاً` : ''), 'success', 6000)
          }} />
      )}
    </>
  )
}
