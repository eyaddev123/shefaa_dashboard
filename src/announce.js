// نداء المريض صوتياً على شاشة الصالة عبر Web Speech API (صوت المتصفح — بلا ملفات ولا إنترنت).

// نكتب الرقم بالحروف بدل تمريره رقماً: كثير من الأصوات تقرأ "12" بالإنجليزية أو تتهجّاه رقماً رقماً.
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر',
  'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']

// المئات شاذة الصياغة: «ثلاثمئة» لا «ثلاثةمئة»
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة',
  'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة']

// أرقام الأدوار عملياً < 200، فنغطي حتى 999 ونكتفي.
// تُعيد النص كما هو إن لم يكن رقماً (مثل غرفة اسمها «أ») ليُنطق حرفياً.
export function arabicNumber(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0) return String(n)
  n = num
  if (n === 0) return 'صفر'
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  if (n < 100) {
    const unit = n % 10
    // العربية تقدّم الآحاد على العشرات: 21 = «واحد وعشرون»
    return unit ? `${ONES[unit]} و${TENS[Math.floor(n / 10)]}` : TENS[Math.floor(n / 10)]
  }
  const h = HUNDREDS[Math.floor(n / 100)]
  const rest = n % 100
  return rest ? `${h} و${arabicNumber(rest)}` : h
}

// أسماء الدكاترة مخزَّنة أصلاً بلقبها («د. أحمد الزعبي») — فلا نُضيف «الدكتور» فوقها
export const withTitle = (name = '') =>
  /^(د\.|د |الدكتور|الدكتورة|دكتور|دكتورة)/.test(name.trim()) ? name : `الدكتور ${name}`

export function announcementText({ queue_number, doctor_name, room }) {
  const parts = [`المريض رقم ${arabicNumber(queue_number)}`, `توجّه إلى ${withTitle(doctor_name)}`]
  if (room) parts.push(`غرفة ${arabicNumber(room)}`)
  return `${parts.join('، ')}.`
}

// المتصفح يحمّل الأصوات بشكل غير متزامن — أول نداء بعد فتح الصفحة قد يجد القائمة فارغة
let cachedVoice
const pickArabicVoice = () => {
  if (cachedVoice !== undefined) return cachedVoice
  const voices = window.speechSynthesis?.getVoices?.() || []
  if (voices.length === 0) return null // لم تُحمَّل بعد — لا تُثبّت النتيجة
  cachedVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('ar')) || null
  return cachedVoice
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  // تُطلَق عند اكتمال تحميل قائمة الأصوات، فنُبطل التخزين المؤقت ونعيد الاختيار
  window.speechSynthesis.addEventListener('voiceschanged', () => { cachedVoice = undefined })
}

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

// ينطق الجملة مرتين بفاصل قصير — مثل مكبّرات الصوت في العيادات، فمن لم يسمع أولاً يسمع ثانياً
export function speak(text, { times = 2, gapMs = 700 } = {}) {
  if (!speechSupported()) return
  const synth = window.speechSynthesis
  synth.cancel() // نداء جديد يُلغي القديم: الأحدث هو المهم

  const say = (i) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ar-SA'
    const voice = pickArabicVoice()
    if (voice) u.voice = voice
    u.rate = 0.85   // أبطأ قليلاً — أوضح عبر مكبّر الصوت في صالة مزدحمة
    u.pitch = 1
    u.volume = 1
    if (i + 1 < times) u.onend = () => setTimeout(() => say(i + 1), gapMs)
    synth.speak(u)
  }
  say(0)
}

// نغمة تنبيه قبل الكلام (Web Audio) — تلفت الأنظار للشاشة، وتعمل بلا أي ملف صوتي
let audioCtx
export function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    audioCtx = audioCtx || new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const now = audioCtx.currentTime
    // نغمتان صاعدتان قصيرتان (دينغ-دونغ)
    ;[[880, 0], [1174.66, 0.18]].forEach(([freq, offset]) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // تلاشٍ أسّي يمنع الطقطقة عند القطع المفاجئ
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.4)
    })
  } catch { /* الصوت رفاهية — لا يُعطّل الشاشة */ }
}

// المتصفحات تمنع الصوت قبل أول لمسة من المستخدم. تُستدعى من زر «تفعيل الصوت» على الشاشة.
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      audioCtx = audioCtx || new Ctx()
      audioCtx.resume()
    }
    if (speechSupported()) {
      // نطق صامت يفتح قناة الكلام ضمن سياق اللمسة
      const u = new SpeechSynthesisUtterance('')
      u.volume = 0
      window.speechSynthesis.speak(u)
    }
  } catch { /* تجاهل */ }
}
