// تقطيع رقم الدور إلى مقاطع صوتية مسجَّلة — دالة صافية بلا أي اعتماد على المتصفح،
// فتُختبر مباشرةً (server/test/audio-clips.test.js يستوردها بالمسار النسبي).
//
// ═══ لماذا مقاطع مسجَّلة لا قراءة آلية ═══
// الأصوات العربية في speechSynthesis تختلف من جهاز لجهاز، وقد لا تكون مثبَّتة على
// جهاز الشاشة إطلاقاً — فتصمت الشاشة بلا خطأ ظاهر. التسجيلات الجاهزة هي الأساس،
// وقراءة المتصفح احتياطٌ للمقطع الناقص وحده (انظر announce.js).

import { arabicNumber } from './announce.js'

// أسماء الملفات لاتينية بلا مسافات: أسماء عربية في نظام الملفات وفي عناوين HTTP
// تُرمَّز (percent-encode) فتصير عرضةً لاختلاف الترميز بين الخادم والمتصفح.
const ONES_CLIPS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS_CLIPS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS_CLIPS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
// المئات شاذة الصياغة في العربية («ثلاثمئة» لا «ثلاثة مئة») فلكلٍّ مقطعه المستقل
const HUNDREDS_CLIPS = ['', 'hundred', 'two-hundred', 'three-hundred']

// أعلى رقم دور تغطيه المقاطع. أرقام الأدوار عملياً < 200، والتغطية حتى 399
// تُبقي هامشاً بلا أن تنفخ قائمة التسجيلات.
export const MAX_SPOKEN_NUMBER = 399

// المقاطع الثابتة (غير الأرقام)
export const FIXED_CLIPS = {
  chime: 'chime',        // نغمة التنبيه
  number: 'number',      // «الرقم»
  goTo: 'go-to',         // «يرجى التوجه إلى» — ومقطع الغرفة يكملها
  and: 'and',            // «و» — واصل الآحاد بالعشرات
}

export const roomClip = (room) => `room-${String(room).trim()}`

// يحوّل عدداً (0–99) لمقاطعه. العربية تقدّم الآحاد على العشرات: 21 = «واحد وعشرون».
const under100 = (n) => {
  if (n < 10) return [ONES_CLIPS[n]]
  if (n < 20) return [TEENS_CLIPS[n - 10]]
  const unit = n % 10
  const tens = TENS_CLIPS[Math.floor(n / 10)]
  // مضاعف صحيح للعشرة → مقطع العشرات وحده
  return unit ? [ONES_CLIPS[unit], FIXED_CLIPS.and, tens] : [tens]
}

/**
 * يُعيد قائمة أسماء المقاطع التي تُنطق الرقم، أو [] إن كان خارج التغطية.
 * القائمة الفارغة ليست خطأً بل إشارة للمُنادي أن يكتفي بالنغمة ويحذّر في console
 * — لا أن يسكت عن النداء كله.
 */
export function numberToClips(n) {
  const num = Number(n)
  if (!Number.isInteger(num) || num < 1 || num > MAX_SPOKEN_NUMBER) return []
  if (num < 100) return under100(num)
  const rest = num % 100
  const hundreds = [HUNDREDS_CLIPS[Math.floor(num / 100)]]
  // «مئة وواحد وعشرون»: الواصل «و» بين المئة وما بعدها
  return rest ? [...hundreds, FIXED_CLIPS.and, ...under100(rest)] : hundreds
}

// النصّ المنطوق لكل مقطع — مرجعٌ واحد يقرأه AUDIO.md ويُستعمل في
// الاحتياط الآلي (speechSynthesis) عند غياب ملف المقطع.
export const CLIP_TEXT = {
  [FIXED_CLIPS.chime]: '(نغمة تنبيه — بلا كلام)',
  [FIXED_CLIPS.number]: 'الرقم',
  [FIXED_CLIPS.goTo]: 'يرجى التوجه إلى',
  [FIXED_CLIPS.and]: 'و',
  ...Object.fromEntries(ONES_CLIPS.slice(1).map((c, i) => [c, arabicNumber(i + 1)])),
  ...Object.fromEntries(TEENS_CLIPS.map((c, i) => [c, arabicNumber(i + 10)])),
  ...Object.fromEntries(TENS_CLIPS.filter(Boolean).map((c, i) => [c, arabicNumber((i + 2) * 10)])),
  ...Object.fromEntries(HUNDREDS_CLIPS.slice(1).map((c, i) => [c, arabicNumber((i + 1) * 100)])),
}

// كل المقاطع غير الغرف — تُحمَّل مسبقاً عند فتح الصفحة، لا وقت النداء.
export const ALL_NUMBER_CLIPS = [
  ...Object.values(FIXED_CLIPS),
  ...ONES_CLIPS.slice(1),
  ...TEENS_CLIPS,
  ...TENS_CLIPS.filter(Boolean),
  ...HUNDREDS_CLIPS.slice(1),
]

/**
 * تركيب النداء كاملاً: نغمة → «الرقم» → أرقام الرقم → «يرجى التوجه إلى» → مقطع الغرفة.
 * بلا غرفة مسجَّلة → نغمة + الرقم وحده (قرار مثبَّت: لا يُنطق اسم الدكتور أبداً).
 */
export function buildCallClips({ queue_number, room }) {
  const digits = numberToClips(queue_number)
  const clips = [FIXED_CLIPS.chime]
  if (digits.length) clips.push(FIXED_CLIPS.number, ...digits)
  // مقطعٌ واحد لكل غرفة يقول «الغرفة ثلاثة» كاملاً — لا تقطيعٌ رقمي، فالغرف
  // قليلة ومعروفة، وقد يكون اسمها حرفاً («أ») لا رقماً يُقطَّع.
  if (digits.length && room) clips.push(FIXED_CLIPS.goTo, roomClip(room))
  return clips
}
