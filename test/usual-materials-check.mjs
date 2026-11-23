// ═══════════════════════════════════════════════════════════════════
// المواد المعتادة لكلّ إجراء (2026-11-23): «متل خدمة التسريب… المواد اللي بتكون بالعادة وبيعدل عليها
// الدكتور» — npm run test:usual   (USUAL_SHOTS=/dir يحفظ اللقطات)
//   • الطبيب: الإجراء يُعلَّم فيأتي بموادّه ومستهلكاته المعتادة، والعدد يضربها ما دام لم يلمسها،
//     وما يعدّله يُرسَل كما هو. و«+ مواد» على إجراءٍ مضاف: ينقّص ويحذف قبل المحاسبة.
//   • المشرفة: نافذة الإجراء فيها «المواد المعتادة» وPUT …/usual بالقائمة والعدّاد.
// ═══════════════════════════════════════════════════════════════════
import { chromium, webkit, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.USUAL_TEST_PORT || 5267)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.USUAL_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const FX = JSON.parse(readFileSync(resolve(HERE, 'test/fixtures/visit-page.json'), 'utf8'))
let pass = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`); return false }

const SID = '1', AID = '501'
const PROCS = () => ([
  { id: '11', name: 'خياطة جرح', price: '150.00', is_active: true, is_general: true, specialties: [], times_used: 3,
    doctor_split_kind: 'percent', doctor_split_value: '65', usual_consumables: 30,
    usual_materials: [{ material_id: '2', name: 'إبرة', unit: 'قطعة', qty: 2, is_active: true },
      { material_id: '1', name: 'خيط جراحي', unit: 'قطعة', qty: 1, is_active: true },
      { material_id: '9', name: 'معطّلة', unit: 'قطعة', qty: 1, is_active: false }] },
  { id: '12', name: 'تخطيط قلب', price: '500.00', is_active: true, is_general: true, specialties: [], times_used: 9,
    doctor_split_kind: 'percent', doctor_split_value: '50', usual_consumables: 0, usual_materials: [] },
])
const MATS = [
  { id: '1', name: 'خيط جراحي', unit: 'قطعة', unit_price: '50', is_active: true, material_kind: 'counted' },
  { id: '2', name: 'إبرة', unit: 'قطعة', unit_price: '10', is_active: true, material_kind: 'counted' },
  { id: '3', name: 'شاش معقّم', unit: 'قطعة', unit_price: '20', is_active: true, material_kind: 'counted' },
]
const LINE = () => ({ id: '71', procedure_id: '11', name: 'خياطة جرح', added_source: 'doctor', added_by: '40', paid_at: null,
  removed_at: null, fee: 150, consumables: 30, materials: [{ material_id: '1', name: 'خيط جراحي', unit: 'قطعة', qty: 2 },
    { material_id: '2', name: 'إبرة', unit: 'قطعة', qty: 2 }] })

async function openDoctor(browser, view, { withLine = false } = {}) {
  const ctx = await browser.newContext(view === 'phone' ? { ...devices['iPhone 13'], locale: 'ar' }
    : { viewport: view === 'tablet' ? { width: 820, height: 1180 } : { width: 1366, height: 768 }, locale: 'ar', hasTouch: view === 'tablet' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const state = { lines: withLine ? [LINE()] : [], posts: [], puts: [] }
  const queue = () => {
    const q = structuredClone(FX.queues[SID])
    const a = { ...q.appointments[0], id: AID, status: 'in_service', full_name: 'مريضة الفحص', procedures: state.lines }
    return { ...q, id: SID, doctor_id: '4', appointments: [a] }
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (p === `/clinic/appointments/${AID}/procedures/batch` && req.method() === 'POST') {
      state.posts.push(req.postDataJSON()); return json({ lines: [] }, 201)
    }
    const pm = p.match(/^\/clinic\/appointments\/(\d+)\/procedures\/(\d+)\/materials$/)
    if (pm && req.method() === 'PUT') { state.puts.push(req.postDataJSON()); return json({ ...LINE() }) }
    if (p === '/auth/me') return json(FX.me.doctor)
    if (p === '/clinic/my-profile') return json({ id: '4', has_procedures: true })
    if (p === '/clinic/procedures/fee-mode') return json({ since: '2026-11-17' })
    if (p === '/clinic/my-sessions') return json([queue()])
    if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json(queue())
    if (p === '/clinic/procedures') return json(PROCS())
    if (p === '/clinic/materials') return json(MATS)
    if (p === '/clinic/my-procedures') return json({ lines: state.lines.map((l) => ({ ...l, appointment_id: AID, patient_name: 'مريضة الفحص', mine: true })), usage: {} })
    if (p === '/clinic/nurse-calls') return json({ calls: [] })
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}/clinic/doctor`, { waitUntil: 'load' })
  await page.getByRole('button', { name: '+ إجراء' }).first().waitFor()
  return { ctx, page, errors, state }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const chosen = (page) => page.$$eval('.dk-sel-item', (cards) => cards.map((c) => ({
  name: c.querySelector('.dk-sel-name')?.textContent.trim(),
  mats: [...c.querySelectorAll('.mat-chosen li')].map((li) => `${li.querySelector('.mat-name').textContent}:${li.querySelector('.mat-qty').value}`),
  cons: c.querySelector('.cons-value')?.textContent.trim(),
  hint: c.querySelector('.usual-hint')?.textContent.trim() || '',
})))

