import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, todayLocal, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { Modal, fmtDay, parseNum } from '../components/inventory/shared.jsx'
import { DoctorsTab } from './DoctorAccounts.jsx'
import { MaterialsView, MaterialProfitDialog } from '../components/funds/ProfitBoard.jsx'
import { NowCard, PeriodCard, ProfitCard, Movements, MovesStrip, GROUPS } from '../components/funds/FundOverview.jsx'

// ═══ صندوق العيادات · ربح المواد · حسابات الدكاترة ═══
// صفحةٌ واحدة بثلاثة تبويبات، لجمهورٍ واحد: المشرفة تكتب، والمدير والمشرف العام يطالعان
// (FUND_* في الخادم). الحساب كلّه في الخادم — هنا عرضٌ وحده، والفترة تُحلّ هناك بتوقيت دمشق.
//
// «صندوق العيادات» غير «إيرادات الشفاء»: داخله ثمن المواد المباعة، وخارجه شراء المواد
// والمصاريف. والراتب في تبويب الدكاترة عرضٌ لا يُسحب من أيّ صندوق.
// التبويب والفترة في الرابط: زرّ الرجوع في الجوال يعود إلى ما كان.

// تبويبان للصندوق، لكلٍّ فترته (طلب المستخدم 2026-11-14): «حركة الصندوق» أوّلاً ثمّ «ملخّص الصندوق».
// «المستهلكات» أُزيل من هنا (قراره: تُتابَع من المخزون، وشراؤها يظهر في الحركة). ?tab=profit القديم يفتح الملخّص.
const TABS = [['fund', 'حركة الصندوق'], ['summary', 'ملخّص الصندوق'], ['doctors', 'حسابات الأطباء']]
const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هالأسبوع' },
  { key: 'month', label: 'هالشهر' },
  { key: 'custom', label: 'من — إلى' },
]
// صفحة الصندوق بالفصحى (طلب المستخدم 2026-11-14) — والحديد يبقى بكلامه
const FORMAL = { today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر', custom: 'من — إلى' }

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const rangeText = (d) => (d.from === d.to ? d.from : `${d.from} ← ${d.to}`)

// ═══ الفترة: أزرارٌ وحقلا تاريخ، والحالة في الرابط ═══
export function usePeriod(dflt = 'month') {
  const [params, setParams] = useSearchParams()
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : dflt
  const from = params.get('from') || todayLocal()
  const to = params.get('to') || from
  const query = period === 'custom' ? { from, to } : { period }
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  return { period, from, to, query, key: JSON.stringify(query), set }
}

export function PeriodPicker({ p, data, formal = false }) {
  const pick = (key) => p.set(key === 'custom'
    ? { period: 'custom', from: data?.from || todayLocal(), to: data?.to || todayLocal() }
    : { period: key, from: null, to: null })
  return (
    <>
      <div className="earn-periods" role="group" aria-label="الفترة">
        {PERIODS.map((x) => (
          <button key={x.key} type="button" aria-pressed={p.period === x.key}
            className={`rev-flag${p.period === x.key ? ' is-on' : ''}`} onClick={() => pick(x.key)}>{formal ? FORMAL[x.key] : x.label}</button>
        ))}
      </div>
      {p.period === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="fund-from">من</label>
            <input id="fund-from" type="date" value={p.from}
              onChange={(e) => e.target.value && p.set({ from: e.target.value, to: e.target.value > p.to ? e.target.value : p.to })} /></div>
          <div className="field"><label htmlFor="fund-to">إلى</label>
            <input id="fund-to" type="date" value={p.to} min={p.from}
              onChange={(e) => e.target.value && p.set({ to: e.target.value })} /></div>
        </div>
      )}
      {data && <p className="earn-range">الفترة: <span dir="ltr">{rangeText(data)}</span>{p.period === 'week' && ' (الأسبوع يبدأ السبت)'}</p>}
    </>
  )
}

// تحميلٌ مرتبطٌ بمفتاحه: ردّ فترةٍ سابقة لا يُعرض تحت الفترة الجديدة
export function useLoad(fn, key, reload = 0) {
  const [loaded, setLoaded] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setErr(null)
    fn().then((d) => { if (live) setLoaded({ key, d }) }).catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [key, reload])
  return [loaded && loaded.key === key ? loaded.d : null, err]
}

// ═══════ ١) الصندوق ═══════
function ExpenseDialog({ onClose, onSaved }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const n = parseNum(amount)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!(n > 0)) return setErr('اكتب مبلغ المصروف')
    if (!reason.trim()) return setErr('اكتب سبب المصروف')
    setBusy(true)
    try { onSaved(await api.clinic.addFundExpense({ amount, reason }), n) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="مصروف جديد" subtitle="مبلغٌ يُسحب من الصندوق لأمرٍ لا علاقة له بالمواد: كرسي، فطور للأطباء، تصليح…" onClose={onClose} busy={busy} sheet>
      <form onSubmit={submit} className="inv-form">
        <div className="field"><label htmlFor="fx-amt">المبلغ (ل.س)</label>
          <input id="fx-amt" autoFocus value={amount} inputMode="decimal" placeholder="0"
            onChange={(e) => setAmount(toLatinDigits(e.target.value))} /></div>
        <div className="field"><label htmlFor="fx-why">السبب</label>
          <input id="fx-why" value={reason} maxLength={300} placeholder="مثال: فطور للأطباء"
            onChange={(e) => setReason(e.target.value)} /></div>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'تسجيل المصروف'}</button>
        </div>
      </form>
    </Modal>
  )
}

