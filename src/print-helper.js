// ═══════════ الطباعة عبر الوسيط المحلّي ═══════════
//
// لماذا وسيطٌ بدل طباعة المتصفّح؟ كروم يطبع عبر سائق الطابعة، والسائق يفرض
// مقاسات ورقٍ ثابتة (٧٢×٢١٠مم عندنا) فيخرج ورقٌ أبيضُ طويل بعد كلّ بطاقة،
// ويفتح نافذةً تحتاج ضغطة. والوسيط يرسل ESC/POS خاماً: طولٌ بالمحتوى
// بالضبط، وقطعٌ تلقائيّ، وبلا نافذة.
//
// ولماذا نرسل **صورة** لا نصّاً؟ العربية. نصّ ESC/POS يحتاج صفحة ترميزٍ
// عربية في الطابعة، تختلف بين الموديلات وتكسر وصل الحروف. والصورة بتّاتٌ
// لا تعرف لغة — ما رسمه المتصفّح هو ما يُطبع حرفياً.

import { ticketHtml } from './ticket-print.js'

const SETTINGS_KEY = 'shefaa.printer'
export const DEFAULT_HELPER = { port: 17625, token: '' }

// ★ ٥٧٦ نقطة = ٧٢مم على ٢٠٣ نقطة/بوصة — مساحة الطباعة على ورق ٨٠مم.
// (و٣٨٤ نقطة = ٤٨مم لورق ٥٨مم.)
export const DOTS = { 80: 576, 58: 384 }
export const DPI = 203

export const helperUrl = (port) => `http://127.0.0.1:${port || DEFAULT_HELPER.port}`

export function loadHelper() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      port: Number.isInteger(raw.port) && raw.port > 0 ? raw.port : DEFAULT_HELPER.port,
      token: typeof raw.token === 'string' ? raw.token : '',
    }
  } catch { return { ...DEFAULT_HELPER } }
}

/** هل الوسيط حيّ؟ { ok, printer_ready, … } — لا يرمي أبداً */
export async function helperHealth(cfg = loadHelper(), timeoutMs = 1500) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = setTimeout(() => ctl && ctl.abort(), timeoutMs)
  try {
    const r = await fetch(`${helperUrl(cfg.port)}/health`, { signal: ctl && ctl.signal })
    clearTimeout(t)
    if (!r.ok) return { ok: false, reason: `الوسيط ردّ ${r.status}` }
    return await r.json()
  } catch (e) {
    clearTimeout(t)
    return { ok: false, reason: e && e.name === 'AbortError' ? 'لا يستجيب' : 'غير متصل' }
  }
}

/* ═══ رسم البطاقة مباشرةً على canvas ═══
   لماذا لا SVG foreignObject؟ مقيس: حتى SVG بسيطٌ بلا خطوط **يُلوّث** اللوحة
   في كروم فيرفض toDataURL. والرسم المباشر نظيف، ويعطي تحكّماً بالبكسل —
   وهو ما نريده: ١ بكسل = ١ نقطة طابعة، بلا إعادة تحجيمٍ تُشوّش الحواف. */

const PAD = 0.05            // هامش جانبيّ من العرض (لا تطبع الحراريّة حتى الحافّة)

