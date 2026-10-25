// ═══════════════════════════════════════════════════════════════════
// شاشة «جرد الصندوق» في متصفّح حقيقي — /clinic/cash-report
//
// يُشغَّل بـ: npm run test:cash
//   CASH_SHOTS=/path/dir npm run test:cash   ← يحفظ لقطات الحالات (فاتح/داكن × 1366/1920)
//
// البيانات ردودُ الخادم الحقيقي ملتقَطةً (test/fixtures/cash-report.json من
//   CASH_JSON_OUT=… npm run test:cash-report في server) — فالحقول ما يرسله الخادم فعلاً.
// نفحص:
//   ١) أربعة دكاترة (مطويّة) · دكتوران (مفتوحة) · يومٌ بلا حركة × المقاسين × الثيمين:
//      بلا تمرير أفقي، البطاقات الخمس في صفّ والأولى أعرض، الأرقام = الخادم
//   ٢) الكتل مفتوحة: الأسطر والإجراءات بأسمائها والإحالة والصفّ الأصفر ومجموع الدكتور
//   ٣) فحص التطابق: أخضر حين يتطابقان وأحمر بالفرق حين يختلفان
//   ٤) الصلاحيات: الطبيب يُعاد إلى شاشته ولا رابط له · زرّ اللوحة يفتح الشاشة
//   ٥) «تحميل Excel» يطلب الملفّ من المسار نفسه بلا format
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.CASH_TEST_PORT || 5241)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/cash-report.json'), 'utf8'))
const SHOTS = process.env.CASH_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const ROLE_ME = { reception: 'rec', admin: 'adm', manager: 'mgr', doctor: 'doc1' }

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }
const clone = (o) => JSON.parse(JSON.stringify(o))
// «٢٦٠٬٠٠٠ ل.س» ⇒ 260000 — المقارنة بالرقم لا بالتنسيق
const digits = (t) => Number(String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, ''))

async function mockApi(page, { role, report }) {
  const calls = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api/, '')
    calls.push(`${p}${url.search}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(FX.me[ROLE_ME[role]])
    if (p === '/reception/cash-report') {
      if (role === 'doctor') return json({ error: 'forbidden' }, 403)
      if (url.searchParams.get('format') === 'json') return json(report)
      return route.fulfill({ status: 200, body: Buffer.from('PK-fake-xlsx'),
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="jard-${url.searchParams.get('date')}.xlsx"` } })
    }
    if (p === '/clinic/doctors') return json([])
    if (p === '/clinic/events') return json({ error: 'off' }, 403)
    return json([])
  })
  return calls
}

