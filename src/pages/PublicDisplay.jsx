import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { announcementText, chime, speak, speechSupported, unlockAudio, withTitle } from '../announce.js'

// شبكة أمان فقط: البثّ المباشر (SSE) هو مصدر التحديث الفعلي، وهذه السحبة تُصلح
// أي فرق لو انقطع الاتصال دون أن يلاحظ المتصفح
const FALLBACK_REFRESH_MS = 60000
const BANNER_MS = 12000        // مدة بقاء بطاقة النداء الكبيرة على الشاشة
const AUDIO_KEY = 'display-audio-on'

export default function PublicDisplay() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [live, setLive] = useState(false)
  // المتصفحات تمنع الصوت التلقائي قبل تفاعل المستخدم — نتذكّر الإذن بعد أول لمسة
  const [audioOn, setAudioOn] = useState(() => localStorage.getItem(AUDIO_KEY) === '1')
  const [banner, setBanner] = useState(null)

  const audioOnRef = useRef(audioOn)
  audioOnRef.current = audioOn
  const bannerTimer = useRef(null)

  const load = useCallback(
    () => api.clinic.publicBoard().then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message)),
    [])

  // ── سحب اللوحة: مرة عند الفتح، ثم كشبكة أمان دورية ──
  useEffect(() => {
    load()
    const timer = setInterval(load, FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // ── البثّ المباشر: النداء يظهر ويُنطق لحظة ضغط الدكتور على الزر ──
  useEffect(() => {
    const es = new EventSource(api.clinic.displayStreamUrl())

    es.onopen = () => { setLive(true); setErr(null) }
    // EventSource يعيد الاتصال تلقائياً؛ نكتفي بإظهار انقطاع البثّ
    es.onerror = () => setLive(false)

    es.addEventListener('call', (ev) => {
      let card
      try { card = JSON.parse(ev.data) } catch { return }

      setBanner(card)
      clearTimeout(bannerTimer.current)
      bannerTimer.current = setTimeout(() => setBanner(null), BANNER_MS)

      if (audioOnRef.current) {
        chime()
        // نمهل النغمة لتنتهي قبل بدء الكلام، وإلا تراكبا
        setTimeout(() => speak(announcementText(card)), 700)
      }
      load() // النداء غيّر «يُخدَم الآن» و«التالي» — أعِد سحب اللوحة
    })

    es.addEventListener('refresh', () => load())

    return () => { es.close(); clearTimeout(bannerTimer.current) }
  }, [load])

  const enableAudio = () => {
    unlockAudio()
    setAudioOn(true)
    localStorage.setItem(AUDIO_KEY, '1')
    chime()
  }

  return (
    <div className="public-display">
      <header className="public-display-header">
        <div className="public-display-logo">🏥</div>
        <h1>جمعية الشفاء الخيرية — عيادات اليوم</h1>
        <div className="pd-header-tools">
          <span className={`pd-live ${live ? '' : 'pd-live-off'}`}>
            {live ? 'البثّ متصل' : 'إعادة الاتصال…'}
          </span>
          {!audioOn && speechSupported() && (
            <button type="button" className="pd-audio-btn" onClick={enableAudio}>
              🔊 تفعيل الصوت
            </button>
          )}
        </div>
      </header>

      {err && <p className="error" style={{ textAlign: 'center' }}>{err}</p>}

      {!data ? (
        <p className="empty" style={{ textAlign: 'center', fontSize: 22 }}>جارٍ التحميل…</p>
      ) : data.board.length === 0 ? (
        <p className="empty" style={{ textAlign: 'center', fontSize: 22 }}>لا عيادات مفتوحة حالياً</p>
      ) : (
        <div className="public-display-grid">
          {data.board.map((b, i) => (
            // نُبرز بطاقة الدكتور صاحب النداء الجاري ليربط المريض الصوت بمكانه
            <div
              className={`public-display-card ${banner && banner.doctor_name === b.doctor_name ? 'pd-card-active' : ''}`}
              key={i}
            >
              <div className="pd-doctor">{b.doctor_name}</div>
              <div className="pd-specialty">{b.specialty || '—'}</div>

              <div className="pd-current">
                <div className="pd-label">يُخدَم الآن</div>
                {b.current ? (
                  <div className="pd-number">
                    {b.current.queue_number}
                    <span className="pd-name">{b.current.first_name}</span>
                  </div>
                ) : (
                  <div className="pd-number pd-dim">—</div>
                )}
              </div>

              <div className="pd-next">
                <div className="pd-label">التالي</div>
                {b.next ? (
                  <div className="pd-next-number">
                    {b.next.queue_number} <span>{b.next.first_name}</span>
                  </div>
                ) : (
                  <div className="pd-next-number pd-dim">—</div>
                )}
              </div>

              <div className="pd-queue-len">{b.queue_length} في الطابور</div>
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
            <div className="pd-banner-name">{banner.first_name}</div>
            <div className="pd-banner-doctor">
              توجّه إلى {withTitle(banner.doctor_name)}
              {banner.room && <span className="pd-banner-room">غرفة {banner.room}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
