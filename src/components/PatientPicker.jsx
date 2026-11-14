import { useEffect, useRef, useState } from 'react'
import { api, toLatinDigits } from '../api.js'
import { ComboPanel } from './Combobox.jsx'

// ═══ البحث عن مريض في الاستقبال — مصدرٌ واحد للحجز وجلسة الحديد وتغيير المريض ═══
// قائمةٌ منسدلة تحت خانة الاسم **وهي تكتب** (2026-11-14، قرار المستخدم): من حرفين، أقرب ٨،
// الاسم وحده بكلّ سطر. الاسم الأوّل صح والأب والكنية بتسامح، و«البلشة» = «بلشة» (الخادم يرتّب).
// الكبس على سطر (أو الأسهم ثمّ Enter) = «هو نفسه»: الآن فقط تُقرأ بيانات المريض. النظام لا يختار ولا يدمج.
// والبحث **بالاسم وحده** (2026-11-12): الرقم ليس فريداً ولا يُبحث به.
// والاسم الثلاثي المطابق (أو بفرق «ال») لا يتكرّر: «مريض جديد» به ممنوع — تختار الموجود أو تضيف للاسم.

const DEBOUNCE_MS = 180
const letters = (v) => String(v || '').replace(/\s/g, '').length

export function usePatientSearch() {
  const [found, setFound] = useState({ results: [], matches: [], similar: [], complete: false })
  const [picked, setPicked] = useState(null)       // بيانات المختار بعد «هو نفسه»
  const [pending, setPending] = useState(0)
  const [dismissed, setDismissed] = useState(false) // اختارت «مريض جديد» أو Esc — تُطوى القائمة
  const [pickError, setPickError] = useState(null)
  const [done, setDone] = useState(false)           // آخر بحثٍ انتهى (لـ«غير موجود»)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)          // السطر المضاء بالأسهم
  // ردٌّ متأخّر لبحثٍ قديم لا يطمس نتيجة أحدث (الكتابة أسرع من الشبكة)
  const seq = useRef(0)
  const timer = useRef(null)
  const anchorRef = useRef(null)                    // خانة الاسم: اللوحة تُرسم تحتها
  useEffect(() => () => clearTimeout(timer.current), [])

  const EMPTY = { results: [], matches: [], similar: [], complete: false }
  const byName = (v) => {
    if (picked) return
    setDismissed(false); setDone(false); setActive(-1)
    clearTimeout(timer.current)
    const n = ++seq.current
    if (letters(v) < 2) { setFound(EMPTY); return }
    timer.current = setTimeout(async () => {
      setPending((p) => p + 1)
      try {
        const r = await api.clinic.suggestPatients(v)
        if (seq.current === n) {
          setFound({ results: r?.results || [], matches: r?.matches || [], similar: r?.similar || [], complete: !!r?.complete })
          setDone(true)
        }
      } catch { if (seq.current === n) { setFound(EMPTY); setDone(true) } }
      finally { setPending((p) => p - 1) }
    }, DEBOUNCE_MS)
  }

  // «هو نفسه»: الآن فقط تُقرأ بيانات المريض
  const pick = async (c) => {
    setPickError(null)
    try {
      const p = await api.clinic.patient(c.id)
      seq.current++; clearTimeout(timer.current)
      setPicked(p); setFound(EMPTY); setActive(-1)
      return p
    } catch (ex) { setPickError(ex.message); return null }
  }
  const reset = () => {
    seq.current++; clearTimeout(timer.current)
    setPicked(null); setFound(EMPTY); setDismissed(false); setPickError(null); setDone(false); setActive(-1)
  }
  const dismiss = () => { setDismissed(true); setActive(-1) }

  const results = picked || dismissed ? [] : found.results
  const open = focused && results.length > 0
  // من يُسأل عنه عند «مريض جديد»: المطابقون ثمّ المشابهون (منهم من فرقه حرفٌ بالاسم الأوّل)
  const nearNames = [...found.matches, ...found.similar.filter((s) => !found.matches.some((m) => String(m.id) === String(s.id)))]
  // والمطابقون وحدهم يمنعون «مريض جديد» منعاً (لا «نعم، مريض جديد»)
  const exactNames = found.matches
  // «غير موجود عندنا»: الاسم الثلاثي بحثه انتهى بلا أحد قريب
  const noMatch = !picked && done && pending === 0 && found.complete && found.results.length === 0 && found.similar.length === 0

  // تُنشر على خانة الاسم: الأسهم تتنقّل، وEnter يختار المضاء، وEsc يطوي.
  // onPick: ما يفعله المستعمل بالاختيار (الحجز يقرأ بياناته، وتغيير المريض يربطه مباشرةً).
  const inputProps = (onPick) => ({
    ref: anchorRef, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': open,
    'aria-controls': 'patient-suggest', autoComplete: 'off',
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); setActive(-1) },
    onKeyDown: (e) => {
      if (!open) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % results.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? results.length - 1 : a - 1)) }
      else if (e.key === 'Enter' && active >= 0 && results[active]) { e.preventDefault(); onPick(results[active]) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss() }
    },
  })
  const close = () => { setFocused(false); setActive(-1) }
  return { results, open, active, setActive, anchorRef, close, complete: found.complete, nearNames, exactNames, picked,
    checking: pending > 0, noMatch, pickError, byName, pick, reset, dismiss, inputProps }
}

