import { useEffect, useState } from 'react'
import { api, fmtTime, todayLocal } from '../api.js'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'

// ═══ «عملت إجراء» — زرٌّ واحد للطبيب ═══
//
// بسيطٌ عمداً: زرّ، قائمة، تأكيد. **ولا مبالغ إطلاقاً** — الطبيب يقول ما فعله،
// والمال شأنُ الاستقبال (الاستيفاء) والمشرف (التقسيم). عرضُ السعر هنا يُقحم
// الطبيب في حسابٍ ليس له، ويجعل الشاشة تكشف تسعيرةً أمام المريض الجالس قبالته.
function DoneProcedure({ appointmentId, onDone, onError }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || list) return
    api.clinic.procedures().then((rows) => setList(rows.filter((p) => p.is_active)))
      .catch((e) => { onError(e.message); setOpen(false) })
  }, [open])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const pick = async (proc) => {
    setBusy(true)
    try {
      await api.clinic.addAppointmentProcedure(appointmentId, proc.id)
      setOpen(false)
      onDone(`سُجّل الإجراء: ${proc.name}`)
    } catch (e) { onError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="ghost" disabled={busy}
        onClick={() => setOpen(true)} style={{ padding: '14px 20px', fontSize: 15 }}>
        ✚ عملت إجراء
      </button>
      {open && (
        <div className="modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false) }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="proc-title">
            <h3 id="proc-title">أيّ إجراء عملت؟</h3>
            {!list ? <p className="empty">جارٍ التحميل…</p>
              : list.length === 0 ? <p className="empty">لا إجراءات مُعرَّفة.</p>
              : (
                <div className="prio-choices">
                  {list.map((p) => (
                    <button key={p.id} type="button" className="prio-choice"
                      disabled={busy} onClick={() => pick(p)}>
                      <span className="prio-label">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            <div className="bf-actions" style={{ marginTop: 14 }}>
              <button type="button" className="ghost" disabled={busy}
                onClick={() => setOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function DoctorScreen() {
  const [sessions, setSessions] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [queue, setQueue] = useState(null)
  // ★ الخطأ لا يستبدل الشاشة. loadErr لأوّل تحميل فقط (لا بيانات تُعرض بعد) ومعه زرّ
  // إعادة المحاولة؛ وأي خطأ بعدها — زرٌّ رُفض أو تحديثٌ دوري انقطع — إشعارٌ عابر
  // والطابور الأخير باقٍ. (كان خطأ إعادة النداء 429 يُبقي الطبيب أمام صفحة فارغة،
  // وانقطاعٌ واحد في التحديث الدوري يُبقيها فارغة حتى يُعيد تحميلها بيده.)
  const [loadErr, setLoadErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, showToast] = useToast()

  const loadSessions = () => api.clinic.mySessions(todayLocal()).then((rows) => {
    setSessions(rows); setLoadErr(null)
    if (!sessionId && rows.length) setSessionId(rows[0].id)
  }).catch((e) => setLoadErr(e.message))

  useEffect(() => { loadSessions() }, [])

  const loadQueue = () => {
    if (!sessionId) return
    api.clinic.queue(sessionId).then((q) => { setQueue(q); setLoadErr(null) })
      .catch((e) => {
        // طابورٌ معروض ⇒ يبقى، والتحديث الدوري يُعيد المحاولة وحده
        if (queue) showToast(`تعذّر تحديث الطابور — يُعاد المحاولة تلقائياً (${e.message})`)
        else setLoadErr(e.message)
      })
  }
  useEffect(() => { loadQueue() }, [sessionId])

  // ★ نمط الحضور: الاستقبال يعلّم الحضور فيتغيّر الطابور من خارج هذه الشاشة — تحديث دوري.
  // نمط الخانات يبقى كما كان (بلا تحديث دوري).
  const attendance = isAttendanceSession(queue)
  usePolling(loadQueue, attendance && !!sessionId)

  const act = async (fn, apptId) => {
    setBusy(true)
    try { await fn(apptId) }
    catch (ex) { showToast(ex.message) }
    // بعد النجاح والفشل معاً: الرفض (409) يعني غالباً أن الطابور تغيّر من شاشة أخرى
    finally { setBusy(false); loadQueue() }
  }

  if (loadErr && !sessions) return (
    <div className="load-failed">
      <p className="error">{loadErr}</p>
      <button className="ghost" onClick={loadSessions}>إعادة المحاولة</button>
    </div>
  )
  if (!sessions) return <p className="empty">جارٍ التحميل…</p>
  if (sessions.length === 0) return <p className="empty">لا جلسات لك اليوم.</p>

  const current = queue?.appointments.find((a) => a.status === 'in_service')
  const arrivedWaiting = queue?.appointments.filter((a) => a.status === 'arrived') || []
  // نمط الحضور: الغائب لا يظهر للطبيب ولا يوقف أحداً — القائمة للحاضرين وحدهم.
  // والترتيب من الخادم (الإسعافي الحاضر أولاً ثم الأقدم حضوراً).
  const stillWaiting = attendance ? []
    : queue?.appointments.filter((a) => a.status === 'waiting') || []
  const nextUp = arrivedWaiting[0]

  return (
    <>
      <h2>شاشة الدكتور</h2>
      <p className="subtitle">جلستك الحالية، مَن يُخدَم الآن، ومَن ينتظر دوره</p>

      {sessions.length > 1 && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 16 }}>
          <label>الجلسة</label>
          <select value={sessionId || ''} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</option>
            ))}
          </select>
        </div>
      )}

      {toast}

      {!queue ? (loadErr ? (
        <div className="load-failed">
          <p className="error">{loadErr}</p>
          <button className="ghost" onClick={loadQueue}>إعادة المحاولة</button>
        </div>
      ) : <p className="empty">جارٍ التحميل…</p>) : (
        <>
          <div className="card highlight">
            <h3>قيد الكشف الآن</h3>
            {current ? (
              <div className="action-row">
                <div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--primary)' }}>
                    الدور {current.queue_number}
                    {attendance && <AttendanceBadge priority={current.priority} />}
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>{current.full_name}</div>
                  {current.reason && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>سبب الزيارة: {current.reason}</div>}
                  {attendance && current.started_at && (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>بدأ الكشف {fmtClock(current.started_at)}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {/* ★ بدء الكشف منفصل عن النداء: بين النداء ودخول المريض الغرفة دقائق لا
                      تُحسب من الكشف. إنهاءٌ بلا بدء يُستبعد من حساب المدة — لا تخمين. */}
                  {attendance && !current.started_at && (
                    <button className="attn-start-btn" disabled={busy} onClick={() => act(api.clinic.start, current.id)}>
                      ▶ بدء الكشف
                    </button>
                  )}
                  {/* المريض لم يسمع النداء أو لم يصل بعد — يُعاد بثّه على شاشة الصالة بلا تغيير حالته */}
                  {/* معطَّل طوال مدّة خنق الخادم مع عدٍّ ظاهر — فلا تصل ضغطةٌ ثانية لتُرفض */}
                  <RecallButton apptId={current.id} onError={showToast}
                    style={{ padding: '14px 20px', fontSize: 15 }} />

                  {/* قبل «إنهاء الكشف»: الإجراء يُسجَّل والمريض ما زال في الغرفة */}
                  <DoneProcedure appointmentId={current.id}
                    onDone={showToast} onError={showToast} />

                  <button disabled={busy} onClick={() => act(api.clinic.done, current.id)} style={{ padding: '14px 28px', fontSize: 15 }}>
                    إنهاء الكشف
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty">لا أحد قيد الكشف حالياً.</p>
            )}
          </div>

          <div className="card">
            <h3>التالي في الطابور</h3>
            {nextUp ? (
              <div className="action-row">
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>
                    الدور {nextUp.queue_number} — {nextUp.full_name}
                    {attendance && <AttendanceBadge priority={nextUp.priority} />}
                  </div>
                  {nextUp.reason && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{nextUp.reason}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy || !!current} onClick={() => act(api.clinic.call, nextUp.id)} style={{ padding: '10px 22px' }}>
                    نادِ التالي
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => act(api.clinic.noShow, nextUp.id)} style={{ padding: '10px 16px' }}>
                    لم يحضر
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty">لا أحد حاضر بانتظار الدور بعد.</p>
            )}
            {current && nextUp && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>أنهِ الكشف الحالي أولاً قبل استدعاء التالي.</p>
            )}
          </div>

          {/* الطابور كامل: مَن وصل ومَن لم يصل في مكان واحد، بالترتيب */}
          <div className="card">
            <h3>
              {attendance ? `الحاضرون (${arrivedWaiting.length})` : `الطابور كامل (${arrivedWaiting.length + stillWaiting.length})`}
              {!attendance && (
                <span className="doc-queue-legend">
                  <span className="doc-dot doc-dot-here" /> وصل ({arrivedWaiting.length})
                  <span className="doc-dot doc-dot-away" /> لم يصل ({stillWaiting.length})
                </span>
              )}
            </h3>
            {arrivedWaiting.length + stillWaiting.length === 0 ? (
              <p className="empty">لا أحد بانتظار الدور — الجميع انتهى أو لم يُحجز بعد.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>الدور</th><th>الاسم</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {/* الحاضرون أولاً — هم مَن يُنادى منهم فعلياً */}
                  {arrivedWaiting.map((a) => (
                    <tr key={a.id} className={[a.id === nextUp?.id ? 'doc-row-next' : '',
                      attendance ? urgentRowClass(a) : ''].filter(Boolean).join(' ') || undefined}>
                      <td className="num">{a.queue_number}</td>
                      <td>{a.full_name}{attendance && <AttendanceBadge priority={a.priority} />}</td>
                      <td>
                        <span className="badge good">وصل</span>
                        {a.id === nextUp?.id && <span className="doc-next-tag">التالي</span>}
                      </td>
                    </tr>
                  ))}
                  {stillWaiting.map((a) => (
                    <tr key={a.id} className="doc-row-away">
                      <td className="num">{a.queue_number}</td>
                      <td>{a.full_name}</td>
                      <td><span className="badge">لم يصل بعد</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  )
}
