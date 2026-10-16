// ═══ ردّ الفعل على أزرار الإجراءات — بلا أن تُستبدل الشاشة ═══
// كان خطأ أي زرّ (409/403/429/انقطاع) يُكتب في حالة الصفحة فتُستبدل الشاشة كلها بسطر
// الخطأ: يختفي الطابور والمريض الحالي والأزرار. الآن الخطأ إشعارٌ صغير يختفي وحده،
// والشاشة تبقى كما هي.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// أرقام عربية — ٠١٢٣٤٥٦٧٨٩
export const toArabicDigits = (v) => String(v).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])

// ثوانٍ بالجمع الصحيح: ثانية واحدة، ثانيتان، ٣–١٠ ثوانٍ، ١١ فما فوق ثانية
export function secondsAr(n) {
  const k = Math.max(0, Math.round(n))
  if (k === 1) return 'ثانية واحدة'
  if (k === 2) return 'ثانيتان'
  if (k >= 3 && k <= 10) return `${toArabicDigits(k)} ثوانٍ`
  return `${toArabicDigits(k)} ثانية`
}

// ═══ إشعار عابر ═══
// واحدٌ في كل مرة (الأحدث يحلّ محلّ الأقدم)، يختفي بعد مدّته، ويُغلق بنقرة.
// role=alert للخطأ كي يُقرأ فوراً، و status للمعلومة.
export function useToast() {
  const [toast, setToast] = useState(null)   // { msg, kind, id }
  const timer = useRef(null)
  const show = useCallback((msg, kind = 'error', ms = 6000) => {
    clearTimeout(timer.current)
    setToast({ msg, kind, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const node = toast && (
    <div key={toast.id} className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => setToast(null)}>
      {toast.msg}
    </div>
  )
  return [node, show]
}

// ═══ زرّ «إعادة النداء» بعدّاد ═══
// الخادم يخنق إعادة النداء مرّة كل ١٠ ثوانٍ لكل حجز (429). بدل أن نترك الضغطة الثانية
// تصل إليه وتُرفض، نعطّل الزرّ طوال مدّة الخنق مع عدٍّ تنازلي ظاهر — فلا تُضغط أصلاً.
// المدّة من الخادم حين يردّ 429 (retry_after_seconds)، وإلا ١٠ ثوانٍ بعد كل نداء ناجح.
export const RECALL_COOLDOWN_S = 10
const cooldownUntil = new Map()   // appointment_id → ms — يبقى عبر إعادة الرسم وتحديث الطابور

export function RecallButton({ apptId, onError, onDone, className = 'ghost', style }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const until = cooldownUntil.get(String(apptId)) || 0
  const left = Math.ceil((until - now) / 1000)
  useEffect(() => {
    if (left <= 0) return undefined
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [left > 0])
  const press = async () => {
    setBusy(true)
    try {
      await api.clinic.recall(apptId)
      cooldownUntil.set(String(apptId), Date.now() + RECALL_COOLDOWN_S * 1000)
      onDone?.()
    } catch (ex) {
      const wait = ex.data?.retry_after_seconds
      if (wait) {
        // الخادم يعرف آخر نداء (ربما من الشاشة الأخرى) — نتبع عدّاده لا عدّادنا
        cooldownUntil.set(String(apptId), Date.now() + wait * 1000)
      } else onError?.(ex.message)
    } finally { setBusy(false); setNow(Date.now()) }
  }
  return (
    <button className={className} style={style} disabled={busy || left > 0} onClick={press}
      title={left > 0 ? 'أُعيد النداء للتو — الخادم يسمح بإعادته مرّة كل ١٠ ثوانٍ' : undefined}>
      🔊 إعادة النداء{left > 0 && <span className="recall-wait"> ({secondsAr(left)})</span>}
    </button>
  )
}
