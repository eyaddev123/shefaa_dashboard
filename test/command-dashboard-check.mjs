// ═══════════════════════════════════════════════════════════════════
// لوحة القيادة — العيادات، في متصفّح حقيقي
//
// يُشغَّل بـ: npm run test:command
//   COMMAND_SHOTS=/path/dir npm run test:command   ← يحفظ اللقطات
//
// الردود مبنيّة بشكل ردّ الخادم (عقده مفحوص في server: npm run test:command). نفحص:
//   ١) الأقسام لكلّ دور: ما غاب من الردّ لا يُرسم، والاستقبال بلا مال ولا معتذرين ولا أبرز
//   ٢) الطلبات: اللوحة طلبان فقط، و/dashboard لا يُطلب لموظف العيادات، ولوحة الدكتور بلا «الأبرز»
//   ٣) حالة الفراغ وزرّ التوليد (المشرفة وحدها)، وبعده تُعاد القراءة
//   ٤) تبويبا العيادات/المساعدات لمن له قسمان، والمجلس والطبيب كما كانوا
//   ٥) بلا تمرير أفقي بالمقاسات والثيمين، وصيغ المثنّى، ولا «·» بجانب رقم
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.COMMAND_TEST_PORT || 5253)
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.COMMAND_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); console.log(`  ✖ ${label}`); return false }

const ME = {
  adm: { role: 'clinic_admin', display_name: 'أم أسامة' }, rec: { role: 'clinic_reception', display_name: 'ولاء' },
  mgr: { role: 'manager', display_name: 'المدير' }, sup: { role: 'super_admin', display_name: 'المشرف العام' },
  chair: { role: 'board', is_chairman: true, board_member_id: 1, display_name: 'محمد مطر' },
  brd: { role: 'board', is_chairman: false, board_member_id: 2, display_name: 'عضو' },
  doc: { role: 'doctor', doctor_id: 1, display_name: 'د. خالد' },
}
const today = '2026-11-05'
const session = (o) => ({ id: '1', doctorId: '1', doctor: 'د. خالد الكردي', specialty: 'عظمية', room: '1', start: '09:00', end: '14:00', flowMode: 'attendance',
  state: 'open', current: 7, total: 14, waiting: 4, inService: 1, finished: 7, procedures: 3, unpaidProcedures: 2, ...o })
const SESSIONS = [session({}), session({ id: '2', doctorId: '2', doctor: 'د. لينا عبّاس', state: 'ready', current: null, waiting: 0, finished: 0, total: 5 }),
  session({ id: '3', doctorId: '3', doctor: 'د. رامي سعد', state: 'done', current: null, waiting: 0, finished: 9, total: 9, room: null })]
const DAY = { sessions: { total: 3, open: 1, ready: 1, done: 1 }, patients: { total: 28, waiting: 4, inService: 1, finished: 16 }, procedures: { total: 9, unpaid: 2 } }
const APOLOGIES = { total: 3, doctors: [{ doctorId: '7', doctor: 'د. هبة' }, { doctorId: '8', doctor: 'د. وائل' }, { doctorId: '9', doctor: 'د. نور' }] }
const LOW = { n: 2, items: [{ id: '1', name: 'شاش', balance: 3, unit: 'قطعة', min: 10 }, { id: '2', name: 'جبس', balance: 5, unit: 'قطعة', min: 5 }] }
const ND = { days: 2, doctorsCount: 1, doctors: [{ doctorId: '2', doctor: 'د. لينا عبّاس', days: 2 }] }
const full = { today, doctorsActive: 8, sessions: SESSIONS, day: { ...DAY, apologies: APOLOGIES },
  finance: { fundBalance: 1215000, openingSet: true, receipts: 71000, receiptsPatients: 32 },
  alerts: { unpaid: { n: 2, total: 2500 }, lowStock: LOW, noDeparture: ND } }
