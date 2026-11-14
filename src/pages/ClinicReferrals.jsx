import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDialogs } from '../dialogs.jsx'
import { api, todayLocal } from '../api.js'
import { useToast } from '../action-feedback.jsx'
import { useRole } from '../RoleContext.jsx'
import { canWriteReferralSources } from '../permissions.js'
import { matchesAr } from '../arabic-search.js'
import { Modal } from '../components/inventory/shared.jsx'

// ═══ العيادات — الإحالات ═══
// صفحةٌ واحدة تجيب أسئلة المشرفة بترتيبها (طلب المستخدم 2026-11-15: «سلسة، مرنة، واضحة»):
//   ١) كم لنا على الجهات في هذه الفترة؟        — الرقم الكبير، ومنه الكشف والإجراءات والحديد
//   ٢) على أيّ جهة؟                            — شريط الجهات (يظهر حين تكون أكثر من جهة)
//   ٣) على مَن بالضبط؟ — كشف الحساب            — زيارةٌ في سطرٍ واحد، يوماً بيوم، مع رقم الورقة
//   ٤) هل ينقص شيء قبل إرسال الكشف؟           — «بلا رقم ورقة» مرشِّحٌ ظاهر بعدده
//   ٥) إدارة الجهات                             — نافذةٌ من زرّ «الجهات»، لا تزاحم الحساب
// الأرقام كلّها من GET /clinic/referrals/report (لقطات الخصم — لا حساب هنا إلا الجمع للعرض)،
// يُطلب مرّةً للفترة بكلّ الجهات، والجهة تُرشَّح هنا — فيبقى شريط الجهات كاملاً. الإكسل من الخادم.
// الفترة والجهة والبحث في الرابط: زرّ الرجوع يعود، والرابط يُرسل كما هو.
// القراءة: المشرفة والمدير والمشرف العام (REFERRAL_READERS)؛ الكتابة على الجهات للمشرفة وحدها.

const PERIODS = [
  { key: 'month', label: 'هذا الشهر' },
  { key: 'last_month', label: 'الشهر الماضي' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'today', label: 'اليوم' },
  { key: 'custom', label: 'من — إلى' },
]

// ── التواريخ بتقويم الجهاز المحلّي (todayLocal) — لا toISOString (انظر recurring-utc-date-bug)
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const asDate = (s) => new Date(`${s}T00:00:00`)
export function periodRange(key, today = todayLocal()) {
  const t = asDate(today)
  if (key === 'today') return { from: today, to: today }
  // الأسبوع يبدأ السبت (قرار المستخدم في المستحقات) — getDay: السبت 6
  if (key === 'week') { const s = new Date(t); s.setDate(t.getDate() - ((t.getDay() + 1) % 7)); return { from: ymd(s), to: today } }
  if (key === 'last_month') {
    const s = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    const e = new Date(t.getFullYear(), t.getMonth(), 0)
    return { from: ymd(s), to: ymd(e) }
  }
  return { from: `${today.slice(0, 8)}01`, to: today }
}

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Money({ value, className }) {
  return <span className={className}>{fmtNum(value)}<span className="cash-unit">ل.س</span></span>
}
const fmtLong = (d) => asDate(d).toLocaleDateString('ar-SY', { day: 'numeric', month: 'long' })
const fmtWeekday = (d) => asDate(d).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long' })
const rangeWords = (from, to) => (from === to ? fmtWeekday(from) : `من ${fmtLong(from)} إلى ${fmtLong(to)}`)
// «زيارة واحدة» · «زيارتان» · «٣ زيارات» · «١١ زيارة»
function plural(n, one, two, few, many) {
  if (n === 1) return one
  if (n === 2) return two
  return `${fmtNum(n)} ${n % 100 >= 3 && n % 100 <= 10 ? few : many}`
}
const visitsText = (n) => plural(n, 'زيارة واحدة', 'زيارتان', 'زيارات', 'زيارة')
const patientsText = (n) => plural(n, 'مريض واحد', 'مريضين', 'مرضى', 'مريضاً')

