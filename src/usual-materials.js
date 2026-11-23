import { CONS_MAX } from './components/ConsumablesCounter.jsx'

// ═══ المواد المعتادة لكلّ إجراء (طلب المستخدم 2026-11-23) ═══
// «متل خدمة التسريب… المواد اللي بتكون بالعادة وبيعدل عليها الدكتور مشان ما يقعد يضيفها كل مرة».
// المشرفة تحدّدها بنافذة الإجراء (usual_materials وusual_consumables من GET /clinic/procedures)،
// وتُعبّأ بها بطاقة الإجراء عند اختياره — للدكتور والاستقبال — ثمّ تُعدَّل قبل «إضافة».
// ★ تعبئةٌ لا غير: الخادم يحسب ممّا يُرسَل فعلاً.
// ★ العدد (قرار المستخدم): المعتاد لإجراءٍ واحد ⇒ × العدد، ويتبعه ما دام المُضيف لم يلمس المواد.
//   والمستهلكات × العدد تقف عند سقف العدّاد (100).
// ★ المادة المعطّلة بعد دخولها المعتاد تُتخطّى (لا تُضاف لسطرٍ جديد أصلاً).

const round2 = (n) => Math.round(n * 100) / 100
const q = (n) => Math.max(1, Math.trunc(Number(n) || 1))

/** المواد المعتادة بصيغة MaterialsEditor ({material_id, name, unit, qty: نصّ}) × العدد */
export const usualMats = (proc, qty = 1) => (proc?.usual_materials || [])
  .filter((m) => m.is_active !== false)
  .map((m) => ({ material_id: String(m.material_id), name: m.name, unit: m.unit, qty: String(round2(Number(m.qty) * q(qty))) }))

/** عدّاد المستهلكات المعتاد × العدد، حتى 100 */
export const usualCons = (proc, qty = 1) => Math.min(CONS_MAX, (Number(proc?.usual_consumables) || 0) * q(qty))

/** هل للإجراء معتاد (مواد مفعّلة أو مستهلكات) */
export const hasUsual = (proc) => usualMats(proc).length > 0 || usualCons(proc) > 0

/** نصّ المعتاد سطراً: «خيط ×1، إبرة ×2 · مستهلكات 30» */
export const usualText = (proc) => {
  const mats = (proc?.usual_materials || []).map((m) => `${m.name} ×${Number(m.qty)}`)
  const c = Number(proc?.usual_consumables) || 0
  return [mats.join('، '), c > 0 && `مستهلكات ${c}`].filter(Boolean).join(' · ')
}

export const USUAL_HINT = 'المعتاد لهذا الإجراء — زِد أو نقّص أو احذف حسب الحالة.'
