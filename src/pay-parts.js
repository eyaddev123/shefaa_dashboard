// ═══ مكوّنات راتب الدكتور: مرضى · أيام · ساعات (2026-11-12) ═══
// الخادم يُرسل payParts (أو parts في «راتبي») وأسعارها لكلّ نوعٍ غير «راتب شهري ثابت» القديم —
// فالعرض يقرأ المكوّنات لا النوع، ويغطّي «يومية + ساعة» و«حسب عدد المرضى» القديمين بلا فرع.
import { fmtClock } from './components/Punctuality.jsx'

export const PAY_PARTS = [
  { key: 'patients', label: 'المرضى', unit: 'عن كل مريض', rate: 'patientRate', salary: 'salaryPatients' },
  { key: 'days', label: 'الأيام', unit: 'عن كل يوم حضور', rate: 'dailyRate', salary: 'salaryDays' },
  { key: 'hours', label: 'الساعات', unit: 'عن كل ساعة', rate: 'hourlyRate', salary: 'salaryHours' },
]
const SHORT = { patients: 'مرضى', days: 'أيام', hours: 'ساعات' }

const fmt = (n) => Number(n || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
const countText = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : `${fmt(n)} ${n >= 3 && n <= 10 ? few : many}`)

/**
 * المكوّنات من سطر حسابٍ أو راتب: payParts/parts إن وُجدت، وإلّا تُشتقّ من النوع القديم وأسعاره.
 * null = «راتب شهري ثابت» أو بلا إعداد.
 */
export function partsOf(src) {
  if (!src) return null
  if (src.payParts || src.parts) return src.payParts || src.parts
  const kind = src.payKind || src.kind
  if (kind === 'per_patient') return Number(src.patientRate ?? src.payAmount ?? src.rate) > 0 ? ['patients'] : []
  if (kind === 'daily_hourly') return [...(src.dailyRate > 0 ? ['days'] : []), ...(src.hourlyRate > 0 ? ['hours'] : [])]
  return null
}

/** «مرضى + ساعات» — اسم الحساب من مكوّناته */
export const partsTitle = (parts) => (parts?.length ? parts.map((p) => SHORT[p]).join(' + ') : null)

/** كمّية المكوّن بالكلام: «٢٠ مريضاً» · «٤ أيام» · «١٢:٣٠ ساعة» */
export function partQty(key, { patients = 0, days = 0, minutes = 0 }) {
  if (key === 'patients') return countText(patients, 'مريض واحد', 'مريضان', 'مرضى', 'مريضاً')
  if (key === 'days') return countText(days, 'يوم واحد', 'يومان', 'أيام', 'يوماً')
  return `${fmtClock(minutes)} ساعة`
}

/**
 * أسطر الحساب لعرضٍ واحد: [{ key, label, qty, rate, value }] بترتيب المرضى ثمّ الأيام ثمّ الساعات.
 * src: سطر الحساب (patientRate/dailyRate/hourlyRate و salaryPatients/Days/Hours)، q: الكمّيات.
 */
export function partLines(parts, src, q) {
  return PAY_PARTS.filter((p) => parts?.includes(p.key)).map((p) => ({
    key: p.key, label: p.label, qty: partQty(p.key, q),
    rate: p.key === 'patients' ? (src.patientRate ?? src.payAmount ?? src.rate) : src[p.rate],
    value: p.key === 'patients' ? (src.salaryPatients ?? src.salary ?? src.total) : src[p.salary],
  }))
}

/** سطرٌ واحد مختصر: «٢٠ مريضاً × ١٬٠٠٠ + ١٢:٣٠ ساعة × ٥٬٠٠٠» */
export const partsFormula = (parts, src, q) =>
  partLines(parts, src, q).map((l) => `${l.qty} × ${fmt(l.rate)}`).join(' + ')

/** وصف الإعداد بلا كمّيات: «١٬٠٠٠ ل.س للمريض + ٥٬٠٠٠ ل.س للساعة» */
export const ratesText = (parts, src) => PAY_PARTS.filter((p) => parts?.includes(p.key))
  .map((p) => `${fmt(src[p.rate])} ل.س ${{ patients: 'للمريض', days: 'لليوم', hours: 'للساعة' }[p.key]}`).join(' + ')
