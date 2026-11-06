import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, todayLocal, toLatinDigits } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { Modal, fmtDay, parseNum } from '../components/inventory/shared.jsx'

// ═══ صندوق العيادات · ربح المواد · حسابات الدكاترة ═══
// صفحةٌ واحدة بثلاثة تبويبات، لجمهورٍ واحد: المشرفة تكتب، والمدير والمشرف العام يطالعان
// (FUND_* في الخادم). الحساب كلّه في الخادم — هنا عرضٌ وحده، والفترة تُحلّ هناك بتوقيت دمشق.
//
// «صندوق العيادات» غير «إيرادات الشفاء»: داخله ثمن المواد المباعة، وخارجه شراء المواد
// والمصاريف. والراتب في تبويب الدكاترة عرضٌ لا يُسحب من أيّ صندوق.
// التبويب والفترة في الرابط: زرّ الرجوع في الجوال يعود إلى ما كان.

const TABS = [['fund', 'الصندوق'], ['profit', 'ربح المواد'], ['consumables', 'المستهلكات'], ['doctors', 'حسابات الدكاترة']]
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
  const [dialog, setDialog] = useState(null)   // 'expense' | 'opening' | 'history'
  const refresh = () => { setDialog(null); setReload((k) => k + 1) }

  return (
    <>
      <div className="card fund-hero">
        <div className="fund-balance">
          <span className="label">الرصيد الحالي</span>
          {data ? <strong className={`value${data.balance < 0 ? ' neg' : ''}`}>
            {data.balance < 0 && '−'}<Money value={Math.abs(data.balance)} /></strong>
            : <strong className="value muted">…</strong>}
          {data && (
            <span className="fund-opening">
              {data.opening ? <>الرصيد الافتتاحي <Money value={data.opening.amount} /> منذ {fmtDay(data.opening.date)}</>
                : 'لم يُدخل الرصيد الافتتاحي بعد'}
              {data.opening && <button type="button" className="link-btn" onClick={() => setDialog('history')}>السجلّ</button>}
            </span>
          )}
        </div>
        {canWrite && data && (
          <div className="fund-actions">
            <button type="button" onClick={() => setDialog('expense')}>+ مصروف جديد</button>
            <button type="button" className="ghost" onClick={() => setDialog('opening')}>
              {data.opening ? 'تعديل الرصيد الافتتاحي' : 'إدخال الرصيد الافتتاحي'}</button>
          </div>
        )}
      </div>

      <div className="card earn-card">
        <div className="earn-head"><h3>الحركات</h3></div>
        <PeriodPicker p={p} data={data} />
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
                  {data.movements.map((m) => (
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

// ═══════ ٢) ربح المواد ═══════
function ProfitTab() {
  const p = usePeriod()
  const [data, err] = useLoad(() => api.clinic.materialsProfit(p.query), p.key)
  return (
    <div className="card earn-card">
      <div className="earn-head"><h3>ربح المواد</h3></div>
      <p className="fund-method">
        التكلفة بـ<strong>متوسّط سعر الشراء المرجّح</strong>: كلّ شراءٍ جديد يُمزج مع الموجود في المخزون بحسب كميته،
        وتُثبَّت كلفة القطعة لحظة إضافتها على الإجراء — فشراءٌ لاحق لا يغيّر ربح ما بيع.
      </p>
      <PeriodPicker p={p} data={data} />
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <p className="empty">لا مواد بيعت في هذه الفترة.</p> : (
          <>
            <div className="tiles earn-tiles fund-tiles fund-tiles-3">
              <div className="tile"><div className="label">قديش بعنا</div><div className="value"><Money value={data.totals.sales} /></div></div>
              <div className="tile"><div className="label">التكلفة</div><div className="value"><Money value={data.totals.cost} /></div></div>
              <div className="tile earn-hero"><div className="label">الربح</div>
                <div className={`value${data.totals.profit < 0 ? ' neg' : ''}`}>{signed(data.totals.profit)}</div></div>
            </div>
            <table className="rtable earn-table">
              <thead><tr><th>المادة</th><th>الكمية المباعة</th><th>قديش بعنا</th><th>التكلفة</th><th>الربح</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className={r.missing ? 'earn-norule' : undefined}>
                    <td className="rt-title">{r.name}
                      {r.estimated && <span className="badge warn sm fund-flag" title="بيعت قبل تثبيت الكلفة — قُدّرت بسعر الشراء الحالي">تقديري</span>}
                      {r.missing && <span className="badge warn sm fund-flag">بلا سعر شراء</span>}</td>
                    <td className="num" data-label="الكمية المباعة">{fmtNum(r.qty)} {r.unit}</td>
                    <td className="num" data-label="قديش بعنا">{fmtNum(r.sales)}</td>
                    <td className="num" data-label="التكلفة">{r.cost === null ? '—' : fmtNum(r.cost)}</td>
                    <td className={`num fund-amt${r.profit === null ? '' : r.profit < 0 ? ' is-out' : ' is-in'}`} data-label="الربح">
                      {r.profit === null ? '—' : signed(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="earn-total">
                  <td className="rt-title">المجموع</td>
                  <td className="rt-hide"></td>
                  <td className="num" data-label="قديش بعنا">{fmtNum(data.totals.sales)}</td>
                  <td className="num" data-label="التكلفة">{fmtNum(data.totals.cost)}</td>
                  <td className={`num fund-amt${data.totals.profit < 0 ? ' is-out' : ' is-in'}`} data-label="الربح">{signed(data.totals.profit)}</td>
                </tr>
              </tfoot>
            </table>
            {data.missing > 0 && (
              <p className="share-warn">⚠ {data.missing === 1 ? 'مادةٌ واحدة' : `${fmtNum(data.missing)} مواد`} بلا سعر شراء — خارج التكلفة والربح.
                اكتب سعرها من «المخزون ← أسعار الشراء».</p>
            )}
            <p className="earn-note">من مواد الإجراءات المقبوضة في الفترة (بيوم القبض). الإجراء المحذوف لا يُحسب.</p>
          </>
        )}
    </div>
  )
}

// ═══════ ٣) حسابات الدكاترة — لشهر أو يوم أو فترة ═══════
// الشهر كما كان (?month=)، و«يوم» لمن تحاسبه المشرفة آخر يومه، و«فترة» حرّة (?from=&to=).
// يومية + ساعة: أيام الحضور × اليومية + الساعات × سعر الساعة، ويومٌ بلا انصراف يُنبَّه عليه.
const shiftMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const shiftDay = (day, n) => {
  const [y, m, d] = day.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')
const payText = (d) => (d.payKind === 'daily_hourly' ? 'يومية + ساعة'
  : d.payKind === 'fixed' ? 'راتب ثابت'
  : d.payKind === 'per_patient' ? `${fmtNum(d.payAmount)} للمريض` : null)
const hoursText = (h) => `${fmtNum(h)} س`
// «يوم واحد» · «يومان» · «٥ أيام» — ولا «·» بجانب رقمٍ هنديّ (يُقرأ صفراً)
const daysText = (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${fmtNum(n)} ${n >= 3 && n <= 10 ? 'أيام' : 'يوماً'}`)
const ACC_MODES = [['month', 'شهر'], ['day', 'يوم'], ['custom', 'فترة']]

function AttendanceCell({ d }) {
  const a = d.attendance
  if (!a.days) return <span className="muted">—</span>
  return (
    <>
      {daysText(a.days)}، {hoursText(a.hours)}
      {a.noDeparture > 0 && <span className="badge warn sm acc-nodep" title="يوميته محسوبة وساعاته لا — حتى يُصحَّح الانصراف">
        انصراف غير مسجَّل ×{fmtNum(a.noDeparture)}</span>}
      {a.onDuty > 0 && <span className="badge sm acc-nodep">لم ينصرف اليوم بعد</span>}
    </>
  )
}
function SalaryCell({ d }) {
  if (d.salary === null) return <span title="راتبٌ شهريّ قديم — يُحسب للشهر الكامل وحده">— <small className="muted">للشهر الكامل</small></span>
  return (
    <>
      {fmtNum(d.salary)}
      {d.payKind === 'daily_hourly' && (
        <span className="acc-split">
          {fmtNum(d.attendance.days)} × {fmtNum(d.dailyRate)} = {fmtNum(d.salaryDays)}
          <br />{hoursText(d.attendance.hours)} × {fmtNum(d.hourlyRate)} = {fmtNum(d.salaryHours)}
        </span>
      )}
    </>
  )
}

// linkDashboard: صفحة «تقارير الدكاترة» تفتح لوحة الدكتور من اسمه (بدل البروفايل للمشرفة هنا)
export function DoctorsTab({ canWrite, linkDashboard = false }) {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : null
  const day = isDay(params.get('day')) ? params.get('day') : null
  const from = isDay(params.get('from')) ? params.get('from') : null
  const to = isDay(params.get('to')) ? params.get('to') : from
  const mode = from ? 'custom' : day ? 'day' : 'month'
  const query = mode === 'custom' ? { from, to } : mode === 'day' ? { from: day, to: day } : { month }
  const [data, err] = useLoad(() => api.clinic.doctorAccounts(query), JSON.stringify(query))
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const k of ['month', 'day', 'from', 'to']) next.delete(k)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v)
    setParams(next, { replace: true })
  }
  const pickMode = (m) => set(m === 'day' ? { day: data?.today || todayLocal() }
    : m === 'custom' ? { from: data?.from || todayLocal(), to: data?.to || todayLocal() } : {})
  const cur = data?.month || month
  const curDay = day || data?.from
  const title = mode === 'day' ? 'حسابات الدكاترة — يوم' : mode === 'custom' ? 'حسابات الدكاترة — فترة' : 'حسابات الدكاترة الشهرية'
  const dashQuery = (d) => (mode === 'month' && data.month === todayLocal().slice(0, 7)
    ? 'period=month' : `period=custom&from=${d.from}&to=${d.to}`)

  return (
    <div className="card earn-card">
      <div className="earn-head">
        <h3>{title}</h3>
        <div className="earn-periods acc-modes" role="group" aria-label="الفترة">
          {ACC_MODES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={mode === k}
              className={`rev-flag${mode === k ? ' is-on' : ''}`} onClick={() => pickMode(k)}>{label}</button>
          ))}
        </div>
        {mode === 'month' && (
          <div className="fund-month" role="group" aria-label="الشهر">
            <button type="button" className="ghost" disabled={!cur} onClick={() => set({ month: shiftMonth(cur, -1) })} aria-label="الشهر السابق">→</button>
            <input type="month" value={cur || ''} aria-label="الشهر" onChange={(e) => e.target.value && set({ month: e.target.value })} />
            <button type="button" className="ghost" disabled={!cur} onClick={() => set({ month: shiftMonth(cur, 1) })} aria-label="الشهر التالي">←</button>
          </div>
        )}
        {mode === 'day' && (
          <div className="fund-month" role="group" aria-label="اليوم">
            <button type="button" className="ghost" disabled={!curDay} onClick={() => set({ day: shiftDay(curDay, -1) })} aria-label="اليوم السابق">→</button>
            <input type="date" value={curDay || ''} aria-label="اليوم" onChange={(e) => e.target.value && set({ day: e.target.value })} />
            <button type="button" className="ghost" disabled={!curDay} onClick={() => set({ day: shiftDay(curDay, 1) })} aria-label="اليوم التالي">←</button>
          </div>
        )}
      </div>
      {mode === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="acc-from">من</label>
            <input id="acc-from" type="date" value={from}
              onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} /></div>
          <div className="field"><label htmlFor="acc-to">إلى</label>
            <input id="acc-to" type="date" value={to} min={from}
              onChange={(e) => e.target.value && set({ from, to: e.target.value })} /></div>
        </div>
      )}
      {data && mode !== 'month' && <p className="earn-range">الفترة: <span dir="ltr">{rangeText(data)}</span></p>}
      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.doctors.length === 0 ? <p className="empty">لا دكاترة في هذه الفترة.</p> : (
          <>
            {data.noDeparture > 0 && (
              <p className="share-warn acc-warn" role="alert">
                ⚠ {data.noDeparture === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.noDeparture)} دكاترة`} على «يومية + ساعة» عندهم أيام
                «انصراف غير مسجَّل» في الفترة: يوميتها محسوبة وساعاتها لا — فالمجموع أقلّ من المستحقّ حتى يُصحَّح الانصراف
                {canWrite ? ' (لوحة الدكتور ← الحضور والانصراف).' : '.'}
              </p>
            )}
            <div className="tiles earn-tiles fund-tiles fund-tiles-3">
              <div className="tile"><div className="label">الرواتب المستحقة</div><div className="value"><Money value={data.totals.salary} /></div></div>
              <div className="tile"><div className="label">مجموع حصّة الشفاء</div><div className="value"><Money value={data.totals.shifa} /></div></div>
              <div className={`tile earn-hero ${data.totals.diff < 0 ? 'fund-loss' : 'fund-gain'}`}>
                <div className="label">{data.totals.diff < 0 ? 'خسارة' : 'ربح'}</div>
                <div className="value">{signed(data.totals.diff)}</div></div>
            </div>
            <table className="rtable earn-table fund-doc-table">
              <thead>
                <tr><th>الدكتور</th><th>المرضى</th><th>الحضور</th><th>الراتب</th><th>الشفاء من الكشوف</th><th>الشفاء من الإجراءات</th>
                  <th>مجموع الشفاء</th><th>الفرق</th></tr>
              </thead>
              <tbody>
                {data.doctors.map((d) => (
                  <tr key={d.doctorId}>
                    <td className="rt-title">
                      {linkDashboard ? <Link to={`/clinic/doctors/${d.doctorId}/dashboard?${dashQuery(data)}`}>{d.doctor}</Link>
                        : canWrite ? <Link to={`/clinic/doctors/${d.doctorId}`}>{d.doctor}</Link> : d.doctor}
                      <span className="earn-spec">
                        {d.noPay ? <span className="badge warn sm">بلا نوع حساب</span> : payText(d)}
                        {d.settleCycle && <span className={`badge sm acc-cycle${d.settleCycle === 'daily' ? ' is-daily' : ''}`}>
                          تحاسبه: {d.settleCycle === 'daily' ? 'يومي' : 'شهري'}</span>}
                        {!d.active && ' — موقوف'}
                      </span>
                    </td>
                    <td className="num" data-label="المرضى (كشوف منتهية)">{fmtNum(d.patients)}</td>
                    <td className="acc-att" data-label="الحضور (أيام · ساعات)"><AttendanceCell d={d} /></td>
                    <td className="num earn-doc" data-label="الراتب"><SalaryCell d={d} /></td>
                    <td className="num" data-label="الشفاء من الكشوف">{fmtNum(d.visitShifa)}</td>
                    <td className="num" data-label="الشفاء من الإجراءات">{fmtNum(d.procShifa)}</td>
                    <td className="num" data-label="مجموع الشفاء">{fmtNum(d.shifa)}</td>
                    <td className={`num fund-amt${d.diff < 0 ? ' is-out' : ' is-in'}`} data-label={d.diff < 0 ? 'خسارة' : 'ربح'}>
                      {d.diff === null ? '—' : signed(d.diff)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="earn-total">
                  <td className="rt-title">كل الدكاترة</td>
                  <td className="num" data-label="المرضى">{fmtNum(data.totals.patients)}</td>
                  <td data-label="الحضور" />
                  <td className="num earn-doc" data-label="الرواتب">{fmtNum(data.totals.salary)}</td>
                  <td className="num" data-label="الشفاء من الكشوف">{fmtNum(data.totals.visitShifa)}</td>
                  <td className="num" data-label="الشفاء من الإجراءات">{fmtNum(data.totals.procShifa)}</td>
                  <td className="num" data-label="مجموع الشفاء">{fmtNum(data.totals.shifa)}</td>
                  <td className={`num fund-amt${data.totals.diff < 0 ? ' is-out' : ' is-in'}`} data-label="الفرق">{signed(data.totals.diff)}</td>
                </tr>
              </tfoot>
            </table>
            {data.iron?.count > 0 && (
              <p className="iron-revenue">
                <span>حصّة الشفاء من جلسات الحديد (<bdi>{fmtNum(data.iron.count)}</bdi>): <strong><Money value={data.iron.shifa} /></strong></span>
                <span>إجمالي إيرادات الشفاء مع الحديد: <strong><Money value={data.revenue} /></strong></span>
              </p>
            )}
            {data.noPay > 0 && (
              <p className="share-warn">⚠ {data.noPay === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.noPay)} دكاترة`} بلا نوع حساب — راتبه صفر هنا.
                {canWrite && ' اضبطه من بروفايل الدكتور.'}</p>
            )}
            {data.fixedPartial > 0 && (
              <p className="share-warn">⚠ {data.fixedPartial === 1 ? 'دكتورٌ واحد' : `${fmtNum(data.fixedPartial)} دكاترة`} على «راتب شهري ثابت» القديم —
                يُحسب للشهر الكامل وحده، فهو خارج مجموع هذه الفترة.{canWrite && ' للانتقال: «يومية + ساعة» من بروفايل الدكتور.'}</p>
            )}
            <p className="earn-note">
              المرضى = الكشوف المنتهية في جلسات الفترة (لا الإجراءات). الحضور = أيامٌ فيها وصولٌ مسجَّل، والساعات من الوصول
              إلى الانصراف. يومية + ساعة = الأيام × اليومية + الساعات × سعر الساعة (لحظيّاً من الحضور: تصحيح وقتٍ يغيّر فترته).
              حصّة الشفاء من الكشوف = رسم كلّ زيارةٍ حضرت (كما في الجرد)، ومن الإجراءات = حصّتها في كلّ إجراءٍ قُبض في الفترة.
              الراتب بإعداد الدكتور الحالي، يُحسب ويُعرض فقط: لا يُسحب من إيرادات الشفاء ولا يمسّ الجرد ولا الصندوق.
              وحصّة الشفاء من جلسات الحديد مستقلّة عن حساب كلّ دكتور: لا تدخل عمود الفرق.
            </p>
          </>
        )}
    </div>
  )
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
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'fund'
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
      {tab === 'profit' && <ProfitTab />}
      {tab === 'consumables' && <ConsumablesTab />}
      {tab === 'doctors' && <DoctorsTab canWrite={canWrite} />}
    </>
  )
}
