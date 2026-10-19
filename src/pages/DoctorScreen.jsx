import { useEffect, useState } from 'react'
import { matchesAr } from '../arabic-search.js'
import { api, fmtTime, todayLocal } from '../api.js'
import { AttendanceBadge, urgentRowClass, isAttendanceSession, usePolling, fmtClock } from '../attendance-ui.jsx'
import { useToast, RecallButton } from '../action-feedback.jsx'

// ═══ ما أضافه الطبيب على هذا المريض ═══
// بالأسماء وحدها — لا مبالغ. ولكلٍّ «×» لتصحيح ضغطةٍ خاطئة وقعت في الغرفة،
// بتأكيدٍ لأنّ الإزالة تترك أثراً (سبباً ومن أزال) لا تُمحى.
function AddedProcedures({ appointmentId, added = [], onDone, onError, onChanged }) {
  const [busy, setBusy] = useState(false)
  const live = (added || []).filter((l) => !l.removed_at)
  if (live.length === 0) return null

  const remove = async (line) => {
    if (!confirm(`إزالة «${line.name}» من هذا المريض؟`)) return
    setBusy(true)
    try {
      await api.clinic.removeAppointmentProcedure(appointmentId, line.id, 'أُضيف بالخطأ')
      onDone(`أُزيل: ${line.name}`)
      if (onChanged) onChanged()
    } catch (e) { onError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="doc-procs">
      <span className="doc-procs-label">الإجراءات المضافة:</span>
      {live.map((l) => (
        <span key={l.id} className="doc-proc-chip">
          {l.name}
          <button type="button" className="doc-proc-x" disabled={busy}
            title={`إزالة ${l.name}`} aria-label={`إزالة ${l.name}`}
            onClick={() => remove(l)}>×</button>
        </span>
      ))}
    </div>
  )
}

// ═══ «عملت إجراء» — زرٌّ واحد للطبيب ═══
//
// بسيطٌ عمداً: زرّ، قائمة بمربّعات اختيار، «إضافة» مرّةً واحدة. **ولا مبالغ
// إطلاقاً** — الطبيب يقول ما فعله، والمال شأنُ الاستقبال (الاستيفاء) والمشرف
// (التقسيم). وعرض السعر هنا يكشف تسعيرةً أمام المريض الجالس قبالته.
//
// والاختيار المتعدّد لا الإضافة واحداً واحداً: الطبيب يعمل إجراءَين في الجلسة
// الواحدة كثيراً، وإغلاق النافذة وفتحها لكلٍّ منهما عملٌ زائد على من يفحص.
function DoneProcedure({ appointmentId, added = [], onDone, onError, onChanged }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  // المضاف فعلاً (غير المُزال) — يُعرض مؤشَّراً ومعطَّلاً فلا يُضاف مرّتين
  const liveIds = new Set((added || []).filter((l) => !l.removed_at).map((l) => String(l.procedure_id)))

  useEffect(() => {
    if (!open || list) return
    api.clinic.procedures().then((rows) => setList(rows.filter((p) => p.is_active)))
      .catch((e) => { onError(e.message); setOpen(false) })
  }, [open])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const close = () => { setOpen(false); setPicked(new Set()); setQuery('') }

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const submit = async () => {
    if (picked.size === 0) return
    setBusy(true)
    const names = []
    try {
      // واحداً تلو الآخر: الخادم يحرس كلَّ إضافةٍ على حدة (تكرار، حالة المريض).
      // وفشلُ واحدٍ لا يُسقط ما نجح — نُبلغ بما تمّ وما لم يتمّ.
      const failed = []
      for (const id of picked) {
        const proc = list.find((x) => String(x.id) === String(id))
        try { await api.clinic.addAppointmentProcedure(appointmentId, id); names.push(proc.name) }
        catch (e) { failed.push(`${proc.name}: ${e.message}`) }
      }
      close()
      if (names.length) onDone(`سُجّل: ${names.join('، ')}`)
      if (failed.length) onError(failed.join(' | '))
      if (onChanged) onChanged()
    } finally { setBusy(false) }
  }

  const shown = (list || []).filter((p) => matchesAr(p.name, query))

  return (
    <>
      <button type="button" className="ghost doc-btn" disabled={busy} onClick={() => setOpen(true)}>
        <span aria-hidden="true">✚</span> عملت إجراء
      </button>

      {open && (
        <div className="modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close() }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="proc-title">
            <h3 id="proc-title">أيّ إجراء عملت؟</h3>
            <input className="doc-proc-search" autoFocus value={query} type="search"
              placeholder="ابحث بالاسم…" onChange={(e) => setQuery(e.target.value)} />
            {!list ? <p className="empty">جارٍ التحميل…</p>
              : shown.length === 0 ? (
                <p className="empty">{query ? 'لا إجراء بهذا الاسم.' : 'لا إجراءات مُعرَّفة.'}</p>
              ) : (
                <div className="doc-proc-list">
                  {shown.map((p) => {
                    const alreadyAdded = liveIds.has(String(p.id))
                    const checked = alreadyAdded || picked.has(String(p.id))
                    return (
                      <label key={p.id} className={`doc-proc-row${alreadyAdded ? ' is-added' : ''}`}>
                        <input type="checkbox" checked={checked}
                          disabled={busy || alreadyAdded}
                          onChange={() => toggle(String(p.id))} />
                        <span>{p.name}</span>
                        {alreadyAdded && <span className="doc-proc-done">مضاف</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            <div className="bf-actions" style={{ marginTop: 14 }}>
              <button type="button" className="ghost" disabled={busy} onClick={close}>إلغاء</button>
              <button type="button" disabled={busy || picked.size === 0} onClick={submit}>
                {busy ? 'جارٍ…' : picked.size > 1 ? `إضافة (${picked.size})` : 'إضافة'}
              </button>
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

                  {/* قبل «إنهاء الكشف»: الإجراء يُسجَّل والمريض ما زال في الغرفة */}
                  <DoneProcedure appointmentId={current.id} added={current.procedures}
                    onDone={showToast} onError={showToast} onChanged={loadQueue}
                  />

                  {/* المريض لم يسمع النداء أو لم يصل بعد — يُعاد بثّه على شاشة الصالة بلا تغيير حالته */}
                  {/* معطَّل طوال مدّة خنق الخادم مع عدٍّ ظاهر — فلا تصل ضغطةٌ ثانية لتُرفض */}
                  <RecallButton apptId={current.id} onError={showToast} className="ghost doc-btn" />

                  <button className="doc-btn doc-btn-done" disabled={busy}
                    onClick={() => act(api.clinic.done, current.id)}>
                    إنهاء الكشف
                  </button>

                  {/* الشارات سطرٌ مستقلّ أسفل الأزرار — وضعُها بينها يشقّ الصفّين */}
                  <AddedProcedures appointmentId={current.id} added={current.procedures}
                    onDone={showToast} onError={showToast} onChanged={loadQueue} />
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