function OpeningDialog({ current, onClose, onSaved }) {
  const [amount, setAmount] = useState(current ? String(current.amount) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (parseNum(amount) === null || Number.isNaN(parseNum(amount))) return setErr('اكتب الرصيد الافتتاحي')
    if (current && !note.trim()) return setErr('اكتب سبب التعديل — يُحفظ في السجلّ')
    setBusy(true)
    try { onSaved(await api.clinic.setFundOpening({ amount, note })) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={current ? 'تعديل الرصيد الافتتاحي' : 'الرصيد الافتتاحي'} onClose={onClose} busy={busy} sheet
      subtitle={current ? 'كلّ تعديلٍ يُسجَّل بالقديم والجديد ومن عدّله ولماذا.'
        : 'ما في صندوق العيادات يوم بدء النظام — يُدخل مرّةً واحدة، وأيّ تعديلٍ بعده يُسجَّل.'}>
      <form onSubmit={submit} className="inv-form">
        <div className="field"><label htmlFor="fo-amt">المبلغ (ل.س)</label>
          <input id="fo-amt" autoFocus value={amount} inputMode="decimal" placeholder="0"
            onChange={(e) => setAmount(toLatinDigits(e.target.value))} /></div>
        <div className="field"><label htmlFor="fo-note">{current ? 'سبب التعديل' : 'ملاحظة (اختياري)'}</label>
          <input id="fo-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <p className="error">{err}</p>}
        <div className="bf-actions inv-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>إلغاء</button>
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </Modal>
  )
}

function OpeningHistory({ onClose }) {
  const [rows, err] = useLoad(() => api.clinic.fundOpeningHistory(), 'h')
  return (
    <Modal title="سجلّ الرصيد الافتتاحي" onClose={onClose} sheet>
      {err ? <p className="error">{err}</p> : !rows ? <p className="empty">جارٍ التحميل…</p>
        : rows.length === 0 ? <p className="empty">لم يُدخل بعد.</p> : (
          <ul className="change-log">
            {rows.map((h) => (
              <li key={h.id}>
                <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
                <span>{h.old_amount === null ? `أُدخل: ${fmtNum(h.new_amount)}` : `${fmtNum(h.old_amount)} ← ${fmtNum(h.new_amount)}`}
                  {h.note && ` — ${h.note}`}</span>
                <span className="muted">— {h.by_name || 'غير معروف'}</span>
              </li>
            ))}
          </ul>
        )}
      <div className="bf-actions inv-actions"><button type="button" className="ghost" onClick={onClose}>إغلاق</button></div>
    </Modal>
  )
}

// ═══════ الصندوق: تبويبان، لكلٍّ فترته (FundOverview.jsx) — طلب المستخدم 2026-11-14 ═══════
const PERIOD_WORD = { today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر', custom: 'الفترة المحدّدة' }

// ١) «حركة الصندوق» — أوّل ما يُرى: الأرقام، والفلاتر، والحركات سطراً سطراً. والكتابة هنا (مصروف، الرصيد الافتتاحي)
function MovesTab({ canWrite, showToast }) {
  const p = usePeriod()
  const [params, setParams] = useSearchParams()
  const filter = GROUPS.some((g) => g.key === params.get('filter')) ? params.get('filter') : null
  const setFilter = (f) => { const n = new URLSearchParams(params); if (f) n.set('filter', f); else n.delete('filter'); setParams(n, { replace: true }) }
  const [reload, setReload] = useState(0)
  const [data, err] = useLoad(() => api.clinic.fund(p.query), p.key, reload)
  const [dialog, setDialog] = useState(null)   // 'expense' | 'opening' | 'history'
  const refresh = () => { setDialog(null); setReload((k) => k + 1) }
  return (
    <>
      <div className="fo-bar">
        <div className="fo-bar-period"><PeriodPicker p={p} data={data} formal /></div>
        {canWrite && data && (
          <div className="fo-bar-actions">
            <button type="button" onClick={() => setDialog('expense')}>+ مصروف جديد</button>
            <button type="button" className="ghost" onClick={() => setDialog('opening')}>
              {data.opening ? 'الرصيد الافتتاحي' : 'إدخال الرصيد الافتتاحي'}</button>
            {data.opening && <button type="button" className="link-btn" onClick={() => setDialog('history')}>سجلّ الرصيد</button>}
          </div>
        )}
      </div>
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <div className="fo-page">
          <MovesStrip fund={data} />
          <Movements fund={data} filter={filter} onFilter={setFilter} />
          <p className="earn-note">
            يدخل الصندوق تلقائياً ثمن المواد في كلّ إجراءٍ مقبوض (بيوم القبض)، واسترداد دواء الحديد وفائض كلّ جلسة، ويخرج منه كلّ شراء مواد
            والمصاريف. حذف إجراءٍ مقبوض يسجّل حركةً عكسية. هذا الصندوق منفصلٌ عن إيرادات الشفاء (الكشوف وحصّتها من الإجراءات).
          </p>
        </div>
      )}
      {dialog === 'expense' && (
        <ExpenseDialog onClose={() => setDialog(null)}
          onSaved={(_r, n) => { refresh(); showToast(`سُجّل مصروف ${fmtNum(n)} ل.س`, 'success', 4000) }} />
      )}
      {dialog === 'opening' && (
        <OpeningDialog current={data?.opening} onClose={() => setDialog(null)}
          onSaved={(r) => { refresh(); showToast(`أصبح الرصيد الافتتاحي ${fmtNum(r.amount)} ل.س`, 'success', 4000) }} />
      )}
      {dialog === 'history' && <OpeningHistory onClose={() => setDialog(null)} />}
    </>
  )
}

