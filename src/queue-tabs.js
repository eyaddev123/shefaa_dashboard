// ═══ تبويبات قائمة الدور عند الاستقبال ═══
// القائمة الواحدة بكل الحالات طالت حتى صار المريض يضيع فيها. أربعة تبويبات بعدّاد،
// وبحثٌ يعدّ نتائجه في كل تبويب. العدّ والترشيح هنا في الواجهة من ردّ /queue نفسه —
// لا حقل جديد في الخادم. والعدّادات حيّة لأنّها تُحسب من البيانات التي يُعيد بثُّ
// الموظفين تحميلها.
import { normalizeAr } from './arabic-search.js'

// الترتيب (RTL): الحضور (الافتراضي) · بانتظار الحضور · انتهى · ما حضر · الإجراءات · الإحالات · الكل
export const QUEUE_TABS = [
  { key: 'present', label: 'الحضور', empty: 'ما في حدا حاضر حالياً — اللي بيوصل بيظهر هون.' },
  { key: 'pending', label: 'بانتظار الحضور', empty: 'ما في حدا بانتظار الحضور.' },
  { key: 'done', label: 'انتهى', empty: 'ما في حدا انتهى كشفه بعد.' },
  { key: 'absent', label: 'ما حضر', empty: 'ما في غياب ولا إلغاء بهالجلسة.' },
  // ═══ تبويبان «عرضيّان»: تجميعٌ لا حالة ═══
  // المريض يظهر في تبويب حالته وفي هذين إن انطبقا — مقصود. والعدّاد عدد المرضى لا البنود.
  { key: 'procedures', label: 'الإجراءات', extra: true, empty: 'ما في إجراءات على حدا بهالجلسة.' },
  { key: 'referrals', label: 'الإحالات', extra: true, empty: 'ما في إحالات على حدا بهالجلسة.' },
  { key: 'all', label: 'الكل', empty: 'لا حجوزات بعد في هذه الجلسة.' },
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

// الإجراءات القائمة (المُزال لا يُعدّ) — والإحالات كما يرسلها الخادم للاستقبال
export const liveProcedures = (a) => (a.procedures || []).filter((l) => !l.removed_at)
const IN_EXTRA = {
  procedures: (a) => liveProcedures(a).length > 0,
  referrals: (a) => (a.referrals || []).length > 0,
}
// رقم الدور للترتيب: رقم الحضور لمن حضر، ثمّ من لم يحضر برقم حجزه
const turnKey = (a) => (a.arrival_number != null ? [0, a.arrival_number] : [1, a.queue_number])
const byTurn = (x, y) => { const a = turnKey(x), b = turnKey(y); return a[0] - b[0] || a[1] - b[1] }

// مجموع سطر التبويب: الملغى ومن لم يحضر والمؤجَّل لا يدفعون — يُعرضون ولا يُجمَعون
const UNPAID = ['cancelled', 'no_show', 'postponed']
export function extraTotals(rows) {
  const paying = rows.filter((a) => !UNPAID.includes(a.status))
  return {
    procedures: paying.reduce((s, a) => s + Number(a.procedures_total || 0), 0),
    discounts: paying.reduce((s, a) => s + Number(a.referral_discount || 0), 0),
    excluded: rows.length - paying.length,
  }
}

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
  if (IN_EXTRA[tab]) return (appointments || []).filter(IN_EXTRA[tab]).sort(byTurn)
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
    const into = [out[tabOf(a)], out.all, ...Object.keys(IN_EXTRA).filter((k) => IN_EXTRA[k](a)).map((k) => out[k])]
    for (const c of into) { c.total++; if (hit) c.matched++ }
  }
  return out
}

// «الحضور (7)» — ومع البحث «الحضور (2 من 7)»
export const tabLabel = (tab, count, searching) =>
  `${tab.label} (${searching ? `${count.matched} من ${count.total}` : count.total})`
