// ═══════════════════════════════════════════════════════════════════
// تبويب «المستحقات» في صفحة الإجراءات، في متصفّح حقيقي — /clinic/procedures?tab=earnings
// (بعد إزالة «المراجعة» 2026-11-15: أدواتها في هذا التبويب — «يحتاج انتباهك» وتصحيح المواد والأثر)
//
// يُشغَّل بـ: npm run test:earnings
//   EARNINGS_SHOTS=/path/dir npm run test:earnings   ← يحفظ اللقطات (ملخّص/تفصيل × فاتح/داكن × 1366/390)
//
// البيانات ردودُ الخادم الحقيقي ملتقَطةً (test/fixtures/earnings.json من
//   EARNINGS_JSON_OUT=… npm run test:earnings في server).
// نفحص:
//   ١) الملخّص × المقاسين × الثيمين: الأرقام = الخادم، بلا تمرير أفقي، وعلى 390 أزرارٌ 44px
//   ٢) الكبسة تفتح التفصيل (الدكتور في الرابط)، وزرّ الرجوع والمتصفّح يعودان إلى الملخّص
//   ٣) الفترات تُرسَل للخادم باسمها، و«من — إلى» بتاريخين؛ وفترةٌ فارغة تقول ذلك
//   ٤) «بلا قاعدة» و«الشفاء سالبة» في الملخّص والتفصيل وفي «يحتاج انتباهك»
//   ٥) «يحتاج انتباهك»: بانتظار المحاسبة (تعليم مدفوع) و«إجراء فقط» بلا إجراء، و«لا شيء ينتظرك»
//   ٦) تصحيح المواد والأثر من التفصيل (المشرفة وحدها تصحّح)
//   ٧) الصلاحيات: المجلس بلا تبويب (والرابط المباشر يعود للكتالوج)، و?tab=review القديم ⇐ المستحقات
//   ٨) الإكسل يُطلب بالفترة نفسها، وبالدكتور من التفصيل
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
const digits = (t) => Number(String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g, '').replace(/[^\d-]/g, ''))
const words = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${dd}/${m}` }   // «28/10» كالواجهة (fmtDay بلا سنة)

const UNPAID = { today: '2026-10-29', total: 1500, lines: [
  { id: 901, appointment_id: 77, name: 'ضماد صغير', patient_name: 'هند سمير', doctor_name: 'د. علي', price: 1000, session_date: '2026-10-28', added_at: '2026-10-28T09:00:00Z' },
  { id: 902, appointment_id: 78, name: 'إبرة', patient_name: 'وليد كمال', doctor_name: 'د. علي', price: 500, session_date: '2026-10-29', added_at: '2026-10-29T09:00:00Z' },
] }
const EMPTY_VISITS = [{ id: 55, session_id: 9, patient_name: 'رامي نبيل', doctor_name: 'د. علي', session_date: '2026-10-29' }]
// سطرٌ بشكل المراجعة للتصحيح (معرّفات المواد ونسخة التوزيع)
const LINE = (id) => ({ id: Number(id), appointment_id: 1, name_snapshot: 'تجبير', distribution_version: 2, consumables_estimate: 0,
  legacy_materials: 0, materials: [{ id: 1, material_id: 3, name: 'جبس', unit: 'علبة', qty: 2, unit_price: 8000, cost: 16000 }] })

async function mockApi(page, { role, today, unpaid = UNPAID, empty = EMPTY_VISITS }) {
  const calls = []
  const state = { unpaid: JSON.parse(JSON.stringify(unpaid)) }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api/, '')
    const m = route.request().method()
    calls.push(`${m === 'GET' ? '' : `${m} `}${p}${url.search}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(FX.me[role])
    if (p.startsWith('/clinic/procedures/earnings')) {
      if (!['adm', 'mgr', 'sup'].includes(role)) return json({ error: 'forbidden' }, 403)
      if (p.endsWith('/export'))
        return route.fulfill({ status: 200, body: Buffer.from('PK-fake'),
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': "attachment; filename=\"earnings.xlsx\"; filename*=UTF-8''%D9%85.xlsx" } })
      // 2026-11-18: شريط الفترة المشترك (يوم/شهر/فترة) يرسل من–إلى دائماً — يُطابَق بالتجهيزات بتاريخ البداية
      const q = url.searchParams
      const from = q.get('from'), to = q.get('to')
      if (from === '2020-01-01') return json(FX.empty)
      if (from === to) return json(from === FX.yesterday.from ? FX.yesterday : FX[today])
      return json(from === FX.month.from ? FX.month : from === FX.week.from ? FX.week : FX.custom)
    }
    if (p === '/clinic/procedures/unpaid') return json(state.unpaid)
    if (/\/mark-paid$/.test(p)) {
      const id = Number(p.split('/')[5])
      state.unpaid.lines = state.unpaid.lines.filter((l) => l.id !== id)
      return json({ ok: true })
    }
    if (p === '/clinic/procedures/empty-visits') return json({ visits: empty })
    if (/^\/clinic\/procedures\/lines\/\d+$/.test(p)) return json(LINE(p.split('/').pop()))
    if (/^\/clinic\/procedures\/\d+\/history$/.test(p)) return json([{ id: 1, changed_at: '2026-10-29T10:00:00Z', changed_by_name: 'أم أسامة',
      change_detail: [{ material: 'جبس', old_qty: 1, new_qty: 2 }], reason: null,
      old_materials: 8000, new_materials: 16000, old_doctor: 30000, new_doctor: 30000, old_shifa: 62000, new_shifa: 54000 }])
    if (/\/procedures\/\d+\/materials$/.test(p) && m === 'PUT') return json({ doctor_share: 30000, shifa_share: 50000 })
    if (p === '/clinic/materials') return json([{ id: 3, name: 'جبس', unit: 'علبة', unit_price: 8000, is_active: true, material_kind: 'counted', balance: 50 }])
    if (p === '/clinic/procedures') return json([])
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  return calls
}

async function open(browser, { w = 1366, h = 800, theme = 'light', role = 'adm', today = 'today', path = PATH, ...rest } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar', acceptDownloads: true })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const calls = await mockApi(page, { role, today, ...rest })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

const layout = (page) => page.evaluate(() => {
  const doc = document.scrollingElement
  const small = [...document.querySelectorAll('.pex-page button')]
    .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim())
  return { hscroll: doc.scrollWidth > doc.clientWidth + 1, small, bg: getComputedStyle(document.body).backgroundColor }
})

// الملخّص: لكلّ دكتور اسمه وعدده وأعمدته الأربعة (القيمة · المواد · للشفاء · حصّته)
const summaryRows = (page) => page.$$eval('.pex-doc', (rs) => rs.map((r) => ({
  name: r.querySelector('.pex-doc-name').textContent.trim(),
  meta: r.querySelector('.pex-meta').textContent,
  cols: [...r.querySelectorAll('.pex-doc-col')].map((c) => c.childNodes[1]?.textContent ?? ''),
  badges: [...r.querySelectorAll('.badge')].map((b) => b.textContent),
})))
const countIn = (meta, n) => (n === 1 ? meta.includes('إجراء واحد') : n === 2 ? meta.includes('إجراءان') : meta.includes(Number(n).toLocaleString('ar-SY-u-nu-latn')))

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
  console.log('\n── 1) الملخّص والتفصيل × المقاسات × الثيمات ──')
  for (const [w, h] of [[1366, 800], [390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${w}-${theme}`
    const { ctx, page, errors } = await open(browser, { w, h, theme })
    await page.waitForSelector('.pex-doc')
    const rows = await summaryRows(page)
    ok(rows.length === FX.today.doctors.length, `[${tag}] سطرٌ لكل دكتور له إجراءات (${rows.length})`)
    for (const d of FX.today.doctors) {
      const r = rows.find((x) => x.name === d.doctor)
      ok(r && r.cols.map(digits).join('/') === [d.totals.price, d.totals.materials, d.totals.shifa, d.totals.doctor].join('/'),
        `[${tag}] ${d.doctor}: الأرقام = الخادم (${r?.cols})`)
      ok(r && countIn(r.meta, d.totals.count), `[${tag}] ${d.doctor}: العدد (${r?.meta})`)
    }
    const T = FX.today.totals
    const big = await page.$$eval('.pex-totals .pex-big-value', (t) => t.map((x) => x.textContent))
    ok(big.map(digits).join('/') === [T.doctor, T.shifa, T.materials].join('/'), `[${tag}] ★ الأرقام الكبيرة: للدكاترة، للشفاء، المواد (${big})`)
    const sentence = await page.$eval('.pex-sentence', (x) => x.textContent)
    ok(sentence.includes(Number(T.price).toLocaleString('ar-SY-u-nu-latn')), `[${tag}] الجملة بالقيمة الكاملة (${sentence.slice(0, 40)})`)
    ok(await page.$eval('.dr-seg [aria-pressed=true]', (b) => b.textContent) === 'يوم', `[${tag}] «يوم» افتراضاً`)
    let L = await layout(page)
    ok(!L.hscroll, `[${tag}] ★ الملخّص بلا تمرير أفقي`)
    if (w === 390) ok(L.small.length === 0, `[${tag}] ★ كل الأزرار ≥ 44px (${L.small})`)
    ok(theme === 'dark' ? L.bg !== 'rgb(255, 255, 255)' : true, `[${tag}] خلفية الثيم`)
    await shot(page, `summary-${tag}`)

    const A = FX.today.doctors[0]
    await page.click(`.pex-doc:has-text("${A.doctor}")`)
    await page.waitForSelector('.pex-line')
    ok(new URL(page.url()).searchParams.get('doctor') === A.doctorId, `[${tag}] ★ الدكتور في الرابط`)
    ok(await page.$eval('.pex-doc-head h3', (x) => x.textContent) === A.doctor, `[${tag}] العنوان اسم الدكتور`)
    ok(await page.$('.pex-attn') === null && await page.$('.pex-allclear') === null, `[${tag}] التفصيل بلا شريط الانتباه`)
    const lines = await page.$$eval('.pex-line', (rs) => rs.map((r) => ({
      proc: r.querySelector('.pex-proc').textContent, rule: r.querySelector('.pex-rule').textContent,
      doc: r.querySelector('.pex-split-row strong').textContent, text: r.querySelector('.pex-what').textContent })))
    ok(lines.length === A.lines.length, `[${tag}] ★ إجراء إجراء (${lines.length})`)
    for (const l of A.lines) {
      const x = lines.find((y) => y.proc === l.procedure && y.text.includes(l.patient))
      const want = l.rule.replace(/[\d,]+/g, (n) => Number(n.replace(/,/g, '')).toLocaleString('ar-SY-u-nu-latn')).replace('%', '%')
      ok(x && x.rule === want && digits(x.doc) === l.doctor, `[${tag}] ${l.procedure}: ${want} ⇒ ${l.doctor} (${x?.rule} ${x?.doc})`)
    }
    ok(lines.some((x) => x.text.includes('جبس ×2')), `[${tag}] المواد بأسمائها وكمّياتها`)
    ok(lines.some((x) => x.text.includes('بلا مواد')), `[${tag}] «بلا مواد» لإجراءٍ بلا مواد`)
    L = await layout(page)
    ok(!L.hscroll, `[${tag}] ★ التفصيل بلا تمرير أفقي`)
    if (w === 390) ok(L.small.length === 0, `[${tag}] ★ أزرار التفصيل ≥ 44px (${L.small})`)
    await shot(page, `detail-${tag}`)

    await page.click('.pex-back')
    await page.waitForSelector('.pex-doc')
    ok(!new URL(page.url()).searchParams.get('doctor'), `[${tag}] «كلّ الدكاترة» يعود للملخّص`)
    await page.click(`.pex-doc:has-text("${A.doctor}")`)
    await page.waitForSelector('.pex-line')
    await page.goBack()
    await page.waitForSelector('.pex-doc')
    ok(new URL(page.url()).searchParams.get('tab') === 'procedures' && new URL(page.url()).pathname === '/clinic/payroll', `[${tag}] ★ زرّ رجوع المتصفّح يعود من التفصيل إلى الملخّص`)
    ok(errors.length === 0, `[${tag}] بلا أخطاء (${errors})`)
    await ctx.close()
  }

  // ═══ ٣) الفترات — شريط «كشوف الأجور» نفسه: يوم ثمّ شهر ثمّ فترة (2026-11-18) ═══
  console.log('\n── 3) الفترات ──')
  {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    let { ctx, page, calls } = await open(browser)
    await page.waitForSelector('.pex-doc')
    ok(JSON.stringify(await page.$$eval('.dr-seg button', (bs) => bs.map((b) => b.textContent))) === JSON.stringify(['يوم', 'شهر', 'فترة']), '★ الترتيب: يوم، شهر، فترة')
    ok(calls.some((c) => c === `/clinic/procedures/earnings?from=${today}&to=${today}`), `★ الافتراضيّ اليوم: من اليوم إليه (${calls.filter((c) => c.includes('earnings?'))})`)
    await page.click('.dr-seg >> text=شهر')
    await page.waitForTimeout(300)
    const ym = today.slice(0, 7), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    ok(calls.includes(`/clinic/procedures/earnings?from=${ym}-01&to=${ym}-${pad(last)}`), '★ «شهر» ⇒ من أوّل الشهر إلى آخره')
    ok(new URL(page.url()).searchParams.get('month') === ym, '«شهر» في الرابط')
    await ctx.close()
    ;({ ctx, page, calls } = await open(browser, { path: `${PATH}&day=${FX.yesterday.from}` }))
    await page.waitForSelector('.pex-doc')
    ok(calls.includes(`/clinic/procedures/earnings?from=${FX.yesterday.from}&to=${FX.yesterday.from}`), '★ يومٌ من الرابط')
    ok((await page.$eval('.pex-range', (x) => x.textContent)).includes(words(FX.yesterday.from)), 'اليوم المحلول ظاهر')
    await ctx.close()
    ;({ ctx, page, calls } = await open(browser, { path: `${PATH}&month=2026-10` }))
    await page.waitForSelector('.pex-doc')
    ok(calls.includes('/clinic/procedures/earnings?from=2026-10-01&to=2026-10-31'), '★ شهرٌ من الرابط ⇒ 1 إلى 31')
    ok(calls.some((c) => c.startsWith(`/clinic/procedures/empty-visits?from=${FX.month.from}&to=${FX.month.to}`)), '«إجراء فقط» بلا إجراء بمدى الفترة')
    // تفصيلٌ بفترةٍ متعدّدة الأيام: الأيام عناوين
    const M = FX.month.doctors[0]
    await page.click(`.pex-doc:has-text("${M.doctor}")`)
    await page.waitForSelector('.pex-line')
    ok(await page.$$eval('.pex-day', (x) => x.length) === new Set(M.lines.map((l) => l.date)).size, 'بفترة أيام: يومٌ لكلّ تاريخ')
    await page.click('.dr-seg >> text=يوم')
    await page.waitForTimeout(300)
    ok(!new URL(page.url()).searchParams.get('doctor'), 'تغيير الفترة يُغلق التفصيل')
    await ctx.close()
    ;({ ctx, page, calls } = await open(browser, { path: `${PATH}&from=${FX.custom.from}&to=${FX.custom.to}` }))
    await page.waitForSelector('.pex-doc')
    ok(calls.some((c) => c === `/clinic/procedures/earnings?from=${FX.custom.from}&to=${FX.custom.to}`), '★ «فترة» يُرسل التاريخين')
    ok(await page.$eval('.dr-seg [aria-pressed=true]', (b) => b.textContent) === 'فترة', '«فترة» مختارة')
    await ctx.close()
    ;({ ctx, page, calls } = await open(browser, { path: `${PATH}&from=2020-01-01&to=2020-01-01` }))
    await page.waitForSelector('text=لا إجراءات مقبوضة')
    ok(await page.$('.pex-doc') === null, 'فترةٌ بلا إجراءات: رسالةٌ لا جدولٌ فارغ')
    ok(await page.$eval('.pex-export', (b) => b.disabled), 'والإكسل معطَّل')
    await ctx.close()
  }

  // ═══ ٤) التحذيرات ═══
  console.log('\n── 4) بلا قاعدة والشفاء سالبة ──')
  for (const [w, theme] of [[1366, 'light'], [390, 'dark'], [390, 'light'], [1366, 'dark']]) {
    const { ctx, page } = await open(browser, { w, h: w === 390 ? 844 : 800, theme, today: 'rich' })
    await page.waitForSelector('.pex-doc')
    const rows = await summaryRows(page)
    ok(rows.length === 3, `[${w}-${theme}] ثلاثة دكاترة`)
    ok(rows.some((r) => r.badges.some((b) => b.includes('بلا قاعدة'))), `[${w}-${theme}] شارة «بلا قاعدة»`)
    ok(rows.some((r) => r.badges.some((b) => b.includes('الشفاء سالبة'))), `[${w}-${theme}] شارة «الشفاء سالبة»`)
    const chips = await page.$$eval('.pex-chip', (c) => c.map((x) => x.textContent))
    ok(chips.some((c) => c.includes('الشفاء سالبة')) && chips.some((c) => c.includes('بلا قاعدة')), `[${w}-${theme}] ★ والتنبيهان في «يحتاج انتباهك» (${chips})`)
    await shot(page, `rich-summary-${w}-${theme}`)
    // الكبس على تنبيه «الشفاء سالبة» يسرد سطوره، و«عند الدكتور» يفتح تفصيله
    await page.click('.pex-chip:has-text("الشفاء سالبة")')
    await page.waitForSelector('.pex-attn-body .pex-pline')
    const neg = FX.rich.doctors.find((d) => d.negative > 0)
    ok(await page.$$eval('.pex-attn-body .pex-pline', (r) => r.length) === neg.negative, `[${w}-${theme}] قائمة السالبة بعددها`)
    await page.click('.pex-attn-body .pex-pline button')
    await page.waitForSelector('.pex-line')
    ok(new URL(page.url()).searchParams.get('doctor') === neg.doctorId, `[${w}-${theme}] ★ «عند الدكتور» يفتح تفصيله`)
    ok(await page.$$eval('.pex-line.is-neg', (r) => r.length) === 1, `[${w}-${theme}] ★ السطر السالب بالأحمر`)
    ok(!(await layout(page)).hscroll, `[${w}-${theme}] بلا تمرير أفقي`)
    await shot(page, `rich-detail-${w}-${theme}`)
    await ctx.close()
  }

  // ═══ ٥) يحتاج انتباهك ═══
  console.log('\n── 5) بانتظار المحاسبة و«إجراء فقط» بلا إجراء ──')
  {
    const { ctx, page, calls, errors } = await open(browser)
    await page.waitForSelector('.pex-chip')
    const chips = await page.$$eval('.pex-chip', (c) => c.map((x) => x.textContent))
    ok(chips.some((c) => c.includes('بانتظار المحاسبة') && c.includes('2') && c.includes('1,500')), `★ بانتظار المحاسبة بعدده ومبلغه (${chips})`)
    ok(chips.some((c) => c.includes('بلا إجراء')), '★ و«إجراء فقط» بلا إجراء')
    await page.click('.pex-chip:has-text("بانتظار المحاسبة")')
    await page.waitForSelector('.pex-attn-body .pay-btn')
    ok(await page.$$eval('.pex-attn-body .pex-pline', (r) => r.length) === 2, 'سطران بأزرارهما')
    ok((await page.textContent('.pex-attn-body')).includes('من يومٍ سابق'), 'شارة «من يومٍ سابق»')
    await page.click('.pex-attn-body .pex-pline:has-text("ضماد صغير") .pay-btn')
    await page.waitForFunction(() => document.querySelectorAll('.pex-attn-body .pex-pline').length === 1)
    ok(calls.includes('POST /clinic/appointments/77/procedures/901/mark-paid'), '★ «تعليم مدفوع» يُرسل للخادم')
    ok(calls.filter((c) => c.startsWith('/clinic/procedures/earnings?')).length >= 2, 'والمستحقات تُعاد بعده')
    await page.click('.pex-chip:has-text("بلا إجراء")')
    await page.waitForSelector('.pex-attn-body a[href="/clinic/session/9/visit/55"]')
    ok(true, '★ «إجراء فقط» بلا إجراء: رابط الزيارة')
    ok(errors.length === 0, `بلا أخطاء (${errors})`)
    await shot(page, 'attention')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { unpaid: { today: '2026-10-29', total: 0, lines: [] }, empty: [] })
    await page.waitForSelector('.pex-allclear')
    ok(await page.$('.pex-attn') === null, '★ لا شيء ينتظر: سطرٌ أخضر لا شريط')
    await ctx.close()
  }
  {
    // المدير يرى الانتباه بلا أزرار المحاسبة
    const { ctx, page } = await open(browser, { role: 'mgr' })
    await page.click('.pex-chip:has-text("بانتظار المحاسبة")')
    await page.waitForSelector('.pex-attn-body .pex-pline')
    ok(await page.$('.pex-attn-body .pay-btn') === null, '★ المدير: القائمة بلا «تعليم مدفوع»')
    await ctx.close()
  }

  // ═══ ٦) تصحيح المواد والأثر ═══
  console.log('\n── 6) تصحيح المواد والأثر ──')
  {
    const { ctx, page, calls } = await open(browser)
    const A = FX.today.doctors[0]
    await page.click(`.pex-doc:has-text("${A.doctor}")`)
    const line = page.locator('.pex-line', { hasText: 'جبس' }).first()
    await line.locator('button', { hasText: 'تصحيح المواد' }).click()
    await page.waitForSelector('.pex-line-open .mat-actions')
    ok(calls.some((c) => /^\/clinic\/procedures\/lines\/\d+$/.test(c)), '★ السطر يُطلب بموادّه (معرّفاتها) للتصحيح')
    await page.click('.pex-line-open .mat-actions button:has-text("حفظ وإعادة الحساب")')
    await page.waitForFunction(() => !document.querySelector('.pex-line-open'))
    ok(calls.some((c) => /^PUT \/clinic\/appointments\/1\/procedures\/\d+\/materials$/.test(c)), '★ الحفظ يُرسل المواد للخادم')
    await line.locator('button', { hasText: 'الأثر' }).click()
    await page.waitForSelector('.pex-line-open .rev-history li')
    ok((await page.textContent('.pex-line-open')).includes('أم أسامة'), '★ الأثر بفاعله')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { role: 'mgr' })
    await page.click(`.pex-doc:has-text("${FX.today.doctors[0].doctor}")`)
    await page.waitForSelector('.pex-line')
    ok(await page.locator('.pex-line-acts button', { hasText: 'تصحيح المواد' }).count() === 0, '★ المدير: لا «تصحيح المواد»')
    ok(await page.locator('.pex-line-acts button', { hasText: 'الأثر' }).count() > 0, 'والأثر للاطّلاع')
    await ctx.close()
  }

  // ═══ ٧) الصلاحيات ═══
  console.log('\n── 7) الصلاحيات ──')
  for (const role of ['mgr', 'sup']) {
    const { ctx, page } = await open(browser, { role })
    await page.waitForSelector('.pex-doc')
    ok(true, `${role}: يرى التبويب والملخّص`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: '/clinic/procedures?tab=review' })
    await page.waitForSelector('.pex-doc')
    // 2026-11-18: «المستحقات» خرجت إلى «الرواتب والأجور» — الرابط القديم يُحوَّل إلى تبويب «تفصيل الإجراءات» فيها
    const tabs = await page.$$eval('.pcx-tabs [role=tab]', (t) => t.map((x) => x.childNodes[0].textContent))
    ok(tabs.join('|') === 'كشوف الأجور|تفصيل الإجراءات', `★ صفحة الرواتب والأجور بتبويبيها (${tabs})`)
    ok(await page.$eval('.pcx-tab.is-on', (t) => t.textContent) === 'تفصيل الإجراءات', '★ ?tab=review القديم يفتح «تفصيل الإجراءات»')
    ok(new URL(page.url()).pathname === '/clinic/payroll', `★ والعنوان صار /clinic/payroll (${page.url()})`)
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { role: 'brd' })
    await page.waitForSelector('.pcx-page')
    await page.waitForTimeout(400)
    ok(await page.$('.pcx-tabs') === null, '★ المجلس: لا تبويبات (الكتالوج وحده)')
    ok(await page.$('.pex-page') === null && !calls.some((c) => c.includes('/earnings')), '★ والرابط المباشر يفتح الكتالوج ولا يطلب المستحقات')
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { role: 'rec' })
    await page.waitForTimeout(800)
    ok(new URL(page.url()).pathname !== '/clinic/procedures', `★ الاستقبال لا يرى الصفحة (${new URL(page.url()).pathname})`)
    ok(!calls.some((c) => c.includes('/earnings')), 'ولا يطلب المستحقات')
    await ctx.close()
  }

  // ═══ ٨) الإكسل ═══
  console.log('\n── 8) الإكسل ──')
  {
    const { ctx, page, calls } = await open(browser, { path: `${PATH}&from=${FX.week.from}&to=${FX.week.to}` })
    await page.waitForSelector('.pex-doc')
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('.pex-export')])
    ok(!!dl, '★ زرّ الإكسل يُنزّل ملفّاً')
    ok(calls.includes(`/clinic/procedures/earnings/export?from=${FX.week.from}&to=${FX.week.to}`), '★ بالفترة نفسها')
    await page.click(`.pex-doc:has-text("${FX.week.doctors[0].doctor}")`)
    await page.waitForSelector('.pex-line')
    ok(await page.$eval('.pex-export', (b) => b.textContent) === 'إكسل هذا الدكتور', 'من التفصيل: «إكسل هذا الدكتور»')
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('.pex-export')])
    ok(calls.includes(`/clinic/procedures/earnings/export?from=${FX.week.from}&to=${FX.week.to}&doctor_id=${FX.week.doctors[0].doctorId}`), '★ وبالدكتور')
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ المستحقات: ${pass} ✔ · ${failures.length} ✘ ═══`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
