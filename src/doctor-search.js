import { matchesAr } from './arabic-search.js'

// ═══ البحث في القائمة: الاسم والاختصاص والجوال — ترشيحٌ محلّي على ما حُمِّل ═══
// الهمزات والتاء المربوطة والياء من matchesAr («ايه» تجد «آية»). والجوال يُقارَن أرقاماً
// وحدها أيضاً: «0933 600» تجد «0933600123» مهما كُتبت المسافات والشُّرَط.
const digitsOf = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '')
export function doctorMatches(d, query) {
  if (matchesAr(`${d.name} ${d.specialty_name || d.specialty || ''} ${d.phone || ''}`, query)) return true
  const q = digitsOf(query)
  return q.length > 0 && q.length === String(query).replace(/[\s\-–]/g, '').length && digitsOf(d.phone).includes(q)
}
