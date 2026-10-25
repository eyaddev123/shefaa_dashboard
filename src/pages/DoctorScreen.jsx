import { useEffect, useState } from 'react'
import { api, fmtTime, todayLocal } from '../api.js'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'
import { waitingReturnOf, serverOffsetOf, Elapsed, useStaffEvents } from '../waiting-return.jsx'

// ═══ ما أُضيف على هذا المريض ═══
// للاطّلاع وحده: الاستقبال يُدخل الإجراءات وموادّها بما تُمليه الممرّضة، والطبيب
// لا يضيف ولا يزيل (الخادم يرفض). بالأسماء وحدها — لا مبالغ أمام المريض.
function AddedProcedures({ added = [] }) {
  const live = (added || []).filter((l) => !l.removed_at)
  if (live.length === 0) return null
  return (
    <div className="doc-procs">
      <span className="doc-procs-label">الإجراءات المضافة:</span>
      {live.map((l) => <span key={l.id} className="doc-proc-chip">{l.name}</span>)}
    </div>
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
        if (queue) showToast(`تعذّر تحديث قائمة الدور — يُعاد المحاولة تلقائياً (${e.message})`)
        else setLoadErr(e.message)
      })
  }
  useEffect(() => { loadQueue() }, [sessionId])

  // ★ نمط الحضور: الاستقبال يعلّم الحضور فيتغيّر الطابور من خارج هذه الشاشة — تحديث دوري.
  // نمط الخانات يبقى كما كان (بلا تحديث دوري).
  const attendance = isAttendanceSession(queue)
  // نمط الحضور: رقم الدور المُعطى عند الحضور (ما تنطقه الصالة) — رقم الحجز داخليّ للاستقبال
  const shownNumber = (a) => (attendance ? (a.arrival_number ?? '—') : a.queue_number)
  usePolling(loadQueue, attendance && !!sessionId)
  // فوريّ: الاستقبال يعلّم الحضور، والمشرف قد ينادي للعودة — بلا انتظار التحديث الدوري
  useStaffEvents(sessionId, loadQueue, !!sessionId)

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
  // خرجوا مؤقتاً (قطرة، صورة…) وسيُنادَون ليُكملوا — ليسوا في الطابور ولا «قيد الكشف»
  const returning = waitingReturnOf(queue?.appointments)
  const offset = serverOffsetOf(queue)

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
                    الدور {shownNumber(current)}
                    {attendance && <AttendanceBadge priority={current.priority} />}
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>{current.full_name}</div>
                  {current.reason && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>ملاحظة الحجز: {current.reason}</div>}
                  {attendance && current.started_at && (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>بدأ الكشف {fmtClock(current.started_at)}</div>
                  )}
                </div>
                {/* ═══ أزرار العمل ═══
                    الترتيب مقصود: «بدء» أولاً (الأخضر الأساسي) ثمّ ما يُفعل أثناء
                    الكشف، و«إنهاء» آخراً وبينهما فاصلٌ مرئيّ — الضغطة الخاطئة هنا
                    تُنهي كشفاً لم يبدأ. وعلى الشاشة الضيّقة صفّان من زرّين بعرضٍ
                    كامل: الأزرار الضخمة كانت تفيض عن الشاشة وتكسر نصّها سطرين. */}
                <div className="doc-actions">
                  {/* ★ بدء الكشف منفصل عن النداء: بين النداء ودخول المريض الغرفة دقائق لا
                      تُحسب من الكشف. إنهاءٌ بلا بدء يُستبعد من حساب المدة — لا تخمين. */}
                  {attendance && !current.started_at && (
                    <button className="doc-btn doc-btn-start" disabled={busy}
                      onClick={() => act(api.clinic.start, current.id)}>
                      <span aria-hidden="true">▶</span> بدء الكشف
                    </button>
                  )}

                  {/* المريض لم يسمع النداء أو لم يصل بعد — يُعاد بثّه على شاشة الصالة بلا تغيير حالته */}
                  {/* معطَّل طوال مدّة خنق الخادم مع عدٍّ ظاهر — فلا تصل ضغطةٌ ثانية لتُرفض */}
                  <RecallButton apptId={current.id} onError={showToast} className="ghost doc-btn" />

                  {/* ★ خروج مؤقت: ثانويّ عمداً (ghost) — المريض يخرج ويعود بدوره، والطبيب
                      ينادي التالي. لا يُنهي شيئاً، فلا يحتاج فاصل «إنهاء الكشف». */}
                  <button className="ghost doc-btn" disabled={busy}
                    title="المريض يخرج (قطرة، صورة…) ويعود بدوره — وتنادي التالي"
                    onClick={() => act(api.clinic.stepOut, current.id)}>
                    <span aria-hidden="true">⏸</span> خروج مؤقت
                  </button>

                  <button className="doc-btn doc-btn-done" disabled={busy}
                    onClick={() => act(api.clinic.done, current.id)}>
                    إنهاء الكشف
                  </button>

                  {/* الشارات سطرٌ مستقلّ أسفل الأزرار — وضعُها بينها يشقّ الصفّين */}
                  <AddedProcedures added={current.procedures} />
                </div>
              </div>
            ) : (
              <p className="empty">لا أحد قيد الكشف حالياً.</p>
            )}
          </div>

          {/* ═══ بانتظار العودة ═══
              صغيرٌ تحت «قيد الكشف» لا يزاحمه، ويظهر حين يوجد خارجٌ فقط. العدّاد من
              لحظة الخروج في القاعدة — يضبط بعد التحديث. والنداء معطَّل ما دام أحدٌ قيد
              الكشف: مريضان قيد الكشف عند طبيبٍ واحد يُربكان الشاشة (والخادم يرفض أيضاً). */}
          {returning.length > 0 && (
            <div className="card wr-card">
              <h3>بانتظار العودة <span className="wr-count">{returning.length}</span></h3>
              <ul className="wr-list">
                {returning.map((a) => (
                  <li key={a.id} className="wr-item">
                    <span className="wr-num">الدور {shownNumber(a)}</span>
                    <span className="wr-name">{a.full_name}</span>
                    <Elapsed since={a.stepped_out_at} offset={offset} />
                    <button className="ghost wr-call" disabled={busy || !!current}
                      onClick={() => act(api.clinic.returnCall, a.id)}>
                      نداء
                    </button>
                  </li>
                ))}
              </ul>
              {current && (
                <p className="wr-hint">أنهِ الكشف الحالي أو اجعله «خروجاً مؤقتاً» قبل نداء العودة.</p>
              )}
            </div>
          )}

          <div className="card">
            <h3>التالي في الدور</h3>
            {nextUp ? (
              <div className="action-row">
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>
                    الدور {shownNumber(nextUp)} — {nextUp.full_name}
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
              {attendance ? `الحاضرون (${arrivedWaiting.length})` : `قائمة الدور كاملة (${arrivedWaiting.length + stillWaiting.length})`}
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
                      <td className="num">{shownNumber(a)}</td>
                      <td>{a.full_name}{attendance && <AttendanceBadge priority={a.priority} />}</td>
                      <td>
                        <span className="badge good">وصل</span>
                        {a.id === nextUp?.id && <span className="doc-next-tag">التالي</span>}
                      </td>
                    </tr>
                  ))}
                  {stillWaiting.map((a) => (
                    <tr key={a.id} className="doc-row-away">
                      <td className="num">{shownNumber(a)}</td>
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
