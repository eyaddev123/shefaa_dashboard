// ═══ أدوات واجهة نمط الحضور — تشترك فيها شاشتا الطبيب والاستقبال ═══
// نمط الخانات لا يستعمل شيئاً من هنا: شاشاته تبقى كما كانت.
import { useEffect, useRef } from 'react'

export const isAttendanceSession = (s) => s?.flow_mode === 'attendance'

export const FLOW_MODE_LABELS = { slots: 'نمط الخانات', attendance: 'نمط الحضور' }

// شارة نمط الجلسة — في **النمطين** لا في الحضور وحده: يوم التبديل كانت جلسة الخانات
// بلا أي علامة، فلم يكن على الشاشة ما يقول «هذه الجلسة ما زالت بالنمط القديم».
export function FlowModeTag({ mode }) {
  if (!mode) return null
  return <span className={`attn-mode-tag attn-mode-${mode}`}>{FLOW_MODE_LABELS[mode] || mode}</span>
}

// شارة الأولوية بأسماء قصيرة تُقرأ من بعيد. الإسعافي أحمر (وحده يتقدّم)،
// والكبير والرضيع شارةٌ للتنبيه لا أسبقية — مكانهم بترتيب حضورهم كغيرهم.
const BADGES = { urgent: ['إسعافي', 'bad'], elderly: ['كبير السن', 'warn'], infant: ['رضيع', 'warn'] }
export function AttendanceBadge({ priority }) {
  const b = BADGES[priority]
  if (!b) return null
  return <span className={`badge ${b[1]}`} style={{ marginInlineStart: 6 }}>{b[0]}</span>
}

// ═══ الرقمان في نمط الحضور ═══
// رقم الدور (arrival_number) يُعطى عند **أوّل حضور** وهو ما تراه الصالة وتنطقه وتطبعه
// البطاقة. queue_number في جلسة الحضور **رقم الحجز** — مرجعٌ داخليّ للاستقبال وحده.
// نمط الخانات: رقمٌ واحد (queue_number) كما كان.
// عمود TIME يصل 'HH:MM:SS' ⇒ 'HH:MM'
export const fmtTimeOfDay = (t) => (t ? String(t).slice(0, 5) : null)

// نصّ التعريف في الرسائل والعناوين: «الدور ٧» لمن حضر، «رقم الحجز ١٢» لمن لم يحضر بعد
export const turnLabel = (a, attendance) => (!attendance ? `الدور ${a.queue_number}`
  : a.arrival_number != null ? `الدور ${a.arrival_number}` : `رقم الحجز ${a.queue_number}`)

// خليّة الرقم في قوائم الاستقبال: رقم الدور كبيراً (أو «—» قبل الحضور)، وتحته صغيراً
// رقم الحجز والوقت التقريبي المُعطى عند الحجز.
export function AttendanceNumber({ appt }) {
  const t = fmtTimeOfDay(appt.estimated_time)
  return (
    <span className="attn-num">
      <span className="attn-num-main" title={appt.arrival_number != null ? 'رقم الدور (عند الحضور)' : 'لم يحضر بعد — لا رقم دور'}>
        {appt.arrival_number ?? '—'}
      </span>
      <span className="attn-num-ref">
        حجز {appt.queue_number}{t && <> · <span dir="ltr">{t}</span></>}
      </span>
    </span>
  )
}

// صف الإسعافي الحاضر أحمر — في قائمة الطبيب وقائمة الاستقبال معاً
export const urgentRowClass = (a) =>
  a.priority === 'urgent' && ['arrived', 'in_service'].includes(a.status) ? 'attn-row-urgent' : undefined

// وقت طابعٍ زمني كاملٍ بالساعة المحلية للجهاز (HH:MM). للطوابع فقط — لا لعمود TIME.
export const fmtClock = (ts) => (ts
  ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  : '—')

// ═══ تحديث دوري — لجلسات الحضور وحدها ═══
// في هذا النمط يرتّب الحضورُ الطابورَ، والحضور يُسجَّل على شاشة الاستقبال: بلا تحديث
// لا يرى الطبيب من وصل حتى يُعيد تحميل الصفحة. ١٥ ثانية تكفي لطابور عيادة، ولا SSE
// للموظفين (قرار: بثّ الشاشة العامة محروسٌ برمز جهاز ولا يصلح لهم).
// يتوقف حين تكون الصفحة مخفية — لا طلبات من تبويبٍ منسيّ طوال اليوم.
export function usePolling(fn, enabled, ms = 15000) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return undefined
    const id = setInterval(() => { if (!document.hidden) ref.current() }, ms)
    return () => clearInterval(id)
  }, [enabled, ms])
}
