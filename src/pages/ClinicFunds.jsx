import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, todayLocal, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { Modal, fmtDay, parseNum } from '../components/inventory/shared.jsx'
import { DoctorsTab } from './DoctorAccounts.jsx'
import { ProfitHero, DailyChart, MaterialsProfit } from '../components/funds/ProfitBoard.jsx'

// ═══ صندوق العيادات · ربح المواد · حسابات الدكاترة ═══
// صفحةٌ واحدة بثلاثة تبويبات، لجمهورٍ واحد: المشرفة تكتب، والمدير والمشرف العام يطالعان
// (FUND_* في الخادم). الحساب كلّه في الخادم — هنا عرضٌ وحده، والفترة تُحلّ هناك بتوقيت دمشق.
//
// «صندوق العيادات» غير «إيرادات الشفاء»: داخله ثمن المواد المباعة، وخارجه شراء المواد
// والمصاريف. والراتب في تبويب الدكاترة عرضٌ لا يُسحب من أيّ صندوق.
// التبويب والفترة في الرابط: زرّ الرجوع في الجوال يعود إلى ما كان.

// «الصندوق» صفحةٌ واحدة للرصيد وربح المواد والحركات (2026-11-14، قرار المستخدم) — ?tab=profit القديم يفتحها
const TABS = [['fund', 'الصندوق والربح'], ['consumables', 'المستهلكات'], ['doctors', 'حسابات الدكاترة']]
const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هالأسبوع' },
  { key: 'month', label: 'هالشهر' },
  { key: 'custom', label: 'من — إلى' },
]
const KIND_BADGE = {
  opening: 'blue', material_sale: 'good', material_edit: '', material_reversal: 'bad', purchase: 'warn', expense: 'bad',
  iron_drug: 'good', iron_surplus: 'good', iron_drug_rev: 'bad', iron_surplus_rev: 'bad',
  iron_materials: 'good', iron_materials_rev: 'bad', iron_materials_edit: '', iron_surplus_edit: '',
}

const MOVES_SHOWN = 10
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
function MovementDetail({ m }) {
  if (m.line) {
    return (
      <span className="fund-detail">
        <strong>{m.line.procedure}</strong>
        <span className="fund-sub">{m.line.patient}{m.line.doctor && ` — ${m.line.doctor}`}</span>
      </span>
    )
  }
  if (m.purchase) {
    return (
      <span className="fund-detail">
        <strong>{m.purchase.material}</strong>
        <span className="fund-sub">
          الكمية {fmtNum(m.purchase.qty)} {m.purchase.unit}، سعر القطعة {fmtNum(m.purchase.unitCost)}
          {m.purchase.supplier && ` — ${m.purchase.supplier}`}
        </span>
      </span>
    )
  }
  if (m.iron) {
    return (
      <span className="fund-detail">
        <strong>{m.iron.patient}</strong>
        <span className="fund-sub">
          {m.iron.withDrug ? 'مع دوا' : 'بلا دوا'}، سعر الجلسة {fmtNum(m.iron.price)} — الممرضة {m.iron.nurse}
          {m.iron.doctor && ` — ${m.iron.doctor}`}
        </span>
        {m.kind.endsWith('_rev') && m.iron.cancelReason && <span className="fund-sub">سبب الإلغاء: {m.iron.cancelReason}</span>}
      </span>
    )
  }
  return <span className="fund-detail">{m.reason || <span className="muted">—</span>}</span>
}

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