const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ل.س`
const two = (n) => String(n).padStart(2, '0')
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
  + ` · ${two(d.getHours())}:${two(d.getMinutes())}`

export function ageFromYear(birthYear, now = new Date()) {
  const y = Number(birthYear)
  if (!Number.isInteger(y) || y < 1900) return null
  const a = now.getFullYear() - y
  return a >= 0 && a < 130 ? a : null
}

/**
 * يرسم البطاقة بعرض نقاط الطابعة بالضبط ويعيد PNG.
 * يمرّ مرّتين: الأولى تقيس الارتفاع، والثانية ترسم على لوحةٍ بذلك الارتفاع —
 * فلا ورق أبيض زائد ولا قصّ للمحتوى.
 */
export async function renderTicketPng(data, width = 80, doc = document) {
  const W = DOTS[width] || DOTS[80]
  const scale = W / 576                  // أحجامٌ مضبوطة على ٥٧٦ نقطة
  const win = doc.defaultView || window
  if (win.document && win.document.fonts && win.document.fonts.ready) {
    // ★ ننتظر الخطّ: الرسم قبل جهوزه يخرج بخطٍّ بديلٍ صامتاً
    await Promise.race([win.document.fonts.ready, new Promise((r) => setTimeout(r, 2500))])
  }

  const draw = (ctx, measureOnly) => {
    const cx = W / 2
    const left = Math.round(W * PAD)
    const right = W - left
    let y = Math.round(18 * scale)

    const line = (text, { size = 26, weight = 400, gap = 10, align = 'center' } = {}) => {
      if (!text) return
      const px = Math.round(size * scale)
      y += px
      if (!measureOnly) {
        ctx.font = `${weight} ${px}px Cairo, Tahoma, sans-serif`
        ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
        ctx.fillStyle = '#000'
        ctx.fillText(String(text), align === 'center' ? cx : align === 'right' ? right : left, y)
      }
      y += Math.round(gap * scale)
    }
    const rule = (dashed = true) => {
      y += Math.round(8 * scale)
      if (!measureOnly) {
        ctx.strokeStyle = '#000'
        ctx.lineWidth = Math.max(1, Math.round(2 * scale))
        ctx.setLineDash(dashed ? [Math.round(6 * scale), Math.round(5 * scale)] : [])
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke()
        ctx.setLineDash([])
      }
      y += Math.round(10 * scale)
    }
    // سطرٌ بطرفين (اسمٌ يمين ورقمٌ يسار) — للمبالغ
    const row = (k, v, { size = 24, weight = 400 } = {}) => {
      const px = Math.round(size * scale)
      y += px
      if (!measureOnly) {
        ctx.font = `${weight} ${px}px Cairo, Tahoma, sans-serif`
        ctx.fillStyle = '#000'
        ctx.textAlign = 'right'; ctx.fillText(String(k), right, y)
        ctx.textAlign = 'left'; ctx.fillText(String(v), left, y)
      }
      y += Math.round(9 * scale)
    }

    line('جمعية الشفاء الخيرية', { size: 30, weight: 700, gap: 4 })
    rule()
    line('رقم الدور', { size: 22, gap: 2 })
    line(data.queue_number, { size: 86, weight: 700, gap: 12 })
    line(data.full_name, { size: 32, weight: 700, gap: 6 })
    const age = ageFromYear(data.birth_year)
    if (age != null) line(`العمر: ${age} سنة`, { size: 23, gap: 6 })
    rule()
    if (data.room) line(`العيادة ${data.room}`, { size: 29, weight: 700, gap: 4 })
    if (data.doctor_name) line(data.doctor_name, { size: 24, gap: 4 })
    line(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة', { size: 24, gap: 8 })

    const procs = (data.procedures || []).filter((p) => !p.removed_at)
    const fee = Number(data.fee || 0)
    if (procs.length) {
      rule()
      row(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة', money(fee))
      procs.forEach((p) => row(p.name, money(p.price)))
      rule(false)
      row('المجموع للدفع',
        money(fee + procs.reduce((s, p) => s + Number(p.price || 0), 0)),
        { size: 29, weight: 700 })
    } else {
      rule(false)
      row('المبلغ للدفع', money(fee), { size: 29, weight: 700 })
    }

    y += Math.round(10 * scale)
    line(stamp(data.now ? new Date(data.now) : new Date()), { size: 19, gap: 4 })
    return y + Math.round(16 * scale)      // فراغٌ بسيط قبل القطع
  }

  // ① قياس
  const probe = doc.createElement('canvas')
  probe.width = W; probe.height = 10
  const H = Math.ceil(draw(probe.getContext('2d'), true))

  // ② رسمٌ فعليّ
  const c = doc.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)     // الورق أبيض لا شفّاف
  ctx.textBaseline = 'alphabetic'
  ctx.direction = 'rtl'
  draw(ctx, false)

  return { png: c.toDataURL('image/png'), width: W, height: H }
}

/**
 * الطباعة عبر الوسيط. لا ترمي أبداً — { ok, reason }.
 * الحضور نجح على الخادم قبل أن نصل هنا، فالفشل رسالةٌ لا تراجع.
 */
export async function printViaHelper(data, width = 80, cfg = loadHelper(), doc = document) {
  try {
    const { png, height } = await renderTicketPng(data, width, doc)
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.token) headers['X-Print-Token'] = cfg.token
    const r = await fetch(`${helperUrl(cfg.port)}/print`, {
      method: 'POST', headers, body: JSON.stringify({ image: png }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, reason: body.error || `الوسيط ردّ ${r.status}` }
    return { ok: true, height, job: body.job }
  } catch (e) {
    const net = e && (e.name === 'TypeError' || /fetch/i.test(e.message || ''))
    return { ok: false, reason: net ? 'الطابعة غير متصلة' : (e.message || 'فشل غير متوقّع') }
  }
}
