// ═══════════ الطابعة على الشبكة: TCP 9100 مباشرةً، بلا تعريفٍ في نظام التشغيل ═══════════
//
// منفذ 9100 الخام («RAW / JetDirect») يأخذ البايتات كما هي ويطبعها: نفس مهمّة
// ESC/POS التي كانت تمرّ بـ lp أو بالسبولر، بلا وسيطٍ بينهما. لا اسم طابعة،
// ولا CUPS معطّل، ولا BOM — عنوانٌ ومنفذ.
//
// ═══ أكثر من جهازٍ على طابعةٍ واحدة ═══
// المنفذ الخام يخدم اتصالاً واحداً بالوقت غالباً: الثاني يُرفض، أو يُقبل ثمّ
// يُقطع فوراً، أو ينتظر. فنعيد المحاولة — **لكن قبل أن نكتب أوّل بايت فقط**:
// ما كُتب قد يكون طُبع، وإعادته تطبع البطاقة مرّتين.
// ولهذا «فترة تثبّت» قصيرة بعد فتح الاتصال وقبل الكتابة: طابعةٌ مشغولة تقبل
// الاتصال ثمّ تقطعه فوراً تُكشف هنا، والإعادة آمنة لأنّ شيئاً لم يُرسل.
import net from 'node:net'

/** فواصل إعادة المحاولة (ملّي ثانية) — خمس إعادات بعد المحاولة الأولى */
export const RETRY_DELAYS = [300, 600, 1000, 1500, 2000]
/** سقف الوقت الكلّيّ لطباعة بطاقة (محاولاتٌ وانتظار) */
export const RETRY_BUDGET_MS = 20000
/** فترة التثبّت بعد فتح الاتصال وقبل الكتابة */
export const SETTLE_MS = 150
/** بعد تسليم البايتات: كم ننتظر أن تغلق الطابعة طرفها قبل أن نغلق نحن */
export const CLOSE_GRACE_MS = 1500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const REASONS = {
  ECONNREFUSED: 'الطابعة رفضت الاتصال — مشغولةٌ بجهازٍ آخر، أو المنفذ خطأ',
  CLOSED_EARLY: 'الطابعة قبلت الاتصال ثمّ أغلقته قبل الإرسال — مشغولةٌ بجهازٍ آخر غالباً',
  CONNECT_TIMEOUT: 'الطابعة لم تردّ في المهلة — أهي مشغّلة وموصولة بالشبكة؟',
  ETIMEDOUT: 'الطابعة لم تردّ في المهلة — أهي مشغّلة وموصولة بالشبكة؟',
  EHOSTUNREACH: 'لا طريق إلى الطابعة — أهي مشغّلة وموصولة بكبل الشبكة، وهذا الجهاز على شبكة الشفاء؟'
    + ' (على ماك: إن ظهر فوراً فقد يكون إذن «الشبكة المحلية» لـ node غير ممنوح)',
  EHOSTDOWN: 'الطابعة لا تردّ على الشبكة — أهي مشغّلة؟',
  ENETUNREACH: 'هذا الجهاز ليس على شبكةٍ تصل إلى الطابعة — أهو على شبكة الشفاء؟',
  EADDRNOTAVAIL: 'عنوان الطابعة في config.json غير صالح',
  ENOTFOUND: 'عنوان الطابعة في config.json غير صالح',
  ECONNRESET: 'الطابعة قطعت الاتصال',
  EPIPE: 'الطابعة قطعت الاتصال',
  CLOSED_MID: 'الطابعة أغلقت الاتصال قبل أن تستلم البطاقة كاملة',
  WRITE_STALL: 'الطابعة توقّفت عن الاستلام أثناء الإرسال',
}

/** سببٌ مفهوم بالعربية + الرمز التقنيّ بين قوسين */
export function explain(code, msg = '') {
  const ar = REASONS[code] || 'خطأ في الاتصال بالطابعة'
  return `${ar} (${code}${msg && !msg.includes(code) ? `: ${msg}` : ''})`
}

/**
 * محاولةٌ واحدة: اتّصل، اثبت، اكتب، أغلق.
 * @returns {Promise<{ok:boolean, retry?:boolean, wrote:boolean, code?:string, msg?:string, note?:string}>}
 *   retry = آمنٌ أن نعيد (لم يُكتب شيء)، wrote = بدأت الكتابة
 */
