// ═══════════════════════════════════════════════════════════════════
// استيراد المواد في الواجهة — /inventory
//
// يُشغَّل بـ: npm run test:inventory-import
//
// ردود الخادم مُحاكاة (سلوكه في server: npm run test:inventory-import)؛ هنا ما تفعله الواجهة:
//   ١) «تنزيل القالب» جنب «استيراد Excel» وينزّل ملفاً، ولا يراه من لا يكتب
//   ٢) الخيار مفعّل افتراضياً ويُرسل as_opening=1، وإطفاؤه معاينةٌ جديدة
//   ٣) التأكيد يُرسل بصمة آخر معاينة وخيارها — وفشل التبديل يُعيد المربّع لما هو معروض
//   ٤) كلّ حالات السطر وعمود النوع وأثره على الصندوق، وتنبيه القالب القديم
//   ٥) معاينة قديمة (409) تُعرض ولا تُنفَّذ · RTL وبلا تمرير أفقي × 1366 و390 × فاتح/داكن
//   ٦) تحت 768 بطاقات: «النتيجة» داخل الشاشة تحت الاسم بلا تمرير أفقي، ومن 768 جدول
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.IMPORT_TEST_PORT || 5243)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }

const row = (over) => ({ row: 3, status: 'new', name: 'خيط', unit: 'بكرة', kind: 'counted', kind_defaulted: false, material_id: null,
  existing_name: null, sale_price: 4000, min_quantity: 10, qty: 30, unit_cost: 2500, supplier: null, fund_deduction: 0, reasons: [], notes: [], ...over })
const summary = (over) => ({ new: 1, consumable: 1, purchase: 0, opening: 1, skipped: 1, rejected: 1, new_units: 0, fund_deduction: 0, ...over })
const previewOf = (asOpening, { fp, kindColumn = true } = {}) => ({
  as_opening: asOpening, kind_column: kindColumn, fingerprint: fp || (asOpening ? 'fp-on' : 'fp-off'),
  summary: asOpening ? summary() : summary({ opening: 0, purchase: 1, fund_deduction: 60000 }),
  rows: [
    row(),
    row({ row: 4, status: 'consumable', name: 'كحول', kind: 'consumable', sale_price: 0, qty: null, unit_cost: null, notes: ['استهلاكية — الكمية وسعر الشراء يُتجاهلان'] }),
    asOpening ? row({ row: 5, status: 'opening', name: 'جبس', material_id: 1, qty: 12, unit_cost: 5000 })
      : row({ row: 5, status: 'purchase', name: 'جبس', material_id: 1, qty: 12, unit_cost: 5000, fund_deduction: 60000 }),
    row({ row: 6, status: 'skipped', name: 'لاصق', material_id: 2, qty: null, unit_cost: null, notes: ['مادة موجودة بلا كمية — لا شيء لاستيراده'] }),
    row({ row: 7, status: 'rejected', name: 'سيروم', kind: null, qty: null, unit_cost: null, reasons: ['نوع المادة «سائل» غير معروف — معدودة أو استهلاكية'] }),
  ],
})
const ME = { clinic_admin: { id: 1, username: 'adm', display_name: 'مشرفة', role: 'clinic_admin' },
  manager: { id: 2, username: 'mgr', display_name: 'مدير', role: 'manager' } }

async function mockApi(page, role) {
  const st = { previews: [], commits: [], templates: 0, previewFail: false, commit: null, kindColumn: true }
  const field = (req, name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(req.postDataBuffer()?.toString('utf8') || '')?.[1]
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(ME[role])
    if (p === '/inventory/materials') return json({ materials: [], summary: { total_value: 0, needs_purchase: 0, count: 0 } })
    if (p === '/inventory/import/template') {
      st.templates++
      return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'Content-Disposition': `attachment; filename="t.xlsx"; filename*=UTF-8''${encodeURIComponent('قالب استيراد المواد.xlsx')}` }, body: 'x' })
    }
    if (p === '/inventory/import/preview') {
      const on = field(req, 'as_opening') === '1'
      st.previews.push(field(req, 'as_opening'))
      if (st.previewFail) { st.previewFail = false; return json({ error: 'تعذّرت القراءة' }, 400) }
      return json(previewOf(on, { kindColumn: st.kindColumn }))
    }
    if (p === '/inventory/import/commit') {
      st.commits.push({ fingerprint: field(req, 'fingerprint'), as_opening: field(req, 'as_opening') })
      return st.commit ? json(...st.commit) : json({ ...summary(), imported: 4 }, 201)
    }
    return json([])
  })
  return st
}
const FILE = { name: 'مواد.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') }
async function open(browser, { w = 1366, h = 900, theme = 'light', role = 'clinic_admin' } = {}) {
  const mobile = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar', isMobile: mobile, hasTouch: mobile, acceptDownloads: true })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const st = await mockApi(page, role)
  await page.goto(`${BASE}/inventory`, { waitUntil: 'load' })
  await page.waitForSelector('.card', { timeout: 15000 })
  return { ctx, page, errors, st }
}
const startPreview = async (page) => {
  // بعد «نفض» المخزون: الاستيراد تحت «المزيد» (زرّان فقط فوق)
  await page.click('.invx-more-btn'); await page.getByRole('menuitem', { name: /استيراد من Excel/ }).click()
  await page.setInputFiles('input[type=file]', FILE)
  await page.waitForSelector('.inv-imp-table')
}
const box = (page) => page.getByLabel('تسجيل الكميات كرصيد افتتاحي (بلا خصم من صندوق العيادات)')
const hint = (page) => page.$eval('.inv-imp-opening .hint', (e) => e.innerText)
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
process.on('exit', stop)
let up = false
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500))
  up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
}
if (!up) { console.error('لم يقلع vite'); process.exit(1) }
const browser = await chromium.launch()

