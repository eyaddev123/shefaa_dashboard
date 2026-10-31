// ═══════════════════════════════════════════════════════════════════
// صفحة الزيارة في متصفّح حقيقي — /clinic/session/:sid/visit/:id
//
// يُشغَّل بـ: npm run test:visit
//
// البيانات ردودُ الخادم الحقيقي ملتقَطةً (test/fixtures/visit-page.json من ديمو
// charity-demo/visit-page/capture.mjs) — فلا خادم ولا قاعدة هنا، والحقول هي ما
// يرسله الخادم فعلاً. نفحص:
//   ١) كل الحالات (حجز جديد، حاضر، قيد الكشف بإجراءات ومواد، منتهٍ بإحالتين، خروج مؤقت،
//      جلسة خانات، جلسة أمس) × 1366×768 و1920×1080 × فاتح/داكن: البطاقات الخمس،
//      العمودان، بلا تمرير أفقي، المبلغ النهائي من الخادم، والرأس ثابتٌ مع التمرير
//   ٢) الحالات الفارغة وما يخصّ كل حالة، والسجل مطويّ افتراضاً
//   ٣) الصلاحيات: الطبيب يُعاد إلى شاشته، والاستقبال بعد يوم الجلسة للاطّلاع
//   ٤) الطابور ⇐ الزيارة ⇐ رجوع إلى الموضع نفسه
//   ٥) التحديث الحيّ: حدث «visit» من بثّ الموظفين يُعيد التحميل فيظهر الإجراء الجديد
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.VISIT_TEST_PORT || 5233)
const BASE = `http://127.0.0.1:${PORT}`
const FX = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/visit-page.json'), 'utf8'))
const S = FX.states

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }
const clone = (o) => JSON.parse(JSON.stringify(o))
// «٣٥٬٠٠٠ ل.س» ⇒ 35000 — المقارنة بالرقم لا بالتنسيق
const digits = (t) => Number(String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, ''))
const apptOf = (key) => FX.queues[S[key].session].appointments.find((a) => String(a.id) === String(S[key].appt))

// ═══ الخادم المُحاكى ═══
// queueFor(sid) قابلٌ للاستبدال في فحص التحديث الحيّ؛ وبثّ الموظفين 403 افتراضاً (فلا يُعيد
// الاتصال) إلا حين يُطلب حدث.
async function mockApi(page, { role = 'reception', queueFor = (sid) => FX.queues[sid], events = null } = {}) {
  const calls = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api/, '')
    calls.push(p)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    let m
    if (p === '/auth/me') return json(FX.me[role])
    if ((m = /^\/clinic\/sessions\/(\d+)\/queue$/.exec(p))) {
      const q = queueFor(m[1]); return q ? json(q) : json({ error: 'not found' }, 404)
    }
    if ((m = /^\/clinic\/appointments\/(\d+)\/history$/.exec(p))) return json(FX.history[m[1]] || [])
    if (p === '/clinic/procedures') return json(FX.procedures)
    if (p === '/clinic/materials') return json(FX.materials)
    if (p === '/clinic/referral-sources/options') return json(FX.referral_sources || [])
    if (p === '/clinic/events') {
      if (!events) return json({ error: 'off' }, 403)
      const frame = await events()
      return frame ? route.fulfill({ status: 200, contentType: 'text/event-stream', body: frame }) : json({ error: 'off' }, 403)
    }
    if (p === '/notifications') return json([])
    return json([])
  })
  return calls
}

