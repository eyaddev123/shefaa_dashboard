import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { pickGrid, lastRowOffset } from '../display-layout.js'

// ═══════════════════════════════════════════════════════════════════
// شاشة «الدور» — ترتيب الانتظار كاملاً، للتلفاز الثاني
//
// شاشة النداء (/display) تقول «من يُخدَم الآن ومن بعده»، وهذه تقول «أين أنا من
// الطابور» — فيكفّ المريض عن سؤال الاستقبال كل خمس دقائق.
//
// ═══ الخصوصية: أرقامٌ فقط ═══
// لا اسم، ولا تمييزٌ للإسعافي بلونٍ أو شارة. تمييزه على شاشةٍ عامة يكشف واقعةً
// طبية عن شخصٍ بعينه أمام الصالة كلها — وترتيبه في القائمة يكفي عملياً.
// (نفس قرار لافتة التأخير في /display: عامّة بلا ربطٍ بأي بطاقة.)
//
// ولا صوت هنا إطلاقاً: النداء وظيفة الشاشة الأولى، وصوتان في صالةٍ واحدة تشويش.
// ═══════════════════════════════════════════════════════════════════

const FALLBACK_REFRESH_MS = 60000
const OFFLINE_ALERT_MS = 120000
const DAILY_RELOAD_HOUR = 3
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]

const two = (n) => String(n).padStart(2, '0')
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']

// ═══ مقاسات بطاقة الدور ═══
// تختلف عن بطاقة النداء: هناك رقمٌ ضخم واحد، وهنا قائمةٌ تطول وتقصر. فالمقاس
// يتبع **عدد الأسطر المعروضة** لا البطاقة وحدها — وإلا فاضت القائمة أو تضاءلت.
// ولكلّ نصٍّ حدٌّ أدنى بالبكسل يُقرأ من ٤–٥ أمتار، كما في شاشة النداء.
// القائمة بطلة هذه الشاشة لا الرقم الحالي: المريض يبحث عن **موقعه** في الدور،
// والرقم الحالي تقوله شاشة النداء بحجمٍ ضخم أصلاً. فحدّ السطر الأدنى مرتفع.
const MIN = { doctor: 20, room: 22, current: 40, item: 24, label: 13 }

export function orderFonts(cardW, cardH, rowCount) {
  if (!cardW || !cardH) return null
  const base = Math.min(cardW, cardH * 1.35)
  const px = (frac, min) => Math.max(min, Math.round(base * frac))
  // الرقم الحالي بطل البطاقة لكنه أصغر من بطل شاشة النداء: القائمة تشاركه المكان
  const current = Math.max(MIN.current, Math.round(Math.min(cardW * 0.2, cardH * 0.13)))
  const room = Math.max(MIN.room, Math.min(Math.round(cardW * 0.1), Math.round(current * 0.52)))
  const doctor = Math.min(px(0.085, MIN.doctor), Math.round(room * 0.95))
  // سطر القائمة: يُقسَّم المتاح على عدد الأسطر فعلاً — سطرٌ واحد يكبر، وعشرون تصغر
  const listH = Math.max(0, cardH * 0.52)
  const item = Math.max(MIN.item,
    Math.min(Math.round(cardW * 0.13), Math.round(listH / Math.max(1, rowCount) * 0.68)))
  return { current, room, doctor, item, label: Math.max(MIN.label, Math.round(doctor * 0.62)) }
}

// كم سطراً يتّسع له ارتفاع القائمة؟ الباقي يُختصر بـ«+N».
// (ارتفاع السطر ≈ الخطّ × 1.45 مع الفراغ بين الأسطر.)
/**
 * كم سطراً يُعرض من قائمةٍ طولها total؟
 *
 * سطر «+N» يشغل سطراً من القائمة أيضاً — فإن أُغفل فاض آخر سطرٍ حقيقي وقُصّ.
 * والحجز الأعمى لسطرٍ دائماً يُخفي مريضاً حتى حين تتّسع القائمة للجميع.
 * فالقاعدة: إن اتّسع الكلّ عُرض الكلّ، وإلا حُجز سطرٌ واحد لـ«+N».
 *
 * @returns {number} عدد الأسطر المعروضة (وما بقي يُختصر بـ«+N»)
 */
export function visibleRows(listPx, itemFont, total) {
  if (!listPx || !itemFont) return 0
  // ارتفاع السطر 1.45 من الخطّ (مضبوط في .od-list)
  const capacity = Math.floor(listPx / (itemFont * 1.45))
  if (capacity <= 0) return 0
  if (total <= capacity) return total          // يتّسع الكلّ — لا «+N»
  return Math.max(1, capacity - 1)             // سطرٌ محجوزٌ لـ«+N»
}

// الأرقام العربية للترتيب: ١) ٢) ٣) — أوضح للقارئ العربي من 1) 2)
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)])

