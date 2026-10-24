// ═══ رسالة نجاح الحجز (نمط الحضور): الوقت، و«تغيّر من» حين تقدُم المعاينة ═══
//   node test/booking-message-check.mjs
import { attendanceBookedMessage as msg } from '../src/booking-message.js'
let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (got === want) { pass++; console.log(`  ✔ ${label}`) } else { fail++; console.log(`  ✘ ${label}\n     got:  ${got}\n     want: ${want}`) }
}
eq('المعاينة = المُعطى ⇒ بلا «تغيّر»',
  msg({ queue_number: 7, estimated_time: '11:20:00', preview_estimated_time: '11:20' }),
  'تم الحجز — رقم الحجز 7 · الوقت التقريبي: 11:20')
eq('★ حجز غيرك بينهما ⇒ «تغيّر من»',
  msg({ queue_number: 8, estimated_time: '11:30:00', preview_estimated_time: '11:20' }),
  'تم الحجز — رقم الحجز 8 · الوقت التقريبي: 11:30 (تغيّر من 11:20)')
eq('لا معاينة (فشلت أو لم تصل) ⇒ الوقت وحده',
  msg({ queue_number: 9, estimated_time: '11:40:00', preview_estimated_time: null }),
  'تم الحجز — رقم الحجز 9 · الوقت التقريبي: 11:40')
eq('إسعافي حضوري ⇒ بلا وقت، ورقم دوره',
  msg({ queue_number: 10, estimated_time: null, preview_estimated_time: null, arrival_number: 3 }),
  'تم الحجز — رقم الحجز 10 · الدور 3')
eq('إسعافي حضوري بعد معاينة قديمة لنموذجٍ عادي ⇒ لا «تغيّر» بلا وقت',
  msg({ queue_number: 11, estimated_time: null, preview_estimated_time: '11:50', arrival_number: 4 }),
  'تم الحجز — رقم الحجز 11 · الدور 4')
console.log(`\n═══ ${pass} ✔ · ${fail} ✘ ═══`)
process.exit(fail ? 1 : 0)
