import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, todayLocal } from '../api.js'
import ProcedureMaterialsDetail from '../components/ProcedureMaterialsDetail.jsx'
import { useUnpaid, UnpaidPanel, EmptyVisitsList, LineEditor, LineHistory } from '../components/procedures/LineTools.jsx'

// ═══ مستحقات الدكاترة من الإجراءات — ومعها ما كان في «المراجعة» ═══
// أسئلة المشرفة بترتيبها:
//   ١) هل ينتظرني شيء؟   — شريط «يحتاج انتباهك»: بانتظار المحاسبة (كلّ الأيام)، و«إجراء فقط» بلا إجراء،
//                         والشفاء سالبة، وبلا قاعدة، والمواد فوق السعر (في الفترة) — كلٌّ يُفتح بقائمته وأفعالها
//   ٢) كم طلع في الفترة؟  — للدكاترة، وللشفاء، والمواد (وللإدارة: ربح المواد فوق الشراء)، والحديد إن وُجد
//   ٣) لكلّ دكتور كم؟     — سطرٌ لكلّ دكتور، وحصّته أوضح ما فيه
//   ٤) تفصيل الدكتور      — إجراءاته يوماً بيوم، ولكلّ إجراء: موادّه، و«تصحيح المواد» و«الأثر» (المشرفة)
// الحساب كلّه في الخادم (GET /api/clinic/procedures/earnings) من لقطات الأسطر المقبوضة بيوم القبض —
// وهو نفسه ما يُبنى منه الإكسل. والفترة تُحلّ في الخادم بتوقيت دمشق. الفترة والدكتور في الرابط.
// المشرفة والمدير والمشرف العام وحدهم (EARNINGS_ROLES في الخادم) — المجلس والاستقبال 403.

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'custom', label: 'من — إلى' },
]

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value, className }) {
  return <span className={className}>{fmtNum(value)}<span className="cash-unit">ل.س</span></span>
}
const asDate = (s) => new Date(`${s}T00:00:00`)
const fmtLong = (d) => asDate(d).toLocaleDateString('ar-SY', { day: 'numeric', month: 'long' })
const fmtWeekday = (d) => asDate(d).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long' })
const rangeWords = (d) => (d.from === d.to ? fmtWeekday(d.from) : `من ${fmtLong(d.from)} إلى ${fmtLong(d.to)}`)
function plural(n, one, two, few, many) {
  if (n === 1) return one
  if (n === 2) return two
  return `${fmtNum(n)} ${n % 100 >= 3 && n % 100 <= 10 ? few : many}`
}
const procsText = (n) => plural(n, 'إجراء واحد', 'إجراءان', 'إجراءات', 'إجراءً')
const sessionsText = (n) => plural(n, 'جلسة واحدة', 'جلستان', 'جلسات', 'جلسة')

// ما بقي خارج كلفة الشراء والربح: مواد بلا سعر شراء، والمستهلكات، والمواد السابقة
export function purchaseOutside(p) {
  return [
    p.unknown > 0 && `${fmtNum(p.unknown)} ${p.unknown === 1 ? 'مادة' : 'مواد'} بلا سعر شراء (مبيعها ${fmtNum(p.unknownSale)})`,
    p.consumables > 0 && `مستهلكات ${fmtNum(p.consumables)}`,
    p.legacy > 0 && `مواد سابقة ${fmtNum(p.legacy)}`,
  ].filter(Boolean)
}

// القاعدة بكلمتين بأرقامٍ هندية و«٪» العربية
export function ruleText(l) {
  if (l.ruleSource === 'none') return 'بلا قاعدة'
  if (l.ruleSource === 'manual') return 'تجاوز يدوي'
  const v = fmtNum(l.ruleValue)
  if (l.ruleKind === 'percent' && Number(l.ruleValue) === 0) return '٠٪ — للشفاء'
  if (l.ruleKind === 'fixed') return l.ruleSource === 'doctor' ? `العامة ثابت ${v}` : `ثابت ${v}`
  return l.ruleSource === 'doctor' ? `العامة ${v}٪` : `نسبة ${v}٪`
}

// الإصدار 2: المواد المعدودة تجاوزت السعر فطُرح السعر كلّه (المطروح = المواد المسقوفة + المستهلكات).
// في الإصدار 1 المطروح = المعدودة + السابقة ≥ المعدودة، فلا يصدق الشرط عليه أبداً.
export const overPrice = (l) => l.items.reduce((t, m) => t + m.cost, 0) > l.materials - (l.consumables || 0) + 0.005

