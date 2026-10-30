// ═══ تنبيه الطبيب — «مريض جديد بالانتظار» حين يكسر حضورٌ فراغَ العيادة ═══
//
// القاعدة في الخادم وحده (doctor-alert.js هناك): حدث idle_arrival على بثّ الموظفين يُبثّ
// حين صار مريضٌ «حاضراً» والعيادة فارغة تماماً قبله. الشاشة لا تحكم بشيء — تُنفّذ:
//   ١) نغمة قصيرة (/audio/doctor-ring.wav — نغمتان صاعدتان كجرس الصالة، وبديلٌ مولَّد إن تعذّر)
//   ٢) اهتزاز الجوال إن دعمه
//   ٣) عنوان التبويب يرمش «🔔 مريض بالانتظار» حتى يعود الطبيب إليه
// وإشعار النظام (Web Push) يُرسله الخادم بالقاعدة نفسها — هنا الاشتراك فقط.
//
// ★ سياسة التشغيل التلقائي: الصوت يحتاج تفاعلاً سابقاً مع الصفحة. أوّل لمسةٍ/ضغطة في أيّ مكان
// تُهيّئ AudioContext بصمت (primeOnFirstGesture). قبلها يُرفض التشغيل بهدوء: لا خطأ في الكونسول
// — يبقى الاهتزاز والعنوان، والشاشة تعرض «فعّل الصوت» حتى تُلمس.

const RING_URL = '/audio/doctor-ring.wav?v=2026-10-31'
const BLINK_TEXT = '🔔 مريض بالانتظار'

let ctx = null
let buffer = null
let loading = null
const listeners = new Set()

const AudioCtor = () => (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null)

export const audioReady = () => !!ctx && ctx.state === 'running'
export function onAudioState(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const notify = () => listeners.forEach((fn) => { try { fn(audioReady()) } catch { /* مستمعٌ تالف */ } })

function loadBuffer() {
  if (buffer || loading || !ctx) return loading
  loading = fetch(RING_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
    .then((b) => { buffer = b })
    .catch(() => { /* لا ملف ⇒ النغمة المولَّدة */ })
    .finally(() => { loading = null })
  return loading
}

/** يُستدعى من تفاعلٍ صريح (لمسة/ضغطة): يفتح الصوت بصمت. يُعيد true إن صار جاهزاً. */
export async function unlockAudio() {
  const Ctor = AudioCtor()
  if (!Ctor) return false
  try {
    ctx = ctx || new Ctor()
    if (ctx.state === 'suspended') await ctx.resume()
  } catch { return false }
  loadBuffer()
  notify()
  return audioReady()
}

/**
 * أوّل تفاعلٍ مع الصفحة يفتح الصوت — مرّةً واحدة، بلا أثرٍ آخر.
 * ★ عند انتهاء اللمسة (click/touchend) لا بدايتها: فتحُ الصوت يُعيد رسم الشارة، وإعادة الرسم بين
 *   الضغط والرفع كانت تُزيح الزرّ الملموس فتضيع أوّل لمسة في الصفحة عن هدفها. والاثنان تفاعلٌ
 *   يقبله المتصفّح لتشغيل الصوت.
 */
const GESTURES = ['click', 'keydown', 'touchend']
export function primeOnFirstGesture() {
  if (typeof window === 'undefined') return () => {}
  const go = () => { setTimeout(() => unlockAudio().then((ok) => { if (ok) off() }), 0) }
  const off = () => GESTURES.forEach((e) => window.removeEventListener(e, go, true))
  GESTURES.forEach((e) => window.addEventListener(e, go, true))
  return off
}

function synthChime() {
  const now = ctx.currentTime
  ;[[880, 0], [1174.66, 0.2], [1318.51, 0.4]].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + offset)
    osc.stop(now + offset + 0.65)
  })
}

/** النغمة — صامتة بهدوء إن لم يُفتح الصوت بعد. يُعيد true إن عُزفت. */
export function playRing() {
  if (!audioReady()) return false
  try {
    if (buffer) {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      src.start()
    } else synthChime()
    return true
  } catch { return false }
}

// ═══ عنوان التبويب يرمش حتى يعود الطبيب ═══
let blinkTimer = null
let savedTitle = null
export function stopTitleBlink() {
  if (blinkTimer) clearInterval(blinkTimer)
  blinkTimer = null
  if (savedTitle != null) document.title = savedTitle
  savedTitle = null
}
export function startTitleBlink() {
  if (typeof document === 'undefined' || blinkTimer) return
  savedTitle = document.title
  let on = false
  blinkTimer = setInterval(() => { on = !on; document.title = on ? BLINK_TEXT : savedTitle }, 900)
  document.title = BLINK_TEXT
  const back = () => {
    if (document.hidden) return
    stopTitleBlink()
    document.removeEventListener('visibilitychange', back)
    window.removeEventListener('focus', back)
  }
  // الطبيب أمام الشاشة أصلاً: يكفي أن يلمسها
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
  window.addEventListener('pointerdown', back, { once: true })
}

/** التنبيه الكامل: نغمة + اهتزاز + عنوان يرمش. يُعيد ما نُفّذ (للاختبار) */
export function ringDoctor() {
  const played = playRing()
  let vibrated = false
  try { if (navigator.vibrate) vibrated = navigator.vibrate([220, 120, 220]) } catch { /* غير مدعوم */ }
  startTitleBlink()
  return { played, vibrated }
}

// ═══ Web Push: الاشتراك فقط — الإرسال من الخادم بالقاعدة نفسها ═══
const PROMPT_KEY = 'doctor-push-prompt'
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator
  && 'PushManager' in window && 'Notification' in window && window.isSecureContext !== false

/** هل يُعرض «تفعيل التنبيهات؟»: مدعوم، ولم يُقرَّر بعد، ولم يُخفِه الطبيب */
export function shouldOfferPush() {
  if (!pushSupported() || Notification.permission !== 'default') return false
  try { return localStorage.getItem(PROMPT_KEY) !== 'dismissed' } catch { return true }
}
export function dismissPushOffer() {
  try { localStorage.setItem(PROMPT_KEY, 'dismissed') } catch { /* وضع التصفّح الخاص */ }
}

const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/**
 * يطلب الإذن ويشترك ويُرسل الاشتراك للخادم. أيّ رفضٍ أو نقصٍ ⇒ false بصمت.
 * @param {{key:()=>Promise, subscribe:(sub)=>Promise}} api
 */
export async function enablePush(api) {
  try {
    if (!pushSupported()) return false
    const { enabled, key } = await api.key()
    if (!enabled) return false
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') { dismissPushOffer(); return false }
    const reg = await navigator.serviceWorker.register('/doctor-sw.js')
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
    await api.subscribe(sub.toJSON())
    return true
  } catch { return false }
}

/** إذنٌ ممنوحٌ سابقاً: يجدّد الاشتراك بصمت عند فتح الشاشة (المتصفّح قد يُبدّله) */
export async function refreshPush(api) {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    const { enabled } = await api.key()
    if (enabled) await enablePush(api)
  } catch { /* بصمت */ }
}
