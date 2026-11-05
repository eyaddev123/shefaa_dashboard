// ═══ زرّ التوليد يقول ماذا فعل، ولأيّ يوم ═══
// كان ردّ الخادم يُهمل: كبسةٌ لا تُنشئ شيئاً (الجلسة مولَّدة من قبل) لا تختلف عن كبسةٍ أنشأت،
// فتُقرأ الجلسة القائمة كأنها نتيجة الكبسة. وكلمة «هذا اليوم» تُقرأ «اليوم» وهي تعني المعروض.
import { dayLabel } from './api.js'

const dayText = (date) => {
  const { weekday, day, month } = dayLabel(date)
  return `${weekday} ${day}/${month}`
}

/** نصّ الزرّ: اليوم المختار صراحةً (date الفارغ = حقل التاريخ مُسح) */
export const generateLabel = (date) => (date ? `توليد جلسات ${dayText(date)}` : 'توليد الجلسات')

/** ملخّص ردّ POST /clinic/sessions/generate */
export function generateSummary(date, { created = [], skipped = 0, skipped_apology = 0, skipped_off_week = 0 }) {
  const head = created.length
    ? `جلسات جديدة ليوم ${dayText(date)}: ${created.length}`
    : `لا جلسات جديدة ليوم ${dayText(date)}`
  const why = [
    skipped > 0 && `موجودة مسبقاً: ${skipped}`,
    skipped_apology > 0 && `معتذر: ${skipped_apology}`,
    skipped_off_week > 0 && `خارج دوره: ${skipped_off_week}`,
  ].filter(Boolean)
  return why.length ? `${head} — ${why.join('، ')}` : head
}
