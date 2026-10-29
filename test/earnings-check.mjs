// ═══════════════════════════════════════════════════════════════════
// تبويب «المستحقات» في صفحة الإجراءات، في متصفّح حقيقي — /clinic/procedures?tab=earnings
//
// يُشغَّل بـ: npm run test:earnings
//   EARNINGS_SHOTS=/path/dir npm run test:earnings   ← يحفظ اللقطات (ملخّص/تفصيل × فاتح/داكن × 1366/390)
//
// البيانات ردودُ الخادم الحقيقي ملتقَطةً (test/fixtures/earnings.json من
//   EARNINGS_JSON_OUT=… npm run test:earnings في server).
// نفحص:
//   ١) الملخّص × المقاسين × الثيمين: الأرقام = الخادم، بلا تمرير أفقي، وعلى 390 بطاقاتٌ بأزرارٍ 44px
//   ٢) الكبسة تفتح التفصيل (الدكتور في الرابط)، وزرّ الرجوع والمتصفّح يعودان إلى الملخّص
//   ٣) الفترات تُرسَل للخادم باسمها، و«من — إلى» بتاريخين؛ وفترةٌ فارغة تقول ذلك
//   ٤) «بلا قاعدة» و«الشفاء سالبة» ظاهرتان في الملخّص والتفصيل
//   ٥) الصلاحيات: المجلس بلا تبويب (والرابط المباشر يعود للكتالوج)، والاستقبال لا يرى الصفحة
//   ٦) الإكسل يُطلب بالفترة نفسها، وبالدكتور من التفصيل
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.EARNINGS_TEST_PORT || 5251)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/earnings.json'), 'utf8'))
const SHOTS = process.env.EARNINGS_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const PATH = '/clinic/procedures?tab=earnings'

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }
const digits = (t) => Number(String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d-]/g, ''))

