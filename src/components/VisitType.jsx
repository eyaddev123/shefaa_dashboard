import { REGULAR_VISIT_TYPES } from '../api.js'

// نوع الزيارة كلمةً بجانب اسم المريض في صفحات الطبيب: «معاينة» أو «مراجعة» — طلب المستخدم
// 2026-11-15 («الدكتور يعرف إذا هذا مريض معاينة ولا مراجعة»). «إجراء فقط» شارته ProcedureOnlyBadge.
export default function VisitType({ appt }) {
  const label = REGULAR_VISIT_TYPES[appt?.visit_type]
  return label ? <span className={`dk-vt is-${appt.visit_type}`}>{label}</span> : null
}
