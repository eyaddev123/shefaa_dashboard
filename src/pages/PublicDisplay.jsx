import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { withTitle } from '../announce.js'
import { callAudio, loadSettings } from '../call-audio.js'
import { roomClip, CLIP_TEXT } from '../audio-clips.js'

// شبكة أمان فقط: البثّ المباشر (SSE) هو مصدر التحديث الفعلي، وهذه السحبة تُصلح
// أي فرق لو انقطع الاتصال دون أن يلاحظ المتصفح
const FALLBACK_REFRESH_MS = 60000
const BANNER_MS = 12000          // مدة بقاء بطاقة النداء الكبيرة على الشاشة
const FLASH_MS = 3000            // وميض البطاقة عند تغيّر رقمها
const OFFLINE_ALERT_MS = 120000  // بعد دقيقتين انقطاع: لافتة صريحة لا مؤشّر صغير
const DAILY_RELOAD_HOUR = 3      // إعادة تحميل مسكّرة: تتخلّص من تراكم الذاكرة وبناءٍ قديم

// تباعد متزايد لإعادة الاتصال: EventSource يعيد المحاولة بثبات، ونحن نتحكّم بها
// بأنفسنا لأنّ رمز الجهاز قد يُرفض (401) فلا معنى لمحاولةٍ كل ثانية.
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]

// ═══ توزيع البطاقات: نختار الشبكة التي تُكبّر البطاقة فعلاً ═══
//
// التوزيع الثابت («٣ أعمدة لما فوق الأربعة») كان يُخرج ٧ بطاقات صفوفاً ٣+٣+١:
// بطاقةٌ يتيمة في صفٍّ وحدها، ونصف الشاشة السفلي فارغ على تلفاز الصالة.
//
// البديل: نجرّب كل عدد أعمدة ممكن ونقيس **مساحة البطاقة الناتجة** بالبكسل
// (من عرض الشبكة وارتفاعها الحقيقيَّين)، ونأخذ الأكبر. ثم نرجّح التوازن:
// شبكةٌ تترك صفّاً أخيرَ شبهَ فارغ تُخصم، فيخرج ٧ ⇒ ٤+٣ لا ٣+٣+١.
//
// ولماذا لا نسبة ثابتة للبطاقة: البطاقة تملأ خانتها مهما كانت — المهم أن تكون
// الخانة أكبر ما يمكن وأقرب إلى مربّع، فالنصّ يكبر معها.
const AR_CARD_IDEAL = 1.25   // نسبة عرض/ارتفاع مفضّلة للبطاقة (أعرض قليلاً من مربّع)

export function pickGrid(n, gridW, gridH) {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (!gridW || !gridH) return { cols: Math.min(n, 3), rows: Math.ceil(n / Math.min(n, 3)) }

  let best = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = gridW / cols
    const ch = gridH / rows
    // مساحة الخانة — المقياس الأول: بطاقة أكبر = نصّ أكبر
    const area = cw * ch
    // عقوبة الانحراف عن النسبة المفضّلة: خانةٌ شريطيّة (طويلة ضيّقة أو عريضة
    // مسطّحة) مساحتها كبيرة لكنّ النصّ فيها يبقى صغيراً، فالأضيق يحكمه.
    const ar = cw / ch
    const arPenalty = Math.min(ar / AR_CARD_IDEAL, AR_CARD_IDEAL / ar)
    // عقوبة الصفّ الأخير الناقص: ٧ في ٣ أعمدة تترك صفّاً فيه بطاقة من ثلاث.
    const lastRow = n - (rows - 1) * cols
    const balance = lastRow / cols
    // ═══ الارتفاع أندرُ من العرض ═══
    // البطاقة تحتاج ارتفاعاً أدنى لتحمل: اسم + رقم + غرفة + صفّ التالي. فشبكةٌ
    // بصفوفٍ كثيرة تُقصّر البطاقة حتى يُقصّ محتواها مهما اتّسع عرضها. (٩ أطباء
    // على ٩٦٠×٥٤٠: ٣×٣ تعطي بطاقة ١٣٦px فيُقصّ الرقم، و٥+٤ تعطي ٢٠٠px فتسلم.)
    const MIN_CARD_H = 150
    const heightPenalty = ch >= MIN_CARD_H ? 1 : Math.pow(ch / MIN_CARD_H, 2)
    const score = area * arPenalty * heightPenalty * (0.55 + 0.45 * balance)
    if (!best || score > best.score) best = { cols, rows, score }
  }
  return { cols: best.cols, rows: best.rows }
}

