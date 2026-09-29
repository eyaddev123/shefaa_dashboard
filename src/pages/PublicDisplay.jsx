import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { withTitle } from '../announce.js'
import { callAudio, loadSettings } from '../call-audio.js'
import { roomClip } from '../audio-clips.js'

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
  // البطاقات التي تغيّر رقمها حديثاً — تُومض ليلفت التغيّر النظر حتى لو الصوت مقفول
  const [flashing, setFlashing] = useState({})

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

  const offlineLong = offlineSince && Date.now() - offlineSince > OFFLINE_ALERT_MS
  const clock = `${two(now.getHours())}:${two(now.getMinutes())}`
  const dateText = `${AR_DAYS[now.getDay()]} ${now.getDate()} ${AR_MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="pd-root" dir="rtl">
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
            <p className="pd-missing">مقاطع ناقصة: {callAudio.missingClips().join('، ')}</p>
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
        <div className="pd-grid" style={{ '--cols': Math.min(3, data.board.length) }}>
          {data.board.map((b) => (
            <div
              key={b.doctor_name}
              className={`pd-card ${flashing[b.doctor_name] ? 'pd-flash' : ''} ${
                banner && banner.doctor_name === b.doctor_name ? 'pd-card-active' : ''}`}
            >
              <div className="pd-card-head">
                {/* اسم الدكتور يظهر ولا يُنطق أبداً — ولا اسم مريض هنا إطلاقاً */}
                <div className="pd-doctor">{b.doctor_name}</div>
                <div className="pd-specialty">{b.specialty || '—'}</div>
              </div>

              <div className="pd-current-wrap">
                <div className="pd-label">يُخدَم الآن</div>
                <div className={`pd-number ${b.current ? '' : 'pd-dim'}`}>
                  {b.current ? b.current.queue_number : '—'}
                </div>
                {b.room && <div className="pd-room">الغرفة {b.room}</div>}
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
