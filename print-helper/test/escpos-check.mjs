// ═══ فحص ESC/POS: نفكّ ما رمّزناه ونقارنه بالأصل ═══
//   npm test
//
// لا نطبع على الطابعة إطلاقاً. البرهان أقوى من الطباعة أصلاً: نأخذ صورةً
// معروفة، نرمّزها، ثمّ **نفكّ البايتات التي سنرسلها** ونتحقّق أنّ كلّ بكسلٍ
// عاد كما كان — ونقرأ رأس الأمر بايتاً بايتاً ونقارنه بالمواصفة.
import { decodePng, encodeGrayPng } from '../src/png.js'
import { rgbaToBits, buildJob, rasterCmd, feedDots, cutCmd, initCmd, bitAt } from '../src/escpos.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${fails.length} فشلاً ═══`)
if (fails.length) { fails.forEach((f) => console.log(`  ✘ ${f}`)); process.exit(1) }
console.log('✔ التدفّق مطابقٌ للمواصفة، وما سنرسله يعود صورةً كما رُسم')
