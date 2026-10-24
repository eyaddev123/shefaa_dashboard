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

// ═══ اسم الجهة على البطاقة ═══
// نصفان متقاربان: سطرٌ واحد إن وسعه الورق، وإلّا سطران متوازنان — لا قصّ ولا
// تصغير خطّ. (اسم النظام نفسه في الشريط الجانبيّ وصفحة الدخول لم يتغيّر.)
export const ORG_NAME_PARTS = ['مجمع عيادات', 'الشفاء الطبي']
export const ORG_NAME = ORG_NAME_PARTS.join(' ')

// ═══ النسخ ═══
// الأولى للمريض والثانية للعيادة، وما زاد «نسخة إضافية». والمحتوى متطابق.
export const COPY_LABELS = ['نسخة المريض', 'نسخة العيادة']
export const copyLabel = (i) => COPY_LABELS[i] || 'نسخة إضافية'
export const MAX_COPIES = 5
const clampCopies = (n, dflt) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v >= 1 && v <= MAX_COPIES ? v : dflt
}

// copies: عدد النسخ في الطباعة **التلقائية عند الحضور** (٢ افتراضاً: المريض والعيادة).
// إعادة الطباعة اليدوية تسأل عن العدد كلّ مرّة (١ افتراضاً).
export const DEFAULT_PRINTER = { enabled: false, width: 80, copies: 2 }

// ★ الافتراض «مطفأ»: الاستقبال جهازان وطابعةٌ واحدة. لو كان الافتراض
// «يطبع» لحاول الجهاز الذي لا طابعة له أن يطبع عند كل حضور.
export const loadPrinter = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      enabled: raw.enabled === true,
      width: raw.width === 58 ? 58 : DEFAULT_PRINTER.width,
      copies: clampCopies(raw.copies, DEFAULT_PRINTER.copies),
    }
  } catch { return { ...DEFAULT_PRINTER } }
}

