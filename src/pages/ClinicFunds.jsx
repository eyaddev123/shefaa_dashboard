import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, todayLocal, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { Modal, fmtDay, parseNum } from '../components/inventory/shared.jsx'
import { DoctorsTab } from './DoctorAccounts.jsx'
import { MaterialsView, MaterialProfitDialog } from '../components/funds/ProfitBoard.jsx'
import { NowCard, PeriodCard, ProfitCard, Movements } from '../components/funds/FundOverview.jsx'

// ═══ صندوق العيادات · ربح المواد · حسابات الدكاترة ═══
// صفحةٌ واحدة بثلاثة تبويبات، لجمهورٍ واحد: المشرفة تكتب، والمدير والمشرف العام يطالعان
// (FUND_* في الخادم). الحساب كلّه في الخادم — هنا عرضٌ وحده، والفترة تُحلّ هناك بتوقيت دمشق.
//
// «صندوق العيادات» غير «إيرادات الشفاء»: داخله ثمن المواد المباعة، وخارجه شراء المواد
// والمصاريف. والراتب في تبويب الدكاترة عرضٌ لا يُسحب من أيّ صندوق.
// التبويب والفترة في الرابط: زرّ الرجوع في الجوال يعود إلى ما كان.

// «الصندوق» يجيب أسئلة المسؤولة بترتيبها (2026-11-14، «نفض» بطلب المستخدم) — ?tab=profit القديم يفتحه
const TABS = [['fund', 'الصندوق'], ['consumables', 'المستهلكات'], ['doctors', 'حسابات الدكاترة']]
const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هالأسبوع' },
  { key: 'month', label: 'هالشهر' },
  { key: 'custom', label: 'من — إلى' },
]

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
// «+١٦٬٠٠٠» و«−٦٠٬٠٠٠» — الإشارة نصّاً: toLocaleString يسبق السالب بعلامة اتجاه تُرسم شرطةً ثانية
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`
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

export function PeriodPicker({ p, data }) {
  const pick = (key) => p.set(key === 'custom'
    ? { period: 'custom', from: data?.from || todayLocal(), to: data?.to || todayLocal() }
    : { period: key, from: null, to: null })
  return (
    <>
      <div className="earn-periods" role="group" aria-label="الفترة">
        {PERIODS.map((x) => (
          <button key={x.key} type="button" aria-pressed={p.period === x.key}
            className={`rev-flag${p.period === x.key ? ' is-on' : ''}`} onClick={() => pick(x.key)}>{x.label}</button>
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
    <Modal title="مصروف جديد" subtitle="يُخصم من صندوق العيادات اليوم — تصليح، أغراض، …" onClose={onClose} busy={busy} sheet>
      <form onSubmit={submit} className="inv-form">
        <div className="field"><label htmlFor="fx-amt">المبلغ (ل.س)</label>
          <input id="fx-amt" autoFocus value={amount} inputMode="decimal" placeholder="0"
            onChange={(e) => setAmount(toLatinDigits(e.target.value))} /></div>
        <div className="field"><label htmlFor="fx-why">السبب</label>
          <input id="fx-why" value={reason} maxLength={300} placeholder="مثال: تصليح جهاز التعقيم"
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

// ═══════ ١) الصندوق — جواب أسئلة المسؤولة بترتيبها (FundOverview.jsx) ═══════
const PERIOD_WORD = { today: 'اليوم', week: 'هالأسبوع', month: 'هالشهر', custom: 'بالفترة' }
function FundTab({ canWrite, showToast }) {
  const p = usePeriod()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'materials' ? 'materials' : 'overview'
  const setView = (v) => { const n = new URLSearchParams(params); if (v === 'materials') n.set('view', v); else n.delete('view'); setParams(n); window.scrollTo(0, 0) }
  const [reload, setReload] = useState(0)
  const [data, err] = useLoad(() => api.clinic.fund(p.query), p.key, reload)
  const [profit, profitErr] = useLoad(() => api.clinic.materialsProfit(p.query), p.key, reload)
  const [dialog, setDialog] = useState(null)   // 'expense' | 'opening' | 'history'
  const [filter, setFilter] = useState(null)   // سطرٌ من «من وين/لوين» يفلتر الحركات
  const [openMat, setOpenMat] = useState(null)
  const refresh = () => { setDialog(null); setReload((k) => k + 1) }
  const word = PERIOD_WORD[p.period] || 'بالفترة'
  const pick = (g) => { setFilter(g); if (g) setTimeout(() => document.getElementById('fo-moves')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }

  return (
    <>
      <div className="fo-bar">
        <div className="fo-bar-period"><PeriodPicker p={p} data={data || profit} /></div>
        {canWrite && data && (
          <div className="fo-bar-actions">
            <button type="button" onClick={() => setDialog('expense')}>+ مصروف</button>
            <button type="button" className="ghost" onClick={() => setDialog('opening')}>
              {data.opening ? 'الرصيد الافتتاحي' : 'إدخال الرصيد الافتتاحي'}</button>
            {data.opening && <button type="button" className="link-btn" onClick={() => setDialog('history')}>سجلّه</button>}
          </div>
        )}
      </div>
      {(err || profitErr) && <p className="error">{err || profitErr}</p>}
      {!data || !profit ? (!err && !profitErr && <p className="empty">جارٍ التحميل…</p>) : view === 'materials' ? (
        <MaterialsView data={profit} query={p.query} periodLabel={word} onBack={() => setView('overview')} />
      ) : (
        <div className="fo-page">
          <NowCard fund={data} stock={profit.stock} />
          <PeriodCard fund={data} periodLabel={word} active={filter} onPick={pick} />
          <ProfitCard profit={profit} periodLabel={word} onAll={() => setView('materials')} onOpen={setOpenMat} />
          <Movements fund={data} filter={filter} onFilter={setFilter} />
          <p className="earn-note">
            يدخل الصندوق تلقائياً ثمن المواد بكلّ إجراءٍ مقبوض (بيوم القبض) واسترداد دوا الحديد وفاضل كل جلسة، ويطلع منه كلّ شراء مواد
            والمصاريف. حذف إجراءٍ مقبوض بيكتب حركةً عكسية. هالصندوق منفصل عن إيرادات الشفاء (الكشوف وحصّتها من الإجراءات).
            ربح المواد = سعر بيع ما انباع − كلفة شرائه (متوسّط سعر الشراء لحظة ما انضافت على الإجراء)؛ مواد الحديد بتنطرح بسعر الشراء فما إلها ربح.
          </p>
        </div>
      )}
      {openMat && <MaterialProfitDialog row={openMat} query={p.query} onClose={() => setOpenMat(null)} />}

      {dialog === 'expense' && (
        <ExpenseDialog onClose={() => setDialog(null)}
          onSaved={(_r, n) => { refresh(); showToast(`سُجّل مصروف ${fmtNum(n)} ل.س`, 'success', 4000) }} />
      )}
      {dialog === 'opening' && (
        <OpeningDialog current={data?.opening} onClose={() => setDialog(null)}
          onSaved={(r) => { refresh(); showToast(`الرصيد الافتتاحي صار ${fmtNum(r.amount)} ل.س`, 'success', 4000) }} />
      )}
      {dialog === 'history' && <OpeningHistory onClose={() => setDialog(null)} />}
    </>
  )
}

// ═══════ ٣) حسابات الدكاترة — في DoctorAccounts.jsx (يعرضه هذا التبويب وصفحة «تقارير الدكاترة») ═══════

const shiftMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ═══ المستهلكات لشهر: هل تقديرات أم أسامة مضبوطة؟ ═══
// المشتريات = «شراء مواد» لموادّ استهلاكية من الصندوق · المستردّ = ما طُرح فعلاً للمستهلكات من
// الإجراءات المقبوضة في الشهر · الفرق موجبٌ = التقدير يغطّي، سالبٌ = أقلّ من الكلفة.
function ConsumablesTab() {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : null
  const [data, err] = useLoad(() => api.clinic.consumablesReport(month), month || 'now')
  const go = (m) => { const next = new URLSearchParams(params); next.set('month', m); setParams(next, { replace: true }) }
  const cur = data?.month || month
  const t = data?.totals

  return (
    <div className="card earn-card">
      <div className="earn-head">
        <h3>المستهلكات — المشتريات مقابل المستردّ</h3>
        <div className="fund-month" role="group" aria-label="الشهر">
          <button type="button" className="ghost" disabled={!cur} onClick={() => go(shiftMonth(cur, -1))} aria-label="الشهر السابق">→</button>
          <input type="month" value={cur || ''} aria-label="الشهر" onChange={(e) => e.target.value && go(e.target.value)} />
          <button type="button" className="ghost" disabled={!cur} onClick={() => go(shiftMonth(cur, 1))} aria-label="الشهر التالي">←</button>
        </div>
      </div>
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <div className="tiles earn-tiles fund-tiles fund-tiles-3">
            <div className="tile"><div className="label">مشتريات الاستهلاكيات</div><div className="value"><Money value={t.purchases} /></div></div>
            <div className="tile"><div className="label">المستردّ من الإجراءات</div><div className="value"><Money value={t.recovered} /></div></div>
            <div className={`tile earn-hero ${t.diff < 0 ? 'fund-loss' : 'fund-gain'}`}>
              <div className="label">{t.diff < 0 ? 'التقدير أقلّ من الكلفة' : 'التقدير يغطّي'}</div>
              <div className="value">{signed(t.diff)}</div></div>
          </div>
          {data.purchases.length === 0 && data.recovered.length === 0 ? (
            <p className="empty">لا مشتريات استهلاكيات ولا إجراءات بمستهلكات في هذا الشهر.</p>
          ) : (
            <div className="fund-cons-grid">
              <div>
                <h4>المشتريات</h4>
                {data.purchases.length === 0 ? <p className="empty">لا مشتريات استهلاكيات.</p> : (
                  <table className="rtable earn-table">
                    <thead><tr><th>المادة</th><th>الكمية</th><th>المبلغ</th></tr></thead>
                    <tbody>
                      {data.purchases.map((p) => (
                        <tr key={p.materialId}>
                          <td className="rt-title">{p.material}</td>
                          <td className="num" data-label="الكمية">{fmtNum(p.qty)} {p.unit}</td>
                          <td className="num" data-label="المبلغ">{fmtNum(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4>المستردّ من الإجراءات</h4>
                {data.recovered.length === 0 ? <p className="empty">لا إجراءات بمستهلكات.</p> : (
                  <table className="rtable earn-table">
                    <thead><tr><th>الإجراء</th><th>المرّات</th><th>المستردّ</th></tr></thead>
                    <tbody>
                      {data.recovered.map((r) => (
                        <tr key={r.procedureId}>
                          <td className="rt-title">{r.procedure}</td>
                          <td className="num" data-label="المرّات">{fmtNum(r.times)}</td>
                          <td className="num" data-label="المستردّ">{fmtNum(r.amount)}
                            {r.estimate > r.amount && <span className="earn-spec">من تقدير {fmtNum(r.estimate)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {t.capped > 0 && (
            <p className="share-warn">⚠ {fmtNum(t.capped)} ل.س من التقدير لم تُطرح: المواد المعدودة على بعض الإجراءات لم تُبقِ لها من السعر.</p>
          )}
          <p className="earn-note">
            المشتريات = كلّ «شراء مواد» من الصندوق لمادةٍ استهلاكية في الشهر (بتاريخ الشراء). المستردّ = قيمة المستهلكات
            المطروحة من الإجراءات المقبوضة في الشهر (بيوم القبض، والمُزال لا يُعدّ). فرقٌ سالبٌ متكرّر يعني أنّ قيمة
            المستهلكات على أنواع الإجراءات أقلّ من كلفتها الفعلية — تُعدَّل من صفحة الإجراءات وتسري على ما بعدها.
          </p>
        </>
      )}
    </div>
  )
}

export default function ClinicFunds() {
  const { clinicRole: role } = useRole()
  const canWrite = canWriteClinicFunds(role)
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'fund'   // ومنه ?tab=profit القديم
  const [toast, showToast] = useToast()
  // تبديل التبويب يبدأ بفترته الافتراضية: فترة «الصندوق» ليست شهر «الدكاترة»
  const pickTab = (k) => setParams(k === 'fund' ? {} : { tab: k })

  return (
    <>
      <h2>صندوق العيادات</h2>
      <p className="subtitle">
        شو عنّا بالصندوق، شو فات وشو طلع، وقديش عم تربّحنا المواد.
        {!canWrite && ' للاطّلاع فقط — تديره مشرفة العيادات.'}
      </p>
      {toast}
      <div className="inline proc-tabs inv-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? '' : 'ghost'} onClick={() => pickTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'fund' && <FundTab canWrite={canWrite} showToast={showToast} />}
      {tab === 'consumables' && <ConsumablesTab />}
      {tab === 'doctors' && <DoctorsTab canWrite={canWrite} />}
    </>
  )
}
