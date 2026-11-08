import { useRef, useState } from 'react'
import { api, cleanMobile } from '../api.js'

// ═══ البحث عن مريض في الاستقبال — مصدرٌ واحد للحجز وجلسة الحديد وتغيير المريض ═══
// النتيجة أسماءٌ فقط (الخادم يعيد { id, full_name })، سطرٌ لكل مريض. ولا تعبئة
// قبل أن تكبس الموظفة «هو نفسه» — ولو طلع مريضٌ واحد: الرقم قد يكون رقم الأم،
// والاسم قد يكون لشخصين. النظام لا يختار ولا يدمج.

const threeWords = (v) => String(v || '').trim().split(/\s+/).filter(Boolean).length >= 3
const isFullMobile = (v) => /^09[0-9]{8}$/.test(cleanMobile(v))

export function usePatientSearch() {
  const [nameMatches, setNameMatches] = useState([])
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
      if (seq.current[kind] === n) set(Array.isArray(r) ? r : [])
    } catch { if (seq.current[kind] === n) set([]) }
    finally { setPending((p) => p - 1) }
  }

  const byName = (v) => {
    if (picked) return
    setDismissed(false)
    setNameDone(false)
    if (!threeWords(v)) { seq.current.name++; setNameMatches([]); return }
    run('name', { full_name: v }, (r) => { setNameMatches(r); setNameDone(true) })
  }
  const byMobile = (v) => {
    if (picked) return
    if (!isFullMobile(v)) { seq.current.mobile++; setMobileMatches([]); return }
    setDismissed(false)
    run('mobile', { mobile: cleanMobile(v) }, setMobileMatches)
  }

  // «هو نفسه»: الآن فقط تُقرأ بيانات المريض
  const pick = async (c) => {
    setPickError(null)
    try {
      const p = await api.clinic.patient(c.id)
      setPicked(p); setNameMatches([]); setMobileMatches([])
      return p
    } catch (ex) { setPickError(ex.message); return null }
  }
  const reset = () => {
    seq.current.name++; seq.current.mobile++
    setPicked(null); setNameMatches([]); setMobileMatches([]); setDismissed(false); setPickError(null); setNameDone(false)
  }
  const dismiss = () => setDismissed(true)

  // الرقم أولاً ثمّ الاسم، بلا تكرار مريض
  const seen = new Set()
  const candidates = picked || dismissed ? [] : [...mobileMatches, ...nameMatches]
    .filter((c) => (seen.has(String(c.id)) ? false : seen.add(String(c.id))))

  // «غير موجود عندنا»: بحث الاسم انتهى بلا أحد، ولا مطابق بالرقم
  const noMatch = !picked && nameDone && pending === 0 && nameMatches.length === 0 && mobileMatches.length === 0
  return { candidates, nameMatches, picked, checking: pending > 0, noMatch, pickError,
    byName, byMobile, pick, reset, dismiss }
}

// قائمة النتائج: سطرٌ لكل مريض فيه الاسم الثلاثي وحده، و«هو نفسه» لكل سطر، و«مريض جديد»
export function PatientCandidates({ candidates, onPick, onNew, newLabel = 'مريض جديد', disabled = false }) {
  if (!candidates?.length) return null
  return (
    <div className="candidates-box">
      <div className="candidates-title">
        {candidates.length === 1 ? 'وُجد مريض مسجّل' : `وُجد ${candidates.length} مرضى مسجّلين`} — اختاري «هو نفسه» أو «{newLabel}»
      </div>
      {candidates.map((c) => (
        <div key={c.id} className="candidate-row">
          <div><strong>{c.full_name}</strong></div>
          <button type="button" className="ghost" disabled={disabled} onClick={() => onPick(c)}>هو نفسه</button>
        </div>
      ))}
      {onNew && (
        <button type="button" className="ghost candidate-new" disabled={disabled} onClick={onNew}>{newLabel}</button>
      )}
    </div>
  )
}

// «مريض جديد» باسمٍ مطابق لمسجَّل — تأكيدٌ صريح. «لا، هو نفسه» يختاره، و«نعم» يُنشئ جديداً.
export function SameNameConfirm({ matches, onPick, onConfirm, disabled = false }) {
  if (!matches?.length) return null
  return (
    <div className="candidates-box" role="alertdialog" aria-live="assertive">
      <div className="candidates-title">
        يوجد مريض مسجّل بنفس الاسم: {matches[0].full_name}. هل هو شخص آخر؟ إذا كان شخصاً آخر يُفضَّل إضافة اسم الجد.
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
        <button type="button" disabled={disabled} onClick={onConfirm}>نعم، مريض جديد</button>
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
