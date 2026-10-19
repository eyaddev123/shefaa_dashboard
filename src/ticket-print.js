// ═══════════ بطاقة الدور — الطباعة على الطابعة الحرارية ═══════════
//
// لماذا من المتصفّح لا بـ ESC/POS أو WebUSB؟ العربية. أوامر ESC/POS تحتاج
// صفحة ترميزٍ عربية في الطابعة نفسها، وتكسر التشكيل وتَصِل الحروف خطأً.
// المتصفّح يرسم النصّ بخطّ النظام ويُرسله صورةً للطابعة — فيخرج صحيحاً.
//
// ولماذا iframe مخفيّ لا window.print() على الصفحة؟ قاعدة `@media print`
// في styles.css تُخفي `.sidebar` وتعيد رسم `.layout` — فطباعة الصفحة نفسها
// تعني أنّ شاشة الاستقبال تومض وتتبدّل أمام الموظف. والـ iframe مستندٌ
// منفصلٌ بأنماطه وحده: لا شيء من أنماط النظام يصل إليه ولا يصل منه شيء.

const SETTINGS_KEY = 'shefaa.printer'

export const DEFAULT_PRINTER = { enabled: false, width: 80 }

// ★ الافتراض «مطفأ»: الاستقبال جهازان وطابعةٌ واحدة. لو كان الافتراض
// «يطبع» لحاول الجهاز الذي لا طابعة له أن يطبع عند كل حضور.
export const loadPrinter = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      enabled: raw.enabled === true,
      width: raw.width === 58 ? 58 : DEFAULT_PRINTER.width,
    }
  } catch { return { ...DEFAULT_PRINTER } }
}

export const savePrinter = (s) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* وضع التصفّح الخاص */ }
}

