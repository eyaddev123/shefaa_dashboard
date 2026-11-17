// ═══ كلّ خانة إدخال تكتب أرقاماً لاتينية — حتى بالكيبورد العربي (قرار المستخدم 2026-11-16) ═══
// «أي رقم بينضاف… حتى لو الكيبورد عربي لحاله يكتب انجلش». حارسٌ واحد على مستوى الصفحة
// بدل تعديل كلّ خانة: ٠-٩ و۰-۹ ⇒ 0-9، «٫» ⇒ «.»، «٬» ⇒ «,»، «٪» ⇒ «%» لحظة الكتابة واللصق.
//
// كيف يعمل مع React:
//   • input (طور الالتقاط على document — يسبق مستمع React على #root): القيمة تُستبدل بالمُحوَّلة
//     عبر setter النموذج الأصليّ لا خاصيّة العنصر. React يتتبّع القيمة بخاصيّةٍ على العنصر نفسه،
//     فيرى الفرق ويُطلق onChange بالقيمة المحوَّلة — فالحالة لا ترى رقماً عربياً أبداً.
//     والمؤشّر يبقى مكانه (التحويل حرفٌ بحرف، لا يتغيّر الطول).
//   • type=number: المتصفّح لا يقبل «٣» فيها أصلاً (قيمتها تصير فارغة قبل input) ⇒ نلتقط
//     beforeinput واللصق ونُدرج النصّ المحوَّل بدله.
// كلمة المرور مستثناة (كالخادم): كلمةٌ قديمة بأرقامٍ عربية كانت ستنكسر. وdata-keep-digits لأيّ استثناء.
// الخادم يطبّع كلّ طلب أيضاً (server/src/latin-digits.js) — هذا عرضٌ لما سيُخزَّن، والحراسة هناك.

const HAS = /[٠-٩۰-۹٫٬٪]/
export const latinize = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/٫/g, '.').replace(/٬/g, ',').replace(/٪/g, '%')

const skip = (el) => el.type === 'password' || el.hasAttribute('data-keep-digits') || el.readOnly

function valueSetter(el) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const d = Object.getOwnPropertyDescriptor(proto, 'value')
  return d && d.set
}

function fieldOf(target) {
  const el = target
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null
  return skip(el) ? null : el
}

// إدراج نصٍّ مكان التحديد كأنّ المستخدم كتبه (يُطلق input طبيعياً، والتراجع Ctrl+Z يعمل)
function insertText(el, text) {
  try {
    if (document.execCommand && document.execCommand('insertText', false, text)) return true
  } catch (e) { /* نكمل للبديل */ }
  return false
}

let installed = false
export function installLatinInput() {
  if (installed || typeof document === 'undefined') return
  installed = true

  document.addEventListener('input', (e) => {
    const el = fieldOf(e.target)
    if (!el || el.type === 'number') return
    const v = el.value
    if (!HAS.test(v)) return
    const set = valueSetter(el)
    if (!set) return
    let start = null, end = null
    try { start = el.selectionStart; end = el.selectionEnd } catch (err) { /* email مثلاً */ }
    set.call(el, latinize(v))
    try { if (start != null) el.setSelectionRange(start, end) } catch (err) { /* لا تحديد */ }
  }, true)

  // type=number: الحرف العربي يُرفض قبل input — نبدّله قبل أن يصل
  document.addEventListener('beforeinput', (e) => {
    const el = fieldOf(e.target)
    if (!el || el.type !== 'number' || typeof e.data !== 'string' || !HAS.test(e.data)) return
    e.preventDefault()
    insertText(el, latinize(e.data))
  }, true)

  document.addEventListener('paste', (e) => {
    const el = fieldOf(e.target)
    if (!el || el.type !== 'number') return
    const text = e.clipboardData && e.clipboardData.getData('text')
    if (!text || !HAS.test(text)) return
    e.preventDefault()
    insertText(el, latinize(text))
  }, true)
}