const qty = (q) => Number(q).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const itemsText = (l) => [
  ...l.items.map((m) => `${m.name} ×${qty(m.qty)}`),
  l.legacyMaterials > 0 && 'مواد سابقة',
  l.consumables > 0 && `مستهلكات ${fmtNum(l.consumables)}`,
].filter(Boolean).join('، ')

// ═══════ ٢) كم طلع ═══════
function Totals({ t, iron, grand, purchase, doctorLabel = 'للدكاترة' }) {
  const hasIron = iron?.count > 0
  const outside = purchase ? purchaseOutside(purchase) : []
  return (
    <section className="pex-totals" aria-label="المجموع">
      <div className="pex-big">
        <div className="pex-big-item is-hero">
          <span className="pex-big-label">{doctorLabel}{hasIron ? ' (مع الحديد)' : ''}</span>
          <Money value={hasIron ? grand : t.doctor} className="pex-big-value" />
          {hasIron && <span className="pex-big-sub">الإجراءات {fmtNum(t.doctor)}، والحديد {fmtNum(iron.share)} ({sessionsText(iron.count)})</span>}
        </div>
        <div className="pex-big-item">
          <span className="pex-big-label">للشفاء</span>
          <Money value={t.shifa} className={`pex-big-value${t.shifa < 0 ? ' neg' : ''}`} />
        </div>
        <div className="pex-big-item">
          <span className="pex-big-label">المواد</span>
          <Money value={t.materials} className="pex-big-value" />
          {purchase && <span className="pex-big-sub">كلفة شرائها {fmtNum(purchase.cost)}، وربحها {fmtNum(purchase.profit)}</span>}
        </div>
      </div>
      <p className="pex-sentence">
        {procsText(t.count)} بقيمة <strong>{fmtNum(t.price)} ل.س</strong> دفعها المرضى، توزّعت: مواد، ثمّ حصّة الدكتور من الباقي بقاعدته، والبقية للشفاء.
      </p>
      {purchase && outside.length > 0 && <p className="pex-note">الربح محسوبٌ لما عُرف سعر شرائه — خارجه: {outside.join('، ')}.</p>}
    </section>
  )
}

// ═══════ تفصيل الدكتور: إجراءاته يوماً بيوم ═══════
function LineRow({ l, canEdit, onReload, showToast }) {
  const [open, setOpen] = useState(null)   // 'mats' | 'edit' | 'history'
  const toggle = (w) => setOpen((o) => (o === w ? null : w))
  const over = overPrice(l)
  const hasMats = l.items.length > 0 || l.consumables > 0 || l.legacyMaterials > 0
  return (
    <li className={`pex-line${l.negative ? ' is-neg' : l.noRule ? ' is-norule' : ''}`}>
      <div className="pex-line-main">
        <span className="pex-time" dir="ltr">{l.time}</span>
        <div className="pex-what">
          <span className="pex-proc">{l.procedure}</span>
          <span className="pex-meta">{l.patient}{l.queue !== '' && l.queue != null && <> (الدور {fmtNum(l.queue)})</>}</span>
          <span className="pex-meta">
            {hasMats ? <>المواد {fmtNum(l.materials)}: {itemsText(l)}</> : 'بلا مواد'}
          </span>
          <span className="pex-flags">
            <span className={`pex-rule${l.noRule ? ' is-norule' : ''}`}>{ruleText(l)}</span>
            {l.negative && <span className="badge bad sm">الشفاء سالبة</span>}
            {over && <span className="badge bad sm">المواد فوق السعر</span>}
          </span>
        </div>
        <div className="pex-split">
          <span className="pex-price">{fmtNum(l.price)}</span>
          <span className="pex-split-row"><span>الدكتور</span><strong>{fmtNum(l.doctor)}</strong></span>
          <span className={`pex-split-row${l.negative ? ' neg' : ''}`}><span>الشفاء</span><strong>{fmtNum(l.shifa)}</strong></span>
        </div>
      </div>
      <div className="pex-line-acts">
        {l.purchase && hasMats && <button type="button" className="ghost" aria-expanded={open === 'mats'} onClick={() => toggle('mats')}>تفصيل المواد</button>}
        {canEdit && <button type="button" className="ghost" aria-expanded={open === 'edit'} onClick={() => toggle('edit')}>تصحيح المواد</button>}
        <button type="button" className="ghost" aria-expanded={open === 'history'} onClick={() => toggle('history')}>
          الأثر{l.changes ? ` (${fmtNum(l.changes)})` : ''}</button>
      </div>
      {open && (
        <div className="pex-line-open">
          {open === 'mats' ? <ProcedureMaterialsDetail items={l.items} consumables={l.consumables} legacy={l.legacyMaterials} summary={l.purchase} />
            : open === 'edit' ? <LineEditor lineId={l.id} showToast={showToast} onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); onReload() }} />
            : <LineHistory lineId={l.id} />}
        </div>
      )}
    </li>
  )
}

