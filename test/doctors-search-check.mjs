// ═══════════════════════════════════════════════════════════════════
// البحث في قائمة الدكاترة + نافذة «إضافة دكتور» — /clinic/doctors
//
// يُشغَّل بـ: npm run test:doctors
//
// البيانات ردودُ الخادم الحقيقي ملتقَطةً (test/fixtures/doctors-search.json من ديمو
// charity-demo/doctors-search/capture.mjs) — فلا خادم ولا قاعدة هنا. نفحص:
//   ١) doctorMatches: الهمزات والتاء المربوطة والياء، الاختصاص، والجوال بمسافاتٍ وشُرَط وأرقامٍ عربية
//   ٢) في متصفّح حقيقي × 1366 و390 × فاتح/داكن: الترشيح الفوري والعدد و× وحالة «لا نتائج»،
//      بلا تمرير أفقي ولا طلبٍ للخادم أثناء الكتابة
//   ٣) النافذة: Esc فارغةً يُغلق، ومكتوبةً يسأل «تجاهل التغييرات؟» (والتراجع يُبقي القيم)،
//      والخطأ يبقى داخلها بقيمه، والنجاح يُغلق ويضيف السطر (مرشَّحاً بالبحث) مع إشعار،
//      والطلب نفسه بحقوله كما كان؛ وعلى 390 ورقةٌ سفلية بعرض الشاشة
//   ٤) المدير لا يرى زرّ الإضافة (الخادم يرفضها لغير مشرف العيادات أصلاً)
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.DOCTORS_TEST_PORT || 5242)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/doctors-search.json'), 'utf8'))
const { doctorMatches } = await import(pathToFileURL(resolve(ROOT, 'src/doctor-search.js')))

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }
const names = (q) => FX.doctors.filter((d) => doctorMatches(d, q)).map((d) => d.name)

// ═══ ١) المطابقة ═══
console.log('\n── ١) doctorMatches ──')
for (const [q, want] of [
  ['ايه', ['د. آية الخطيب']],                         // آ ⇒ ا، ة ⇒ ه
  ['آية', ['د. آية الخطيب']],
  ['ايمان', ['د. إيمان الحسن']],                       // إ ⇒ ا
  ['اسامه', ['د. أسامة القاسم']],                      // أ ⇒ ا، ة ⇒ ه
  ['يحيي', ['د. يحيى المصري']],                        // ى ⇒ ي
  ['جراحه', ['د. أسامة القاسم', 'د. نور خولاني']],      // الاختصاص
  ['اطفال', ['د. إيمان الحسن', 'د. خالد الشامي']],
  ['0933 456', ['د. آية الخطيب']],                     // الجوال كما خُزِّن
  ['0933456789', ['د. آية الخطيب']],                   // بلا مسافات ⇒ أرقامٌ وحدها
  ['0944-123', ['د. ريم النجار']],
  ['٠٩٩١', ['د. إيمان الحسن']],                        // أرقام عربية
  ['زززز', []],
]) ok(JSON.stringify(names(q)) === JSON.stringify(want), `«${q}» ⇒ ${JSON.stringify(names(q))} لا ${JSON.stringify(want)}`)
ok(names('').length === FX.doctors.length && names('   ').length === FX.doctors.length, 'البحث الفارغ يعرض الكل')
ok(names('933').length >= 3, '«933» جزءٌ من الجوال يطابق كل من فيه')
console.log(`  ${pass} ✔`)

// ═══ الخادم المُحاكى: القائمة، وإضافةٌ تفشل مرّةً ثمّ تنجح ═══
const NEW = { id: 99, name: 'د. سامي الجديد', specialty: null, specialty_id: null, specialty_name: null, phone: '0911 000 999',
  consultation_fee: '15000.00', followup_fee: '5000.00', expected_visit_minutes: 15, is_active: true }
