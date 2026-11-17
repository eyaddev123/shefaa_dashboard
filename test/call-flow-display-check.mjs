// ═══════════════════════════════════════════════════════════════════
// شاشة الصالة وأبواب الكشف الصامتة — متصفّح حقيقي بمحاكاة Chrome 66
//
// يُشغَّل بـ: npm run test:call-flow
//
// الخادم يبثّ لـ«بدء كشف» بعد النداء و«بدء كشف» بلا نداء والتراجع refresh صامتاً (quiet) يحمل
// appointment_id، وللإنهاء refresh يحمله بلا quiet. نفحص ما يراه الواقف في الصالة:
//   ١) نداءٌ حقيقي: بطاقة النداء الكبيرة + وميض البطاقة (كما كان).
//   ٢) «بدء كشف» بعد النداء لهذا المريض: بطاقة النداء تُسحب فوراً، بلا وميض.
//   ٣) «بدء كشف» بلا نداء: الرقم في «يُخدَم الآن» ويخرج من الحبّات — بلا بطاقة نداء ولا وميض.
//   ٤) شاهد: refresh عادي (غير صامت) يغيّر «يُخدَم الآن» عند دكتورٍ آخر ⇒ يومض كما كان.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.CALL_FLOW_TEST_PORT || 5261)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  failures.push(label); console.log(`  ✘ ${label}`); return false
}

