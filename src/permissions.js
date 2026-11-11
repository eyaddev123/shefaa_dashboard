// صلاحيات العرض في الواجهة — مرآة لـ server/src/permissions.js.
// هذه لإخفاء ما لا يعني المستخدم فقط؛ الفرض الفعلي على الخادم.

// المشرف العام: يرى كل شاشات النظام، ولا يكتب إلا في الموظفين والإعدادات
export const SUPER_ADMIN = 'super_admin'
// المدير (اطّلاع فقط): يرى كل الشاشات كالمشرف العام، والفرض الفعلي على منع كتابته في الخادم
export const MANAGER = 'manager'

export const AID_ROLES = ['officer', 'accountant', 'board', SUPER_ADMIN, MANAGER]
export const CLINIC_ROLES = ['clinic_admin', 'clinic_reception', 'doctor', 'board', SUPER_ADMIN, MANAGER]

// المدير المسؤول (عضو مجلس بـ is_chairman) في العيادات = المدير (اطّلاع فقط) — قرار المستخدم 2026-11-03.
// مرآة clinicActsAsManager في الخادم؛ صلاحياته في المساعدات (القرار النهائي) على دوره board كما هي.
export const clinicRoleOf = (user) =>
  (user?.role === 'board' && user.is_chairman ? MANAGER : user?.role || null)

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

// لوحة القيادة — العيادات: يطابق COMMAND_READERS في الخادم. المجلس (غير المدير المسؤول) والطبيب لا.
export const canSeeClinicCommand = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === SUPER_ADMIN || role === MANAGER
// من له قسمان: لوحته في المساعدات تبقى، ويتنقّل بينهما بتبويب (الموظف المتفرّغ للعيادات بلا تبويب)
export const hasClinicAndAidDashboards = (role, clinicRole) =>
  canSeeClinicCommand(clinicRole) && canReadAid(role)
// توليد جلسات اليوم — مرآة حارس POST /clinic/sessions/generate
export const canGenerateSessions = (role) => role === 'clinic_admin'

// لوحة العيادات اليومية والطابور
export const canSeeClinicBoard = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// كتالوج إجراءات العيادة: مسؤول العيادات يكتب، المجلس والمشرف العام والمدير يطالعون.
// الاستقبال لا يرى الصفحة — المفعَّل منها يظهر له داخل قائمة الإضافة على الحجز فقط.
export const canSeeProceduresPage = (role) =>
  role === 'clinic_admin' || role === 'board' || role === SUPER_ADMIN || role === MANAGER

// إضافة إجراء على حجز وإزالته — الاستقبال ومسؤول العيادات (الخادم يحصر الاستقبال بيوم الجلسة)
export const canEditAppointmentProcedures = (role) => role === 'clinic_admin' || role === 'clinic_reception'
// «تمت المحاسبة» على إجراءٍ أضافه الطبيب: من يقبض — مرآة PAYMENT_TAKERS في الخادم
export const canTakePayment = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// تشغيل الدور (حجز، حضر، نداء، إعادة نداء، «وصل الطبيب»، ما حضر، تأجيل، تقديم): الاستقبال والمشرفة.
// المجلس والمشرف العام والمدير يطالعون الدور بلا أزرار — والخادم يرفض كتابتهم أصلاً (المدير بطبقةٍ عامة).
export const canOperateQueue = (role) => role === 'clinic_admin' || role === 'clinic_reception'

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

// صفحة «المخزون» — المكان الوحيد لإدارة المواد. يطابق INVENTORY_* في server/src/inventory.js:
// · مشرفة العيادات تكتب (وتتسلّم إشعاراته).
// · المدير والمشرف العام يطالعون كلّ شيء: الأرصدة وأسعار الشراء والكشوف والتقارير.
// · المجلس يطالع الكتالوج بأسعاره وتقرير الاستهلاك بقيمة البيع — بلا أرصدة ولا كلفة شراء.
// الاستقبال والطبيب لا يرون شيئاً منها، والخادم يردّ 403 لهم.
export const canSeeInventory = (role) =>
  role === 'clinic_admin' || role === 'board' || role === SUPER_ADMIN || role === MANAGER