// ٢) «ملخّص الصندوق» — ما لدينا الآن، ومصادر الداخل وأوجه الخارج، وربح المواد (وصفحة «جميع المواد» تحته)
function SummaryTab({ onShowMoves }) {
  const p = usePeriod()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'materials' ? 'materials' : 'overview'
  const setView = (v) => { const n = new URLSearchParams(params); if (v === 'materials') n.set('view', v); else n.delete('view'); setParams(n); window.scrollTo(0, 0) }
  const [data, err] = useLoad(() => api.clinic.fund(p.query), p.key)
  const [profit, profitErr] = useLoad(() => api.clinic.materialsProfit(p.query), p.key)
  const [openMat, setOpenMat] = useState(null)
  const word = PERIOD_WORD[p.period] || 'الفترة المحدّدة'
  return (
    <>
      <div className="fo-bar"><div className="fo-bar-period"><PeriodPicker p={p} data={data || profit} formal /></div></div>
      {(err || profitErr) && <p className="error">{err || profitErr}</p>}
      {!data || !profit ? (!err && !profitErr && <p className="empty">جارٍ التحميل…</p>) : view === 'materials' ? (
        <MaterialsView data={profit} query={p.query} periodLabel={word} onBack={() => setView('overview')} />
      ) : (
        <div className="fo-page">
          <NowCard fund={data} stock={profit.stock} />
          <PeriodCard fund={data} periodLabel={word} onPick={(g) => onShowMoves(g, p)} />
          <ProfitCard profit={profit} periodLabel={word} onAll={() => setView('materials')} onOpen={setOpenMat} />
          <p className="earn-note">
            ربح المواد = قيمة بيع ما بيع − كلفة شرائه (متوسّط سعر الشراء لحظة إضافتها على الإجراء)، فالشراء اللاحق لا يغيّر ربح ما بيع.
            مواد جلسات الحديد تُحتسب بسعر الشراء فلا ربح لها، وفائض الحديد يظهر في حركة الصندوق.
          </p>
        </div>
      )}
      {openMat && <MaterialProfitDialog row={openMat} query={p.query} onClose={() => setOpenMat(null)} />}
    </>
  )
}

// ═══════ ٣) حسابات الدكاترة — في DoctorAccounts.jsx (يعرضه هذا التبويب وصفحة «تقارير الدكاترة») ═══════

export default function ClinicFunds() {
  const { clinicRole: role } = useRole()
  const canWrite = canWriteClinicFunds(role)
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') === 'profit' ? 'summary' : params.get('tab')
  const tab = TABS.some(([k]) => k === asked) ? asked : 'fund'
  const [toast, showToast] = useToast()
  // لكلّ تبويبٍ فترته: التبديل يبدأ بفترته الافتراضية
  const pickTab = (k) => setParams(k === 'fund' ? {} : { tab: k })
  // من «الملخّص»: الضغط على مصدرٍ أو وجه يفتح «حركة الصندوق» بالفترة نفسها مصفّاةً به
  const showMoves = (filter, p) => setParams({ ...(p.period === 'custom' ? { period: 'custom', from: p.from, to: p.to } : { period: p.period }), filter })

  return (
    <>
      <h2>صندوق العيادات</h2>
      <p className="subtitle">
        حركة الصندوق، وما لدينا الآن، وأرباح المواد.
        {!canWrite && ' للاطّلاع فقط — تديره مشرفة العيادات.'}
      </p>
      {toast}
      <div className="inline proc-tabs inv-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? '' : 'ghost'} onClick={() => pickTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'fund' && <MovesTab canWrite={canWrite} showToast={showToast} />}
      {tab === 'summary' && <SummaryTab onShowMoves={showMoves} />}
      {tab === 'doctors' && <DoctorsTab canWrite={canWrite} />}
    </>
  )
}