async function doctorAdd(browser, view) {
  const tag = `${view}: إضافة`
  console.log(`\n── ${tag} ──`)
  const { ctx, page, errors, state } = await openDoctor(browser, view)
  await page.getByRole('button', { name: '+ إجراء' }).first().click()
  await page.waitForSelector('.dk-pick-grid')
  await page.locator('.dk-pick', { hasText: 'خياطة جرح' }).click()
  await page.locator('.dk-pick', { hasText: 'تخطيط قلب' }).click()
  await page.locator('.dk-confirm').click()
  await page.waitForSelector('.dk-sel-item .mat-chosen')
  let c = await chosen(page)
  const sew = c.find((x) => /خياطة/.test(x.name)), ecg = c.find((x) => /تخطيط/.test(x.name))
  ok(sew && sew.mats.join(',') === 'إبرة:2,خيط جراحي:1', `${tag}: «خياطة» تأتي بموادّها المعتادة بلا المعطّلة (${sew?.mats})`)
  ok(sew && /30/.test(sew.cons), `${tag}: ومستهلكاتها المعتادة 30 (${sew?.cons})`)
  ok(sew && /المعتاد لهذا الإجراء/.test(sew.hint), `${tag}: جملة «المعتاد لهذا الإجراء» (${sew?.hint})`)
  ok(ecg && ecg.mats.length === 0 && ecg.cons === 'لا شيء' && ecg.hint === '', `${tag}: «تخطيط» بلا معتاد يبقى فارغاً (${JSON.stringify(ecg)})`)
  const foot = await page.textContent('.dk-total')
  // 150 + 500 + 30 + (2×10 + 1×50)
  ok(/750/.test(foot.replace(/,/g, '')), `${tag}: على المريض = 650 + 30 + 70 = 750 (${foot})`)
  ok(/إضافة \(2\)/.test(await page.textContent('.dk-confirm')), `${tag}: الزرّ «إضافة (2)» لا «بلا مواد»`)
  await shot(page, `${view}-1-prefilled`)

  // العدد × 2 ⇒ المعتاد × 2
  const sewCard = page.locator('.dk-sel-item', { hasText: 'خياطة جرح' })
  await sewCard.getByRole('button', { name: /زيادة العدد/ }).click()
  c = await chosen(page)
  const sew2 = c.find((x) => /خياطة/.test(x.name))
  ok(sew2.mats.join(',') === 'إبرة:4,خيط جراحي:2' && /60/.test(sew2.cons), `${tag}: × 2 ⇒ المواد × 2 والمستهلكات 60 (${sew2.mats} · ${sew2.cons})`)

  // تعديلٌ يدويّ يثبّت: حذف الإبرة، ثمّ × 3 لا يعيدها
  await sewCard.getByRole('button', { name: 'إزالة إبرة' }).click()
  await sewCard.getByRole('button', { name: /زيادة العدد/ }).click()
  c = await chosen(page)
  const sew3 = c.find((x) => /خياطة/.test(x.name))
  ok(sew3.mats.join(',') === 'خيط جراحي:2' && /60/.test(sew3.cons), `${tag}: بعد التعديل اليدويّ العدد لا يعيد المعتاد (${sew3.mats} · ${sew3.cons})`)
  ok(/عدّلتَ المعتاد/.test(sew3.hint), `${tag}: والجملة تقول «عدّلتَ المعتاد» (${sew3.hint})`)
  // تنقيص العدّاد قبل الإضافة
  await sewCard.getByRole('button', { name: 'إنقاص المستهلكات' }).click()
  ok(await noHScroll(page), `${tag}: لا تمرير أفقي`)
  await shot(page, `${view}-2-edited`)
  await page.locator('.dk-confirm').click()
  await page.waitForTimeout(400)
  const sent = state.posts[0]?.items || state.posts[0]?.procedures || state.posts[0]
  const items = Array.isArray(sent) ? sent : []
  const s11 = items.find((x) => String(x.procedure_id) === '11'), s12 = items.find((x) => String(x.procedure_id) === '12')
  ok(s11 && JSON.stringify(s11.materials) === JSON.stringify([{ material_id: '1', qty: 2 }]) && s11.consumables === 50 && s11.quantity === 3,
    `${tag}: يُرسَل ما عدّله: خيط ×2، مستهلكات 50، العدد 3 (${JSON.stringify(s11)})`)
  ok(s12 && s12.materials.length === 0 && !s12.consumables, `${tag}: و«تخطيط» بلا مواد (${JSON.stringify(s12)})`)
  ok(errors.length === 0, `${tag}: لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

async function doctorDecrease(browser, view) {
  const tag = `${view}: تنقيص`
  console.log(`\n── ${tag} ──`)
  const { ctx, page, errors, state } = await openDoctor(browser, view, { withLine: true })
  await page.locator('.dk-proc-row').getByRole('button', { name: '+ مواد' }).click()
  await page.waitForSelector('.bs-card .mat-chosen')
  const minus = page.getByRole('button', { name: 'إنقاص كمّية خيط جراحي' })
  ok(await minus.isEnabled(), `${tag}: زرّ ➖ على المادة القائمة مفعّل`)
  await minus.click()
  await page.getByRole('button', { name: 'إزالة إبرة' }).click()
  await page.getByRole('button', { name: 'إنقاص المستهلكات' }).click()
  const total = await page.textContent('.bs-card .dk-total')
  // خيط 2⇒1 (−50)، إبرة ×2 حُذفت (−20)، مستهلكات 30⇒20 (−10) ⇒ −80
  ok(/ينقص عن المريض/.test(total) && /80/.test(total), `${tag}: «ينقص عن المريض 80» (${total})`)
  const hint = await page.textContent('.bs-card .cons-hint:last-of-type')
  ok(/نقّص/.test(hint) && !/تقدر تزيد بس/.test(hint), `${tag}: الجملة تسمح بالتنقيص (${hint})`)
  await shot(page, `${view}-3-decrease`)
  await page.getByRole('button', { name: 'حفظ المواد' }).click()
  await page.waitForTimeout(400)
  const put = state.puts[0]
  ok(put && JSON.stringify(put.materials) === JSON.stringify([{ material_id: 1, qty: 1 }]) && put.consumables === 20,
    `${tag}: PUT بالقائمة كاملةً بعد التنقيص (${JSON.stringify(put)})`)
  ok(errors.length === 0, `${tag}: لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

async function adminDialog(browser, view) {
  const tag = `${view}: المشرفة`
  console.log(`\n── ${tag} ──`)
  const ctx = await browser.newContext(view === 'phone' ? { ...devices['iPhone 13'], locale: 'ar' }
    : { viewport: { width: 1366, height: 768 }, locale: 'ar' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const puts = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (/^\/clinic\/procedures\/\d+\/usual$/.test(p) && req.method() === 'PUT') { puts.push({ p, body: req.postDataJSON() }); return json({ unchanged: false }) }
    if (p === '/auth/me') return json(FX.me.umosama)
    if (p === '/clinic/procedures/fee-mode') return json({ since: '2026-11-17' })
    if (p === '/clinic/procedures') return json(PROCS())
    if (p === '/clinic/materials') return json(MATS.map((m) => ({ ...m, balance: 1 })))
    if (p === '/clinic/specialties') return json([])
    return json([])
  })
  await page.goto(`${BASE}/clinic/procedures`, { waitUntil: 'load' })
  await page.waitForSelector('.pcx-card')
  const foot = await page.locator('.pcx-card', { hasText: 'خياطة جرح' }).textContent()
  ok(/له مواد معتادة/.test(foot), `${tag}: البطاقة تقول «له مواد معتادة» (${foot})`)
  ok(!/له مواد معتادة/.test(await page.locator('.pcx-card', { hasText: 'تخطيط قلب' }).textContent()), `${tag}: وبلا معتاد لا تقول`)
  await page.locator('.pcx-card', { hasText: 'خياطة جرح' }).click()
  await page.waitForSelector('.pcx-usual .mat-chosen')
  const rows = await page.$$eval('.pcx-usual .mat-chosen li', (l) => l.map((li) => `${li.querySelector('.mat-name').textContent}:${li.querySelector('.mat-qty').value}`))
  ok(rows.join(',') === 'إبرة:2,خيط جراحي:1,معطّلة:1', `${tag}: المعتاد القائم بالنافذة، والمعطّلة ظاهرة لها (${rows})`)
  // ➕ لا يقف عند رصيد اليوم (المعتاد قالب)
  await page.getByRole('button', { name: 'زيادة كمّية خيط جراحي' }).click()
  await page.getByRole('button', { name: 'زيادة كمّية خيط جراحي' }).click()
  ok((await page.getByRole('textbox', { name: 'كمّية خيط جراحي' }).inputValue()) === '3', `${tag}: ➕ فوق الرصيد (قالبٌ لا صرف)`)
  await page.getByRole('button', { name: 'إزالة معطّلة' }).click()
  await page.locator('.pcx-usual').getByRole('button', { name: 'زيادة المستهلكات' }).click()
  const sum = await page.textContent('.pcx-usual .pcx-split-out')
  // 150 + 40 + (2×10 + 3×50 = 170) = 360
  ok(/360/.test(sum.replace(/,/g, '')), `${tag}: «على المريض بالعادة» = 150 + 40 + 170 = 360 (${sum})`)
  ok(await noHScroll(page), `${tag}: لا تمرير أفقي`)
  await shot(page, `${view}-4-admin`)
  await page.getByRole('button', { name: 'حفظ التعديل' }).click()
  await page.waitForTimeout(400)
  const b = puts[0]?.body
  ok(puts[0]?.p === '/clinic/procedures/11/usual' && JSON.stringify(b?.materials) === JSON.stringify([{ material_id: 2, qty: 2 }, { material_id: 1, qty: 3 }])
    && b?.consumables === 40, `${tag}: PUT …/11/usual بالقائمة والعدّاد (${JSON.stringify(puts[0])})`)
  ok(errors.length === 0, `${tag}: لا أخطاء صفحة (${errors.join(' | ')})`)
  await ctx.close()
}

async function reception(browser, view) {
  const tag = `${view}: الاستقبال`
  console.log(`\n── ${tag} ──`)
  const ctx = await browser.newContext(view === 'phone' ? { ...devices['iPhone 13'], locale: 'ar' }
    : { viewport: { width: 1366, height: 768 }, locale: 'ar' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const posts = []
  const st = FX.states.procedures
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    let m
    if (/^\/clinic\/appointments\/\d+\/procedures$/.test(p) && req.method() === 'POST') {
      posts.push(req.postDataJSON()); return json({ id: '99', fee_snapshot: '150', price_snapshot: '230' }, 201)
    }
    if (p === '/auth/me') return json(FX.me.reception)
    if (p === '/clinic/procedures/fee-mode') return json({ since: '2026-10-01' })
    if ((m = /^\/clinic\/sessions\/(\d+)\/queue$/.exec(p))) return json(FX.queues[m[1]])
    if (p === '/clinic/procedures') return json(PROCS())
    if (p === '/clinic/materials') return json(MATS.map(({ unit_price: _u, ...x }) => ({ ...x, unit_price: x.id === '1' ? '50' : '10' })))
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  await page.goto(`${BASE}/clinic/session/${st.session}/visit/${st.appt}`, { waitUntil: 'load' })
  await page.waitForSelector('.visit-procs #visit-proc-pick')
  await page.locator('.visit-procs #visit-proc-pick').click()
  await page.locator('.combo-panel li[role="option"]', { hasText: 'خياطة جرح' }).click()
  await page.waitForSelector('.proc-add-mats .mat-chosen')
  const rows = async () => page.$$eval('.proc-add-mats .mat-chosen li', (l) => l.map((li) => `${li.querySelector('.mat-name').textContent}:${li.querySelector('.mat-qty').value}`))
  ok((await rows()).join(',') === 'إبرة:2,خيط جراحي:1', `${tag}: «خياطة» تأتي بالمعتاد (${await rows()})`)
  const hint = await page.textContent('.proc-add-mats .usual-hint')
  ok(/زيدي أو نقّصي/.test(hint), `${tag}: الجملة بصيغة الاستقبال (${hint})`)
  await page.locator('.proc-add-mats').getByRole('button', { name: /زيادة العدد/ }).click()
  ok((await rows()).join(',') === 'إبرة:4,خيط جراحي:2', `${tag}: × 2 ⇒ المعتاد × 2 (${await rows()})`)
  ok(/60/.test(await page.textContent('.proc-add-mats .cons-value')), `${tag}: والمستهلكات 60`)
  await page.getByRole('button', { name: 'إزالة إبرة' }).click()
  ok(/عُدّل المعتاد/.test(await page.textContent('.proc-add-mats .usual-hint')), `${tag}: بعد التعديل «عُدّل المعتاد»`)
  await shot(page, `${view}-5-reception`)
  ok(await noHScroll(page), `${tag}: لا تمرير أفقي`)
  // إجراءٌ آخر بلا معتاد يفرّغ ما قبله
  await page.locator('.visit-procs #visit-proc-pick').click()
  await page.locator('.combo-panel li[role="option"]', { hasText: 'تخطيط قلب' }).click()
  ok((await rows()).length === 0 && !(await page.$('.proc-add-mats .usual-hint')), `${tag}: «تخطيط» بلا معتاد ⇒ لا مواد ولا جملة`)
  await page.locator('.visit-procs #visit-proc-pick').click()
  await page.locator('.combo-panel li[role="option"]', { hasText: 'خياطة جرح' }).click()
  await page.getByRole('button', { name: 'إنقاص كمّية إبرة' }).click()
  await page.getByRole('button', { name: 'إضافة الإجراء' }).click()
  await page.waitForTimeout(400)
  const b = posts[0]
  ok(b && String(b.procedure_id) === '11' && JSON.stringify(b.materials) === JSON.stringify([{ material_id: '2', qty: 1 }, { material_id: '1', qty: 1 }])
    && b.consumables === 30, `${tag}: يُرسَل المعتاد بعد تعديله (${JSON.stringify(b)})`)
  ok(errors.length === 0, `${tag}: لا أخطاء صفحة (${errors.join(' | ')})`)
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
  for (const v of ['laptop', 'tablet', 'phone']) { await doctorAdd(cr, v); await doctorDecrease(cr, v) }
  for (const v of ['laptop', 'phone']) { await adminDialog(cr, v); await reception(cr, v) }
  await cr.close()
  const wk = await webkit.launch()
  await doctorAdd(wk, 'phone'); await doctorDecrease(wk, 'phone')
  await wk.close()
  console.log(`\n${pass} ✓ · ${failures.length} ✖`)
  stop()
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
