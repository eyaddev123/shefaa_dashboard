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

import { ticketHtml, ORG_NAME, ORG_NAME_PARTS, copyLabel } from './ticket-print.js'

const SETTINGS_KEY = 'shefaa.printer'
export const DEFAULT_HELPER = { port: 17625, token: '' }

// ★ ٥٧٦ نقطة = ٧٢مم على ٢٠٣ نقطة/بوصة — مساحة الطباعة على ورق ٨٠مم.
// (و٣٨٤ نقطة = ٤٨مم لورق ٥٨مم.)
export const DOTS = { 80: 576, 58: 384 }

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

/* ═══ تخطيطان: عريضٌ (٨٠مم، كما كان بالضبط) وضيّقٌ (شريط ٥٨مم) ═══
   الأحجام بالنقاط. العريض مضبوطٌ على ٥٧٦ نقطة ويُحجَّم بنسبة العرض؛ والضيّق
   مضبوطٌ على شريط ٣٨٤ نقطة مباشرةً: خطوطٌ أصغر بحدود المقروء على ٢٠٣dpi
   (لا شيء تحت ١٦ نقطة ≈ ٢مم)، ورقم الدور يبقى أكبر عنصرٍ بفارق. */
const WIDE = {
  pad: PAD, gap: 1, wrap: false,
  size: { org: 30, label: 22, queue: 86, name: 32, age: 23, room: 29, doctor: 24,
          type: 24, row: 24, total: 29, stamp: 19, copy: 18 },
}
const NARROW = {
  pad: 0.04, gap: 0.75, wrap: true,
  size: { org: 23, label: 18, queue: 90, name: 25, age: 18, room: 23, doctor: 19,
          type: 19, row: 18, total: 22, stamp: 17, copy: 16 },
}

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
 *
 * printable: عرض الورق المركَّب فعلاً (من الوسيط). 58 على لوحة ٨٠ ⇒ اللوحة تبقى
 * ٥٧٦ نقطة، والمحتوى كلّه في الشريط الأيسر (٣٨٤ نقطة) متوسّطاً عليه هو لا على
 * الرأس، والباقي أبيض — لأنّ ورق ٥٨مم يقف على يسار الرأس.
 */
