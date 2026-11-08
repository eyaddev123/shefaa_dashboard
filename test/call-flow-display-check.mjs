// ═══════════════════════════════════════════════════════════════════
// شاشة الصالة وأبواب الكشف الصامتة — متصفّح حقيقي بمحاكاة Chrome 66
//
// يُشغَّل بـ: npm run test:call-flow
//
// الخادم يبثّ لـ«المريض جوّا» و«دخل بدون نداء» والتراجع refresh صامتاً (quiet) يحمل
// appointment_id، وللإنهاء refresh يحمله بلا quiet. نفحص ما يراه الواقف في الصالة:
//   ١) نداءٌ حقيقي: بطاقة النداء الكبيرة + وميض البطاقة (كما كان).
//   ٢) «المريض جوّا» لهذا المريض: بطاقة النداء تُسحب فوراً، بلا وميض.
//   ٣) «دخل بدون نداء»: الرقم في «يُخدَم الآن» ويخرج من الحبّات — بلا بطاقة نداء ولا وميض.
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
  ok(s.cards[0].number.trim() === '1', `النداء الحقيقي: «يُخدَم الآن» = ١ (${s.cards[0].number})`)
  await pause(3300)   // ينتهي الوميض (FLASH_MS)

  // ٢) «المريض جوّا» لهذا المريض: refresh صامت برقم حجزه
  await emit('refresh', { session_id: '1', appointment_id: 7, doctor_name: D1, quiet: true, seq: 3 })
  await pause(600)
  s = await read()
  ok(!s.banner, '★ «المريض جوّا»: بطاقة النداء سُحبت فوراً (لا يبقى «منادى»)')
  ok(!s.cards[0].flash, '★ «المريض جوّا»: بلا وميض')
  ok(s.cards[0].number.trim() === '1', '★ «المريض جوّا»: الرقم ما زال في «يُخدَم الآن»')

  // إنهاء: refresh بلا quiet، «يُخدَم الآن» يفرغ
  served = board(null, [2, 3], 20, [21, 22])
  await emit('refresh', { session_id: '1', appointment_id: 7, doctor_name: D1, seq: 4 })
  await pause(600)
  s = await read()
  ok(s.cards[0].number.trim() === '—', `الإنهاء: «يُخدَم الآن» فرغ (${s.cards[0].number})`)

  // ٣) «دخل بدون نداء» للدور ٣ (ليس الأوّل)
  served = board(3, [2], 20, [21, 22])
  await emit('refresh', { session_id: '1', appointment_id: 9, doctor_name: D1, quiet: true, seq: 5 })
  await pause(150)
  const early = await read()
  await pause(600)
  s = await read()
  ok(s.cards[0].number.trim() === '3', `★ «دخل بدون نداء»: الدور ٣ في «يُخدَم الآن» (${s.cards[0].number})`)
  ok(!s.cards[0].chips.includes('3') && s.cards[0].chips.includes('2'), `★ «دخل بدون نداء»: خرج من الحبّات، وبقي الدور ٢ (${s.cards[0].chips})`)
  ok(!s.banner && !early.banner, '★ «دخل بدون نداء»: لا بطاقة نداء إطلاقاً')
  ok(!s.cards[0].flash && !early.cards[0].flash, '★ «دخل بدون نداء»: لا وميض')

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
  await browser.close()
  stop()
  console.log(`\n═══ ${pass} ✔   ${failures.length} ✘ ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
}

run().catch((e) => { console.error(e); process.exit(1) })
