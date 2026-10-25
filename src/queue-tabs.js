// ═══ تبويبات قائمة الدور عند الاستقبال ═══
// القائمة الواحدة بكل الحالات طالت حتى صار المريض يضيع فيها. أربعة تبويبات بعدّاد،
// وبحثٌ يعدّ نتائجه في كل تبويب. العدّ والترشيح هنا في الواجهة من ردّ /queue نفسه —
// لا حقل جديد في الخادم. والعدّادات حيّة لأنّها تُحسب من البيانات التي يُعيد بثُّ
// الموظفين تحميلها.
import { normalizeAr } from './arabic-search.js'

// الترتيب (RTL): بانتظار الحضور · الكل · الحضور · انتهى · ما حضر — والافتراضي «الحضور»
export const QUEUE_TABS = [
  { key: 'pending', label: 'بانتظار الحضور', empty: 'ما في حدا بانتظار الحضور.' },
  { key: 'all', label: 'الكل', empty: 'لا حجوزات بعد في هذه الجلسة.' },
  { key: 'present', label: 'الحضور', empty: 'ما في حدا حاضر حالياً — اللي بيوصل بيظهر هون.' },
  { key: 'done', label: 'انتهى', empty: 'ما في حدا انتهى كشفه بعد.' },
  { key: 'absent', label: 'ما حضر', empty: 'ما في غياب ولا إلغاء بهالجلسة.' },
]
export const DEFAULT_TAB = 'present'
export const isTab = (k) => QUEUE_TABS.some((t) => t.key === k)

// الحالة ⇐ التبويب. «بانتظار العودة» (خروج مؤقت) حاضرٌ في الصالة فمكانه «الحضور».
// والمؤجَّل خرج من هذه الجلسة إلى غيرها — مع الغائب والملغى، وشارته تقول السبب.
const TAB_OF = {
  arrived: 'present', in_service: 'present', waiting_return: 'present',
  waiting: 'pending',
  done: 'done',
  no_show: 'absent', cancelled: 'absent', postponed: 'absent',
}
export const tabOf = (a) => TAB_OF[a.status] || 'absent'

const time = (t) => (t ? Date.parse(t) || 0 : 0)

// الترتيب داخل كل تبويب:
//   الحضور — ترتيب الخادم كما هو (قيد الكشف، ثمّ الإسعافي الحاضر، ثمّ بالدور): القاعدة الحالية
//   بانتظار الحضور — بوقت الحجز في نمط الحضور؛ وفي الخانات بالموعد (ترتيب الخادم) — فالموعد
//     هو «وقت الحجز» الذي يعني الاستقبال هناك، وترتيبُ لحظة الإدخال يبعثر جدول اليوم
//   انتهى — الأحدث انتهاءً أولاً
//   ما حضر — بالرقم
export function rowsOfTab(appointments, tab, attendance) {
  // «الكل»: القائمة كاملة بترتيب الخادم — كما كانت قبل التبويبات
  if (tab === 'all') return [...(appointments || [])]
  const indexed = (appointments || []).map((a, i) => ({ a, i })).filter(({ a }) => tabOf(a) === tab)
  const cmp = {
    present: (x, y) => x.i - y.i,
    pending: attendance
      ? (x, y) => time(x.a.booked_at) - time(y.a.booked_at) || x.a.queue_number - y.a.queue_number
      : (x, y) => x.i - y.i,
    done: (x, y) => time(y.a.done_at || y.a.served_at) - time(x.a.done_at || x.a.served_at) || y.i - x.i,
    absent: (x, y) => x.a.queue_number - y.a.queue_number,
  }[tab]
  return indexed.sort(cmp).map(({ a }) => a)
}

// ═══ البحث: الاسم (جزئياً، بتطبيع الهمزات والتاء)، أو رقم الدور، أو الهاتف ═══
// رقمٌ وحده: يطابق رقم الدور تماماً، أو جزءاً من الهاتف إن كان ٣ أرقام فأكثر — «٧» لا تُظهر
// كل من في هاتفه ٧. رقم الدور = رقم الحضور لمن حضر (نمط الحضور)، وإلّا رقم الحجز (من لم يحضر،
// والخانات) — فـ«٩» لا تجمع «الدور ٩» و«حجز ٩» وهما مريضان مختلفان. والأرقام العربية كاللاتينية.
export function matchesQuery(a, query) {
  const q = normalizeAr(query)
  if (!q) return true
  if (/^[\d\s+-]+$/.test(q)) {
    const n = q.replace(/\D/g, '')
    if (!n) return true
    if (String(a.arrival_number ?? a.queue_number ?? '') === n) return true
    const mob = normalizeAr(a.mobile || '').replace(/\D/g, '')
    return n.length >= 3 && mob.includes(n)
  }
  return normalizeAr(a.full_name).includes(q)
}

// العدّ لكل تبويب: الكلّ، وما يطابق البحث
export function tabCounts(appointments, query) {
  const out = Object.fromEntries(QUEUE_TABS.map((t) => [t.key, { total: 0, matched: 0 }]))
  for (const a of appointments || []) {
    const hit = matchesQuery(a, query)
    for (const c of [out[tabOf(a)], out.all]) { c.total++; if (hit) c.matched++ }
  }
  return out
}

// «الحضور (7)» — ومع البحث «الحضور (2 من 7)»
export const tabLabel = (tab, count, searching) =>
  `${tab.label} (${searching ? `${count.matched} من ${count.total}` : count.total})`
