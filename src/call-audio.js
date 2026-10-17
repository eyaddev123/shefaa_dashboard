// مشغّل النداء الصوتي على شاشة الصالة — مقاطع مسجَّلة عبر Web Audio، بطابور محلي.
//
// لماذا Web Audio لا <audio>: عنصر <audio> يبدأ بتأخير غير مضمون ولا يُصطفّ، فتتراكب
// نداءتان إن نادى دكتوران في نفس اللحظة. هنا نفكّ كل المقاطع مسبقاً إلى AudioBuffer
// فيبدأ التشغيل فوراً، ونصطفّ المقاطع بأنفسنا فلا تتراكب أبداً.

import { ALL_NUMBER_CLIPS, CLIP_TEXT, FIXED_CLIPS, RECORDED_ROOMS, buildCallClips, roomClip } from './audio-clips.js'
import { announcementText, speak, speechSupported } from './announce.js'

const CLIP_DIR = '/audio/calls'
const CLIP_EXT = '.mp3'    // مدعوم في كل متصفح حديث، وحجمه أصغر من wav لشاشةٍ تحمّل ٤٠ مقطعاً

// ═══ نسخة التسجيلات — ارفعها **كلما تغيّر أي تسجيل** ═══
// أسماء المقاطع ثابتة (room-3.mp3)، و/audio/ يُخدَم بـ max-age=7d وCloudflare يخزّنه
// على حافّته المدة نفسها ويتجاهل إعادة التحميل القسرية من المتصفح. فتسجيلٌ جديد بالاسم
// نفسه قد لا يصل الشاشة أسبوعاً. ?v= يجعل العنوان جديداً فيُجلب من الخادم مباشرة.
// القيمة نصٌّ حرّ يصف التغيير؛ وتصل الشاشة مع الحزمة الجديدة (index.html غير مخزَّن).
export const AUDIO_VERSION = '2026-10-17-ordinal-rooms'
export const SETTINGS_KEY = 'display-audio-settings'

// حدود الطابور: نداءات متأخّرة لا قيمة لها — المريض الذي نودي قبل دقيقة إمّا دخل
// أو فاته الدور. فنُبقي الأحدث ونُسقط ما قبلها بدل أن نُشغّل تاريخاً كاملاً.
const MAX_QUEUE = 2
const QUEUED_DROP_THRESHOLD = 3

export const DEFAULT_SETTINGS = { volume: 0.9, repeats: 2, gapMs: 2000 }

export const loadSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_SETTINGS.volume,
      repeats: Number.isInteger(raw.repeats) ? Math.min(4, Math.max(1, raw.repeats)) : DEFAULT_SETTINGS.repeats,
      gapMs: Number.isInteger(raw.gapMs) ? Math.min(6000, Math.max(0, raw.gapMs)) : DEFAULT_SETTINGS.gapMs,
    }
  } catch { return { ...DEFAULT_SETTINGS } }
}

export const saveSettings = (s) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* وضع التصفّح الخاص */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ═══ مدّة انتظار القراءة الآلية ═══
// speechSynthesis لا يُعطي مدّةً قبل النطق، وonend غير موثوق على بعض الأجهزة (يتأخّر
// أو لا يقع) فلا نعلّق النداءة عليه. نقدّرها من طول النصّ بمعدّل نطقٍ محافظ مع هامش:
// تقديرٌ زائد يترك سكتةً قصيرة، وناقصٌ يجعل المقطع التالي يتراكب على القراءة.
const SPEECH_MS_PER_CHAR = 95
const SPEECH_MIN_MS = 700
const SPEECH_SENTENCE_MS = 2500
const speechMsFor = (text) =>
  Math.max(SPEECH_MIN_MS, Math.round(String(text).length * SPEECH_MS_PER_CHAR))

// ═══ مقاطع لها بديلٌ مولَّد في المتصفح ═══
// غياب ملفها **ليس نقصاً**: النغمة تُركَّب بـ Web Audio (synthChime) — وchime.mp3 غائبٌ
// عمداً. كان يُعامَل كمقطع ناقص فيُطلق القراءة الآلية بعد **كل** نداءة: يسمع المرضى
// التسجيل ثم صوتاً آلياً يعيد الجملة كلها، ويظهر «ناقص» في لوحة ⚙ بلا داعٍ.
// إن وُضع الملف يوماً فالتسجيل يُستعمل بدل المولَّد تلقائياً.
const SYNTHESIZED_CLIPS = new Set([FIXED_CLIPS.chime])

class CallAudio {
  constructor() {
    this.ctx = null
    this.buffers = new Map()      // اسم المقطع → AudioBuffer
    this.missing = new Set()      // مقاطع غائبة — حُذّر عنها مرّة ولا تُعاد المحاولة
    this.substituted = new Set()  // غائبة ولها بديلٌ مولَّد — ليست نقصاً ولا تُعاد المحاولة
    this.inflight = new Map()     // اسم المقطع → وعد الجلب الجاري (يمنع الجلب المزدوج والتخطّي)
    this.queue = []
    this.playing = false
    this.settings = loadSettings()
    this.onStateChange = null
  }

