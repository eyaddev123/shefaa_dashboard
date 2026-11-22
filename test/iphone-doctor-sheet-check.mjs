// ═══════════════════════════════════════════════════════════════════
// ورقة «+ إجراء» عند الطبيب على الآيفون (2026-11-22، جوال الدكتورة Pro Max):
//   «الشاشة انمدّت والدروب داون نطّت لفوق» + «الأجرة ليست سعر الإجراء على المريض»
//   npm run test:iphone    (IPHONE_SHOTS=/dir يحفظ اللقطات · IPHONE_ROOT=/client آخر للمقارنة)
// WebKit بقياس iPhone 15 Pro Max ولمس. تكبير الآيفون التلقائي نفسه لا يُحاكى هنا — يُفحص سببه:
// خطّ كلّ حقلٍ يُلمس ≥ 16px.
// ═══════════════════════════════════════════════════════════════════
import { webkit, chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.IPHONE_ROOT || HERE
const PORT = Number(process.env.IPHONE_TEST_PORT || 5262)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.IPHONE_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const FX = JSON.parse(readFileSync(resolve(HERE, 'test/fixtures/visit-page.json'), 'utf8'))
let pass = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`); return false }

const SID = '1'
const PROCS = [
  { id: '11', name: 'خياطة جرح', price: '200000.00', is_active: true },
  { id: '12', name: 'تنظيف جرح', price: '75000.00', is_active: true },
  { id: '13', name: 'فكّ قطب', price: '50000.00', is_active: true },
]
const MATS = Array.from({ length: 14 }, (_, i) => ({ id: String(i + 1), name: `مادة تجريبية ${i + 1}`, unit: 'قطعة',
  unit_price: String(5000 * (i + 1)), is_active: true }))
const queue = () => {
  const q = structuredClone(FX.queues[SID])
  const a = { ...q.appointments[0], id: '501', status: 'in_service', procedures: [], full_name: 'مريضة الفحص' }
  return { ...q, id: SID, doctor_id: '4', appointments: [a] }
}

async function open(browser, engine, { theme = 'light' } = {}) {
  const dev = devices['iPhone 15 Pro Max']
  const ctx = await browser.newContext(engine === 'webkit' ? { ...dev, locale: 'ar' }
    : engine === 'laptop' ? { viewport: { width: 1366, height: 768 }, locale: 'ar' }
    : { viewport: dev.viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ar' })
  await ctx.addInitScript((t) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', t) }, theme)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (p === '/auth/me') return json(FX.me.doctor)
    if (p === '/clinic/my-profile') return json({ id: '4', has_procedures: true })
    if (p === '/clinic/procedures/fee-mode') return json({ since: '2026-11-17' })
    if (p === '/clinic/my-sessions') return json([queue()])
    if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json(queue())
    if (p === '/clinic/procedures') return json(PROCS)
    if (p === '/clinic/materials') return json(MATS)
    if (p === '/clinic/nurse-calls') return json({ calls: [] })
    if (p === '/clinic/my-procedures') return json({ lines: [] })
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}/clinic/doctor`, { waitUntil: 'load' })
  return { ctx, page, errors }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