const D1 = 'د. عيون', D2 = 'د. سامي'
const j2 = (o) => JSON.stringify(o)
const card = (doctor_name, room, current, waiting) => ({
  doctor_name, specialty: 'عام', room, closed: false, awaiting_doctor: false,
  current: current == null ? null : { queue_number: current },
  next: waiting[0] != null ? { queue_number: waiting[0] } : null,
  after_next: waiting[1] != null ? { queue_number: waiting[1] } : null,
  queue: waiting.map((n) => ({ queue_number: n, arrived: true })),
  queue_length: waiting.length + (current == null ? 0 : 1), returning: [],
})
const board = (c1, w1, c2, w2) => ({ urgent_delays: 0, urgent_present: false, seq: 1,
  board: [card(D1, '3', c1, w1), card(D2, '4', c2, w2)] })

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' })
  const stop = () => { try { vite.kill('SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('✖ لم يُقلع خادم Vite'); stop(); process.exit(1) }

  const browser = await chromium.launch()
  console.log('\n═══ شاشة الصالة: أبواب الكشف الصامتة ═══\n')
  const snap = board(null, [1, 2, 3], 20, [21, 22])
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  await ctx.addInitScript((s) => {
    const orig = CSS.supports.bind(CSS)
    CSS.supports = (...a) => /container-type|aspect-ratio/.test(a.join(' ')) ? false : orig(...a)
    class FakeES {
      constructor() { this.l = {}; window.__sse = this
        setTimeout(() => { if (this.onopen) this.onopen({})
          ;(this.l.snapshot || []).forEach((f) => f({ data: JSON.stringify(s) })) }, 30) }
      addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f) }
      removeEventListener() {} close() {}
      emit(t, d) { (this.l[t] || []).forEach((f) => f({ data: JSON.stringify(d) })) }
    }
    window.EventSource = FakeES
  }, snap)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  let served = snap
  await page.route('**/api/public/clinic/board*', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(served) }))
  await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
  await page.waitForTimeout(900)

  const read = () => page.evaluate(() => ({
    banner: !!document.querySelector('.pd-banner'),
    cards: [...document.querySelectorAll('.pd-card')].map((c) => ({
      flash: c.classList.contains('pd-flash'),
      number: (c.querySelector('.pd-number') || {}).textContent || '',
      chips: [...c.querySelectorAll('.pd-chip:not(.pd-chip-return)')].map((x) => x.textContent.trim()),
    })),
  }))
  const emit = (t, d) => page.evaluate(([t2, d2]) => window.__sse.emit(t2, d2), [t, d])
  const pause = (ms) => page.waitForTimeout(ms)

  // ١) نداءٌ حقيقي للدور ١ عند د. عيون
  served = board(1, [2, 3], 20, [21, 22])
  await emit('call', { id: '7', queue_number: 1, room: '3', doctor_name: D1, specialty: 'عام', seq: 2, repeat: false })
  await pause(700)
  let s = await read()
  ok(s.banner, 'النداء الحقيقي: بطاقة النداء الكبيرة ظهرت')
  ok(s.cards[0].flash, 'النداء الحقيقي: البطاقة تومض')
  ok(s.cards[0].number.trim() === '1', `النداء الحقيقي: «يُخدَم الآن» = 1 (${s.cards[0].number})`)
  await pause(3300)   // ينتهي الوميض (FLASH_MS)

  // ٢) «بدء كشف» بعد النداء لهذا المريض: refresh صامت برقم حجزه
  await emit('refresh', { session_id: '1', appointment_id: 7, doctor_name: D1, quiet: true, seq: 3 })
  await pause(600)
  s = await read()
  ok(!s.banner, '★ «بدء كشف» بعد النداء: بطاقة النداء سُحبت فوراً (لا يبقى «منادى»)')
  ok(!s.cards[0].flash, '★ «بدء كشف» بعد النداء: بلا وميض')
  ok(s.cards[0].number.trim() === '1', '★ «بدء كشف» بعد النداء: الرقم ما زال في «يُخدَم الآن»')

  // إنهاء: refresh بلا quiet، «يُخدَم الآن» يفرغ
  served = board(null, [2, 3], 20, [21, 22])
  await emit('refresh', { session_id: '1', appointment_id: 7, doctor_name: D1, seq: 4 })
  await pause(600)
  s = await read()
  ok(s.cards[0].number.trim() === '—', `الإنهاء: «يُخدَم الآن» فرغ (${s.cards[0].number})`)

  // ٣) «بدء كشف» بلا نداء للدور ٣ (ليس الأوّل)
  served = board(3, [2], 20, [21, 22])
  await emit('refresh', { session_id: '1', appointment_id: 9, doctor_name: D1, quiet: true, seq: 5 })
  await pause(150)
  const early = await read()
  await pause(600)
  s = await read()
  ok(s.cards[0].number.trim() === '3', `★ «بدء كشف» بلا نداء: الدور 3 في «يُخدَم الآن» (${s.cards[0].number})`)
  ok(!s.cards[0].chips.includes('3') && s.cards[0].chips.includes('2'), `★ «بدء كشف» بلا نداء: خرج من الحبّات، وبقي الدور 2 (${s.cards[0].chips})`)
  ok(!s.banner && !early.banner, '★ «بدء كشف» بلا نداء: لا بطاقة نداء إطلاقاً')
  ok(!s.cards[0].flash && !early.cards[0].flash, '★ «بدء كشف» بلا نداء: لا وميض')

  // ٤) شاهد: refresh عادي يغيّر «يُخدَم الآن» عند د. سامي ⇒ يومض كما كان
  served = board(3, [2], 21, [22])
  await emit('refresh', { session_id: '2', seq: 6 })
  await pause(600)
  s = await read()
  ok(s.cards[1].flash && s.cards[1].number.trim() === '21', 'الشاهد: تغيّرٌ غير صامت عند دكتورٍ آخر يومض كما كان')
  ok(!s.cards[0].flash, 'الشاهد: بطاقة د. عيون لم تومض')

  // ٥) النداء بعد بابٍ صامت ما زال يومض وينادي (النافذة الصامتة لا تُخرس نداءً حقيقياً)
  served = board(2, [], 21, [22])
  await emit('call', { id: '8', queue_number: 2, room: '3', doctor_name: D1, specialty: 'عام', seq: 7, repeat: false })
  await pause(600)
  s = await read()
  ok(s.banner && s.cards[0].flash, '★ نداءٌ حقيقي بعد بابٍ صامت: بطاقة النداء والوميض كما كانا')

  ok(errors.length === 0, `أخطاء صفحة: ${errors.join(' | ') || 'لا شيء'}`)

  // ═══ شاشة الدكتور: «بدء كشف» في بطاقة «التالي» وحدها، والقائمة للعرض؛ ومريضٌ فعّال ⇒ الأزرار
  // معطّلة مع الجملة نفسها ═══
  console.log('\n═══ شاشة الدكتور: مريضٌ فعّال واحد ═══\n')
  const HINT = 'أنهِ الكشف الحالي أولاً قبل نداء التالي أو بدء كشف مريض'
  const ap = (id, status, n, extra = {}) => ({ id: String(id), session_id: '1', status, arrival_number: n, queue_number: n,
    full_name: `مريض ${n}`, priority: 'normal', visit_type: 'consultation', procedures: [], ...extra })
  const now = new Date().toISOString()
  const scenarios = [
    ['منادى (بلا بدء)', ap(1, 'in_service', 1, { served_at: now, started_at: null })],
    ['قيد الكشف', ap(1, 'in_service', 1, { served_at: now, started_at: now })],
    ['لا أحد فعّال', null],
  ]
  for (const [label, cur] of scenarios) {
    const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar' })
    await dctx.addInitScript(() => localStorage.setItem('token', 'test'))
    const dp = await dctx.newPage()
    const derr = []; dp.on('pageerror', (e) => derr.push(e.message))
    const appts = [...(cur ? [cur] : []), ap(2, 'arrived', 2), ap(3, 'arrived', 3), ap(4, 'arrived', 4),
      ap(5, 'waiting_return', 5, { served_at: now, started_at: now, stepped_out_at: now })]
    await dp.route('**/api/**', (r) => {
      const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
      const json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
      if (p === '/auth/me') return json({ role: 'doctor', doctor_id: 1, display_name: 'د. عيون' })
      if (p === '/clinic/my-sessions') return json([{ id: 1, start_time: '09:00:00', end_time: '14:00:00', status: 'open',
        active_count: appts.length, flow_mode: 'attendance', apologized: false }])
      if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json({ id: 1, flow_mode: 'attendance', doctor_name: D1,
        session: { id: 1, flow_mode: 'attendance', doctor_name: D1 }, appointments: appts, server_now: now })
      if (p === '/clinic/my-procedures') return json({ lines: [], usage: {} })
      if (p.startsWith('/push')) return json({ enabled: false })
      return json([])
    })
    await dp.goto(`${BASE}/clinic/doctor`, { waitUntil: 'load' })
    await dp.waitForSelector('.dk-wait-list', { timeout: 10000 }).catch(() => {})
    const st = await dp.evaluate(() => {
      const btn = (sel, text) => [...document.querySelectorAll(sel)].filter((b) => b.textContent.includes(text))
      return {
        // doctor-pages-redesign: «التالي» أوّل سطرٍ في القائمة وعليه «بدء كشف» وحده — والبقية بلا أزرار
        listButtons: [...document.querySelectorAll('.dk-wait-list button')].filter((b) => !b.closest('.dk-next-actions')).length,
        listRows: document.querySelectorAll('.dk-wait-list li').length,
        walkins: btn('.dk-next-actions button', 'بدء كشف').map((b) => b.disabled),
        walkinsElsewhere: btn('button', 'بدء كشف').filter((b) => !b.closest('.dk-next-actions, .dk-actions, .wr-list')).length,
        call: btn('.dk-callbar button', 'نادِ التالي').map((b) => b.disabled),
        callElsewhere: btn('button', 'نادِ التالي').filter((b) => !b.closest('.dk-callbar')).length,
        callbarText: document.querySelector('.dk-callbar-who')?.textContent.trim() || '',
        noShow: btn('button', 'لم يحضر').length + btn('button', 'ما حضر').length,
        late: btn('.dk-actions button', 'تأخّر المريض').length,
        stepOut: btn('.dk-actions button', 'خروج مؤقت').length,
        resume: btn('.wr-list button', 'استئناف الكشف').map((b) => b.disabled),
        returnCall: btn('.wr-list button', 'نداء').filter((b) => b.textContent.trim() === 'نداء').map((b) => b.disabled),
        wrButtons: [...document.querySelectorAll('.wr-list button')].map((b) => [b.textContent.trim(), b.disabled]),
        hints: [...document.querySelectorAll('.dk-hint, .wr-hint')].map((h) => h.textContent.trim()),
      }
    })
    ok(st.listRows === 3 && st.listButtons === 0, `★ ${label}: قائمة المنتظرين — 3 أسطر، ولا زرّ إلا «بدء كشف» على سطر التالي (${st.listButtons})`)
    ok(st.walkins.length === 1 && st.walkinsElsewhere === 0, `★ ${label}: «بدء كشف» في بطاقة «التالي» وحدها (${st.walkins.length}/${st.walkinsElsewhere})`)
    // waiting-return-modes (جولة ٢): «نادِ التالي» زرٌّ واحد ثابت أعلى الشاشة (.dk-callbar) لا في بطاقة،
    // ولا «لم يحضر» في الشاشة كلّها — من نودي ولم يدخل فـ«تأخّر المريض»
    ok(st.call.length === 1 && st.callElsewhere === 0, `★ ${label}: «نادِ التالي» في الشريط الثابت وحده (${st.call.length}/${st.callElsewhere})`)
    ok(st.noShow === 0, `★ ${label}: لا «لم يحضر» في شاشة الدكتور`)
    ok(st.hints.length === 0, `${label}: لا جملة تحت البطاقات (الجملة في الشريط)`)
    if (cur) {
      ok(st.walkins.every(Boolean), `★ ${label}: «بدء كشف» في بطاقة التالي معطّل`)
      ok(st.call[0], `${label}: «نادِ التالي» معطّل`)
      ok(st.callbarText.startsWith(HINT), `★ ${label}: الجملة في الشريط الثابت (${st.callbarText})`)
    } else {
      ok(st.walkins.every((d) => !d) && st.call.every((d) => !d),
        `${label}: الأزرار مفعّلة (${j2(st)})`)
      ok(st.callbarText.includes('الدور 2'), `${label}: الشريط يقول من التالي (${st.callbarText})`)
    }
    if (label.startsWith('منادى'))
      ok(st.late === 1 && st.stepOut === 0, `★ ${label}: «تأخّر المريض» بدل «خروج مؤقت» (${st.late}/${st.stepOut})`)
    if (label === 'قيد الكشف')
      ok(st.late === 0 && st.stepOut === 1, `★ ${label}: «خروج مؤقت» بلا «تأخّر» (${st.late}/${st.stepOut})`)
    // بطاقة «بانتظار العودة»: لا نداء — «بدء كشف» لمن دخل الغرفة (معطّل ما دام عنده أحد) و«إنهاء»
    ok(st.resume.length === 0 && st.returnCall.length === 0,
      `★ ${label}: «بانتظار العودة» بلا «نداء» ولا «استئناف» (${j2(st.wrButtons)})`)
    ok(j2(st.wrButtons) === j2([['بدء كشف', !!cur], ['إنهاء كشف', false]]),
      `★ ${label}: «بدء كشف» و«إنهاء كشف» (${j2(st.wrButtons)})`)
    ok(derr.length === 0, `${label}: لا أخطاء صفحة ${derr.join(' | ')}`)
    await dctx.close()
  }

  // ═══ العائدون على الدور (waiting-return-modes) ═══
  // ٥ كبست له الاستقبال «رجع» الآن، و٦ رجع تلقائياً قبل دقيقة (فهو الأسبق رجوعاً)، و٧ ما زال
  // خارجاً لعشر دقائق، و٨ إسعافيّ حاضر. الدور المتوقَّع: ٨ ثمّ ٦ ثمّ ٥ ثمّ ٢ و٣.
  {
    const t = (sec) => new Date(Date.now() + sec * 1000).toISOString()
    const appts = [ap(8, 'arrived', 8, { priority: 'urgent' }), ap(2, 'arrived', 2), ap(3, 'arrived', 3),
      ap(5, 'waiting_return', 5, { started_at: t(-1200), stepped_out_at: t(-1200), returned_at: t(-5) }),
      ap(6, 'waiting_return', 6, { started_at: t(-1000), stepped_out_at: t(-960), return_due_at: t(-60) }),
      ap(7, 'waiting_return', 7, { started_at: t(-400), stepped_out_at: t(-300), return_due_at: t(600) }),
      ap(9, 'waiting_return', 9, { started_at: null, stepped_out_at: t(-100), late_at: t(-100) })]
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar' })
    await ctx.addInitScript(() => localStorage.setItem('token', 'test'))
    const page = await ctx.newPage()
    const perr = []; page.on('pageerror', (e) => perr.push(e.message))
    const posts = []
    await page.route('**/api/**', (r) => {
      const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
      const json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
      if (r.request().method() === 'POST') { posts.push(p); return json({}) }
      if (p === '/auth/me') return json({ role: 'doctor', doctor_id: 1, display_name: 'د. عيون' })
      if (p === '/clinic/my-sessions') return json([{ id: 1, start_time: '09:00:00', end_time: '14:00:00', status: 'open',
        active_count: appts.length, flow_mode: 'attendance', apologized: false }])
      if (/^\/clinic\/sessions\/\d+\/queue$/.test(p)) return json({ id: 1, flow_mode: 'attendance', doctor_name: D1,
        appointments: appts, server_now: new Date().toISOString() })
      if (p === '/clinic/my-procedures') return json({ lines: [], usage: {} })
      if (p.startsWith('/push')) return json({ enabled: false })
      return json([])
    })
    await page.goto(`${BASE}/clinic/doctor`, { waitUntil: 'load' })
    await page.waitForSelector('.dk-wait-list', { timeout: 10000 }).catch(() => {})
    const st = await page.evaluate(() => ({
      order: [...document.querySelectorAll('.dk-wait-list li .dk-wait-num')].map((e) => e.textContent.trim()),
      tags: [...document.querySelectorAll('.dk-wait-list li')].filter((li) => li.querySelector('.dk-tag'))
        .map((li) => li.querySelector('.dk-wait-num').textContent.trim()),
      next: document.querySelector('.dk-wait.is-next')?.textContent || '',
      nextButtons: [...document.querySelectorAll('.dk-next-actions button')].map((b) => b.textContent.trim()),
      out: [...document.querySelectorAll('.wr-list .wr-item')].map((li) => li.textContent),
    }))
    ok(j2(st.order) === j2(['8', '6', '5', '2', '3']), `★ العائدون بعد الإسعافي وقبل الحاضرين، الأسبق رجوعاً أولاً (${j2(st.order)})`)
    ok(j2(st.tags) === j2(['6', '5']), `العائدان بعلامة «عائد» (${j2(st.tags)})`)
    ok(st.out.length === 2 && st.out[0].includes('الدور 7') && st.out[0].includes('يرجع على الدور بعد'),
      `★ «بانتظار العودة» فيه من ما زال خارجاً وحده، بعدٍّ تنازلي (${j2(st.out)})`)
    ok(st.out[1]?.includes('الدور 9') && st.out[1].includes('تأخّر') && st.out[1].includes('نودي ولم يدخل')
      && !st.out[1].includes('إنهاء كشف'), `★ المتأخّر: علامة «تأخّر»، «نودي ولم يدخل»، بلا «إنهاء» (${j2(st.out[1])})`)
    // نجعل الإسعافيّ يُخدَم: نُخرجه من القائمة فيصير ٦ «التالي»
    appts.splice(0, 1)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.dk-wait.is-next', { timeout: 10000 }).catch(() => {})
    const nx = await page.evaluate(() => ({
      next: document.querySelector('.dk-wait.is-next')?.textContent || '',
      nextButtons: [...document.querySelectorAll('.dk-next-actions button')].map((b) => b.textContent.trim()),
    }))
    ok(nx.next.startsWith('6') && nx.next.includes('مريض 6') && nx.next.includes('عائد — يكمّل كشفه'), `★ «التالي» هو العائد 6 بعلامته (${nx.next})`)
    ok(j2(nx.nextButtons) === j2(['بدء كشف']), `★ بطاقة «التالي»: «بدء كشف» وحده (${j2(nx.nextButtons)})`)
    await page.locator('.dk-callbar button', { hasText: 'نادِ التالي' }).click()
    await page.waitForTimeout(300)
    ok(posts.includes('/clinic/appointments/6/return'), `★ «نادِ التالي» (الشريط) على العائد = نداء العودة (${j2(posts)})`)
    posts.length = 0
    await page.locator('.dk-next-actions button', { hasText: 'بدء كشف' }).click()
    await page.waitForTimeout(300)
    ok(posts.includes('/clinic/appointments/6/resume'), `★ «بدء كشف» على العائد = استئناف صامت (${j2(posts)})`)
    posts.length = 0
    await page.locator('.wr-list .wr-item', { hasText: 'الدور 7' }).locator('button', { hasText: 'بدء كشف' }).click()
    await page.waitForTimeout(300)
    ok(posts.includes('/clinic/appointments/7/resume'), `★ «بدء كشف» على بطاقة الخارج (دخل غرفته مباشرةً) = استئناف (${j2(posts)})`)
    ok(!posts.some((p) => p.endsWith('/returned')), 'الطبيب لا يكبس «رجع» — للاستقبال')
    ok(perr.length === 0, `العائدون: لا أخطاء صفحة ${perr.join(' | ')}`)
    await ctx.close()
  }
  await browser.close()
  stop()
  console.log(`\n═══ ${pass} ✔   ${failures.length} ✘ ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
}

run().catch((e) => { console.error(e); process.exit(1) })
