import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { useToast } from '../action-feedback.jsx'
import { useRole } from '../RoleContext.jsx'
import { canFixDuplicatePatients } from '../permissions.js'
import { matchesAr } from '../arabic-search.js'

// ═══ العيادات — المرضى المكرّرون ═══
// الاسم الثلاثي لا يتكرّر منذ 2026-11-11، وما سبق القرار تُرتّبه المشرفة هنا مجموعةً مجموعة:
//   • نفس الشخص ⇒ «ادمج»: ملفٌّ أساسي يبقى، وزيارات المحدَّدين وجلسات حديدهم تنتقل إليه، وما نقصه
//     من رقمٍ أو جنسٍ أو سنةٍ يُكمَل منهم، ثمّ يُحذفون (ولقطتهم في السجلّ).
//   • شخصٌ آخر ⇒ «اسمٌ مميَّز»: يُضاف اسم الجد أو الكنية فيخرج من المجموعة.
// كلّ ما يلزم للقرار ظاهر: الرقم، الجنس والسنة، الزيارات وآخرها وعند من، وجلسات الحديد.
// المشرف العام يطالع بلا أزرار (الخادم يردّ كتابته 403).

const fmtInt = (n) => Number(n || 0).toLocaleString('ar-SY')
const visitsAr = (n) => (n === 0 ? 'بلا زيارات' : n === 1 ? 'زيارة واحدة' : n === 2 ? 'زيارتان'
  : `${fmtInt(n)} ${n <= 10 ? 'زيارات' : 'زيارة'}`)
// «ملفّان» مرفوعةً، و«ملفّين» بعد حرف جرٍّ أو مفعولاً (gen)
const filesAr = (n, gen = false) => (n === 2 ? (gen ? 'ملفّين' : 'ملفّان') : `${fmtInt(n)} ${n <= 10 ? 'ملفّات' : 'ملفّاً'}`)
const namesAr = (n) => (n === 1 ? 'اسمٌ مكرّر واحد' : n === 2 ? 'اسمان مكرّران'
  : `${fmtInt(n)} ${n <= 10 ? 'أسماء مكرّرة' : 'اسماً مكرّراً'}`)
const GENDER = { male: 'ذكر', female: 'أنثى' }
const STATUS = { done: 'كشف', waiting: 'محجوز', arrived: 'حاضر', in_service: 'عند الطبيب',
  waiting_return: 'خروج مؤقت', no_show: 'لم يحضر' }

// الأساسيّ المقترح: الأكثر زيارات، ثمّ الأكثر حديداً، ثمّ الأقدم (أوّل المجموعة)
const suggestKeep = (ps) => ps.reduce((best, p) =>
  (p.visits + p.iron > best.visits + best.iron ? p : best), ps[0]).id