const COMMAND = {
  adm: full, mgr: full, chair: full,
  sup: { ...full, finance: { fundBalance: -5000, openingSet: false } },
  rec: { today, doctorsActive: 8, sessions: SESSIONS, day: DAY, alerts: { unpaid: { n: 1, total: 500 } } },
}
const zeroDay = { sessions: { total: 0, open: 0, ready: 0, done: 0 }, patients: { total: 0, waiting: 0, inService: 0, finished: 0 }, procedures: { total: 0, unpaid: 0 } }
const emptyOf = (c) => ({ ...c, sessions: [], day: { ...zeroDay, ...(c.day.apologies ? { apologies: { total: 0, doctors: [] } } : {}) },
  alerts: { unpaid: { n: 0, total: 0 }, ...(c.alerts.lowStock ? { lowStock: { n: 0, items: [] } } : {}), ...(c.alerts.noDeparture ? { noDeparture: { days: 0, doctorsCount: 0, doctors: [] } } : {}) } })
const hl = (n) => Array.from({ length: n }, (_, i) => ({ doctorId: String(i + 1), doctor: `د. رقم ${i + 1}`, specialty: 'عظمية', commitment: 100, onTime: 7, actual: 7,
  patients: 40 - i, procedures: 20 - i, shifa: 90000 - i * 1000, lateMinutes: 90, lateDays: 3, absent: 2, scheduled: 6 }))
// roster: كلّ دكتورٍ بدوامٍ أو اعتذار — بالوقت دائماً · متأخّر · غائب · معتذر · بمواعيد خاصة
const R = (id, doctor, o) => ({ doctorId: id, doctor, specialty: 'عظمية', appointmentsBased: false, scheduled: 3, actual: 3, onTime: 3, late: 0, estimated: 0,
  absent: 0, lateMinutes: 0, avgLate: null, apologized: 0, ...o })
const ROSTER = [R('1', 'د. رقم 1', {}), R('2', 'د. رقم 2', { onTime: 1, late: 2, lateMinutes: 70, avgLate: 35 }),
  R('3', 'د. رقم 3', { actual: 2, onTime: 2, absent: 1 }), R('4', 'د. رقم 4', { scheduled: 0, actual: 0, onTime: 0, apologized: 2 }),
  R('5', 'د. رقم 5', { appointmentsBased: true, actual: 0, onTime: 0 })]
const HIGHLIGHTS = { from: '2026-10-31', to: today, period: 'week', minActualDays: 2, grace: 20, commitment: hl(5), patients: hl(5), procedures: hl(5), shifa: hl(5),
  late: [], absent: hl(1), apologized: [], roster: ROSTER }
const AID = { view: 'board', families: 5, persons: 9, requests: 3, byStatus: [], vouchersCount: 0, vouchersTotal: 0, myQueue: [], myReviewsCount: 1, readyForDecision: [], todaySessions: [], doctorsCount: 8 }
const SUPER = { ...AID, view: 'super_admin', users: { active: 3, total: 4, suspended: 1, never_logged_in: 0 } }