// توزيع بطاقات الصفّ الأخير حين لا يكتمل: تُوسَّط بدل أن تنزوي في جانب.
// CSS Grid وحده لا يُوسّط صفّاً ناقصاً، فنُزيح أولى بطاقاته بـ grid-column-start.
// (grid-column-start مدعوم في Chrome 66 — لا subgrid ولا شيء حديث.)
export function lastRowOffset(n, cols) {
  const lastRow = n - (Math.ceil(n / cols) - 1) * cols
  if (lastRow === cols) return 0
  return Math.floor((cols - lastRow) / 2)
}

// ═══ مقاسات البطاقة — محسوبة بالـ JS لا بـ CSS ═══
//
// لماذا لا CSS: المقاسات كلها كانت داخل @supports (container-type: size)،
// وChrome 66 — متصفّح تلفاز الصالة — **لا يملكها**. فيسقط إلى القواعد الأساسية
// المبنيّة على vw بسقوفٍ ثابتة (clamp(10px, 0.9vw, 17px)): على شاشة 1920 يعطي
// 17px لـ«يُخدَم الآن» و24px للغرفة. هذه هي «النقاط الصغيرة» التي تُرى من بعيد.
//
// فنحسبها من **مقاس البطاقة نفسه**، ولكلّ عنصرٍ حدٌّ أدنى بالبكسل يُقرأ من ٤–٥ م.
// الترتيب البصري مقصود: الرقم ← الغرفة ← الاسم ← التالي/بعده ← الاختصاص.
const MIN = { number: 56, room: 28, doctor: 20, label: 15, upNum: 24, upLabel: 13, specialty: 13 }