function attempt(bytes, { ip, port, connectMs, idleMs }) {
  return new Promise((resolve) => {
    // connecting ⇒ settling ⇒ writing ⇒ flushed
    let phase = 'connecting'
    let done = false
    const timers = []
    const sock = net.connect({ host: ip, port })
    const wrote = () => phase === 'writing' || phase === 'flushed'

    const finish = (r) => {
      if (done) return
      done = true
      timers.forEach(clearTimeout)
      sock.destroy()
      resolve({ wrote: wrote(), ...r })
    }
    /** فشلٌ: يُعاد فقط إن لم نكتب شيئاً، ولسببٍ يدلّ على انشغالٍ عابر */
    const fail = (code, msg = '') => {
      const transient = ['ECONNREFUSED', 'CONNECT_TIMEOUT', 'ETIMEDOUT', 'CLOSED_EARLY',
                         'ECONNRESET', 'EPIPE'].includes(code)
      finish({ ok: false, retry: !wrote() && transient, code, msg })
    }

    timers.push(setTimeout(() => { if (phase === 'connecting') fail('CONNECT_TIMEOUT') }, connectMs))

    // ★ نصرّف ما تقوله الطابعة (حالةٌ تلقائية ASB مثلاً): بايتاتٌ غير مقروءة
    // عند الإغلاق تجعل النظام يرسل RST بدل الإغلاق المهذّب، فتضيع بقيّة البطاقة
    sock.on('data', () => {})

    sock.on('connect', () => {
      phase = 'settling'
      timers.push(setTimeout(() => {
        if (done) return
        phase = 'writing'
        // مهلة خمولٍ أثناء الكتابة: طابعةٌ قبلت ولا تستلم — لا إعادة (قد تطبع لاحقاً)
        sock.setTimeout(idleMs, () => { if (phase === 'writing') fail('WRITE_STALL') })
        sock.end(bytes, () => {
          // كلّ البايتات عند النظام، ونصف الإغلاق (FIN) في طريقه. ننتظر أن
          // تغلق الطابعة طرفها؛ وإن لم تفعل فالبايتات سُلّمت ونكتفي بعد المهلة.
          phase = 'flushed'
          sock.setTimeout(0)
          // (إغلاقنا بعد FIN لا يُضيّع ما في ذاكرة النظام: يُسلَّم ثمّ يُغلق)
          timers.push(setTimeout(() => finish({ ok: true, note: 'الطابعة لم تُغلق الاتصال بعد الاستلام' }),
            Math.min(CLOSE_GRACE_MS, idleMs)))
        })
      }, SETTLE_MS))
    })

    sock.on('end', () => {
      if (phase === 'connecting' || phase === 'settling') fail('CLOSED_EARLY')
      else if (phase === 'writing') fail('CLOSED_MID')
      // flushed: الإغلاق المتوقّع — ننتظر close
    })
    sock.on('close', () => {
      if (phase === 'flushed') finish({ ok: true })
      else if (phase === 'writing') fail('CLOSED_MID')
      else fail('CLOSED_EARLY')
    })
    sock.on('error', (e) => fail(e.code || 'ERROR', e.message))
  })
}

/**
 * يرسل مهمّة ESC/POS للطابعة على الشبكة، مع إعادة المحاولة حين تكون مشغولة.
 * لا يرمي أبداً.
 * @returns {Promise<{ok:boolean, attempts:number, wrote:boolean, code?:string, detail?:string, note?:string}>}
 */
export async function sendNet(bytes, { ip, port, timeoutMs }, { onRetry } = {}) {
  const deadline = Date.now() + RETRY_BUDGET_MS
  let last = null
  for (let i = 0; ; i++) {
    const left = deadline - Date.now()
    const r = await attempt(bytes, {
      ip, port, connectMs: Math.max(200, Math.min(timeoutMs, left)), idleMs: timeoutMs,
    })
    r.attempts = i + 1
    if (r.ok) return r
    last = r
    if (!r.retry || i >= RETRY_DELAYS.length) break
    const wait = RETRY_DELAYS[i]
    if (Date.now() + wait >= deadline) break
    if (onRetry) onRetry(r, wait)
    await sleep(wait)
  }
  return { ...last, detail: explain(last.code, last.msg) }
}