// القائمة المنسدلة نفسها — تُوضع بعد خانة الاسم (التي نُشرت عليها inputProps).
// سطرٌ لكل مريض فيه الاسم وحده، والكبس يختار. وتحتها «مريض جديد» إن كان الاسم ثلاثياً.
// اللوحة ComboPanel نفسها (بثيم القوائم، فوق النافذة لا داخلها فلا تُقصّ).
// ★ onMouseDown + preventDefault: الاختيار قبل أن يخرج التركيز من الخانة فتُطوى القائمة.
export function PatientDropdown({ search, onPick, onNew, newLabel = 'مريض جديد — ليس من هؤلاء', disabled = false, note = null }) {
  const listRef = useRef(null)
  useEffect(() => { listRef.current?.querySelector('li.active')?.scrollIntoView({ block: 'nearest' }) }, [search.active])
  if (!search.open) return null
  const choose = (fn) => (e) => { e.preventDefault(); if (!disabled) fn() }
  return (
    <ComboPanel anchorRef={search.anchorRef} onClose={search.close}>
      {note && <div className="ps-note">{note}</div>}
      <ul className="combobox-list combo-list ps-list" role="listbox" id="patient-suggest" aria-label="المرضى المسجّلون" ref={listRef}>
        {search.results.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === search.active}
            className={[i === search.active && 'active', disabled && 'is-off'].filter(Boolean).join(' ') || undefined}
            onMouseDown={choose(() => onPick(c))} onMouseEnter={() => search.setActive(i)}>
            <span className="cb-main">{c.full_name}</span>
          </li>
        ))}
        {onNew && search.complete && (
          <li className="cb-more ps-new" role="option" aria-selected={false} onMouseDown={choose(onNew)}>{newLabel}</li>
        )}
      </ul>
    </ComboPanel>
  )
}

// «مريض جديد» باسمٍ لمسجَّل:
//   • مشابه (فرق حرف، اسم جدّ زائد) ⇒ «لا، هو نفسه» يختاره، و«نعم، شخص آخر» يُنشئ جديداً —
//     **بسنة ميلاده** (إلزامية: الدليل أنه غيره؛ والخادم يمنع إن طابقت سنة القريب).
//   • مطابق (blocked) ⇒ منعٌ: «هو نفسه» وحده، أو تعديل الاسم في خانته (يطوي هذا الصندوق).
//     ومثله «القريب بنفس سنة الميلاد» من الخادم (message رسالته).
// matches: المطابقون، أو المشابهون (الأقرب أولاً).
const BLOCKING = ['NAME_EXISTS', 'SIMILAR_SAME_BIRTH_YEAR']
export function blockedName(ex) {
  return BLOCKING.includes(ex?.data?.code) ? (ex.data.matches || []) : null
}
// اسمٌ يقبله الخادم: أحرفٌ عربية ومسافات فقط (نفس ARABIC_NAME_RE هناك) — للتنبيه أثناء الكتابة
const ARABIC_NAME_RE = /^[\u0621-\u063A\u0640-\u0652\u0670\u0671\u067E\u0686\u0698\u06A9\u06AF\u06CC ]*$/
export const nameCharsError = (v) => (ARABIC_NAME_RE.test(String(v || '').replace(/\s+/g, ' '))
  ? null : 'الاسم أحرف عربية فقط — بلا أرقام ولا رموز ولا أحرف إنكليزية')
