// ═══════════════════════════════════════════════════════════════════
// فحص النسختين من البداية إلى بايتات الطابعة — بلا ورق
//
// يُشغَّل بـ: npm run test:copies   (يحتاج كروم playwright)
//
// السلسلة كلّها حقيقية: وحدات التطبيق نفسها في متصفّحٍ حقيقيّ ترسم البطاقة
// بخطّ Cairo ⇒ الوسيط نفسه (print-helper/src/server.js) يستقبل الطلب ⇒
// يبني مهمّة ESC/POS. والوسيط بتشغيلٍ جافّ (SHEFAA_PRINT_DRY_RUN) يكتب المهمّة
// ملفّاً بدل الطابعة، واسم الطابعة غير موجود أصلاً — فلا شيء يُطبع.
// ثمّ نفكّ البايتات صوراً ونعدّ أوامر القطع ونقارن كلّ بكسل بما رسمه المتصفّح.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { decodePng, encodeGrayPng } from '../print-helper/src/png.js'
import { rgbaToBits, bitAt } from '../print-helper/src/escpos.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.TICKET_SHOTS || resolve(ROOT, '.ticket-shots')
mkdirSync(SHOTS, { recursive: true })
const PORT = Number(process.env.COPIES_TEST_PORT || 5234)
const BASE = `http://127.0.0.1:${PORT}`
// ★ خارج 17625 (منفذ الوسيط الحقيقيّ على جهازٍ مثبَّتٍ عليه): تصادمٌ كان سيطبع فعلاً
const HELPER_PORT = 18100 + Math.floor(Math.random() * 800)
const OLD_PORT = HELPER_PORT + 1