export async function renderTicketPng(data, width = 80, doc = document, { copy = null, printable = null } = {}) {
  const W = DOTS[width] || DOTS[80]
  const S = printable === 58 ? Math.min(W, DOTS[58]) : W      // عرض الشريط المطبوع
  const L = S <= DOTS[58] ? NARROW : WIDE
  const k = L === WIDE ? W / 576 : 1      // تحجيم الخطوط
  const gk = L === WIDE ? k : L.gap       // تحجيم الفراغات
  const win = doc.defaultView || window
  if (win.document && win.document.fonts && win.document.fonts.ready) {
    // ★ ننتظر الخطّ: الرسم قبل جهوزه يخرج بخطٍّ بديلٍ صامتاً
    await Promise.race([win.document.fonts.ready, new Promise((r) => setTimeout(r, 2500))])
  }

  const draw = (ctx, measureOnly) => {
    const cx = S / 2
    const left = Math.round(S * L.pad)
    const right = S - left
    const avail = right - left
    const g = (n) => Math.round(n * gk)
    let y = g(18)

    const font = (key, weight) => {
      const px = Math.round(L.size[key] * k)
      ctx.font = `${weight} ${px}px Cairo, Tahoma, sans-serif`
      return px
    }
    // يقسم نصّاً على كلماتٍ إلى أسطرٍ تسع العرض (التخطيط الضيّق وحده)
    const wrap = (text) => {
      if (!L.wrap || ctx.measureText(text).width <= avail) return [text]
      const out = []
      let cur = ''
      for (const w of text.split(/\s+/)) {
        const next = cur ? `${cur} ${w}` : w
        if (cur && ctx.measureText(next).width > avail) { out.push(cur); cur = w } else cur = next
      }
      if (cur) out.push(cur)
      return out
    }
    const line = (text, { size, weight = 400, gap = 10, align = 'center' }) => {
      if (!text) return
      const px = font(size, weight)
      for (const part of wrap(String(text))) {
        y += px
        if (!measureOnly) {
          ctx.textAlign = align
          ctx.fillStyle = '#000'
          ctx.fillText(part, align === 'center' ? cx : align === 'right' ? right : left, y)
        }
        y += g(gap)
      }
    }
    const rule = (dashed = true) => {
      y += g(8)
      if (!measureOnly) {
        ctx.strokeStyle = '#000'
        ctx.lineWidth = Math.max(1, g(2))
        ctx.setLineDash(dashed ? [g(6), g(5)] : [])
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke()
        ctx.setLineDash([])
      }
      y += g(10)
    }
    // سطرٌ بطرفين (اسمٌ يمين ورقمٌ يسار) — للمبالغ. وإن ضاق الشريط عن الاثنين
    // نزل المبلغ سطراً تحت الاسم بدل أن يتراكبا
    const row = (key, val, { size = 'row', weight = 400 } = {}) => {
      const px = font(size, weight)
      const kt = String(key), vt = String(val)
      const together = !L.wrap
        || ctx.measureText(kt).width + ctx.measureText(vt).width + px <= avail
      if (together) {
        y += px
        if (!measureOnly) {
          ctx.fillStyle = '#000'
          ctx.textAlign = 'right'; ctx.fillText(kt, right, y)
          ctx.textAlign = 'left'; ctx.fillText(vt, left, y)
        }
      } else {
        for (const part of wrap(kt)) {
          y += px
          if (!measureOnly) { ctx.fillStyle = '#000'; ctx.textAlign = 'right'; ctx.fillText(part, right, y) }
          y += g(3)
        }
        y += px
        if (!measureOnly) { ctx.textAlign = 'left'; ctx.fillText(vt, left, y) }
      }
      y += g(9)
    }

    // ═══ الاسم: سطرٌ واحد إن وسع، وإلّا سطران متوازنان ═══
    // نقيس بالخطّ نفسه والحجم نفسه — لا نصغّر الخطّ ولا نقصّ: «مجمع عيادات» ثمّ
    // «الشفاء الطبي» (نصفان متقاربان) إن ضاق العرض (ورق ٥٨مم).
    {
      font('org', 700)
      const fits = ctx.measureText(ORG_NAME).width <= avail
      if (fits) line(ORG_NAME, { size: 'org', weight: 700, gap: 4 })
      else ORG_NAME_PARTS.forEach((part, i) => line(part, { size: 'org', weight: 700, gap: i === 0 ? 2 : 4 }))
    }
    rule()
    line('رقم الدور', { size: 'label', gap: 2 })
    line(data.queue_number, { size: 'queue', weight: 700, gap: 12 })
    line(data.full_name, { size: 'name', weight: 700, gap: 6 })
    const age = ageFromYear(data.birth_year)
    if (age != null) line(`العمر: ${age} سنة`, { size: 'age', gap: 6 })
    rule()
    if (data.room) line(`العيادة ${data.room}`, { size: 'room', weight: 700, gap: 4 })
    if (data.doctor_name) line(data.doctor_name, { size: 'doctor', gap: 4 })
    line(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة', { size: 'type', gap: 8 })

    const procs = (data.procedures || []).filter((p) => !p.removed_at)
    const fee = Number(data.fee || 0)
    if (procs.length) {
      rule()
      row(data.visit_type === 'followup' ? 'مراجعة' : 'معاينة', money(fee))
      procs.forEach((p) => row(p.name, money(p.price)))
      rule(false)
      row('المجموع للدفع',
        money(fee + procs.reduce((s, p) => s + Number(p.price || 0), 0)),
        { size: 'total', weight: 700 })
    } else {
      rule(false)
      row('المبلغ للدفع', money(fee), { size: 'total', weight: 700 })
    }

    y += g(10)
    line(stamp(data.now ? new Date(data.now) : new Date()), { size: 'stamp', gap: 4 })
    // ★ اسم النسخة صغيراً في الأسفل — «نسخة المريض» / «نسخة العيادة»
    if (copy) line(copy, { size: 'copy', gap: 4 })
    return y + g(16)      // فراغٌ بسيط قبل القطع
  }

  // ① قياس
  const probe = doc.createElement('canvas')
  probe.width = W; probe.height = 10
  const H = Math.ceil(draw(probe.getContext('2d'), true))

  // ② رسمٌ فعليّ — اللوحة بعرض الرأس كاملاً، وما خارج الشريط يبقى أبيض
  const c = doc.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)     // الورق أبيض لا شفّاف
  ctx.textBaseline = 'alphabetic'
  ctx.direction = 'rtl'
  draw(ctx, false)

  return { png: c.toDataURL('image/png'), width: W, height: H, printable: S === W ? width : 58 }
}

