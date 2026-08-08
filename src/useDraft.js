import { useEffect, useRef, useState } from 'react'

// حفظ تلقائي للمسودات في localStorage — حماية من الرجوع الخاطئ أو إغلاق الصفحة
// key: مفتاح المسودة | state: الكائن المُراقب | applyDraft: يعيد ملء النموذج
// isEmpty: إذا كانت الحالة فارغة تُحذف المسودة بدل حفظ فراغ
export default function useDraft(key, state, applyDraft, isEmpty) {
  const [savedAt, setSavedAt] = useState(null)
  const [restored, setRestored] = useState(false)
  const skipFirst = useRef(true)

  // استعادة المسودة عند فتح الصفحة
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const { data, at } = JSON.parse(raw)
        applyDraft(data)
        setSavedAt(at)
        setRestored(true)
      }
    } catch { localStorage.removeItem(key) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // حفظ مؤجّل (600ms) عند كل تغيير
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return }
    const t = setTimeout(() => {
      if (isEmpty && isEmpty(state)) {
        localStorage.removeItem(key)
        setSavedAt(null)
        return
      }
      const at = new Date().toISOString()
      try {
        localStorage.setItem(key, JSON.stringify({ data: state, at }))
        setSavedAt(at)
      } catch { /* التخزين ممتلئ — نتجاهل بصمت */ }
    }, 600)
    return () => clearTimeout(t)
  }, [key, state, isEmpty])

  const clearDraft = () => {
    localStorage.removeItem(key)
    setSavedAt(null)
    setRestored(false)
  }

  return { savedAt, restored, clearDraft }
}

export const fmtDraftTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) : ''