// ★ دمجٌ لا استبدال: المفتاح نفسه يحمل منفذ الوسيط ورمزه (loadHelper) —
// والكتابة فوقه كاملاً كانت تمحوهما بصمت عند أيّ تغييرٍ في هذه الصفحة.
export const savePrinter = (s) => {
  try {
    let prev = {}
    try { prev = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {} } catch { prev = {} }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...prev, ...s }))
  } catch { /* وضع التصفّح الخاص */ }
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
// heightMm: طولُ الصفحة بالمليمتر حين نعرفه (بعد قياس المحتوى) — وإلّا «auto».
// origin: جذر الموقع لتحميل ملفات الخطّ منه (الإطار بلا عنوانٍ يُحَلّ منه مسار).
export function ticketHtml(data, width = 80, heightMm = null, origin = '', copy = null) {
  const w = width === 58 ? 58 : 80
  const content = w === 58 ? 48 : 72          // عرض المحتوى الفعلي (مم)
  const big = w === 58 ? 26 : 34              // حجم رقم الدور (مم ⇒ pt تقريبي)
  const base = w === 58 ? 11 : 13
  const pageH = heightMm ? `${heightMm}mm` : 'auto'

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
  /* ═══ خطّ Cairo من ملفات التطبيق لا من شبكة خارجية ═══
     الاستقبال قد يعمل بلا إنترنت (شبكةٌ محلّية والطابعة عليها)، وخطٌّ من CDN
     يسقط صامتاً فتُطبع البطاقة بخطٍّ آخر. والمسار مطلقٌ من جذر الموقع: الإطار
     مستندٌ بلا عنوانٍ خاصٍّ به (about:blank) فالمسار النسبيّ لا يُحَلّ.
     ونُحمّل الوزنين اللذين تستعملهما البطاقة وحدهما (٤٠٠ و٧٠٠). */
  @font-face {
    font-family: 'Cairo'; font-style: normal; font-weight: 400 700;
    font-display: block;   /* block لا swap: لا نريد ومضة خطٍّ بديلٍ تُطبع */
    src: url('${origin}/fonts/cairo-arabic.woff2') format('woff2');
    unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891,
                   U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011,
                   U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFF;
  }
  @font-face {
    font-family: 'Cairo'; font-style: normal; font-weight: 400 700;
    font-display: block;
    src: url('${origin}/fonts/cairo-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
                   U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F,
                   U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* الورق: الطول مقيسٌ من المحتوى — انظر ملاحظة printTicket أدناه */
  @page { size: ${w}mm ${pageH}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${w}mm;
    /* Cairo خطّ التطبيق — والاحتياط خطوط النظام إن تعذّر تحميله */
    font-family: 'Cairo', "Segoe UI", Tahoma, "Geeza Pro", "Arial", sans-serif;
    color: #000; font-size: ${base}pt; line-height: 1.45; font-weight: 400;
    /* أسود صريح على أبيض: الحراريّة لا تعرف رمادياً — الرمادي يخرج باهتاً */
    -webkit-font-smoothing: none;
  }
  .t { width: ${content}mm; margin: 0 auto; padding: 3mm 0 0; text-align: center; }
  .org { font-size: ${base + 2}pt; font-weight: 700; }
  /* نصفا الاسم لا ينكسران: سطرٌ واحد إن وسع، وإلّا سطران متوازنان */
  .org span { display: inline-block; white-space: nowrap; }
  .copy { font-size: ${base - 2}pt; margin-top: 1mm; }
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
  /* ★ فراغ النهاية: القاطع يبعد عن رأس الطباعة بنحو ٨مم، فبلا هذا الفراغ
     يقطع في آخر سطرٍ من النصّ. وهو داخلٌ في القياس فيصير طول الصفحة =
     المحتوى + ٨مم بالضبط، لا ورقةً كاملة. */
  .cut { height: 8mm; }
</style></head>
<body><div class="t">
  <div class="org">${ORG_NAME_PARTS.map((p) => `<span>${esc(p)}</span>`).join(' ')}</div>
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
  ${copy ? `<div class="copy">${esc(copy)}</div>` : ''}
  <div class="cut"></div>
</div></body></html>`
}

// ═══ الطباعة ═══
// تُرجع وعداً يُحلّ دائماً — الطباعة لا تُفشل الحضور أبداً. { ok, reason }
// copies: نسخةً بعد نسخة (احتياط المتصفّح وحده — الوسيط يطبعها مهمّةً واحدة)
export async function printTicket(data, width = 80, doc = document, { copies = 1 } = {}) {
  const n = clampCopies(copies, 1)
  let last = { ok: true, reason: null }
  for (let i = 0; i < n; i++) {
    last = await printOneTicket(data, width, doc, copyLabel(i))
    if (!last.ok) return last
  }
  return last
}

function printOneTicket(data, width = 80, doc = document, copy = null) {
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

      // جذر الموقع: الإطار مستندٌ مكتوبٌ بـdocument.write فلا عنوان له،
      // ومسارٌ نسبيٌّ للخطّ لا يُحَلّ. نأخذه من نافذة التطبيق.
      const origin = (doc.defaultView || window).location.origin

      // ═══ مرّتان: قياسٌ ثمّ طباعة ═══
      // الطول «auto» يجعل تعريف الصفحة بلا ارتفاع، فيملأ سائق الطابعة الورقة
      // إلى حدّ المقاس المختار (٢١٠مم عندنا) ويُخرج ورقاً أبيض طويلاً بعد
      // النصّ. نرسم أوّلاً لنقيس ارتفاع المحتوى الحقيقي، ثمّ نُعيد الرسم
      // بـ@page بذلك الارتفاع — فيقطع السائق بعد المحتوى مباشرةً.
      d.open(); d.write(ticketHtml(data, width, null, origin, copy)); d.close()

      const guard = setTimeout(() => done(true, null), 9000)
      w.onafterprint = () => { clearTimeout(guard); done(true, null) }

      const MM = 96 / 25.4
      const go = async () => {
        try {
          // ★ ننتظر الخطّ قبل القياس وقبل الطباعة: القياس بخطٍّ بديلٍ يعطي
          // ارتفاعاً خاطئاً، والطباعة قبل جهوزه تُخرج أوّل بطاقةٍ بخطٍّ آخر.
          if (d.fonts && d.fonts.ready) {
            await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 2500))])
          }
          // الارتفاع الفعلي للمحتوى + فراغٌ قبل القاطع (CUT_MM داخل البطاقة)
          const el = d.querySelector('.t') || d.body
          const measured = Math.ceil((el.getBoundingClientRect().height) / MM)
          if (measured > 20 && measured < 2000) {
            d.open(); d.write(ticketHtml(data, width, measured, origin, copy)); d.close()
            if (d.fonts && d.fonts.ready) {
              await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
            }
            await new Promise((r) => setTimeout(r, 80))
          }
          w.focus(); w.print()
        } catch (e) {
          clearTimeout(guard); done(false, e?.message || 'فشل أمر الطباعة')
        }
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
// ★ نمط الحضور: البطاقة تُطبع عند الحضور وتحمل **رقم الدور** (arrival_number) لا رقم
// الحجز — الرقم الذي تعرضه الصالة وتنطقه. (منطقٌ مُضمَّن لا استيراد: فحص البطاقة يحقن
// هذا الملف في صفحة بلا وحدات.)
// ★ الإحالة: البطاقة تحمل ما يدفعه المريض فعلاً — بعد الخصم، بلا كلمة «خصم» ولا اسم الجهة.
// patient_fee و patient_price يرسلهما الخادم مع صفّ الطابور (للاستقبال وحده)؛ وبلا إحالة
// يساويان الأصل، وفي غيابهما (ردٌّ قديم) يُطبع الأصل كما كان.
export const ticketFrom = (appt, session) => ({
  queue_number: session?.flow_mode === 'attendance'
    ? (appt.arrival_number ?? appt.queue_number) : appt.queue_number,
  full_name: appt.full_name,
  birth_year: appt.birth_year,
  visit_type: appt.visit_type,
  fee: appt.patient_fee ?? appt.fee,
  procedures: (appt.procedures || []).map((p) =>
    (p.patient_price != null ? { ...p, price: p.patient_price } : p)),
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