export const canWriteInventory = (role) => role === 'clinic_admin'
// 'full' الأرصدة والكلفة · 'catalog' الكتالوج والاستهلاك بقيمة البيع وحدهما (المجلس)
export const inventoryView = (role) => (role === 'board' ? 'catalog' : 'full')
// الإحالات: الجهات وتقرير المستحقات — المشرفة تكتب، والمشرف العام والمدير يطالعان (REFERRAL_READERS
// في الخادم)، والمجلس والاستقبال 403. وتسجيل الإحالة على زيارة للاستقبال والمشرف (نفس canEditBooking).
// الطبيب لا يرى شيئاً.
export const canSeeReferralsPage = (role) => role === 'clinic_admin' || role === SUPER_ADMIN || role === MANAGER
export const canWriteReferralSources = (role) => role === 'clinic_admin'
// المرضى المكرّرون (الاسم الثلاثي نفسه قبل منع التكرار): المشرفة تدمج وتميّز، والمشرف العام يطالع
// — يطابق DUP_READERS وrequireRole('clinic_admin') في الخادم.
export const canSeeDuplicatePatients = (role) => role === 'clinic_admin' || role === SUPER_ADMIN
export const canFixDuplicatePatients = (role) => role === 'clinic_admin'
export const canEditReferral = (role) => role === 'clinic_admin' || role === 'clinic_reception'

// جرد الصندوق (الشاشة والملفّ): الاستقبال والمشرفة والمدير — يطابق CASH_REPORT_ROLES في الخادم.
// الطبيب لا يراه، والخادم يردّه 403.
export const canSeeCashReport = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === MANAGER

// خدمة الحديد — يطابق IRON_* في server/src/iron-sessions.js: التسجيل والقبض للاستقبال والمشرفة · السجلّ
// لهما وللمدير والمشرف العام · التوزيع والمستحقات وقراءة الإعدادات بلا الاستقبال · وكتابة الإعدادات
// والممرضات للمشرفة وحدها. والطبيب والمجلس لا شيء.
export const canCollectIron = (role) => role === 'clinic_admin' || role === 'clinic_reception'
export const canSeeIronLog = (role) => canCollectIron(role) || role === MANAGER || role === SUPER_ADMIN
export const canSeeIronSplit = (role) => role === 'clinic_admin' || role === MANAGER || role === SUPER_ADMIN
export const canWriteIronSettings = (role) => role === 'clinic_admin'
export const canCancelIron = (role) => role === 'clinic_admin'

// مستحقات الدكاترة من الإجراءات (تبويب «المستحقات» في صفحة الإجراءات): المشرفة والمدير والمشرف
// العام — يطابق EARNINGS_ROLES في الخادم. المجلس يرى المراجعة لكن لا هذه، والاستقبال لا شيء: 403.
export const canSeeEarnings = (role) => role === 'clinic_admin' || role === MANAGER || role === SUPER_ADMIN

// صندوق العيادات وربح المواد وحسابات الدكاترة الشهرية (صفحة «صندوق العيادات» وبطاقة الراتب في
// بروفايل الدكتور): المشرفة تكتب، والمدير والمشرف العام يطالعان — يطابق FUND_* في الخادم.
// الطبيب لا يرى راتبه، والاستقبال والمجلس لا شيء: 403.
export const canSeeClinicFunds = (role) => role === 'clinic_admin' || role === MANAGER || role === SUPER_ADMIN
export const canWriteClinicFunds = (role) => role === 'clinic_admin'

// لوحة تحكم الدكتور (الالتزام بالدوام، أرقامه، بطاقته المالية)، «الأبرز هالأسبوع» على اللوحة اليومية،
// و«تقارير الدكاترة»: المشرفة والمدير والمشرف العام — يطابق DASHBOARD_READERS في الخادم.
// الطبيب يرى التزامه هو وحده في «أعمالي»، ولا يصل لوحة أحدٍ ولا الأبرز (403).
export const canSeeDoctorDashboard = (role) => role === 'clinic_admin' || role === MANAGER || role === SUPER_ADMIN

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