  get unlocked() { return this.ctx?.state === 'running' }

  notify() { this.onStateChange?.() }

  // يُستدعى من ضغطة زر «تشغيل الصوت»: المتصفح يمنع كل صوت قبل تفاعلٍ صريح،
  // فبلا هذه الضغطة تبقى الشاشة صامتة بعد كل إعادة تشغيل بلا أي خطأ ظاهر.
  async unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return false
    this.ctx = this.ctx || new Ctx()
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})
    this.notify()
    // نداءةٌ وصلت والصوت مقفول تبقى في الطابور بلا مُصرِّف (drain يخرج فوراً وهو
    // مقفول). فبلا هذا السطر تُلتقط أول نداءة بعد الضغطة صامتةً حتى تأتي التالية.
    if (this.unlocked) this.drain()
    return this.unlocked
  }

  /**
   * يحمّل ويفكّ كل المقاطع مسبقاً. يُستدعى عند فتح الصفحة لا وقت النداء: فكّ الترميز
   * يأخذ مئات الميلي ثانية، ولو جرى وقت النداء لتأخّر الصوت عن ظهور الرقم على الشاشة.
   * @param {string[]} roomClips مقاطع الغرف العاملة اليوم
   */
  async preload(roomClips = []) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    this.ctx = this.ctx || new Ctx()
    // غرف اليوم أولاً ثم **كلّ** الغرف المسجَّلة: الاكتفاء بغرف اللوحة كان يُسكت
    // نداءةَ أيّ غرفةٍ لم تكن على اللوحة لحظة التحميل (جلسة تبدأ لاحقاً، أو دكتور
    // بلا غرفة ثمّ تُسنَد له). والملفّات ٢٥ ك.ب للواحد — عشرُها أرخص من نداءةٍ صامتة.
    const names = [...new Set([...ALL_NUMBER_CLIPS, ...roomClips,
      ...RECORDED_ROOMS.map(roomClip)])]
    await Promise.all(names.map((n) => this.fetchClip(n)))
    this.notify()
  }

  /**
   * يجلب مقطعاً **مرّةً واحدة** ويعيد وعدَه المحفوظ. السبب: `playCall` كان يفحص
   * `buffers.has()` فحصاً **لحظياً**؛ فنداءةٌ تصل والجلب لم ينتهِ تجد الخزانة فارغة
   * فتتخطّى المقطع صامتةً وتُطلق القارئ الآلي فوق التسجيلات — صوتان معاً. بحفظ الوعد
   * ينتظره النداء بدل أن يفترض غيابه.
   */
  fetchClip(name) {
    if (this.buffers.has(name) || this.missing.has(name) || this.substituted.has(name))
      return Promise.resolve()
    const inflight = this.inflight.get(name)
    if (inflight) return inflight
    const p = this.doFetchClip(name).finally(() => this.inflight.delete(name))
    this.inflight.set(name, p)
    return p
  }

  async doFetchClip(name) {
    try {
      const res = await fetch(`${CLIP_DIR}/${encodeURIComponent(name)}${CLIP_EXT}?v=${encodeURIComponent(AUDIO_VERSION)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
      this.buffers.set(name, buf)
    } catch (e) {
      if (SYNTHESIZED_CLIPS.has(name)) { this.substituted.add(name); return }
      // مقطع ناقص لا يوقف النداء: يُسجَّل تحذيرٌ يقرأه من يسجّل المقاطع، ويُستعاض
      // عنه بقراءة المتصفح عند النطق (انظر playClips).
      this.missing.add(name)
      console.warn(`[audio] مقطع ناقص: ${name}${CLIP_EXT} — النصّ المطلوب: «${CLIP_TEXT[name] || name}» (${e.message})`)
    }
  }

  // النغمة المولَّدة: بديلٌ عن chime.mp3 إن غاب، فلا تبدأ النداءة بصمت
  synthChime() {
    const now = this.ctx.currentTime
    ;[[880, 0], [1174.66, 0.18]].forEach(([freq, offset]) => {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.35 * this.settings.volume, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35)
      osc.connect(gain).connect(this.ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.4)
    })
    return sleep(600)
  }

  playBuffer(name) {
    return new Promise((resolve) => {
      const buf = this.buffers.get(name)
      if (!buf) return resolve()
      const src = this.ctx.createBufferSource()
      const gain = this.ctx.createGain()
      gain.gain.value = this.settings.volume
      src.buffer = buf
      src.connect(gain).connect(this.ctx.destination)
      src.onended = resolve
      src.start()
    })
  }

  /**
   * يُشغّل نداءةً واحدة كاملة. المقاطع الحاضرة تُشغَّل من التسجيل، والناقصة تُجمَّع
   * ويقرأها المتصفح مرّةً واحدة في آخر النداءة — لا مقطعاً مقطعاً، فالقراءة الآلية
   * المتقطّعة أسوأ من جملةٍ واحدة متّصلة.
   */
  async playCall(card) {
    const clips = buildCallClips(card)

    // ═══ انتظر مقاطع هذه النداءة قبل الحكم بغيابها ═══
    // جوهر العطب القديم: الحكم كان لحظياً. غرفةٌ لم تُحمَّل مسبقاً (دكتور بلا غرفة
    // على اللوحة، أو غرفة ١٠، أو جلسة بدأت بعد التحميل) تجد خزانتها فارغة فتُتخطّى
    // ويقرأ الآلي الجملة فوق التسجيلات. هنا نجلب الناقص وننتظره أولاً — والجلب
    // محفوظٌ بالوعد فلا يتكرّر ولا يُعاد لمقطعٍ ثبت غيابه.
    await Promise.all(clips.map((c) => this.fetchClip(c)))

    // الناقص فعلاً — يُحسب **بعد** الانتظار لا قبله، وإلا عاد العطب نفسه من بابٍ آخر.
    const missingInCall = clips.filter((c) => !this.buffers.has(c) && !SYNTHESIZED_CLIPS.has(c))
    if (missingInCall.length) {
      // سطرٌ صريح يقرأه من يسجّل المقاطع: أيُّ مقطعٍ رُمّم آلياً في هذه النداءة بعينها
      console.warn(`[audio] رُمّم آلياً في النداءة: ${missingInCall.join(', ')}`)
    }

    // ═══ هل نقرأ الجملة كلّها آلياً أم نرمّم الناقص وحده؟ ═══
    // القراءة الكاملة فوق تسجيلاتٍ تعمل = صوتان متراكبان، وهو ما سُمع في الصالة.
    // فالقاعدة: إن حضرت كلّ المقاطع فلا قراءة آلية إطلاقاً. وإن نقص بعضها رُمّم
    // الناقص **في موضعه** بين التسجيلات، فتبقى الجملة واحدة متّصلة بصوتَين لا جملتين.
    // ولا تُقرأ الجملة كاملةً إلا إن غاب كلُّ كلامها (فلا شيء يُتراكب عليه).
    const spokenOf = (name) => CLIP_TEXT[name] || ''
    const speechClips = clips.filter((c) => !SYNTHESIZED_CLIPS.has(c))
    const allSpeechMissing = speechClips.length > 0
      && speechClips.every((c) => !this.buffers.has(c))

    if (allSpeechMissing && speechSupported()) {
      // لا تسجيل واحد حاضر — اقرأ الجملة كاملةً، فهي كل ما يُسمع
      // (قرارٌ مثبَّت: لا يُنطق اسم الدكتور — announcementText تُستدعى بلا doctor_name.)
      if (clips.includes('chime') && !this.buffers.has('chime')) await this.synthChime()
      speak(announcementText({ queue_number: card.queue_number, room: card.room }), { times: 1 })
      await sleep(SPEECH_SENTENCE_MS)
      return
    }

    for (const name of clips) {
      if (name === 'chime' && !this.buffers.has(name)) { await this.synthChime(); continue }
      if (this.buffers.has(name)) { await this.playBuffer(name); continue }
      // مقطعٌ ناقصٌ وسط نداءةٍ عاملة: يُقرأ آلياً **وحده وفي موضعه**، والانتظار
      // بقدر طوله لا بثابتٍ واحد، وإلا تراكب على ما بعده.
      const text = spokenOf(name)
      if (text && speechSupported()) {
        speak(text, { times: 1 })
        await sleep(speechMsFor(text))
      }
    }
  }

  /** يضيف نداءةً للطابور. النداءة الأحدث أهمّ من القديمة عند التراكم. */
  enqueue(card) {
    this.queue.push(card)
    if (this.queue.length > QUEUED_DROP_THRESHOLD) {
      const queued = this.queue.length
      this.queue = this.queue.slice(-MAX_QUEUE)
      console.warn(`[audio] تراكم ${queued} نداءات — شُغّل آخر ${MAX_QUEUE} وأُسقط ${queued - MAX_QUEUE}`)
    }
    this.drain()
  }

  async drain() {
    if (this.playing || !this.unlocked) return
    this.playing = true
    try {
      while (this.queue.length) {
        const card = this.queue.shift()
        for (let i = 0; i < this.settings.repeats; i++) {
          await this.playCall(card)
          if (i + 1 < this.settings.repeats) await sleep(this.settings.gapMs)
        }
      }
    } finally {
      this.playing = false
    }
  }

  setSettings(patch) {
    this.settings = { ...this.settings, ...patch }
    saveSettings(this.settings)
    this.notify()
  }

  /** المقاطع الناقصة — تُعرض للاستقبال ليعرف ما يلزم تسجيله */
  missingClips() { return [...this.missing] }
}

export const callAudio = new CallAudio()
export { roomClip }
