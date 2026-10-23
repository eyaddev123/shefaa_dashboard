// ═══════════ ترميز ESC/POS: صورةٌ نقطيّة ثمّ تغذيةٌ فقطع ═══════════
//
// لماذا صورة لا نصّ؟ العربية. النصّ عبر ESC/POS يحتاج صفحة ترميزٍ عربية في
// الطابعة نفسها، وتختلف بين الموديلات، وتكسر وصل الحروف وترتيبها. أمّا
// الصورة فبتّاتٌ لا تعرف لغة: ما رسمه المتصفّح هو ما يُطبع حرفياً.
//
// ═══ GS v 0 (الموثّق) ═══
//   1D 76 30 m xL xH yL yH d1…dk
//   m  = 0 (عاديّ)، 1 عرضٌ مضاعف، 2 طولٌ مضاعف، 3 كلاهما
//   xL,xH = عدد **البايتات** في السطر الأفقي (لا البكسلات!) — ٥٧٦ بكسل ⇒ ٧٢
//   yL,yH = الارتفاع بالنقاط (البكسلات)
//   k  = (xL + xH×256) × (yL + yH×256)
//   البتّ ١ = نقطةٌ سوداء تُطبع، و٠ = بيضاء. وداخل البايت MSB أوّلاً
//   (البتّ الأعلى = البكسل الأيسر).
//
// الطابعة ٥٧٦ نقطة = ٧٢مم على ٢٠٣ نقطة/بوصة — وهي مساحة الطباعة على ورق ٨٠مم.

export const ESC = 0x1b
export const GS = 0x1d

/** تهيئة الطابعة: تُصفّر الأنماط العالقة من مهمّةٍ سابقة */
export const initCmd = () => Buffer.from([ESC, 0x40])            // ESC @

/** تغذية n نقطة (ESC J n) — أقصاها ٢٥٥ نقطة في الأمر الواحد */
export const feedDots = (dots) => {
  const out = []
  let left = Math.max(0, Math.round(dots))
  while (left > 0) {
    const n = Math.min(255, left)
    out.push(ESC, 0x4a, n)
    left -= n
  }
  return Buffer.from(out)
}

/** القطع: GS V 66 n = قطعٌ جزئيّ بعد تغذية n نقطة (الأوسع دعماً) */
export const cutCmd = (feedBefore = 0) =>
  Buffer.from([GS, 0x56, 66, Math.max(0, Math.min(255, Math.round(feedBefore)))])

/**
 * صورة أحادية ⇒ GS v 0
 * @param {{width:number,height:number,bits:Buffer}} img — bits معبّأة MSB أوّلاً
 * @param {number} maxChunk — نقسّم الصورة شرائح: بعض الطابعات تختنق بصورةٍ
 *   ضخمةٍ في أمرٍ واحد فتطبع نصفها أو تتجمّد. والشرائح المتتالية تُطبع
 *   متلاصقةً تماماً بلا فجوة.
 */
export function rasterCmd(img, maxChunk = 128) {
  const bytesPerLine = Math.ceil(img.width / 8)
  if (bytesPerLine < 1) throw new Error('عرضٌ غير صالح')
  const expected = bytesPerLine * img.height
  if (img.bits.length !== expected)
    throw new Error(`حجم البتّات ${img.bits.length} ≠ المتوقّع ${expected}`)

  const parts = []
  for (let y = 0; y < img.height; y += maxChunk) {
    const rows = Math.min(maxChunk, img.height - y)
    const head = Buffer.from([
      GS, 0x76, 0x30, 0,
      bytesPerLine & 0xff, (bytesPerLine >> 8) & 0xff,   // xL xH — بالبايتات
      rows & 0xff, (rows >> 8) & 0xff,                    // yL yH — بالنقاط
    ])
    parts.push(head, img.bits.subarray(y * bytesPerLine, (y + rows) * bytesPerLine))
  }
  return Buffer.concat(parts)
}

/**
 * RGBA ⇒ بتّات أحادية بعتبة.
 * العتبة لا تدرّج: الطابعة الحرارية تطبع نقطةً أو لا تطبع، والرمادي المتدرّج
 * يخرج بقعاً باهتة. والمتصفّح يرسم أسود على أبيض أصلاً، فالعتبة تحسم الحواف.
 * الشفّاف يُعدّ أبيض (الورق).
 */
export function rgbaToBits(width, height, rgba, threshold = 160) {
  const bytesPerLine = Math.ceil(width / 8)
  const bits = Buffer.alloc(bytesPerLine * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const a = rgba[o + 3]
      // لمعانٌ مرجَّح (Rec. 601) — الأقرب لإدراك العين
      const lum = a === 0 ? 255
        : (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) * (a / 255)
          + 255 * (1 - a / 255)
      if (lum < threshold)
        bits[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7)   // MSB = الأيسر
    }
  }
  return { width, height, bits }
}

/** يعيد بناء الصورة من بتّات — للفحص (نفكّ ما رمّزناه ونقارنه) */
export const bitAt = (img, x, y) => {
  const bpl = Math.ceil(img.width / 8)
  return (img.bits[y * bpl + (x >> 3)] & (0x80 >> (x & 7))) !== 0
}

/**
 * مهمّة طباعةٍ كاملة: تهيئة، ثمّ لكلّ نسخة: صورة + تغذية + قطع.
 * نسختان ⇒ «اطبع، اقطع، اطبع، اقطع» في مهمّةٍ واحدة — فلا تتداخل مع مهمّةٍ
 * أخرى بينهما، ولكلّ نسخةٍ قطعها فتُمسك كلٌّ منهما منفصلة.
 * @param {object|object[]} imgs صورةٌ واحدة أو مصفوفة صور (نسخ)
 */
export function buildJob(imgs, { feedMm = 5, dpi = 203 } = {}) {
  const list = Array.isArray(imgs) ? imgs : [imgs]
  if (list.length === 0) throw new Error('لا صورة للطباعة')
  const dots = Math.round((feedMm / 25.4) * dpi)
  const parts = [initCmd()]
  for (const img of list) parts.push(rasterCmd(img), feedDots(dots), cutCmd(0))
  return Buffer.concat(parts)
}
