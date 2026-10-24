// ═══ خصم الإحالة — معاينةٌ في الواجهة ═══
// مرآةٌ لـ server/src/referral-logic.js (computeReferral / availableScopes) لعرض «المطلوب من
// المريض» فوراً أثناء الكتابة. الخادم هو الحاسب الوحيد: ما يُحفظ ويُطبع ويُجرد يأتي من ردّه.

export const DISCOUNT_TYPES = { percent: 'نسبة %', fixed: 'مبلغ ثابت' }
export const DISCOUNT_SCOPES = {
  visit_only: 'الكشف فقط', procedures_only: 'الإجراءات فقط', visit_and_procedures: 'الكشف والإجراءات',
}
export const MAX_REFERRALS = 2

// ═══ التغطية: حتى إحالتين بلا تداخل ═══
export const coversVisit = (sc) => sc === 'visit_only' || sc === 'visit_and_procedures'
export const coversProcedures = (sc) => sc === 'procedures_only' || sc === 'visit_and_procedures'
const overlap = (a, b) => (coversVisit(a) && coversVisit(b)) || (coversProcedures(a) && coversProcedures(b))
/** النطاقات المتاحة بجانب نطاقاتٍ قائمة — فلا يظهر خيارٌ يرفضه الخادم */
export const availableScopes = (taken = []) =>
  Object.keys(DISCOUNT_SCOPES).filter((sc) => !taken.some((t) => overlap(sc, t)))
/** هل اكتملت التغطية (لا نطاق متاح لإحالةٍ أخرى)؟ */
export const coverageFull = (scopes) => scopes.length >= MAX_REFERRALS || availableScopes(scopes).length === 0

const money = (v) => Math.round((Number(v) || 0) * 100) / 100

// إحالةٌ واحدة على نطاقها — نفس قواعد الخادم حرفياً
export function computeReferral({ fee, lines = [], type, value, scope }) {
  const f = Math.max(0, money(fee))
  const v = Math.max(0, money(value))
  const onVisit = coversVisit(scope), onProcs = coversProcedures(scope)
  let feeDiscount = 0, procs = 0
  if (type === 'percent') {
    const pct = Math.min(v, 100) / 100
    if (onVisit) feeDiscount = Math.min(f, money(f * pct))
    for (const l of lines) {
      const p = Math.max(0, money(l.price))
      if (onProcs) procs = money(procs + Math.min(p, money(p * pct)))
    }
  } else {
    let rest = v
    if (onVisit) { feeDiscount = Math.min(f, rest); rest = money(rest - feeDiscount) }
    for (const l of lines) {
      const p = Math.max(0, money(l.price))
      const d = onProcs ? Math.min(p, rest) : 0
      rest = money(rest - d); procs = money(procs + d)
    }
  }
  return { feeDiscount, proceduresDiscount: procs, total: money(feeDiscount + procs),
    waitingForProcedures: scope === 'procedures_only' && lines.length === 0 }
}

// «٥٠٬٠٠٠» ⇒ 50000 — كما يقرأها الخادم (الفاصلة فاصل آلاف)
export const parseAmount = (v) => {
  const t = String(v ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '').replace(/٫/g, '.').trim()
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null
}

// ═══ مسوّدة إحالة في النموذج ⇄ جسم الطلب ═══
let seq = 0
export const blankReferral = (scope = 'visit_only') => ({
  key: `new-${++seq}`, referral_source_id: '', discount_type: 'percent', discount_value: '',
  discount_scope: scope, referral_doc_number: '', referral_note: '',
})
export const draftFromReferral = (r) => ({
  key: `ref-${r.id}`, id: r.id, referral_source_id: String(r.referral_source_id), discount_type: r.discount_type,
  discount_value: String(r.discount_value), discount_scope: r.discount_scope,
  referral_doc_number: r.referral_doc_number || '', referral_note: r.referral_note || '',
})
export const referralPayload = (f) => ({
  referral_source_id: Number(f.referral_source_id), discount_type: f.discount_type,
  discount_value: f.discount_value, discount_scope: f.discount_scope,
  referral_doc_number: f.referral_doc_number || null, referral_note: f.referral_note || null,
})
// هل تكفي الورقة للإرسال؟ (الخادم يتحقّق ثانيةً — هذا لإطفاء الزرّ وحده)
export const referralReady = (f) => {
  const v = parseAmount(f.discount_value)
  return !!f.referral_source_id && v != null && v > 0 && (f.discount_type !== 'percent' || v <= 100)
}
/** خصم مسوّدة (أو صفر إن لم تكتمل قيمتها) */
export const draftDiscount = (f, amounts) => {
  const v = parseAmount(f.discount_value)
  if (v == null || v <= 0) return { total: 0, waitingForProcedures: f.discount_scope === 'procedures_only' && !(amounts?.lines || []).length }
  return computeReferral({ fee: amounts?.fee, lines: amounts?.lines || [], type: f.discount_type, value: v, scope: f.discount_scope })
}

// «50٪» / «30,000 ل.س ثابت» — بأرقام الواجهة نفسها (ar-SY كـ fmtMoney)
export const amountText = (r) => r.discount_type === 'percent'
  ? `${Number(r.discount_value).toLocaleString('ar-SY')}٪`
  : `${Number(r.discount_value).toLocaleString('ar-SY')} ل.س ثابت`
export const referralSummary = (r) => [amountText(r), DISCOUNT_SCOPES[r.discount_scope]].join(' · ')
