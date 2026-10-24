// ═══ رسالة نجاح الحجز في نمط الحضور ═══
// لا رقم دور عند الحجز — رقم الحجز والوقت التقريبي (ورقم الدور إن حضر فوراً: الإسعافي
// الحضوري). وإن اختلف الوقت المُعطى عمّا عرضته المعاينة لحظة الضغط (حجز غيرُك بينهما)
// يُقال صراحةً «تغيّر من» — الموظف ربما قال للمتّصل الوقت الأوّل.
// ملفٌّ بلا JSX ليُختبر بـ node مباشرة (test/booking-message-check.mjs).
const hm = (t) => (t ? String(t).slice(0, 5) : null)

export function attendanceBookedMessage(appt) {
  const t = hm(appt.estimated_time)
  const was = hm(appt.preview_estimated_time)
  const changed = t && was && was !== t ? ` (تغيّر من ${was})` : ''
  return `تم الحجز — رقم الحجز ${appt.queue_number}${t ? ` · الوقت التقريبي: ${t}${changed}` : ''}`
    + `${appt.arrival_number != null ? ` · الدور ${appt.arrival_number}` : ''}`
}
