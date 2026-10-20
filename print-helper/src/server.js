#!/usr/bin/env node
// ═══════════ خادم الطباعة المحلّي — جهاز الاستقبال وحده ═══════════
//
// لماذا وسيطٌ محلّيّ أصلاً؟ لأنّ طباعة كروم تمرّ بسائق الطابعة، والسائق
// يفرض مقاسات ورقٍ ثابتة (٧٢×٢١٠مم عندنا) فيخرج ورقٌ أبيضُ طويل بعد كلّ
// بطاقة، ويفتح نافذةً تحتاج ضغطة. أمّا ESC/POS الخام فيطبع بطول المحتوى
// بالضبط ويقطع بنفسه، بلا نافذة.
//
// الأمان: يستمع على 127.0.0.1 وحده (لا يُرى من الشبكة)، ولا يقبل إلا
// أصولاً معروفة، ويطلب رمزاً مشتركاً — فصفحةٌ عابرة في المتصفّح لا تطبع.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { decodePng } from './png.js'
import { rgbaToBits, buildJob } from './escpos.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CFG_PATHS = [
  process.env.SHEFAA_PRINT_CONFIG,
  join(homedir(), '.shefaa-print.json'),
  join(HERE, '..', 'config.json'),
].filter(Boolean)

const DEFAULTS = {
  port: 17625,
  printer: 'Printer_POS_80',
  token: '',
  feed_mm: 5,
  threshold: 160,
  width_dots: 576,
  origins: ['http://localhost:5173', 'http://localhost:5199', 'http://127.0.0.1:5173',
            'https://dashboard-shefaa.abukm.com'],
  log: join(homedir(), 'Library', 'Logs', 'shefaa-print.log'),
}

function loadConfig() {
  for (const p of CFG_PATHS) {
    if (p && existsSync(p)) {
      try { return { ...DEFAULTS, ...JSON.parse(readFileSync(p, 'utf8')), _from: p } }
      catch (e) { console.error(`تعذّرت قراءة ${p}: ${e.message}`) }
    }
  }
  return { ...DEFAULTS, _from: '(الافتراضات)' }
}

const CFG = loadConfig()

function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`
  process.stdout.write(line)
  try {
    mkdirSync(dirname(CFG.log), { recursive: true })
    appendFileSync(CFG.log, line)
  } catch { /* السجلّ ترفٌ لا يُسقط الطباعة */ }
}

const allowed = (origin) => !origin || CFG.origins.includes(origin)

function cors(req, res) {
  const o = req.headers.origin
  if (allowed(o)) {
    if (o) res.setHeader('Access-Control-Allow-Origin', o)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Token')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '600')
    return true
  }
  return false
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** يرسل بايتاتٍ خاماً إلى CUPS: lp -d <printer> -o raw */
function sendRaw(bytes, printer) {
  return new Promise((resolve) => {
    const lp = spawn('lp', ['-d', printer, '-o', 'raw', '-t', 'shefaa-ticket'],
      { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    lp.stdout.on('data', (d) => { out += d })
    lp.stderr.on('data', (d) => { err += d })
    lp.on('error', (e) => resolve({ ok: false, error: e.message }))
    lp.on('close', (code) => resolve(
      code === 0 ? { ok: true, job: out.trim() }
                 : { ok: false, error: (err || out).trim() || `lp انتهى بالرمز ${code}` }))
    lp.stdin.on('error', () => { /* يُلتقط في close */ })
    lp.stdin.end(bytes)
  })
}

/** حالة الطابعة من CUPS — أهي متّصلة فعلاً؟ */
function printerState(printer) {
  return new Promise((resolve) => {
    const ps = spawn('lpstat', ['-p', printer])
    let out = ''
    ps.stdout.on('data', (d) => { out += d })
    ps.on('error', () => resolve({ known: false }))
    ps.on('close', () => {
      const text = out.trim()
      if (!text) return resolve({ known: false })
      resolve({
        known: true,
        idle: /is idle/.test(text),
        disabled: /disabled/.test(text),
        offline: /offline/i.test(text),
        text: text.split('\n')[0],
      })
    })
  })
}

const readBody = (req, limit = 12 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (c) => {
    size += c.length
    if (size > limit) { reject(new Error('الطلب أكبر من الحدّ')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (!cors(req, res)) { json(res, 403, { error: 'origin غير مسموح' }); return }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── /health: هل الوسيط حيّ، وهل الطابعة متّصلة؟ ──
  if (url.pathname === '/health' && req.method === 'GET') {
    const st = await printerState(CFG.printer)
    json(res, 200, {
      ok: true, service: 'shefaa-print', version: 1,
      printer: CFG.printer,
      printer_ready: !!(st.known && !st.disabled && !st.offline),
      printer_state: st.text || 'غير معروفة',
      needs_token: !!CFG.token,
    })
    return
  }

  // ── /print: صورة PNG ⇒ ESC/POS ⇒ الطابعة ──
  if (url.pathname === '/print' && req.method === 'POST') {
    if (CFG.token && req.headers['x-print-token'] !== CFG.token) {
      log('WARN', 'رمزٌ خاطئ — رُفض الطلب')
      json(res, 401, { error: 'رمز الطباعة غير صحيح' }); return
    }
    try {
      const body = await readBody(req)
      let png = body
      // نقبل JSON فيه data URL، أو بايتات PNG مباشرةً
      const ctype = String(req.headers['content-type'] || '')
      if (ctype.includes('application/json')) {
        const obj = JSON.parse(body.toString('utf8'))
        const m = /^data:image\/png;base64,(.+)$/s.exec(obj.image || '')
        if (!m) throw new Error('image يجب أن تكون data:image/png;base64,…')
        png = Buffer.from(m[1], 'base64')
      }

      const img = decodePng(png)
      if (img.width > CFG.width_dots)
        throw new Error(`عرض الصورة ${img.width} أكبر من ${CFG.width_dots} نقطة`)

      const mono = rgbaToBits(img.width, img.height, img.rgba, CFG.threshold)
      const job = buildJob(mono, { feedMm: CFG.feed_mm })
      const sent = await sendRaw(job, CFG.printer)

      if (!sent.ok) {
        log('ERROR', `فشل الإرسال: ${sent.error}`)
        json(res, 502, { error: sent.error, printer: CFG.printer }); return
      }
      log('INFO', `طُبعت بطاقة ${img.width}×${img.height} (${job.length} بايت) — ${sent.job}`)
      json(res, 200, { ok: true, job: sent.job, width: img.width, height: img.height,
                       bytes: job.length })
    } catch (e) {
      log('ERROR', `خطأ: ${e.message}`)
      json(res, 400, { error: e.message })
    }
    return
  }

  json(res, 404, { error: 'لا مسار' })
})

server.listen(CFG.port, '127.0.0.1', () => {
  log('INFO', `خادم الطباعة يعمل على 127.0.0.1:${CFG.port} — الطابعة ${CFG.printer}`
    + ` — الإعداد من ${CFG._from}${CFG.token ? ' — برمز' : ' — ★ بلا رمز'}`)
})
server.on('error', (e) => { log('ERROR', `تعذّر الإقلاع: ${e.message}`); process.exit(1) })