export function cardFonts(cardW, cardH) {
  if (!cardW || !cardH) return null
  // الأضيق يحكم: نصٌّ مربوط بالعرض وحده يفيض طولاً في بطاقة عريضة قصيرة، والعكس.
  const base = Math.min(cardW, cardH * 1.35)
  const px = (frac, min) => Math.max(min, Math.round(base * frac))
  // ═══ الميزانية العمودية: مقيسة لا مخمَّنة ═══
  // البطاقة ثلاثة صفوف (grid: auto 1fr auto). قياسٌ فعلي بالمتصفّح أعطى
  // الترويسة ≈٢٢٪ وصفّ التالي ≈٢١٪ والوسط ≈٤٨٪ من ارتفاع البطاقة.
  // والوسط يحمل ثلاثة: «يُخدَم الآن» ثم الرقم ثم الغرفة — ومجموع ارتفاعاتها
  // الصندوقية يجب أن يبقى **داخل** الوسط، وإلا فاضت الغرفة فقصّها overflow
  // واختفت من الشاشة (رُصد فعلاً: صندوقها ٩px وخطّها ٥٨px).
  //
  // ارتفاع الصندوق ≈ الخطّ × ارتفاع السطر. فنوزّع الوسط بنسبٍ تجمع إلى ١:
  //   «يُخدَم الآن» ١٦٪ · الرقم ٥٤٪ · الغرفة ٢٢٪ · ٨٪ للفجوات والحشو.
  // نصيب الوسط من البطاقة. الترويسة وصفّ «التالي» يتناسبان مع الخطّ أيضاً،
  // فنسبتهما شبه ثابتة: قياسٌ فعلي أعطى الوسط ٤٦–٤٨٪ عند ٧ و٩ بطاقات.
  // ونأخذ ٤٦٪ لا أكثر: التقدير الزائد يُخفي الغرفة تماماً (خطأٌ صامت لا يُرى
  // إلا في الصالة)، والناقص يصغّر الخطّ قليلاً فقط (خطأٌ مرئي وقابل للضبط).
  // بطاقةٌ قليلة العدد تملك فائض ارتفاع (الترويسة وصفّ التالي لا ينموان بنفس
  // النسبة)، فنعطيها نصيباً أكبر من الوسط. والصغيرة تبقى على ٤٦٪ المقيسة.
  const midH = cardH * (cardH >= 600 ? 0.56 : cardH >= 380 ? 0.50 : 0.46)
  // الخطّ = نصيب الصندوق ÷ ارتفاع السطر (number 1.02، room 1.25 + حشو 0.16em)
  const numberByH = (midH * 0.54) / 1.02
  const roomByH = (midH * 0.22) / 1.41
  // الرقم بطل الشاشة: الأضيق بين نصيبه العمودي وعرض البطاقة يحكم
  let number = Math.max(MIN.number, Math.round(Math.min(cardW * 0.44, numberByH)))
  // الغرفة ثانية الأهمية: عدّة أطباء يتشاركون رقم «التالي» فالغرفة هي المميِّز
  let room = Math.max(MIN.room, Math.round(Math.min(cardW * 0.15, roomByH)))

  // ═══ حين لا يتّسع الوسط للحدّين الأدنيين معاً ═══
  // (٩ أطباء على ١٣٦٦×٧٦٨: البطاقة ١٩٩px، الترويسة وصفّ التالي يأخذان ١٠٢ فيبقى
  // ٦٨ بينما «يُخدَم الآن» + الرقم + الغرفة تحتاج ١١٦.) الحدّ الأدنى يمنع «النقاط
  // الصغيرة» لكنّه إن تجاوز المتاح فاضت الغرفة فقصّها overflow واختفت **بلا أثر**
  // — وهو أسوأ عطبٍ ممكن: الغرفة ثانية الأهمية.
  //
  // فبدل تصغير الخطّ إلى ما لا يُقرأ، نُقلّل **عدد الأسطر**:
  //   أولاً: يسقط «يُخدَم الآن» — الرقم الضخم تحت اسم الدكتور مفهومٌ بذاته.
  //   ثم: الغرفة تُختصر إلى رقمها («٦» بدل «الغرفة ٦») وتنتقل بجانب الرقم.
  const labelH = () => Math.max(MIN.label, Math.min(px(0.062, MIN.label), Math.round(room * 0.7)))
  const budget = midH * 0.95
  const needed = (withLabel, roomBeside) =>
    number * 1.02 + (roomBeside ? 0 : room * 1.41) + (withLabel ? labelH() * 1.2 : 0)

  let showLabel = true
  let roomBeside = false
  if (needed(showLabel, roomBeside) > budget) showLabel = false
  if (needed(showLabel, roomBeside) > budget) roomBeside = true
  if (needed(showLabel, roomBeside) > budget) {
    // آخر ما يُضحّى به: الرقم ينزل إلى حدّه الأدنى — والغرفة تبقى كما هي
    number = Math.max(MIN.number, Math.floor((budget - 0) / 1.02))
  }
  const roomCompact = roomBeside
  const doctor = Math.min(px(0.105, MIN.doctor), Math.round(room * 0.88))
  const upNum = Math.min(px(0.105, MIN.upNum), Math.round(room * 0.88))
  return {
    number,
    room,
    roomCompact,
    showLabel,
    doctor,
    upNum,
    label: Math.min(px(0.062, MIN.label), Math.round(doctor * 0.8)),
    upLabel: Math.min(px(0.052, MIN.upLabel), Math.round(doctor * 0.7)),
    specialty: Math.min(px(0.055, MIN.specialty), Math.round(doctor * 0.7)),
  }
}

const two = (n) => String(n).padStart(2, '0')
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']

