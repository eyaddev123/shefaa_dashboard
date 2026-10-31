import { useEffect, useRef, useState } from 'react'
import { api, APPOINTMENT_STATUSES, VISIT_TYPES, ROLE_LABELS } from '../api.js'
import { fmtClock } from '../attendance-ui.jsx'

// ═══ الخط الزمني للزيارة — «مين عمل شو» من الحجز إلى الخروج ═══
// للمشرفة والمدير وحدهما (canSeeVisitAudit؛ والخادم يردّ غيرهما 403). يقرأ
// GET /clinic/appointments/:id/timeline: سطور سجلّ الحجز كلّها بفاعلها، من الأقدم.
// الصياغة بالمصدر («تسجيل الحجز»، «إضافة إجراء») لا بالفعل: الفاعل اسمٌ بجانب السطر،
// والفعل الماضي يفرض مذكّراً أو مؤنّثاً على موظفٍ لا نعرف ما يناسبه.

const VALUE_LABELS = {
  ...APPOINTMENT_STATUSES, postponed: 'مؤجَّل', ...VISIT_TYPES,
  normal: 'عادي', urgent: 'إسعافي', elderly: 'كبير بالعمر', infant: 'رضيع',
  male: 'ذكر', female: 'أنثى',
}
const FIELD_LABELS = {
  patient_id: 'المريض', visit_type: 'نوع الزيارة', fee: 'الأجر', slot_time: 'الخانة الزمنية',
  'patient.full_name': 'اسم المريض', 'patient.mobile': 'الموبايل',
  'patient.gender': 'الجنس', 'patient.birth_year': 'سنة الميلاد',
}
const val = (v) => (v == null || v === '' ? '—' : (VALUE_LABELS[v] || v))
const change = (e) => `${val(e.old_value)} ← ${val(e.new_value)}`

// الانتقالات المعتادة باسمها، وما عداها (قائمة «تغيير الحالة») بقيمتيه
function statusTitle(from, to) {
  if (to === 'arrived' && from === 'waiting') return 'تعليم «حاضر» (قطع الوصل)'
  if (to === 'in_service' && from === 'arrived') return 'النداء — دخل الكشف'
  if (to === 'in_service' && from === 'waiting_return') return 'نداء العودة من الخروج المؤقت'
  if (to === 'waiting_return') return 'خروج مؤقت'
  if (to === 'done' && from === 'in_service') return 'إنهاء الكشف'
  if (to === 'no_show') return 'تعليم «لم يحضر»'
  if (to === 'cancelled') return 'إلغاء الحجز'
  if (to === 'postponed') return 'تأجيل الحجز إلى جلسة أخرى'
  return `تغيير الحالة: ${val(from)} ← ${val(to)}`
}

/** عنوان السطر وتفصيله — tone: 'add' | 'remove' | undefined (لون النقطة).
 *  note: السبب تفصيلٌ لا «سبب» (مواد الإجراء لحظة إضافته، أو «خارج الاختصاص») */
export function describeEvent(e) {
  switch (e.field) {
    case 'created':
      return { title: e.old_value ? 'تسجيل الحجز (تأجيلاً من حجزٍ سابق)' : 'تسجيل الحجز', detail: e.new_value, tone: 'add' }
    case 'status': return { title: statusTitle(e.old_value, e.new_value),
      tone: ['no_show', 'cancelled', 'postponed'].includes(e.new_value) ? 'remove' : undefined }
    case 'started': return { title: 'بدء الكشف' }
    case 'procedure':
      return e.new_value
        ? { title: `إضافة إجراء: ${e.new_value}`, tone: 'add', note: true }
        : { title: `حذف إجراء: ${e.old_value}`, tone: 'remove' }
    // إجراءٌ أضافه الطبيب «بانتظار المحاسبة» ثمّ قُبض — الفاعل من قبض
    case 'procedure_paid': return { title: `تمت المحاسبة: ${e.new_value}`, tone: 'add' }
    case 'materials': return { title: `تعديل مواد «${e.old_value}»`, detail: e.new_value }
    case 'referral':
      if (!e.old_value) return { title: `تسجيل إحالة: ${e.new_value}`, tone: 'add' }
      if (!e.new_value) return { title: `حذف الإحالة: ${e.old_value}`, tone: 'remove' }
      return { title: 'تعديل الإحالة', detail: change(e) }
    case 'reason': return { title: 'تعديل ملاحظة الحجز', detail: change(e) }
    case 'priority': return { title: `تغيير الأولوية: ${change(e)}` }
    default: return { title: `تعديل ${FIELD_LABELS[e.field] || e.field}: ${change(e)}` }
  }
}

