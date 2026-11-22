// ═══════════════════════════════════════════════════════════════════
// كشف الأجور: لا PDF ولا Excel قبل انصراف الطبيب (2026-11-22، كشف نور خولاني نزل ناقص ساعات اليوم)
//   npm run test:payroll-open    (PAYROLL_SHOTS=/dir يحفظ اللقطات)
// المشرفة: يومٌ ماضٍ بلا انصراف ⇒ القائمة تعلّمه و«للكلّ» متوقّف، والكشف مقفول ⇒ «سجّل الانصراف» بوقتٍ ⇒ يُفتح.
// الاستقبال: دوام اليوم ⇒ «سجّل الانصراف» الآن ⇒ يُفتح. الأرقام من خادمٍ حقيقي (fixtures من test:payroll).
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PAYROLL_TEST_PORT || 5264)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.PAYROLL_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/payroll-open-day.json'), 'utf8'))
const ME = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/visit-page.json'), 'utf8')).me
let pass = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`); return false }
const clone = (o) => JSON.parse(JSON.stringify(o))
const pad = (v) => String(v).padStart(2, '0')
const d = new Date(); const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function open(browser, { role, open: day, w = 1366, h = 800, path }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const state = { open: [day], writes: [], exports: 0 }
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    const openNow = state.open.filter(Boolean)
    if (p === '/auth/me') return json(ME[role])
    if (p === '/clinic/payroll') {
      const l = clone(FX.list); if (role === 'reception') { l.from = l.to = TODAY }
      l.doctors.forEach((x) => { x.openDays = x.doctorId === '1' ? openNow : [] }); return json(l)
    }
    if (p === '/clinic/payroll/export') { state.exports++; return json({ error: 'x', code: 'OPEN_DAYS' }, 409) }
    if (p === '/clinic/payroll/1') {
      const st = clone(FX.statement); if (role === 'reception') { st.from = st.to = TODAY }
      st.warnings.openDays = openNow; return json(st)
    }
    const m = /^\/clinic\/sessions\/(\d+)\/(doctor-times|doctor-departed)$/.exec(p)
    if (m && ['PUT', 'POST'].includes(req.method())) {
      state.writes.push({ method: req.method(), path: p, body: req.postDataJSON?.() ?? null })
      state.open = []; return json({ id: m[1] })
    }
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, state }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
const btn = (page, name) => page.locator('.pr-toolbar-end button', { hasText: name })

async function admin(browser) {
  console.log('\n── المشرفة: يومٌ ماضٍ بلا انصراف ──')
  const day = { sessionId: '7', date: '2026-10-07', arrived: '10:00' }
  const { ctx, page, errors, state } = await open(browser, { role: 'umosama', open: day, path: '/clinic/payroll?from=2026-10-01&to=2026-10-31' })
  await page.waitForSelector('.pr-doctors')
  ok(await page.locator('.pr-doctors .pr-flag', { hasText: 'بلا انصراف' }).count() === 1, 'القائمة: «بلا انصراف» بجانب الطبيب')
  const banner = await page.textContent('.pr-open').catch(() => '')
  ok(/«للكلّ» متوقّف/.test(banner) && /د\. سامر الحلبي/.test(banner) && /وصل 10:00/.test(banner), `القائمة: «للكلّ» متوقّف باسمه ويومه (${banner})`)
  ok(await btn(page, 'Excel للكلّ').isDisabled() && await btn(page, 'PDF للكلّ').isDisabled(), '«Excel للكلّ» و«PDF للكلّ» مقفولان')
  await shot(page, 'admin-1-list')
  await page.locator('.pr-open-btn', { hasText: 'افتح كشفه' }).click()
  await page.waitForSelector('.pr-statement')
  const box = await page.textContent('.pr-statement .pr-open')
  ok(/لا PDF ولا Excel قبل انصراف الطبيب/.test(box) && /وصل 10:00 ولم يُسجَّل انصرافه/.test(box), `الكشف: الصندوق الأحمر (${box})`)
  ok(await btn(page, 'Excel').first().isDisabled() && await btn(page, 'تنزيل PDF').isDisabled(), 'الكشف: Excel وPDF مقفولان')
  ok(!/يوم بلا انصراف مسجَّل/.test(await page.textContent('.pr-statement')), 'لا تكرار: سطر «يوم بلا انصراف» القديم غائب')
  await shot(page, 'admin-2-locked')
  await page.locator('.pr-open-btn', { hasText: 'سجّل الانصراف' }).click()
  await page.waitForSelector('.dlg-input')
  ok(await page.inputValue('.dlg-input') === '', 'يومٌ ماضٍ: الوقت فارغ لا «الآن»')
  await page.fill('.dlg-input', '11:00')
  await shot(page, 'admin-3-prompt')
  await page.locator('.dlg-actions button', { hasText: 'سجّل الانصراف' }).click()
  await page.waitForFunction(() => !document.querySelector('.pr-statement .pr-open'))
  const w = state.writes[0]
  ok(state.writes.length === 1 && w.method === 'PUT' && w.path === '/clinic/sessions/7/doctor-times' && w.body.departure === '11:00' && !!w.body.reason,
    `الطلب: PUT doctor-times بالوقت والسبب (${JSON.stringify(state.writes)})`)
  ok(!(await btn(page, 'تنزيل PDF').isDisabled()) && !(await btn(page, 'Excel').first().isDisabled()), 'بعد الانصراف: Excel وPDF مفتوحان')
  await shot(page, 'admin-4-unlocked')
  ok(state.exports === 0, 'لم يُطلب ملفٌّ وهو مقفول')
  ok(errors.length === 0, `لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

async function reception(browser, w) {
  console.log(`\n── الاستقبال: دوام اليوم (${w}px) ──`)
  const day = { sessionId: '9', date: TODAY, arrived: '13:07' }
  const { ctx, page, errors, state } = await open(browser, { role: 'reception', open: day, w, h: w < 800 ? 900 : 800, path: '/clinic/payroll?doctor=1' })
  await page.waitForSelector('.pr-statement .pr-open')
  const box = await page.textContent('.pr-statement .pr-open')
  ok(/\(اليوم\)/.test(box) && /وصل 13:07/.test(box), `الصندوق: دوام اليوم (${box})`)
  ok(await btn(page, 'تنزيل PDF').isDisabled(), 'PDF مقفول')
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'لا تمرير أفقي')
  await shot(page, `reception-${w}-1-locked`)
  await page.locator('.pr-open-btn', { hasText: 'سجّل الانصراف' }).click()
  ok(await page.locator('.dlg-input').count() === 0, 'الاستقبال: تأكيدٌ لا حقل وقت')
  await page.locator('.dlg-actions button', { hasText: 'سجّل الانصراف' }).click()
  await page.waitForFunction(() => !document.querySelector('.pr-statement .pr-open'))
  ok(state.writes.length === 1 && state.writes[0].method === 'POST' && state.writes[0].path === '/clinic/sessions/9/doctor-departed',
    `الطلب: POST doctor-departed (${JSON.stringify(state.writes)})`)
  ok(!(await btn(page, 'تنزيل PDF').isDisabled()), 'بعد الانصراف: PDF مفتوح')
  ok(errors.length === 0, `لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  await fetch(`${BASE}/src/main.jsx`).catch(() => {})
  const br = await chromium.launch()
  await admin(br)
  await reception(br, 1366)
  await reception(br, 390)
  await br.close()
  console.log(`\n${pass} ✓ · ${failures.length} ✖`)
  stop()
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
