// ═══ تطبيع البحث العربي في المتصفّح ═══
//
// مرآةٌ مبسّطة لـ normalize_ar في القاعدة: من يكتب «ايكو» يجد «إيكو»، ومن
// يكتب «وسخه» يجد «وسخة». بلا ذلك يبحث الطبيب عن إجراءٍ موجودٍ فلا يجده
// فيظنّه غير مُعرَّف — والهمزة والتاء المربوطة أكثر ما يُكتب على وجهين.
//
// هنا **عرضٌ لا حراسة**: الترشيح في الواجهة وحدها، والخادم يحرس ما يُضاف.

export function normalizeAr(text) {
  return String(text ?? '')
    .replace(/[أإآٱ]/g, 'ا')  // أ إ آ ٱ ⇒ ا
    .replace(/ة/g, 'ه')                       // ة ⇒ ه
    .replace(/[ىي]/g, 'ي')               // ى ⇒ ي
    .replace(/[ً-ْـ]/g, '')              // التشكيل والتطويل
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // أرقام عربية
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** هل يطابق النصُّ ما كُتب في البحث؟ (مطابقةُ احتواءٍ بعد التطبيع) */
export const matchesAr = (haystack, needle) => {
  const n = normalizeAr(needle)
  return n === '' || normalizeAr(haystack).includes(n)
}
