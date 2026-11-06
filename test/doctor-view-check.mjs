// ═══════════════════════════════════════════════════════════════════
// «راتبي وحضوري» + «إضافة اختصاص» + «معتذر» + عنوان لوحة المدير — في متصفّح حقيقي
//   npm run test:doctor-view    (DOCTOR_VIEW_SHOTS=/dir يحفظ اللقطات)
// عقد الردود مفحوص في server: npm run test:doctor-view
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.DOCTOR_VIEW_TEST_PORT || 5254)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.DOCTOR_VIEW_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let pass = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`); return false }

const ME = {
  doc: { role: 'doctor', doctor_id: 1, display_name: 'د. خالد' }, adm: { role: 'clinic_admin', display_name: 'أم أسامة' },
  mgr: { role: 'manager', display_name: 'فايز' }, sup: { role: 'super_admin', display_name: 'المشرف' },
  chair: { role: 'board', is_chairman: true, board_member_id: 1, display_name: 'الرئيس' }, brd: { role: 'board', is_chairman: false, board_member_id: 2, display_name: 'عضو' },
}
const day = (date, arrived, departed, minutes, state) => ({ id: date, date, start: '09:00', end: '14:00', arrived, departed, minutes, state })
const FULL = { month: '2026-10', from: '2026-10-01', to: '2026-10-31', today: '2026-10-20',
  attendance: { days: 5, minutes: 840, hours: 14, noDeparture: 1, onDuty: 0 },
  salary: { kind: 'daily_hourly', dailyRate: 50000, hourlyRate: 10000, salaryDays: 250000, salaryHours: 140000, total: 390000 },
  days: [day('2026-10-12', '09:00', null, null, 'no_departure'), day('2026-10-05', '09:00', '12:00', 180, 'complete')] }
const UNSET = { ...FULL, salary: null }
const SEP = { ...FULL, month: '2026-09', attendance: { days: 0, minutes: 0, hours: 0, noDeparture: 0, onDuty: 0 }, salary: null, days: [] }
const DOCTOR = { id: '1', name: 'د. خالد', specialty: 'عظمية', specialty_id: '1', phone: '', room: '1', consultation_fee: 2000, followup_fee: 1000, followup_window_days: 7, expected_visit_minutes: 15, hourly_buffer_minutes: null, is_active: true, accepts_urgent: true, schedules: [], share_kind: 'percent', share_value: 50 }
const SESSION = (o) => ({ id: 1, start_time: '09:00:00', end_time: '14:00:00', status: 'open', active_count: 0, flow_mode: 'attendance', apologized: false, ...o })
const BOARD = { view: 'board', families: 1, persons: 1, requests: 1, byStatus: [], vouchersCount: 0, vouchersTotal: 0, myQueue: [], myReviewsCount: 0, readyForDecision: [], todaySessions: [], doctorsCount: 1 }

async function open(browser, { role = 'doc', path = '/clinic/my-work', w = 1366, h = 800, theme = 'light', salary = FULL, sessions = [SESSION({})], dashboard = BOARD } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  // العنوان المفحوص في لوحة المساعدات — ومن له قسمان (لوحة القيادة) يبدأ بها بهذا الاختيار
  await ctx.addInitScript((t) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', t); localStorage.setItem('dashboard-section', 'aid') }, theme)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const calls = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname.replace(/^\/api/, '')
    calls.push(`${p}${url.search}`)
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (p === '/auth/me') return json(ME[role])
    if (p === '/clinic/my-share-rule') return json({ general: { kind: 'percent', value: 40 }, procedures: [{ name: 'خياطة', kind: 'fixed', value: 20000 }] })
    if (p === '/clinic/my-salary') return json(url.searchParams.get('month') === '2026-09' ? SEP : salary)
    if (p === '/clinic/my-work') return json({ period: url.searchParams.get('period'), from: '2026-10-01', to: '2026-10-20', patients: 0, procedures: 0, lines: [], total: 0, totals: {} })
    if (p === '/clinic/my-punctuality') return json({ error: 'off' }, 500)
    if (p === '/clinic/my-procedures') return json({ lines: [] })
    if (p === '/clinic/my-sessions') return json(sessions)
    if (p.match(/^\/clinic\/sessions\/\d+\/queue$/)) return json({ session: { flow_mode: 'attendance' }, appointments: [], server_now: new Date().toISOString() })
    if (p === '/clinic/doctors/1') return json(DOCTOR)
    if (p === '/clinic/doctors/1/pay') return json({ pay: null, history: [] })
    if (p === '/clinic/specialties') return json([{ id: '1', name: 'عظمية' }])
    if (p === '/dashboard') return json(dashboard)
    return json([])
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
const has = async (page, sel) => !!(await page.$(sel))

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  const browser = await chromium.launch()

  console.log('\n── ١) راتبي وحضوري ──')
  {
    const { ctx, page, calls, errors } = await open(browser)
    await page.waitForSelector('.dk-sal-calc')
    const t = await page.textContent('.dk-salary')
    ok(t.includes('٣٩٠'), '★ الراتب ٣٩٠٬٠٠٠')
    ok(t.includes('٥ أيام × ٥٠') && t.includes('١٤ ساعة × ١٠'), '★ الحساب: يومية × أيام + ساعة × ساعات')
    ok(t.includes('انصراف غير مسجَّل') && await has(page, '.dk-salary tr.dt-row-warn .badge.warn'), '★ يوم بلا انصراف معلَّم')
    ok(!/حصّة الشفاء|الربح|خسارة|تحاسبه/.test(t), '★ لا حصّة ولا فرق ولا دورة')
    await page.waitForSelector('.dk-rule-list li')
    const ruleTxt = await page.textContent('.dk-rule')
    ok(ruleTxt.includes('٤٠٪') && ruleTxt.includes('خياطة') && /٢٠٬?٠٠٠/.test(ruleTxt), '★ «قاعدة حصّتي»: العامّة والخاصّة', ruleTxt)
    ok(await page.locator('.dk-rule :is(input, select, button)').count() === 0, '★ عرضٌ بلا أيّ حقل أو زرّ تعديل')
    ok(!/الشفاء|مستهلك|سعر/.test(ruleTxt), '★ بلا شفاء ولا مستهلكات ولا سعر')
    ok(await page.$eval('.dk-sal-month button[aria-label="الشهر التالي"]', (b) => b.disabled), 'لا شهر بعد الجاري')
    ok(!/·\s*[٠-٩]|[٠-٩]\s*·/.test(t), 'لا «·» بجانب رقم')
    await shot(page, 'salary-light')
    await page.click('.dk-sal-month button[aria-label="الشهر السابق"]')
    await page.waitForFunction(() => document.querySelector('.dk-sal-month span')?.textContent === '2026-09')
    ok(calls.includes('/clinic/my-salary?month=2026-09'), 'الشهر السابق يُطلب')
    const t2 = await page.textContent('.dk-salary')
    ok(t2.includes('لا حضور مسجَّل') && t2.includes('لا أيام') && !t2.includes('٠'), '★ الفراغ جملة لا «٠»')
    ok(errors.length === 0, `بلا أخطاء (${errors[0] || ''})`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { salary: UNSET })
    await page.waitForSelector('.dk-sal-unset')
    ok((await page.textContent('.dk-sal-unset')).trim() === 'لم تُحدد إعدادات الراتب بعد', '★ الرسالة حرفياً')
    ok(!await has(page, '.dk-sal-calc'), 'بلا حساب')
    ok((await page.textContent('.dk-salary')).includes('انصراف غير مسجَّل'), 'والحضور يبقى ظاهراً')
    await shot(page, 'salary-unset')
    await ctx.close()
  }
  for (const [w, theme] of [[390, 'light'], [390, 'dark'], [1366, 'dark']]) {
    const { ctx, page } = await open(browser, { w, h: 844, theme })
    await page.waitForSelector('.dk-sal-calc')
    ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1), `بلا تمرير أفقي ${w} ${theme}`)
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.dk-salary')).direction) === 'rtl', 'RTL')
    await shot(page, `salary-${w}-${theme}`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { role: 'adm', path: '/clinic/my-work' })
    await page.waitForTimeout(500)
    ok(!await has(page, '.dk-salary'), '★ المشرفة لا تدخل صفحة الطبيب')
    await ctx.close()
  }

  console.log('\n── ٢) إضافة اختصاص ──')
  // بعد استقرار الصفحة: لوحةٌ منهارة تُخفي الزرّ أيضاً، فالحقل نفسه وغياب الأخطاء شرطان للفحص
  const profile = async (role) => {
    const { ctx, page, errors } = await open(browser, { role, path: '/clinic/doctors/1' })
    await page.waitForSelector('.spec-row')
    await page.waitForTimeout(600)
    const r = { field: await has(page, '.spec-row select'), add: await has(page, '.spec-add'), errors }
    await ctx.close()
    return r
  }
  for (const role of ['mgr', 'chair', 'sup', 'brd']) {
    const r = await profile(role)
    ok(r.field && r.errors.length === 0, `${role}: الحقل ظاهر بلا أخطاء (${r.errors[0] || ''})`)
    ok(!r.add, `★ ${role}: بلا الزرّ`)
  }
  {
    const r = await profile('adm')
    ok(r.field && r.errors.length === 0, `المشرفة: الحقل ظاهر بلا أخطاء (${r.errors[0] || ''})`)
    ok(r.add, '★ المشرفة: الزرّ باقٍ')
  }

  console.log('\n── ٣) معتذر ──')
  {
    const { ctx, page } = await open(browser, { path: '/clinic/doctor', sessions: [SESSION({ apologized: true })] })
    await page.waitForSelector('.dk-apology')
    ok((await page.textContent('.dk-apology .badge')) === 'معتذر', '★ بشارة «معتذر» في شاشته')
    await shot(page, 'apology')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: '/clinic/doctor' })
    await page.waitForSelector('.dk-top')
    ok(!await has(page, '.dk-apology'), 'جلسة عادية بلا بشارة')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: '/clinic/doctor', sessions: [SESSION({ id: 1, apologized: true }), SESSION({ id: 2, start_time: '15:00:00', end_time: '18:00:00' })] })
    await page.waitForSelector('.dk-top-tools select')
    ok((await page.textContent('.dk-top-tools select')).includes('(معتذر)'), 'وفي قائمة الجلسات')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: '/', dashboard: { view: 'doctor', mySessions: [SESSION({ apologized: true })] } })
    await page.waitForSelector('td .badge')
    ok((await page.textContent('td .badge')) === 'معتذر', '★ وفي لوحته الرئيسية')
    await ctx.close()
  }

  console.log('\n── ٤) العنوان ──')
  for (const [role, want] of [['mgr', 'مدير (اطّلاع فقط)'], ['chair', 'المدير المسؤول'], ['brd', 'عضو مجلس الإدارة']]) {
    const { ctx, page } = await open(browser, { role, path: '/' })
    await page.waitForSelector('h2')
    ok((await page.textContent('h2')) === `لوحة القيادة — ${want}`, `★ ${role}: ${want} (${await page.textContent('h2')})`)
    await ctx.close()
  }

  await browser.close(); stop()
  console.log(`\n═══ شاشة الطبيب: ${pass} ✔ · ${failures.length} ✘ ═══`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