// وسيطٌ قديم (الإصدار ١) لا يعرف images[] فيرفضها بهذه الرسالة نفسها
const OLD_HELPER_ERROR = /^image يجب أن تكون/

/**
 * الطباعة عبر الوسيط. لا ترمي أبداً — { ok, reason, copies, mode }.
 * الحضور نجح على الخادم قبل أن نصل هنا، فالفشل رسالةٌ لا تراجع.
 *
 * copies: عدد النسخ. كلّ نسخةٍ تُرسم باسمها في الأسفل، وتُرسل كلّها في
 * **مهمّةٍ واحدة** (اطبع، اقطع، اطبع، اقطع). وإن كان الوسيط على الجهاز قديماً
 * (قبل النسخ) تُرسل نسخةً نسخة — الورق نفسه، فلا تنقطع الطباعة قبل تحديثه.
 */
export async function printViaHelper(data, width = 80, cfg = loadHelper(), doc = document, { copies = 1 } = {}) {
  try {
    const n = Math.max(1, Math.min(5, Math.round(Number(copies) || 1)))
    // ★ عرض الورق المركَّب يعرفه الوسيط (config.json ⇒ printable_width): على 58
    // تبقى اللوحة ٥٧٦ نقطة والمحتوى في الشريط الأيسر. وسيطٌ أقدم لا يذكره ⇒ ٨٠ كما كان
    const h = await helperHealth(cfg)
    const printable = h && h.printable_width === 58 ? 58 : null
    const rendered = []
    for (let i = 0; i < n; i++)
      rendered.push(await renderTicketPng(data, width, doc, { copy: copyLabel(i), printable }))
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.token) headers['X-Print-Token'] = cfg.token
    const post = async (payload) => {
      const r = await fetch(`${helperUrl(cfg.port)}/print`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      })
      return { r, body: await r.json().catch(() => ({})) }
    }

    const first = await post({ images: rendered.map((x) => x.png) })
    if (first.r.ok)
      return { ok: true, height: rendered[0].height, job: first.body.job, copies: n, mode: 'one-job',
               printable: rendered[0].printable }
    if (!(first.r.status === 400 && OLD_HELPER_ERROR.test(first.body.error || '')))
      return { ok: false, reason: first.body.error || `الوسيط ردّ ${first.r.status}` }

    // ── وسيطٌ قديم: نسخةً نسخة ──
    for (let i = 0; i < n; i++) {
      const one = await post({ image: rendered[i].png })
      if (!one.r.ok) return { ok: false, reason: one.body.error || `الوسيط ردّ ${one.r.status}`, printed: i }
    }
    return { ok: true, height: rendered[0].height, copies: n, mode: 'per-copy' }
  } catch (e) {
    const net = e && (e.name === 'TypeError' || /fetch/i.test(e.message || ''))
    return { ok: false, reason: net ? 'الطابعة غير متصلة' : (e.message || 'فشل غير متوقّع') }
  }
}