// ═══ حالة الطابعة: DLE EOT n (أمرٌ آنيّ ثنائيّ الاتجاه) ═══
//   10 04 n ⇒ بايتٌ واحد: البتّان 1 و4 دائماً 1، والبتّان 0 و7 دائماً 0
//   n=1 حالة الطابعة: البتّ 3 = غير متّصلة (offline)
//   n=2 سبب عدم الاتّصال: البتّ 2 = الغطاء مفتوح، 5 = انتهى الورق، 6 = خطأ
//   n=4 حسّاس الورق: البتّان 2،3 = قارب على النفاد، 5،6 = انتهى
// نسأل n=1 ثمّ n=4، و n=2 فقط إن قالت n=1 «غير متّصلة» (لنعرف أهو الغطاء).
const DLE_EOT = (n) => Buffer.from([0x10, 0x04, n])
const isStatus = (b) => (b & 0x93) === 0x12

/** تفسير البايتات ⇒ { ready, state } */
export function interpretStatus(s1, s4, s2) {
  if (s1 == null) return { ready: true, state: 'متصلة (لا تدعم قراءة الحالة)' }
  const offline = !!(s1 & 0x08)
  const paperOut = (s4 != null && (s4 & 0x60)) || (s2 != null && (s2 & 0x20))
  if (offline && s2 != null && (s2 & 0x04)) return { ready: false, state: 'الغطاء مفتوح' }
  if (paperOut) return { ready: false, state: 'لا يوجد ورق' }
  if (offline) return { ready: false, state: 'خطأ' }
  if (s4 != null && (s4 & 0x0c)) return { ready: true, state: 'جاهزة — الورق قارب على النفاد' }
  return { ready: true, state: 'جاهزة' }
}

/**
 * فحصٌ قصير: يفتح اتصالاً، يسأل عن الحالة، ويغلق — كلّه خلال totalMs.
 * لا يرمي أبداً.
 * @returns {Promise<{connected:boolean, ready:boolean, state:string, raw?:number[]}>}
 */
export function probe({ ip, port }, totalMs = 1200) {
  return new Promise((resolve) => {
    const start = Date.now()
    const left = () => totalMs - (Date.now() - start)
    const inbox = []
    let waiter = null
    let done = false
    let connected = false
    const sock = net.connect({ host: ip, port })
    const overall = setTimeout(() => finish(null, 'CONNECT_TIMEOUT'), totalMs)

    function finish(result, code, msg) {
      if (done) return
      done = true
      clearTimeout(overall)
      if (waiter) { clearTimeout(waiter.t); waiter.resolve(null); waiter = null }
      sock.destroy()
      resolve(result || { connected: false, ready: false, state: explain(code, msg) })
    }
    sock.on('data', (d) => {
      for (const b of d) inbox.push(b)
      if (waiter) { const w = waiter; waiter = null; clearTimeout(w.t); w.resolve(inbox.shift()) }
    })
    /** البايت التالي، أو null بعد ms */
    const next = (ms) => new Promise((res) => {
      if (inbox.length) { res(inbox.shift()); return }
      if (done || ms <= 0) { res(null); return }
      waiter = { resolve: res, t: setTimeout(() => { waiter = null; res(null) }, ms) }
    })
    const ask = async (n, ms) => {
      inbox.length = 0
      sock.write(DLE_EOT(n))
      const b = await next(Math.min(ms, left() - 20))
      return b != null && isStatus(b) ? b : null
    }

    // بعد فتح الاتصال: انقطاعٌ (إغلاقٌ أو RST) = قبلت ثمّ أغلقت ⇒ مشغولة غالباً
    sock.on('error', (e) => finish(null, connected ? 'CLOSED_EARLY' : (e.code || 'ERROR'), e.message))
    sock.on('close', () => finish(null, 'CLOSED_EARLY'))
    sock.on('connect', async () => {
      connected = true
      try {
        const s1 = await ask(1, 500)
        const s4 = s1 != null ? await ask(4, 300) : null
        const s2 = s1 != null && (s1 & 0x08) ? await ask(2, 300) : null
        sock.end()
        finish({ connected: true, ...interpretStatus(s1, s4, s2),
                 raw: [s1, s4, s2].filter((x) => x != null) })
      } catch (e) { finish(null, 'ERROR', e.message) }
    })
  })
}