async function mockApi(page, { role = 'clinic_admin', postFail = false } = {}) {
  const st = { doctors: [...FX.doctors], posts: [], gets: 0, postFail }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(FX.me[role])
    if (p === '/clinic/doctors' && req.method() === 'GET') { st.gets++; return json(st.doctors) }
    if (p === '/clinic/doctors' && req.method() === 'POST') {
      st.posts.push(req.postDataJSON())
      if (st.postFail) { st.postFail = false; return json({ error: 'اسم الدكتور مستعمل لدكتورٍ آخر' }, 400) }
      st.doctors = [...st.doctors, NEW].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      return json(NEW, 201)
    }
    if (p === '/clinic/specialties') return json(FX.specialties)
    if (p === '/notifications') return json([])
    return json([])
  })
  return st
}
async function open(browser, { w, h = 844, theme = 'light', role, postFail } = {}) {
  const mobile = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar', isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const st = await mockApi(page, { role, postFail })
  await page.goto(`${BASE}/clinic/doctors`, { waitUntil: 'load' })
  await page.waitForSelector('table.rtable tbody tr', { timeout: 8000 })
  return { ctx, page, errors, st }
}
const rows = (page) => page.$$eval('.card table.rtable > tbody > tr:not(.rt-sub)', (trs) => trs.map((t) => t.querySelector('td')?.innerText.trim()))
const count = (page) => page.$eval('.doctors-count', (e) => e.innerText.trim())
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

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
  const total = FX.doctors.length

  for (const w of [1366, 390]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${w} ${theme}`
      console.log(`\n── ٢+٣) ${tag} ──`)
      const { ctx, page, errors, st } = await open(browser, { w, theme })
      const search = page.getByRole('searchbox', { name: 'ابحث في الدكاترة' })

      // ═══ ٢) البحث ═══
      ok((await rows(page)).length === total && (await count(page)) === `${total} دكتور`, `${tag}: العدد الأوّل «${await count(page)}»`)
      const getsBefore = st.gets
      await search.pressSequentially('ايه', { delay: 30 })
      ok(JSON.stringify(await rows(page)) === JSON.stringify(['د. آية الخطيب']), `${tag}: «ايه» ⇒ ${await rows(page)}`)
      ok((await count(page)) === `1 من ${total} دكتور`, `${tag}: العدد بعد البحث «${await count(page)}»`)
      ok(st.gets === getsBefore, `${tag}: الكتابة لا تطلب الخادم`)
      await search.fill('جراحه')
      ok((await rows(page)).length === 2 && (await count(page)) === `2 من ${total} دكتور`, `${tag}: «جراحه» ⇒ اثنان`)
      await search.fill('0933 600')
      ok(JSON.stringify(await rows(page)) === JSON.stringify(['د. هدى العلي']), `${tag}: بالجوال ⇒ ${await rows(page)}`)
      await page.getByRole('button', { name: 'مسح البحث' }).click()
      ok((await search.inputValue()) === '' && (await rows(page)).length === total && (await count(page)) === `${total} دكتور`, `${tag}: × يمسح ويعيد الكل`)
      ok((await page.getByRole('button', { name: 'مسح البحث' }).count()) === 0, `${tag}: × يختفي حين لا بحث`)
      await search.fill('زززز')
      const empty = await page.$('.inv-empty')
      ok(!!empty && (await empty.innerText()).includes('ما في دكتور بهالاسم') && (await page.$$('.card table.rtable')).length === 0,
        `${tag}: حالة «لا نتائج» بدل جدولٍ فارغ`)
      ok(await noHScroll(page), `${tag}: بلا تمرير أفقي (لا نتائج)`)
      await page.locator('.inv-empty').getByRole('button', { name: 'مسح البحث' }).click()
      ok((await rows(page)).length === total, `${tag}: زرّ «مسح البحث» في الحالة الفارغة يعيد الكل`)
      ok(await noHScroll(page), `${tag}: بلا تمرير أفقي`)

      // ═══ ٣) النافذة ═══
      const addBtn = page.getByRole('button', { name: '+ إضافة دكتور' })
      const modal = page.getByRole('dialog', { name: 'إضافة دكتور' })
      await addBtn.click(); await modal.waitFor()
      ok(await page.evaluate(() => document.activeElement?.closest('.field')?.innerText.includes('اسم الدكتور')), `${tag}: التركيز على الاسم`)
      if (w === 390) {
        const r = await modal.boundingBox()
        ok(r.width >= 389 && Math.abs(r.y + r.height - 844) < 2, `${tag}: ورقةٌ سفلية بعرض الشاشة (${JSON.stringify(r)})`)
        const small = await modal.locator('input, select, button').evaluateAll((els) => els
          .filter((e) => e.offsetParent && e.type !== 'checkbox' && !e.closest('.specialty-picker'))
          .filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.innerText || e.name || e.type))
        ok(small.length === 0, `${tag}: الحقول والأزرار بإصبع (44px) — الأصغر: ${small}`)
        ok(await modal.evaluate((m) => m.scrollWidth <= m.clientWidth), `${tag}: لا تمرير أفقي داخل النافذة`)
      }
      await page.keyboard.press('Escape')
      ok(await modal.count() === 0, `${tag}: Esc على نافذةٍ فارغة يُغلقها بلا سؤال`)

      await addBtn.click(); await modal.waitFor()
      await modal.getByLabel('اسم الدكتور').fill('د. سامي الجديد')
      await page.keyboard.press('Escape')
      const ask = page.getByRole('dialog').filter({ hasText: 'تجاهل التغييرات؟' })
      await ask.waitFor({ timeout: 3000 }).catch(() => {})
      ok(await ask.count() === 1, `${tag}: Esc مع قيمٍ مكتوبة يسأل «تجاهل التغييرات؟»`)
      await ask.getByRole('button', { name: 'متابعة الكتابة' }).click()
      ok(await modal.count() === 1 && (await modal.getByLabel('اسم الدكتور').inputValue()) === 'د. سامي الجديد'
        && (await page.getByRole('dialog').filter({ hasText: 'تجاهل التغييرات؟' }).count()) === 0,
        `${tag}: «متابعة الكتابة» تُبقي النافذة وقيمها (سؤالٌ واحد لا اثنان)`)
      // Esc على سؤال التأكيد نفسه: يُغلق السؤال وحده، والنافذة باقية بقيمها
      await page.keyboard.press('Escape')
      await ask.waitFor({ timeout: 3000 }).catch(() => {})
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
      ok(await ask.count() === 0 && await modal.count() === 1
        && (await modal.getByLabel('اسم الدكتور').inputValue()) === 'د. سامي الجديد', `${tag}: Esc على السؤال يتراجع ولا يُغلق النافذة`)
      // النقر خارجها: في أعلى الخلفية فوق النافذة
      await page.mouse.click(10, 10)
      await ask.waitFor({ timeout: 3000 }).catch(() => {})
      ok(await ask.count() === 1, `${tag}: النقر خارجها يسأل كذلك`)
      await ask.getByRole('button', { name: 'تجاهل' }).click()
      ok(await modal.count() === 0, `${tag}: «تجاهل» يُغلق`)

      // خطأ ثمّ نجاح — والبحث مكتوبٌ مسبقاً: الجديد يظهر مرشَّحاً
      st.postFail = true
      await search.fill('سامي')
      ok((await rows(page)).length === 0, `${tag}: «سامي» قبل الإضافة ⇒ لا أحد`)
      await page.locator('.inv-empty').waitFor()
      await addBtn.click(); await modal.waitFor()
      await modal.getByLabel('اسم الدكتور').fill('د. سامي الجديد')
      await modal.getByLabel('الجوال').fill('0911 000 999')
      await modal.getByLabel('سعر المعاينة (ل.س)').fill('15000')
      await modal.getByLabel('سعر المراجعة (ل.س)').fill('5000')
      await modal.getByRole('button', { name: 'إضافة دكتور' }).click()
      await modal.locator('.error').waitFor({ timeout: 3000 }).catch(() => {})
      ok(await modal.count() === 1 && (await modal.locator('.error').innerText()).includes('مستعمل'), `${tag}: الخطأ داخل النافذة وهي مفتوحة`)
      // ظاهرٌ فعلاً حيث نُقر «إضافة»: لا تحت الطيّ ولا تحت شريط الأزرار الثابت على الجوال —
      // ما يقع تحت مركزه على الشاشة هو الخطأ نفسه
      const seen = await modal.locator('.error').evaluate((e) => {
        const r = e.getBoundingClientRect()
        return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
      })
      ok(seen, `${tag}: الخطأ ظاهرٌ لا مغطّى ولا تحت الطيّ`)
      ok((await modal.getByLabel('اسم الدكتور').inputValue()) === 'د. سامي الجديد'
        && (await modal.getByLabel('سعر المعاينة (ل.س)').inputValue()) === '15000', `${tag}: القيم باقية بعد الخطأ`)
      await modal.getByRole('button', { name: 'إضافة دكتور' }).click()
      await modal.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
      ok(await modal.count() === 0, `${tag}: النجاح يُغلق النافذة`)
      await page.waitForFunction((n) => document.querySelectorAll('.card table.rtable > tbody > tr').length >= 1, 1, { timeout: 3000 }).catch(() => {})
      ok(JSON.stringify(await rows(page)) === JSON.stringify(['د. سامي الجديد']) && (await count(page)) === `1 من ${total + 1} دكتور`,
        `${tag}: الجديد في القائمة فوراً ومرشَّحٌ بالبحث (${await rows(page)} · ${await count(page)})`)
      ok((await page.locator('.toast').innerText().catch(() => '')).includes('أُضيف د. سامي الجديد'), `${tag}: إشعار التأكيد`)
      const body = st.posts.at(-1)
      ok(st.posts.length === 2 && JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['accepts_urgent', 'consultation_fee', 'expected_visit_minutes',
        'followup_fee', 'followup_window_days', 'name', 'phone', 'room', 'specialty_id'])
        && body.consultation_fee === 15000 && body.followup_fee === 5000 && body.followup_window_days === 7
        && body.expected_visit_minutes === 15 && body.accepts_urgent === true,
        `${tag}: الطلب بحقوله وتحويلاته كما كان (${JSON.stringify(body)})`)
      ok(await noHScroll(page), `${tag}: بلا تمرير أفقي بعد الإضافة`)
      ok(errors.length === 0, `${tag}: أخطاء في الصفحة ${errors.join(' | ')}`)
      await ctx.close()
    }
  }

  // ═══ ٤) المدير يرى القائمة والبحث لا زرّ الإضافة ═══
  console.log('\n── ٤) المدير ──')
  {
    const { ctx, page } = await open(browser, { w: 1366, role: 'manager' })
    ok((await page.getByRole('button', { name: '+ إضافة دكتور' }).count()) === 0, 'المدير: لا زرّ إضافة')
    ok((await page.getByRole('searchbox', { name: 'ابحث في الدكاترة' }).count()) === 1, 'المدير: البحث متاح')
    await ctx.close()
  }

  await browser.close()
  stop()
  if (failures.length) { console.log(`\n✘ ${pass} ✔ · ${failures.length} ✘`); process.exit(1) }
  console.log(`\n✔ البحث في الدكاترة ونافذة الإضافة: ${pass} ✔ · 0 ✘`)
}
run().catch((e) => { console.error(e); process.exit(1) })
