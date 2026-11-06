// ═══ زيارة «إجراء فقط» — بلا كشفية ═══
// الشارة ليعرف الطبيب والاستقبال أن لا معاينة ولا كشفية. والدور والشاشات كغيره حرفياً.
import { PROCEDURE_ONLY } from '../api.js'

export const isProcedureOnly = (appt) => appt?.visit_type === PROCEDURE_ONLY

const hasLiveProcedure = (appt) => (appt.procedures || []).some((p) => !p.removed_at)
// انتهت بلا ولا إجراء: صفر مقبوضات، فتظهر للمشرفة ولا تختفي بصمت
export const endedWithoutProcedure = (appt) =>
  isProcedureOnly(appt) && appt.status === 'done' && !hasLiveProcedure(appt)

export function ProcedureOnlyBadge({ appt }) {
  if (!isProcedureOnly(appt)) return null
  return (
    <>
      <span className="badge blue sm proc-only-badge" title="لا معاينة ولا كشفية — جاء للإجراء وحده">إجراء فقط</span>
      {endedWithoutProcedure(appt) && <span className="badge warn sm proc-only-badge">بلا إجراء</span>}
    </>
  )
}

// متى يُغلق الانتقال بين «عادية» و«إجراء فقط» — نصّ الواجهة وحده، والحارس الحقيقي في الخادم
// (visitKindChangeBlocked). الكشفية تُقبض عند الحضور، فالعادية الحاضرة مقبوضة.
export function visitKindLockReason(appt) {
  if (hasLiveProcedure(appt)) return 'أُضيف إجراء'
  if (['in_service', 'waiting_return', 'done'].includes(appt.status)) return 'دخل المريض على الدكتور'
  if (!isProcedureOnly(appt) && appt.status === 'arrived') return 'قُبضت الكشفية عند الحضور'
  return null
}