console.log('\n── ١) تنزيل القالب ──')
{
  const { ctx, page, st } = await open(browser)
  await page.click('.invx-more-btn')
  const actions = await page.$$eval('.invx-more-menu [role=menuitem] .invx-more-label', (b) => b.map((x) => x.innerText.trim()))
  const iImp = actions.indexOf('استيراد من Excel'), iTpl = actions.indexOf('تنزيل قالب Excel')
  ok(iImp >= 0 && iTpl === iImp + 1, `تحت «المزيد» جنب الاستيراد: ${actions}`)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /تنزيل قالب Excel/ }).click()])
  ok(st.templates === 1 && dl.suggestedFilename() === 'قالب استيراد المواد.xlsx', `الملف ${dl.suggestedFilename()}`)
  await ctx.close()
  const mgr = await open(browser, { role: 'manager' })
  await mgr.page.click('.invx-more-btn')
  ok(await mgr.page.getByRole('menuitem', { name: /تنزيل قالب Excel|استيراد/ }).count() === 0, 'المدير لا يراه')
  await mgr.ctx.close()
}

console.log('\n── ٢+٣+٤) المعاينة والخيار والتأكيد ──')
{
  const { ctx, page, st, errors } = await open(browser)
  await startPreview(page)
  ok(st.previews.join() === '1', `أوّل معاينة as_opening=1: ${st.previews}`)
  ok(await box(page).isChecked(), 'الخيار مفعّل افتراضياً')
  let txt = await page.$eval('.inv-imp-table', (e) => e.innerText)
  for (const want of ['تُضاف', 'استهلاكية — تُضاف بلا رصيد', 'موجودة — رصيد افتتاحي', 'تخطٍّ', 'لن تُستورد', 'رصيد افتتاحي — بلا خصم من الصندوق',
    'استهلاكية — الكمية وسعر الشراء يُتجاهلان', 'نوع المادة «سائل» غير معروف', 'النوع', 'معدودة']) ok(txt.includes(want), `في الجدول «${want}»`)
  ok(!(await hint(page)).includes('المجموع'), 'مفعّلاً: لا مبلغ خصم')
  ok(await page.getByRole('button', { name: /تأكيد الاستيراد/ }).innerText().then((t) => t.includes('٣')), 'الزرّ يعدّ ما يُنفَّذ (٣)')

  st.previewFail = true
  await box(page).uncheck()
  await page.waitForSelector('p.error')
  ok(await box(page).isChecked(), '★ فشل التبديل يعيد المربّع لما هو معروض')

  await box(page).uncheck()
  await page.waitForFunction(() => document.querySelector('.inv-imp-opening .hint')?.innerText.includes('المجموع'))
  ok(st.previews.at(-1) === '0', `الإطفاء معاينةٌ جديدة as_opening=0: ${st.previews}`)
  txt = await page.$eval('.inv-imp-table', (e) => e.innerText)
  ok(txt.includes('موجودة — شراء') && txt.includes('من الصندوق') && txt.includes('يُخصم'), 'مطفأً: الشراء وخصمه على السطر')
  await page.getByRole('button', { name: /تأكيد الاستيراد/ }).click()
  await page.waitForSelector('.inv-imp-table', { state: 'detached' })
  ok(st.commits.length === 1 && st.commits[0].fingerprint === 'fp-off' && st.commits[0].as_opening === '0', `★ التأكيد ببصمة آخر معاينة وخيارها: ${JSON.stringify(st.commits)}`)
  ok((await page.$eval('body', (b) => b.innerText)).includes('تمّ الاستيراد'), 'إشعار النجاح')
  ok(errors.length === 0, `أخطاء الصفحة: ${errors}`)
  await ctx.close()
}

