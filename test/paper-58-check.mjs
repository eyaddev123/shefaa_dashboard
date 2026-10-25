// ═══════════════════════════════════════════════════════════════════
// فحص ورق ٥٨مم على رأس ٨٠مم — بلا ورق
//
// يُشغَّل بـ: npm run test:paper   (يحتاج كروم playwright)
//
// ورق ٥٨مم يقف على يسار رأس XP-T80Q، فما عن يمين الشريط يُطبع في الهواء.
// السلسلة حقيقية: الوسيط نفسه بتشغيلٍ جافّ مرّتين (printable_width 58 و80)
// ⇒ الواجهة تسأله عن العرض وترسم ⇒ نفكّ مهمّة ESC/POS ونفحص البكسلات:
// على 58 لا بكسل أسود يمين ٣٨٤ نقطة، والعناصر متوسّطة على الشريط لا الرأس.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { encodeGrayPng } from '../print-helper/src/png.js'
import { bitAt } from '../print-helper/src/escpos.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.TICKET_SHOTS || resolve(ROOT, '.ticket-shots')
mkdirSync(SHOTS, { recursive: true })
const PORT = Number(process.env.PAPER_TEST_PORT || 5236)
const BASE = `http://127.0.0.1:${PORT}`
// ★ خارج 17625 (منفذ الوسيط الحقيقيّ): تصادمٌ كان سيطبع فعلاً
const P58 = 18100 + Math.floor(Math.random() * 800)
const P80 = P58 + 1
const HEAD = 576, STRIP = 384      // ٧٢مم و٤٨مم على ٢٠٣dpi