// بلا فاعل = النظام، وسببه جزءٌ من اسمه («النظام — إغلاق تلقائي»).
// والموظف باسمه ودوره: «سلمى (استقبال العيادات)» — من أضاف الإجراء: الطبيب أم الاستقبال؟
export const actorOf = (e) => (e.changed_by == null
  ? { name: e.reason ? `النظام — ${e.reason}` : 'النظام', system: true }
  : { name: `${e.changed_by_name || '—'}${ROLE_LABELS[e.changed_by_role] ? ` (${ROLE_LABELS[e.changed_by_role]})` : ''}` })

// الساعة وحدها في يوم الجلسة، وبالتاريخ لما بعده (تصحيحٌ متأخّر)
const when = (ts, sessionDay) => {
  const day = new Date(ts).toLocaleDateString('en-CA')
  return !sessionDay || day === sessionDay ? fmtClock(ts) : `${day} ${fmtClock(ts)}`
}

export function TimelineList({ data, sessionDay }) {
  const events = data.events
  return (
    <>
      {!data.full_log && (
        <p className="vt-note">
          هذا الحجز سابقٌ لتفعيل السجلّ الكامل — يظهر ما سُجِّل له وحده، ولا يُستكمل ما لم يُسجَّل.
        </p>
      )}
      {events.length === 0 ? <p className="ad-readonly">لا أحداث مسجَّلة على هذه الزيارة.</p> : (
        <ol className="vt-list">
          {events.map((e) => {
            const d = describeEvent(e)
            const actor = actorOf(e)
            return (
              <li key={e.id} className={`vt-item${d.tone ? ` vt-${d.tone}` : ''}`}>
                <time className="vt-time" dir="ltr" dateTime={e.changed_at}>{when(e.changed_at, sessionDay)}</time>
                <div className="vt-body">
                  <div className="vt-title">{d.title}</div>
                  {d.detail && <div className="vt-detail">{d.detail}</div>}
                  {e.reason && !actor.system && (d.note
                    ? <div className="vt-detail">{e.reason}</div>
                    : <div className="vt-reason">السبب: {e.reason}</div>)}
                  <div className={`vt-actor${actor.system ? ' is-system' : ''}`}>{actor.name}</div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

/** يحمّل الخط الزمني ويعرضه — لصفحة الزيارة وللوحة الجانبية في الجرد */
export default function VisitTimeline({ appointmentId, sessionDay }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null); setErr(null)
    api.clinic.appointmentTimeline(appointmentId)
      .then((r) => { if (alive) setData(r) })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [appointmentId])
  if (err) return <p className="error">{err}</p>
  if (!data) return <p className="ad-readonly">جارٍ التحميل…</p>
  return <TimelineList data={data} sessionDay={sessionDay} />
}

/** لوحة جانبية فوق الصفحة: Esc والخلفية يُغلقانها، والتركيز يدخلها */
export function TimelineDrawer({ title, subtitle, appointmentId, sessionDay, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="vt-scrim" onClick={onClose}>
      <aside className="vt-drawer" role="dialog" aria-modal="true" aria-labelledby="vt-drawer-title"
        onClick={(e) => e.stopPropagation()}>
        <header className="vt-drawer-head">
          <div>
            <h3 id="vt-drawer-title">{title}</h3>
            {subtitle && <p className="vt-drawer-sub">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" className="ghost vt-close" aria-label="إغلاق" onClick={onClose}>✕</button>
        </header>
        <div className="vt-drawer-body">
          <VisitTimeline appointmentId={appointmentId} sessionDay={sessionDay} />
        </div>
      </aside>
    </div>
  )
}