async function open(browser, { role = 'adm', w = 1366, h = 800, theme = 'light', path = '/', empty = false, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar' })
  await ctx.addInitScript(({ th, st }) => {
    localStorage.setItem('token', 'test'); localStorage.setItem('theme', th)
    for (const [k, v] of Object.entries(st)) if (localStorage.getItem(`seen:${k}`) === null) { localStorage.setItem(k, v); localStorage.setItem(`seen:${k}`, '1') }
  }, { th: theme, st: store })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const calls = []; const state = { empty }
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^\/api/, '')
    calls.push(`${req.method()} ${p}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/auth/me') return json(ME[role])
    if (p === '/clinic/command') {
      if (!COMMAND[role]) return json({ error: 'forbidden' }, 403)
      return json(state.empty ? emptyOf(COMMAND[role]) : COMMAND[role])
    }
    if (p === '/clinic/highlights') return json(HIGHLIGHTS)
    if (p === '/clinic/sessions/generate') { state.empty = false; return json({ created: [1, 2, 3], skipped: 0 }) }
    if (p === '/dashboard') return json(role === 'sup' ? SUPER : AID)
    if (p.endsWith('/dashboard') || p.endsWith('/attendance')) return json({ error: 'off' }, 500)
    return json([])
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  return { ctx, page, errors, calls }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }
const text = (page, sel) => page.$eval(sel, (e) => e.textContent)
const has = async (page, sel) => !!(await page.$(sel))
const noHScroll = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1)

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false) }
  if (!up) { console.error('لم يقلع vite'); process.exit(1) }
  const browser = await chromium.launch()

  console.log('\n── ١) المشرفة: كلّ الأقسام، وطلبان فقط ──')
  {
    const { ctx, page, calls, errors } = await open(browser)
    await page.waitForSelector('.hl-grid')
    ok(await page.$$eval('.cc-stat', (x) => x.length) === 4, 'أربع بطاقات علوية')
    ok((await text(page, '.cc-stats')).includes('٢٨'), 'مرضى اليوم بالأرقام')
    ok(await has(page, '.cc-finance') && await has(page, '.cc-alerts') && await has(page, '.cc-scards'), 'المالية والتنبيهات والجلسات (بطاقات)')
    ok((await text(page, '.cc-finance')).includes('من ٣٢ مريضاً'), 'عدد مرضى المقبوضات')
    ok((await text(page, '.cc-alerts')).includes('إجراءان بانتظار المحاسبة'), '★ مثنّى الإجراء')
    ok((await text(page, '.cc-alerts')).includes('مادتان عند الحدّ الأدنى'), '★ مثنّى المادة')
    ok((await text(page, '.cc-alerts')).includes('يومان بلا انصراف'), '★ مثنّى اليوم')
    ok(await page.$eval('.cc-scard[href="/clinic/session/1"] .cc-scard-turn strong', (e) => e.textContent) === '٧', '★ الدور الحالي');
    ok(await page.$eval('.cc-scard[href="/clinic/session/2"] .cc-scard-turn strong', (e) => e.textContent) === '—', 'بلا كشفٍ جارٍ: شرطة')
    ok(JSON.stringify(await page.$$eval('.cc-scard', (x) => x.map((a) => a.getAttribute('href').split('/').pop()))) === '["1","2","3"]', '★ الترتيب: شغّالة ⇐ جاهزة ⇐ منتهية')
    ok((await text(page, '.cc-scard[href="/clinic/session/1"]')).includes('انتهى ٧ من ١٤'), 'التقدّم في البطاقة')
    const api = calls.filter((c) => !c.includes('/auth/me') && !c.includes('notifications') && !c.includes('/unpaid') && !c.includes('/events'))
    // StrictMode في التطوير يضاعف كلّ effect — فالعدد الفعليّ يُفحص على البناء، وهنا الأنواع
    ok([...new Set(api)].sort().join() === 'GET /clinic/command,GET /clinic/highlights', `★ اللوحة طلبان لا غير (${api.join(' | ')})`)
    ok(!calls.includes('GET /dashboard'), '★ لا /dashboard لموظف العيادات')
    ok(await page.$$eval('.hl-box:first-child .hl-list li', (x) => x.length) === 3, 'الأبرز: الثلاثة الأوائل')
    await page.click('.hl-more')
    ok(await page.$$eval('.hl-box:first-child .hl-list li', (x) => x.length) === 5, '★ وبكبسة الخمسة')
    ok(await page.$$eval('.hl-box', (x) => x.length) === 3, '★ ثلاثة أوائل: مرضى · إجراءات · حصّة')
    const pu = await text(page, '.hl-punct')
    ok(/الالتزام بالدوام/.test(pu) && /٧٥٪/.test(pu), `★ النسبة الكلّية بلا «بمواعيد خاصة»: ٦ من ٨ (${pu.slice(0, 80)})`)
    ok((await text(page, '.hl-col.is-on')).includes('د. رقم 1') && !(await text(page, '.hl-col.is-on')).includes('د. رقم 2'), '★ «بالوقت دائماً» من لم يتأخّر')
    ok(/د\. رقم 2[\s\S]*تأخّر يومين من ٣، متوسّط ٣٥ د/.test(await text(page, '.hl-col.is-late')), '★ «يتأخّرون» بكم من كم ومتوسّط')
    ok(/غاب يوم/.test(await text(page, '.hl-col.is-away')) && /اعتذر يومين/.test(await text(page, '.hl-col.is-away')), '★ غياب واعتذار')
    ok((await text(page, '.hl-appt')).includes('د. رقم 5') && !(await text(page, '.hl-punct-cols')).includes('د. رقم 5'), '★ «بمواعيد خاصة» سطرٌ وحده')
    ok((await text(page, '.hl-punct')).includes('خلال ٢٠ دقيقة'), 'السماح مكتوب')
    ok(/من أصل ٨ دوامات سُجّل فيها وصول الدكتور، وصل ٦ بالوقت و٢ متأخّراً/.test((await text(page, '.hl-punct-lead')).replace(/\s+/g, ' ')), `★ الجملة بالكلام (${await text(page, '.hl-punct-lead')})`)
    ok(/اعتذر\s*دوامين/.test(await text(page, '.hl-punct-legend')) && /غاب\s*دوام واحد/.test(await text(page, '.hl-punct-legend')), '★ كلّ سطرٍ بعدده ومعناه')
    ok(await page.getAttribute('.hl-who a', 'href') === '/clinic/doctors/1/dashboard?period=week', 'الاسم يفتح لوحة الدكتور بالأسبوع')
    ok(!/·\s*[٠-٩]|[٠-٩]\s*·/.test(await text(page, '.cc')), '★ لا «·» بجانب رقم هنديّ')
    ok(errors.length === 0, `بلا أخطاء صفحة (${errors[0] || ''})`)
    await page.click('.cc-scard[href="/clinic/session/2"] .cc-scard-time')
    ok(new URL(page.url()).pathname === '/clinic/session/2', 'البطاقة تفتح الدور')
    await ctx.close()
  }

  console.log('\n── ٢) الاستقبال ──')
  {
    const { ctx, page, calls } = await open(browser, { role: 'rec' })
    await page.waitForSelector('.cc-stats')
    await page.waitForTimeout(300)
    ok(await page.$$eval('.cc-stat', (x) => x.length) === 3, '★ بلا بطاقة المعتذرين')
    ok(!(await text(page, '.cc')).includes('معتذر'), '★ ولا كلمة «معتذر»')
    ok(!await has(page, '.cc-finance'), '★ بلا لمحة مالية')
    ok(!await has(page, '.hl-card') && !calls.includes('GET /clinic/highlights'), '★ بلا الأبرز ولا طلبه')
    ok((await text(page, '.cc-alerts')).includes('إجراء واحد بانتظار المحاسبة'), 'تنبيه المحاسبة وحده')
    ok(!await has(page, '.cc-alert .plain'), 'بلا رابط صفحةٍ لا تراها')
    ok(!await has(page, '.cc-readonly'), 'ليست اطّلاعاً')
    ok(!await has(page, '.cc-switch'), 'بلا تبويبين')
    await ctx.close()
  }

  console.log('\n── ٣) الفراغ والتوليد ──')
  {
    const { ctx, page, calls } = await open(browser, { empty: true })
    await page.waitForSelector('.cc-empty')
    ok(!await has(page, '.cc-scards'), 'بلا بطاقات فارغة')
    ok((await text(page, '.cc-empty button')).startsWith('توليد جلسات'), 'زرّ التوليد باسم اليوم')
    ok((await text(page, '.cc-allclear')).includes('لا شيء ينتظرك'), 'لا تنبيهات: جملةٌ هادئة')
    await shot(page, 'empty-light')
    const reads = calls.filter((c) => c === 'GET /clinic/command').length
    await page.click('.cc-empty button')
    await page.waitForSelector('.cc-scards')
    ok(calls.includes('POST /clinic/sessions/generate'), '★ الزرّ يولّد')
    ok(calls.filter((c) => c === 'GET /clinic/command').length === reads + 1, '★ وتُعاد القراءة')
    ok((await text(page, '.toast')).includes('جلسات جديدة'), 'وملخّص التوليد')
    await ctx.close()
  }
  for (const role of ['rec', 'mgr', 'chair', 'sup']) {
    const { ctx, page } = await open(browser, { role, empty: true, store: { 'dashboard-section': 'clinic' } })
    await page.waitForSelector('.cc-empty')
    ok(!await has(page, '.cc-empty button'), `★ ${role}: بلا زرّ توليد`)
    await ctx.close()
  }

  console.log('\n── ٤) من له قسمان، والباقون ──')
  {
    const { ctx, page, calls } = await open(browser, { role: 'mgr' })
    await page.waitForSelector('.cc-stats')
    ok(await text(page, '.cc-switch [aria-selected="true"]') === 'العيادات', 'المدير يبدأ بالعيادات')
    ok(await has(page, '.cc-readonly'), '★ «اطّلاع فقط» ظاهرة')
    ok(!calls.includes('GET /dashboard'), 'المساعدات لا تُجلب قبل فتحها')
    await page.click('.cc-switch button:nth-child(2)')
    await page.waitForFunction(() => document.body.textContent.includes('بانتظار مراجعتك'))
    ok(calls.includes('GET /dashboard'), 'وتُجلب حين تُفتح')
    await page.reload(); await page.waitForSelector('.cc-switch')
    ok(await text(page, '.cc-switch [aria-selected="true"]') === 'المساعدات', 'الاختيار يبقى لهذا الجهاز')
    await ctx.close()
  }
  {
    const { ctx, page, calls } = await open(browser, { role: 'chair' })
    await page.waitForSelector('.cc-switch')
    await page.waitForFunction(() => document.body.textContent.includes('جاهزة لقرارك'))
    ok(await text(page, '.cc-switch [aria-selected="true"]') === 'المساعدات', '★ المدير المسؤول يبدأ بما ينتظر قراره')
    ok(!calls.includes('GET /clinic/command'), 'بلا طلب العيادات قبل فتحها')
    await page.click('.cc-switch button:nth-child(1)')
    await page.waitForSelector('.cc-stats')
    ok(await has(page, '.cc-readonly'), '★ والعيادات اطّلاع فقط')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, { role: 'sup' })
    await page.waitForSelector('.cc-finance')
    ok((await text(page, '.cc-finance')).includes('لم يُضبط'), 'الافتتاحيّ غير مضبوط يقول ذلك')
    ok(await has(page, '.cc-fin-value.neg'), 'سالبٌ بلونه')
    ok(!(await text(page, '.cc-finance')).includes('مقبوضات'), '★ المشرف العام بلا مقبوضات (لا يقرأ الجرد)')
    await ctx.close()
  }
  for (const [role, label] of [['brd', 'عضو المجلس'], ['doc', 'الطبيب']]) {
    const { ctx, page, calls } = await open(browser, { role })
    await page.waitForSelector('h2')
    await page.waitForTimeout(300)
    ok(!calls.includes('GET /clinic/command') && !await has(page, '.cc-switch') && calls.includes('GET /dashboard'), `★ ${label}: لوحته كما كانت`)
    await ctx.close()
  }

  console.log('\n── ٥) لوحة الدكتور بلا «الأبرز» ──')
  {
    const { ctx, page, calls } = await open(browser, { path: '/clinic/doctors/1/dashboard' })
    await page.waitForSelector('h2')
    await page.waitForTimeout(500)
    ok(!await has(page, '.hl-card'), '★ بلا البطاقة')
    ok(!calls.includes('GET /clinic/highlights'), '★ ولا طلبها')
    await ctx.close()
  }

  console.log('\n── ٦) المقاسات والثيمان ──')
  for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768], [768, 1024], [390, 844]]) for (const theme of ['light', 'dark']) for (const empty of [false, true]) {
    const { ctx, page, errors } = await open(browser, { w, h, theme, empty })
    await page.waitForSelector('.hl-grid')
    ok(await noHScroll(page), `بلا تمرير أفقي ${w} ${theme} ${empty ? 'فارغ' : 'شغّال'}`)
    ok(errors.length === 0, `بلا أخطاء ${w} ${theme}`)
    if (w === 390 && !empty) ok(await page.$$eval('.cc-scard', (x) => x.length) > 0 && new Set(await page.$$eval('.cc-scard', (x) => x.map((e) => e.getBoundingClientRect().left))).size === 1, 'الجوال: بطاقةٌ في كلّ سطر')
    await shot(page, `${empty ? 'empty' : 'busy'}-${theme}-${w}`)
    await ctx.close()
  }

  await browser.close()
  stop()
  console.log(`\n═══ لوحة القيادة: ${pass} ✔ · ${failures.length} ✘ ═══`)
  process.exit(failures.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
