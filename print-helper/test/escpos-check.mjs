// ═══ فحص ESC/POS: نفكّ ما رمّزناه ونقارنه بالأصل ═══
//   npm test
//
// لا نطبع على الطابعة إطلاقاً. البرهان أقوى من الطباعة أصلاً: نأخذ صورةً
// معروفة، نرمّزها، ثمّ **نفكّ البايتات التي سنرسلها** ونتحقّق أنّ كلّ بكسلٍ
// عاد كما كان — ونقرأ رأس الأمر بايتاً بايتاً ونقارنه بالمواصفة.
import { decodePng, encodeGrayPng } from '../src/png.js'
import { rgbaToBits, buildJob, rasterCmd, feedDots, cutCmd, initCmd, bitAt } from '../src/escpos.js'
import { writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const OUT = process.env.TICKET_SHOTS || join(dirname(fileURLToPath(import.meta.url)), '..', '.out')
mkdirSync(OUT, { recursive: true })

let pass = 0
const fails = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✘ ${label}${detail ? ` ${detail}` : ''}`)
  return false
}

// ═══ ١) PNG ذهاباً وإياباً ═══
console.log('\n── ١) قارئ PNG ──')
{
  const W = 32, H = 16
  // نمطٌ معروف: قطريّ + إطار
  const want = (x, y) => x === y || x === 0 || y === 0 || x === W - 1 || y === H - 1
  const png = encodeGrayPng(W, H, want)
  const dec = decodePng(png)
  ok(dec.width === W && dec.height === H, 'الأبعاد تعود كما هي', `${dec.width}×${dec.height}`)
  let same = true
  for (let y = 0; y < H && same; y++)
    for (let x = 0; x < W; x++) {
      const black = dec.rgba[(y * W + x) * 4] < 128
      if (black !== want(x, y)) { same = false; break }
    }
  ok(same, '★ كلّ بكسلٍ عاد كما رُسم (ترميز ⇄ فكّ)')
}

// ═══ ٢) رأس GS v 0 مطابقٌ للمواصفة ═══
console.log('\n── ٢) رأس الأمر بايتاً بايتاً ──')
{
  // ٥٧٦ بكسل = ٧٢ بايتاً في السطر — وهو ما توثّقه المواصفة (بايتات لا بكسلات)
  const W = 576, H = 300
  const img = { width: W, height: H, bits: Buffer.alloc((W / 8) * H) }
  const cmd = rasterCmd(img, 1000)        // شريحةٌ واحدة لفحص الرأس
  ok(cmd[0] === 0x1d && cmd[1] === 0x76 && cmd[2] === 0x30,
    'البادئة 1D 76 30 (GS v 0)',
    [...cmd.subarray(0, 3)].map((b) => b.toString(16)).join(' '))
  ok(cmd[3] === 0, 'm = 0 (حجمٌ عاديّ)')
  const xL = cmd[4], xH = cmd[5], yL = cmd[6], yH = cmd[7]
  ok(xL + xH * 256 === W / 8,
    `★ xL/xH = عدد **البايتات** (${W / 8}) لا البكسلات (${W})`, `${xL + xH * 256}`)
  ok(yL + yH * 256 === H, `yL/yH = الارتفاع بالنقاط (${H})`, `${yL + yH * 256}`)
  ok(cmd.length - 8 === (W / 8) * H,
    '★ k = (البايتات/سطر) × (الارتفاع)', `${cmd.length - 8}`)
}

// ═══ ٣) ترتيب البتّات: MSB = البكسل الأيسر ═══
console.log('\n── ٣) ترتيب البتّات ──')
{
  const W = 16, H = 1
  const rgba = Buffer.alloc(W * H * 4, 255)
  rgba[3] = 255
  // اجعل البكسل ٠ أسود وحده
  rgba[0] = rgba[1] = rgba[2] = 0
  const m = rgbaToBits(W, H, rgba)
  ok(m.bits[0] === 0x80, '★ أوّل بكسلٍ أسود ⇒ البتّ الأعلى (0x80)',
    '0x' + m.bits[0].toString(16))
  // والبكسل ٧ (آخر بايتٍ أوّل)
  const rgba2 = Buffer.alloc(W * H * 4, 255)
  rgba2[7 * 4] = rgba2[7 * 4 + 1] = rgba2[7 * 4 + 2] = 0
  const m2 = rgbaToBits(W, H, rgba2)
  ok(m2.bits[0] === 0x01, 'البكسل ٧ ⇒ البتّ الأدنى (0x01)', '0x' + m2.bits[0].toString(16))
}

// ═══ ٤) العتبة: أسود/أبيض بلا رمادي ═══
console.log('\n── ٤) العتبة ──')
{
  const mk = (r, g, b, a = 255) => {
    const rgba = Buffer.alloc(4)
    rgba[0] = r; rgba[1] = g; rgba[2] = b; rgba[3] = a
    return rgbaToBits(1, 1, rgba).bits[0] !== 0
  }
  ok(mk(0, 0, 0) === true, 'الأسود ⇒ يُطبع')
  ok(mk(255, 255, 255) === false, 'الأبيض ⇒ لا يُطبع')
  ok(mk(255, 255, 255, 0) === false, '★ الشفّاف ⇒ ورقٌ أبيض (لا بقعة سوداء)')
  ok(mk(0, 0, 0, 0) === false, '★ أسودٌ شفّافٌ تماماً ⇒ أبيض أيضاً')
  ok(mk(200, 200, 200) === false, 'الرماديّ الفاتح ⇒ أبيض')
  ok(mk(60, 60, 60) === true, 'الرماديّ الغامق ⇒ أسود')
}

// ═══ ٥) ★ البرهان: نفكّ ما سنرسله ونقارنه بالأصل ═══
console.log('\n── ٥) فكّ ما سنرسله فعلاً ──')
{
  const W = 576, H = 220
  // رسمٌ يشبه بطاقةً: إطار، خطّ أفقيّ، كتلةٌ كبيرة (كأنّها رقم الدور)
  const want = (x, y) => (
    y < 3 || y >= H - 3 || x < 3 || x >= W - 3           // إطار
    || (y > 60 && y < 64)                                  // خطّ فاصل
    || (x > 240 && x < 340 && y > 90 && y < 170)          // كتلة الرقم
  )
  const png = encodeGrayPng(W, H, want)
  const dec = decodePng(png)
  const mono = rgbaToBits(dec.width, dec.height, dec.rgba)
  const job = buildJob(mono, { feedMm: 5 })

  // ── فكّ تدفّق البايتات كما تقرؤه الطابعة ──
  const parsed = []
  let i = 0
  const rebuilt = { width: W, height: H, bits: Buffer.alloc((W / 8) * H) }
  let rowCursor = 0
  while (i < job.length) {
    if (job[i] === 0x1b && job[i + 1] === 0x40) { parsed.push('init'); i += 2; continue }
    if (job[i] === 0x1b && job[i + 1] === 0x4a) { parsed.push(`feed:${job[i + 2]}`); i += 3; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x56) { parsed.push(`cut:${job[i + 2]}`); i += 4; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
      const bpl = job[i + 4] + job[i + 5] * 256
      const rows = job[i + 6] + job[i + 7] * 256
      const data = job.subarray(i + 8, i + 8 + bpl * rows)
      data.copy(rebuilt.bits, rowCursor * bpl)
      rowCursor += rows
      parsed.push(`raster:${bpl}B×${rows}`)
      i += 8 + bpl * rows
      continue
    }
    parsed.push(`?0x${job[i].toString(16)}`); i++
  }

  ok(parsed[0] === 'init', '★ التدفّق يبدأ بالتهيئة ESC @', parsed[0])
  ok(parsed.some((p) => p.startsWith('raster:')), 'فيه صورةٌ نقطيّة',
    parsed.filter((p) => p.startsWith('raster')).join(','))
  ok(rowCursor === H, '★ مجموع أسطر الشرائح = ارتفاع الصورة', `${rowCursor}/${H}`)
  const feeds = parsed.filter((p) => p.startsWith('feed:'))
    .reduce((s, p) => s + Number(p.split(':')[1]), 0)
  const wantDots = Math.round((5 / 25.4) * 203)
  ok(feeds === wantDots, `★ التغذية ${wantDots} نقطة (٥مم على ٢٠٣dpi)`, `${feeds}`)
  ok(parsed[parsed.length - 1].startsWith('cut:'), '★ ينتهي بأمر القطع GS V',
    parsed[parsed.length - 1])
  ok(!parsed.some((p) => p.startsWith('?')), 'لا بايتاتٍ مجهولة في التدفّق',
    parsed.filter((p) => p.startsWith('?')).slice(0, 5).join(','))

  // ── المقارنة بكسلاً بكسلاً ──
  let diff = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (bitAt(rebuilt, x, y) !== want(x, y)) diff++
  ok(diff === 0, '★★ كلّ بكسلٍ في التدفّق مطابقٌ للأصل', `اختلافات: ${diff}`)

  // ── صورةٌ للعين: هذا ما ستطبعه الطابعة ──
  const back = encodeGrayPng(W, H, (x, y) => bitAt(rebuilt, x, y))
  writeFileSync(join(OUT, 'decoded-from-escpos.png'), back)
  console.log(`     ↳ ${join(OUT, 'decoded-from-escpos.png')}`)
  console.log(`     التدفّق: ${parsed.join(' → ').slice(0, 160)}`)
  console.log(`     الحجم: ${job.length} بايت`)
}

// ═══ ٦) حرّاس ═══
console.log('\n── ٦) الحرّاس ──')
{
  let threw = null
  try { rasterCmd({ width: 576, height: 10, bits: Buffer.alloc(5) }) }
  catch (e) { threw = e.message }
  ok(threw && /حجم/.test(threw), 'بتّاتٌ بحجمٍ خاطئ ⇒ خطأ صريح', threw || 'لم يرمِ')

  const big = feedDots(600)
  ok(big.length === 9, 'تغذيةٌ > ٢٥٥ تُقسَّم أوامر', `${big.length} بايت`)
  ok(big[2] === 255 && big[5] === 255 && big[8] === 90, 'والمجموع صحيح (255+255+90)',
    `${big[2]}+${big[5]}+${big[8]}`)
}


// ═══ ٧) دعم المنصّتين ═══
console.log('\n── ٧) ماك وويندوز ──')
{
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  ok(/process\.platform === 'win32'/.test(src), 'يميّز ويندوز')
  ok(/winspool\.Drv/.test(src), '★ ويندوز: السبولر مباشرةً (winspool)')
  ok(/pDataType="RAW"/.test(src), '★ ويندوز: وضع RAW — لا يمرّ بـGDI')
  ok(/copy', '\/b'|'copy', '\/b'/.test(src) || /'copy', '\/b'/.test(src),
    'ويندوز: احتياط copy /b')
  ok(/'lp', \['-d', printer, '-o', 'raw'/.test(src), 'ماك/لينكس: lp -o raw')
  ok(/Win32_Printer/.test(src), 'ويندوز: حالة الطابعة من WMI')
  ok(/lpstat/.test(src), 'ماك: حالة الطابعة من lpstat')
  // السجلّ في مكانٍ صحيح لكلّ نظام
  ok(/AppData', 'Local'/.test(src), 'ويندوز: السجلّ في AppData')
  ok(/'Library', 'Logs'/.test(src), 'ماك: السجلّ في Library/Logs')
  // ★ البايتات نفسها لا تختلف بين النظامين — وهو ما يجعل الفحص هنا كافياً
  ok(!/platform[\s\S]{0,400}rasterCmd|rasterCmd[\s\S]{0,200}platform/.test(src),
    '★ ترميز ESC/POS واحدٌ للنظامين (لا تفرّع)')
}

// ═══ ٨) ترميز سكربتات PowerShell ═══
// عطبٌ حقيقيّ على ويندوز: PowerShell 5.1 (الافتراضيّ) يقرأ الملفّ بترميز
// ANSI ما لم يبدأ بـBOM، فيُفسد الحروف العربية ويكسر اقتران علامات
// الاقتباس — ويسقط التثبيت بأخطاء نحوٍ غامضة («Unexpected token '}'»).
// وفي المقابل: config.json يجب أن يبقى **بلا** BOM وإلا رفضه JSON.parse.
console.log('\n── ٨) ترميز ملفّات ويندوز ──')
{
  const root = new URL('..', import.meta.url)
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF])

  const ps1Files = readdirSync(root, { recursive: true })
    .filter((f) => String(f).endsWith('.ps1'))
  ok(ps1Files.length > 0, 'وُجد سكربت ويندوز واحدٌ على الأقلّ',
    ps1Files.join(', '))
  for (const f of ps1Files) {
    const buf = readFileSync(new URL(String(f).split(sep).join('/'), root))
    ok(buf.subarray(0, 3).equals(BOM), `★ ${f} يبدأ بـBOM (يلزم PowerShell 5.1)`,
      [...buf.subarray(0, 3)].map((b) => b.toString(16)).join(' '))
    // وأن يبقى UTF-8 صالحاً بعد الـBOM
    let okUtf8 = true
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(3)) }
    catch { okUtf8 = false }
    ok(okUtf8, `${f} محتواه UTF-8 صالح`)
  }

  // config.json بلا BOM — Node يرفض JSON يبدأ به
  const cfg = readFileSync(new URL('config.json', root))
  ok(!cfg.subarray(0, 3).equals(BOM), '★ config.json بلا BOM (وإلا رفضه JSON.parse)')
  let parses = true
  try { JSON.parse(cfg.toString('utf8')) } catch { parses = false }
  ok(parses, 'config.json يُقرأ فعلاً')

  // ★ والسكربت الذي يكتبه الخادم وقت التشغيل: يُكتب بـBOM ومحتواه لاتينيّ
  const src = readFileSync(new URL('src/server.js', root), 'utf8')
  const gen = /const WIN_RAW_PS1 = `([\s\S]*?)`\n/.exec(src)
  ok(!!gen, 'وُجد سكربت الطباعة المولَّد')
  if (gen) {
    ok(!/[\u0600-\u06FF]/.test(gen[1]),
      '★ السكربت المولَّد بلا عربية (لا يعتمد على الترميز أصلاً)')
    ok(/writeFileSync\(ps1, '\\ufeff'/.test(src),
      '★ ويُكتب بـBOM أيضاً — حارسٌ ثانٍ')
  }
}

// ═══ مفكّك التدفّق: ما تقرؤه الطابعة، أمراً أمراً، والصور شرائحَ مجمّعة ═══
function parseStream(job) {
  const ops = [], images = []
  let cur = null, i = 0
  while (i < job.length) {
    if (job[i] === 0x1b && job[i + 1] === 0x40) { ops.push('init'); i += 2; continue }
    if (job[i] === 0x1b && job[i + 1] === 0x4a) { ops.push(`feed:${job[i + 2]}`); cur = null; i += 3; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x56) { ops.push(`cut:${job[i + 2]}`); cur = null; i += 4; continue }
    if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
      const bpl = job[i + 4] + job[i + 5] * 256
      const rows = job[i + 6] + job[i + 7] * 256
      const data = job.subarray(i + 8, i + 8 + bpl * rows)
      if (!cur) { cur = { width: bpl * 8, height: 0, chunks: [] }; images.push(cur); ops.push('raster') }
      cur.chunks.push(Buffer.from(data)); cur.height += rows
      i += 8 + bpl * rows
      continue
    }
    ops.push(`?0x${job[i].toString(16)}`); i++
  }
  return { ops, images: images.map((m) => ({ width: m.width, height: m.height, bits: Buffer.concat(m.chunks) })) }
}
const sameBits = (img, want) => {
  let diff = 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) if (bitAt(img, x, y) !== want(x, y)) diff++
  return diff
}

// ═══ ٩) نسختان في مهمّةٍ واحدة: اطبع، اقطع، اطبع، اقطع ═══
console.log('\n── ٩) نسختان في مهمّةٍ واحدة ──')
{
  const W = 576
  const A = (x, y) => y < 3 || (x > 100 && x < 200 && y > 20 && y < 80)     // «نسخة ١»
  const B = (x, y) => y < 3 || (x > 380 && x < 480 && y > 20 && y < 80)     // «نسخة ٢»
  const mk = (H, f) => { const d = decodePng(encodeGrayPng(W, H, f)); return rgbaToBits(d.width, d.height, d.rgba) }
  const job = buildJob([mk(100, A), mk(120, B)], { feedMm: 5 })
  const { ops, images } = parseStream(job)
  const seq = ops.map((o) => o.split(':')[0]).join(',')
  ok(seq === 'init,raster,feed,cut,raster,feed,cut', '★ الترتيب: تهيئة، صورة، تغذية، قطع، صورة، تغذية، قطع', seq)
  ok(ops.filter((o) => o.startsWith('cut:')).length === 2, '★ قطعان بالضبط')
  ok(ops.filter((o) => o === 'init').length === 1, 'تهيئةٌ واحدة — مهمّةٌ واحدة لا مهمّتان')
  ok(images.length === 2 && images[0].height === 100 && images[1].height === 120, 'صورتان بارتفاعيهما', images.map((m) => m.height).join(','))
  ok(sameBits(images[0], A) === 0 && sameBits(images[1], B) === 0, '★★ كلّ نسخةٍ تعود بكسلاً بكسلاً كما رُسمت')
  ok(!ops.some((o) => o.startsWith('?')), 'لا بايتاتٍ مجهولة')
  const single = parseStream(buildJob(mk(50, A)))
  ok(single.ops.filter((o) => o.startsWith('cut')).length === 1, 'صورةٌ واحدة (غير مصفوفة) ⇒ قطعٌ واحد كما كان')
  let threw = null
  try { buildJob([]) } catch (e) { threw = e.message }
  ok(!!threw, 'مصفوفةٌ فارغة ⇒ خطأ صريح', threw || 'لم يرمِ')
}

// ═══ ١٠) الخادم نفسه بتشغيلٍ جافّ: images[] ⇒ مهمّةٌ واحدة بقطعين ═══
// لا شيء يُرسل للطابعة: SHEFAA_PRINT_DRY_RUN يكتب المهمّة ملفّاً، واسم
// الطابعة غير موجود أصلاً — حارسان.
console.log('\n── ١٠) الخادم: نسخٌ في طلبٍ واحد ──')
{
  const dir = mkdtempSync(join(tmpdir(), 'shefaa-dry-'))
  const cfgFile = join(dir, 'cfg.json')
  const PORT = 17000 + Math.floor(Math.random() * 900)
  writeFileSync(cfgFile, JSON.stringify({ port: PORT, printer: 'DRY-RUN-NO-SUCH-PRINTER', token: 'tk',
    origins: ['http://test.local'], log: join(dir, 'log.txt') }))
  const out = join(dir, 'jobs')
  const srv = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))],
    { env: { ...process.env, SHEFAA_PRINT_CONFIG: cfgFile, SHEFAA_PRINT_DRY_RUN: out }, stdio: ['ignore', 'pipe', 'pipe'] })
  let boot = ''
  srv.stdout.on('data', (d) => { boot += d })
  for (let t = 0; t < 40 && !/يعمل على/.test(boot); t++) await new Promise((r) => setTimeout(r, 100))
  ok(/تشغيلٌ جافّ/.test(boot), 'الخادم يعلن التشغيل الجافّ في سجلّه', boot.slice(0, 160))
  const B = `http://127.0.0.1:${PORT}`
  const H = { 'Content-Type': 'application/json', Origin: 'http://test.local', 'X-Print-Token': 'tk' }
  const url = (f) => 'data:image/png;base64,' + encodeGrayPng(576, 90, f).toString('base64')
  const A = (x, y) => y < 2 || (x < 60 && y > 30)
  const Bp = (x, y) => y < 2 || (x > 500 && y > 30)
  try {
    const h = await (await fetch(`${B}/health`, { headers: { Origin: 'http://test.local' } })).json()
    ok(h.version === 2 && h.max_copies === 5, '★ /health: الإصدار ٢ ويقبل حتى ٥ نسخ', JSON.stringify(h))
    const r = await fetch(`${B}/print`, { method: 'POST', headers: H, body: JSON.stringify({ images: [url(A), url(Bp)] }) })
    const body = await r.json()
    ok(r.status === 200 && body.copies === 2, '★ images[2] ⇒ 200 ونسختان', JSON.stringify(body))
    const files = readdirSync(out)
    ok(files.length === 1, '★ مهمّةٌ واحدة لا مهمّتان', files.join(','))
    const { ops, images } = parseStream(readFileSync(join(out, files[0])))
    ok(ops.filter((o) => o.startsWith('cut')).length === 2, '★ والمهمّة فيها قطعان', ops.join(' → '))
    ok(images.length === 2 && sameBits(images[0], A) === 0 && sameBits(images[1], Bp) === 0,
      '★★ النسختان في المهمّة مطابقتان لما أُرسل، بالترتيب')
    rmSync(out, { recursive: true, force: true })
    const legacy = await fetch(`${B}/print`, { method: 'POST', headers: H, body: JSON.stringify({ image: url(A) }) })
    const lf = readdirSync(out)
    ok(legacy.status === 200 && lf.length === 1
      && parseStream(readFileSync(join(out, lf[0]))).ops.filter((o) => o.startsWith('cut')).length === 1,
      '★ الطلب القديم (image واحدة) ما زال يعمل ⇒ قطعٌ واحد')
    const six = await fetch(`${B}/print`, { method: 'POST', headers: H,
      body: JSON.stringify({ images: Array(6).fill(url(A)) }) })
    ok(six.status === 400, 'ستّ نسخ ⇒ 400 (الحدّ ٥)', String(six.status))
    const noTok = await fetch(`${B}/print`, { method: 'POST', headers: { ...H, 'X-Print-Token': 'x' },
      body: JSON.stringify({ images: [url(A)] }) })
    ok(noTok.status === 401, 'الرمز ما زال مطلوباً ⇒ 401')
  } finally {
    srv.kill()
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${fails.length} فشلاً ═══`)
if (fails.length) { fails.forEach((f) => console.log(`  ✘ ${f}`)); process.exit(1) }
console.log('✔ التدفّق مطابقٌ للمواصفة، وما سنرسله يعود صورةً كما رُسم')