async function flow(browser, engine, theme) {
  const tag = `${engine}-${theme}`
  const laptop = engine === 'laptop'
  console.log(`\n── ${tag} ──`)
  const { ctx, page, errors } = await open(browser, engine, { theme })
  await page.getByRole('button', { name: '+ إجراء' }).first().click()
  await page.waitForSelector('.dk-pick-grid')
  // الخطوة 1: كلّ أجرةٍ بجانبها «+ المواد»
  const prices = await page.$$eval('.dk-pick-price', (els) => els.map((e) => e.textContent))
  ok(prices.length === 3 && prices.every((t) => t.includes('+ المواد')), `${tag}: «+ المواد» بجانب كلّ أجرة (${prices.join(' | ')})`)
  await shot(page, `${tag}-1-step1`)
  await page.locator('.dk-pick', { hasText: 'خياطة جرح' }).click()
  await page.locator('.dk-confirm').click()
  await page.waitForSelector('.dk-sel-item')
  const head = await page.textContent('.dk-sel-price')
  ok(/الأجرة/.test(head) && /\+ المواد/.test(head), `${tag}: رأس البطاقة «الأجرة … + المواد» (${head})`)
  const foot = await page.textContent('.dk-total')
  ok(/على المريض/.test(foot) && /للدكتور والشفاء/.test(foot) && /بلا مواد ولا مستهلكات/.test(foot),
    `${tag}: المجموع بلا مواد يقول «للدكتور والشفاء — بلا مواد» (${foot})`)
  await shot(page, `${tag}-2-step2`)

  // البحث عن مادة: الخطّ ≥16px (وإلا كبّر الآيفون الصفحة)، واللوحة داخل الورقة تحت الحقل
  const search = page.locator('.mat-search input')
  await search.click()
  await page.waitForSelector('.combo-panel')
  const fs = await search.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  if (!laptop) ok(fs >= 16, `${tag}: خطّ بحث المواد ${fs}px ≥ 16`)
  const where = await page.evaluate(() => {
    const panel = document.querySelector('.combo-panel'), input = document.querySelector('.mat-search input')
    const pr = panel.getBoundingClientRect(), ir = input.getBoundingClientRect()
    return { inSheet: !!panel.closest('.bs-body'), below: pr.top >= ir.bottom - 1, pos: getComputedStyle(panel).position }
  })
  if (laptop) ok(!where.inSheet && where.pos === 'fixed', `${tag}: اللابتوب كما كان — القائمة طافية (${JSON.stringify(where)})`)
  else ok(where.inSheet && where.below && where.pos === 'static', `${tag}: القائمة داخل الورقة تحت الحقل (${JSON.stringify(where)})`)
  await page.waitForTimeout(500)
  await shot(page, `${tag}-3-list`)
  await page.locator('.combo-panel li', { hasText: 'مادة تجريبية 3' }).click()
  await page.locator('.combo-panel li', { hasText: 'مادة تجريبية 5' }).click().catch(async () => {
    await search.click(); await page.locator('.combo-panel li', { hasText: 'مادة تجريبية 5' }).click()
  })
  const n = await page.$$eval('.mat-chosen li', (l) => l.length)
  ok(n === 2, `${tag}: مادتان مضافتان (${n})`)
  // كلّ حقلٍ في الورقة ≥16px، ولا تمرير أفقي في الصفحة ولا في الورقة
  const small = await page.$$eval('.bs-card input', (els) => els.map((e) => [e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(([, f]) => f < 16))
  if (!laptop) ok(small.length === 0, `${tag}: لا حقل في الورقة دون 16px (${JSON.stringify(small)})`)
  ok(await noHScroll(page), `${tag}: لا تمرير أفقي`)
  const sheetH = await page.evaluate(() => {
    const b = document.querySelector('.bs-body'); return b.scrollWidth <= b.clientWidth + 1
  })
  ok(sheetH, `${tag}: لا تمرير أفقي داخل الورقة`)
  const foot2 = await page.textContent('.dk-total')
  ok(/على المريض\s*\S*240,000/.test(foot2.replace(/ /g, ' ')) || /240,000/.test(foot2), `${tag}: على المريض = 200,000 + 15,000 + 25,000 (${foot2})`)
  // الصفحة تحت الورقة مقفولة
  const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden')
  ok(locked, `${tag}: الصفحة تحت الورقة لا تتمرّر`)
  await shot(page, `${tag}-4-mats`)
  ok(errors.length === 0, `${tag}: لا أخطاء صفحة (${errors.join(' | ')})`)
  await page.locator('.bs-x').click()
  const unlocked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden')
  ok(unlocked, `${tag}: الإغلاق يفكّ قفل الصفحة`)
  await ctx.close()
}

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  // تسخين Vite (البدء البارد يُسقط أوّل قياس)
  await fetch(`${BASE}/src/main.jsx`).catch(() => {})
  const wk = await webkit.launch()
  await flow(wk, 'webkit', 'light')
  await flow(wk, 'webkit', 'dark')
  await wk.close()
  const cr = await chromium.launch()
  await flow(cr, 'chromium', 'light')
  await flow(cr, 'laptop', 'light')
  await cr.close()
  console.log(`\n${pass} ✓ · ${failures.length} ✖`)
  stop()
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
