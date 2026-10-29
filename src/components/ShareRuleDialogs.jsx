import { useEffect, useId, useRef, useState } from 'react'
import { api, fmtMoney, fmtDateTime, toLatinDigits } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { matchesAr } from '../arabic-search.js'
import { doctorMatches } from '../doctor-search.js'
import { Modal, EmptyState } from './inventory/shared.jsx'
import { ruleText, checkRule, doctorsCount, pricingText } from '../share-rule.js'

// ═══ نوافذ قواعد الحصّة: إضافة/تعديل قاعدة دكتور، وتوزيع قاعدةٍ على عدّة دكاترة، وتاريخ التسعيرة ═══
// كلّها Modal القائم بخيار sheet (ورقة سفلية < 768px) كنافذة «إضافة دكتور»، والأزرار والخطأ في
// شريطٍ ثابت أسفلها. والإغلاق (Esc، النقر خارجها، «إلغاء») يسأل أولاً إن كُتب شيء.

/** إغلاقٌ يسأل «تجاهل التغييرات؟» إن كانت النافذة متّسخة — سؤالٌ واحد ولو وصل Esc مرّتين */
function useGuardedClose(dirty, onClose, body) {
  const dlg = useDialogs()
  const asking = useRef(false)
  return async () => {
    if (asking.current) return
    if (dirty) {
      asking.current = true
      const ok = await dlg.confirm({ title: 'تجاهل التغييرات؟', body, confirmLabel: 'تجاهل',
        cancelLabel: 'متابعة', danger: true })
      asking.current = false
      if (!ok) return
    }
    onClose()
  }
}

