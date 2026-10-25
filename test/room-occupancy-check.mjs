// ═══ قائمة الغرف: «يستقبل الآن» أم «انتهى دوامه / لم يبدأ» ═══
//   node test/room-occupancy-check.mjs
// الحالات على ردٍّ بشكل /api/clinic/day-doctors (session_start/end/closed/active_count).
import { isLiveNow, roomOccupants, occupantLabel, hoursOf } from '../src/room-occupancy.js'

let pass = 0, fail = 0
const check = (label, ok, info = '') => {
  if (ok) { pass++; console.log(`  ✔ ${label}`) } else { fail++; console.log(`  ✘ ${label}${info ? `\n     ${info}` : ''}`) }
}
const T = '2026-10-25'
const ctx = (now, date = T) => ({ date, today: T, now })
const doc = (o) => ({ doctor_id: 1, doctor_name: 'ديمة متوالي', room: '3', start_time: '09:00', end_time: '13:00',
  session_id: 11, session_status: 'open', session_start: '09:00', session_end: '13:00',
  session_closed: false, active_count: 0, apologized: false, ...o })

console.log('── isLiveNow ──')
check('★ ضمن ساعات الجلسة ⇒ الآن', isLiveNow(doc(), ctx('10:30')))
check('على البداية تماماً ⇒ الآن', isLiveNow(doc(), ctx('09:00')))
check('★ قبل البداية ⇒ ليس الآن (لم يبدأ)', !isLiveNow(doc(), ctx('08:59')))
check('قبل البداية ومرضى حاضرون مبكراً ⇒ ليس الآن', !isLiveNow(doc({ active_count: 3 }), ctx('08:30')))
check('★ بعد النهاية بلا منتظرين ⇒ ليس الآن (خلص)', !isLiveNow(doc(), ctx('13:00')))
check('★ بعد النهاية وما زال في دوره منتظرون ⇒ الآن (تجاوز وقته)', isLiveNow(doc({ active_count: 2 }), ctx('13:40')))
check('«انتهى الدوام» (session_closed) ⇒ ليس الآن', !isLiveNow(doc({ session_closed: true }), ctx('10:00')))
check('جلسة ملغاة ⇒ ليس الآن', !isLiveNow(doc({ session_status: 'cancelled' }), ctx('10:00')))
check('بلا جلسة مولَّدة ⇒ ليس الآن (القالب وحده لا يعني أنه يستقبل)', !isLiveNow(doc({ session_id: null }), ctx('10:00')))
check('معتذر ⇒ ليس الآن', !isLiveNow(doc({ apologized: true }), ctx('10:00')))
check('★ يوم اللوحة غير اليوم ⇒ لا «الآن» لأحد', !isLiveNow(doc(), ctx('10:00', '2026-10-26')))
check('أوقات الجلسة تغلب أوقات القالب (جلسة يدوية أطول)',
  isLiveNow(doc({ session_end: '16:00' }), ctx('15:00')) && hoursOf(doc({ session_end: '16:00' })) === '09:00–16:00')
check('جلسة يدوية بلا قالب: أوقاتها من الجلسة', hoursOf(doc({ start_time: null, end_time: null })) === '09:00–13:00')

console.log('\n── roomOccupants ──')
const doctors = [
  doc({ doctor_id: 1, doctor_name: 'ديمة متوالي', room: '3' }),
  doc({ doctor_id: 2, doctor_name: 'خالد الشامي', room: '3', start_time: '14:00', end_time: '18:00',
    session_start: '14:00', session_end: '18:00' }),
  doc({ doctor_id: 3, doctor_name: 'سامر الحلبي', room: '1' }),
  doc({ doctor_id: 4, doctor_name: 'معتذرة', room: '5', apologized: true }),
  doc({ doctor_id: 5, doctor_name: 'بلا غرفة', room: null }),
]
const occ = roomOccupants(doctors, 3, ctx('10:00'))
check('الدكتور نفسه لا يظهر ساكناً في غرفته', !occ['1'], JSON.stringify(occ['1']))
check('المعتذر والبلا غرفة لا يظهران', !occ['5'] && !occ['null'] && !occ[''])
check('★ «الآن» أوّلاً ثمّ الباهت بأوقاته', occ['3']?.[0].name === 'ديمة متوالي' && occ['3'][0].live
  && occ['3'][1].name === 'خالد الشامي' && !occ['3'][1].live && occ['3'][1].hours === '14:00–18:00', JSON.stringify(occ['3']))
const later = roomOccupants(doctors, 3, ctx('13:30'))
check('★ بعد دوام ديمة: الغرفة 3 كلها باهتة (متاحة عملياً)', later['3'].every((o) => !o.live), JSON.stringify(later['3']))

console.log('\n── النصّ ──')
check('★ «العيادة 3 — ديمة متوالي (الآن)»', occupantLabel('3', occ['3'][0]) === 'العيادة 3 — ديمة متوالي (الآن)')
check('★ «العيادة 3 — خالد الشامي (14:00–18:00)»', occupantLabel('3', occ['3'][1]) === 'العيادة 3 — خالد الشامي (14:00–18:00)')

console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass} نجح، ${fail} فشل`)
process.exit(fail === 0 ? 0 : 1)
