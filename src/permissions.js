// صلاحيات العرض في الواجهة — مرآة لـ server/src/permissions.js.
// هذه لإخفاء ما لا يعني المستخدم فقط؛ الفرض الفعلي على الخادم.

// المشرف العام: يرى كل شاشات النظام، ولا يكتب إلا في الموظفين والإعدادات
export const SUPER_ADMIN = 'super_admin'
// المدير (اطّلاع فقط): يرى كل الشاشات كالمشرف العام، والفرض الفعلي على منع كتابته في الخادم
export const MANAGER = 'manager'

export const AID_ROLES = ['officer', 'accountant', 'board', SUPER_ADMIN, MANAGER]
export const CLINIC_ROLES = ['clinic_admin', 'clinic_reception', 'doctor', 'board', SUPER_ADMIN, MANAGER]

// هل هذا الدور للاطّلاع فقط؟ تُستعمل لإخفاء أزرار الإضافة/التعديل/القرار في الواجهة.
export const isReadOnly = (role) => role === MANAGER || role === SUPER_ADMIN

export const canReadAid = (role) => AID_ROLES.includes(role)
export const canReadClinic = (role) => CLINIC_ROLES.includes(role)
export const canSearchAid = (role) => AID_ROLES.includes(role)

// إدارة الموظفين وأدوارهم — المشرف العام حصراً
export const canManageUsers = (role) => role === SUPER_ADMIN

// إدارة الأطباء والجداول: مسؤول العيادات يكتب، المجلس والمشرف العام يطالعان فقط
export const canSeeDoctorsPage = (role) =>
  role === 'clinic_admin' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// لوحة العيادات اليومية والطابور
export const canSeeClinicBoard = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// كتالوج إجراءات العيادة: مسؤول العيادات يكتب، المجلس والمشرف العام والمدير يطالعون.
// الاستقبال لا يرى الصفحة — المفعَّل منها يظهر له داخل قائمة الإضافة على الحجز فقط.
export const canSeeProceduresPage = (role) =>
  role === 'clinic_admin' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// إضافة إجراء على حجز وإزالته — الاستقبال ومسؤول العيادات (الخادم يحصر الاستقبال بيوم الجلسة)
export const canEditAppointmentProcedures = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// صفحة إعداد الطابعة: الاستقبال يقرؤها ويُعدّ جهازه (الإعداد محلّيٌّ لا يمسّ أحداً)،
// والمشرف يقرؤها ليساعد. ولا علاقة لها بالإعداد العام (في «الإعدادات»).
export const canSeePrinterSetup = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// تعديل الحجز (تصحيح بيانات، تغيير مريض، نوع الزيارة، تنزيل الأولوية، التراجع
// عن «لم يحضر»): الاستقبال ومشرف العيادات. الطبيب لا يُعدّل، والمدير اطّلاع.
// والخادم هو الحارس — هذا لإخفاء ما لا يُفيد الضغط عليه.
export const canEditBooking = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// «خروج مؤقت» ونداء العودة من شاشة الاستقبال: مشرف العيادات وحده، صلاحيةَ طوارئ
// (طبيبٌ غادر ومريضه «خارج»، أو جهازه تعطّل). الطبيب يفعلها من شاشته، والاستقبال لا:
// قرارٌ طبّي داخل الغرفة. والخادم هو الحارس — هذا لإظهار الزرّ وحده.
export const canStepOutAsSupervisor = (role) => role === 'clinic_admin'

// صفحة «المخزون» (الأرصدة وأسعار الشراء والجرد): مشرفة العيادات وحدها.
// الاستقبال والطبيب لا يرون شيئاً منها، والخادم يردّ 403 لغيرها.
export const canSeeInventory = (role) => role === 'clinic_admin'
// الإحالات: إدارة الجهات وتقرير المستحقات — مشرف العيادات وحده (الخادم يردّ غيره 403).
// وتسجيل الإحالة على زيارة للاستقبال والمشرف (نفس canEditBooking). الطبيب لا يرى شيئاً.
export const canSeeReferralsPage = (role) => role === 'clinic_admin'
export const canEditReferral = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// جرد الصندوق (الشاشة والملفّ): الاستقبال والمشرفة والمدير — يطابق CASH_REPORT_ROLES في الخادم.
// الطبيب لا يراه، والخادم يردّه 403.
export const canSeeCashReport = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === MANAGER

// المساءلة: سجلّ الزيارة الكامل («مين عمل شو») ونشاط الموظفين — المشرفة والمدير وحدهما،
// يطابق AUDIT_ROLES في الخادم. الاستقبال يرى الجرد بلاهما (لا يراقب الموظفون بعضهم)، والطبيب لا شيء.
export const canSeeVisitAudit = (role) => role === 'clinic_admin' || role === MANAGER

// شاشة الطبيب الخاصة — مربوطة بسجلّ دكتور، فلا معنى لها لغير الطبيب
export const canSeeDoctorScreen = (role) => role === 'doctor'

// شاشة الإعدادات: مسؤول العيادات والمشرف العام يعدّلان، المجلس يطالع فقط
export const canSeeSettings = (role) =>
  role === 'clinic_admin' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// أول صفحة مسموحة لكل دور — وجهة إعادة التوجيه عند محاولة فتح مسار ممنوع
export function homePathFor(role) {
  if (role === 'doctor') return '/clinic/doctor'
  if (role === 'clinic_admin' || role === 'clinic_reception') return '/clinic/board'
  return '/'
}
