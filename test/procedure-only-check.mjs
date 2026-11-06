// ═══════════════════════════════════════════════════════════════════
// زيارة «إجراء فقط» في متصفّح حقيقي
//
// يُشغَّل بـ: npm run test:procedure-only
//
// الردود من لقطات الخادم الحقيقي (visit-page.json و cash-report.json) بتعديل النوع والأجر، فلا
// خادم ولا قاعدة هنا. نفحص: خيار الحجز وما يُرسله · بلا تمرير أفقي (الراديو المخفيّ مدّ الصفحة
// مرّة) · الطابور والزيارة وقفل النوع · شارة الطبيب · البطاقتان (HTML والوسيط) بلا سطر كشفية ·
// الجرد لا يعدّها كشوفاً · قسم «انتهت بلا إجراء» في المراجعة.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PROC_ONLY_TEST_PORT || 5239)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/visit-page.json'), 'utf8'))
const CASH = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/cash-report.json'), 'utf8'))
const PO = 'procedure_only'

let pass = 0
const failures = []
const ok = (c, label) => { if (c) { pass++; console.log(`  ✔ ${label}`) } else { failures.push(label); console.log(`  ✖ ${label}`) } }
const clone = (o) => JSON.parse(JSON.stringify(o))
const SID = FX.states.arrived.session
const base = () => FX.queues[SID].appointments.find((a) => String(a.id) === String(FX.states.arrived.appt))
const proc = { id: 900, procedure_id: 1, name: 'تخطيط أعصاب', price: 60000, patient_price: 60000, referral_discount: 0, materials: [], added_at: '2026-10-25T05:00:00Z', paid_at: '2026-10-25T05:00:00Z' }
// صفّ بالشكل الذي يرسله الخادم: الأجر صفر و«المطلوب» إجراءاته
const row = (id, status, type, procedures = []) => {
  const liveTotal = procedures.reduce((s, p) => s + p.price, 0)
  const fee = type === PO ? 0 : 25000
  return { ...clone(base()), id: String(id), status, visit_type: type, fee: `${fee}.00`, patient_fee: fee, referrals: [], referral_discount: 0,
    procedures, procedures_total: liveTotal, total: fee + liveTotal, patient_total: fee + liveTotal,
    full_name: `مريض رقم ${id}`, followup_override_by: null }
}
const R = { poWaiting: row(101, 'waiting', PO), poArrived: row(102, 'arrived', PO), poProc: row(103, 'in_service', PO, [proc]),
  poEmptyDone: row(104, 'done', PO), regArrived: row(105, 'arrived', 'consultation'), regWaiting: row(106, 'waiting', 'consultation'),
  poServing: row(107, 'in_service', PO) }
const queue = () => ({ ...clone(FX.queues[SID]), appointments: Object.values(R) })

async function mockApi(page, { role = 'reception', on = {} } = {}) {
  const calls = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname.replace(/^\/api/, '')
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    calls.push({ p, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null })
    if (on[p]) return json(on[p](url))
    if (p === '/auth/me') return json(FX.me[role])
    if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json(queue())
    if (p === '/clinic/my-sessions') return json([{ ...FX.queues[SID], id: SID }])
    if (p === '/clinic/procedures') return json(FX.procedures)
    if (p === '/clinic/materials') return json(FX.materials)
    if (p === '/clinic/referral-sources/options') return json(FX.referral_sources || [])
    if (/estimate-preview/.test(p)) return json({ estimated_time: '10:30:00' })
    if (/^\/clinic\/sessions\/\d+\/appointments$/.test(p) && req.method() === 'POST')
      return json({ ...row(201, 'waiting', PO), queue_number: 9 }, 201)
    if (/\/details$/.test(p)) return json({})
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    if (/\/history$/.test(p)) return json([])
    return json([])
  })
  return calls
}
async function open(browser, path, { w = 1366, h = 900, ...mock } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript(() => localStorage.setItem('token', 'test'))
  const page = await ctx.newPage()
  const calls = await mockApi(page, mock)
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, calls }
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const textOf = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')

