// ═══════════════════════════════════════════════════════════════════
// «سعر المريض» على كل المرضى أو على المعاينات وحدها — في متصفّح حقيقي
//   npm run test:patient-scope    (PATIENT_SCOPE_SHOTS=/dir يحفظ اللقطات)
// الحساب نفسه مفحوص في server: npm run test:patient-scope
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PATIENT_SCOPE_TEST_PORT || 5264)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.PATIENT_SCOPE_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let pass = 0
const failures = []
const ok = (c, l, extra = '') => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`, extra); return false }

const ME = { adm: { role: 'clinic_admin', display_name: 'أم أسامة' }, mgr: { role: 'manager', display_name: 'فايز' },
  doc: { role: 'doctor', doctor_id: 1, display_name: 'د. ضياء' } }
const DOCTOR = { id: '1', name: 'د. ضياء الدين', specialty: 'عظمية', specialty_id: '1', phone: '', room: '1', consultation_fee: 150,
  followup_fee: 75, followup_window_days: 7, expected_visit_minutes: 15, hourly_buffer_minutes: null, is_active: true,
  accepts_urgent: true, schedules: [], share_kind: 'percent', share_value: 60 }
const PAY = (o = {}) => ({ pay_kind: 'mixed', amount: 100, daily_rate: 0, hourly_rate: 50, settle_cycle: 'monthly', patient_scope: 'all',
  updated_at: '2026-11-12T08:00:00Z', by_name: 'أم أسامة', history: [], ...o })
const SALARY = (scope) => ({ month: '2026-10', from: '2026-10-01', to: '2026-10-31', today: '2026-10-20',
  attendance: { days: 1, minutes: 240, hours: 4, noDeparture: 0, onDuty: 0 },
  salary: { kind: 'mixed', parts: ['patients', 'hours'], patientRate: 100, dailyRate: 0, hourlyRate: 50, rate: 100,
    patients: scope === 'consultation' ? 3 : 6, patientScope: scope, salaryPatients: scope === 'consultation' ? 300 : 600,
    salaryDays: null, salaryHours: 200, total: scope === 'consultation' ? 500 : 800 },
  days: [{ id: 1, date: '2026-10-05', start: '09:00', end: '14:00', arrived: '09:00', departed: '13:00', minutes: 240, state: 'complete' }] })

async function open(browser, { role = 'adm', path = '/clinic/doctors/1', w = 1366, h = 900, theme = 'light', pay = PAY(), scope = 'all' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript((t) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', t) }, theme)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const puts = []
  let state = pay
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (p === '/auth/me') return json(ME[role])
    if (p === '/clinic/doctors/1') return json(DOCTOR)
    if (p === '/clinic/doctors/1/pay' && req.method() === 'PUT') {
      const b = JSON.parse(req.postData() || '{}'); puts.push(b)
      const old = state
      state = { ...state, ...b, history: [{ id: String(state.history.length + 1), old_kind: old.pay_kind, old_amount: old.amount,
        old_daily_rate: old.daily_rate, old_hourly_rate: old.hourly_rate, old_cycle: old.settle_cycle, old_patient_scope: old.patient_scope,
        new_kind: b.pay_kind, new_amount: b.amount, new_daily_rate: b.daily_rate, new_hourly_rate: b.hourly_rate, new_cycle: b.settle_cycle,
        new_patient_scope: b.patient_scope, changed_at: '2026-11-12T09:00:00Z', by_name: 'أم أسامة' }, ...state.history] }
      return json({ ...b, changed: true })
    }
    if (p === '/clinic/doctors/1/pay') return json(state)
    if (p === '/clinic/my-salary') return json(SALARY(scope))
    if (p === '/clinic/my-share-rule') return json({ general: { kind: 'percent', value: 60 }, procedures: [] })
    if (p === '/clinic/my-work') return json({ period: 'today', from: '2026-10-01', to: '2026-10-20', patients: 0, procedures: 0, lines: [], total: 0, totals: {} })
    if (p === '/clinic/my-punctuality') return json({ error: 'off' }, 500)
    if (p === '/clinic/my-procedures') return json({ lines: [] })
    if (p === '/clinic/specialties') return json([{ id: '1', name: 'عظمية' }])
    return json([])
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, puts }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
const payCard = (page) => page.locator('#pf-pay')
const scopeLabel = (page, text) => payCard(page).locator('.pay-scope label', { hasText: text })
const saveBtn = (page) => payCard(page).locator('button', { hasText: 'حفظ الراتب' })

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  const browser = await chromium.launch()

  console.log('\n── ١) الخيار تحت «سعر المريض» ──')
  {
    const { ctx, page, errors, puts } = await open(browser)
    await payCard(page).locator('.pay-scope').waitFor({ timeout: 15000 })
    ok(await payCard(page).locator('.pay-scope label').count() === 2, '★ خياران تحت سعر المريض')
    ok(await scopeLabel(page, 'كل المرضى').evaluate((l) => l.classList.contains('on')), '★ المحفوظ «كل المرضى» مختار')
    ok(await payCard(page).locator('.pay-part').nth(0).locator('.pay-scope').count() === 1, 'الخيار داخل بطاقة المرضى')
    ok(await payCard(page).locator('.pay-part').nth(2).locator('.pay-scope').count() === 0, 'ولا يظهر تحت الساعات')
    ok((await payCard(page).textContent()).includes('معاينة ومراجعة و«إجراء فقط»'), 'الشرح: كلّ زيارةٍ انتهت تُعدّ')
    ok(await saveBtn(page).isDisabled(), 'الحفظ معطّل بلا تغيير')
    await shot(page, 'all')
    await scopeLabel(page, 'المعاينات فقط').click()
    ok(await saveBtn(page).isEnabled(), '★ تغيير الخيار يفتح الحفظ')
    const f = await payCard(page).locator('.pay-formula').textContent()
    ok(f.includes('المعاينات ×') && f.includes('٢٠ معاينة'), '★ المعادلة: المعاينات × السعر، والمثال «٢٠ معاينة»', f)
    ok((await payCard(page).textContent()).includes('لا تُعدّ المراجعات'), 'الشرح يتبدّل: لا مراجعات ولا «إجراء فقط»')
    ok(await payCard(page).locator('.share-warn', { hasText: 'الأشهر الماضية' }).count() === 1, '★ تنبيه: يغيّر حساب الأشهر الماضية')
    await shot(page, 'consultation-dirty')
    await saveBtn(page).click()
    await payCard(page).locator('.badge', { hasText: 'معاينات + ساعات' }).waitFor()
    ok(puts.length === 1 && puts[0].patient_scope === 'consultation' && puts[0].amount === 100 && puts[0].hourly_rate === 50,
      '★ الحفظ يرسل patient_scope=consultation مع الأسعار', JSON.stringify(puts))
    ok(await payCard(page).locator('.share-warn', { hasText: 'الأشهر الماضية' }).count() === 0, 'التنبيه يزول بعد الحفظ')
    ok(await saveBtn(page).isDisabled(), 'والحفظ يعود معطّلاً')
    await payCard(page).locator('.pf-history summary').click()
    const hist = await payCard(page).locator('.change-log li').first().textContent()
    ok(hist.includes('للمريض') && hist.includes('للمعاينة'), '★ السجلّ: «للمريض» ← «للمعاينة»', hist)
    ok(!(await page.locator('.toast, [role=status]').allTextContents()).some((t) => t.includes('للمريض + ')), 'الإشعار بصيغة المعاينة')
    // إلغاء المرضى: الخيار يختفي ولا يُرسل
    await payCard(page).locator('.pay-part').nth(0).locator('.pay-part-toggle').click()
    ok(await payCard(page).locator('.pay-scope').count() === 0, 'إلغاء المرضى يخفي الخيار')
    await saveBtn(page).click()
    await page.waitForTimeout(400)
    ok(puts[1]?.amount === 0 && puts[1]?.patient_scope === 'all', 'بلا مرضى يُرسل all', JSON.stringify(puts[1]))
    ok(errors.length === 0, `بلا أخطاء (${errors[0] || ''})`)
    await ctx.close()
  }

  console.log('\n── ٢) الاطّلاع (المدير المسؤول) و«راتبي» ──')
  {
    const { ctx, page } = await open(browser, { role: 'mgr', pay: PAY({ patient_scope: 'consultation' }) })
    await payCard(page).locator('.pay-readonly').waitFor({ timeout: 15000 })
    const t = await payCard(page).locator('.pay-readonly').textContent()
    ok(t.includes('معاينات + ساعات') && t.includes('للمعاينة'), '★ المدير يرى «معاينات + ساعات — … للمعاينة»', t)
    ok(await payCard(page).locator('.pay-scope').count() === 0, 'ولا خيار قابل للتغيير')
    await ctx.close()
  }
  for (const [scope, qty, rest] of [['consultation', /(٣|3) معاينات/, 'مريض'], ['all', /(٦|6) مرضى/, 'معاينة']]) {
    const { ctx, page, errors } = await open(browser, { role: 'doc', path: '/clinic/my-work', scope })
    await page.locator('.dk-sal-calc').waitFor({ timeout: 15000 })
    const c = await page.locator('.dk-sal-calc').textContent()
    ok(qty.test(c) && !c.includes(rest), `★ «راتبي» (${scope}): ${qty}`, c)
    ok(errors.length === 0, `بلا أخطاء (${errors[0] || ''})`)
    await ctx.close()
  }

  console.log('\n── ٣) الجوال والوضع الليلي ──')
  for (const [w, theme] of [[390, 'light'], [390, 'dark'], [1366, 'dark']]) {
    const { ctx, page } = await open(browser, { w, h: 844, theme })
    await payCard(page).locator('.pay-scope').waitFor({ timeout: 15000 })
    await scopeLabel(page, 'المعاينات فقط').click()
    ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1), `بلا تمرير أفقي ${w} ${theme}`)
    if (w === 390) {
      const hs = await payCard(page).locator('.pay-scope label').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().height))
      ok(hs.length === 2 && hs.every((x) => x >= 44), `زرّا الخيار ≥ 44px على الجوال (${hs.join(',')})`)
      const one = await payCard(page).locator('.pay-scope label').evaluateAll((ls) => ls.every((l) => l.getClientRects().length === 1))
      ok(one, 'كلّ زرٍّ في سطرٍ واحد')
    }
    const onBg = await scopeLabel(page, 'المعاينات فقط').evaluate((l) => getComputedStyle(l).backgroundColor)
    ok(onBg !== 'rgba(0, 0, 0, 0)', `المختار ملوّن ${w} ${theme}`)
    await shot(page, `scope-${w}-${theme}`)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${failures.length ? '✖' : '✔'} patient-scope: ${pass} نجح، ${failures.length} فشل`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
