// ═══════════════════════════════════════════════════════════════════
// لوحة العيادات: زرّ التوليد وجلسة المعتذر — في متصفّح حقيقي بردود خادم مُحاكاة
//
// يُشغَّل بـ: npm run test:generate-board
//   ١) ملخّص الردّ: جديدة · موجودة مسبقاً · معتذر · خارج دوره
//   ٢) الزرّ يسمّي اليوم المختار ويطلبه هو، لا تاريخ اليوم الحقيقي
//   ٣) جلسة معتذر عليه حجوزات: «معتذر» لا «مفتوحة»، والسليم كما هو
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { addDays, dayLabel, todayLocal } from '../src/api.js'
import { generateLabel, generateSummary } from '../src/generate-summary.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.GENERATE_TEST_PORT || 5243)
const BASE = `http://127.0.0.1:${PORT}`
const ME = { id: '2', username: 'adm', display_name: 'مشرفة', role: 'clinic_admin', board_member_id: null, is_chairman: false, member_title: null }

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  ✔ ${label}`) } else { failures.push(label); console.log(`  ✖ ${label} ${extra}`) } }

console.log('\n── ١) ملخّص الردّ ──')
const D = '2026-11-04' // الأربعاء
ok(generateLabel(D) === 'توليد جلسات الأربعاء 4/11', 'الزرّ يسمّي اليوم', generateLabel(D))
ok(generateLabel('') === 'توليد الجلسات', 'حقل تاريخ ممسوح لا يكسر الزرّ')
const sum = (r) => generateSummary(D, r)
ok(sum({ created: [{}, {}, {}] }) === 'جلسات جديدة ليوم الأربعاء 4/11: 3', 'جديدة وحدها', sum({ created: [{}, {}, {}] }))
const noop = sum({ created: [], skipped: 2, skipped_apology: 1, skipped_off_week: 1 })
ok(noop === 'لا جلسات جديدة ليوم الأربعاء 4/11 — موجودة مسبقاً: 2، معتذر: 1، خارج دوره: 1', '★ كبسةٌ بلا أثر تقول إنها بلا أثر ولماذا', noop)
ok(sum({ created: [] }) === 'لا جلسات جديدة ليوم الأربعاء 4/11', 'لا دوام أصلاً')

const session = (o) => ({ id: 1, doctor_id: 1, doctor_name: 'د. سليم', specialty: 'عام', start_time: '09:00:00', end_time: '13:00:00',
  flow_mode: 'attendance', status: 'open', closed: false, active_count: 0, total_count: 0, apologized: false, manual_closed_at: null, ...o })

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test') })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const generated = []
  let dayDoctorsCalls = 0
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api/, '')
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(ME)
    if (p === '/clinic/sessions/generate') {
      generated.push(route.request().postDataJSON().date)
      return json({ created: [], skipped: 1, skipped_apology: 1, skipped_off_week: 0 }, 201)
    }
    if (p === '/clinic/sessions') return json([
      session({}),
      session({ id: 2, doctor_id: 2, doctor_name: 'د. معتذر', apologized: true, active_count: 2, total_count: 2 }),
    ])
    if (p === '/clinic/day-doctors') dayDoctorsCalls++
    if (p === '/clinic/day-doctors') return json({ date: url.searchParams.get('date'), weekday: 3, doctors: [] })
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}/clinic/board`, { waitUntil: 'load' })
  await page.waitForSelector('table.rtable tbody tr', { timeout: 15000 })

  console.log('\n── ٢) الزرّ واليوم المختار ──')
  const today = todayLocal()
  const pick = addDays(today, 2)
  const { weekday, day, month } = dayLabel(pick)
  await page.locator('.day-chip').nth(2).click()
  const btn = page.locator('.board-head-actions button', { hasText: 'توليد' })
  await page.waitForTimeout(200)
  ok((await btn.textContent()) === `توليد جلسات ${weekday} ${day}/${month}`, '★ نصّ الزرّ يتبع اليوم المختار', await btn.textContent())
  const before = dayDoctorsCalls
  await btn.click()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(200)
  ok(dayDoctorsCalls > before, '★ «دكاترة اليوم» تُقرأ من جديد بعد التوليد')
  ok(generated.join() === pick, '★ التوليد طُلب لليوم المختار لا لليوم الحقيقي', generated.join())
  const toast = await page.locator('.toast').textContent()
  ok(toast.includes(`${weekday} ${day}/${month}`) && toast.includes('موجودة مسبقاً: 1') && toast.includes('معتذر: 1'), '★ النتيجة تظهر مع اليوم والسبب', toast)
  ok(await page.locator('.toast-info').count() === 1, 'كبسةٌ بلا جديد: info لا success')

  console.log('\n── ٣) جلسة المعتذر في الجدول ──')
  const row = (name) => page.locator('table.rtable tbody tr', { hasText: name })
  const healthy = row('د. سليم'), excused = row('د. معتذر')
  ok((await healthy.locator('.rt-badge').textContent()).includes('مفتوحة'), 'السليم «مفتوحة» كما كان')
  ok(!(await healthy.getAttribute('class')).includes('row-faded'), 'والسليم غير باهت')
  const badge = await excused.locator('.rt-badge').textContent()
  ok(badge.includes('معتذر') && !badge.includes('مفتوحة'), '★ المعتذر «معتذر» لا «مفتوحة»', badge)
  ok((await excused.getAttribute('class')).includes('row-faded'), 'والسطر باهت')
  ok(await excused.getByRole('button', { name: 'فتح الدور' }).count() === 1, 'ويبقى الوصول إلى حجوزاته')

  await page.setViewportSize({ width: 390, height: 800 })
  await page.waitForTimeout(200)
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok(wide <= 0, 'الزرّ بنصّه الأطول لا يمدّ الصفحة على الجوال', `${wide}px`)

  ok(errors.length === 0, 'لا أخطاء في الصفحة', errors.join(' | '))
  await browser.close(); stop()
  console.log(`\n${failures.length === 0 ? '✔' : '✖'} ${pass} نجح، ${failures.length} فشل`)
  process.exit(failures.length === 0 ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(1) })
