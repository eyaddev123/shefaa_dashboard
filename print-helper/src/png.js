// ═══════════ قارئ PNG صغير (بلا اعتماديات) ═══════════
// نحتاج فكّ PNG لأنّ المتصفّح يرسل البطاقة صورةً، والطابعة تريد بتّاتٍ خاماً.
// وsharp/canvas اعتماديتان ثقيلتان (ثنائيّات أصلية) على جهاز استقبالٍ لا
// نريد صيانة بنائها عليه — وzlib في Node يكفي: PNG ليس إلا zlib + ترشيح.
//
// ندعم ما يُخرجه المتصفّح فعلاً من canvas.toDataURL('image/png'):
// عمق ٨ بت، ألوان RGBA (6) أو RGB (2) أو رماديّ (0) أو رماديّ+ألفا (4)،
// بلا تشذير (interlace) — وهو ما لا يُخرجه أيّ متصفّح.
import zlib from 'node:zlib'

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** يفكّ PNG إلى { width, height, rgba } — rgba مصفوفة بايتات ٤ قنوات */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47)
    throw new Error('ليس ملفّ PNG')

  let pos = 8
  let w = 0, h = 0, depth = 0, colorType = 0, interlace = 0
  const idat = []
  let palette = null, trns = null

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      depth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len          // الطول + النوع + البيانات + CRC
  }

  if (!w || !h) throw new Error('PNG بلا أبعاد')
  if (interlace) throw new Error('PNG مُشذَّر غير مدعوم (لا يُخرجه متصفّح)')
  if (depth !== 8 && !(colorType === 3 && depth <= 8))
    throw new Error(`عمق لونٍ غير مدعوم: ${depth} بت`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = colorType === 3 ? 1 : CHANNELS[colorType]
  if (!ch) throw new Error(`نوع لونٍ غير مدعوم: ${colorType}`)

  const bpp = colorType === 3 ? Math.max(1, depth / 8) : ch   // بايتات لكل بكسل
  const stride = colorType === 3
    ? Math.ceil((w * depth) / 8)
    : w * ch

  // ═══ عكس الترشيح (PNG filters 0..4) ═══
  // كل سطر يبدأ ببايت نوع الترشيح، وفكّه يعتمد على السطر السابق.
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  let rp = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++]
    const line = raw.subarray(rp, rp + stride); rp += stride
    const cur = Buffer.alloc(stride)
    const pb = Math.max(1, Math.round(bpp))
    for (let i = 0; i < stride; i++) {
      const x = line[i]
      const a = i >= pb ? cur[i - pb] : 0      // يسار
      const b = prev[i]                         // فوق
      const c = i >= pb ? prev[i - pb] : 0     // فوق-يسار
      let v
      switch (ft) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb2 = Math.abs(p - b), pc = Math.abs(p - c)
          v = x + (pa <= pb2 && pa <= pc ? a : pb2 <= pc ? b : c)
          break
        }
        default: throw new Error(`مرشّح PNG مجهول: ${ft}`)
      }
      cur[i] = v & 0xff
    }
    cur.copy(out, y * stride)
    prev = cur
  }

  // ═══ إلى RGBA موحّد ═══
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (colorType === 3) {
        const idx = out[y * stride + x]
        const p = idx * 3
        rgba[o] = palette[p]; rgba[o + 1] = palette[p + 1]; rgba[o + 2] = palette[p + 2]
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else {
        const i = y * stride + x * ch
        if (colorType === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = out[i]; rgba[o + 3] = 255 }
        else if (colorType === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = out[i]; rgba[o + 3] = out[i + 1] }
        else if (colorType === 2) { rgba[o] = out[i]; rgba[o + 1] = out[i + 1]; rgba[o + 2] = out[i + 2]; rgba[o + 3] = 255 }
        else { rgba[o] = out[i]; rgba[o + 1] = out[i + 1]; rgba[o + 2] = out[i + 2]; rgba[o + 3] = out[i + 3] }
      }
    }
  }
  return { width: w, height: h, rgba }
}

/** يكتب PNG رماديّاً من بتّات أحادية — للفحص: نفكّ ESC/POS ونراه صورةً */
export function encodeGrayPng(width, height, isBlack) {
  const stride = width + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0                                   // بلا ترشيح
    for (let x = 0; x < width; x++)
      raw[y * stride + 1 + x] = isBlack(x, y) ? 0 : 255
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let TABLE = null
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}