function DoctorDetail({ doctor, multiDay, canEdit, onReload, showToast }) {
  const days = useMemo(() => {
    const m = new Map()
    for (const l of doctor.lines) { if (!m.has(l.date)) m.set(l.date, []); m.get(l.date).push(l) }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [doctor])
  return (
    <>
      {days.map(([day, ls]) => (
        <div key={day} className="pex-day">
          <div className="refx-day-head">
            <span>{fmtWeekday(day)}</span>
            <span className="refx-day-sum"><span className="refx-day-n">{procsText(ls.length)}</span>
              <span>حصّته <Money value={ls.reduce((s, l) => s + l.doctor, 0)} /></span></span>
          </div>
          <ul className="pex-lines">
            {ls.map((l) => <LineRow key={l.id} l={l} canEdit={canEdit} onReload={onReload} showToast={showToast} />)}
          </ul>
        </div>
      ))}
      {doctor.iron?.count > 0 && (
        <div className="pex-day">
          <div className="refx-day-head">
            <span><span className="badge sm iron-badge">حديد</span> جلسات الحديد</span>
            <span className="refx-day-sum"><span className="refx-day-n">{sessionsText(doctor.iron.count)}</span>
              <span>حصّته <Money value={doctor.iron.share} /></span></span>
          </div>
          <ul className="pex-lines">
            {doctor.iron.lines.map((l) => (
              <li key={l.id} className="pex-line">
                <div className="pex-line-main">
                  <span className="pex-time" dir="ltr">{l.time}</span>
                  <div className="pex-what">
                    <span className="pex-proc">{l.withDrug ? 'جلسة حديد مع دواء' : 'جلسة حديد بلا دواء'}</span>
                    <span className="pex-meta">{l.patient}، الممرضة {l.nurse}{multiDay && <>، {fmtLong(l.date)}</>}</span>
                  </div>
                  <div className="pex-split">
                    <span className="pex-price">{fmtNum(l.price)}</span>
                    <span className="pex-split-row"><span>الدكتور</span><strong>{fmtNum(l.share)}</strong></span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

// ═══════ ١) يحتاج انتباهك ═══════
function Attention({ items, open, setOpen }) {
  const shown = items.filter((x) => x.n > 0)
  if (shown.length === 0) return <p className="pex-allclear">✓ لا شيء ينتظرك: لا إجراء بانتظار المحاسبة، ولا سطر يحتاج تصحيحاً في هذه الفترة.</p>
  const cur = shown.find((x) => x.key === open)
  return (
    <section className="pex-attn" aria-label="يحتاج انتباهك">
      <div className="pex-attn-head">
        <h3>يحتاج انتباهك</h3>
        <div className="pex-attn-chips">
          {shown.map((x) => (
            <button key={x.key} type="button" aria-expanded={open === x.key}
              className={`pex-chip is-${x.tone}${open === x.key ? ' is-on' : ''}`} onClick={() => setOpen(open === x.key ? null : x.key)}>
              <span className="pex-chip-n">{fmtNum(x.n)}</span>
              <span className="pex-chip-label">{x.label}</span>
              {x.amount != null && <span className="pex-chip-amt">{fmtNum(x.amount)} ل.س</span>}
            </button>
          ))}
        </div>
      </div>
      {cur && (
        <div className="pex-attn-body">
          <p className="pex-attn-why">{cur.why}</p>
          {cur.body}
        </div>
      )}
    </section>
  )
}

export default function ProcedureEarnings({ showToast, canEdit }) {
  const [params, setParams] = useSearchParams()
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : 'today'
  const from = params.get('from') || todayLocal()
  const to = params.get('to') || from
  const doctorId = params.get('doctor')
  const [loaded, setLoaded] = useState(null)
  const [err, setErr] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [reload, setReload] = useState(0)
  const [attnOpen, setAttnOpen] = useState(null)
  const [unpaid, reloadUnpaid] = useUnpaid(showToast)
  const [empty, setEmpty] = useState(null)

  const query = period === 'custom' ? { from, to } : { period }
  const qKey = JSON.stringify(query)
  useEffect(() => {
    let live = true
    setErr(null)
    api.clinic.procedureEarnings(query)
      .then((d) => { if (live) setLoaded({ key: qKey, data: d }) })
      .catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [qKey, reload])
  const data = loaded && loaded.key === qKey ? loaded.data : null
  // «إجراء فقط» انتهت بلا إجراء — في مدى الفترة المحلول في الخادم
  useEffect(() => {
    if (!data) return
    api.clinic.emptyProcedureVisits({ from: data.from, to: data.to }).then((r) => setEmpty(r.visits)).catch(() => setEmpty([]))
  }, [data?.from, data?.to, reload])

  const update = (patch, { push = false } = {}) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: !push })
  }
  const pickPeriod = (key) => update(key === 'custom'
    ? { period: 'custom', from: data?.from || todayLocal(), to: data?.to || todayLocal(), doctor: null }
    : { period: key, from: null, to: null, doctor: null })
  const open = (id) => { update({ doctor: id }, { push: true }); window.scrollTo?.(0, 0) }
  const refresh = () => { setReload((n) => n + 1); reloadUnpaid() }

  const doctor = data && doctorId ? data.doctors.find((d) => d.doctorId === doctorId) : null
  const multiDay = data && data.from !== data.to

  // التنبيهات من أسطر الفترة نفسها — لكلّ تنبيهٍ قائمته بأسطره، والكبس على السطر يفتح دكتوره
  const allLines = data ? data.doctors.flatMap((d) => d.lines.map((l) => ({ ...l, doctorName: d.doctor, doctorId: d.doctorId }))) : []
  const flagList = (pred) => {
    const ls = allLines.filter(pred)
    return (
      <ul className="pex-plist">
        {ls.map((l) => (
          <li key={l.id} className="pex-pline">
            <div className="pex-pwho">
              <span className="pex-pname">{l.procedure}</span>
              <span className="pex-pmeta">{l.patient}، {l.doctorName}، {fmtLong(l.date)}</span>
            </div>
            <span className="pex-pamt">{fmtNum(l.price)}</span>
            <button type="button" className="ghost pex-pact" onClick={() => { setAttnOpen(null); open(l.doctorId) }}>عند الدكتور ←</button>
          </li>
        ))}
      </ul>
    )
  }
  const attention = [
    { key: 'unpaid', tone: 'warn', label: 'بانتظار المحاسبة', n: unpaid?.lines.length || 0, amount: unpaid?.total,
      why: 'إجراءاتٌ أضافها الأطباء ولم تُقبض بعد — من كلّ الأيام. لا تدخل المستحقات ولا الجرد حتى تُقبض.',
      body: unpaid && <UnpaidPanel data={unpaid} canEdit={canEdit} showToast={showToast} onChanged={refresh} /> },
    { key: 'empty', tone: 'warn', label: '«إجراء فقط» بلا إجراء', n: empty?.length || 0,
      why: 'زياراتٌ سُجّلت «إجراء فقط» وانتهت بلا إجراء ولا كشفية، فلم يُقبض منها شيء. هل نُسي تسجيل الإجراء؟',
      body: empty && <EmptyVisitsList visits={empty} /> },
    { key: 'negative', tone: 'bad', label: 'الشفاء سالبة', n: allLines.filter((l) => l.negative).length,
      why: 'المواد وحصّة الدكتور فاقت سعر الإجراء، فخسرت الشفاء على السطر. صحّح المواد من عند الدكتور إن كانت خطأً.',
      body: flagList((l) => l.negative) },
    { key: 'over', tone: 'bad', label: 'المواد فوق السعر', n: allLines.filter(overPrice).length,
      why: 'المواد المسجّلة تجاوزت سعر الإجراء، فطُرح السعر كلّه للمواد — الدكتور والشفاء صفر.',
      body: flagList(overPrice) },
    { key: 'norule', tone: 'warn', label: 'بلا قاعدة', n: allLines.filter((l) => l.noRule).length,
      why: 'الدكتور لم تكن له قاعدة لحظة تسجيل الإجراء، فحصّته صفر. ضبط القاعدة الآن لا يغيّر هذه الأسطر.',
      body: flagList((l) => l.noRule) },
  ]

  const doExport = async () => {
    setExporting(true)
    try {
      const name = await api.clinic.exportEarnings({ ...query, doctorId: doctor?.doctorId })
      showToast(`نُزّل ${name}`, 'success', 3000)
    } catch (ex) { showToast(ex.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="pex-page">
      <div className="pex-controls">
        <div className="earn-periods" role="group" aria-label="الفترة">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={period === p.key}
              className={`rev-flag${period === p.key ? ' is-on' : ''}`} onClick={() => pickPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <button type="button" className="ghost pex-export" disabled={exporting || !data || data.doctors.length === 0} onClick={doExport}>
          {exporting ? 'جارٍ التصدير…' : doctor ? 'إكسل هذا الدكتور' : 'إكسل الملخّص والتفصيل'}
        </button>
      </div>
      {period === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="earn-from">من</label>
            <input id="earn-from" type="date" value={from}
              onChange={(e) => e.target.value && update({ from: e.target.value, to: e.target.value > to ? e.target.value : to, doctor: null })} /></div>
          <div className="field"><label htmlFor="earn-to">إلى</label>
            <input id="earn-to" type="date" value={to} min={from}
              onChange={(e) => e.target.value && update({ to: e.target.value, doctor: null })} /></div>
        </div>
      )}

      {!doctorId && <Attention items={attention} open={attnOpen} setOpen={setAttnOpen} />}

      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : doctorId ? (
          <section className="card pex-card">
            <button type="button" className="ghost pex-back" onClick={() => update({ doctor: null })}>→ كلّ الدكاترة</button>
            {!doctor ? <p className="empty">لا إجراءات لهذا الدكتور {rangeWords(data)}.</p> : (
              <>
                <div className="pex-doc-head">
                  <h3>{doctor.doctor}</h3>
                  <span className="pex-range">{doctor.specialty ? `${doctor.specialty}، ` : ''}{rangeWords(data)}</span>
                </div>
                <Totals t={doctor.totals} iron={doctor.iron} grand={doctor.grand} purchase={doctor.purchase} doctorLabel="حصّته" />
                <DoctorDetail doctor={doctor} multiDay={multiDay} canEdit={canEdit} onReload={refresh} showToast={showToast} />
              </>
            )}
          </section>
        )
        : data.doctors.length === 0 ? <p className="empty pex-empty">لا إجراءات مقبوضة {rangeWords(data)}.</p>
        : (
          <>
            <p className="pex-range">{rangeWords(data)}{period === 'week' && ' (الأسبوع يبدأ السبت)'}</p>
            <Totals t={data.totals} iron={data.iron} grand={data.grand} purchase={data.purchase} />
            <section className="card pex-card" aria-label="الدكاترة">
              <h3 className="pex-h">لكلّ دكتور</h3>
              <ul className="pex-docs">
                {data.doctors.map((d) => {
                  const due = d.iron?.count > 0 ? d.grand : d.totals.doctor
                  return (
                    <li key={d.doctorId}>
                      <button type="button" className="pex-doc" onClick={() => open(d.doctorId)} aria-label={`تفصيل ${d.doctor}`}>
                        <span className="pex-doc-who">
                          <span className="pex-doc-name">{d.doctor}</span>
                          <span className="pex-meta">{d.specialty ? `${d.specialty}، ` : ''}{procsText(d.totals.count)}{d.iron?.count > 0 && `، و${sessionsText(d.iron.count)} حديد`}</span>
                          {(d.noRule > 0 || d.negative > 0) && (
                            <span className="pex-flags">
                              {d.negative > 0 && <span className="badge bad sm">الشفاء سالبة ({fmtNum(d.negative)})</span>}
                              {d.noRule > 0 && <span className="badge warn sm">بلا قاعدة ({fmtNum(d.noRule)})</span>}
                            </span>
                          )}
                        </span>
                        <span className="pex-doc-nums">
                          <span className="pex-doc-col"><span>القيمة</span>{fmtNum(d.totals.price)}</span>
                          <span className="pex-doc-col"><span>المواد</span>{fmtNum(d.totals.materials)}</span>
                          <span className={`pex-doc-col${d.totals.shifa < 0 ? ' neg' : ''}`}><span>للشفاء</span>{fmtNum(d.totals.shifa)}</span>
                          <span className="pex-doc-col is-hero"><span>حصّته</span>{fmtNum(due)}</span>
                        </span>
                        <span className="pex-doc-go" aria-hidden="true">←</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="pex-note">الأرقام من لقطة كلّ سطر لحظة تسجيله — تغيير قاعدةٍ أو سعرٍ لاحقاً لا يمسّها، والإجراء المُزال لا يُحسب.
                {data.iron?.count > 0 && ' و«حصّته» تشمل الحديد.'}</p>
            </section>
          </>
        )}
    </div>
  )
}