console.log('\n── ٥) القالب القديم والمعاينة القديمة ──')
{
  const { ctx, page, st } = await open(browser)
  st.kindColumn = false
  await startPreview(page)
  ok((await page.$eval('.modal, [role=dialog], body', (e) => e.innerText)).includes('بالقالب القديم'), 'تنبيه القالب القديم')
  st.commit = [{ ...previewOf(true, { fp: 'fp-new' }), error: 'تغيّر شيءٌ منذ المعاينة', code: 'PREVIEW_STALE' }, 409]
  await page.getByRole('button', { name: /تأكيد الاستيراد/ }).click()
  await page.waitForSelector('p.error')
  ok(await page.locator('.inv-imp-table').count() === 1, 'المعاينة باقية بعد 409')
  st.commit = null
  await page.getByRole('button', { name: /تأكيد الاستيراد/ }).click()
  await page.waitForSelector('.inv-imp-table', { state: 'detached' })
  ok(st.commits.at(-1).fingerprint === 'fp-new', '★ التأكيد التالي ببصمة المعاينة الجديدة')
  await ctx.close()
}

for (const w of [1366, 390]) for (const theme of ['light', 'dark']) {
  const { ctx, page, errors } = await open(browser, { w, h: w < 768 ? 844 : 900, theme })
  await startPreview(page)
  ok(await page.evaluate(() => document.documentElement.dir) === 'rtl', `${w} ${theme}: RTL`)
  ok(await noHScroll(page), `${w} ${theme}: بلا تمرير أفقي للصفحة`)
  if (w >= 768) ok(await page.$eval('.inv-imp-table', (e) => getComputedStyle(e).overflowX) === 'auto', `${w} ${theme}: الجدول يُمرَّر داخل إطاره`)
  ok(errors.length === 0, `${w} ${theme}: أخطاء ${errors}`)
  await ctx.close()
}

console.log('\n── ٦) بطاقات تحت 768 ──')
for (const w of [390, 767, 768]) {
  const { ctx, page } = await open(browser, { w, theme: 'dark' })
  await startPreview(page)
  const m = await page.evaluate(() => {
    const box = document.querySelector('.inv-imp-table'), f = box.getBoundingClientRect()
    const cards = [...box.querySelectorAll('tbody > tr')].map((tr) => {
      const q = (s) => tr.querySelector(s).getBoundingClientRect()
      const name = q('.rt-title'), res = q('.inv-imp-result')
      return { resIn: res.left >= f.left - 1 && res.right <= f.right + 1, under: res.top >= name.bottom - 1, direct: res.top - name.bottom,
        display: getComputedStyle(tr).display, border: getComputedStyle(tr).borderInlineStartWidth }
    })
    return { sw: box.scrollWidth, cw: box.clientWidth, thead: getComputedStyle(box.querySelector('thead')).display, cards,
      labels: [...box.querySelector('tbody > tr').querySelectorAll('td[data-label]')].map((td) => td.dataset.label) }
  })
  if (w < 768) {
    ok(m.sw <= m.cw, `${w}: بلا تمرير أفقي داخل الإطار (${m.sw}>${m.cw})`)
    ok(m.thead === 'none' && m.cards.every((c) => c.display === 'flex'), `${w}: كلّ سطر بطاقة`)
    ok(m.cards.every((c) => c.resIn), `${w}: «النتيجة» داخل الشاشة بكلّ بطاقة`)
    ok(m.cards.every((c) => c.under && c.direct < 30), `${w}: «النتيجة» تحت الاسم مباشرة ${JSON.stringify(m.cards.map((c) => c.direct))}`)
    ok(['النوع', 'الكمّية', 'سعر الشراء'].every((l) => m.labels.includes(l)), `${w}: عناوين الخلايا ${m.labels}`)
    ok(await noHScroll(page), `${w}: بلا تمرير أفقي للصفحة`)
    ok(m.cards.filter((c) => parseFloat(c.border) >= 3).length === 4, `${w}: الشريط اللوني على البطاقات (إلا التخطّي)`)
  } else ok(m.thead !== 'none' && m.cards.every((c) => c.display === 'table-row'), `${w}: جدول`)
  await ctx.close()
}

await browser.close(); stop()
console.log(`\n${failures.length ? '✖' : '✔'} ${pass} نجح، ${failures.length} فشل`)
process.exit(failures.length ? 1 : 0)