async function open(browser, { w = 1366, h = 768, theme = 'light', role = 'reception', path, ...mock } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript((th) => { localStorage.setItem('token', 'test'); localStorage.setItem('theme', th) }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const calls = await mockApi(page, { role, ...mock })
  if (path) await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}
const visitPath = (key) => `/clinic/session/${S[key].session}/visit/${S[key].appt}`

const run = async () => {
  // مجموعة عمليات مستقلة: npx يُطلق vite ابناً، وقتلُ npx وحده يُبقي vite حيّاً على المنفذ
  // فيردّ على التشغيل التالي ثمّ يموت في منتصفه
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

  // ═══ ١) كل الحالات × المقاسين × الثيمين ═══
  console.log('\n── ١) الحالات × المقاسات × الثيمات ──')
  for (const key of Object.keys(S)) {
    const a = apptOf(key)
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      for (const theme of ['light', 'dark']) {
        const tag = `${key} ${w}×${h} ${theme}`
        const { ctx, page, errors } = await open(browser, { w, h, theme, path: visitPath(key) })
        await page.waitForSelector('.visit-page', { timeout: 8000 }).catch(() => {})
        const r = await page.evaluate(() => {
          const box = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().toJSON() : null }
          return {
            scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            name: document.querySelector('.visit-who h2')?.textContent || '',
            cards: ['.visit-pay', '.visit-patient', '.visit-procs', '.visit-refs', '.visit-history'].map((s) => !!document.querySelector(s)),
            pay: box('.visit-pay'), procs: box('.visit-procs'), patient: box('.visit-patient'), refs: box('.visit-refs'),
            final: document.querySelector('.visit-pay-final strong')?.textContent || '',
            theme: document.documentElement.dataset.theme,
          }
        })
        ok(errors.length === 0, `${tag}: أخطاء في الصفحة ${errors.join(' | ')}`)
        ok(r.scrollW <= r.innerW, `${tag}: تمرير أفقي (${r.scrollW} > ${r.innerW})`)
        ok(r.name.includes(a.full_name), `${tag}: اسم المريض في الرأس`)
        ok(r.cards.every(Boolean), `${tag}: البطاقات الخمس (${r.cards})`)
        ok(r.theme === theme, `${tag}: الثيم ${r.theme}`)
        // RTL: «المطلوب» و«بيانات المريض» في العمود الأيمن، «الإجراءات» و«الإحالات» في الأيسر
        ok(r.pay && r.procs && r.pay.left >= r.procs.right, `${tag}: «المطلوب» يمين «الإجراءات»`)
        ok(r.patient && r.pay && Math.abs(r.patient.left - r.pay.left) < 2 && r.patient.top > r.pay.top, `${tag}: «بيانات المريض» تحت «المطلوب»`)
        ok(r.refs && r.procs && Math.abs(r.refs.left - r.procs.left) < 2 && r.refs.top > r.procs.top, `${tag}: «الإحالات» تحت «الإجراءات»`)
        ok(digits(r.final) === Number(a.patient_total), `${tag}: المبلغ النهائي ${r.final} ≠ ${a.patient_total}`)
        // الرأس ثابت: بعد التمرير لأسفل يبقى في أعلى الشاشة (حين تطول الصفحة عن الشاشة أصلاً)
        const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40)
        if (scrolls) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
          await page.waitForTimeout(80)
          const top = await page.evaluate(() => document.querySelector('.visit-head').getBoundingClientRect().top)
          ok(top >= -1 && top <= 4, `${tag}: الرأس ثابت مع التمرير (top=${top})`)
        }
        await ctx.close()
      }
    }
  }
  console.log(`  ${pass} ✔ حتى الآن`)

  // ═══ ١ب) الشاشة الضيّقة: عمودٌ واحد بالترتيب نفسه ═══
  {
    const { ctx, page } = await open(browser, { w: 900, h: 1000, path: visitPath('procedures') })
    await page.waitForSelector('.visit-page')
    const order = await page.evaluate(() => ['.visit-pay', '.visit-patient', '.visit-procs', '.visit-refs', '.visit-history']
      .map((s) => document.querySelector(s).getBoundingClientRect().top))
    ok(order.every((t, i) => i === 0 || t > order[i - 1]), `900px: عمودٌ واحد بالترتيب (${order.map(Math.round)})`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '900px: بلا تمرير أفقي')
    await ctx.close()
  }

  // ═══ ٢) ما يخصّ كل حالة ═══
  console.log('\n── ٢) الحالات الفارغة وما يخصّ كل حالة ──')
  const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.innerText || '', sel)
  {
    const { ctx, page } = await open(browser, { path: visitPath('new') })
    await page.waitForSelector('.visit-page')
    ok((await text(page, '.visit-procs')).includes('لا إجراءات'), 'جديد: حالة الإجراءات الفارغة')
    ok((await text(page, '.visit-procs')).includes('بعد حضور المريض'), 'جديد: سبب غياب الإضافة')
    ok((await text(page, '.visit-refs')).includes('لا إحالة'), 'جديد: حالة الإحالات الفارغة')
    ok(await page.locator('.visit-refs button', { hasText: '+ إحالة' }).isVisible(), 'جديد: زرّ «+ إحالة»')
    ok(await page.locator('.visit-patient .badge', { hasText: 'بيانات ناقصة' }).isVisible(), 'جديد: شارة البيانات الناقصة')
    ok(await page.locator('.visit-patient .link-btn', { hasText: 'أكمل البيانات' }).isVisible(), 'جديد: «أكمل البيانات»')
    const head = await text(page, '.visit-head')
    ok(head.includes('حضر') && head.includes('إلغاء') && head.includes('تأجيل') && head.includes('تقديم'), `جديد: أزرار الحالة في الرأس (${head})`)
    ok((await text(page, '.visit-num-main')).trim() === '—', 'جديد (حضور): لا رقم دور قبل الحضور')
    // السجل مطويّ ولا يُطلب حتى يُفتح
    ok(!(await page.$('.ad-history')), 'السجل مطويّ افتراضاً')
    // «أكمل البيانات» يفتح النموذج نفسه بقيمه
    await page.locator('.visit-patient .link-btn', { hasText: 'أكمل البيانات' }).click()
    ok(await page.locator('.visit-patient .ad-fields input').first().inputValue() === apptOf('new').full_name, 'التعديل: النموذج بقيمه')
    ok(await page.locator('.visit-patient button', { hasText: 'حفظ التعديلات' }).isDisabled(), 'التعديل: الحفظ معطّل بلا تغيير')
    await page.locator('.visit-patient button', { hasText: 'إلغاء' }).click()
    ok(!(await page.$('.visit-patient .ad-fields')), 'التعديل: «إلغاء» يعيد القراءة')
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { path: visitPath('procedures') })
    await page.waitForSelector('.visit-page')
    const a = apptOf('procedures')
    ok(await page.locator('.visit-procs .appt-procs-table tr.proc-removed').count() === 1, 'إجراءات: المُزال مشطوب')
    ok((await text(page, '.visit-procs')).includes('جبس'), 'إجراءات: المواد تحت الإجراء')
    ok(await page.locator('.visit-procs select').isVisible(), 'إجراءات: قائمة الإضافة')
    const procRow = await text(page, '.visit-pay tbody tr:nth-child(2)')
    ok(digits(procRow.replace(/\(\d+\)|\([٠-٩]+\)/, '')) === Number(a.procedures_total), `إجراءات: مجموعها في «المطلوب» (${procRow})`)
    ok(!calls.some((c) => c.endsWith('/history')), 'السجل لا يُطلب قبل فتحه')
    await page.locator('.visit-history .visit-fold').click()
    await page.waitForSelector('.ad-history, .visit-history .ad-readonly')
    ok(calls.some((c) => c === `/clinic/appointments/${S.procedures.appt}/history`), 'السجل يُطلب حين يُفتح')
    ok(await page.locator('.ad-history tr').count() === FX.history[S.procedures.appt].length, 'السجل: سطوره')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: visitPath('referrals') })
    await page.waitForSelector('.visit-page')
    const a = apptOf('referrals')
    ok(await page.locator('.visit-pay-disc').count() === 2, 'إحالتان: سطرا خصمٍ في «المطلوب»')
    ok(await page.locator('.visit-refs .ad-ref-line').count() === 2, 'إحالتان: سطران في الإحالات')
    const discs = await page.locator('.visit-pay-disc td.num').allInnerTexts()
    ok(discs.map(digits).join() === a.referrals.map((r) => Number(r.actual_discount)).join(), `إحالتان: خصم كل جهة (${discs})`)
    ok((await text(page, '.visit-pay')).includes(a.referrals[0].source_name), 'إحالتان: اسم الجهة')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { role: 'umosama', path: visitPath('stepped') })
    await page.waitForSelector('.visit-page')
    ok((await text(page, '.visit-head')).includes('بانتظار العودة'), 'خروج مؤقت: الحالة في الرأس')
    ok(await page.locator('.visit-head button', { hasText: 'نداء العودة' }).isVisible(), 'خروج مؤقت: «نداء العودة» للمشرفة')
    await ctx.close()
    const rec = await open(browser, { path: visitPath('stepped') })
    await rec.page.waitForSelector('.visit-page')
    ok(!(await rec.page.locator('.visit-head button', { hasText: 'نداء العودة' }).count()), 'خروج مؤقت: لا «نداء العودة» للاستقبال')
    await rec.ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: visitPath('closed') })
    await page.waitForSelector('.visit-page')
    ok(!(await page.locator('.visit-patient button', { hasText: 'تعديل' }).count()), 'جلسة أمس: لا «تعديل» للاستقبال')
    ok((await text(page, '.visit-patient')).includes('التعديل في يوم الجلسة فقط'), 'جلسة أمس: السبب ظاهر')
    ok(!(await page.$('.visit-procs select')), 'جلسة أمس: لا إضافة إجراء للاستقبال')
    ok(!(await page.$('.visit-refs .ref-add')), 'جلسة أمس: لا «+ إحالة» للاستقبال')
    ok(!(await page.$('.visit-reprint')), 'جلسة أمس: لا إعادة طباعة (شرط اللوحة القديمة)')
    await ctx.close()
    const adm = await open(browser, { role: 'umosama', path: visitPath('closed') })
    await adm.page.waitForSelector('.visit-page')
    ok(await adm.page.locator('.visit-patient button', { hasText: 'تعديل' }).isVisible(), 'جلسة أمس: المشرفة تعدّل')
    ok(await adm.page.locator('.visit-procs select').isVisible(), 'جلسة أمس: المشرفة تضيف إجراءً')
    await adm.ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: visitPath('slots') })
    await page.waitForSelector('.visit-page')
    ok((await text(page, '.visit-num-main')).trim() === String(apptOf('slots').queue_number), 'خانات: رقم الدور في الرأس')
    ok(!(await page.$('.visit-num-ref')), 'خانات: لا «حجز N» تحت الرقم')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { path: `/clinic/session/${S.new.session}/visit/999999` })
    await page.waitForSelector('.visit-missing')
    ok((await text(page, '.visit-missing')).includes('غير موجودة'), 'رابطٌ لزيارةٍ غير موجودة: رسالة ورجوع')
    await ctx.close()
  }

  // ═══ ٣) الطبيب: لا يرى الطابور فلا يرى تفاصيل زيارة ═══
  console.log('\n── ٣) الصلاحيات ──')
  {
    const { ctx, page, calls } = await open(browser, { role: 'doctor', path: visitPath('procedures') })
    await page.waitForURL('**/clinic/doctor', { timeout: 5000 }).catch(() => {})
    ok(new URL(page.url()).pathname === '/clinic/doctor', `الطبيب يُعاد إلى شاشته (${page.url()})`)
    ok(!calls.some((c) => /\/queue$/.test(c) && c.includes(`/sessions/${S.procedures.session}/`)), 'الطبيب: لا طلب لطابور الجلسة')
    await ctx.close()
  }

  // ═══ ٤) الطابور ⇐ الزيارة ⇐ رجوع إلى الموضع نفسه ═══
  console.log('\n── ٤) من الطابور وإليه ──')
  {
    // تبويب «الكل»: الافتراضي «بانتظار الحضور» لا يُظهر من هو قيد الكشف أو حاضر
    const { ctx, page } = await open(browser, { h: 600, path: `/clinic/session/${S.procedures.session}?tab=all` })
    await page.waitForSelector('a.visit-link')
    ok(!(await page.$('.appt-details-row')), 'الطابور: لا سطر تفاصيل ينفتح')
    const link = page.locator('a.visit-link', { hasText: apptOf('procedures').full_name })
    await link.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 120))
    const y0 = await page.evaluate(() => window.scrollY)
    ok(y0 > 100, `الطابور: مُمرَّر قبل الفتح (${y0})`)
    await link.click()
    await page.waitForSelector('.visit-page')
    ok(new URL(page.url()).pathname === visitPath('procedures'), 'الضغط على الاسم يفتح صفحة الزيارة')
    await page.locator('.visit-back').click()
    await page.waitForSelector('a.visit-link')
    await page.waitForTimeout(200)
    const y1 = await page.evaluate(() => window.scrollY)
    ok(new URL(page.url()).pathname === `/clinic/session/${S.procedures.session}`, 'رجوع ⇐ الطابور')
    ok(new URL(page.url()).searchParams.get('tab') === 'all', 'رجوع ⇐ التبويب نفسه')
    ok(Math.abs(y1 - y0) <= 4, `رجوع ⇐ الموضع نفسه (${y0} ⇐ ${y1})`)
    // زرّ «تفاصيل» في الصفّ يفتحها أيضاً
    await page.locator('tr', { hasText: apptOf('arrived').full_name }).locator('button', { hasText: 'تفاصيل' }).click()
    await page.waitForSelector('.visit-page')
    ok(new URL(page.url()).pathname === visitPath('arrived'), '«تفاصيل» في الصفّ يفتح الصفحة')
    await ctx.close()
  }
  {
    // رابطٌ مباشر (لسانٌ جديد) — الرجوع إلى طابور الجلسة لا إلى خارج التطبيق
    const { ctx, page } = await open(browser, { path: visitPath('referrals') })
    await page.waitForSelector('.visit-page')
    await page.locator('.visit-back').click()
    await page.waitForSelector('a.visit-link')
    ok(new URL(page.url()).pathname === `/clinic/session/${S.referrals.session}`, 'رابطٌ مباشر: رجوع ⇐ طابور الجلسة')
    await ctx.close()
  }

  // ═══ ٥) التحديث الحيّ عبر بثّ الموظفين ═══
  console.log('\n── ٥) التحديث الحيّ ──')
  {
    const sid = S.procedures.session
    const after = clone(FX.queues[sid])
    const a = after.appointments.find((x) => String(x.id) === String(S.procedures.appt))
    a.procedures.push({ id: 9901, procedure_id: 9901, name: 'إيكو قلب', price: 35000, added_at: new Date().toISOString(),
      added_by_name: 'جهازٌ آخر', removed_at: null, materials: [], referral_discount: 0, patient_price: 35000 })
    a.procedures_total += 35000; a.total += 35000; a.patient_total += 35000
    let changed = false, release
    const fire = new Promise((r) => { release = r })
    // كلّ اتصالٍ مفتوح قبل الإطلاق ينتظره ويتلقّى الحدث — StrictMode في التطوير يفتح البثّ
    // مرّتين ويُجهض الأوّل، فحدثٌ لأوّل طلبٍ وحده قد يذهب لاتصالٍ ميّت. وبعد التسليم: 403.
    let delivered = false
    const { ctx, page } = await open(browser, {
      queueFor: (s) => (s === String(sid) && changed ? after : FX.queues[s]),
      events: async () => {
        if (delivered) return null
        await fire
        setTimeout(() => { delivered = true }, 100)
        return `event: visit\ndata: ${JSON.stringify({ session_id: Number(sid), appointment_id: Number(S.procedures.appt) })}\n\n`
      },
      path: visitPath('procedures'),
    })
    await page.waitForSelector('.visit-page')
    // في الجدول لا في الصفحة: «إيكو قلب» اسمٌ في قائمة الإضافة أيضاً
    ok(!(await text(page, '.visit-procs .appt-procs-table')).includes('إيكو قلب'), 'قبل الحدث: لا إجراء جديد')
    changed = true; release()
    const seen = await page.waitForFunction(() => document.querySelector('.visit-procs .appt-procs-table')?.innerText.includes('إيكو قلب'),
      null, { timeout: 4000 }).then(() => true).catch(() => false)
    ok(seen, 'حدث «visit» ⇐ الإجراء الجديد يظهر بلا تحديث يدوي')
    ok(digits(await text(page, '.visit-pay-final strong')) === a.patient_total, 'وحدث المبلغ النهائي معه')
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) {
    failures.forEach((f) => console.error(`  ✖ ${f}`))
    process.exit(1)
  }
  console.log('✔ صفحة الزيارة: البطاقات والعمودان والحالات والصلاحيات والرجوع والتحديث الحيّ\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
