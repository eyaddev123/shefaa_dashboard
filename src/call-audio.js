// مشغّل النداء الصوتي على شاشة الصالة — مقاطع مسجَّلة عبر Web Audio، بطابور محلي.
//
// لماذا Web Audio لا <audio>: عنصر <audio> يبدأ بتأخير غير مضمون ولا يُصطفّ، فتتراكب
// نداءتان إن نادى دكتوران في نفس اللحظة. هنا نفكّ كل المقاطع مسبقاً إلى AudioBuffer
// فيبدأ التشغيل فوراً، ونصطفّ المقاطع بأنفسنا فلا تتراكب أبداً.

import { ALL_NUMBER_CLIPS, CLIP_TEXT, buildCallClips, roomClip } from './audio-clips.js'
import { announcementText, speak, speechSupported } from './announce.js'

const CLIP_DIR = '/audio/calls'
const CLIP_EXT = '.mp3'    // مدعوم في كل متصفح حديث، وحجمه أصغر من wav لشاشةٍ تحمّل ٤٠ مقطعاً
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

class CallAudio {
  constructor() {
    this.ctx = null
    this.buffers = new Map()      // اسم المقطع → AudioBuffer
    this.missing = new Set()      // مقاطع غائبة — حُذّر عنها مرّة ولا تُعاد المحاولة
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
    const names = [...new Set([...ALL_NUMBER_CLIPS, ...roomClips])]
    await Promise.all(names.map((n) => this.fetchClip(n)))
    this.notify()
  }

  async fetchClip(name) {
    if (this.buffers.has(name) || this.missing.has(name)) return
    try {
      const res = await fetch(`${CLIP_DIR}/${encodeURIComponent(name)}${CLIP_EXT}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
      this.buffers.set(name, buf)
    } catch (e) {
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
    const missingInCall = clips.filter((c) => !this.buffers.has(c))

    for (const name of clips) {
      if (name === 'chime' && !this.buffers.has(name)) { await this.synthChime(); continue }
      if (this.buffers.has(name)) await this.playBuffer(name)
    }

    // احتياط القراءة الآلية: التسجيلات هي الأساس، وهذه تُنقذ النداءة إن نقص منها مقطع.
    // (قرارٌ مثبَّت: لا يُنطق اسم الدكتور — announcementText تُستدعى بلا doctor_name.)
    if (missingInCall.length && speechSupported()) {
      speak(announcementText({ queue_number: card.queue_number, room: card.room }), { times: 1 })
      await sleep(2500)
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
