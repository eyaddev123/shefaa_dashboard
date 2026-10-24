// ═══ خصم الإحالة — معاينةٌ في الواجهة ═══
// مرآةٌ لـ server/src/referral-logic.js (computeReferral) لعرض «المطلوب من المريض» فوراً
// أثناء الكتابة. الخادم هو الحاسب الوحيد: ما يُحفظ ويُطبع ويُجرد يأتي من ردّه لا من هنا.

export const DISCOUNT_TYPES = { percent: 'نسبة %', fixed: 'مبلغ ثابت' }
export const DISCOUNT_SCOPES = { visit_only: 'الكشف فقط', visit_and_procedures: 'الكشف والإجراءات' }

const money = (v) => Math.round((Number(v) || 0) * 100) / 100

export function computeReferral({ fee, lines = [], type, value, scope }) {
  const f = Math.max(0, money(fee))
  const v = Math.max(0, money(value))
  const withProcs = scope === 'visit_and_procedures'
  if (type === 'percent') {
    const pct = Math.min(v, 100) / 100
    const feeDiscount = Math.min(f, money(f * pct))
    const out = lines.map((l) => {
      const p = Math.max(0, money(l.price))
      return { id: l.id, discount: withProcs ? Math.min(p, money(p * pct)) : 0 }
    })
    return { feeDiscount, lines: out, total: money(feeDiscount + out.reduce((s, l) => s + l.discount, 0)) }
  }
  const feeDiscount = Math.min(f, v)
  let rest = money(v - feeDiscount)
  const out = lines.map((l) => {
    const p = Math.max(0, money(l.price))
    const d = withProcs ? Math.min(p, rest) : 0
    rest = money(rest - d)
    return { id: l.id, discount: d }
  })
  return { feeDiscount, lines: out, total: money(feeDiscount + out.reduce((s, l) => s + l.discount, 0)) }
}

// «٥٠٬٠٠٠» ⇒ 50000 — كما يقرأها الخادم (الفاصلة فاصل آلاف)
export const parseAmount = (v) => {
  const t = String(v ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '').replace(/٫/g, '.').trim()
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null
}

// حالة النموذج ⇐ جسم الطلب (null = بلا إحالة)
export const blankReferral = () => ({
  enabled: false, referral_source_id: '', discount_type: 'percent', discount_value: '',
  discount_scope: 'visit_only', referral_doc_number: '', referral_note: '',
})
export const referralFromAppt = (r) => r ? {
  enabled: true, referral_source_id: String(r.referral_source_id), discount_type: r.discount_type,
  discount_value: String(r.discount_value), discount_scope: r.discount_scope,
  referral_doc_number: r.referral_doc_number || '', referral_note: r.referral_note || '',
} : blankReferral()
export const referralPayload = (f) => f.enabled ? {
  referral_source_id: Number(f.referral_source_id), discount_type: f.discount_type,
  discount_value: f.discount_value, discount_scope: f.discount_scope,
  referral_doc_number: f.referral_doc_number || null, referral_note: f.referral_note || null,
} : null
// هل تكفي الورقة للإرسال؟ (الخادم يتحقّق ثانيةً — هذا لإطفاء الزرّ وحده)
export const referralReady = (f) => {
  if (!f.enabled) return true
  const v = parseAmount(f.discount_value)
  return !!f.referral_source_id && v != null && v > 0 && (f.discount_type !== 'percent' || v <= 100)
}

// «50% · الكشف فقط» / «30,000 ثابت · الكشف والإجراءات»
// (أرقامٌ بخطّ الواجهة نفسه — ar-SY كـ fmtMoney — لا لاتينية بين عربية)
export const referralSummary = (r) => [
  r.discount_type === 'percent' ? `${Number(r.discount_value).toLocaleString('ar-SY')}٪`
    : `${Number(r.discount_value).toLocaleString('ar-SY')} ل.س ثابت`,
  DISCOUNT_SCOPES[r.discount_scope],
].join(' · ')
