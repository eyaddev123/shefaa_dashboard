// ═══════════════════════════════════════════════════════════════════
// «حذف» إجراءٍ أضافه الطبيب بالغلط (2026-11-23): «بقلب الكرت تبع المريض فوق، وتحت بالإجراءات اللي
// قيد المحاسبة» — npm run test:doctor-remove   (REMOVE_SHOTS=/dir يحفظ اللقطات)
// الزرّ لما أضافه الطبيب ولم يُقبض وحده (كالخادم: DOCTOR_REMOVE_FORBIDDEN)، بتأكيد، ثمّ POST …/remove.
// ═══════════════════════════════════════════════════════════════════
import { chromium, webkit, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.REMOVE_TEST_PORT || 5266)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.REMOVE_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const FX = JSON.parse(readFileSync(resolve(HERE, 'test/fixtures/visit-page.json'), 'utf8'))
let pass = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`); return false }

const SID = '1', AID = '501'
const LINES = () => ([
  { id: '71', procedure_id: '11', name: 'خياطة جرح', added_source: 'doctor', added_by: '40', paid_at: null, removed_at: null, materials: [{ name: 'خيط', qty: 1 }] },
  { id: '72', procedure_id: '12', name: 'تنظيف جرح', added_source: 'reception', added_by: '17', paid_at: null, removed_at: null },
  { id: '73', procedure_id: '13', name: 'فكّ قطب', added_source: 'doctor', added_by: '40', paid_at: '2026-11-23T08:00:00Z', removed_at: null },
])

async function open(browser, view) {
  const ctx = await browser.newContext(view === 'phone' ? { ...devices['iPhone 13'], locale: 'ar' }
    : { viewport: view === 'tablet' ? { width: 820, height: 1180 } : { width: 1366, height: 768 }, locale: 'ar', hasTouch: view === 'tablet' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const state = { lines: LINES(), removed: [] }
  const live = () => state.lines.filter((l) => !l.removed_at)
  const queue = () => {
    const q = structuredClone(FX.queues[SID])
    const a = { ...q.appointments[0], id: AID, status: 'in_service', full_name: 'مريضة الفحص', procedures: state.lines }
    return { ...q, id: SID, doctor_id: '4', appointments: [a] }
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    const rm = p.match(/^\/clinic\/appointments\/(\d+)\/procedures\/(\d+)\/remove$/)
    if (rm && req.method() === 'POST') {
      state.removed.push({ appt: rm[1], line: rm[2], body: req.postDataJSON() })
      const l = state.lines.find((x) => x.id === rm[2]); if (l) l.removed_at = new Date().toISOString()
      return json(l)
    }
    if (p === '/auth/me') return json(FX.me.doctor)
    if (p === '/clinic/my-profile') return json({ id: '4', has_procedures: true })
    if (p === '/clinic/procedures/fee-mode') return json({ since: '2026-11-17' })
    if (p === '/clinic/my-sessions') return json([queue()])
    if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json(queue())
    if (p === '/clinic/my-procedures') return json({ lines: live().map((l) => ({ ...l, appointment_id: AID, patient_name: 'مريضة الفحص',
      mine: l.added_source === 'doctor' })), usage: {} })
    if (p === '/clinic/nurse-calls') return json({ calls: [] })
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}/clinic/doctor`, { waitUntil: 'load' })
  await page.waitForSelector('.dk-procs')
  return { ctx, page, errors, state }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

async function flow(browser, view) {
  console.log(`\n── ${view} ──`)
  const { ctx, page, errors, state } = await open(browser, view)
  // الكرت فوق: «حذف» على «خياطة جرح» وحده (الطبيب، غير مقبوض)
  const cardBtns = await page.$$eval('.dk-procs .dk-del-btn', (b) => b.map((x) => x.getAttribute('aria-label')))
  ok(cardBtns.length === 1 && /خياطة جرح/.test(cardBtns[0]), `${view}: الكرت فيه «حذف» واحد على إجراء الطبيب غير المقبوض (${cardBtns.join(' | ')})`)
  await shot(page, `${view}-1-card`)
  // الشريط تحت: نفس الشيء
  await page.locator('.dk-today-head').click()
  await page.waitForTimeout(350)
  const barBtns = await page.$$eval('.dk-today-item .dk-del-btn', (b) => b.map((x) => x.getAttribute('aria-label')))
  ok(barBtns.length === 1 && /خياطة جرح/.test(barBtns[0]), `${view}: الشريط فيه «حذف» واحد (${barBtns.join(' | ')})`)
  ok(await noHScroll(page), `${view}: لا تمرير أفقي والشريط مفتوح`)
  const fits = await page.$$eval('.dk-today-item', (els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1))
  ok(fits, `${view}: أسطر الشريط لا تفيض`)
  await shot(page, `${view}-2-bar`)
  // إلغاء التأكيد ⇒ لا طلب
  await page.locator('.dk-today-item .dk-del-btn').click()
  await page.waitForSelector('.dlg-card')
  const body = await page.textContent('.dlg-body')
  ok(/خياطة جرح/.test(body) && /موادّه/.test(body), `${view}: التأكيد يسمّي الإجراء ومواده (${body})`)
  await shot(page, `${view}-3-confirm`)
  await page.locator('.dlg-card button', { hasText: 'إلغاء' }).click()
  await page.waitForTimeout(200)
  ok(state.removed.length === 0, `${view}: «إلغاء» لا يحذف`)
  // من الكرت: تأكيد ⇒ POST على الحجز والسطر الصحيحين، ويختفي الإجراء من الكرت والشريط
  await page.locator('.dk-procs .dk-del-btn').click()
  await page.waitForSelector('.dlg-card')
  await page.locator('.dlg-card button', { hasText: 'حذف' }).click()
  await page.waitForFunction(() => !document.querySelector('.dk-procs .dk-del-btn'))
  ok(state.removed.length === 1 && state.removed[0].appt === AID && state.removed[0].line === '71', `${view}: POST remove للحجز ${AID} والسطر 71 (${JSON.stringify(state.removed)})`)
  const cardNames = await page.$$eval('.dk-procs .dk-proc', (l) => l.map((x) => x.textContent))
  ok(!cardNames.some((t) => /خياطة جرح/.test(t)) && cardNames.length === 2, `${view}: «خياطة جرح» اختفت من الكرت (${cardNames.join(' | ')})`)
  const toast = await page.textContent('.dk-toast-strip').catch(() => '')
  ok(/حُذف «خياطة جرح»/.test(toast), `${view}: إشعار «حُذف» (${toast})`)
  await shot(page, `${view}-4-after`)
  ok(errors.length === 0, `${view}: لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

async function hint(browser) {
  const { ctx, page } = await open(browser, 'laptop')
  await page.locator('.dk-proc-row button', { hasText: '+ مواد' }).click()
  await page.locator('.bs-body button', { hasText: 'خياطة جرح' }).first().click()
  await page.waitForSelector('.cons-hint')
  const t = await page.textContent('.cons-hint')
  ok(!/الحذف من الاستقبال/.test(t) && /تحذفه أنت/.test(t), `ورقة المواد: الحذف عند الطبيب لا الاستقبال (${t})`)
  await ctx.close()
}

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: HERE, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  await fetch(`${BASE}/src/main.jsx`).catch(() => {})
  const cr = await chromium.launch()
  for (const v of ['laptop', 'tablet', 'phone']) await flow(cr, v)
  await hint(cr)
  await cr.close()
  const wk = await webkit.launch()
  await flow(wk, 'phone')
  await wk.close()
  console.log(`\n${pass} ✓ · ${failures.length} ✖`)
  stop()
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