let pass = 0
const failures = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✘ ${label}${detail ? ` ${detail}` : ''}`)
  return false
}

function parseStream(job) {
  const ops = [], images = []
  let cur = null, i = 0
  while (i < job.length) {
    if (job[i] === 0x1b && job[i + 1] === 0x40) { ops.push('init'); i += 2; continue }
    if (job[i] === 0x1b && job[i + 1] === 0x4a) { ops.push('feed'); cur = null; i += 3; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x56) { ops.push('cut'); cur = null; i += 4; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
      const bpl = job[i + 4] + job[i + 5] * 256
      const rows = job[i + 6] + job[i + 7] * 256
      if (!cur) { cur = { width: bpl * 8, height: 0, chunks: [] }; images.push(cur); ops.push('raster') }
      cur.chunks.push(Buffer.from(job.subarray(i + 8, i + 8 + bpl * rows))); cur.height += rows
      i += 8 + bpl * rows; continue
    }
    ops.push('?'); i++
  }
  return { ops, images: images.map((m) => ({ width: m.width, height: m.height, bits: Buffer.concat(m.chunks) })) }
}

// أقصى x فيه حبر
const maxInkX = (img) => {
  let mx = -1
  for (let y = 0; y < img.height; y++)
    for (let x = img.width - 1; x > mx; x--) if (bitAt(img, x, y)) { mx = x; break }
  return mx
}
// أشرطة الأسطر: صفوفٌ متتالية فيها حبر، يفصلها صفٌّ أبيض — مع حدودها الأفقية
const bands = (img) => {
  const out = []
  let cur = null
  for (let y = 0; y < img.height; y++) {
    let x0 = -1, x1 = -1
    for (let x = 0; x < img.width; x++) if (bitAt(img, x, y)) { if (x0 < 0) x0 = x; x1 = x }
    if (x0 < 0) { cur = null; continue }
    if (!cur) { cur = { y0: y, y1: y, x0, x1 }; out.push(cur) }
    cur.y1 = y; cur.x0 = Math.min(cur.x0, x0); cur.x1 = Math.max(cur.x1, x1)
  }
  return out.map((b) => ({ ...b, h: b.y1 - b.y0 + 1, cx: (b.x0 + b.x1) / 2 }))
}

const DATA = { queue_number: 128, full_name: 'عبد الرحمن محمد الخطيب', birth_year: 1990,
  visit_type: 'consultation', fee: 15000, procedures: [{ name: 'تخطيط قلب', price: 25000 }],
  doctor_name: 'د. سامر الحلبي', room: '3', now: '2026-10-24T09:15:00' }
// أطول ما يُتوقَّع: اسمٌ رباعيّ طويل وإجراءٌ باسمٍ طويل ومبلغٌ كبير
const LONG = { ...DATA, full_name: 'عبد الرحمن محمد أمين عبد الكريم الخطيب الحسيني',
  doctor_name: 'د. عبد الرحمن محمد سامر الحلبي الحسيني',
  procedures: [{ name: 'تصوير بالأمواج فوق الصوتية للبطن والحوض كاملاً', price: 1250000 },
               { name: 'تخطيط قلب', price: 25000 }] }

const run = async () => {
  const work = mkdtempSync(join(tmpdir(), 'shefaa-paper-'))
  const helpers = []
  const startHelper = (port, printable) => {
    const jobs = join(work, `jobs-${printable}`)
    const cfg = join(work, `cfg-${printable}.json`)
    const conf = { port, printer: 'DRY-RUN-NO-SUCH-PRINTER', token: 'tk', origins: [BASE], log: join(work, `h${printable}.log`) }
    if (printable === 58) conf.printable_width = 58      // ٨٠ = الإعداد القديم بلا المفتاح أصلاً
    writeFileSync(cfg, JSON.stringify(conf))
    const p = spawn(process.execPath, [resolve(ROOT, 'print-helper/src/server.js')],
      { env: { ...process.env, SHEFAA_PRINT_CONFIG: cfg, SHEFAA_PRINT_DRY_RUN: jobs }, stdio: ['ignore', 'pipe', 'pipe'] })
    const h = { p, jobs, log: '' }
    p.stdout.on('data', (d) => { h.log += d })
    helpers.push(h)
    return h
  }
  const h58 = startHelper(P58, 58)
  const h80 = startHelper(P80, 80)
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' })
  const stop = () => {
    try { vite.kill('SIGTERM') } catch { /* انتهى */ }
    helpers.forEach((h) => { try { h.p.kill() } catch { /* انتهى */ } })
  }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('✖ لم يُقلع خادم Vite'); stop(); process.exit(1) }

  // ★ حارس: المجيبان وسيطانا الجافّان — وإلّا لا طباعة إطلاقاً
  console.log('\n── ١) الوسيط يعلن عرض الورق ──')
  const health = {}
  for (const [w, port] of [[58, P58], [80, P80]]) {
    health[w] = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: BASE } }).then((r) => r.json()).catch(() => ({}))
    if (health[w].dry_run !== true) { console.error('✖ وسيطٌ ليس جافّاً على منفذ الفحص — توقّف قبل أيّ طباعة'); stop(); process.exit(1) }
  }
  ok(health[58].printable_width === 58, '★ printable_width: 58 ⇒ /health يقول 58', JSON.stringify(health[58]))
  ok(health[80].printable_width === 80, '★ config.json بلا المفتاح ⇒ 80 (كما كان)', String(health[80].printable_width))
  ok(/ورق 58مم/.test(h58.log), 'سجلّ الإقلاع يذكر ورق ٥٨مم', h58.log.slice(0, 160))

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.evaluate(async () => {
    const st = document.createElement('style')
    st.textContent = "@font-face{font-family:'Cairo';font-weight:400 700;src:url('/fonts/cairo-arabic.woff2') format('woff2')}"
    document.head.appendChild(st)
    await document.fonts.load('700 30px Cairo', 'مجمع'); await document.fonts.load('400 24px Cairo', 'نسخة')
  })
  const printVia = (data, port, copies) => page.evaluate(async ([d, p, c]) => {
    const m = await import('/src/print-helper.js')
    return m.printViaHelper(d, 80, { port: p, token: 'tk' }, document, { copies: c })
  }, [data, port, copies])
  const lastJob = (h) => {
    const f = readdirSync(h.jobs).sort()
    return parseStream(readFileSync(join(h.jobs, f[f.length - 1])))
  }
  const shot = (img, name) => {
    const out = join(SHOTS, name)
    writeFileSync(out, encodeGrayPng(img.width, img.height, (x, y) => bitAt(img, x, y)))
    console.log(`     ↳ ${out}`)
  }

  // ── ٢) ٥٨: نسختان، اللوحة ٥٧٦، والحبر كلّه في الشريط الأيسر ──
  console.log('\n── ٢) ورق ٥٨مم: نسختان ──')
  const r58 = await printVia(DATA, P58, 2)
  ok(r58.ok && r58.copies === 2 && r58.mode === 'one-job' && r58.printable === 58,
    '★ الطباعة نجحت: نسختان في مهمّةٍ واحدة، مرسومتان لـ٥٨', JSON.stringify(r58))
  const j58 = lastJob(h58)
  ok(j58.ops.join(',') === 'init,raster,feed,cut,raster,feed,cut', '★ القطع كما هو: اطبع، اقطع، اطبع، اقطع', j58.ops.join(' → '))
  j58.images.forEach((img, i) => {
    const mx = maxInkX(img)
    ok(img.width === HEAD, `النسخة ${i + 1}: عرض السطر ٥٧٦ نقطة كما على ٨٠ (البروتوكول لم يتغيّر)`, String(img.width))
    ok(mx >= 0 && mx < STRIP, `★★ النسخة ${i + 1}: لا بكسل أسود يمين حدّ ٥٨مم (أقصى حبر x=${mx} < ${STRIP})`, String(mx))
    shot(img, `paper58-copy-${i + 1}.png`)
  })
  ok(!/حبرٌ يمين/.test(h58.log), 'الوسيط لم يرَ حبراً خارج الشريط')

  // ── ٣) المحاذاة: المتوسّط على ٨٠ صار متوسّطاً على الشريط ──
  console.log('\n── ٣) المحاذاة ورقم الدور ──')
  const b58 = bands(j58.images[0])
  const r80 = await printVia(DATA, P80, 1)
  const j80 = lastJob(h80)
  const b80 = bands(j80.images[0])
  const queueOf = (bs) => bs.reduce((a, b) => (b.h > a.h ? b : a))
  const q58 = queueOf(b58), q80 = queueOf(b80)
  ok(Math.abs(q58.cx - STRIP / 2) <= 8, `★ رقم الدور متوسّطٌ على الشريط (مركزه ${q58.cx} ≈ ${STRIP / 2})`, String(q58.cx))
  ok(Math.abs(b58[0].cx - STRIP / 2) <= 8, `★ اسم المجمع متوسّطٌ على الشريط (مركزه ${b58[0].cx})`, String(b58[0].cx))
  ok(Math.abs(q80.cx - HEAD / 2) <= 8, `على ٨٠: رقم الدور متوسّطٌ على الرأس كما كان (${q80.cx} ≈ ${HEAD / 2})`, String(q80.cx))
  const second58 = b58.filter((b) => b !== q58).reduce((a, b) => (b.h > a.h ? b : a))
  ok(q58.h >= 1.8 * second58.h, `★ رقم الدور أكبر عنصرٍ بفارق: ${q58.h} نقطة مقابل ${second58.h} للتالي`, `${q58.h}/${second58.h}`)
  ok(q58.h >= 50, `★ رقم الدور واضحٌ من بعيد (ارتفاع الحبر ${q58.h} نقطة ≈ ${(q58.h / 8).toFixed(1)}مم)`, String(q58.h))
  // أصغر سطرٍ مقروء: لا شريط أدنى من ١٠ نقاط (≈١.٢مم) — عدا خطوط الفصل
  const textBands = b58.filter((b) => b.x1 - b.x0 < STRIP - 40 || b.h > 4)
  const minH = Math.min(...textBands.filter((b) => b.h > 4).map((b) => b.h))
  ok(minH >= 10, `أصغر سطرٍ ارتفاعه ${minH} نقطة (≥ ١٠)`, String(minH))
  ok(b58.length >= b80.length, `المحتوى كاملاً: ${b58.length} شريطاً على ٥٨ مقابل ${b80.length} على ٨٠`)
  shot(j80.images[0], 'paper80.png')

  // ── ٤) أطول بيانات: تلتفّ داخل الشريط ولا تخرج منه ──
  console.log('\n── ٤) اسمٌ وإجراءٌ طويلان ──')
  const rl = await printVia(LONG, P58, 1)
  const jl = lastJob(h58)
  const mxl = maxInkX(jl.images[0])
  ok(rl.ok && mxl >= 0 && mxl < STRIP, `★★ لا حبر يمين حدّ ٥٨مم حتى مع الأسماء الطويلة (x=${mxl})`, String(mxl))
  shot(jl.images[0], 'paper58-long.png')

  // ── ٥) ٨٠ لم يتغيّر: الإعداد القديم يرسم كما كان، ومن غير المسار الجديد ──
  console.log('\n── ٥) ٨٠مم كما كان ──')
  const same = await page.evaluate(async (d) => {
    const m = await import('/src/print-helper.js')
    const a = await m.renderTicketPng(d, 80, document, {})
    const b = await m.renderTicketPng(d, 80, document, { printable: 80 })
    return a.png === b.png && a.width === 576
  }, DATA)
  ok(same, 'printable 80 ⇒ الرسم نفسه بايتاً بايتاً كالرسم بلا الإعداد')
  ok(maxInkX(j80.images[0]) > STRIP, 'على ٨٠ المحتوى يمتدّ على الرأس كلّه (لم يُحشر في الشريط)')

  // ── ٦) واجهةٌ أقدم ترسل بطاقة ٨٠ إلى وسيطٍ على ٥٨: تُطبع، ويُسجَّل تحذير ──
  console.log('\n── ٦) تشخيص واجهةٍ قديمة ──')
  const old = await page.evaluate(async (d) => {
    const m = await import('/src/print-helper.js')
    return (await m.renderTicketPng(d, 80, document, {})).png
  }, DATA)
  const res = await fetch(`http://127.0.0.1:${P58}/print`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Print-Token': 'tk' },
    body: JSON.stringify({ images: [old] }) })
  await new Promise((r) => setTimeout(r, 100))
  ok(res.status === 200, 'الوسيط لا يرفضها (الطباعة لا تنقطع)', String(res.status))
  ok(/حبرٌ يمين حدّ ٥٨مم/.test(h58.log), '★ ويكتب في سجلّه أنّ الواجهة لم ترسم على الشريط')

  ok(errors.length === 0, 'لا أخطاء صفحة', errors.join(' | '))
  await browser.close()
  stop()
  rmSync(work, { recursive: true, force: true })

  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
  console.log('✔ على ٥٨ كلّ الحبر في الشريط الأيسر ومتوسّطٌ عليه، و٨٠ كما كان\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
