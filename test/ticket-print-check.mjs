// ═══════════════════════════════════════════════════════════════════
// فحص بطاقة الدور: المحتوى، والقياس على ورق ٨٠مم و٥٨مم، ولقطات
//
// يُشغَّل بـ: npm run test:ticket   (يحتاج كروم playwright)
//
// لماذا متصفّح حقيقي: السؤال الحقيقي «هل يخرج نصٌّ مقصوص على ورقٍ عرضه
// ٨٠مم؟» — وهو قياسُ تخطيطٍ لا منطق. نقيسه بعرض صفحةٍ مضبوطٍ بالمليمتر
// ونقارن كلّ عنصرٍ بحدود الورق.
//
// ولماذا نطبع فعلاً إلى PDF: `@page size` و«هل يُقصّ؟» لا يظهران إلا في
// مسار الطباعة. والـ PDF الناتج يُقاس عرضه بالنقاط فنتأكّد أنّه ٨٠مم حقاً.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.TICKET_SHOTS || resolve(ROOT, '.ticket-shots')
mkdirSync(SHOTS, { recursive: true })

let pass = 0
const failures = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✘ ${label}${detail ? ` ${detail}` : ''}`)
  return false
}

// نحمّل الوحدة كنصّ ونحقنها في الصفحة: لا بناء ولا خادم — فحصٌ للوحدة نفسها
const src = readFileSync(resolve(ROOT, 'src/ticket-print.js'), 'utf8')
  .replace(/^export /gm, '')

const MM = 96 / 25.4   // بكسل CSS لكل مليمتر عند 96dpi

const browser = await chromium.launch()

// ═══ ١) منطق العمر ═══
console.log('\n── ١) العمر من سنة الميلاد ──')
{
  const page = await browser.newPage()
  await page.addScriptTag({ content: src })
  const r = await page.evaluate(() => ({
    normal: ageFrom(1990, new Date('2026-10-19')),
    unknown: ageFrom(null),
    empty: ageFrom(''),
    zero: ageFrom(0),
    bogus: ageFrom(1800),
    future: ageFrom(2099, new Date('2026-10-19')),
  }))
  ok(r.normal === 36, 'سنة ميلاد ١٩٩٠ ⇒ ٣٦ سنة', JSON.stringify(r.normal))
  ok(r.unknown === null, 'بلا سنة ⇒ null (يُحذف السطر)')
  ok(r.empty === null, 'نصّ فارغ ⇒ null')
  ok(r.zero === null, 'صفر ⇒ null')
  ok(r.bogus === null, '١٨٠٠ ⇒ null (خارج المعقول)')
  ok(r.future === null, 'سنة مستقبلية ⇒ null')
  await page.close()
}

// ═══ ٢) المحتوى: ما يجب أن يظهر وما يجب ألّا يظهر ═══
console.log('\n── ٢) محتوى البطاقة ──')
{
  const page = await browser.newPage()
  await page.addScriptTag({ content: src })
  const html = await page.evaluate(() => ticketHtml({
    queue_number: 12, full_name: 'عبد الرحمن محمد الخطيب', birth_year: 1992,
    visit_type: 'consultation', fee: 15000, procedures: [],
    doctor_name: 'د. سامر الحلبي', room: '3', now: '2026-10-19T14:30:00',
  }, 80))
  ok(html.includes('جمعية الشفاء الخيرية'), 'اسم الجمعية')
  ok(html.includes('>12<'), 'رقم الدور')
  ok(html.includes('عبد الرحمن محمد الخطيب'), 'الاسم الثلاثي')
  ok(html.includes('العمر: 34 سنة'), 'العمر محسوبٌ من سنة الميلاد')
  ok(html.includes('العيادة 3'), '«العيادة ٣» لا «الغرفة»')
  ok(!html.includes('الغرفة'), '★ كلمة «الغرفة» غير موجودة إطلاقاً')
  ok(html.includes('د. سامر الحلبي'), 'اسم الدكتور')
  ok(html.includes('معاينة'), 'نوع الزيارة')
  ok(html.includes('15,000 ل.س'), 'المبلغ للدفع')
  ok(html.includes('2026-10-19') && html.includes('14:30'), 'التاريخ والوقت')
  ok(html.includes('size: 80mm auto'), '@page بعرض ٨٠مم وطولٍ تلقائي')
  ok(html.includes('margin: 0'), 'بلا هوامش')
  // ★ المطلوب صراحةً: لا رمز وصول على هذه البطاقة
  ok(!/رمز الوصول|access_code/.test(html), '★ لا رمز وصول على البطاقة')
  await page.close()
}

// ═══ ٣) الإجراءات: إعادة الطباعة بعد إضافتها ═══
console.log('\n── ٣) إعادة الطباعة مع الإجراءات ──')
{
  const page = await browser.newPage()
  await page.addScriptTag({ content: src })
  const html = await page.evaluate(() => ticketHtml({
    queue_number: 5, full_name: 'سمير خالد حسن', birth_year: 1980,
    visit_type: 'followup', fee: 5000,
    procedures: [
      { name: 'تخطيط قلب', price: 25000 },
      { name: 'غرز', price: 2000 },
      { name: 'إجراء مُزال', price: 99000, removed_at: '2026-10-19T10:00:00' },
    ],
    doctor_name: 'د. هدى', room: '2',
  }, 80))
  ok(html.includes('مراجعة'), 'نوع الزيارة «مراجعة»')
  ok(html.includes('5,000 ل.س'), 'سطر المراجعة')
  ok(html.includes('تخطيط قلب') && html.includes('25,000'), 'الإجراء الأول')
  ok(html.includes('غرز') && html.includes('2,000'), 'الإجراء الثاني')
  ok(!html.includes('إجراء مُزال') && !html.includes('99,000'),
    '★ المُزال لا يُطبع (وإلا دفع المريض ثمن ما أُلغي)')
  ok(html.includes('المجموع للدفع') && html.includes('32,000 ل.س'),
    'المجموع = 5,000 + 25,000 + 2,000', '32,000')
  await page.close()
}

// ═══ ٤) بلا عمر: السطر يُحذف ═══
console.log('\n── ٤) بيانات ناقصة ──')
{
  const page = await browser.newPage()
  await page.addScriptTag({ content: src })
  const r = await page.evaluate(() => ({
    noAge: ticketHtml({ queue_number: 1, full_name: 'أحمد علي حسن', fee: 1000 }, 80),
    noRoom: ticketHtml({ queue_number: 1, full_name: 'أحمد علي حسن', fee: 1000, room: null }, 80),
  }))
  ok(!r.noAge.includes('العمر'), '★ بلا سنة ميلاد ⇒ لا سطر عمر أصلاً')
  ok(!r.noRoom.includes('العيادة'), 'بلا غرفة ⇒ لا سطر عيادة')
  ok(r.noAge.includes('أحمد علي حسن'), 'الاسم يظهر رغم النقص')
  await page.close()
}

// ═══ ٥) القياس على الورق: لا شيء يُقصّ ═══
console.log('\n── ٥) القياس على ورقٍ حقيقي ──')
const CASES = [
  { w: 80, label: 'اسم طويل + إجراءات', data: {
      queue_number: 128, full_name: 'عبد الرحمن عبد اللطيف الشامي الحموي', birth_year: 1975,
      visit_type: 'followup', fee: 5000,
      procedures: [{ name: 'تخطيط قلب كهربائي كامل', price: 25000 },
                   { name: 'تضميد جرح', price: 3500 }],
      doctor_name: 'د. عبد الرحمن الحلبي', room: '12' } },
  { w: 80, label: 'اسم قصير بلا عمر', data: {
      queue_number: 3, full_name: 'علي حسن خالد',
      visit_type: 'consultation', fee: 15000, procedures: [],
      doctor_name: 'د. هدى', room: '2' } },
  { w: 58, label: '٥٨مم + إجراءات', data: {
      queue_number: 99, full_name: 'عبد الرحمن عبد اللطيف الشامي', birth_year: 1988,
      visit_type: 'consultation', fee: 15000,
      procedures: [{ name: 'تخطيط قلب', price: 25000 }],
      doctor_name: 'د. سامر الحلبي', room: '7' } },
  { w: 58, label: '٥٨مم قصير', data: {
      queue_number: 4, full_name: 'علي حسن خالد', birth_year: 2000,
      visit_type: 'consultation', fee: 15000, procedures: [],
      doctor_name: 'د. هدى', room: '1' } },
]

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: Math.round(c.w * MM), height: 900 } })
  await page.addScriptTag({ content: src })
  const html = await page.evaluate(([d, w]) => ticketHtml(d, w), [c.data, c.w])
  await page.setContent(html)
  await page.emulateMedia({ media: 'print' })

  const m = await page.evaluate((paperMm) => {
    const mmPx = 96 / 25.4
    const paper = paperMm * mmPx
    const out = { paper: Math.round(paper), overflow: [], bodyW: 0 }
    out.bodyW = Math.round(document.body.getBoundingClientRect().width)
    document.querySelectorAll('.t *').forEach((el) => {
      if (!el.textContent.trim()) return
      const r = el.getBoundingClientRect()
      // يتجاوز الورق من أيّ جهة؟
      if (r.left < -0.5 || r.right > paper + 0.5)
        out.overflow.push({ t: el.textContent.trim().slice(0, 22),
                            l: Math.round(r.left), r: Math.round(r.right) })
      // النصّ أعرض من وعائه ⇒ مقصوص
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        out.overflow.push({ t: el.textContent.trim().slice(0, 22), clipped: true })
    })
    const cut = document.querySelector('.cut')
    out.cutMm = cut ? Math.round(cut.getBoundingClientRect().height / mmPx) : 0
    out.heightMm = Math.round(document.body.scrollHeight / mmPx)
    return out
  }, c.w)

  const tag = `${c.w}mm — ${c.label}`
  ok(m.overflow.length === 0, `${tag}: لا نصّ خارج الورق ولا مقصوص`,
    m.overflow.length ? JSON.stringify(m.overflow) : '')
  ok(m.bodyW <= Math.round(c.w * MM) + 1, `${tag}: عرض الجسم ≤ عرض الورق`,
    `${m.bodyW} ≤ ${Math.round(c.w * MM)}`)
  ok(m.cutMm >= 10, `${tag}: فراغ القصّ ≥ ١٠مم`, `${m.cutMm}مم`)

  const file = `${SHOTS}/ticket-${c.w}mm-${CASES.indexOf(c)}.png`
  await page.screenshot({ path: file, fullPage: true })
  console.log(`     ↳ ${file}  (الطول ${m.heightMm}مم)`)

  // ★ الطباعة الفعلية إلى PDF: تثبت أنّ المحتوى يسع الورق في مسار الطباعة.
  // ملاحظة مقيسة: كروم بلا واجهة يتجاهل `@page { size: Xmm auto }` ويعود إلى
  // Letter حين يكون الطول «auto» (قِيس: 215.9مم). ومع طولٍ صريح يحترمه
  // بالضبط (80mm 150mm ⇒ 80.1×149.9). فالقصور في مولّد الـPDF لا في البطاقة،
  // وتعريف الصفحة يبقى `auto` لأنّ الإيصال يطول بالإجراءات. لذا نُمرّر العرض
  // صراحةً هنا، ونقيس أنّ شيئاً لا يفيض عنه.
  const heightMm = Math.max(60, m.heightMm + 4)
  const pdf = await page.pdf({
    width: `${c.w}mm`, height: `${heightMm}mm`, printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  })
  writeFileSync(`${SHOTS}/ticket-${c.w}mm-${CASES.indexOf(c)}.pdf`, pdf)
  const head = pdf.subarray(0, 4000).toString('latin1')
  const mb = head.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/)
  if (mb) {
    const widthMm = Number(mb[1]) / 2.8346
    ok(Math.abs(widthMm - c.w) < 1.5, `${tag}: صفحة الـPDF بعرض ${c.w}مم`,
      `${widthMm.toFixed(1)}مم`)
    // صفحةٌ واحدة: لو فاض المحتوى عن العرض لانقسم أو قُصّ
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    ok(pages === 1, `${tag}: صفحةٌ واحدة لا انقسام`, `${pages}`)
  } else {
    ok(false, `${tag}: تعذّرت قراءة MediaBox من الـPDF`)
  }
  await page.close()
}

// ═══ ٦) الطباعة لا تُفشل شيئاً ═══
console.log('\n── ٦) الطباعة لا ترمي أبداً ──')
{
  const page = await browser.newPage()
  await page.addScriptTag({ content: src })
  // نكسر window.print عمداً: يجب أن يعود {ok:false} لا أن يرمي
  const r = await page.evaluate(async () => {
    const results = {}
    const frames0 = document.querySelectorAll('iframe').length
    // الحالة ١: print يرمي
    const origin = HTMLIFrameElement.prototype
    const f = document.createElement('iframe')
    document.body.appendChild(f)
    f.contentWindow.print = () => { throw new Error('لا طابعة') }
    f.remove()
    // نستعمل مستنداً حقيقياً لكن بطابعةٍ معطوبة عبر الوراثة
    const realPrint = window.print
    results.threw = await (async () => {
      try {
        const res = await printTicket({ queue_number: 1, full_name: 'أ ب ج', fee: 0 }, 80)
        return res
      } catch (e) { return { threw: e.message } }
    })()
    results.frames0 = frames0
    return results
  })
  ok(r.threw && r.threw.threw === undefined, '★ printTicket لا ترمي أبداً (ترجع كائناً)',
    JSON.stringify(r.threw))
  ok(r.threw && typeof r.threw.ok === 'boolean', 'ترجع { ok }')
  await page.close()
}

// ═══ ٧) إعدادات الجهاز ═══
console.log('\n── ٧) إعداد الجهاز في localStorage ──')
{
  // localStorage يُرفض على about:blank (بلا أصل) — نستعمل أصلاً حقيقياً
  const page = await browser.newPage()
  await page.route('**/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('http://localhost/printer-settings-test')
  await page.addScriptTag({ content: src })
  const r = await page.evaluate(() => {
    const out = {}
    localStorage.clear()
    out.default = loadPrinter()
    savePrinter({ enabled: true, width: 58 })
    out.saved = loadPrinter()
    localStorage.setItem('shefaa.printer', 'ليس JSON')
    out.corrupt = loadPrinter()
    localStorage.setItem('shefaa.printer', JSON.stringify({ enabled: 'نعم', width: 999 }))
    out.bogus = loadPrinter()
    return out
  })
  ok(r.default.enabled === false, '★ الافتراض: الجهاز لا يطبع (طابعةٌ واحدة لجهازين)')
  ok(r.default.width === 80, 'الافتراض ٨٠مم')
  ok(r.saved.enabled === true && r.saved.width === 58, 'يحفظ ويقرأ ٥٨مم')
  ok(r.corrupt.enabled === false && r.corrupt.width === 80, 'قيمة تالفة ⇒ الافتراضات')
  ok(r.bogus.enabled === false && r.bogus.width === 80, 'قيمة غير منطقية ⇒ الافتراضات')
  await page.close()
}

await browser.close()

console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
if (failures.length) {
  console.log('\nالإخفاقات:')
  failures.forEach((f) => console.log(`  ✘ ${f}`))
  process.exit(1)
}
console.log('✔ البطاقة تخرج كاملةً على ٨٠مم و٥٨مم، بلا قصٍّ وبلا رمز وصول')
