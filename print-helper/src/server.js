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
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
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
  log: process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local', 'shefaa-print', 'shefaa-print.log')
    : join(homedir(), 'Library', 'Logs', 'shefaa-print.log'),
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

const IS_WIN = process.platform === 'win32'

const run = (cmd, args, input) => new Promise((resolve) => {
  const ps = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let out = '', err = ''
  ps.stdout.on('data', (d) => { out += d })
  ps.stderr.on('data', (d) => { err += d })
  ps.on('error', (e) => resolve({ code: -1, out: '', err: e.message }))
  ps.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }))
  if (input !== undefined) { ps.stdin.on('error', () => {}); ps.stdin.end(input) }
  else ps.stdin.end()
})

// ═══ ويندوز: الكتابة على السبولر بوضع RAW ═══
// لماذا لا `net use LPT1` + `copy /b`؟ موثّقةٌ لكنّها **غير موثوقة مع طابعات
// USB** (تحتاج مشاركةً ومنفذاً متوازياً وهميّاً)، وطابعتنا USB. والسبولر
// بوضع RAW يمرّر البايتات كما هي بلا تفسيرٍ من السائق — وهو المطلوب تماماً:
// ESC/POS لا يمرّ بـGDI.
const WIN_RAW_PS1 = `
param([string]$PrinterName,[string]$DataFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;using System.IO;using System.Runtime.InteropServices;
public class ShefaaRaw {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string src,out IntPtr h,IntPtr pd);
  [DllImport("winspool.Drv",EntryPoint="ClosePrinter")] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h,int lvl,ref DOCINFO di);
  [DllImport("winspool.Drv",EntryPoint="EndDocPrinter")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartPagePrinter")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="EndPagePrinter")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="WritePrinter",SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h,IntPtr buf,int n,out int written);
  public static void Send(string printer,byte[] bytes){
    IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) throw new Exception("تعذّر فتح الطابعة: "+printer);
    try{
      DOCINFO di=new DOCINFO(); di.pDocName="shefaa-ticket"; di.pDataType="RAW";
      if(!StartDocPrinter(h,1,ref di)) throw new Exception("StartDocPrinter فشل");
      try{
        if(!StartPagePrinter(h)) throw new Exception("StartPagePrinter فشل");
        IntPtr p=Marshal.AllocHGlobal(bytes.Length);
        try{ Marshal.Copy(bytes,0,p,bytes.Length); int w;
          if(!WritePrinter(h,p,bytes.Length,out w)) throw new Exception("WritePrinter فشل");
          if(w!=bytes.Length) throw new Exception("كُتب "+w+" من "+bytes.Length);
        } finally { Marshal.FreeHGlobal(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[ShefaaRaw]::Send($PrinterName,[IO.File]::ReadAllBytes($DataFile))
Write-Output "sent"
`

async function sendRawWindows(bytes, printer) {
  // ملفٌّ مؤقّت: تمرير بايتاتٍ ثنائية عبر stdin إلى PowerShell يُفسدها الترميز
  const tmp = join(tmpdir(), `shefaa-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
  try {
    writeFileSync(tmp, bytes)
    const ps1 = join(tmpdir(), `shefaa-raw-${process.pid}.ps1`)
    if (!existsSync(ps1)) writeFileSync(ps1, WIN_RAW_PS1, 'utf8')
    const r = await run('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
       '-File', ps1, '-PrinterName', printer, '-DataFile', tmp])
    if (r.code === 0 && /sent/.test(r.out)) return { ok: true, job: 'spooler-raw' }
    // ── احتياط: النسخ الخام إلى مشاركة الطابعة ──
    const cp = await run('cmd.exe', ['/c', 'copy', '/b', tmp, `\\\\localhost\\${printer}`])
    if (cp.code === 0) return { ok: true, job: 'copy/b' }
    return { ok: false, error: (r.err || r.out || cp.err || 'فشل الإرسال').slice(0, 400) }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    try { unlinkSync(tmp) } catch { /* ذهب */ }
  }
}

/** يرسل بايتاتٍ خاماً — CUPS على ماك/لينكس، والسبولر على ويندوز */
async function sendRaw(bytes, printer) {
  if (IS_WIN) return sendRawWindows(bytes, printer)
  const r = await run('lp', ['-d', printer, '-o', 'raw', '-t', 'shefaa-ticket'], bytes)
  if (r.code === 0) return { ok: true, job: r.out }
  return { ok: false, error: r.err || r.out || `lp انتهى بالرمز ${r.code}` }
}

/** حالة الطابعة — أهي متّصلة فعلاً؟ */
async function printerState(printer) {
  if (IS_WIN) {
    // WorkOffline و PrinterStatus من WMI: أدقّ من مجرّد «الطابعة معرّفة»
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Printer -Filter "Name='${String(printer).replace(/'/g, "''")}'";`
      + ` if ($p) { "{0}|{1}|{2}" -f $p.WorkOffline, $p.PrinterStatus, $p.PrinterState } else { "" }`])
    const text = (r.out || '').trim()
    if (!text) return { known: false }
    const [offline] = text.split('|')
    return {
      known: true,
      offline: /true/i.test(offline),
      disabled: false,
      text: `الطابعة ${printer} — ${/true/i.test(offline) ? 'غير متصلة' : 'جاهزة'}`,
    }
  }
  const r = await run('lpstat', ['-p', printer])
  const text = (r.out || '').trim()
  if (!text) return { known: false }
  return {
    known: true,
    idle: /is idle/.test(text),
    disabled: /disabled/.test(text),
    offline: /offline/i.test(text),
    text: text.split('\n')[0],
  }
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