export default function PublicDisplay() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [live, setLive] = useState(false)
  const [offlineSince, setOfflineSince] = useState(null)
  const [audioReady, setAudioReady] = useState(false)
  const [banner, setBanner] = useState(null)
  const [settings, setSettings] = useState(() => loadSettings())
  const [showSettings, setShowSettings] = useState(false)
  const [now, setNow] = useState(() => new Date())
  // نسبة النافذة: أعرض من 2:1 تعني ارتفاعاً لا يكفي صفّين من البطاقات
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth / window.innerHeight > 2)
  // ═══ الارتفاع المرئي الفعلي بالبكسل ═══
  // 100vh في متصفحات التلفاز (وبعض الأجهزة اللوحية) = الشاشة كاملةً **بما تحت شريط
  // المتصفح**، فتطول اللوحة عن المرئي ويُقصّ صفّ «التالي/بعده» أسفلها — حدث على شاشة
  // الصالة. innerHeight هو المرئي فعلاً في كل متصفح، فنثبّت الارتفاع عليه ونحدّثه مع
  // كل تغيّر (مقاس، ملء شاشة، ظهور الشريط). وCSS يبقى احتياطاً (100dvh ثم 100vh).
  const [viewH, setViewH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0))
  // البطاقات التي تغيّر رقمها حديثاً — تُومض ليلفت التغيّر النظر حتى لو الصوت مقفول
  const [flashing, setFlashing] = useState({})

  // مقاس الشبكة الفعلي بالبكسل — منه تُحسب الأعمدة ومقاسات الخطّ.
  // يُقاس بعد الرسم لا يُخمَّن: الترويسة واللافتات تتغيّر فيتغيّر المتاح.
  const gridRef = useRef(null)
  const [gridBox, setGridBox] = useState({ w: 0, h: 0 })

  const bannerTimer = useRef(null)
  const flashTimers = useRef({})
  const lastSeq = useRef(0)       // يُسقط الحدث المكرّر فلا تُنطق نداءةٌ مرّتين
  const prevNumbers = useRef({})  // doctor_name → رقم «يُخدَم الآن» السابق
  const retryStep = useRef(0)

  // رمز الجهاز من عنوان الصفحة: ?key=... — الشاشة تُفتح بهذا الرابط عند إقلاع الجهاز
  const deviceKey = new URLSearchParams(window.location.search).get('key') || ''

  const load = useCallback(
    () => api.clinic.publicBoard().then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message)),
    [])

  // ── الساعة ──
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── نسبة النافذة: تُعيد توزيع البطاقات عند تغيّر المقاس أو دوران الشاشة ──
  useEffect(() => {
    const onResize = () => {
      const h = window.innerHeight || document.documentElement.clientHeight || 0
      const w = window.innerWidth || document.documentElement.clientWidth || 0
      setWide(h > 0 && w / h > 2)
      if (h > 0) setViewH(h)
    }
    window.addEventListener('resize', onResize)
    // شريط المتصفح يظهر ويختفي دون resize في بعض المتصفحات؛ وملء الشاشة كذلك.
    // visualViewport غائبةٌ في متصفّحات أندرويد القديمة — نفحص قبل الاستعمال،
    // و`resize` أعلاه يكفيها وحدَه. وorientationchange لأن القديم منها لا يُطلق
    // resize عند الدوران.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (vv && vv.addEventListener) vv.addEventListener('resize', onResize)
    document.addEventListener('fullscreenchange', onResize)
    window.addEventListener('orientationchange', onResize)
    onResize()
    return () => {
      window.removeEventListener('resize', onResize)
      if (vv && vv.removeEventListener) vv.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // ── إعادة تحميل مسكّرة مرّة باليوم ──
  // الشاشة تعمل أسابيع بلا إعادة تشغيل: الذاكرة تتراكم، والبناء الجديد لا يصلها.
  // الثالثة فجراً: لا مرضى ولا نداءات تُقطع.
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      if (d.getHours() === DAILY_RELOAD_HOUR && d.getMinutes() === 0) window.location.reload()
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // ── سحب اللوحة كشبكة أمان دورية (اللقطة الأولى تأتي من البثّ) ──
  useEffect(() => {
    const timer = setInterval(load, FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // ── تحميل المقاطع مسبقاً: عند معرفة غرف اليوم، لا وقت النداء ──
  useEffect(() => {
    if (!data?.board) return
    const rooms = data.board.map((b) => b.room).filter(Boolean).map(roomClip)
    callAudio.preload(rooms)
  }, [data?.board])

  // ── حالة الصوت: الزرّ يظهر ما دام السياق معلّقاً ──
  useEffect(() => {
    callAudio.onStateChange = () => {
      setAudioReady(callAudio.unlocked)
      setSettings({ ...callAudio.settings })
    }
    setAudioReady(callAudio.unlocked)
    return () => { callAudio.onStateChange = null }
  }, [])

  // ── قياس الشبكة: المصدر الوحيد لمقاسات الخطّ على التلفاز ──
  // Chrome 66 بلا container queries، فلا سبيل لربط الخطّ بالبطاقة من CSS.
  // نقيس بالـ JS بعد الرسم ونمرّر المقاسات متغيّراتِ CSS.
  useLayoutEffect(() => {
    const measure = () => {
      const el = gridRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      setGridBox((p) => (p.w === w && p.h === h ? p : { w, h }))
    }
    measure()
    // ResizeObserver غائبة في بعض متصفّحات التلفاز — القياس عند تغيّر viewH
    // والبيانات يكفي، وهذه تحسينٌ لمن يملكها.
    let ro
    if (typeof ResizeObserver === 'function' && gridRef.current) {
      ro = new ResizeObserver(measure)
      ro.observe(gridRef.current)
    }
    return () => { if (ro) ro.disconnect() }
  }, [viewH, data?.board?.length, !!data?.urgent_delays, audioReady, showSettings, err])

  // ── وميض البطاقة عند تغيّر رقمها ──
  const flashDoctor = useCallback((key) => {
    setFlashing((f) => ({ ...f, [key]: true }))
    clearTimeout(flashTimers.current[key])
    flashTimers.current[key] = setTimeout(
      () => setFlashing((f) => { const n = { ...f }; delete n[key]; return n }), FLASH_MS)
  }, [])

  // يكشف تغيّر «يُخدَم الآن» في اللقطة أو بعد سحبة اللوحة — فتومض البطاقة حتى لو
  // لم يصل حدث call (سحبة دورية، أو نداء من نسخةٍ أخرى).
  useEffect(() => {
    if (!data?.board) return
    for (const b of data.board) {
      const num = b.current?.queue_number ?? null
      const key = b.doctor_name
      if (prevNumbers.current[key] !== undefined && prevNumbers.current[key] !== num && num != null) {
        flashDoctor(key)
      }
      prevNumbers.current[key] = num
    }
  }, [data?.board, flashDoctor])

  // ═══════ البثّ المباشر ═══════
  // اللقطة تعرض ولا تصوّت؛ والنداء وحده يصوّت. فإعادة الاتصال — وتتكرّر كثيراً —
  // لا تُعيد النداء على أرقامٍ خُدمت وانتهت.
  useEffect(() => {
    if (!deviceKey) { setErr('رمز جهاز العرض ناقص من الرابط (?key=...)'); return }

    let es, retryTimer, closed = false

    // EventSource غائبةٌ في بعض متصفّحات أندرويد القديمة. بلا هذا الفحص يرمي
    // `new EventSource` فيسقط المكوّن كلّه وتبيضّ الشاشة. البديل: السحبةُ
    // الدورية (FALLBACK_REFRESH_MS) تُبقي اللوحة محدَّثة بلا نداءٍ صوتيّ.
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setLive(false)
      setErr('متصفّح الجهاز لا يدعم البثّ المباشر — تُحدَّث اللوحة دوريّاً بلا صوت')
      const poll = setInterval(load, 15000)
      load()
      return () => clearInterval(poll)
    }

    const connect = () => {
      if (closed) return
      // اتصالٌ جديد = لقطةٌ جديدة، وعدّاد الخادم قد يكون صُفِّر بإعادة الحاوية.
      // فنُصفّر مرجعنا هنا لا في اللقطة وحدها: لو تعذّرت اللقطة (القاعدة تتأخّر
      // لحظة الإقلاع) لبقينا على عدّادٍ قديم فأسقطنا كل نداءات اليوم كأنها مكرّرة.
      lastSeq.current = 0
      es = new EventSource(api.clinic.displayStreamUrl(deviceKey))

      es.onopen = () => {
        setLive(true); setOfflineSince(null); setErr(null)
        retryStep.current = 0
      }

      es.onerror = () => {
        setLive(false)
        setOfflineSince((s) => s || Date.now())
        es.close()
        // تباعد متزايد: الشاشة قد تنتظر عودة الخادم دقائق، فلا تُغرقه بمحاولاتٍ كل ثانية
        const wait = RETRY_MS[Math.min(retryStep.current++, RETRY_MS.length - 1)]
        retryTimer = setTimeout(connect, wait)
      }

      // اللقطة: الحالة الكاملة الآن — تُعرض بلا أي صوت
      es.addEventListener('snapshot', (ev) => {
        try {
          const snap = JSON.parse(ev.data)
          setData(snap)
          setErr(null)
          // نعتمد عدّاد الخادم مرجعاً: أي حدث رقمه ≤ هذا خُدم قبل وصولنا فلا يُنطق
          if (Number.isInteger(snap.seq)) lastSeq.current = snap.seq
        } catch { /* إطار تالف — السحبة الدورية تُصلح الصورة */ }
      })

      es.addEventListener('snapshot-failed', (ev) => {
        setErr('تعذّر تحميل اللوحة — إعادة المحاولة')
        // الخادم يرسل seq مع الفشل أيضاً، فنلتقطه ولا نبقى على عدّادٍ قديم
        try {
          const f = JSON.parse(ev.data)
          if (Number.isInteger(f.seq)) lastSeq.current = f.seq
        } catch { /* لا seq — والتصفير أعلاه كافٍ */ }
      })

      // النداء: هو وحده الذي يصوّت
      es.addEventListener('call', (ev) => {
        let card
        try { card = JSON.parse(ev.data) } catch { return }

        // إسقاط المكرّر: نفس الحدث قد يصل مرّتين (شاشتان، أو إعادة اتصال لحظة البثّ)
        if (Number.isInteger(card.seq)) {
          if (card.seq <= lastSeq.current) return
          lastSeq.current = card.seq
        }

        setBanner(card)
        clearTimeout(bannerTimer.current)
        bannerTimer.current = setTimeout(() => setBanner(null), BANNER_MS)
        flashDoctor(card.doctor_name)

        callAudio.enqueue(card)
        load() // النداء غيّر «يُخدَم الآن» و«التالي» — أعِد سحب اللوحة
      })

      es.addEventListener('refresh', () => load())
    }

    connect()
    return () => {
      closed = true
      es?.close()
      clearTimeout(retryTimer)
      clearTimeout(bannerTimer.current)
    }
  }, [load, deviceKey, flashDoctor])

  // ── قفل السكون: الشاشة تُطفأ من نفسها بعد دقائق بلا لمس ──
  useEffect(() => {
    let lock
    const acquire = async () => {
      try { lock = await navigator.wakeLock?.request?.('screen') }
      catch { /* غير مدعوم أو مرفوض — يبقى ضبط الجهاز نفسه هو الضمان */ }
    }
    acquire()
    // المتصفح يُسقط القفل عند إخفاء الصفحة، فنعيد طلبه عند عودتها
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}) }
  }, [])

  const enableAudio = async () => {
    await callAudio.unlock()
    setAudioReady(callAudio.unlocked)
    const rooms = (data?.board || []).map((b) => b.room).filter(Boolean).map(roomClip)
    callAudio.preload(rooms)
  }

  const patchSettings = (patch) => { callAudio.setSettings(patch); setSettings({ ...callAudio.settings }) }

  const goFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // ═══ الشبكة والمقاسات: تُحسب من مقاس الشبكة المقيس لا من النافذة ═══
  const docCount = data?.board?.length || 0
  const grid = pickGrid(docCount, gridBox.w, gridBox.h)
  const offset = lastRowOffset(docCount, grid.cols)
  // الفجوات تُطرح قبل القسمة وإلا حُسبت البطاقة أكبر مما هي فطفح النصّ
  const GAP = 10
  const cardW = grid.cols ? (gridBox.w - GAP * (grid.cols - 1)) / grid.cols : 0
  const cardH = grid.rows ? (gridBox.h - GAP * (grid.rows - 1)) / grid.rows : 0
  const fonts = cardFonts(cardW, cardH)
  // متغيّرات CSS: قيمٌ بالبكسل محسوبة هنا، فتعمل على Chrome 66 بلا container queries
  const fontVars = fonts ? {
    '--pd-number': `${fonts.number}px`,
    '--pd-room': `${fonts.room}px`,
    '--pd-doctor': `${fonts.doctor}px`,
    '--pd-label': `${fonts.label}px`,
    '--pd-up-num': `${fonts.upNum}px`,
    '--pd-up-label': `${fonts.upLabel}px`,
    '--pd-specialty': `${fonts.specialty}px`,
  } : {}

  const offlineLong = offlineSince && Date.now() - offlineSince > OFFLINE_ALERT_MS
  const clock = `${two(now.getHours())}:${two(now.getMinutes())}`
  const dateText = `${AR_DAYS[now.getDay()]} ${now.getDate()} ${AR_MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="pd-root" dir="rtl" style={viewH ? { height: `${viewH}px` } : undefined}>
      {/* لافتة الصوت المقفول: كبيرة وقابلة للضغط — بدون ضغطةٍ صريحة يمنع المتصفح كل صوت */}
      {!audioReady && (
        <button type="button" className="pd-audio-gate" onClick={enableAudio}>
          🔇 الصوت متوقف — اضغط للتشغيل
        </button>
      )}

      {offlineLong && (
        <div className="pd-offline-alert" role="alert">
          ⚠️ انقطع الاتصال — الأرقام المعروضة قد لا تكون محدَّثة
        </div>
      )}

      <header className="pd-head">
        <div className="pd-brand">
          <span className="pd-logo">🏥</span>
          <span className="pd-title">جمعية الشفاء الخيرية</span>
        </div>
        <div className="pd-clock">
          <div className="pd-time">{clock}</div>
          <div className="pd-date">{dateText}</div>
        </div>
        <div className="pd-tools">
          <span className={`pd-dot ${live ? 'pd-dot-on' : 'pd-dot-off'}`} title={live ? 'متصل' : 'منقطع'} />
          <button type="button" className="pd-icon-btn" onClick={goFullscreen} title="ملء الشاشة">⛶</button>
          <button type="button" className="pd-icon-btn" onClick={() => setShowSettings((v) => !v)} title="إعدادات الصوت">⚙</button>
        </div>
      </header>

      {/* لافتة التأخير: عامة بلا ربطٍ بأي بطاقة — ذكر العيادة يكشف واقعةً طبية عن مريض بعينه */}
      {data?.urgent_delays > 0 && (
        <div className="pd-urgent-banner">يوجد حالات إسعافية، نعتذر عن التأخير</div>
      )}

      {showSettings && (
        <div className="pd-settings">
          <label>
            مستوى الصوت
            <input type="range" min="0" max="1" step="0.05" value={settings.volume}
              onChange={(e) => patchSettings({ volume: Number(e.target.value) })} />
            <span>{Math.round(settings.volume * 100)}%</span>
          </label>
          <label>
            عدد الإعادات
            <input type="number" min="1" max="4" value={settings.repeats}
              onChange={(e) => patchSettings({ repeats: Number(e.target.value) })} />
          </label>
          {callAudio.missingClips().length > 0 && (
            // الاسم ومعه النصّ المطلوب تسجيله — «room-3 («الغرفة الثالثة»)» — فيعرف من يسجّل ماذا يقول
            <p className="pd-missing">مقاطع ناقصة: {callAudio.missingClips()
              .map((c) => (CLIP_TEXT[c] ? `${c} («${CLIP_TEXT[c]}»)` : c)).join('، ')}</p>
          )}
        </div>
      )}

      {err && <p className="pd-err">{err}</p>}

      {!deviceKey ? (
        // بلا رمز لا اتصال: نصرّح بالسبب بدل «جارٍ التحميل…» تبقى للأبد
        <p className="pd-msg">الرابط ناقص رمز الجهاز — راجع SERVER_DEPLOYMENT.md</p>
      ) : !data ? (
        <p className="pd-msg">جارٍ التحميل…</p>
      ) : data.board.length === 0 ? (
        <p className="pd-msg">لا عيادات مفتوحة حالياً</p>
      ) : (
        <div
          className="pd-grid"
          ref={gridRef}
          style={{ '--cols': grid.cols, '--rows': grid.rows, '--pd-gap': `${GAP}px`, ...fontVars }}
        >
          {data.board.map((b, i) => (
            <div
              key={b.doctor_name}
              className={`pd-card ${flashing[b.doctor_name] ? 'pd-flash' : ''} ${
                banner && banner.doctor_name === b.doctor_name ? 'pd-card-active' : ''}`}
              /* أولى بطاقات الصفّ الأخير تُزاح لتوسيطه — الصفوف الكاملة بلا إزاحة */
              style={offset && i === docCount - (docCount - (grid.rows - 1) * grid.cols)
                ? { gridColumnStart: offset + 1 } : undefined}
            >
              <div className="pd-card-head">
                {/* اسم الدكتور يظهر ولا يُنطق أبداً — ولا اسم مريض هنا إطلاقاً */}
                <div className="pd-doctor">{b.doctor_name}</div>
                <div className="pd-specialty">{b.specialty || '—'}</div>
              </div>

              {/* عند ضيق الارتفاع تُقلَّل الأسطر لا تُصغَّر الخطوط: يسقط «يُخدَم الآن»
                  أولاً، ثم تنتقل الغرفة بجانب الرقم مختصرةً إلى رقمها. فالغرفة —
                  ثانية الأهمية — تبقى مقروءةً بدل أن يقصّها الضيق فتختفي بلا أثر. */}
              <div className={`pd-current-wrap${fonts?.roomCompact ? ' pd-current-row' : ''}`}>
                {fonts?.showLabel !== false && <div className="pd-label">يُخدَم الآن</div>}
                <div className={`pd-number ${b.current ? '' : 'pd-dim'}`}>
                  {b.current ? b.current.queue_number : '—'}
                </div>
                {b.room && (
                  <div className="pd-room" title={`الغرفة ${b.room}`}>
                    {fonts?.roomCompact ? b.room : `الغرفة ${b.room}`}
                  </div>
                )}
              </div>

              <div className="pd-upcoming">
                <div className="pd-up">
                  <span className="pd-up-label">التالي</span>
                  <span className={`pd-up-num ${b.next ? '' : 'pd-dim'}`}>{b.next?.queue_number ?? '—'}</span>
                </div>
                <div className="pd-up">
                  <span className="pd-up-label">بعده</span>
                  <span className={`pd-up-num ${b.after_next ? '' : 'pd-dim'}`}>{b.after_next?.queue_number ?? '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* بطاقة النداء: تغطي الشاشة لحظة النداء ثم تنسحب تلقائياً */}
      {banner && (
        <div className="pd-banner" role="alert" aria-live="assertive">
          <div className="pd-banner-inner">
            <div className="pd-banner-label">نداء</div>
            <div className="pd-banner-number">{banner.queue_number}</div>
            <div className="pd-banner-dest">
              {banner.room
                ? <>يرجى التوجه إلى <b>الغرفة {banner.room}</b></>
                : <>يرجى التوجه إلى {withTitle(banner.doctor_name)}</>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