async function open(browser, { w = 1366, h = 768, theme = 'light', role = 'reception', report = FX.four, path = '/clinic/cash-report' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar', acceptDownloads: true })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const calls = await mockApi(page, { role, report })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

const measure = (page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.cash-tiles .tile')].map((t) => {
    const b = t.getBoundingClientRect()
    return { top: Math.round(b.top), w: Math.round(b.width), label: t.querySelector('.label').textContent,
      value: t.querySelector('.value').textContent, hint: t.querySelector('.hint')?.textContent || '' }
  })
  const docs = [...document.querySelectorAll('.cash-doc')].map((d) => ({
    open: d.classList.contains('is-open'),
    name: d.querySelector('.cash-doc-who strong').textContent,
    spec: d.querySelector('.cash-doc-spec').textContent,
    room: d.querySelector('.room-badge')?.textContent || '',
    total: d.querySelector('.cash-doc-total').textContent,
    count: d.querySelector('.cash-doc-count').textContent,
    rows: d.querySelectorAll('tbody tr').length,
    brk: [...d.querySelectorAll('.cash-doc-break > span')].map((x) => x.textContent),
    nameTop: Math.round(d.querySelector('.cash-doc-who strong').getBoundingClientRect().top),
    totalTop: Math.round(d.querySelector('.cash-doc-total').getBoundingClientRect().top),
    totalBottom: Math.round(d.querySelector('.cash-doc-total').getBoundingClientRect().bottom),
    brkTop: Math.round(d.querySelector('.cash-doc-break')?.getBoundingClientRect().top ?? -1),
    brkW: Math.round(d.querySelector('.cash-doc-break')?.scrollWidth ?? 0),
    brkCW: Math.round(d.querySelector('.cash-doc-break')?.clientWidth ?? 0),
    totalFs: parseFloat(getComputedStyle(d.querySelector('.cash-doc-total')).fontSize),
    brkFs: parseFloat(getComputedStyle(d.querySelector('.cash-doc-break')).fontSize),
  }))
  return {
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    theme: document.documentElement.dataset.theme, tiles, docs,
    grand: document.querySelector('.cash-grand-value')?.textContent || '',
    checkOk: !!document.querySelector('.cash-check.ok'), checkBad: document.querySelector('.cash-check.bad')?.textContent || '',
    empty: document.querySelector('.cash-empty')?.textContent || '',
  }
})

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

  // ═══ ١) الحالات × المقاسات × الثيمات ═══
  console.log('\n── ١) الحالات × المقاسات × الثيمات ──')
  for (const state of ['four', 'two', 'empty']) {
    const R = FX[state]
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      for (const theme of ['light', 'dark']) {
        const tag = `${state} ${w} ${theme}`
        const { ctx, page, errors } = await open(browser, { w, h, theme, report: R })
        await page.waitForSelector('.cash-doc, .cash-empty', { timeout: 8000 }).catch(() => {})
        let m = await measure(page)
        ok(errors.length === 0, `${tag}: أخطاء في الصفحة ${errors.join(' | ')}`)
        ok(m.scrollW <= m.innerW, `${tag}: تمرير أفقي (${m.scrollW} > ${m.innerW})`)
        ok(m.theme === theme, `${tag}: الثيم ${m.theme}`)
        if (state === 'empty') {
          ok(m.empty.includes('لا حركة في الصندوق'), `${tag}: الحالة الفارغة المصمَّمة`)
          ok(m.tiles.length === 0 && m.docs.length === 0, `${tag}: لا بطاقات ولا كتل في يومٍ فارغ`)
          await shot(page, `empty-${w}-${theme}`)
          await ctx.close(); continue
        }
        ok(m.tiles.length === 5, `${tag}: خمس بطاقات`)
        ok(new Set(m.tiles.map((t) => t.top)).size === 1, `${tag}: البطاقات في صفٍّ واحد`)
        ok(m.tiles[0].label === 'إجمالي اليوم' && m.tiles[0].w > Math.max(...m.tiles.slice(1).map((t) => t.w)),
          `${tag}: «إجمالي اليوم» أوّلاً وأعرضها`)
        const want = [R.totals.total, R.totals.patients, R.totals.fee, R.totals.procTotal, R.totals.discount]
        ok(m.tiles.every((t, i) => digits(t.value) === want[i]), `${tag}: أرقام البطاقات ${m.tiles.map((t) => digits(t.value))} ≠ ${want}`)
        ok(m.docs.length === R.doctors.length, `${tag}: كتلة لكل دكتور`)
        ok(m.docs.every((d, i) => d.name === R.doctors[i].doctor && digits(d.total) === R.doctors[i].totals.total
          && digits(d.count) === R.doctors[i].totals.patients), `${tag}: رأس الكتلة = الخادم (الاسم والمجموع والعدد)`)
        ok(m.docs.every((d, i) => d.spec === (R.doctors[i].specialty || '—')), `${tag}: الاختصاص أو «—»`)
        ok(digits(m.grand) === R.totals.total && m.checkOk, `${tag}: المجموع الكلي وفحص التطابق الأخضر`)
        // سطر التفصيل: ما لا قيمة له لا يظهر، والأرقام من الخادم كما هي
        ok(m.docs.every((d, i) => {
          const t = R.doctors[i].totals
          const want = [`الكشوف ${t.patients} ${t.fee}`]
          if (t.procCount > 0) want.push(`الإجراءات ${t.procCount} ${t.procTotal}`)
          if (t.referralCount > 0) want.push(`الإحالات ${t.referralCount} ${t.discount}`)
          return d.brk.length === want.length && d.brk.every((x, j) => {
            const [label, n, amount] = want[j].split(' ')
            const nums = x.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).match(/[\d,٬]+/g).map((v) => Number(v.replace(/[,٬]/g, '')))
            return x.startsWith(label) && nums[0] === Number(n) && nums[1] === Number(amount)
          })
        }), `${tag}: سطر التفصيل = الخادم (${m.docs.map((d) => d.brk.join(' | ')).join(' ‖ ')})`)
        ok(m.docs.every((d) => d.brk.every((x) => !/\(٠\)/.test(x) && !x.includes('·'))), `${tag}: لا «(٠)» ولا «·» بجانب الأرقام في التفصيل`)
        ok(m.docs.filter((d, i) => R.doctors[i].totals.referralCount > 0).every((d) => d.brk.some((x) => x.includes('−') && x.includes('على الجهات'))),
          `${tag}: الإحالات بصيغة خصم «− … على الجهات»`)
        ok(m.docs.every((d) => d.brkTop > d.nameTop && d.brkTop >= d.totalBottom - 4 && Math.abs(d.nameTop - d.totalTop) < 14),
          `${tag}: الاسم والمجموع في سطر، والتفصيل سطرٌ ثانٍ تحتهما`)
        ok(m.docs.every((d) => d.brkW <= d.brkCW + 1), `${tag}: التفصيل لا يفيض عن الرأس`)
        ok(m.docs.every((d) => d.totalFs > d.brkFs * 1.3), `${tag}: المجموع أبرز من التفصيل`)
        ok(digits(m.tiles[3].hint) === R.totals.procCount && digits(m.tiles[4].hint.split('على')[0]) === R.totals.referralCount,
          `${tag}: عدد الإجراءات والإحالات تحت بطاقتيهما (${m.tiles[3].hint} / ${m.tiles[4].hint})`)
        const autoOpen = R.doctors.length <= 3
        ok(m.docs.every((d) => d.open === autoOpen), `${tag}: الكتل ${autoOpen ? 'مفتوحة' : 'مطويّة'} افتراضاً`)
        await shot(page, `${state}-${autoOpen ? 'open' : 'closed'}-${w}-${theme}`)

        // الكتل الأخرى: افتح الكل (أو اطوِه) وقِس مرّةً ثانية
        await page.click('.cash-docs-head .link-btn')
        m = await measure(page)
        ok(m.docs.every((d) => d.open === !autoOpen), `${tag}: «${autoOpen ? 'طيّ' : 'فتح'} الكل»`)
        ok(m.scrollW <= m.innerW, `${tag}: بلا تمرير أفقي بعد ${autoOpen ? 'الطيّ' : 'الفتح'} (${m.scrollW})`)
        await shot(page, `${state}-${autoOpen ? 'closed' : 'open'}-${w}-${theme}`)
        await ctx.close()
      }
    }
  }
  console.log(`  ${pass} ✔ حتى الآن`)

  // ═══ ٢) محتوى الكتل المفتوحة ═══
  console.log('\n── ٢) الكتل مفتوحة ──')
  {
    const R = FX.four
    const { ctx, page } = await open(browser, { report: R })
    await page.waitForSelector('.cash-doc')
    // الكبسة على رأس الكتلة تفتحها وحدها
    await page.click('.cash-doc:nth-of-type(1) .cash-doc-head')
    const opened = await page.$$eval('.cash-doc', (ds) => ds.map((d) => d.classList.contains('is-open')))
    ok(opened[0] && opened.slice(1).every((x) => !x), `الكبسة تفتح كتلتها وحدها (${opened})`)
    ok(await page.$eval('.cash-doc .cash-doc-head', (b) => b.getAttribute('aria-expanded')) === 'true', 'aria-expanded')
    await page.click('.cash-docs-head .link-btn')   // فتح الكل
    const blocks = await page.$$eval('.cash-doc', (ds) => ds.map((d) => ({
      rows: [...d.querySelectorAll('tbody tr')].map((tr) => ({
        flag: tr.classList.contains('cash-flag'),
        cells: [...tr.children].map((td) => td.textContent),
        badges: [...tr.querySelectorAll('.badge')].map((b) => b.textContent),
        procs: [...tr.querySelectorAll('.cash-proc')].map((p) => p.textContent),
      })),
      foot: [...d.querySelectorAll('tfoot td')].map((td) => td.textContent),
      head: [...d.querySelectorAll('thead th')].map((th) => th.textContent),
    })))
    ok(blocks[0].head.join('|') === 'الدور|الاسم|الزيارة|الكشف|الإجراءات|الإحالة|المطلوب|الملاحظات', `أعمدة الجدول: ${blocks[0].head}`)
    const allLines = R.doctors.flatMap((d) => d.rows)
    const shown = blocks.flatMap((b) => b.rows)
    ok(shown.length === allLines.length, `كل الأسطر (${shown.length}/${allLines.length})`)
    ok(shown.every((r, i) => r.cells[1] === allLines[i].name && digits(r.cells[3]) === allLines[i].fee
      && digits(r.cells[6]) === allLines[i].total && r.flag === allLines[i].flagged), '★ كل سطر = الخادم (الاسم · الكشف · المطلوب · الأصفر)')
    const kIdx = allLines.findIndex((l) => l.referral)
    ok(kIdx >= 0 && shown[kIdx].cells[5].includes(allLines[kIdx].referral) && shown[kIdx].cells[5].includes('−')
      && digits(shown[kIdx].cells[5].replace(allLines[kIdx].referral, '')) === allLines[kIdx].discount, `★ الإحالة: الجهة والخصم (${shown[kIdx]?.cells[5]})`)
    const fIdx = allLines.findIndex((l) => l.flagged)
    ok(fIdx >= 0 && shown[fIdx].flag && shown[fIdx].badges.includes('سعر ناقص'), '★ الصفّ المعلَّم أصفر وعليه شارة «سعر ناقص»')
    const bIdx = allLines.findIndex((l) => l.procItems.length === 2)
    ok(bIdx >= 0 && shown[bIdx].procs.length === 2 && shown[bIdx].procs[0].includes(allLines[bIdx].procItems[0].name), '★ الإجراءات بأسمائها، كلٌّ في سطر')
    ok(blocks.every((b, i) => b.foot[0] === 'مجموع الدكتور' && digits(b.foot[1]) === R.doctors[i].totals.fee
      && digits(b.foot[4]) === R.doctors[i].totals.total), '★ سطر «مجموع الدكتور» = الخادم (الكشوف والكلي)')
    ok(await page.$$eval('.cash-doc-header-flag, .cash-doc .badge.warn', (b) => b.length) >= 1, 'شارة «للمراجعة» على رأس كتلة فيها صفّ معلَّم')
    const bg = await page.$eval('tr.cash-flag td', (td) => getComputedStyle(td).backgroundColor)
    ok(bg && bg !== 'rgba(0, 0, 0, 0)', `خلفية الصفّ المعلَّم (${bg})`)
    await ctx.close()
  }

  // ═══ ٣) فحص التطابق الأحمر ═══
  console.log('\n── ٣) فرق بين الحسابين ──')
  for (const theme of ['light', 'dark']) {
    const bad = clone(FX.two)
    bad.check = { ...bad.check, ok: false, diff: 1000, independentTotal: bad.totals.total - 1000 }
    const { ctx, page } = await open(browser, { report: bad, theme })
    await page.waitForSelector('.cash-grand')
    const m = await measure(page)
    ok(!m.checkOk && m.checkBad.includes('فرق بالمجموع') && digits(m.checkBad.split('\n')[0].split('ل.س')[0]) > 0,
      `${theme}: تحذيرٌ أحمر بالفرق (${m.checkBad})`)
    ok(await page.$eval('.cash-check.bad', (e) => e.getAttribute('role')) === 'alert', `${theme}: role=alert`)
    await page.$eval('.cash-grand', (e) => e.scrollIntoView())
    if (SHOTS) await page.locator('.cash-grand').screenshot({ path: `${SHOTS}/mismatch-${theme}.png` })
    await ctx.close()
  }

  // ═══ ٤) الصلاحيات والدخول ═══
  console.log('\n── ٤) الصلاحيات ──')
  {
    const { ctx, page, calls } = await open(browser, { role: 'doctor' })
    await page.waitForTimeout(600)
    ok(new URL(page.url()).pathname === '/clinic/doctor', `★ الطبيب يُعاد إلى شاشته (${page.url()})`)
    ok(!calls.some((c) => c.startsWith('/reception/cash-report')), '★ ولا يُطلب الجرد أصلاً')
    ok((await page.$$('a[href="/clinic/cash-report"]')).length === 0, '★ ولا رابط للجرد في قائمته')
    await ctx.close()
  }
  for (const role of ['reception', 'admin', 'manager']) {
    const { ctx, page } = await open(browser, { role })
    const okShown = await page.waitForSelector('.cash-doc', { timeout: 5000 }).then(() => true).catch(() => false)
    ok(okShown, `${role}: الشاشة تُفتح`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: '/clinic/board' })
    await page.click('text=جرد الصندوق')
    await page.waitForSelector('.cash-doc', { timeout: 5000 }).catch(() => {})
    ok(new URL(page.url()).pathname === '/clinic/cash-report', `★ زرّ اللوحة يفتح الشاشة لا ملفّاً (${page.url()})`)
    ok(!(await page.$('.modal-card')), 'ولا نافذة منبثقة')
    await page.click('text=→ رجوع')
    await page.waitForTimeout(300)
    ok(new URL(page.url()).pathname === '/clinic/board', `«رجوع» إلى اللوحة (${page.url()})`)
    await ctx.close()
  }

  // ═══ ٥) التاريخ و«تحميل Excel» ═══
  console.log('\n── ٥) التاريخ والملفّ ──')
  {
    const { ctx, page, calls } = await open(browser)
    await page.waitForSelector('.cash-doc')
    await page.fill('input[type=date]', '2026-10-20')
    await page.waitForTimeout(300)
    ok(calls.some((c) => c.startsWith('/reception/cash-report?') && c.includes('date=2026-10-20') && c.includes('format=json')),
      '★ تغيير التاريخ يطلب يومه')
    ok(page.url().includes('date=2026-10-20'), 'واليوم في الرابط')
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      page.click('text=تحميل Excel')])
    ok(!!dl && dl.suggestedFilename() === 'jard-2026-10-20.xlsx', `★ «تحميل Excel» يُنزّل ملفّ اليوم (${dl?.suggestedFilename()})`)
    const fileCall = calls.find((c) => c.startsWith('/reception/cash-report?') && !c.includes('format='))
    ok(!!fileCall && fileCall.includes('date=2026-10-20'), `★ من المسار نفسه بلا format (${fileCall})`)
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ شاشة الجرد: ${pass} ✔ · ${failures.length} ✘ ═══`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
