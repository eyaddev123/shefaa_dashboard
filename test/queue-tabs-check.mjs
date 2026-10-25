// ═══════════════════════════════════════════════════════════════════
// قائمة الدور بتبويبات — الحضور · بانتظار الحضور · انتهى · ما حضر
//
// يُشغَّل بـ: npm run test:tabs
//
// البيانات ردود الخادم الحقيقي ملتقَطة (test/fixtures/queue-tabs.json من ديمو
// charity-demo/reception-tabs/populate.mjs): جلسة حضور بكل الحالات (قيد الكشف، بانتظار
// العودة، إسعافي حاضر، حاضرون، لم يحضروا، منتهون، ملغى، لم يحضر، مؤجَّل) وجلسة خانات.
// نفحص: ١) التوزيع والترتيب والعدّادات ٢) العدّادات تتحدّث بحدث البثّ بلا تحديث
// ٣) البحث بالاسم الجزئي ورقم الدور والهاتف وعدّ النتائج في كل تبويب، و× يمسح
// ٤) الرجوع من صفحة الزيارة بالتبويب والبحث والموضع ٥) التبويب الفارغ ٦) 1366 بلا تمرير أفقي
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.TABS_TEST_PORT || 5234)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/queue-tabs.json'), 'utf8'))
const ATT = String(FX.attendance), SLOTS = String(FX.slots)
const APPTS = FX.queues[ATT].appointments

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }
const clone = (o) => JSON.parse(JSON.stringify(o))
const byName = (n) => APPTS.find((a) => a.full_name === n)

// التوقّع مكتوبٌ هنا مستقلاً عن queue-tabs.js — لا نفحص الشيفرة بنفسها
const EXPECT = {
  present: ['arrived', 'in_service', 'waiting_return'],
  pending: ['waiting'],
  done: ['done'],
  absent: ['no_show', 'cancelled', 'postponed'],
}
const t = (x) => Date.parse(x || 0) || 0
const expectedNames = (tab, list = APPTS) => {
  const rows = list.map((a, i) => ({ a, i })).filter(({ a }) => EXPECT[tab].includes(a.status))
  if (tab === 'pending') rows.sort((x, y) => t(x.a.booked_at) - t(y.a.booked_at) || x.a.queue_number - y.a.queue_number)
  if (tab === 'done') rows.sort((x, y) => t(y.a.done_at) - t(x.a.done_at) || y.i - x.i)
  if (tab === 'absent') rows.sort((x, y) => x.a.queue_number - y.a.queue_number)
  return rows.map(({ a }) => a.full_name)
}

