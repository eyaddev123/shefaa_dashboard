// يولّد بطاقةً تجريبيةً صورةً (بلا متصفّح) — للفحص من الطرفية
import { encodeGrayPng } from '../src/png.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
const out = process.argv[2] || '.out/sample-ticket.png'
mkdirSync(dirname(out), { recursive: true })
const W = 576, H = 260
// نمطٌ واضح للعين: إطار، خطوط، ومربّعٌ كبير — يُثبت المحاذاة والعرض
const png = encodeGrayPng(W, H, (x, y) =>
  y < 4 || y >= H - 4 || x < 4 || x >= W - 4
  || (y > 70 && y < 74) || (y > 180 && y < 184)
  || (x > 230 && x < 346 && y > 95 && y < 160))
writeFileSync(out, png)
console.log(`بطاقة تجريبية ${W}×${H}: ${out}`)