function FundTab({ canWrite, showToast }) {
  const p = usePeriod()
  const [reload, setReload] = useState(0)
  const [data, err] = useLoad(() => api.clinic.fund(p.query), p.key, reload)
  const [profit, profitErr] = useLoad(() => api.clinic.materialsProfit(p.query), p.key, reload)
  const [dialog, setDialog] = useState(null)   // 'expense' | 'opening' | 'history'
  const [allMoves, setAllMoves] = useState(false)   // شهرٌ = عشرات الحركات: آخر ١٠ ثمّ «كل الحركات»
  const refresh = () => { setDialog(null); setReload((k) => k + 1) }
  const moves = data ? (allMoves ? data.movements : data.movements.slice(0, MOVES_SHOWN)) : []

  return (
    <>
      {/* الفترة لكلّ الصفحة: الربح والرسم والمواد والحركات معاً */}
      <div className="card fx-period"><PeriodPicker p={p} data={data || profit} /></div>

      <div className="fx-hero">
        <div className="fx-hero-card fund-hero-balance">
          <span className="fx-label">الرصيد هلأ</span>
          {data ? <strong className={`fx-big${data.balance < 0 ? ' neg' : ''}`}>
            {data.balance < 0 && '−'}<Money value={Math.abs(data.balance)} /></strong>
            : <strong className="fx-big muted">…</strong>}
          {data && (
            <span className="fx-sub">
              {data.opening ? <>الرصيد الافتتاحي <Money value={data.opening.amount} /> منذ {fmtDay(data.opening.date)}</>
                : 'لم يُدخل الرصيد الافتتاحي بعد'}
              {data.opening && <button type="button" className="link-btn" onClick={() => setDialog('history')}>السجلّ</button>}
            </span>
          )}
          {canWrite && data && (
            <span className="fund-actions fx-actions">
              <button type="button" onClick={() => setDialog('expense')}>+ مصروف جديد</button>
              <button type="button" className="ghost" onClick={() => setDialog('opening')}>
                {data.opening ? 'تعديل الرصيد الافتتاحي' : 'إدخال الرصيد الافتتاحي'}</button>
            </span>
          )}
        </div>
        {profit && <ProfitHero data={profit} />}
      </div>
      {profitErr && <p className="error">{profitErr}</p>}

      {profit && <div className="card fx-card"><DailyChart daily={profit.daily} /></div>}
      {profit && <MaterialsProfit data={profit} query={p.query} />}

      <div className="card earn-card">
        <div className="earn-head"><h3>حركات الصندوق</h3></div>
        {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
          <>
            <div className="tiles earn-tiles fund-tiles">
              <div className="tile"><div className="label">قبل الفترة</div><div className={`value${data.before < 0 ? ' neg' : ''}`}>{signed(data.before)}</div></div>
              <div className="tile fund-in"><div className="label">داخل</div><div className="value"><Money value={data.totals.in} /></div></div>
              <div className="tile fund-out"><div className="label">خارج</div><div className="value"><Money value={data.totals.out} /></div></div>
              <div className="tile earn-hero"><div className="label">صافي الفترة</div><div className={`value${data.totals.net < 0 ? ' neg' : ''}`}>{signed(data.totals.net)}</div></div>
            </div>
            {data.movements.length === 0 ? <p className="empty">لا حركات في هذه الفترة.</p> : (
              <table className="rtable earn-table fund-table">
                <thead><tr><th>اليوم</th><th>الحركة</th><th>التفصيل</th><th>المبلغ</th><th>بواسطة</th></tr></thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id}>
                      <td className="rt-badge earn-when" dir="ltr">{m.date}</td>
                      <td className="rt-title"><span className={`badge sm ${KIND_BADGE[m.kind]}`}>{m.label}</span></td>
                      <td className="rt-full" data-label="التفصيل"><MovementDetail m={m} /></td>
                      <td className={`num fund-amt${m.amount < 0 ? ' is-out' : ' is-in'}`} data-label="المبلغ">{signed(m.amount)}</td>
                      <td className="fund-by" data-label="بواسطة">{m.by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.movements.length > MOVES_SHOWN && (
              <button type="button" className="ghost fx-more" onClick={() => setAllMoves((v) => !v)}>
                {allMoves ? 'أخفِ القديمة' : `كل الحركات (${fmtNum(data.movements.length)})`}</button>
            )}
            <p className="earn-note">
              يدخل تلقائياً ثمن المواد في كلّ إجراءٍ مقبوض (بيوم القبض) واسترداد دواء الحديد وفاضل كلّ جلسة حديد، ويخرج تلقائياً كلّ شراء مواد (الكمية × سعر القطعة).
              حذف إجراءٍ مقبوض يكتب حركةً عكسية. هذا الصندوق منفصلٌ عن إيرادات الشفاء (الكشوف وحصّتها من الإجراءات).
            </p>
          </>
        )}
      </div>

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
        ثمن المواد المباعة ونصيب الصندوق من جلسات الحديد يدخلان، وشراء المواد والمصاريف تخرج — منفصلٌ عن إيرادات الشفاء.
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
