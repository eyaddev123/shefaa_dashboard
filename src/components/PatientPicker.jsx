import { useRef, useState } from 'react'
import { api, cleanMobile, toLatinDigits } from '../api.js'

// ═══ البحث عن مريض في الاستقبال — مصدرٌ واحد للحجز وجلسة الحديد وتغيير المريض ═══
// النتيجة أسماءٌ فقط (الخادم يعيد { matches, similar } من { id, full_name })، سطرٌ لكل مريض:
// المطابقون، ثمّ تحت عنوان «أسماء مشابهة» ما يقرب بغلطةٍ إملائية أو اسم جدّ زائد. ولا تعبئة
// قبل أن تكبس الموظفة «هو نفسه» — ولو طلع مريضٌ واحد: الرقم قد يكون رقم الأم (والرقم ليس
// فريداً — العائلة كلّها برقمٍ واحد). النظام لا يختار ولا يدمج.
// والاسم الثلاثي المطابق لا يتكرّر (2026-11-11): «مريض جديد» به ممنوع — تختار الموجود أو تضيف للاسم.

const threeWords = (v) => String(v || '').trim().split(/\s+/).filter(Boolean).length >= 3
const isFullMobile = (v) => /^09[0-9]{8}$/.test(cleanMobile(v))

export function usePatientSearch() {
  const [nameMatches, setNameMatches] = useState([])
  const [nameSimilar, setNameSimilar] = useState([])
  const [mobileMatches, setMobileMatches] = useState([])
  const [picked, setPicked] = useState(null)       // بيانات المختار بعد «هو نفسه»
  const [pending, setPending] = useState(0)
  const [dismissed, setDismissed] = useState(false) // اختارت «مريض جديد» — تُطوى القائمة
  const [pickError, setPickError] = useState(null)
  const [nameDone, setNameDone] = useState(false)   // بحثٌ بالاسم الثلاثي انتهى (لـ«غير موجود»)
  // ردٌّ متأخّر لبحثٍ قديم لا يطمس نتيجة أحدث (الكتابة أسرع من الشبكة)
  const seq = useRef({ name: 0, mobile: 0 })

  const run = async (kind, body, set) => {
    const n = ++seq.current[kind]
    setPending((p) => p + 1)
    try {
      const r = await api.clinic.lookupPatientBy(body)
      if (seq.current[kind] === n) set({ matches: r?.matches || [], similar: r?.similar || [] })
    } catch { if (seq.current[kind] === n) set({ matches: [], similar: [] }) }
    finally { setPending((p) => p - 1) }
  }

  const byName = (v) => {
    if (picked) return
    setDismissed(false)
    setNameDone(false)
    if (!threeWords(v)) { seq.current.name++; setNameMatches([]); setNameSimilar([]); return }
    run('name', { full_name: v }, (r) => { setNameMatches(r.matches); setNameSimilar(r.similar); setNameDone(true) })
  }
  const byMobile = (v) => {
    if (picked) return
    if (!isFullMobile(v)) { seq.current.mobile++; setMobileMatches([]); return }
    setDismissed(false)
    run('mobile', { mobile: cleanMobile(v) }, (r) => setMobileMatches(r.matches))
  }

  // «هو نفسه»: الآن فقط تُقرأ بيانات المريض
  const pick = async (c) => {
    setPickError(null)
    try {
      const p = await api.clinic.patient(c.id)
      setPicked(p); setNameMatches([]); setNameSimilar([]); setMobileMatches([])
      return p
    } catch (ex) { setPickError(ex.message); return null }
  }
  const reset = () => {
    seq.current.name++; seq.current.mobile++
    setPicked(null); setNameMatches([]); setNameSimilar([]); setMobileMatches([]); setDismissed(false); setPickError(null); setNameDone(false)
  }
  const dismiss = () => setDismissed(true)

  // الرقم أولاً ثمّ الاسم، بلا تكرار مريض
  const seen = new Set()
  const uniq = (c) => (seen.has(String(c.id)) ? false : seen.add(String(c.id)))
  const candidates = picked || dismissed ? [] : [...mobileMatches, ...nameMatches].filter(uniq)
  const similar = picked || dismissed ? [] : nameSimilar.filter(uniq)
  // من يُسأل عنه عند «مريض جديد»: المطابقون بالاسم ثمّ المشابهون (الرقم وحده لا يعني الاسم)
  const nearNames = [...nameMatches, ...nameSimilar]
  // والمطابقون وحدهم يمنعون «مريض جديد» منعاً (لا «نعم، مريض جديد»)
  const exactNames = nameMatches

  // «غير موجود عندنا»: بحث الاسم انتهى بلا أحد، ولا مطابق بالرقم
  const noMatch = !picked && nameDone && pending === 0 && nameMatches.length === 0
    && nameSimilar.length === 0 && mobileMatches.length === 0
  return { candidates, similar, nearNames, exactNames, picked, checking: pending > 0, noMatch, pickError,
    byName, byMobile, pick, reset, dismiss }
}

// قائمة النتائج: سطرٌ لكل مريض فيه الاسم الثلاثي وحده، و«هو نفسه» لكل سطر، و«مريض جديد».
// المطابقون أولاً، ثمّ عنوانٌ صغير «أسماء مشابهة» — اقتراحٌ لا أكثر، والاختيار للموظفة.
export function PatientCandidates({ candidates = [], similar = [], onPick, onNew, newLabel = 'مريض جديد', disabled = false }) {
  if (!candidates.length && !similar.length) return null
  const row = (c) => (
    <div key={c.id} className="candidate-row">
      <div><strong>{c.full_name}</strong></div>
      <button type="button" className="ghost" disabled={disabled} onClick={() => onPick(c)}>هو نفسه</button>
    </div>
  )
  return (
    <div className="candidates-box">
      {candidates.length > 0 && (
        <div className="candidates-title">
          {candidates.length === 1 ? 'وُجد مريض مسجّل' : `وُجد ${candidates.length} مرضى مسجّلين`} — اختاري «هو نفسه» أو «{newLabel}»
        </div>
      )}
      {candidates.map(row)}
      {similar.length > 0 && <div className="candidates-title candidates-similar">أسماء مشابهة</div>}
      {similar.map(row)}
      {onNew && (
        <button type="button" className="ghost candidate-new" disabled={disabled} onClick={onNew}>{newLabel}</button>
      )}
    </div>
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