function PatientRow({ p, isKeep, checked, canFix, busy, onKeep, onCheck, onRename }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.full_name)
  const [err, setErr] = useState(null)
  const save = async (e) => {
    e.preventDefault(); setErr(null)
    const r = await onRename(p, name)
    if (r) setErr(r); else setEditing(false)
  }
  const facts = [
    p.mobile ? <span key="m" dir="ltr">{p.mobile}</span> : <span key="m" className="dup-none">بلا رقم</span>,
    p.gender ? GENDER[p.gender] : null,
    p.birth_year ? `مواليد ${p.birth_year}` : null,
  ].filter(Boolean)
  return (
    <li className={`dup-row${isKeep ? ' is-keep' : ''}${!isKeep && checked ? ' is-merge' : ''}`}>
      {canFix && (
        <div className="dup-pick">
          <label className="dup-radio" title="الملف الذي يبقى">
            <input type="radio" checked={isKeep} disabled={busy} onChange={onKeep} /> أساسي
          </label>
          {!isKeep && (
            <label className="dup-check" title="نفس الشخص — يُدمج في الأساسي">
              <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => onCheck(e.target.checked)} /> نفس الشخص
            </label>
          )}
        </div>
      )}
      <div className="dup-main">
        {editing ? (
          <form className="dup-rename" onSubmit={save}>
            <input value={name} autoFocus disabled={busy} aria-label="الاسم المميَّز"
              onChange={(e) => { setName(e.target.value); setErr(null) }} />
            <button type="submit" disabled={busy || !name.trim()}>حفظ الاسم</button>
            <button type="button" className="ghost" disabled={busy}
              onClick={() => { setEditing(false); setName(p.full_name); setErr(null) }}>إلغاء</button>
            <small className="hint">أضيفي اسم الجد أو الكنية ليتميّز عن غيره</small>
            {err && <p className="error">{err}</p>}
          </form>
        ) : (
          <div className="dup-name">
            <strong>{p.full_name}</strong>
            <span className="dup-id">ملف #{p.id}</span>
            {isKeep && canFix && <span className="badge good sm">يبقى</span>}
            {!isKeep && checked && canFix && <span className="badge warn sm">يُدمج</span>}
          </div>
        )}
        <div className="dup-facts">{facts.reduce((acc, f, i) => (i ? [...acc, '، ', f] : [f]), [])}</div>
        <div className="dup-visits">
          <span className={p.visits ? '' : 'dup-none'}>{visitsAr(p.visits)}</span>
          {p.last_visit && (
            <span>آخرها <bdi dir="ltr">{p.last_visit.date}</bdi> عند {p.last_visit.doctor}
              {STATUS[p.last_visit.status] ? ` (${STATUS[p.last_visit.status]})` : ''}</span>
          )}
          {p.doctors?.length > 1 && <span>الدكاترة: {p.doctors.join('، ')}</span>}
          {p.iron > 0 && <span>حديد: {fmtInt(p.iron)}</span>}
          <span className="dup-created">أُنشئ <bdi dir="ltr">{p.created_on}</bdi></span>
        </div>
      </div>
      {canFix && !editing && (
        <button type="button" className="ghost dup-other" disabled={busy} onClick={() => setEditing(true)}>
          شخص آخر؟ ميّزي اسمه
        </button>
      )}
    </li>
  )
}

function Group({ g, canFix, onMerge, onRename }) {
  const [keep, setKeep] = useState(() => suggestKeep(g.patients))
  const [checked, setChecked] = useState(() => new Set(g.patients.map((p) => p.id)))
  const [busy, setBusy] = useState(false)
  const mergeIds = g.patients.filter((p) => p.id !== keep && checked.has(p.id)).map((p) => p.id)
  const toggle = (id, on) => setChecked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const run = async (fn) => { setBusy(true); try { return await fn() } finally { setBusy(false) } }
  return (
    <section className="card dup-group" aria-label={g.patients[0].full_name}>
      <header className="dup-head">
        <h3>{g.patients[0].full_name}</h3>
        <span className="badge blue sm">{filesAr(g.patients.length)} بالاسم نفسه</span>
      </header>
      <ul className="dup-list">
        {g.patients.map((p) => (
          <PatientRow key={p.id} p={p} canFix={canFix} busy={busy}
            isKeep={p.id === keep} checked={checked.has(p.id)}
            onKeep={() => setKeep(p.id)} onCheck={(on) => toggle(p.id, on)}
            onRename={(pt, name) => run(() => onRename(pt, name))} />
        ))}
      </ul>
      {canFix && (
        <div className="dup-actions">
          <button type="button" disabled={busy || mergeIds.length === 0}
            onClick={() => run(() => onMerge(g, keep, mergeIds))}>
            {mergeIds.length ? `ادمج ${mergeIds.length === 1 ? 'الملف' : mergeIds.length === 2 ? 'الملفّين' : filesAr(mergeIds.length)} في الأساسي` : 'اختاري «نفس الشخص» للدمج'}
          </button>
          <small className="hint">إن كانوا أشخاصاً مختلفين: «ميّزي اسمه» لكلٍّ منهم إلّا واحداً</small>
        </div>
      )}
    </section>
  )
}