// سطور الخادم (سطرٌ لكلّ بندٍ مخصوم) ⇐ زيارةٌ في سطرٍ واحد. المفتاح الزيارة والجهة معاً:
// زيارةٌ بإحالتين من جهتين تظهر عند كلٍّ منهما بما عليها وحده.
export function groupVisits(lines) {
  const map = new Map()
  for (const l of lines) {
    const k = `${l.visit_key}|${l.source_id}`
    let v = map.get(k)
    if (!v) {
      v = { key: k, date: l.date, patient: l.patient, doctor: l.doctor, source: l.source, sourceId: l.source_id,
        doc: l.doc_number, items: [], due: 0, original: 0 }
      map.set(k, v)
    }
    v.items.push(l)
    v.due += l.discount
    v.original += l.original
  }
  return [...map.values()]
}
// «إجراء: بلازما» ⇐ «بلازما» — نوع البند يقوله لونه وعلامته
const itemName = (l) => (l.kind === 'procedure' ? l.item.replace(/^إجراء:\s*/, '') : l.item)
const pctText = (l) => (l.discount_type === 'percent' ? `خصم ${fmtNum(l.discount_value)}٪` : 'خصم ثابت')

// ═══════ إدارة الجهات (نافذة) ═══════
function SourcesDialog({ sources, canWrite, onClose, onChanged, showToast }) {
  const dlg = useDialogs()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)   // { id, name }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const run = async (fn, okText) => {
    setBusy(true); setErr(null)
    try { await fn(); if (okText) showToast(okText, 'success', 3000); await onChanged() }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const add = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    run(async () => { await api.clinic.addReferralSource({ name }); setName('') }, `أُضيفت «${name.trim()}»`)
  }
  const toggle = async (s) => {
    if (s.is_active) {
      const ok = await dlg.confirm({
        title: 'إيقاف الجهة',
        body: `إيقاف «${s.name}»؟\nلا تظهر بعدها للاستقبال، وإحالاتها السابقة تبقى في الحساب كما هي.`,
        confirmLabel: 'إيقاف', danger: true,
      })
      if (!ok) return
    }
    run(() => api.clinic.updateReferralSource(s.id, { is_active: !s.is_active }), s.is_active ? `أُوقفت «${s.name}»` : `فُعّلت «${s.name}»`)
  }
  const rename = () => run(async () => { await api.clinic.updateReferralSource(editing.id, { name: editing.name }); setEditing(null) }, 'حُفظ الاسم')
  const remove = async (s) => {
    const ok = await dlg.confirm({ title: 'حذف الجهة', body: `حذف «${s.name}» نهائياً؟ (لا إحالات عليها)`, confirmLabel: 'حذف', danger: true })
    if (ok) run(() => api.clinic.deleteReferralSource(s.id), `حُذفت «${s.name}»`)
  }
  const active = sources.filter((s) => s.is_active)
  const stopped = sources.filter((s) => !s.is_active)
  const row = (s) => (
    <li key={s.id} className={`refx-src${s.is_active ? '' : ' is-off'}`}>
      {editing?.id === s.id ? (
        <form className="refx-src-edit" onSubmit={(e) => { e.preventDefault(); rename() }}>
          <input value={editing.name} maxLength={150} aria-label="اسم الجهة" autoFocus
            onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <button type="submit" disabled={busy || !editing.name.trim()}>حفظ</button>
          <button type="button" className="ghost" onClick={() => setEditing(null)}>إلغاء</button>
        </form>
      ) : (
        <>
          <div className="refx-src-main">
            <span className="refx-src-name">{s.name}</span>
            <span className="refx-src-meta">
              {s.is_active ? 'فعّالة' : 'موقوفة — لا تظهر للاستقبال'}
              {s.total_referrals > 0 && <>، {plural(s.total_referrals, 'إحالة واحدة', 'إحالتان', 'إحالات', 'إحالة')} منذ البداية</>}
            </span>
          </div>
          {canWrite && (
            <div className="refx-src-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setEditing({ id: s.id, name: s.name })}>تعديل الاسم</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => toggle(s)}>{s.is_active ? 'إيقاف' : 'تفعيل'}</button>
              {s.total_referrals === 0 && <button type="button" className="ghost refx-danger" disabled={busy} onClick={() => remove(s)}>حذف</button>}
            </div>
          )}
        </>
      )}
    </li>
  )
  return (
    <Modal title="الجهات المحيلة" sheet onClose={onClose} busy={busy}
      subtitle="الجهة الموقوفة لا تظهر للاستقبال، وتبقى إحالاتها السابقة في الحساب. ولا حذف لجهةٍ عليها إحالات.">
      {canWrite && (
        <form className="refx-add" onSubmit={add}>
          <input value={name} maxLength={150} aria-label="اسم الجهة الجديدة" placeholder="اسم جهةٍ جديدة، مثال: الهلال الأحمر"
            onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={busy || !name.trim()}>إضافة</button>
        </form>
      )}
      {err && <p className="error">{err}</p>}
      {sources.length === 0 ? <p className="empty">لا جهات بعد.</p> : (
        <>
          <ul className="refx-srcs">{active.map(row)}</ul>
          {stopped.length > 0 && <>
            <h4 className="refx-srcs-h">الموقوفة ({fmtNum(stopped.length)})</h4>
            <ul className="refx-srcs">{stopped.map(row)}</ul>
          </>}
        </>
      )}
      <div className="bf-actions inv-actions"><button type="button" className="ghost" onClick={onClose}>إغلاق</button></div>
    </Modal>
  )
}