export default function OrderDisplay() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [live, setLive] = useState(false)
  const [offlineSince, setOfflineSince] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [viewH, setViewH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0))
  const gridRef = useRef(null)
  const [gridBox, setGridBox] = useState({ w: 0, h: 0 })
  const retryStep = useRef(0)

  const deviceKey = new URLSearchParams(window.location.search).get('key') || ''

  const load = useCallback(
    () => api.clinic.publicBoard().then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message)),
    [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── الارتفاع المرئي فعلاً (لا 100vh: يشمل ما تحت شريط المتصفح في التلفاز) ──
  useEffect(() => {
    const onResize = () => {
      const h = window.innerHeight || document.documentElement.clientHeight || 0
      if (h > 0) setViewH(h)
    }
    window.addEventListener('resize', onResize)
    // visualViewport غائبة في أندرويد القديم — نفحص قبل الاستعمال
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

  // ── إعادة تحميل مسكّرة مرّة باليوم: الشاشة تعمل أسابيع بلا إعادة تشغيل ──
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      if (d.getHours() === DAILY_RELOAD_HOUR && d.getMinutes() === 0) window.location.reload()
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // ── شبكة أمان دورية (اللقطة الأولى تأتي من البثّ) ──
  useEffect(() => {
    const timer = setInterval(load, FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // ── قياس الشبكة: منه تُحسب الأعمدة والمقاسات (لا container queries في Chrome 66) ──
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
    let ro
    if (typeof ResizeObserver === 'function' && gridRef.current) {
      ro = new ResizeObserver(measure)
      ro.observe(gridRef.current)
    }
    return () => { if (ro) ro.disconnect() }
  }, [viewH, data?.board?.length, err])

  // ── البثّ: نفس مجرى /display، بلا أي صوت ──
  // حدث `call` هنا يُستعمل كإشارة تحديثٍ فقط: النداء غيّر «يُخدَم الآن» فيلزم
  // سحب اللوحة — ولا نُشغّل صوتاً ولا نعرض لافتة. الصوت وظيفة الشاشة الأولى.
  useEffect(() => {
    if (!deviceKey) return
    let es, retryTimer, closed = false

    const connect = () => {
      if (closed) return
      if (typeof window.EventSource !== 'function') {
        // متصفّحٌ قديم بلا EventSource: سحبةٌ دورية بدل البثّ — أبطأ لكنها تعمل
        setLive(false)
        retryTimer = setTimeout(() => { load(); connect() }, 15000)
        return
      }
      es = new EventSource(
        `/api/public/clinic/display-stream?key=${encodeURIComponent(deviceKey)}`)

      es.onopen = () => { setLive(true); setOfflineSince(null); retryStep.current = 0 }
      es.onerror = () => {
        setLive(false)
        setOfflineSince((t) => t || Date.now())
        es.close()
        const wait = RETRY_MS[Math.min(retryStep.current++, RETRY_MS.length - 1)]
        retryTimer = setTimeout(connect, wait)
      }
      es.addEventListener('snapshot', (ev) => {
        try { setData(JSON.parse(ev.data)); setErr(null) }
        catch { /* إطار تالف — السحبة الدورية تُصلح الصورة */ }
      })
      es.addEventListener('snapshot-failed', () => setErr('تعذّر تحميل اللوحة — إعادة المحاولة'))
      es.addEventListener('call', () => load())
      es.addEventListener('refresh', () => load())
    }

    connect()
    return () => { closed = true; if (es) es.close(); clearTimeout(retryTimer) }
  }, [deviceKey, load])

  const docCount = data?.board?.length || 0
  const grid = pickGrid(docCount, gridBox.w, gridBox.h)
  const offset = lastRowOffset(docCount, grid.cols)
  const GAP = 10
  const cardW = grid.cols ? (gridBox.w - GAP * (grid.cols - 1)) / grid.cols : 0
  const cardH = grid.rows ? (gridBox.h - GAP * (grid.rows - 1)) / grid.rows : 0
  // أطول قائمة تحكم المقاس: فلو كبّرنا حسب الأقصر لفاضت الأطول خارج بطاقتها
  const maxArrived = Math.max(1, ...(data?.board || []).map(
    (b) => (b.queue || []).filter((q) => q.arrived).length))
  const fonts = orderFonts(cardW, cardH, Math.min(maxArrived, 12))
  // ═══ ارتفاع القائمة يُشتقّ من التخطيط، ولا يُقاس بعد الرسم ═══
  // القياس يأتي متأخّراً دورةً، فيُحسب عدد الأسطر على مقاسٍ بائت وتُعرض أسطرٌ
  // تُقصّ بصمت. وكلّ ما فوق القائمة يتبع خطوطاً نحسبها نحن، فنطرحها حساباً:
  //   البطاقة − (الاسم + الغرفة + «يُخدَم الآن» + الرقم + عنوان «الدور» + الحشو)
  const listPx = fonts
    ? Math.max(0, cardH
        - fonts.doctor * 1.15 - fonts.room * 1.45      // الترويسة
        - fonts.label * 1.2 - fonts.current * 1.05     // «يُخدَم الآن» والرقم
        - fonts.label * 1.2                            // عنوان «الدور»
        // حشو البطاقة والفواصل والحدود، وهامشُ أمانٍ صغير: الاشتقاق يقارب
        // الواقع ببضعة بكسلات، وتقديرٌ زائدٌ بـ٣px يُفيض سطراً كاملاً فيُقصّ.
        // فالنقصان يُظهر «+N» (مرئيّ ومفهوم)، والزيادة تقصّ بصمت.
        - 40)
    : 0
  const fit = fonts ? visibleRows(listPx, fonts.item, maxArrived) : 0

  const fontVars = fonts ? {
    '--od-current': `${fonts.current}px`,
    '--od-room': `${fonts.room}px`,
    '--od-doctor': `${fonts.doctor}px`,
    '--od-item': `${fonts.item}px`,
    '--od-label': `${fonts.label}px`,
  } : {}

  const offlineLong = offlineSince && Date.now() - offlineSince > OFFLINE_ALERT_MS
  const clock = `${two(now.getHours())}:${two(now.getMinutes())}`
  const dateText = `${AR_DAYS[now.getDay()]} ${now.getDate()} ${AR_MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="pd-root" dir="rtl" style={viewH ? { height: `${viewH}px` } : undefined}>
      {offlineLong && (
        <div className="pd-offline-alert" role="alert">
          ⚠️ انقطع الاتصال — الأرقام المعروضة قد لا تكون محدَّثة
        </div>
      )}

      <header className="pd-head">
        <div className="pd-brand">
          <span className="pd-logo">🏥</span>
          <span className="pd-title">الدور — مجمع عيادات الشفاء الطبي</span>
        </div>
        <div className="pd-clock">
          <div className="pd-time">{clock}</div>
          <div className="pd-date">{dateText}</div>
        </div>
        <div className="pd-tools">
          <span className={`pd-dot ${live ? 'pd-dot-on' : 'pd-dot-off'}`} title={live ? 'متصل' : 'منقطع'} />
        </div>
      </header>

      {err && <p className="pd-err">{err}</p>}

      {!deviceKey ? (
        <p className="pd-msg">الرابط ناقص رمز الجهاز — راجع SERVER_DEPLOYMENT.md</p>
      ) : !data ? (
        <p className="pd-msg">جارٍ التحميل…</p>
      ) : docCount === 0 ? (
        <p className="pd-msg">لا عيادات مفتوحة حالياً</p>
      ) : (
        <div
          className="pd-grid"
          ref={gridRef}
          style={{ '--cols': grid.cols, '--rows': grid.rows, '--pd-gap': `${GAP}px`, ...fontVars }}
        >
          {data.board.map((b, i) => {
            // الحاضرون وحدهم: من حجز ولم يحضر ليس في الطابور بعد، وإظهاره يُربك
            // من ينتظر فعلاً («أين الرقم ٧؟ لم يأتِ بعد»).
            const arrived = (b.queue || []).filter((q) => q.arrived)
            const shown = fit > 0 ? arrived.slice(0, fit) : arrived
            const hidden = arrived.length - shown.length
            return (
              <div key={b.doctor_name} className="od-card"
                style={offset && i === docCount - (docCount - (grid.rows - 1) * grid.cols)
                  ? { gridColumnStart: offset + 1 } : undefined}>
                <div className="od-head">
                  <div className="od-doctor">{b.doctor_name}</div>
                  {/* «العيادة» على الشاشة، و«الغرفة» في الصوت كما سُجّل */}
                  {b.room && <div className="od-room">العيادة {b.room}</div>}
                </div>

                <div className="od-current">
                  <span className="od-label">يُخدَم الآن</span>
                  <span className={`od-current-num ${b.current ? '' : 'pd-dim'}`}>
                    {b.current ? b.current.queue_number : '—'}
                  </span>
                </div>

                <div className="od-list-wrap">
                  <div className="od-label od-list-label">الدور</div>
                  {arrived.length === 0 ? (
                    <div className="od-empty">لا أحد بانتظار الدخول</div>
                  ) : (
                    <ol className="od-list">
                      {shown.map((q, k) => (
                        <li key={q.queue_number}>
                          <span className="od-idx">{arNum(k + 1)})</span>
                          <span className="od-num">{q.queue_number}</span>
                        </li>
                      ))}
                      {hidden > 0 && (
                        <li className="od-more">+{arNum(hidden)}</li>
                      )}
                    </ol>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
