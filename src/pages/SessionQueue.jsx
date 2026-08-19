import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, APPOINTMENT_STATUSES, BOOKING_TYPES, VISIT_TYPES, PRIORITIES, DELAY_CAUSES, fmtMoney, fmtTime } from '../api.js'

// شارة الأولوية — تُبرز من يتقدّم الطابور وسببه
function priorityBadge(priority) {
  if (!priority || priority === 'normal') return null
  const cls = priority === 'urgent' ? 'bad' : 'warn'
  return <span className={`badge ${cls}`} style={{ marginInlineStart: 6 }}>{PRIORITIES[priority]}</span>
}

// عمود الموعد: الوقت الأساسي المتفق عليه ← الوقت الحالي بعد الانزياح، مع تفصيل الأسباب
function SlotCell({ appt }) {
  const orig = fmtTime(appt.original_slot_time)
  const now = fmtTime(appt.slot_time)
  if (!appt.original_slot_time && !appt.slot_time) return <span className="muted">—</span>
  if (!appt.delay_minutes) return <span dir="ltr">{now}</span>
  const detail = (appt.delays || [])
    .map((d) => `${DELAY_CAUSES[d.cause] || d.cause}: ${d.minutes} د${d.times > 1 ? ` (${d.times} مرات)` : ''}`)
    .join('، ')
  return (
    <span title={detail}>
      <s style={{ opacity: 0.55 }} dir="ltr">{orig}</s>{' → '}
      <strong dir="ltr">{now}</strong>
      <span className="badge warn" style={{ marginInlineStart: 6 }}>+{appt.delay_minutes} د</span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{detail}</span>
    </span>
  )
}

function appointmentBadge(status) {
  const cls = status === 'in_service' ? 'good' : status === 'no_show' || status === 'cancelled' ? 'bad'
    : status === 'arrived' ? 'warn' : ''
  return <span className={`badge ${cls}`}>{APPOINTMENT_STATUSES[status] || status}</span>
}

function TicketPrint({ appt, doctorName, onDone }) {
  const printed = useRef(false)
  useEffect(() => {
    if (printed.current) return
    printed.current = true
    setTimeout(() => window.print(), 200)
  }, [])
  return (
    <div className="ticket-print">
      <div className="ticket-card">
        <h2>بطاقة الدور</h2>
        <p className="ticket-doctor">{doctorName}</p>
        <p className="ticket-number">{appt.queue_number}</p>
        <p className="ticket-code">رمز البطاقة: {appt.ticket_code}</p>
        <p className="ticket-hint">احتفظ بهذه البطاقة — بها رقم دورك ورمزه</p>
        <button className="no-print" onClick={onDone} style={{ marginTop: 16 }}>إغلاق</button>
      </div>
    </div>
  )
}

