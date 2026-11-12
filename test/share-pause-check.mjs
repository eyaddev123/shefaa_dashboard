// ═══════════════════════════════════════════════════════════════════
// إيقاف الحالات الخاصّة في بروفايل الدكتور — في متصفّح حقيقي
//   npm run test:share-pause    (SHARE_PAUSE_SHOTS=/dir يحفظ اللقطات)
// الحساب نفسه (الموقوفة لا تُقرأ، والقديم بلقطته) مفحوص في server: npm run test:share-pause
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SHARE_PAUSE_TEST_PORT || 5263)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.SHARE_PAUSE_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let pass = 0
const failures = []
const ok = (c, l, extra = '') => { if (c) { pass++; return true } failures.push(l); console.log(`  ✖ ${l}`, extra); return false }

const ME = { adm: { role: 'clinic_admin', display_name: 'المشرفة رنا' }, brd: { role: 'board', is_chairman: false, board_member_id: 2, display_name: 'عضو' } }
const DOCTOR = (o = {}) => ({ id: '1', name: 'د. خالد', specialty: 'عظمية', specialty_id: '1', phone: '', room: '1', consultation_fee: 2000,
  followup_fee: 1000, followup_window_days: 7, expected_visit_minutes: 15, hourly_buffer_minutes: null, is_active: true,
  accepts_urgent: true, schedules: [], share_kind: 'percent', share_value: 60, ...o })
const RULE = (id, procId, name, kind, value, price) => ({ id: String(id), doctor_id: '1', procedure_id: String(procId), procedure_name: name,
  share_kind: kind, share_value: String(value), price: String(price), procedure_active: true, paused_at: null, paused_by: null, paused_by_name: null })

async function open(browser, { role = 'adm', w = 1366, h = 900, theme = 'light', doctor = DOCTOR(), failPause = false } = {}) {
  const rules = [RULE(1, 1, 'تجبير', 'fixed', 20000, 50000), RULE(2, 2, 'قلع', 'percent', 30, 100000), RULE(3, 3, 'حشوة', 'fixed', 10000, 30000)]
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript((t) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', t) }, theme)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const posts = []
  const setPaused = (r, paused) => { r.paused_at = paused ? '2026-11-12T08:00:00Z' : null; r.paused_by_name = paused ? 'المشرفة رنا' : null }
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^\/api/, '')
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (req.method() === 'POST') posts.push(p)
    if (p === '/auth/me') return json(ME[role])
    if (p === '/clinic/doctors/1') return json(doctor)
    if (p === '/clinic/doctors/1/procedure-shares') return json(rules)
    let m
    if ((m = p.match(/^\/clinic\/doctors\/1\/procedure-shares\/(\d+)\/(pause|resume)$/))) {
      if (failPause) return json({ error: 'تعذّر الحفظ — جرّب ثانية' }, 500)
      const r = rules.find((x) => x.procedure_id === m[1]); const was = !!r.paused_at
      setPaused(r, m[2] === 'pause'); return json({ ...r, changed: was !== (m[2] === 'pause') })
    }
    if ((m = p.match(/^\/clinic\/doctors\/1\/procedure-shares\/(pause|resume)-all$/))) {
      const want = m[1] === 'pause'; let changed = 0
      for (const r of rules) if (!!r.paused_at !== want) { setPaused(r, want); changed++ }
      return json({ doctor_id: 1, changed, total: rules.length, paused: rules.filter((r) => r.paused_at).length })
    }
    if (p === '/clinic/procedures') return json([{ id: '1', name: 'تجبير', price: 50000, is_active: true }])
    if (p === '/clinic/doctors/1/pay') return json({ pay: null, history: [] })
    if (p === '/clinic/specialties') return json([{ id: '1', name: 'عظمية' }])
    if (p === '/clinic/doctors/1/history') return json([
      { id: 'p9', field: 'pricing', action: 'rule_pause', procedure_name: 'قلع', old_value: { kind: 'percent', value: 30 },
        changed_at: '2026-11-12T08:00:00Z', changed_by_name: 'المشرفة رنا' },
      { id: 'p8', field: 'pricing', action: 'rule_resume', procedure_name: 'تجبير', old_value: { kind: 'fixed', value: 20000 },
        changed_at: '2026-11-12T07:00:00Z', changed_by_name: 'المشرفة رنا' }])
    return json([])
  })
  await page.goto(`${BASE}/clinic/doctors/1`, { waitUntil: 'load' })
  return { ctx, page, errors, posts, rules }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
