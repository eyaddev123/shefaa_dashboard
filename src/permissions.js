// صلاحيات العرض في الواجهة — مرآة لـ server/src/permissions.js.
// هذه لإخفاء ما لا يعني المستخدم فقط؛ الفرض الفعلي على الخادم.

export const AID_ROLES = ['officer', 'accountant', 'board']
export const CLINIC_ROLES = ['clinic_admin', 'clinic_reception', 'doctor', 'board']

export const canReadAid = (role) => AID_ROLES.includes(role)
export const canReadClinic = (role) => CLINIC_ROLES.includes(role)
export const canSearchAid = (role) => AID_ROLES.includes(role)

// إدارة الأطباء والجداول: مسؤول العيادات يكتب، المجلس يطالع فقط
export const canSeeDoctorsPage = (role) => role === 'clinic_admin' || role === 'board'

// لوحة العيادات اليومية والطابور
export const canSeeClinicBoard = (role) =>
  role === 'clinic_admin' || role === 'clinic_reception' || role === 'board'

// شاشة الطبيب الخاصة
export const canSeeDoctorScreen = (role) => role === 'doctor'

// شاشة الإعدادات: مسؤول العيادات يعدّل، المجلس يطالع فقط
export const canSeeSettings = (role) => role === 'clinic_admin' || role === 'board'

// أول صفحة مسموحة لكل دور — وجهة إعادة التوجيه عند محاولة فتح مسار ممنوع
export function homePathFor(role) {
  if (role === 'doctor') return '/clinic/doctor'
  if (role === 'clinic_admin' || role === 'clinic_reception') return '/clinic/board'
  return '/'
}

// خريطة المسار ← من يسمح له بفتحه. تُستخدم لحراسة الراوتس في App.jsx
export const ROUTE_ACCESS = {
  '/': () => true, // لوحة القيادة تتفرّع بنفسها حسب الدور
  '/requests': canReadAid,
  '/families': canReadAid,
  '/persons': canReadAid,
  '/vouchers': canReadAid,
  '/treasury': canReadAid,
  '/catalog': canReadAid,
  '/reconciliation': (role) => role === 'officer' || role === 'accountant',
  '/search': canSearchAid,
  '/clinic/doctors': canSeeDoctorsPage,
  '/clinic/board': canSeeClinicBoard,
  '/clinic/session': canSeeClinicBoard,
  '/clinic/doctor': canSeeDoctorScreen,
  '/settings': canSeeSettings,
}
