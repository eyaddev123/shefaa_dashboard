import { useRole } from '../RoleContext.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { DoctorsTab } from './DoctorAccounts.jsx'

// ═══ تقارير الدكاترة ═══
// حسابات الدكاترة نفسها (تبويب «حسابات الدكاترة» في صندوق العيادات) في قسم العيادات من القائمة،
// واسم كلّ دكتور يفتح لوحة تحكمه على الفترة ذاتها — فأرقام البطاقة المالية هناك = هذه البطاقات.
// المشرفة والمدير والمشرف العام (قراءة وحدها؛ إعداد الراتب من بروفايل الدكتور).
export default function DoctorReports() {
  const { clinicRole: role } = useRole()
  return (
    <>
      <h2>تقارير الدكاترة</h2>
      <p className="subtitle">حضور كلّ دكتور ومرضاه وما أدخله للشفاء وصافي الربح منه — اضغط الاسم لفتح لوحة تحكمه.</p>
      <DoctorsTab canWrite={canWriteClinicFunds(role)} linkDashboard />
    </>
  )
}
