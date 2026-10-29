import { fmtMoney, toLatinDigits } from './api.js'

// ═══ قاعدة حصّة الدكتور الخاصّة — النصّ والتحقّق في الواجهة ═══
// التحقّق هنا مرآةٌ لـ readShareRule في الخادم (الخادم يحرس، وهذا يُري الخطأ قبل الإرسال):
// المبلغ الثابت رقمٌ صفر أو أكثر، والنسبة بين 0 و100. والثابت **أعلى من سعر الإجراء
// مسموح** — يُحفظ ويظهر تحذير، فقد يكون قراراً مقصوداً.

/** {kind, value} أو صفّ قاعدة {share_kind, share_value} ⇒ «مبلغ ثابت 20,000» / «40٪ بعد المواد» */
export function ruleText(r) {
  if (!r) return 'بلا'
  const kind = r.kind ?? r.share_kind
  const value = Number(r.value ?? r.share_value)
  return kind === 'percent' ? `${value}٪ بعد المواد` : `مبلغ ثابت ${fmtMoney(value)}`
}

export const FIXED_ABOVE_PRICE = 'المبلغ الثابت أعلى من سعر الإجراء — حصّة الشفاء ستطلع سالبة في هذا الإجراء'

/**
 * @returns {{error: string|null, warning: string|null, value: number|null}}
 */
export function checkRule(kind, raw, price) {
  const label = kind === 'percent' ? 'النسبة' : 'المبلغ الثابت'
  const t = toLatinDigits(raw).replace(/[٫,]/g, '.').trim()
  if (t === '') return { error: `${label}: أدخل قيمة`, warning: null, value: null }
  if (/^-\s*\d/.test(t)) return { error: `${label}: لا يُقبل رقمٌ سالب — أدخل صفراً أو أكثر`, warning: null, value: null }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: `${label}: أدخل رقماً (خانتان عشريتان على الأكثر)`, warning: null, value: null }
  const value = Number(t)
  if (kind === 'percent' && value > 100) return { error: 'النسبة: بين ٠ و١٠٠ — لا تتجاوز ١٠٠٪', warning: null, value: null }
  const warning = kind === 'fixed' && price != null && value > Number(price) ? FIXED_ABOVE_PRICE : null
  return { error: null, warning, value }
}

/** ما يقوله «الحذف» عن مصير الدكتور: نسبته العامّة، أو صفر إن لم تكن */
export function afterDeleteText(doctor) {
  if (doctor.share_kind === 'percent') return `بعد الحذف سيُحسب له حسب النسبة العامّة ${Number(doctor.share_value)}٪`
  if (doctor.share_kind === 'fixed') return `بعد الحذف سيُحسب له حسب قاعدته العامّة: مبلغ ثابت ${fmtMoney(doctor.share_value)}`
  return 'بعد الحذف ستكون حصّته من هذا الإجراء صفراً — لا نسبة عامّة له'
}

// ═══ نصّ سطر تاريخ التسعيرة — من جهة الإجراء (اسم الدكتور) أو من جهة الدكتور (اسم الإجراء) ═══
// القيم JSON من الخادم: القاعدة {kind, value}، والسعر {price}.
export const doctorsCount = (n) => (n === 1 ? 'دكتور واحد' : n === 2 ? 'دكتورَين'
  : n <= 10 ? `${n} دكاترة` : `${n} دكتوراً`)
const pct = (r) => (!r ? 'بلا نسبة' : r.kind === 'percent' ? `${r.value}٪` : `مبلغ ثابت ${fmtMoney(r.value)} (قديمة)`)

/** @param {'procedure'|'doctor'} side */
export function pricingText(h, side) {
  const o = h.old_value, n = h.new_value
  const who = side === 'procedure' ? `${h.doctor_name}: ` : `قاعدة «${h.procedure_name}»: `
  const batch = side === 'doctor' && h.in_batch ? ' (بتوزيعٍ من صفحة الإجراءات)' : ''
  switch (h.action) {
    case 'price': return o ? `السعر: ${fmtMoney(o.price)} ← ${fmtMoney(n.price)}` : `أُنشئ الإجراء بسعر ${fmtMoney(n.price)}`
    case 'general_share': return `النسبة العامّة: ${pct(o)} ← ${pct(n)}`
    case 'rule_add': return `${who}أُضيفت قاعدة ${ruleText(n)}${batch}`
    case 'rule_edit': return `${who}${ruleText(o)} ← ${ruleText(n)}${batch}`
    case 'rule_delete': return `${who}حُذفت القاعدة (كانت ${ruleText(o)}) — يُحسب بالنسبة العامّة`
    case 'distribute': {
      const parts = [n.added && `أُضيفت عند ${doctorsCount(n.added)}`, n.replaced && `استُبدلت عند ${doctorsCount(n.replaced)}`,
        n.skipped && `تُخطّي ${doctorsCount(n.skipped)} لهم قاعدة`].filter(Boolean)
      return `وُزِّعت قاعدة ${ruleText(n)} على ${doctorsCount(n.doctors)} — ${parts.join('، ')}`
    }
    default: return 'تغيير في التسعيرة'
  }
}