function History({ rows }) {
  if (!rows.length) return null
  return (
    <details className="card dup-history">
      <summary>آخر ما رُتِّب ({fmtInt(rows.length)})</summary>
      <ul>
        {rows.map((h) => (
          <li key={h.id}>
            <bdi dir="ltr" className="dup-when">{new Date(h.changed_at).toLocaleString('en-GB', { timeZone: 'Asia/Damascus', dateStyle: 'short', timeStyle: 'short' })}</bdi>
            {h.action === 'merge'
              ? <span>دُمج ملف #{h.merged_id} ({h.merged_name}) في #{h.patient_id || '—'}
                  {h.appointments ? ` — ${visitsAr(h.appointments)} نُقلت` : ''}{h.iron ? `، حديد ${fmtInt(h.iron)}` : ''}</span>
              : <span>«{h.old_name}» صار «{h.new_name}»</span>}
            <span className="dup-by">{h.by_name}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function DuplicatePatients() {
  const { clinicRole } = useRole()
  const canFix = canFixDuplicatePatients(clinicRole)
  const dlg = useDialogs()
  const [toast, showToast] = useToast()
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const load = async () => {
    try {
      const [d, h] = await Promise.all([api.clinic.duplicatePatients(), api.clinic.patientIdentityHistory()])
      setData(d); setHistory(h); setErr(null)
    } catch (ex) { setErr(ex.message) }
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => (data?.groups || [])
    .filter((g) => !q.trim() || g.patients.some((p) => matchesAr(p.full_name, q) || (p.mobile || '').includes(q.trim()))), [data, q])

  const onMerge = async (g, keepId, mergeIds) => {
    const keep = g.patients.find((p) => p.id === keepId)
    const gone = g.patients.filter((p) => mergeIds.includes(p.id))
    const visits = gone.reduce((t, p) => t + p.visits, 0), iron = gone.reduce((t, p) => t + p.iron, 0)
    const ok = await dlg.confirm({
      title: 'دمج ملفّات المريض',
      body: `${gone.map((p) => `#${p.id}`).join('، ')} ⇐ الملف الأساسي #${keep.id}.\n`
        + `${visits ? `تنتقل ${visitsAr(visits)}` : 'لا زيارات تنتقل'}${iron ? ` و${fmtInt(iron)} جلسة حديد` : ''}، `
        + 'ويُكمَل ما نقص الأساسيَّ من رقمٍ أو جنسٍ أو سنة، ثمّ تُحذف الملفّات المدموجة.\n'
        + 'تأكّدي أنهم الشخص نفسه — الرجوع ليس من هذه الشاشة.',
      confirmLabel: 'ادمج', danger: true,
    })
    if (!ok) return
    try {
      const r = await api.clinic.mergePatients(keepId, mergeIds)
      const filled = Object.keys(r.filled || {}).length
      showToast(`دُمج ${r.merged === 1 ? 'ملف' : filesAr(r.merged)} في #${keepId}${filled ? ' وأُكملت بياناته' : ''}`, 'success', 4000)
      load()
    } catch (ex) { showToast(ex.message) }
  }
  // يُعيد نصّ الخطأ ليظهر تحت الخانة، أو null بعد النجاح
  const onRename = async (p, name) => {
    try {
      await api.clinic.renamePatient(p.id, name)
      showToast('تميّز الاسم', 'success', 3000); load(); return null
    } catch (ex) { return ex.message }
  }

  return (
    <>
      <h2>المرضى المكرّرون</h2>
      <p className="subtitle">
        مرضى سُجّلوا أكثر من مرّة بالاسم الثلاثي نفسه قبل منع التكرار. لكلّ مجموعة: إن كانوا الشخص نفسه
        ادمجيهم في ملفٍّ واحد، وإن كانوا أشخاصاً مختلفين ميّزي أسماءهم. الرقم لا يحسم — العائلة تشترك برقم.
      </p>
      {toast}
      {err && <p className="error">{err}</p>}
      {!data && !err && <p className="empty">جارٍ التحميل…</p>}
      {data && (
        <>
          <div className="dup-bar">
            <div className="dup-count">
              {data.groups.length
                ? <>{namesAr(data.groups.length)} في {filesAr(data.patients, true)}</>
                : <strong className="dup-clean">لا مرضى مكرّرين ✓</strong>}
            </div>
            {data.groups.length > 0 && (
              <input type="search" className="dup-search" placeholder="ابحثي باسمٍ أو رقم…" value={q}
                onChange={(e) => setQ(e.target.value)} aria-label="بحث في المكرّرين" />
            )}
          </div>
          {q.trim() && groups.length === 0 && <p className="empty">لا مجموعة تطابق البحث</p>}
          {groups.map((g) => (
            // المفتاح بأعضاء المجموعة: دمجٌ أو تمييزٌ يعيد بناءها باختياراتٍ جديدة
            <Group key={`${g.key}:${g.patients.map((p) => p.id).join(',')}`} g={g} canFix={canFix}
              onMerge={onMerge} onRename={onRename} />
          ))}
          <History rows={history} />
        </>
      )}
    </>
  )
}