const YEAR_MIN = 1900
const okYear = (y) => /^\d{4}$/.test(y) && Number(y) >= YEAR_MIN && Number(y) <= new Date().getFullYear()

export function SameNameConfirm({ matches, blocked = false, message = null, defaultYear = '', onPick, onConfirm, disabled = false }) {
  const [year, setYear] = useState(defaultYear ? String(defaultYear) : '')
  if (!matches?.length) return null
  if (blocked) return (
    <div className="candidates-box name-taken" role="alertdialog" aria-live="assertive">
      <div className="candidates-title">
        {message || <>هذا الاسم مسجّل لمريض: <strong>{matches[0].full_name}</strong>. إذا كان هو نفسه اختاريه، وإذا كان شخصاً آخر
        أضيفي اسم الجد أو الكنية للاسم — لا يُسجَّل مريضان بالاسم نفسه.</>}
      </div>
      {matches.map((c) => (
        <div key={c.id} className="candidate-row">
          <div><strong>{c.full_name}</strong></div>
          <button type="button" className="ghost" disabled={disabled} onClick={() => onPick(c)}>هو نفسه</button>
        </div>
      ))}
    </div>
  )
  return (
    <div className="candidates-box" role="alertdialog" aria-live="assertive">
      <div className="candidates-title">
        يوجد مريض مسجّل باسم قريب: {matches[0].full_name}. هل هو شخص آخر؟ إذا كان شخصاً آخر اكتبي سنة ميلاده
        (ويُفضَّل إضافة اسم الجد).
      </div>
      {matches.length > 1 && matches.map((c) => (
        <div key={c.id} className="candidate-row">
          <div><strong>{c.full_name}</strong></div>
          <button type="button" className="ghost" disabled={disabled} onClick={() => onPick(c)}>هو نفسه</button>
        </div>
      ))}
      <div className="candidate-row">
        {matches.length === 1 && (
          <button type="button" className="ghost" disabled={disabled} onClick={() => onPick(matches[0])}>لا، هو نفسه</button>
        )}
        <label className="similar-year">
          سنة ميلاده
          <input value={year} inputMode="numeric" placeholder="1990" maxLength={4} disabled={disabled}
            aria-label="سنة ميلاد المريض الجديد" onChange={(e) => setYear(toLatinDigits(e.target.value).replace(/\D/g, ''))} />
        </label>
        <button type="button" disabled={disabled || !okYear(year)} onClick={() => onConfirm(Number(year))}
          title={okYear(year) ? '' : 'اكتبي سنة الميلاد أوّلاً'}>نعم، شخص آخر</button>
      </div>
    </div>
  )
}

// المريض المختار برقمٍ غير رقمه المسجَّل: لا يتغيّر الرقم من تلقاء نفسه
export function MobileUpdateAsk({ storedMobile, onUpdate, onKeep, disabled = false }) {
  return (
    <div className="candidates-box" role="alertdialog" aria-live="assertive">
      <div className="candidates-title">
        {storedMobile
          ? 'رقم هذا المريض المسجّل مختلف. هل تريدين تحديثه؟'
          : 'هذا المريض بلا رقم مسجّل. هل تريدين إضافة الرقم المكتوب له؟'}
      </div>
      <div className="candidate-row">
        <button type="button" disabled={disabled} onClick={onUpdate}>نعم، حدّثيه</button>
        <button type="button" className="ghost" disabled={disabled} onClick={onKeep}>لا، اتركيه</button>
      </div>
    </div>
  )
}