/** حقلا القاعدة كما كانا في البروفايل: النوع (مبلغ ثابت / نسبة) والقيمة — مع الخطأ والتحذير تحتهما */
export function RuleFields({ kind, value, price, onChange, showErrors, autoFocus }) {
  const uid = useId()
  const chk = checkRule(kind, value, price)
  return (
    <div className="rule-fields">
      <div className="field">
        <label htmlFor={`${uid}-k`}>النوع</label>
        <select id={`${uid}-k`} value={kind} onChange={(e) => onChange({ kind: e.target.value, value })}>
          <option value="fixed">مبلغ ثابت</option>
          <option value="percent">نسبة ٪ مختلفة</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-v`}>{kind === 'percent' ? 'النسبة ٪' : 'المبلغ (ل.س)'}</label>
        <input id={`${uid}-v`} value={value} inputMode="decimal" autoFocus={autoFocus}
          placeholder={kind === 'percent' ? 'مثلاً 40' : 'مثلاً 20000'}
          aria-invalid={showErrors && !!chk.error}
          onChange={(e) => onChange({ kind, value: toLatinDigits(e.target.value) })} />
      </div>
      {showErrors && chk.error && <p className="error rule-msg" role="alert">{chk.error}</p>}
      {!chk.error && chk.warning && <p className="share-warn rule-msg" role="status">⚠ {chk.warning}</p>}
      <p className="hint rule-msg">
        {kind === 'percent'
          ? 'تُحسب بعد خصم المواد: (السعر − المواد) × النسبة.'
          : 'المبلغ كما هو للدكتور، لا تمسّه المواد.'}
        {price != null && <> سعر الإجراء الحالي {fmtMoney(price)}.</>}
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// إضافة قاعدة / تعديلها — من بروفايل الدكتور
// الإضافة: الإجراء (بحث) ثمّ القاعدة. وإجراءٌ له قاعدةٌ عند الدكتور لا يُضاف ثانيةً: النافذة
// تعرض القائمة وتعرض تعديلها بدلها (والخادم يردّ 409 SHARE_RULE_EXISTS إن سبقت نقرةٌ أخرى).
// التعديل: الإجراء ثابت، والحفظ على السطر نفسه (نفس id).
// ═══════════════════════════════════════════════════════════════════
export function ShareRuleDialog({ doctor, rule, rules, catalog, onClose, onSaved }) {
  const [editing, setEditing] = useState(rule || null)   // القاعدة التي تُعدَّل (null = إضافة)
  const [procId, setProcId] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(rule
    ? { kind: rule.share_kind, value: String(Number(rule.share_value)) } : { kind: 'fixed', value: '' })
  const [showErrors, setShowErrors] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()

  const initial = rule ? { kind: rule.share_kind, value: String(Number(rule.share_value)) } : { kind: 'fixed', value: '' }
  const dirty = (!rule && procId !== '') || form.kind !== initial.kind || form.value !== initial.value
  const close = useGuardedClose(dirty, onClose, 'القاعدة المكتوبة لن تُحفظ.')

  const procs = catalog || []
  const chosen = editing ? { id: editing.procedure_id, name: editing.procedure_name, price: editing.price }
    : procs.find((p) => String(p.id) === procId)
  const existingFor = (id) => (rules || []).find((r) => String(r.procedure_id) === String(id))
  const clash = !editing && chosen ? existingFor(chosen.id) : null
  const shown = procs.filter((p) => matchesAr(p.name, query))
  const switchToEdit = (r) => {
    setEditing(r); setForm({ kind: r.share_kind, value: String(Number(r.share_value)) }); setErr(null); setShowErrors(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    setShowErrors(true); setErr(null)
    if (!chosen) { setErr('الإجراء: اختر إجراءً من القائمة'); return }
    if (clash) { setErr(`لـ«${chosen.name}» قاعدةٌ حالياً — عدّلها بدل إضافة ثانية`); return }
    const chk = checkRule(form.kind, form.value, chosen.price)
    if (chk.error) return
    setBusy(true)
    try {
      const body = { share_kind: form.kind, share_value: form.value }
      const out = editing
        ? await api.clinic.setDoctorProcedureShare(doctor.id, editing.procedure_id, body)
        : await api.clinic.addDoctorProcedureShare(doctor.id, { ...body, procedure_id: Number(chosen.id) })
      onSaved(out, editing ? `عُدِّلت قاعدة «${chosen.name}»` : `أُضيفت قاعدة «${chosen.name}»`)
    } catch (ex) {
      if (ex.data?.code === 'SHARE_RULE_EXISTS' && ex.data.existing) {
        switchToEdit(ex.data.existing)
        setErr('أُضيفت قاعدةٌ لهذا الإجراء قبل لحظة — عُرضت هنا لتعديلها')
      } else setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={editing ? `تعديل قاعدة «${editing.procedure_name}»` : 'إضافة قاعدة خاصّة'}
      subtitle={`${doctor.name} — تسري على الإجراءات القادمة وحدها، وما سُجِّل قبلها يبقى كما هو.`}
      onClose={close} busy={busy} sheet>
      <form className="rule-dialog" onSubmit={submit}>
        {editing ? (
          <p className="rule-proc-fixed">الإجراء: <strong>{editing.procedure_name}</strong>
            <span className="muted"> — سعره الحالي {fmtMoney(editing.price)}</span></p>
        ) : (
          <fieldset className="rule-step">
            <legend>أولاً: الإجراء</legend>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
              placeholder="ابحث باسم الإجراء…" aria-label="ابحث في الإجراءات" />
            <div className="pick-list" role="radiogroup" aria-label="الإجراء">
              {shown.length === 0 && <p className="empty">لا إجراء بهذا الاسم</p>}
              {shown.map((p) => {
                const ex = existingFor(p.id)
                return (
                  <label key={p.id} className={`pick-row${String(p.id) === procId ? ' on' : ''}`}>
                    <input type="radio" name={`${uid}-proc`} value={p.id} checked={String(p.id) === procId}
                      onChange={() => { setProcId(String(p.id)); setErr(null) }} />
                    <span className="pick-name">{p.name}</span>
                    <span className="pick-meta">{fmtMoney(p.price)}</span>
                    {ex && <span className="badge">له قاعدة</span>}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}
        {clash && (
          <div className="rule-clash" role="status">
            <p>لـ«{chosen.name}» قاعدةٌ حالياً عند {doctor.name}: <strong>{ruleText(clash)}</strong>.
              لا تُضاف قاعدتان لإجراءٍ واحد.</p>
            <button type="button" onClick={() => switchToEdit(clash)}>عدّلها بدلاً من ذلك</button>
          </div>
        )}
        {!clash && (
          <fieldset className="rule-step">
            {!editing && <legend>ثانياً: القاعدة</legend>}
            <RuleFields kind={form.kind} value={form.value} price={chosen?.price ?? null} showErrors={showErrors}
              autoFocus={!!editing} onChange={(f) => { setForm(f); setErr(null) }} />
          </fieldset>
        )}
        <div className="dialog-actions">
          {err && <p className="error" role="alert">{err}</p>}
          <button type="submit" disabled={busy || !!clash}>{busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'إضافة القاعدة'}</button>
          <button type="button" className="ghost" disabled={busy} onClick={close}>إلغاء</button>
        </div>
      </form>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// توزيع قاعدةٍ على عدّة دكاترة — من صفحة الإجراءات، بثلاث مراحل:
//   ١ القاعدة   ٢ الدكاترة (الفعّالون، بحثٌ متسامح بالهمزات + اختصاص + «تحديد الكل» للمعروضين)
//   ٣ المعاينة  (من له قاعدةٌ قائمة: «تخطّيهم» افتراضاً أو «استبدال»)
// والتنفيذ معاملةٌ واحدة في الخادم: كلّه أو لا شيء.
// ═══════════════════════════════════════════════════════════════════
const STEPS = ['القاعدة', 'الدكاترة', 'المعاينة']
export function DistributeRuleDialog({ procedure, onClose, onDone }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ kind: 'fixed', value: '' })
  const [showErrors, setShowErrors] = useState(false)
  const [doctors, setDoctors] = useState(null)
  const [existing, setExisting] = useState(null)   // Map doctor_id ⇒ قاعدته على هذا الإجراء
  const [query, setQuery] = useState('')
  const [spec, setSpec] = useState('')             // '' = كل الاختصاصات
  const [picked, setPicked] = useState(() => new Set())
  const [onExisting, setOnExisting] = useState('skip')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()

  useEffect(() => {
    Promise.all([api.clinic.doctors(), api.clinic.procedureDoctorShares(procedure.id)])
      .then(([ds, rs]) => {
        setDoctors(ds.filter((d) => d.is_active))
        setExisting(new Map(rs.map((r) => [String(r.doctor_id), r])))
      })
      .catch((e) => setErr(e.message))
  }, [procedure.id])

  const dirty = form.value !== '' || picked.size > 0
  const close = useGuardedClose(dirty, onClose, 'القاعدة والدكاترة المحدَّدون لن يُحفظوا.')
  const chk = checkRule(form.kind, form.value, procedure.price)

  const specOf = (d) => d.specialty_name || d.specialty || ''
  const specs = [...new Set((doctors || []).map(specOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'))
  const shown = (doctors || []).filter((d) => (!spec || specOf(d) === spec) && doctorMatches(d, query))
  const allShownPicked = shown.length > 0 && shown.every((d) => picked.has(String(d.id)))
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleShown = () => setPicked((s) => {
    const n = new Set(s)
    shown.forEach((d) => (allShownPicked ? n.delete(String(d.id)) : n.add(String(d.id))))
    return n
  })

  const chosen = (doctors || []).filter((d) => picked.has(String(d.id)))
  const fresh = chosen.filter((d) => !existing?.has(String(d.id)))
  const withRule = chosen.filter((d) => existing?.has(String(d.id)))
  const writes = fresh.length + (onExisting === 'replace' ? withRule.length : 0)

  const next = () => {
    setErr(null)
    if (step === 0) { setShowErrors(true); if (chk.error) return }
    if (step === 1 && picked.size === 0) { setErr('الدكاترة: اختر دكتوراً واحداً على الأقل'); return }
    setStep(step + 1)
  }
  const apply = async () => {
    setErr(null); setBusy(true)
    try {
      const out = await api.clinic.distributeRule(procedure.id, { share_kind: form.kind, share_value: form.value,
        doctor_ids: chosen.map((d) => Number(d.id)), on_existing: onExisting })
      onDone(out)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <Modal title="تطبيق قاعدة على دكاترة" subtitle={`«${procedure.name}» — سعره الحالي ${fmtMoney(procedure.price)}`}
      onClose={close} busy={busy} sheet wide>
      <ol className="stepper" aria-label="المراحل">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
            <span className="stepper-n">{i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="rule-step">
          <p className="hint">نفس القاعدة الخاصّة في بروفايل الدكتور — تُكتب عند كلٍّ منهم قاعدةً مستقلّة تُعدَّل من عنده لاحقاً.</p>
          <RuleFields kind={form.kind} value={form.value} price={procedure.price} showErrors={showErrors} autoFocus
            onChange={(f) => { setForm(f); setErr(null) }} />
        </div>
      )}

      {step === 1 && (
        <div className="rule-step">
          {!doctors ? <p className="empty">جارٍ التحميل…</p> : (
            <>
              <div className="doctors-search" role="search">
                <div className="doctors-search-box">
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                    placeholder="ابحث بالاسم أو الاختصاص أو الجوال…" aria-label="ابحث في الدكاترة" />
                  {query.trim() !== '' && (
                    <button type="button" className="doctors-search-clear" aria-label="مسح البحث" onClick={() => setQuery('')}>×</button>
                  )}
                </div>
              </div>
              {specs.length > 0 && (
                <div className="spec-chips" role="group" aria-label="الاختصاص">
                  <button type="button" className="spec-chip-btn" aria-pressed={spec === ''} onClick={() => setSpec('')}>الكل</button>
                  {specs.map((s) => (
                    <button key={s} type="button" className="spec-chip-btn" aria-pressed={spec === s}
                      onClick={() => setSpec(spec === s ? '' : s)}>{s}</button>
                  ))}
                </div>
              )}
              <div className="pick-bar">
                <button type="button" className="ghost" disabled={shown.length === 0} onClick={toggleShown}>
                  {allShownPicked ? 'إلغاء تحديد المعروضين' : `تحديد الكل (${shown.length})`}
                </button>
                <span className="doctors-count" aria-live="polite">المحدَّد: {picked.size} من {doctors.length}</span>
              </div>
              {shown.length === 0 ? (
                <EmptyState text="لا دكتور فعّال بهذا البحث" hint={query.trim() ? `لا نتائج لـ «${query.trim()}»` : undefined}>
                  <button type="button" className="ghost" onClick={() => { setQuery(''); setSpec('') }}>مسح البحث</button>
                </EmptyState>
              ) : (
                <div className="pick-list pick-list-tall">
                  {shown.map((d) => {
                    const ex = existing?.get(String(d.id))
                    return (
                      <label key={d.id} className={`pick-row${picked.has(String(d.id)) ? ' on' : ''}`}>
                        <input type="checkbox" checked={picked.has(String(d.id))} onChange={() => toggle(String(d.id))} />
                        <span className="pick-name">{d.name}</span>
                        <span className="pick-meta">{specOf(d) || 'بلا اختصاص'}</span>
                        {ex && <span className="badge warn" title="له قاعدة على هذا الإجراء">له قاعدة: {ruleText(ex)}</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="rule-step">
          <p className="dist-summary">
            {fresh.length > 0
              ? <>ستُضاف قاعدة <strong>{ruleText(form)}</strong> لإجراء <strong>«{procedure.name}»</strong> عند <strong>{doctorsCount(fresh.length)}</strong>.</>
              : <>لا دكتور جديد: كل المحدَّدين لهم قاعدةٌ على «{procedure.name}».</>}
          </p>
          {chk.warning && <p className="share-warn" role="status">⚠ {chk.warning}</p>}
          {fresh.length > 0 && <p className="dist-names">{fresh.map((d) => d.name).join('، ')}</p>}
          {withRule.length > 0 && (
            <section className="dist-existing" aria-labelledby={`${uid}-ex`}>
              <h4 id={`${uid}-ex`}>عند هؤلاء قاعدة حالياً ({withRule.length})</h4>
              <ul>
                {withRule.map((d) => (
                  <li key={d.id}>
                    <span className="pick-name">{d.name}</span>
                    <span className="muted">{ruleText(existing.get(String(d.id)))}
                      {onExisting === 'replace' ? <> ← <strong>{ruleText(form)}</strong></> : ' — تبقى كما هي'}</span>
                  </li>
                ))}
              </ul>
              <div className="seg" role="radiogroup" aria-label="من له قاعدة حالياً">
                {[['skip', 'تخطّيهم'], ['replace', 'استبدال']].map(([v, label]) => (
                  <label key={v} className={onExisting === v ? 'on' : undefined}>
                    <input type="radio" name={`${uid}-ex-mode`} value={v} checked={onExisting === v}
                      onChange={() => setOnExisting(v)} />{label}
                  </label>
                ))}
              </div>
            </section>
          )}
          <p className="hint">يسري على الإجراءات القادمة وحدها — ما سُجِّل قبلها يبقى بقاعدته. والتنفيذ كلّه أو لا شيء.</p>
        </div>
      )}

      <div className="dialog-actions">
        {err && <p className="error" role="alert">{err}</p>}
        {step < 2
          ? <button type="button" onClick={next} disabled={step === 1 && !doctors}>التالي</button>
          : <button type="button" onClick={apply} disabled={busy || writes === 0}>
              {busy ? 'جارٍ التطبيق…' : writes === 0 ? 'لا شيء يُكتب' : `تطبيق على ${doctorsCount(writes)}`}
            </button>}
        {step > 0 && <button type="button" className="ghost" disabled={busy} onClick={() => { setErr(null); setStep(step - 1) }}>السابق</button>}
        <button type="button" className="ghost" disabled={busy} onClick={close}>إلغاء</button>
      </div>
    </Modal>
  )
}

// ═══ تاريخ تسعيرة الإجراء: خطٌّ زمنيّ (التاريخ · التغيير · الموظف) — للمشرفة والمدير ═══
export function PricingHistoryDialog({ procedure, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.clinic.procedurePricingHistory(procedure.id).then(setData).catch((e) => setErr(e.message))
  }, [procedure.id])
  return (
    <Modal title={`تاريخ التسعيرة — ${procedure.name}`}
      subtitle="السعر وقواعد الدكاترة على هذا الإجراء: من غيّر، وماذا، ومتى. السجلّ يبدأ من تفعيل هذه الميزة."
      onClose={onClose} sheet wide>
      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : data.rows.length === 0 ? <p className="empty">لا تغييرات مسجَّلة بعد.</p>
        : (
          <ul className="change-log pricing-log">
            {data.rows.map((h) => (
              <li key={h.id}>
                <time dateTime={h.changed_at}>{fmtDateTime(h.changed_at)}</time>
                <span>
                  {pricingText(h, 'procedure')}
                  {h.action === 'distribute' && h.doctors?.length > 0 && (
                    <span className="pricing-names">{h.doctors.map((d) => d.doctor_name).join('، ')}</span>
                  )}
                </span>
                <span className="muted">— {h.changed_by_name || 'غير معروف'}</span>
              </li>
            ))}
          </ul>
        )}
      <div className="dialog-actions">
        <button type="button" className="ghost" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  )
}
