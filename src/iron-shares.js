// ═══ معاينة أثر تعديل حصّة جلسة حديد، قبل الحفظ ═══
// للعرض وحده: الخادم يعيد الحساب عند الحفظ وهو المرجع. computeIronDistribution هنا نسخةٌ من دالّة
// الخادم (iron-sessions.js) لأنّ المعاينة تعمل مع كلّ حرف بلا طلب، و test:iron يقارن النسختين على
// شبكة أرقام فلا تنحرفان. تعمل بأرقام الجلسة نفسها، ولا تصل إلا من يرى التوزيع.

const money = (v) => Math.round((Number(v) || 0) * 100) / 100
const MAX_MONEY = 999999999999.99

/** كما يقرأ الخادم المبلغ (readNumber): أرقامٌ عربية وفواصل آلاف. {empty} | {error} | {value} */
export function readAmountInput(v) {
  let t = String(v ?? '')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[\s ٬]/g, '')
  if (t === '') return { empty: true }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  t = t.replace(/[٫,]/g, '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: true }
  const n = Number(t)
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6 || n > MAX_MONEY) return { error: true }
  return { value: n }
}

export function computeIronDistribution({ price, doctor, nurse, cap, materialsTotal = 0 }) {
  const p = money(price), d = money(doctor), n = money(nurse), c = money(cap), total = money(materialsTotal)
  const afterShares = money(p - d - n)
  if (afterShares < 0) return { price: p, materials: 0, materialsTotal: total, nurse: n, doctor: d, shifa: 0, surplus: 0, overPrice: false, negative: true }
  const materials = Math.min(total, afterShares)
  const rest = money(afterShares - materials)
  const shifa = Math.min(rest, c)
  return { price: p, materials, materialsTotal: total, nurse: n, doctor: d, shifa, surplus: money(rest - shifa),
    overPrice: total > afterShares, negative: false }
}

/** ما يذهب من الجلسة لصندوق العيادات: المواد والفاضل (حركتا مُحفِّز iron_sessions) */
export const fundOf = (split) => money(split.materials + split.surplus)

/**
 * row: سطر السجلّ (بتوزيعه) · doctorText/nurseText: كما كُتبا، والفارغ يعني «بلا تغيير» كالخادم.
 * @returns {{bad: {doctor?:true, nurse?:true}, after: object|null, changed: boolean, fundDelta: number}}
 */
export function previewShareEdit(row, doctorText, nurseText) {
  const d = row.doctorId ? readAmountInput(doctorText) : { empty: true }
  const n = readAmountInput(nurseText)
  const bad = { ...(d.error ? { doctor: true } : {}), ...(n.error ? { nurse: true } : {}) }
  if (d.error || n.error) return { bad, after: null, changed: false, fundDelta: 0 }
  const after = computeIronDistribution({
    price: row.price, doctor: d.value ?? row.split.doctor, nurse: n.value ?? row.split.nurse, cap: row.shifaCap,
    materialsTotal: row.materials.reduce((t, m) => t + m.deduct, 0) })
  const changed = after.doctor !== row.split.doctor || after.nurse !== row.split.nurse
  return { bad, after, changed, fundDelta: after.negative ? 0 : money(fundOf(after) - fundOf(row.split)) }
}
