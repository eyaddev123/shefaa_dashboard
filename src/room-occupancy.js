// ═══ من في الغرفة، ومتى؟ — لقائمة الغرف في لوحة العيادات اليومية ═══
// الإسناد وحده («الغرفة 3 لديمة») لا يقول أتُسحب الغرفة من دكتورٍ يستقبل الآن أم تُعطى
// وهي فارغةٌ عملياً لأن دوامه انتهى أو لم يبدأ. فلكل ساكن: live (يستقبل الآن) أو أوقات
// دوامه. ولا قفل في الحالتين — التمييز للعلم لا للمنع.
//
// «الآن» = يوم اللوحة هو اليوم، وجلسته قائمة (لا ملغاة ولا مغلقة ولا «انتهى الدوام»)،
// والساعة بلغت بدايتها، ولم تبلغ نهايتها — أو بلغتها وما زال في دوره من ينتظر (دوامٌ
// تجاوز وقته وهو ما زال يكشف). وقبل البداية ليس «الآن» ولو حضر مرضى مبكراً: لم يبدأ.
// ملفٌّ بلا JSX ولا استيراد: يُختبر بـ node مباشرة (test/room-occupancy-check.mjs).

export const hoursOf = (d) => {
  const a = d.session_start || d.start_time
  const b = d.session_end || d.end_time
  return a && b ? `${a}–${b}` : null
}

export function isLiveNow(d, { date, today, now }) {
  if (date !== today || !d.session_id || d.apologized) return false
  if (d.session_status === 'cancelled' || d.session_status === 'closed' || d.session_closed) return false
  const start = d.session_start || d.start_time
  const end = d.session_end || d.end_time
  if (!start || !end || now < start) return false
  return now < end || (d.active_count || 0) > 0
}

/**
 * غرفة ← ساكنوها اليوم عدا هذا الدكتور والمعتذرين، «الآن» أوّلاً.
 * @returns {{[room: string]: {name: string, live: boolean, hours: string|null}[]}}
 */
export function roomOccupants(doctors, selfId, ctx) {
  const out = {}
  for (const x of doctors || []) {
    const r = String(x.room ?? '').trim()
    if (!r || x.apologized || String(x.doctor_id) === String(selfId)) continue
    ;(out[r] = out[r] || []).push({ name: x.doctor_name, live: isLiveNow(x, ctx), hours: hoursOf(x) })
  }
  for (const r of Object.keys(out)) out[r].sort((a, b) => Number(b.live) - Number(a.live))
  return out
}

// «العيادة 3 — ديمة متوالي (الآن)» / «… (09:00–13:00)» — نصّ التلميح وقارئ الشاشة
export const occupantLabel = (room, o) =>
  `العيادة ${room} — ${o.name} (${o.live ? 'الآن' : o.hours || 'بلا وقت'})`

// الساعة المحلية HH:MM — نفس صيغة أوقات الجلسات المقارَنة بها
export const nowHHMM = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