async function run() {
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid) } catch { /* انتهى */ } }
  process.on('exit', stop)
  for (let i = 0; i < 60; i++) {
    if (await fetch(BASE).then(() => true).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const browser = await chromium.launch()

  console.log('\n── ١) الحجز: الخيار وما يُرسله ──')
  for (const [w, h] of [[1366, 900], [390, 844]]) {
    const { ctx, page, calls } = await open(browser, `/clinic/session/${SID}`, { w, h })
    await page.click('text=+ حجز جديد')
    await page.waitForSelector('.bf-kind')
    ok(await page.locator('.bf-kind input:checked').evaluate((i) => i.parentElement.innerText.includes('زيارة عادية')), `${w}: الافتراضي «زيارة عادية»`)
    ok(await page.locator('.booking-form label', { hasText: 'نوع الزيارة' }).count() === 1, `${w}: معاينة/مراجعة ظاهرة للعادية`)
    ok(await noOverflow(page), `${w}: بلا تمرير أفقي والنموذج مفتوح`)
    await page.click('.bf-kind label:has-text("إجراء فقط")')
    ok(await page.locator('.booking-form label', { hasText: 'نوع الزيارة' }).count() === 0, `${w}: «إجراء فقط» تخفي معاينة/مراجعة`)
    ok((await textOf(page.locator('.bf-kind'))).includes('لا كشفية'), `${w}: وتقول لا كشفية`)
    ok(await noOverflow(page), `${w}: بلا تمرير أفقي بعد الاختيار`)
    await page.fill('.booking-form input[placeholder="الاسم واسم الأب والكنية"]', 'نور أحمد الحلبي')
    await page.click('.booking-form button[type=submit]')
    await page.waitForTimeout(400)
    const sent = calls.find((c) => /\/appointments$/.test(c.p) && c.method === 'POST')
    ok(sent?.body?.visit_type === PO, `${w}: الطلب يحمل visit_type=${sent?.body?.visit_type}`)
    ok(!('fee' in (sent?.body || {})), `${w}: والأجر لا يُرسَل من الواجهة`)
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, `/clinic/session/${SID}`)
    await page.click('text=+ حجز جديد')
    await page.waitForSelector('.bf-kind')
    await page.click('.bf-kind label:has-text("إجراء فقط")')
    await page.click('.bf-kind label:has-text("زيارة عادية")')
    await page.fill('.booking-form input[placeholder="الاسم واسم الأب والكنية"]', 'سامر خالد العمر')
    await page.click('.booking-form button[type=submit]')
    await page.waitForTimeout(400)
    ok(calls.find((c) => /\/appointments$/.test(c.p) && c.method === 'POST')?.body?.visit_type === 'consultation', 'الرجوع إلى «عادية» يرسل معاينة')
    await ctx.close()
  }

  console.log('\n── ٢) الطابور ──')
  {
    const { ctx, page } = await open(browser, `/clinic/session/${SID}?tab=all`)
    await page.waitForSelector(`text=${R.poArrived.full_name}`)
    const rowOf = (a) => textOf(page.locator(`tr:has-text("${a.full_name}")`).first())
    const po = await rowOf(R.poArrived)
    ok(po.includes('إجراء فقط') && po.includes('بلا كشفية'), `صفّ «إجراء فقط»: ${po.slice(0, 80)}`)
    const withProc = await rowOf(R.poProc)
    ok(withProc.includes('إجراءات') && withProc.includes('خذي') && !withProc.includes('زيادة'), '★ بإجراء: «خذي» المبلغ بلا كلمة «زيادة» (لا كشفية يزيد عليها)')
    const reg = await rowOf(R.regArrived)
    ok(reg.includes('معاينة') && !reg.includes('إجراء فقط') && !reg.includes('بلا كشفية'), '★ العادية كما هي')
    const empty = await rowOf(R.poEmptyDone)
    ok(empty.includes('بلا إجراء'), 'المنتهية بلا إجراء: شارة تحذير')
    ok(!(await rowOf(R.poServing)).includes('بلا إجراء'), 'والجارية لا تحذير عليها')
    await ctx.close()
  }

  console.log('\n── ٣) صفحة الزيارة: المبلغ وقفل النوع ──')
  const visit = (a) => `/clinic/session/${SID}/visit/${a.id}`
  const editOptions = async (page) => {
    await page.locator('.visit-patient button:has-text("تعديل")').click()
    return page.locator('label:has-text("نوع الزيارة") select option').evaluateAll((os) =>
      Object.fromEntries(os.map((o) => [o.value, o.disabled])))
  }
  {
    const { ctx, page } = await open(browser, visit(R.poProc))
    await page.waitForSelector('.visit-pay')
    const pay = await textOf(page.locator('.visit-pay'))
    ok(pay.includes('بلا كشفية') && !pay.includes('رسم الكشف (معاينة)'), `بطاقة المبلغ: ${pay.slice(0, 70)}`)
    const o = await editOptions(page)
    ok(o.consultation && o.followup && !o[PO], '★ بعد الإجراء: العادية معطّلة')
    ok((await textOf(page.locator('label:has-text("نوع الزيارة")'))).includes('أُضيف إجراء'), 'والسبب مكتوب')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, visit(R.regArrived))
    await page.waitForSelector('.visit-pay')
    const o = await editOptions(page)
    ok(o[PO] && !o.consultation && !o.followup, '★ عادية حاضرة: «إجراء فقط» معطّل، ومعاينة ↔ مراجعة كما كانتا')
    ok((await textOf(page.locator('label:has-text("نوع الزيارة")'))).includes('قُبضت الكشفية'), 'والسبب: قُبضت الكشفية')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, visit(R.regWaiting))
    await page.waitForSelector('.visit-pay')
    const o = await editOptions(page)
    ok(!o[PO] && !o.consultation, '★ عادية لم تحضر: كلّه مفتوح')
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, visit(R.poArrived))
    await page.waitForSelector('.visit-pay')
    const o = await editOptions(page)
    ok(!o.consultation && !o.followup, '★ «إجراء فقط» حاضرة بلا قبض: التصحيح مفتوح قبل الدخول')
    await page.locator('label:has-text("نوع الزيارة") select').selectOption('consultation')
    await page.click('button:has-text("حفظ التعديلات")')
    await page.waitForTimeout(300)
    ok(calls.find((c) => /\/details$/.test(c.p))?.body?.visit_type === 'consultation', 'الحفظ يرسل النوع الجديد')
    ok((await page.locator('body').innerText()).includes('خذي الكشفية'), '★ وتنبيهٌ صريح: خذي الكشفية')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, visit(R.poEmptyDone))
    await page.waitForSelector('.visit-pay')
    ok((await textOf(page.locator('.visit-pay'))).includes('لم يُقبض شيء'), '★ المنتهية بلا إجراء: مكتوبٌ في بطاقة المبلغ')
    await ctx.close()
  }

  console.log('\n── ٤) شاشة الطبيب ──')
  {
    const { ctx, page } = await open(browser, '/clinic/doctor', { role: 'doctor', w: 390, h: 844 })
    await page.waitForSelector('.dk-current-who')
    ok((await textOf(page.locator('.dk-current-who'))).includes('إجراء فقط'), 'قيد الكشف: الشارة ظاهرة')
    ok((await textOf(page.locator('.dk-next'))).includes('إجراء فقط'), 'والتالي')
    ok((await page.locator('.dk-wait:has-text("مريض رقم 105") .proc-only-badge').count()) === 0, '★ والعادي بلا شارة')
    await ctx.close()
  }

  console.log('\n── ٥) البطاقتان: لا سطر كشفية ──')
  {
    const { ctx, page } = await open(browser, `/clinic/session/${SID}`)
    await page.waitForSelector('text=+ حجز جديد')
    const htmlOf = (appt) => page.evaluate(async (a) => {
      const m = await import('/src/ticket-print.js')
      const d = document.createElement('div')
      d.innerHTML = m.ticketHtml(m.ticketFrom(a, { flow_mode: 'attendance', doctor_name: 'د. خالد', room: '1' }), 80, null, '').replace(/<style[\s\S]*?<\/style>/g, '')
      return d.textContent.replace(/\s+/g, ' ')
    }, appt)
    let t = await htmlOf(R.poArrived)
    ok(t.includes('إجراء فقط') && t.includes('بلا كشفية') && !t.includes('المبلغ للدفع') && !t.includes('معاينة'), `HTML بلا إجراء: ${t.slice(-60)}`)
    t = await htmlOf(R.poProc)
    ok(t.includes('تخطيط أعصاب') && t.includes('المجموع للدفع') && !t.includes('معاينة'), 'HTML بإجراء: الإجراء والمجموع بلا سطر معاينة')
    t = await htmlOf(R.regArrived)
    ok(t.includes('معاينة') && t.includes('المبلغ للدفع') && !t.includes('بلا كشفية'), '★ HTML العادية كما كانت')
    const drawn = (appt) => page.evaluate(async (a) => {
      const m = await import('/src/print-helper.js'), tp = await import('/src/ticket-print.js')
      const seen = []
      const orig = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { seen.push(String(s)); return orig.call(this, s, ...r) }
      try { await m.renderTicketPng(tp.ticketFrom(a, { flow_mode: 'attendance', doctor_name: 'د. خالد', room: '1' }), 80) }
      finally { CanvasRenderingContext2D.prototype.fillText = orig }
      return seen.join(' | ')
    }, appt)
    t = await drawn(R.poArrived)
    ok(t.includes('إجراء فقط') && t.includes('بلا كشفية') && !t.includes('المبلغ للدفع') && !t.includes('معاينة'), '★ الوسيط بلا إجراء: لا مبلغ ولا معاينة')
    t = await drawn(R.poProc)
    ok(t.includes('تخطيط أعصاب') && t.includes('المجموع للدفع') && !t.includes('معاينة'), '★ الوسيط بإجراء: بلا سطر معاينة')
    t = await drawn(R.regArrived)
    ok(t.includes('معاينة') && t.includes('المبلغ للدفع'), '★ الوسيط للعادية كما كان')
    await ctx.close()
  }

  console.log('\n── ٦) الجرد ──')
  {
    const report = clone(CASH.four)
    const d = report.doctors[0]
    const line = { ...clone(d.rows[0]), id: '999', name: 'مريض إجراء فقط', visit: 'إجراء فقط', fee: 0, procItems: [], procs: '', procCount: 0, procTotal: 0,
      referral: '', referralCount: 0, discount: 0, total: 0, remarks: [], flags: ['إجراء فقط بلا إجراءات'], flagged: true, procedureOnly: true }
    d.rows.push(line)
    d.totals.patients += 1; d.totals.procedureOnly = 1; report.totals.patients += 1; report.totals.procedureOnly = 1
    const feeCountBefore = d.totals.patients - 1
    const { ctx, page } = await open(browser, '/clinic/cash-report', { role: 'umosama', on: { '/reception/cash-report': () => report, '/clinic/doctors': () => [] } })
    await page.waitForSelector('.cash-doc-break')
    const fa = (n) => Number(n).toLocaleString('ar-SY')
    ok((await textOf(page.locator('.cash-doc-break').first())).includes(`الكشوف (${fa(feeCountBefore)})`), '★ «الكشوف» لا تعدّ مرضى «إجراء فقط»')
    await page.click('.cash-docs-head .link-btn')   // الكتل مطويّة افتراضاً
    const tr = page.locator('tr:has-text("مريض إجراء فقط")')
    ok(await tr.evaluate((e) => e.classList.contains('cash-flag')), 'سطرها مُعلَّم')
    ok((await tr.locator('[data-label="الكشف"]').innerText()).trim() === '—', 'وخانة الكشف «—» لا صفر')
    ok((await textOf(tr)).includes('إجراء فقط بلا إجراءات'), 'والعلم مقروء')
    await ctx.close()
  }

  console.log('\n── ٧) المراجعة ──')
  {
    const visits = [{ id: '104', session_id: SID, session_date: '2026-10-25', patient_name: 'مريض رقم 104', doctor_name: 'د. خالد' }]
    const reviewBody = { lines: [], counts: { lines: 0 }, totals: { price: 0, materials: 0, consumables: 0, doctor: 0, shifa: 0 } }
    const common = { '/clinic/procedures/review': () => reviewBody, '/clinic/procedures/unpaid': () => ({ lines: [], total: 0 }), '/clinic/doctors': () => [] }
    let { ctx, page } = await open(browser, '/clinic/procedures?tab=review', { role: 'umosama', on: { ...common, '/clinic/procedures/empty-visits': () => ({ visits }) } })
    await page.waitForSelector('#rev-empty-title')
    ok((await textOf(page.locator('#rev-empty-title'))).includes('انتهت بلا إجراء'), '★ القسم ظاهر حين توجد حالة')
    ok(await page.locator(`a[href="/clinic/session/${SID}/visit/104"]`).count() === 1, 'وبرابطٍ لصفحة الزيارة')
    ok(await noOverflow(page), 'بلا تمرير أفقي')
    await ctx.close()
    ;({ ctx, page } = await open(browser, '/clinic/procedures?tab=review', { role: 'umosama', on: { ...common, '/clinic/procedures/empty-visits': () => ({ visits: [] }) } }))
    await page.waitForSelector('text=مراجعة الإجراءات وحصصها')
    await page.waitForTimeout(300)
    ok(await page.locator('#rev-empty-title').count() === 0, 'ولا شيء حين لا حالة')
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
  console.log('✔ «إجراء فقط»: الحجز والطابور والزيارة والطبيب والبطاقتان والجرد والمراجعة\n')
  process.exit(0)
}
run().catch((e) => { console.error(e); process.exit(1) })