let pass = 0
const failures = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✘ ${label}${detail ? ` ${detail}` : ''}`)
  return false
}

// ═══ مفكّك التدفّق: كما تقرؤه الطابعة ═══
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

const run = async () => {
  const work = mkdtempSync(join(tmpdir(), 'shefaa-copies-'))
  const jobs = join(work, 'jobs')
  const cfg = join(work, 'cfg.json')
  writeFileSync(cfg, JSON.stringify({ port: HELPER_PORT, printer: 'DRY-RUN-NO-SUCH-PRINTER', token: 'tk',
    origins: [BASE], log: join(work, 'helper.log') }))

  // ── الوسيط الحقيقيّ بتشغيلٍ جافّ ──
  const helper = spawn(process.execPath, [resolve(ROOT, 'print-helper/src/server.js')],
    { env: { ...process.env, SHEFAA_PRINT_CONFIG: cfg, SHEFAA_PRINT_DRY_RUN: jobs }, stdio: ['ignore', 'pipe', 'pipe'] })
  let helperLog = ''
  helper.stdout.on('data', (d) => { helperLog += d })

  // ── وسيطٌ «قديم» (الإصدار ١): يرفض images[] بنفس رسالته، ويقبل image واحدة ──
  const oldReqs = []
  const old = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', BASE)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Token')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    // الواجهة تسأل /health قبل الطباعة (عرض الورق) — والإصدار ١ لا يذكره
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"version":1}'); return }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const obj = JSON.parse(body || '{}')
      oldReqs.push(Object.keys(obj).join(','))
      res.setHeader('Content-Type', 'application/json')
      if (!/^data:image\/png;base64,/.test(obj.image || '')) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'image يجب أن تكون data:image/png;base64,…' })); return
      }
      res.writeHead(200); res.end(JSON.stringify({ ok: true, job: 'old' }))
    })
  }).listen(OLD_PORT, '127.0.0.1')

  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' })
  const stop = () => {
    try { vite.kill('SIGTERM') } catch { /* انتهى */ }
    try { helper.kill() } catch { /* انتهى */ }
    try { old.close() } catch { /* انتهى */ }
  }
  process.on('exit', stop)
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('✖ لم يُقلع خادم Vite'); stop(); process.exit(1) }
  ok(/تشغيلٌ جافّ/.test(helperLog), 'الوسيط بتشغيلٍ جافّ — لا شيء يصل طابعة', helperLog.slice(0, 120))
  // ★ حارس: المجيب على المنفذ هو وسيطنا الجافّ — وإلّا لا طباعة إطلاقاً
  const hh = await fetch(`http://127.0.0.1:${HELPER_PORT}/health`, { headers: { Origin: BASE } }).then((r) => r.json()).catch(() => ({}))
  if (hh.dry_run !== true) { console.error('✖ الوسيط على المنفذ ليس جافّاً — توقّف الفحص قبل أيّ طباعة'); stop(); process.exit(1) }
  ok(hh.dry_run === true, '★ /health يقول dry_run قبل أيّ طلب طباعة')

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/`, { waitUntil: 'load' })

  // ── ① الطباعة التلقائية: نسختان في طلبٍ واحد ──
  console.log('\n── ١) نسختان: من المتصفّح إلى بايتات الطابعة ──')
  const DATA = { queue_number: 12, full_name: 'عبد الرحمن محمد الخطيب', birth_year: 1990,
    visit_type: 'consultation', fee: 15000, procedures: [{ name: 'تخطيط قلب', price: 25000 }],
    doctor_name: 'د. سامر الحلبي', room: '3', now: '2026-10-24T09:15:00' }
  const r = await page.evaluate(async ([data, port]) => {
    // الخطّ كما في التطبيق — نضمن تحميله قبل الرسم
    const st = document.createElement('style')
    st.textContent = "@font-face{font-family:'Cairo';font-weight:400 700;src:url('/fonts/cairo-arabic.woff2') format('woff2')}"
    document.head.appendChild(st)
    await document.fonts.load("700 30px Cairo", 'مجمع'); await document.fonts.load("400 24px Cairo", 'نسخة')
    const m = await import('/src/print-helper.js')
    const t = await import('/src/ticket-print.js')
    const res = await m.printViaHelper(data, 80, { port, token: 'tk' }, document, { copies: 2 })
    // ما رسمه المتصفّح لكلّ نسخة — للمقارنة بما في المهمّة
    const a = await m.renderTicketPng(data, 80, document, { copy: t.copyLabel(0) })
    const b = await m.renderTicketPng(data, 80, document, { copy: t.copyLabel(1) })
    const c = document.createElement('canvas').getContext('2d')
    c.font = '700 30px Cairo'
    return { res, a: a.png, b: b.png, labels: [t.copyLabel(0), t.copyLabel(1)],
             orgFits: c.measureText(t.ORG_NAME).width <= 576 * 0.9, cairo: document.fonts.check('700 30px Cairo') }
  }, [DATA, HELPER_PORT])
  ok(r.cairo, 'خطّ Cairo محمَّل في الرسم')
  ok(r.res.ok && r.res.copies === 2 && r.res.mode === 'one-job', '★ الطباعة نجحت: نسختان في مهمّةٍ واحدة', JSON.stringify(r.res))
  ok(r.labels[0] === 'نسخة المريض' && r.labels[1] === 'نسخة العيادة', 'الأولى «نسخة المريض» والثانية «نسخة العيادة»')
  ok(r.orgFits, '★ «مجمع عيادات الشفاء الطبي» يسع ٧٢مم سطراً واحداً (٨٠مم)')

  const files = readdirSync(jobs)
  ok(files.length === 1, '★ طلبٌ واحد ⇒ مهمّةٌ واحدة إلى الطابعة', files.join(','))
  const bytes = readFileSync(join(jobs, files[0]))
  const { ops, images } = parseStream(bytes)
  const cuts = ops.filter((o) => o === 'cut').length
  ok(cuts === 2, `★★ في تدفّق البايتات قطعان بالضبط (${cuts})`)
  ok(ops.join(',') === 'init,raster,feed,cut,raster,feed,cut', '★ اطبع، اقطع، اطبع، اقطع', ops.join(' → '))
  ok(!ops.includes('?'), 'لا بايتاتٍ مجهولة')

  // ── المقارنة: ما في المهمّة = ما رسمه المتصفّح بعد العتبة، بكسلاً بكسلاً ──
  const toBits = (dataUrl) => { const d = decodePng(Buffer.from(dataUrl.split(',')[1], 'base64'))
    return rgbaToBits(d.width, d.height, d.rgba) }
  const want = [toBits(r.a), toBits(r.b)]
  images.forEach((img, k) => {
    let diff = 0
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
      if (bitAt(img, x, y) !== bitAt(want[k], x, y)) diff++
    ok(img.width === 576 && img.height === want[k].height && diff === 0,
      `★★ النسخة ${k + 1} في البايتات مطابقة لما رُسم (${img.width}×${img.height})`, `اختلاف ${diff}`)
    const out = join(SHOTS, `copy-${k + 1}-decoded-from-escpos.png`)
    writeFileSync(out, encodeGrayPng(img.width, img.height, (x, y) => bitAt(img, x, y)))
    console.log(`     ↳ ${out}`)
  })
  // ★ النسختان متطابقتان إلا اسم النسخة في الأسفل
  if (images.length === 2) {
    const [a, b] = images
    const rows = []
    for (let y = 0; y < Math.min(a.height, b.height); y++) {
      let d = false
      for (let x = 0; x < a.width && !d; x++) if (bitAt(a, x, y) !== bitAt(b, x, y)) d = true
      if (d) rows.push(y)
    }
    ok(a.height === b.height, 'النسختان بالطول نفسه')
    ok(rows.length > 0 && rows[0] > a.height - 60,
      `★ الفرق في الأسفل وحده — أسطر ${rows[0]}…${rows[rows.length - 1]} من ${a.height}`)
  }

  // ── ② وسيطٌ قديم على الجهاز: نسخةً نسخة، فلا تنقطع الطباعة قبل التحديث ──
  console.log('\n── ٢) وسيطٌ قديم (قبل النسخ) ──')
  const o = await page.evaluate(async ([data, port]) => {
    const m = await import('/src/print-helper.js')
    return m.printViaHelper(data, 80, { port, token: '' }, document, { copies: 2 })
  }, [DATA, OLD_PORT])
  ok(o.ok && o.mode === 'per-copy' && o.copies === 2, '★ الوسيط القديم يرفض images[] ⇒ نسختان طلباً طلباً', JSON.stringify(o))
  ok(oldReqs.join('|') === 'images|image|image', 'الطلبات: محاولةٌ ثمّ نسخةٌ نسخة', oldReqs.join('|'))

  // ── ③ إعادة الطباعة بنسخةٍ واحدة (الافتراض) ──
  console.log('\n── ٣) نسخة واحدة ──')
  rmSync(jobs, { recursive: true, force: true })
  const one = await page.evaluate(async ([data, port]) => {
    const m = await import('/src/print-helper.js')
    return m.printViaHelper(data, 80, { port, token: 'tk' }, document, { copies: 1 })
  }, [DATA, HELPER_PORT])
  const f1 = readdirSync(jobs)
  const p1 = parseStream(readFileSync(join(jobs, f1[0])))
  ok(one.ok && p1.ops.filter((x) => x === 'cut').length === 1 && p1.images.length === 1, 'نسخة واحدة ⇒ قطعٌ واحد', p1.ops.join(','))

  // ── ④ الإعداد: ٢ افتراضاً، ويُحفظ دون محو منفذ الوسيط ورمزه ──
  console.log('\n── ٤) إعداد عدد النسخ ──')
  const s = await page.evaluate(async () => {
    const t = await import('/src/ticket-print.js')
    localStorage.clear()
    const dflt = t.loadPrinter().copies
    localStorage.setItem('shefaa.printer', JSON.stringify({ port: 17999, token: 'secret' }))
    t.savePrinter({ ...t.loadPrinter(), copies: 3, enabled: true })
    const raw = JSON.parse(localStorage.getItem('shefaa.printer'))
    localStorage.setItem('shefaa.printer', JSON.stringify({ copies: 99 }))
    const clamped = t.loadPrinter().copies
    return { dflt, raw, clamped }
  })
  ok(s.dflt === 2, '★ الافتراض نسختان')
  ok(s.raw.copies === 3 && s.raw.port === 17999 && s.raw.token === 'secret',
    '★ حفظ الإعداد لا يمحو منفذ الوسيط ورمزه', JSON.stringify(s.raw))
  ok(s.clamped === 2, 'قيمةٌ خارج المدى ⇒ الافتراض')

  ok(errors.length === 0, 'لا أخطاء صفحة', errors.join(' | '))
  await browser.close()
  stop()
  rmSync(work, { recursive: true, force: true })

  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
  console.log('✔ نسختان مقطوعتان في مهمّةٍ واحدة، وكلّ بكسلٍ في البايتات كما رُسم\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