async function mockApi(page, { role, today }) {
  const calls = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api/, '')
    calls.push(`${p}${url.search}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(FX.me[role])
    if (p.startsWith('/clinic/procedures/earnings')) {
      if (!['adm', 'mgr', 'sup'].includes(role)) return json({ error: 'forbidden' }, 403)
      if (p.endsWith('/export'))
        return route.fulfill({ status: 200, body: Buffer.from('PK-fake'),
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': "attachment; filename=\"earnings.xlsx\"; filename*=UTF-8''%D9%85.xlsx" } })
      const q = url.searchParams
      const per = q.get('period')
      if (per === 'today') return json(FX[today])
      if (per) return json(FX[per])
      return json(q.get('from') === '2020-01-01' ? FX.empty : FX.custom)
    }
    if (p === '/clinic/procedures') return json([])
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  return calls
}

async function open(browser, { w = 1366, h = 800, theme = 'light', role = 'adm', today = 'today', path = PATH } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar', acceptDownloads: true })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const calls = await mockApi(page, { role, today })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

const layout = (page) => page.evaluate(() => {
  const doc = document.scrollingElement
  const small = [...document.querySelectorAll('.earn-card button')]
    .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim())
  return { hscroll: doc.scrollWidth > doc.clientWidth + 1, theadShown: !!document.querySelector('.earn-table thead')?.offsetHeight,
    small, bg: getComputedStyle(document.body).backgroundColor }
})

const summaryRows = (page) => page.$$eval('.earn-table tbody tr.earn-row', (rs) => rs.map((r) => ({
  name: r.querySelector('.rt-title').childNodes[0].textContent.trim(),
  cells: [...r.querySelectorAll('td.num')].map((td) => td.textContent),
  badges: [...r.querySelectorAll('.badge')].map((b) => b.textContent),
})))

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

  // ═══ ١ و٢) الملخّص والتفصيل × المقاسات × الثيمات ═══
  console.log('\n── ١) الملخّص والتفصيل × المقاسات × الثيمات ──')
  for (const [w, h] of [[1366, 800], [390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${w}-${theme}`
    const { ctx, page, errors } = await open(browser, { w, h, theme })
    await page.waitForSelector('.earn-row')
    const rows = await summaryRows(page)
    ok(rows.length === FX.today.doctors.length, `[${tag}] سطرٌ لكل دكتور له إجراءات (${rows.length})`)
    for (const d of FX.today.doctors) {
      const r = rows.find((x) => x.name === d.doctor)
      ok(r && r.cells.map(digits).join('/') === [d.totals.price, d.totals.materials, d.totals.doctor, d.totals.shifa].join('/'),
        `[${tag}] ${d.doctor}: الأرقام = الخادم (${r?.cells})`)
      ok(r && digits(r.badges[0]) === d.totals.count, `[${tag}] ${d.doctor}: العدد`)
    }
    const foot = await page.$$eval('.earn-total td.num', (t) => t.map((x) => x.textContent))
    const T = FX.today.totals
    ok(foot.map(digits).join('/') === [T.price, T.materials, T.doctor, T.shifa].join('/'), `[${tag}] سطر الإجمالي (${foot})`)
    const tiles = await page.$$eval('.earn-tiles .tile .value', (t) => t.map((x) => x.textContent))
    ok(tiles.map(digits).join('/') === [T.count, T.price, T.materials, T.doctor, T.shifa].join('/'), `[${tag}] البطاقات (${tiles})`)
    ok(await page.$eval('[aria-pressed=true]', (b) => b.textContent) === 'اليوم', `[${tag}] «اليوم» افتراضاً`)
    let L = await layout(page)
    ok(!L.hscroll, `[${tag}] ★ الملخّص بلا تمرير أفقي`)
    if (w === 390) {
      ok(!L.theadShown, `[${tag}] ★ بطاقات لا جدول (الرأس مخفيّ)`)
      ok(L.small.length === 0, `[${tag}] ★ كل الأزرار ≥ 44px (${L.small})`)
    }
    ok(theme === 'dark' ? L.bg !== 'rgb(255, 255, 255)' : true, `[${tag}] خلفية الثيم`)
    await shot(page, `summary-${tag}`)

    // الكبسة على السطر (لا الزرّ وحده)
    const A = FX.today.doctors[0]
    await page.click(`.earn-row:has-text("${A.doctor}") .rt-title`)
    await page.waitForSelector('.earn-detail')
    ok(new URL(page.url()).searchParams.get('doctor') === A.doctorId, `[${tag}] ★ الدكتور في الرابط`)
    ok(await page.$eval('.earn-head h3', (x) => x.textContent) === A.doctor, `[${tag}] العنوان اسم الدكتور`)
    const lines = await page.$$eval('.earn-detail tbody tr', (rs) => rs.map((r) => ({
      proc: r.querySelector('.earn-proc').textContent, rule: r.querySelector('.earn-rule').textContent,
      doc: r.querySelector('.earn-doc').textContent, patient: r.querySelector('.earn-patient').textContent,
      mats: r.querySelector('.earn-mats').textContent })))
    ok(lines.length === A.lines.length, `[${tag}] ★ إجراء إجراء (${lines.length})`)
    for (const l of A.lines) {
      const x = lines.find((y) => y.proc === l.procedure && y.patient.includes(l.patient))
      // نصّ الخادم بأرقامٍ هندية و«٪»: «نسبة 70%» ⇐ «نسبة ٧٠٪»
      const want = l.rule.replace(/[\d,]+/g, (n) => Number(n.replace(/,/g, '')).toLocaleString('ar-SY')).replace('%', '٪')
      ok(x && x.rule === want && digits(x.doc) === l.doctor, `[${tag}] ${l.procedure}: ${want} ⇒ ${l.doctor} (${x?.rule} ${x?.doc})`)
    }
    ok(lines.some((x) => x.mats.includes('جبس ×٢ علبة')), `[${tag}] المواد بأسمائها وكمّياتها`)
    ok(lines.some((x) => x.mats.includes('بلا مواد')), `[${tag}] «بلا مواد» لإجراءٍ بلا مواد`)
    L = await layout(page)
    ok(!L.hscroll, `[${tag}] ★ التفصيل بلا تمرير أفقي`)
    if (w === 390) ok(L.small.length === 0, `[${tag}] ★ أزرار التفصيل ≥ 44px (${L.small})`)
    await shot(page, `detail-${tag}`)

    await page.click('.earn-back')
    await page.waitForSelector('.earn-row')
    ok(!new URL(page.url()).searchParams.get('doctor'), `[${tag}] «كل الدكاترة» يعود للملخّص`)
    await page.click(`.earn-row:has-text("${A.doctor}") .earn-open button`)
    await page.waitForSelector('.earn-detail')
    await page.goBack()
    await page.waitForSelector('.earn-row')
    ok(new URL(page.url()).searchParams.get('tab') === 'earnings', `[${tag}] ★ زرّ رجوع المتصفّح يعود من التفصيل إلى الملخّص`)
    ok(errors.length === 0, `[${tag}] بلا أخطاء (${errors})`)
    await ctx.close()
  }

  // ═══ ٣) الفترات ═══
  console.log('\n── ٣) الفترات ──')
  {
    const { ctx, page, calls } = await open(browser)
    await page.waitForSelector('.earn-row')
    ok(calls.some((c) => c === '/clinic/procedures/earnings?period=today'), '★ اليوم يُطلب باسمه (الخادم يحلّه بتوقيت دمشق)')
    for (const [label, key] of [['أمس', 'yesterday'], ['هالأسبوع', 'week'], ['هالشهر', 'month']]) {
      await page.click(`.earn-periods >> text=${label}`)
      await page.waitForSelector('.earn-row')
      ok(calls.includes(`/clinic/procedures/earnings?period=${key}`), `★ «${label}» ⇒ period=${key}`)
      const range = await page.$eval('.earn-range', (x) => x.textContent)
      ok(range.includes(FX[key].from) && range.includes(FX[key].to), `«${label}»: الفترة المحلولة ظاهرة (${range})`)
      ok(new URL(page.url()).searchParams.get('period') === key, `«${label}» في الرابط`)
    }
    // التفصيل بفترةٍ متعدّدة الأيام: التاريخ مع الوقت
    await page.click(`.earn-row:has-text("${FX.month.doctors[0].doctor}") .rt-title`)
    await page.waitForSelector('.earn-detail')
    ok(await page.$$eval('.earn-date', (d) => d.length) === FX.month.doctors[0].lines.length, 'بفترة أيام: التاريخ على كل سطر')
    await page.click('.earn-periods >> text=من — إلى')
    await page.waitForSelector('#earn-from')
    ok(!new URL(page.url()).searchParams.get('doctor'), 'تغيير الفترة يُغلق التفصيل')
    await page.fill('#earn-from', FX.custom.from)
    await page.fill('#earn-to', FX.custom.to)
    await page.waitForTimeout(300)
    ok(calls.some((c) => c === `/clinic/procedures/earnings?from=${FX.custom.from}&to=${FX.custom.to}`), '★ «من — إلى» يُرسل التاريخين')
    await page.fill('#earn-from', '2020-01-01')
    await page.fill('#earn-to', '2020-01-01')
    await page.waitForSelector('text=لا إجراءات في هذه الفترة.')
    ok(await page.$('.earn-row') === null, 'فترةٌ بلا إجراءات: رسالةٌ لا جدولٌ فارغ')
    ok(await page.$eval('.earn-export', (b) => b.disabled), 'والإكسل معطَّل')
    await ctx.close()
  }

  // ═══ ٤) التحذيرات ═══
  console.log('\n── ٤) بلا قاعدة والشفاء سالبة ──')
  for (const [w, theme] of [[1366, 'light'], [390, 'dark'], [390, 'light'], [1366, 'dark']]) {
    const { ctx, page } = await open(browser, { w, h: w === 390 ? 844 : 800, theme, today: 'rich' })
    await page.waitForSelector('.earn-row')
    const rows = await summaryRows(page)
    ok(rows.length === 3, `[${w}-${theme}] ثلاثة دكاترة`)
    ok(rows.some((r) => r.badges.some((b) => b.includes('بلا قاعدة'))), `[${w}-${theme}] شارة «بلا قاعدة»`)
    ok(rows.some((r) => r.badges.some((b) => b.includes('الشفاء سالبة'))), `[${w}-${theme}] شارة «الشفاء سالبة»`)
    await shot(page, `rich-summary-${w}-${theme}`)
    const neg = FX.rich.doctors.find((d) => d.negative > 0)
    await page.click(`.earn-row:has-text("${neg.doctor}") .rt-title`)
    await page.waitForSelector('.earn-detail')
    ok(await page.$$eval('tr.earn-neg', (r) => r.length) === 1, `[${w}-${theme}] ★ السطر السالب بالأحمر`)
    ok(!(await layout(page)).hscroll, `[${w}-${theme}] بلا تمرير أفقي`)
    await shot(page, `rich-detail-${w}-${theme}`)
    await ctx.close()
  }

  // ═══ ٥) الصلاحيات ═══
  console.log('\n── ٥) الصلاحيات ──')
  for (const role of ['mgr', 'sup']) {
    const { ctx, page } = await open(browser, { role })
    await page.waitForSelector('.earn-row')
    ok(true, `${role}: يرى التبويب والملخّص`)
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { role: 'brd' })
    await page.waitForSelector('.proc-tabs')
    const tabs = await page.$$eval('.proc-tabs [role=tab]', (t) => t.map((x) => x.textContent))
    ok(tabs.join('|') === 'الإجراءات|المراجعة', `★ المجلس: لا تبويب «المستحقات» (${tabs})`)
    ok(await page.$('.earn-card') === null && !calls.some((c) => c.includes('/earnings')), '★ والرابط المباشر يفتح الكتالوج ولا يطلب المستحقات')
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { role: 'rec' })
    await page.waitForTimeout(800)
    ok(new URL(page.url()).pathname !== '/clinic/procedures', `★ الاستقبال لا يرى الصفحة (${new URL(page.url()).pathname})`)
    ok(!calls.some((c) => c.includes('/earnings')), 'ولا يطلب المستحقات')
    await ctx.close()
  }

  // ═══ ٦) الإكسل ═══
  console.log('\n── ٦) الإكسل ──')
  {
    const { ctx, page, calls } = await open(browser, { path: `${PATH}&period=week` })
    await page.waitForSelector('.earn-row')
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('.earn-export')])
    ok(!!dl, '★ زرّ الإكسل يُنزّل ملفّاً')
    ok(calls.includes('/clinic/procedures/earnings/export?period=week'), '★ بالفترة نفسها')
    await page.click(`.earn-row:has-text("${FX.week.doctors[0].doctor}") .rt-title`)
    await page.waitForSelector('.earn-detail')
    ok(await page.$eval('.earn-export', (b) => b.textContent) === 'إكسل هذا الدكتور', 'من التفصيل: «إكسل هذا الدكتور»')
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('.earn-export')])
    ok(calls.includes(`/clinic/procedures/earnings/export?period=week&doctor_id=${FX.week.doctors[0].doctorId}`), '★ وبالدكتور')
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ المستحقات: ${pass} ✔ · ${failures.length} ✘ ═══`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
