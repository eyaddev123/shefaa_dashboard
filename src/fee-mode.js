import { useEffect, useState } from 'react'
import { api } from './api.js'

// ═══ الإصدار 3: «الإجراء أجرة + مواد» — منذ متى؟ ═══
// قبل القلبة: سعر الإجراء يشمل المواد، والمواد تُطرح منه (الاستقبال لا يرى سعر مادة).
// بعدها: السعر أجرة الإيد، والمواد والمستهلكات فوقها على المريض.
// طلبٌ واحد للصفحة كلّها (ذاكرة الوحدة)، ويُصفَّر بعد «تفعيل» (resetFeeMode) فتقرأ الشاشات الحالة الجديدة.
let cached = null
export function resetFeeMode() { cached = null }
export function loadFeeMode() {
  if (!cached) cached = api.clinic.feeMode().catch((e) => { cached = null; throw e })
  return cached
}

/** @returns {{since:string|null, loading:boolean}} — الفشل يُعامل «قبل القلبة» (العرض القديم آمن) */
export function useFeeMode() {
  const [state, setState] = useState({ since: null, loading: true })
  useEffect(() => {
    let live = true
    loadFeeMode().then((r) => live && setState({ since: r.since || null, loading: false }))
      .catch(() => live && setState({ since: null, loading: false }))
    return () => { live = false }
  }, [])
  return state
}