function BookingForm({ sessionId, slotTime, fees, onBooked, onCancel, urgent = false }) {
  const blank = { mobile: '', full_name: '', gender: '', birth_year: '', booking_type: 'walk_in',
                  reason: '', visit_type: 'consultation', priority: urgent ? 'urgent' : 'normal' }
  const [form, setForm] = useState(blank)
  const [lookupState, setLookupState] = useState(null) // null | 'checking' | 'found' | 'new'
  const [followup, setFollowup] = useState(null)       // أهليّة المراجعة للمريض الحالي
  const [override, setOverride] = useState(null)       // سبب تجاوز شرط المراجعة (يملؤه المشرف)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const checkMobile = async (mobile) => {
    if (mobile.length < 8) { setLookupState(null); setFollowup(null); return }
    setLookupState('checking')
    try {
      const patient = await api.clinic.lookupPatient(mobile, sessionId)
      if (patient) {
        setForm((f) => ({ ...f, full_name: patient.full_name, gender: patient.gender || '', birth_year: patient.birth_year || '' }))
        setLookupState('found')
        setFollowup(patient.followup || null)
      } else {
        setLookupState('new')
        setFollowup(null)
      }
    } catch { setLookupState(null) }
  }

  const isFollowup = form.visit_type === 'followup'
  // تحذير عند اختيار «مراجعة» لمريض لا تنطبق عليه الشروط — يُسمح بالمتابعة بسبب صريح
  const followupBlocked = isFollowup && followup && !followup.eligible
  const needsOverride = isFollowup && (followupBlocked || (lookupState === 'new'))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const appt = await api.clinic.book(sessionId, {
        ...form,
        birth_year: form.birth_year ? Number(form.birth_year) : null,
        slot_time: slotTime || undefined,
        followup_override_reason: needsOverride ? (override || null) : undefined,
      })
      onBooked(appt)
    } catch (ex) {
      setErr(ex.message)
      // السيرفر يعيد تفاصيل عدم الأهلية — نعرضها ونفتح خانة سبب التجاوز
      if (ex.data?.code === 'FOLLOWUP_NOT_ELIGIBLE') {
        setFollowup(ex.data.followup || { eligible: false, message: ex.message })
        if (override === null) setOverride('')
      }
    }
    finally { setBusy(false) }
  }

  const fee = isFollowup ? fees?.followup_fee : fees?.consultation_fee

  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14, flexWrap: 'wrap' }}>
      <div className="field">
        <label>رقم الموبايل</label>
        <input value={form.mobile} onChange={(e) => { set('mobile')(e); checkMobile(e.target.value) }} required dir="ltr" autoFocus />
        {lookupState === 'checking' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>جارٍ البحث…</span>}
        {lookupState === 'found' && <span style={{ fontSize: 11, color: 'var(--good, green)' }}>مريض سابق — تم تعبئة بياناته</span>}
        {lookupState === 'new' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>مريض جديد</span>}
      </div>
      <div className="field"><label>الاسم الكامل</label><input value={form.full_name} onChange={set('full_name')} required /></div>
      <div className="field">
        <label>الجنس</label>
        <select value={form.gender} onChange={set('gender')}>
          <option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option>
        </select>
      </div>
      <div className="field"><label>سنة الميلاد</label><input type="number" value={form.birth_year} onChange={set('birth_year')} style={{ width: 90 }} /></div>
      {!slotTime && (
        <div className="field">
          <label>طريقة الحجز</label>
          <select value={form.booking_type} onChange={set('booking_type')}>
            {Object.entries(BOOKING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>نوع الزيارة</label>
        <select value={form.visit_type} onChange={set('visit_type')}>
          {Object.entries(VISIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {fee != null && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>السعر: {fmtMoney(fee)}</span>
        )}
      </div>
      <div className="field">
        <label>الأولوية</label>
        <select value={form.priority} onChange={set('priority')}>
          {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {form.priority === 'urgent' ? (
          <span style={{ fontSize: 11, color: 'var(--bad, #b91c1c)', fontWeight: 700 }}>
            يتصدّر الطابور — يُنادى بعد المريض الحالي مباشرة
          </span>
        ) : form.priority !== 'normal' && (
          <span style={{ fontSize: 11, color: 'var(--warn, #b45309)' }}>
            يتقدّم كل المنتظرين، ومواعيدهم تتأجل
          </span>
        )}
      </div>
      <div className="field" style={{ flex: 1, minWidth: 160 }}>
        <label>سبب الزيارة (اختياري)</label>
        <input value={form.reason} onChange={set('reason')} />
      </div>

      {/* حالة المراجعة: مؤهَّل (أخضر) أو تحذير مع خانة سبب تجاوز للمشرف */}
      {isFollowup && followup && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <p style={{
            margin: '4px 0', fontSize: 12.5,
            color: followup.eligible ? 'var(--good, green)' : 'var(--bad, #b91c1c)',
          }}>
            {followup.eligible ? '✓ ' : '⚠ '}{followup.message}
          </p>
          {followupBlocked && (
            <div className="field" style={{ maxWidth: 420 }}>
              <label>سبب تجاوز شرط المراجعة (موافقة المشرف)</label>
              <input value={override || ''} onChange={(e) => setOverride(e.target.value)}
                placeholder="مثال: بموافقة مسؤول العيادات — حالة خاصة" required />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                يُسجَّل السبب واسمك على الحجز
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحجز…' : 'حجز دور'}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>إلغاء</button>}
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function SlotList({ sessionId, fees, onBooked }) {
  const [slots, setSlots] = useState(null)
  const [err, setErr] = useState(null)
  const [openSlot, setOpenSlot] = useState(null) // slot_time currently showing the booking form, or 'walkin' | 'urgent'
  const urgentFormRef = useRef(null)

  const load = () => api.clinic.slots(sessionId).then(setSlots).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [sessionId])

  // نموذج الحالة الفورية أعلى الصفحة — نُحضره أمام العين فور فتحه بدل أن يبحث عنه الموظف وقت الطوارئ
  useEffect(() => {
    if (openSlot === 'urgent')
      urgentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [openSlot])

  if (err) return <p className="error">{err}</p>
  if (!slots) return <p className="empty">جارٍ التحميل…</p>

  return (
    <div className="slot-list">
      {/* الحالة الإسعافية أولاً وفوق كل شيء: زر بارز في الأعلى لا يحتاج بحثاً وقت الضغط */}
      <div className="urgent-bar">
        <div className="urgent-bar-text">
          <strong>🚨 حالة فورية (إسعافية)</strong>
          <span>تُنادى مباشرة بعد المريض الحالي — أو فوراً إن لم يكن أحد قيد الكشف</span>
        </div>
        {openSlot !== 'urgent' && (
          <button className="urgent-btn" onClick={() => setOpenSlot('urgent')}>حجز فوري</button>
        )}
      </div>
      {openSlot === 'urgent' && (
        <div className="slot-booking-form" ref={urgentFormRef}>
          <BookingForm
            sessionId={sessionId}
            slotTime={null}
            fees={fees}
            urgent
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}

      {slots.slots.length === 0 && (
        <p className="empty">لا خانات محددة لهذه الجلسة — استخدم «حجز بلا وقت محدد» أدناه.</p>
      )}
      {slots.buffer_minutes > 0 && (
        <p className="subtitle" style={{ marginTop: 0, marginBottom: 10 }}>
          الخانات المخطّطة آخر كل ساعة هي <strong>فراغ احتياطي ({slots.buffer_minutes} د)</strong> —
          لا تُحجز لمريض عادي، وتُستخدم لاستيعاب الحالات الفورية فلا تتأخر بقية المواعيد.
        </p>
      )}
      {slots.slots.map((s) => (
        <div key={s.slot_time}
          className={`slot-row ${s.available ? 'available' : 'booked'} ${s.is_buffer ? 'buffer' : ''} ${s.is_past ? 'past' : ''} ${s.priority && s.priority !== 'normal' ? 'priority' : ''}`}>
          <span className="slot-time" dir="ltr">{s.slot_time}</span>
          {s.is_past && !s.full_name ? (
            <span className="slot-label">مضى وقتها</span>
          ) : s.available ? (
            <span className="slot-label">
              {s.is_buffer ? 'فراغ احتياطي — للحالات الفورية فقط' : 'متاحة'}
            </span>
          ) : (
            <span className="slot-label">
              الدور {s.queue_number} — {s.full_name}
              {/* شارة الأولوية أولاً: الموظف يميّز الحالة الإسعافية من نظرة واحدة */}
              {priorityBadge(s.priority)}
              {' '}<span className="badge" style={{ marginInlineStart: 6 }}>{APPOINTMENT_STATUSES[s.status]}</span>
              {s.used_buffer && <span className="badge warn" style={{ marginInlineStart: 6 }}>استُخدم الفراغ</span>}
            </span>
          )}
          {/* خانة الفراغ لا تُعرض للحجز العادي — تُملأ تلقائياً بأول حالة فورية */}
          {s.available && !s.is_buffer && openSlot !== s.slot_time && (
            <button className="ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setOpenSlot(s.slot_time)}>
              احجز
            </button>
          )}
        </div>
      ))}
      {openSlot && openSlot !== 'walkin' && openSlot !== 'urgent' && (
        <div className="slot-booking-form">
          <p className="subtitle" style={{ marginBottom: 0 }}>حجز خانة <strong dir="ltr">{openSlot}</strong></p>
          <BookingForm
            sessionId={sessionId}
            slotTime={openSlot}
            fees={fees}
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}

      <div className="slot-row walkin-row">
        <span className="slot-label">حضر بلا موعد محدد (يُعطى الدور التالي مباشرة)</span>
        {openSlot !== 'walkin' && (
          <button className="ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setOpenSlot('walkin')}>
            حجز بلا وقت محدد
          </button>
        )}
      </div>
      {openSlot === 'walkin' && (
        <div className="slot-booking-form">
          <BookingForm
            sessionId={sessionId}
            slotTime={null}
            fees={fees}
            onCancel={() => setOpenSlot(null)}
            onBooked={(appt) => { setOpenSlot(null); load(); onBooked(appt) }}
          />
        </div>
      )}
    </div>
  )
}

export default function SessionQueue() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [ticket, setTicket] = useState(null)

  const load = () => api.clinic.queue(id).then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id])

  const arrive = async (apptId) => {
    try { await api.clinic.arrive(apptId); load() }
    catch (ex) { alert(ex.message) }
  }

  const cancel = async (apptId) => {
    if (!confirm('إلغاء هذا الحجز؟')) return
    try { await api.clinic.updateAppointment(apptId, { status: 'cancelled' }); load() }
    catch (ex) { alert(ex.message) }
  }

  // ترقية حجز قائم إلى أولوية (تبيّن أنه حالة فورية أو كبير بالسن أو رضيع بعد الحجز)
  const prioritize = async (apptId) => {
    const choice = prompt('نوع الأولوية؟ اكتب: فوري / كبير / رضيع')
    if (!choice) return
    const map = { 'فوري': 'urgent', 'كبير': 'elderly', 'رضيع': 'infant' }
    const priority = map[choice.trim()]
    if (!priority) return alert('اكتب واحدة من: فوري / كبير / رضيع')
    try {
      const r = await api.clinic.prioritize(apptId, priority)
      alert(`تم التقديم — تأجّل ${r.delayed_count} موعداً بمقدار مدة كشف واحدة`)
      load()
    } catch (ex) { alert(ex.message) }
  }

  if (err) return <p className="error">{err}</p>
  if (!data) return <p className="empty">جارٍ التحميل…</p>

  if (ticket) return <TicketPrint appt={ticket} doctorName={data.doctor_name} onDone={() => { setTicket(null); load() }} />

  return (
    <>
      <h2>طابور {data.doctor_name}</h2>
      <p className="subtitle">
        {data.specialty || '—'} · {fmtTime(data.start_time)} – {fmtTime(data.end_time)} ·
        مدة الكشف المتوقعة {data.expected_visit_minutes} دقيقة ·
        معاينة {fmtMoney(data.consultation_fee)} · مراجعة {fmtMoney(data.followup_fee)}
        {' '}(خلال {data.followup_window_days} أيام) ·
        الإيراد المتوقع {fmtMoney(data.expected_revenue)}
      </p>

      <div className="card">
        <h3>حجز دور — خانات اليوم</h3>
        <p className="subtitle" style={{ marginTop: -6, marginBottom: 14 }}>
          الخانات الفاضية متاحة للحجز مباشرة على وقتها. اضغط «احجز» بجانب أي خانة.
        </p>
        <SlotList
          sessionId={id}
          fees={{ consultation_fee: data.consultation_fee, followup_fee: data.followup_fee }}
          onBooked={(appt) => setTicket(appt)}
        />
      </div>

      <div className="card">
        <h3>الطابور ({data.appointments.length})</h3>
        <p className="subtitle" style={{ marginTop: -6 }}>
          مرتَّب بترتيب الخدمة الفعلي: أصحاب الأولوية أولاً ثم بقية الأدوار.
          <strong> رقم الدور لا يتغير</strong> عند دخول حالة فورية — يتغيّر الوقت فقط، ويظهر أدناه أصله ومقدار انزياحه.
        </p>
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>الدور</th><th>الاسم</th><th>الموبايل</th><th>نوع الزيارة</th><th>السعر</th>
              <th>الموعد (الأصلي ← الحالي)</th><th>الحالة</th><th>الانتظار المتوقع</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.appointments.map((a) => (
              <tr key={a.id}>
                <td className="num">{a.queue_number}{priorityBadge(a.priority)}</td>
                <td>{a.full_name}</td>
                <td dir="ltr">{a.mobile}</td>
                <td>
                  {VISIT_TYPES[a.visit_type] || a.visit_type}
                  {a.followup_override_by && (
                    <span className="badge warn" style={{ marginInlineStart: 6 }}
                      title={a.followup_override_reason || ''}>تجاوز</span>
                  )}
                </td>
                <td className="num">{fmtMoney(a.fee)}</td>
                <td><SlotCell appt={a} /></td>
                <td>{appointmentBadge(a.status)}</td>
                <td className="num">
                  {['waiting', 'arrived', 'in_service'].includes(a.status) ? `~${a.wait_minutes} د` : '—'}
                </td>
                <td>
                  {['waiting', 'arrived'].includes(a.status) && a.priority === 'normal' && (
                    <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => prioritize(a.id)}>تقديم</button>
                  )}{' '}
                  {a.status === 'waiting' && (
                    <>
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => arrive(a.id)}>حضر</button>{' '}
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => cancel(a.id)}>إلغاء</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {data.appointments.length === 0 && <tr><td colSpan={9} className="empty">لا حجوزات بعد في هذه الجلسة</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