const card = (page) => page.locator('.card', { has: page.locator('h3', { hasText: 'حصّة الدكتور من الإجراءات' }) })
const row = (page, name) => card(page).locator('tbody tr', { hasText: name })
const confirmDialog = async (page, label) => {
  await page.waitForSelector('.dlg-card')
  const body = await page.textContent('.dlg-card')
  await page.locator('.dlg-card button', { hasText: label }).click()
  await page.waitForSelector('.dlg-card', { state: 'detached' })
  return body
}

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  const browser = await chromium.launch()

  console.log('\n── ١) إيقاف قاعدةٍ واحدة وتشغيلها ──')
  {
    const { ctx, page, errors, posts } = await open(browser)
    await row(page, 'تجبير').waitFor()
    ok(await card(page).locator('button', { hasText: 'إيقاف الكل' }).count() === 1, 'زرّ «إيقاف الكل» ظاهر')
    ok(await card(page).locator('button', { hasText: 'تشغيل الكل' }).count() === 0, 'ولا «تشغيل الكل» بلا موقوفة')
    await row(page, 'تجبير').locator('button', { hasText: 'إيقاف' }).click()
    await row(page, 'تجبير').locator('.badge', { hasText: 'موقوفة' }).waitFor()
    ok(posts.includes('/clinic/doctors/1/procedure-shares/1/pause'), '★ الإيقاف يطلب المسار الصحيح بلا تأكيد')
    ok(await row(page, 'تجبير').evaluate((tr) => tr.classList.contains('rule-paused')), '★ السطر باهت (rule-paused)')
    const title = await row(page, 'تجبير').locator('.badge', { hasText: 'موقوفة' }).getAttribute('title')
    ok(/المشرفة رنا/.test(title || ''), 'الشارة تقول مَن أوقف ومتى', title)
    const note = await card(page).locator('.share-paused-note').textContent()
    ok(note.includes('١ من ٣') || note.includes('1 من 3'), '★ الملاحظة: ١ من ٣ موقوفة', note)
    ok(/٦٠٪|60٪/.test(note) && note.includes('لا تتغيّر'), '★ الملاحظة تسمّي النسبة العامّة وتقول إن القديم لا يتغيّر', note)
    ok(/منها (1|١) موقوفة/.test(await card(page).locator('.share-rules-head h4').textContent()), 'العنوان يعدّ الموقوفة')
    ok(await card(page).locator('button', { hasText: 'تشغيل الكل' }).count() === 1, '«تشغيل الكل» يظهر حين توجد موقوفة')
    await shot(page, 'one-paused')
    await row(page, 'تجبير').locator('button', { hasText: 'تشغيل' }).click()
    await row(page, 'تجبير').locator('.badge', { hasText: 'موقوفة' }).waitFor({ state: 'detached' })
    ok(posts.includes('/clinic/doctors/1/procedure-shares/1/resume'), '★ التشغيل يطلب resume')
    ok(await card(page).locator('.share-paused-note').count() === 0, 'الملاحظة تختفي حين لا موقوفة')
    ok(errors.length === 0, `بلا أخطاء (${errors[0] || ''})`)
    await ctx.close()
  }

  console.log('\n── ٢) إيقاف الكل وتشغيل الكل ──')
  {
    const { ctx, page, posts } = await open(browser)
    await row(page, 'تجبير').waitFor()
    await card(page).locator('button', { hasText: 'إيقاف الكل' }).click()
    const body = await confirmDialog(page, 'إيقاف الكل')
    ok(body.includes('(3)') || body.includes('(٣)'), '★ التأكيد يقول العدد', body)
    ok(/٦٠٪|60٪/.test(body) && body.includes('محفوظة') && body.includes('لا يتغيّر'), '★ والتأكيد: النسبة العامّة، محفوظة، القديم لا يتغيّر', body)
    await card(page).locator('.share-paused-note', { hasText: 'كل الحالات الخاصّة موقوفة' }).waitFor()
    ok(posts.includes('/clinic/doctors/1/procedure-shares/pause-all'), '★ يطلب pause-all')
    ok(await card(page).locator('tbody tr.rule-paused').count() === 3, '★ الثلاثة موقوفة')
    ok(await card(page).locator('button', { hasText: 'إيقاف الكل' }).count() === 0, '«إيقاف الكل» يختفي حين لا سارية')
    await shot(page, 'all-paused')
    await card(page).locator('button', { hasText: 'تشغيل الكل' }).click()
    await confirmDialog(page, 'تشغيل الكل')
    await card(page).locator('.share-paused-note').waitFor({ state: 'detached' })
    ok(posts.includes('/clinic/doctors/1/procedure-shares/resume-all') && await card(page).locator('tbody tr.rule-paused').count() === 0, '★ «تشغيل الكل» يُرجعها')
    // إلغاء التأكيد ⇒ لا طلب
    const before = posts.length
    await card(page).locator('button', { hasText: 'إيقاف الكل' }).click()
    await confirmDialog(page, 'إلغاء')
    ok(posts.length === before, 'إلغاء التأكيد ⇒ لا طلب')
    await ctx.close()
  }

  console.log('\n── ٣) بلا نسبة عامّة، والخطأ، والسجلّ ──')
  {
    const { ctx, page } = await open(browser, { doctor: DOCTOR({ share_kind: null, share_value: null }) })
    await row(page, 'تجبير').waitFor()
    await card(page).locator('button', { hasText: 'إيقاف الكل' }).click()
    const body = await confirmDialog(page, 'إلغاء')
    ok(body.includes('لا نسبة عامّة') && body.includes('لن يُقبل'), '★ بلا نسبة عامّة: التأكيد يحذّر أن الإجراء سيُرفض', body)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { failPause: true })
    await row(page, 'تجبير').waitFor()
    await row(page, 'تجبير').locator('button', { hasText: 'إيقاف' }).click()
    await card(page).locator('.error').waitFor()
    ok((await card(page).locator('.error').textContent()).includes('تعذّر الحفظ'), '★ فشل الخادم ⇒ الخطأ ظاهر في البطاقة')
    ok(await row(page, 'تجبير').locator('.badge', { hasText: 'موقوفة' }).count() === 0, 'والسطر لم يتغيّر')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser)
    await page.waitForSelector('text=أُوقفت القاعدة')
    const t = await page.textContent('body')
    ok(t.includes('قاعدة «قلع»: أُوقفت القاعدة (30٪ بعد المواد) — يُحسب بالنسبة العامّة'), '★ السجلّ: نصّ الإيقاف')
    ok(t.includes('قاعدة «تجبير»: شُغّلت القاعدة من جديد'), '★ السجلّ: نصّ التشغيل')
    await ctx.close()
  }

  console.log('\n── ٤) القراءة وحدها، والجوال، والوضع الداكن ──')
  {
    const { ctx, page, rules } = await open(browser, { role: 'brd' })
    rules[1].paused_at = '2026-11-12T08:00:00Z'
    await page.reload({ waitUntil: 'load' })
    await row(page, 'قلع').waitFor()
    ok(await row(page, 'قلع').locator('.badge', { hasText: 'موقوفة' }).count() === 1, '★ المجلس يرى «موقوفة»')
    ok(await card(page).locator('button', { hasText: /إيقاف|تشغيل/ }).count() === 0, '★ بلا أزرار إيقاف/تشغيل لغير المشرفة')
    await ctx.close()
  }
  for (const [w, theme] of [[390, 'light'], [390, 'dark'], [1366, 'dark']]) {
    const { ctx, page } = await open(browser, { w, h: 844, theme })
    await row(page, 'تجبير').waitFor()
    await row(page, 'قلع').locator('button', { hasText: 'إيقاف' }).click()
    await row(page, 'قلع').locator('.badge', { hasText: 'موقوفة' }).waitFor()
    ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1), `بلا تمرير أفقي ${w} ${theme}`)
    ok(!/·\s*[0-9٠-٩]|[0-9٠-٩]\s*·/.test(await card(page).textContent()), `لا «·» بجانب رقم ${w}`)
    if (w === 390) {
      const hs = await card(page).locator('.share-rules-head-actions > button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height))
      ok(hs.length >= 2 && hs.every((x) => x >= 44), `أزرار الرأس ≥ 44px على الجوال (${hs.join(',')})`)
    }
    await shot(page, `paused-${w}-${theme}`)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${failures.length ? '✖' : '✔'} share-pause: ${pass} نجح، ${failures.length} فشل`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