// ═══════ زيارةٌ في سطر ═══════
function VisitRow({ v, showSource }) {
  return (
    <li className="refx-visit">
      <div className="refx-who">
        <span className="refx-patient">{v.patient}</span>
        <span className="refx-meta">
          {v.doctor || 'بلا دكتور'}
          {showSource && <span className="refx-src-tag">{v.source}</span>}
        </span>
      </div>
      <ul className="refx-items">
        {v.items.map((l, i) => (
          <li key={i} className={`refx-item is-${l.kind}`}>
            <span className="refx-item-name">{itemName(l)}</span>
            <span className="refx-item-pct">{pctText(l)}</span>
          </li>
        ))}
      </ul>
      <div className={`refx-doc${v.doc ? '' : ' is-missing'}`}>
        {v.doc ? <>ورقة <bdi dir="ltr">{v.doc}</bdi></> : 'بلا رقم ورقة'}
      </div>
      <div className="refx-amt">
        <Money value={v.due} />
        {v.original > v.due && <span className="refx-of">من أصل {fmtNum(v.original)}</span>}
      </div>
    </li>
  )
}

export default function ClinicReferrals() {
  const [params, setParams] = useSearchParams()
  const [toast, showToast] = useToast()
  const canWrite = canWriteReferralSources(useRole().clinicRole)
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : 'month'
  const range = period === 'custom'
    ? (() => { const f = params.get('from') || todayLocal(); const t = params.get('to') || f; return { from: f, to: t < f ? f : t } })()
    : periodRange(period)
  const sourceId = params.get('source') || ''
  const q = params.get('q') || ''
  const missingOnly = params.get('missing') === '1'
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }

  const [sources, setSources] = useState(null)
  const [managing, setManaging] = useState(false)
  const loadSources = () => api.clinic.referralSources().then((d) => setSources(d.sources)).catch((e) => showToast(e.message))
  useEffect(() => { loadSources() }, [])

  const key = `${range.from}|${range.to}`
  const [loaded, setLoaded] = useState(null)
  const [err, setErr] = useState(null)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    let live = true
    setErr(null)
    api.clinic.referralReport({ from: range.from, to: range.to, sourceId: '' })
      .then((d) => { if (live) setLoaded({ key, d }) }).catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [key])
  const data = loaded && loaded.key === key ? loaded.d : null

  // ── ما يُعرض: الجهة المختارة (أو الكلّ) ثمّ البحث ثمّ «بلا رقم ورقة»
  const allVisits = useMemo(() => (data ? groupVisits(data.lines) : []), [data])
  const scoped = sourceId ? allVisits.filter((v) => String(v.sourceId) === sourceId) : allVisits
  const scopedLines = sourceId && data ? data.lines.filter((l) => String(l.source_id) === sourceId) : data?.lines || []
  const missing = scoped.filter((v) => !v.doc).length
  const needle = q.trim()
  const shown = scoped.filter((v) => (!missingOnly || !v.doc)
    && (!needle || matchesAr(v.patient, needle) || matchesAr(v.doctor, needle) || String(v.doc).includes(needle)))
  const due = scoped.reduce((s, v) => s + v.due, 0)
  const byKind = (k) => scopedLines.filter((l) => l.kind === k).reduce((s, l) => s + l.discount, 0)
  const parts = [['visit', 'الكشف'], ['procedure', 'الإجراءات'], ['iron', 'الحديد']]
    .map(([k, label]) => ({ k, label, v: byKind(k) })).filter((p) => p.v > 0)
  const patients = new Set(scoped.map((v) => v.patient)).size
  const totals = data?.totals || []
  const chosen = totals.find((t) => String(t.source_id) === sourceId)
  const chosenName = chosen?.source || sources?.find((s) => String(s.id) === sourceId)?.name
  const onlyOne = totals.length === 1 ? totals[0].source : null
  const whom = chosenName || onlyOne || 'الجهات'

  // ── يوماً بيوم، الأحدث أوّلاً
  const days = useMemo(() => {
    const m = new Map()
    for (const v of shown) { if (!m.has(v.date)) m.set(v.date, []); m.get(v.date).push(v) }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [shown])

  const doExport = async () => {
    setExporting(true)
    try { const name = await api.clinic.exportReferralReport({ from: range.from, to: range.to, sourceId }); showToast(`نُزّل ${name}`, 'success', 3000) }
    catch (ex) { showToast(ex.message) } finally { setExporting(false) }
  }
  const pick = (k) => set(k === 'custom'
    ? { period: 'custom', from: range.from, to: range.to }
    : { period: k === 'month' ? null : k, from: null, to: null })

  return (
    <div className="refx-page">
      <div className="refx-head">
        <div>
          <h2>الإحالات</h2>
          <p className="subtitle refx-lead">ما خصمناه للمرضى بأوراق الإحالة مستحقٌّ لنا على الجهة المحيلة. وحصّة الدكتور والشفاء تُحسبان من السعر الأصلي كما هما.</p>
        </div>
        <button type="button" className="ghost refx-manage" onClick={() => setManaging(true)}>
          الجهات المحيلة{sources && ` (${fmtNum(sources.filter((s) => s.is_active).length)})`}
        </button>
      </div>
      {toast}

      <div className="earn-periods refx-periods" role="group" aria-label="الفترة">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" aria-pressed={period === p.key}
            className={`rev-flag${period === p.key ? ' is-on' : ''}`} onClick={() => pick(p.key)}>{p.label}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="ref-from">من</label>
            <input id="ref-from" type="date" value={range.from}
              onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value > range.to ? e.target.value : range.to })} /></div>
          <div className="field"><label htmlFor="ref-to">إلى</label>
            <input id="ref-to" type="date" value={range.to} min={range.from}
              onChange={(e) => e.target.value && set({ to: e.target.value })} /></div>
        </div>
      )}

      {err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          {/* ١) كم لنا؟ */}
          <section className="refx-hero" aria-label="المستحقّ">
            <div className="refx-hero-main">
              <span className="refx-hero-label">المستحقّ لنا على {whom}</span>
              <Money value={due} className="refx-hero-value" />
              <span className="refx-hero-sub">
                {scoped.length ? <>{visitsText(scoped.length)} لـ{patientsText(patients)}، {rangeWords(range.from, range.to)}</>
                  : <>لا إحالات {rangeWords(range.from, range.to)}</>}
              </span>
            </div>
            {parts.length > 1 && (
              <ul className="refx-parts" aria-label="من أين">
                {parts.map((p) => (
                  <li key={p.k}><span>{p.label}</span><Money value={p.v} /></li>
                ))}
              </ul>
            )}
            <div className="refx-hero-actions">
              <button type="button" disabled={exporting || scoped.length === 0} onClick={doExport}>
                {exporting ? 'جارٍ التصدير…' : chosenName || onlyOne ? 'كشف الحساب (إكسل)' : 'كشف كلّ الجهات (إكسل)'}
              </button>
              <span className="refx-hero-hint">الملفّ الذي يُرسل للجهة: كلّ زيارةٍ برقم ورقتها.</span>
            </div>
          </section>

          {/* ٢) على أيّ جهة؟ — حين تكون أكثر من جهة في الفترة */}
          {totals.length > 1 && (
            <div className="refx-sources" role="group" aria-label="الجهة">
              <button type="button" aria-pressed={!sourceId} className={`refx-source${!sourceId ? ' is-on' : ''}`}
                onClick={() => set({ source: null })}>
                <span className="refx-source-name">كلّ الجهات</span>
                <Money value={data.total_due} className="refx-source-amt" />
                <span className="refx-source-sub">{visitsText(data.visits)}</span>
              </button>
              {totals.map((t) => {
                const off = sources?.find((s) => String(s.id) === String(t.source_id) && !s.is_active)
                return (
                  <button key={t.source_id} type="button" aria-pressed={sourceId === String(t.source_id)}
                    className={`refx-source${sourceId === String(t.source_id) ? ' is-on' : ''}`}
                    onClick={() => set({ source: String(t.source_id) })}>
                    <span className="refx-source-name">{t.source}{off && <span className="badge sm">موقوفة</span>}</span>
                    <Money value={t.due} className="refx-source-amt" />
                    <span className="refx-source-sub">{visitsText(t.visits)}</span>
                    <span className="refx-source-bar" aria-hidden="true">
                      <span style={{ width: `${data.total_due > 0 ? Math.round((t.due / data.total_due) * 100) : 0}%` }} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ٣) على مَن؟ — كشف الحساب يوماً بيوم */}
          {scoped.length > 0 && (
            <section className="card refx-list" aria-label="الزيارات">
              <div className="refx-list-head">
                <h3>الزيارات{chosenName ? ` على ${chosenName}` : ''}</h3>
                <div className="refx-tools">
                  {missing > 0 && (
                    <button type="button" aria-pressed={missingOnly} className={`rev-flag is-norule${missingOnly ? ' is-on' : ''}`}
                      onClick={() => set({ missing: missingOnly ? null : '1' })}
                      title="الجهة تطلب رقم الورقة لكلّ زيارة">
                      بلا رقم ورقة <span className="rev-flag-n">{fmtNum(missing)}</span>
                    </button>
                  )}
                  <input type="search" className="refx-search" value={q} placeholder="ابحث باسم المريض أو الدكتور أو رقم الورقة"
                    aria-label="بحث" onChange={(e) => set({ q: e.target.value })} />
                </div>
              </div>
              {days.length === 0 ? <p className="empty">لا زيارات تطابق البحث.</p> : days.map(([day, vs]) => (
                <div key={day} className="refx-day">
                  <div className="refx-day-head">
                    <span>{fmtWeekday(day)}</span>
                    <span className="refx-day-sum"><span className="refx-day-n">{visitsText(vs.length)}</span><Money value={vs.reduce((s, v) => s + v.due, 0)} /></span>
                  </div>
                  <ul className="refx-visits">
                    {vs.map((v) => <VisitRow key={v.key} v={v} showSource={!sourceId && totals.length > 1} />)}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {managing && sources && (
        <SourcesDialog sources={sources} canWrite={canWrite} showToast={showToast}
          onClose={() => setManaging(false)} onChanged={loadSources} />
      )}
    </div>
  )
}