// ═══ العمر من سنة الميلاد ═══
// سنة الميلاد وحدها عندنا (لا تاريخ كامل)، فالعمر تقريبيّ بالسنوات.
// يُحذف السطر كلّه إن لم تكن معروفة — سطرٌ بـ«—» يُربك لا يُفيد.
export const ageFrom = (birthYear, now = new Date()) => {
  const y = Number(birthYear)
  if (!Number.isInteger(y) || y < 1900) return null
  const age = now.getFullYear() - y
  return age >= 0 && age < 130 ? age : null
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ل.س`

const two = (n) => String(n).padStart(2, '0')
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
  + ` · ${two(d.getHours())}:${two(d.getMinutes())}`

// ═══ بناء البطاقة ═══
// width: 80 أو 58 (مليمتر الورق). المحتوى أضيق من الورق بهامشٍ من الجهتين:
// الطابعة الحرارية لا تطبع حتى الحافّة، وبلا هامشٍ يُقصّ أوّل الحرف وآخره.
export function ticketHtml(data, width = 80) {
  const w = width === 58 ? 58 : 80
  const content = w === 58 ? 48 : 72          // عرض المحتوى الفعلي (مم)
  const big = w === 58 ? 26 : 34              // حجم رقم الدور (مم ⇒ pt تقريبي)
  const base = w === 58 ? 11 : 13

  const age = ageFrom(data.birth_year)
  // القائم وحده يُطبع: المُزال سطرٌ ملغيّ، وطباعته تجعل المريض يدفع ثمن ما أُلغي
  const procs = (data.procedures || []).filter((p) => !p.removed_at)
  const fee = Number(data.fee || 0)
  const procsTotal = procs.reduce((s, p) => s + Number(p.price || 0), 0)
  const total = fee + procsTotal

  const rows = procs.map((p) => `
      <tr><td class="k">${esc(p.name)}</td><td class="v">${esc(money(p.price))}</td></tr>`).join('')

  // مع إجراءات: تفصيلٌ ومجموع. بلا إجراءات: سطر «المبلغ للدفع» وحده.
  const amountBlock = procs.length > 0 ? `
    <table class="amounts">
      <tr><td class="k">${esc(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة')}</td>
          <td class="v">${esc(money(fee))}</td></tr>
      ${rows}
      <tr class="total"><td class="k">المجموع للدفع</td><td class="v">${esc(money(total))}</td></tr>
    </table>` : `
    <div class="pay"><span>المبلغ للدفع</span><strong>${esc(money(fee))}</strong></div>`

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>بطاقة الدور</title>
<style>
  /* الورق: الطول «auto» — الإيصال يطول بالإجراءات ولا يُقصّ عند حدٍّ ثابت */
  @page { size: ${w}mm auto; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${w}mm;
    /* خطوط النظام: لا تحميل من الشبكة — الطابعة لا تنتظر خطاً لا يصل */
    font-family: "Segoe UI", Tahoma, "Geeza Pro", "Arial", sans-serif;
    color: #000; font-size: ${base}pt; line-height: 1.45;
    /* أسود صريح على أبيض: الحراريّة لا تعرف رمادياً — الرمادي يخرج باهتاً */
    -webkit-font-smoothing: none;
  }
  .t { width: ${content}mm; margin: 0 auto; padding: 3mm 0 0; text-align: center; }
  .org { font-size: ${base + 2}pt; font-weight: 700; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .num-label { font-size: ${base - 1}pt; }
  .num { font-size: ${big}pt; font-weight: 700; line-height: 1.05; margin: 1mm 0 2mm; }
  .name { font-size: ${base + 3}pt; font-weight: 700; }
  .meta { font-size: ${base}pt; }
  .clinic { font-size: ${base + 1}pt; font-weight: 700; margin-top: 1mm; }
  .pay { display: flex; justify-content: space-between; align-items: baseline;
         border-top: 2px solid #000; margin-top: 2mm; padding-top: 1.5mm;
         font-size: ${base + 2}pt; font-weight: 700; }
  table.amounts { width: 100%; border-collapse: collapse; margin-top: 2mm;
                  font-size: ${base}pt; }
  table.amounts td { padding: 0.6mm 0; vertical-align: top; }
  table.amounts td.k { text-align: right; }
  table.amounts td.v { text-align: left; white-space: nowrap; direction: ltr; }
  table.amounts tr.total td { border-top: 2px solid #000; padding-top: 1.2mm;
                              font-size: ${base + 2}pt; font-weight: 700; }
  .when { font-size: ${base - 2}pt; margin-top: 2mm; direction: ltr; }
  /* ★ فراغ النهاية: القاطع يقطع على بُعد ~١٠مم من رأس الطباعة، فبلا هذا
     الفراغ يقطع في آخر سطرٍ من النصّ. */
  .cut { height: 14mm; }
</style></head>
<body><div class="t">
  <div class="org">جمعية الشفاء الخيرية</div>
  <div class="rule"></div>

  <div class="num-label">رقم الدور</div>
  <div class="num">${esc(data.queue_number)}</div>

  <div class="name">${esc(data.full_name)}</div>
  ${age != null ? `<div class="meta">العمر: ${age} سنة</div>` : ''}

  <div class="rule"></div>
  <div class="clinic">${data.room ? `العيادة ${esc(data.room)}` : ''}</div>
  <div class="meta">${esc(data.doctor_name || '')}</div>
  <div class="meta">${esc(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة')}</div>

  ${amountBlock}

  <div class="when">${esc(stamp(data.now ? new Date(data.now) : new Date()))}</div>
  <div class="cut"></div>
</div></body></html>`
}

// ═══ الطباعة ═══
// تُرجع وعداً يُحلّ دائماً — الطباعة لا تُفشل الحضور أبداً. { ok, reason }
export function printTicket(data, width = 80, doc = document) {
  return new Promise((resolve) => {
    let frame = null
    let settled = false
    const done = (ok, reason) => {
      if (settled) return
      settled = true
      // التنظيف مؤجَّل: إزالة الإطار قبل أن ينهي المتصفّح الطباعة تُلغيها
      setTimeout(() => { try { frame && frame.remove() } catch { /* أُزيل سلفاً */ } }, 2000)
      resolve({ ok, reason: reason || null })
    }
    try {
      frame = doc.createElement('iframe')
      // بعيدٌ عن الشاشة لا display:none: بعض المتصفّحات لا تطبع إطاراً مخفيّاً
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:100mm;height:200mm;border:0;'
      doc.body.appendChild(frame)

      const w = frame.contentWindow
      const d = frame.contentDocument || (w && w.document)
      if (!d || !w) return done(false, 'تعذّر إنشاء إطار الطباعة')

      d.open(); d.write(ticketHtml(data, width)); d.close()

      // مهلة: لو لم يعد onafterprint (أو طُبع صامتاً) لا نُعلّق الوعد أبداً
      const guard = setTimeout(() => done(true, null), 4000)
      w.onafterprint = () => { clearTimeout(guard); done(true, null) }

      // ننتظر رسم المستند قبل الطباعة — طباعةٌ قبل الرسم تخرج ورقةً فارغة
      const go = () => {
        try { w.focus(); w.print() }
        catch (e) { clearTimeout(guard); done(false, e?.message || 'فشل أمر الطباعة') }
      }
      if (d.readyState === 'complete') setTimeout(go, 60)
      else w.onload = () => setTimeout(go, 60)
    } catch (e) {
      done(false, e?.message || 'فشل غير متوقّع')
    }
  })
}

// ═══ بطاقة من صفّ الطابور ═══
// كل ما تحتاجه البطاقة موجودٌ أصلاً في ردّ الطابور — لا طلب شبكةٍ إضافي
// يؤخّر الطباعة (ولا يفشل بها) لحظة وقوف المريض أمام الموظف.
export const ticketFrom = (appt, session) => ({
  queue_number: appt.queue_number,
  full_name: appt.full_name,
  birth_year: appt.birth_year,
  visit_type: appt.visit_type,
  fee: appt.fee,
  procedures: appt.procedures,
  doctor_name: session?.doctor_name,
  room: session?.room,
})

// بطاقة تجريبية — لفحص الطابعة من صفحة الإعداد
export const SAMPLE_TICKET = {
  queue_number: 7,
  full_name: 'محمد أحمد الحسن',
  birth_year: new Date().getFullYear() - 34,
  visit_type: 'consultation',
  fee: 15000,
  procedures: [],
  doctor_name: 'د. سامر الحلبي',
  room: '3',
}
