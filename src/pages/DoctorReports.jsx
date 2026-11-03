import { useRole } from '../RoleContext.jsx'
import { canWriteClinicFunds } from '../permissions.js'
import { DoctorsTab } from './ClinicFunds.jsx'

// ═══ تقارير الدكاترة ═══
// حسابات الدكاترة الشهرية نفسها (تبويب «حسابات الدكاترة» في صندوق العيادات) في قسم العيادات من
// القائمة، واسم كلّ دكتور يفتح لوحة تحكمه على الشهر ذاته — فأرقام البطاقة المالية هناك = هذا الجدول.
// المشرفة والمدير والمشرف العام (قراءة وحدها؛ إعداد الراتب من بروفايل الدكتور).
export default function DoctorReports() {
  const { role } = useRole()
  return (
    <>
      <h2>تقارير الدكاترة</h2>
      <p className="subtitle">المرضى وحصّة الشفاء والراتب لكلّ دكتور بالشهر — اضغط الاسم لفتح لوحة تحكمه (الالتزام بالدوام وأرقامه).</p>
      <DoctorsTab canWrite={canWriteClinicFunds(role)} linkDashboard />
    </>
  )
}