async function mockApi(page, { queueFor = (sid) => FX.queues[sid], events = null } = {}) {
  const calls = []
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    calls.push(p)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    let m
    if (p === '/auth/me') return json(FX.me.reception)
    if ((m = /^\/clinic\/sessions\/(\d+)\/queue$/.exec(p))) { const q = queueFor(m[1]); return q ? json(q) : json({}, 404) }
    if ((m = /^\/clinic\/sessions\/(\d+)\/slots$/.exec(p))) return json(FX.slots_list?.[m[1]] || { slots: [] })
    if (p === '/clinic/events') {
      if (!events) return json({ error: 'off' }, 403)
      const frame = await events()
      return frame ? route.fulfill({ status: 200, contentType: 'text/event-stream', body: frame }) : json({ error: 'off' }, 403)
    }
    return json([])
  })
  return calls
}
async function open(browser, path, { w = 1366, h = 768, ...mock } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', 'light') })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const calls = await mockApi(page, mock)
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await page.waitForSelector('.queue-tabs-card', { timeout: 8000 })
  return { ctx, page, errors, calls }
}
const tabText = (page, key) => page.locator(`.queue-tab[data-tab="${key}"]`).innerText()
const rowNames = (page) => page.locator('.queue-tabs-card tbody a.visit-link').allInnerTexts()
const selected = (page) => page.locator('.queue-tab[aria-selected="true"]').getAttribute('data-tab')

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

  // ═══ ١) التوزيع والترتيب والعدّادات ═══
  console.log('\n── ١) التوزيع والترتيب والعدّادات ──')
  {
    const { ctx, page, errors } = await open(browser, `/clinic/session/${ATT}`)
    ok(await selected(page) === 'pending', '«بانتظار الحضور» افتراضاً')
    ok(!(await page.$('.attn-pending-card')), 'بطاقة «لسا بانتظار» صارت تبويباً')
    const order = await page.locator('.queue-tab').evaluateAll((els) => els.map((e) => e.dataset.tab))
    ok(order.join() === 'pending,all,present,done,absent', `ترتيب التبويبات (${order})`)
    // «الكل»: القائمة كاملة بترتيب الخادم، وعدّادها = كل الحجوزات
    await page.locator('.queue-tab[data-tab="all"]').click()
    ok(JSON.stringify(await rowNames(page)) === JSON.stringify(APPTS.map((a) => a.full_name)), 'الكل: كل الحجوزات بترتيب الخادم')
    ok((await tabText(page, 'all')).includes(`(${APPTS.length})`), `الكل: العدّاد (${await tabText(page, 'all')})`)
    ok(await page.locator('.queue-tabs-card tbody button', { hasText: 'ما حضر' }).count() === expectedNames('pending').length, 'الكل: «ما حضر» لمن لم يحضر وحده')
    for (const tab of Object.keys(EXPECT)) {
      await page.locator(`.queue-tab[data-tab="${tab}"]`).click()
      const want = expectedNames(tab)
      const got = await rowNames(page)
      ok(JSON.stringify(got) === JSON.stringify(want), `${tab}: الصفوف والترتيب\n     got  ${got.join('، ')}\n     want ${want.join('، ')}`)
      ok((await tabText(page, tab)).includes(`(${want.length})`), `${tab}: العدّاد (${await tabText(page, tab)})`)
      ok(new URL(page.url()).searchParams.get('tab') === (tab === 'pending' ? null : tab), `${tab}: في العنوان`)
    }
    // الحالات الخاصّة
    await page.locator('.queue-tab[data-tab="present"]').click()
    const present = await rowNames(page)
    const urgent = APPTS.find((a) => a.priority === 'urgent' && a.status === 'arrived')
    const firstArrived = APPTS.find((a) => a.status === 'arrived')
    ok(present.includes(urgent.full_name) && present.indexOf(urgent.full_name) === present.indexOf(firstArrived.full_name),
      'الإسعافي الحاضر أوّل الحاضرين (ترتيب الخادم)')
    ok(present.includes(APPTS.find((a) => a.status === 'waiting_return').full_name), '«بانتظار العودة» في الحضور')
    ok((await page.locator('.queue-tabs-card tbody tr', { hasText: urgent.full_name }).innerText()).includes('إسعافي'), 'شارة الإسعافي باقية')
    await page.locator('.queue-tab[data-tab="absent"]').click()
    const absent = await page.locator('.queue-tabs-card tbody').innerText()
    ok(absent.includes('ملغى') && absent.includes('لم يحضر') && absent.includes('مؤجَّل'), 'ما حضر: شارة السبب لكل صفّ (ملغى · لم يحضر · مؤجَّل)')
    ok(!absent.includes('postponed'), 'لا «postponed» بالإنكليزية')
    await page.locator('.queue-tab[data-tab="pending"]').click()
    ok(await page.locator('.queue-tabs-card tbody button', { hasText: 'ما حضر' }).count() === expectedNames('pending').length, 'بانتظار الحضور: زرّ «ما حضر» لكل صفّ')
    ok(await page.locator('.queue-tabs-card tbody button', { hasText: 'حضر' }).count() >= expectedNames('pending').length, 'بانتظار الحضور: «حضر» باقٍ')
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '1366: بلا تمرير أفقي للصفحة')
    ok(errors.length === 0, `بلا أخطاء (${errors.join(' | ')})`)
    await ctx.close()
  }
  {
    // الخانات: التبويبات نفسها، والفارغ بنصّه
    const { ctx, page, errors: e2 } = await open(browser, `/clinic/session/${SLOTS}?tab=done`)
    ok(e2.length === 0, `خانات: بلا أخطاء (${e2.join(' | ')})`)
    ok(await selected(page) === 'done', 'خانات: التبويب من العنوان')
    ok((await tabText(page, 'done')).includes('(0)'), 'خانات: «انتهى (0)»')
    ok((await page.locator('.queue-tab-empty').innerText()).includes('ما في حدا انتهى'), 'تبويب فارغ: نصّه')
    await page.locator('.queue-tab[data-tab="pending"]').click()
    ok(JSON.stringify(await rowNames(page)) === JSON.stringify(expectedNames('pending', FX.queues[SLOTS].appointments)) ||
      (await rowNames(page)).length === FX.queues[SLOTS].appointments.filter((a) => a.status === 'waiting').length, 'خانات: بانتظار الحضور')
    await ctx.close()
  }

  // ═══ ٢) العدّادات تتحدّث بحدث البثّ — والتبويب المفتوح غيره ═══
  console.log('\n── ٢) العدّادات مع البثّ ──')
  {
    const after = clone(FX.queues[ATT])
    const w = after.appointments.find((a) => a.status === 'waiting'); w.status = 'arrived'; w.arrival_number = 99
    const ar = after.appointments.find((a) => a.status === 'arrived' && a.priority === 'normal'); ar.status = 'done'; ar.done_at = new Date().toISOString()
    let changed = false, release, delivered = false
    const fire = new Promise((r) => { release = r })
    const { ctx, page } = await open(browser, `/clinic/session/${ATT}?tab=absent`, {
      queueFor: (sid) => (sid === ATT && changed ? after : FX.queues[sid]),
      events: async () => {
        if (delivered) return null
        await fire
        setTimeout(() => { delivered = true }, 100)
        return `event: refresh\ndata: ${JSON.stringify({ session_id: Number(ATT) })}\n\n`
      },
    })
    await page.evaluate(() => { window.__sameDoc = true })
    const before = { present: expectedNames('present').length, pending: expectedNames('pending').length, done: expectedNames('done').length }
    changed = true; release()
    const updated = await page.waitForFunction((b) => {
      const txt = (k) => document.querySelector(`.queue-tab[data-tab="${k}"]`)?.innerText || ''
      return txt('pending').includes(`(${b.pending - 1})`) && txt('done').includes(`(${b.done + 1})`)
    }, before, { timeout: 5000 }).then(() => true).catch(() => false)
    ok(updated, 'حدث البثّ ⇐ «بانتظار الحضور» −١ و«انتهى» +١')
    ok((await tabText(page, 'present')).includes(`(${before.present})`), 'الحضور: +١ حاضر −١ منتهٍ = كما هو')
    ok(await page.evaluate(() => window.__sameDoc === true), 'بلا تحديث للصفحة')
    ok(await selected(page) === 'absent', 'التبويب المفتوح باقٍ')
    await ctx.close()
  }

  // ═══ ٣) البحث ═══
  console.log('\n── ٣) البحث ──')
  {
    const { ctx, page } = await open(browser, `/clinic/session/${ATT}`)
    const search = page.locator('.queue-search input')
    const counts = async () => Object.fromEntries(await Promise.all(Object.keys(EXPECT).map(async (k) => [k, await tabText(page, k)])))
    // اسمٌ جزئي بلا همزة: «رنا» ⇒ في «انتهى» وحدها
    const rana = APPTS.find((a) => a.full_name.startsWith('رنا'))
    await search.fill('رنا')
    let c = await counts()
    ok(c.present.includes(`(0 من ${expectedNames('present').length})`), `اسم جزئي: الحضور (0 من N) — ${c.present}`)
    ok(c.done.includes(`(1 من ${expectedNames('done').length})`), `اسم جزئي: انتهى (1 من N) — ${c.done}`)
    ok((await tabText(page, 'all')).includes(`(1 من ${APPTS.length})`), `اسم جزئي: الكل (1 من N) — ${await tabText(page, 'all')}`)
    ok(!(await page.locator('.queue-tab-jump', { hasText: 'الكل' }).count()), '«موجود في» بلا «الكل»')
    ok((await page.locator('.queue-tab-empty').innerText()).includes('موجود في'), 'لا نتيجة هنا ⇐ «موجود في: انتهى»')
    await page.locator('.queue-tab-jump', { hasText: 'انتهى' }).click()
    ok(await selected(page) === 'done' && JSON.stringify(await rowNames(page)) === JSON.stringify([rana.full_name]), 'القفز إلى التبويب ⇐ النتيجة وحدها')
    ok(new URL(page.url()).searchParams.get('q') === 'رنا', 'البحث في العنوان')
    // تطبيع: «ابراهيم» تجد «إبراهيم»
    await search.fill('ابراهيم')
    const ibr = APPTS.filter((a) => a.full_name.includes('إبراهيم') || a.full_name.includes('ابراهيم'))
    c = await counts()
    const total = Object.values(c).reduce((s, x) => s + Number(/\((\d+) من/.exec(x)?.[1] || 0), 0)
    ok(total === ibr.length && ibr.length > 0, `«ابراهيم» تجد «إبراهيم» (${total}/${ibr.length})`)
    // رقم الدور: الحاضر برقم حضوره لا برقم حجزه
    const urgent = APPTS.find((a) => a.priority === 'urgent' && a.status === 'arrived')
    await page.locator('.queue-tab[data-tab="present"]').click()
    await search.fill(String(urgent.arrival_number))
    ok(JSON.stringify(await rowNames(page)) === JSON.stringify([urgent.full_name]), `رقم الدور ${urgent.arrival_number} ⇐ ${urgent.full_name} وحده`)
    // بأرقام عربية
    await search.fill(String(urgent.arrival_number).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]))
    ok(JSON.stringify(await rowNames(page)) === JSON.stringify([urgent.full_name]), 'رقم الدور بأرقام عربية')
    // من لم يحضر: برقم حجزه
    const pend = APPTS.find((a) => a.status === 'waiting')
    await search.fill(String(pend.queue_number))
    c = await counts()
    ok(c.pending.includes('(1 من'), `رقم حجز من لم يحضر ⇐ بانتظار الحضور (1) — ${c.pending}`)
    // الهاتف: كاملاً وجزءاً
    await search.fill(urgent.mobile)
    ok(JSON.stringify(await rowNames(page)) === JSON.stringify([urgent.full_name]), 'الهاتف كاملاً')
    await search.fill(urgent.mobile.slice(-6))
    ok((await rowNames(page)).includes(urgent.full_name), 'جزء من الهاتف')
    // × يمسح ويعيد كل شيء
    await page.locator('.queue-search-clear').click()
    ok(await search.inputValue() === '' && !new URL(page.url()).searchParams.get('q'), '× يمسح البحث')
    ok((await tabText(page, 'present')).includes(`(${expectedNames('present').length})`) && !(await tabText(page, 'present')).includes('من'), '× يعيد العدّادات')
    ok((await rowNames(page)).length === expectedNames('present').length, '× يعيد الصفوف')
    await ctx.close()
  }

  // ═══ ٤) الرجوع من صفحة الزيارة بالتبويب والبحث والموضع ═══
  console.log('\n── ٤) الرجوع من صفحة الزيارة ──')
  {
    const { ctx, page } = await open(browser, `/clinic/session/${ATT}?tab=done&q=${encodeURIComponent('ا')}`, { h: 500 })
    const names = await rowNames(page)
    const target = names[names.length - 1]
    const link = page.locator('a.visit-link', { hasText: target })
    await link.scrollIntoViewIfNeeded()
    const y0 = await page.evaluate(() => window.scrollY)
    ok(y0 > 50, `مُمرَّر قبل الفتح (${y0})`)
    await link.click()
    await page.waitForSelector('.visit-page')
    await page.locator('.visit-back').click()
    await page.waitForSelector('.queue-tabs-card')
    await page.waitForTimeout(200)
    const u = new URL(page.url())
    ok(u.searchParams.get('tab') === 'done' && u.searchParams.get('q') === 'ا', `رجوع ⇐ التبويب والبحث نفسهما (${u.search})`)
    ok(await selected(page) === 'done' && await page.locator('.queue-search input').inputValue() === 'ا', 'رجوع ⇐ الواجهة كما كانت')
    const y1 = await page.evaluate(() => window.scrollY)
    ok(Math.abs(y1 - y0) <= 4, `رجوع ⇐ الموضع نفسه (${y0} ⇐ ${y1})`)
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
  console.log('✔ التبويبات: التوزيع والعدّادات الحيّة والبحث والرجوع\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
