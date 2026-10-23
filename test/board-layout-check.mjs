// ═══════════════════════════════════════════════════════════════════
// فحص لوحة الصالة في متصفّح حقيقي — تملأ الشاشة وتُقرأ من بعيد
//
// يُشغَّل بـ: npm run test:board
//
// لماذا متصفّح حقيقي: العطب الذي كشفه هذا الفحص كان أنّ كل مقاسات الخطّ كانت
// داخل @supports (container-type: size) — وChrome 66 (تلفاز الصالة) لا يملكها،
// فيسقط إلى قواعد vw بسقوفٍ ثابتة: «يُخدَم الآن» ١٠px و«الغرفة» ١٤px على شاشة
// 1920. نقاطٌ لا تُقرأ. ولا يكشف ذلك إلا تشغيلٌ فعليّ بمحاكاة غياب الخاصية.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.BOARD_TEST_PORT || 5232)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); return false }

// الحدّ الأدنى المقروء من ٤–٥ أمتار (يطابق MIN في PublicDisplay.jsx)
const MIN = { number: 56, room: 28, doctor: 20, upNum: 24, specialty: 13 }

const SIZES = [[1920, 1080], [1366, 768], [960, 540]]
const DOCS = [1, 4, 7]
// أعداد المنتظرين: فارغ · واحد · متوسّط · طويلٌ يتجاوز البطاقة («+N»)
const WAITING = [0, 1, 5, 20]
const BAR = 90   // شريط متصفّح التلفاز

// أسماء مرضى في البيانات عمداً: إن ظهر أحدها على الشاشة فهو تسريب
const PATIENT_NAMES = ['سمير خالد الحسن', 'ليلى أحمد النجار']

const mkBoard = (n, waiting = 2) => ({
  urgent_delays: 0, seq: 1,
  board: Array.from({ length: n }, (_, i) => ({
    doctor_name: `د. ضياء الدين المنقل ${i + 1}`,
    specialty: 'باطنية',
    room: String(i + 1),
    current: { queue_number: 100 + i },
    next: null, after_next: null,
    queue: [
      ...Array.from({ length: waiting }, (_, k) => ({
        queue_number: 10 + k, arrived: true,
        full_name: PATIENT_NAMES[k % 2], priority: k === 0 ? 'urgent' : 'normal' })),
      // محجوزان لم يحضرا — يجب ألّا يظهرا
      { queue_number: 901, arrived: false, full_name: PATIENT_NAMES[0] },
      { queue_number: 902, arrived: false, full_name: PATIENT_NAMES[1] },
    ],
  })),
})

const run = async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' })
  const stop = () => { try { vite.kill('SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)

  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('✖ لم يُقلع خادم Vite'); stop(); process.exit(1) }

  const browser = await chromium.launch()
  console.log('\n═══ فحص لوحة الصالة (متصفّح حقيقي، محاكاة Chrome 66) ═══\n')

  for (const [w, h0] of SIZES) {
    for (const bar of [false, true]) {
      const h = bar ? h0 - BAR : h0
      const line = []
      for (const n of DOCS) {
       for (const waiting of WAITING) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        // ═══ محاكاة التلفاز: بلا container queries ولا aspect-ratio ═══
        await ctx.addInitScript((snap) => {
          const orig = CSS.supports.bind(CSS)
          CSS.supports = (...a) => /container-type|aspect-ratio/.test(a.join(' ')) ? false : orig(...a)
          class FakeES {
            constructor() { this.l = {}
              setTimeout(() => { if (this.onopen) this.onopen({})
                ;(this.l.snapshot || []).forEach((f) => f({ data: JSON.stringify(snap) })) }, 30) }
            addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f) }
            removeEventListener() {} close() {}
          }
          window.EventSource = FakeES
        }, mkBoard(n, waiting))

        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
        await page.waitForTimeout(600)

        const m = await page.evaluate(() => {
          const fs = (s) => { const e = document.querySelector(s)
            return e ? parseFloat(getComputedStyle(e).fontSize) : 0 }
          const cards = [...document.querySelectorAll('.pd-card')]
          const grid = document.querySelector('.pd-grid')
          const gr = grid.getBoundingClientRect()

          // صفوف الشبكة: نجمّع البطاقات بإحداثي top
          const tops = {}
          cards.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top)
            tops[t] = (tops[t] || 0) + 1 })
          const rowCounts = Object.keys(tops).sort((a, b) => Number(a) - Number(b)).map((k) => tops[k])

          // قصٌّ فعلي: أيّ عنصرٍ يتجاوز صندوق أبيه أو أسفل الشاشة
          const clipped = []
          cards.forEach((c, i) => {
            const wrap = c.querySelector('.pd-current-wrap')
            const wr = wrap.getBoundingClientRect()
            const room = c.querySelector('.pd-room')
            if (room) { const rr = room.getBoundingClientRect()
              if (rr.height < 4 || rr.bottom > wr.bottom + 1) clipped.push(`card${i}:room`) }
            const nr = c.querySelector('.pd-number').getBoundingClientRect()
            if (nr.bottom > wr.bottom + 1) clipped.push(`card${i}:number`)
            if (c.getBoundingClientRect().bottom > document.documentElement.clientHeight + 1)
              clipped.push(`card${i}:below-fold`)
          })

          const used = cards.reduce((s, c) => { const r = c.getBoundingClientRect()
            return s + r.width * r.height }, 0)

          // صفّ المنتظرين في أول بطاقة: كم رقماً ظهر، وهل خرج شيءٌ عن البطاقة
          const first = cards[0]
          const nums = first ? [...first.querySelectorAll('.pd-wait-num')] : []
          const moreEl = first ? first.querySelector('.pd-wait-more') : null
          const waitRow = first ? first.querySelector('.pd-waiting') : null
          if (waitRow && first) {
            const cr = first.getBoundingClientRect()
            const wr = waitRow.getBoundingClientRect()
            if (wr.bottom > cr.bottom + 1) clipped.push('card0:waiting-row')
            nums.forEach((el, k) => {
              const r = el.getBoundingClientRect()
              if (r.bottom > wr.bottom + 1 || r.right > cr.right + 1 || r.left < cr.left - 1)
                clipped.push(`card0:wait${k}`)
            })
          }

          return {
            cards: cards.length, rowCounts, clipped,
            fillPct: Math.round(used / (gr.width * gr.height) * 100),
            number: fs('.pd-number'), room: fs('.pd-room'), doctor: fs('.pd-doctor'),
            upNum: fs('.pd-wait-num'), specialty: fs('.pd-specialty'),
            shownNums: nums.map((e) => e.textContent.trim()),
            moreText: moreEl ? moreEl.textContent.trim() : '',
            hasWaitRow: !!waitRow,
            text: document.body.innerText,
            scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          }
        })

        const tag = `${w}×${h0}${bar ? '+شريط' : ''} ${n}د/${waiting}منتظر`
        ok(m.cards === n, `${tag}: ظهرت ${m.cards} بطاقة من ${n}`)

        // ═══ لا بطاقة يتيمة ═══
        const orphan = m.rowCounts.length > 1 && m.rowCounts[m.rowCounts.length - 1] === 1 && n > 2
        ok(!orphan, `${tag}: صفٌّ أخير ببطاقة يتيمة — ${JSON.stringify(m.rowCounts)}`)

        // ═══ تملأ الشاشة: لا نصفٌ فارغ ═══
        ok(m.fillPct >= 80, `${tag}: البطاقات تملأ ${m.fillPct}% فقط من الشبكة (<80)`)

        // ═══ لا تمرير على شاشة الصالة ═══
        ok(m.scrollY === 0, `${tag}: الصفحة تُمرَّر ${m.scrollY}px`)

        // ═══ لا نصّ ينكمش إلى نقطة ═══
        ok(m.number >= MIN.number, `${tag}: الرقم ${m.number}px < ${MIN.number}`)
        ok(m.room >= MIN.room, `${tag}: الغرفة ${m.room}px < ${MIN.room}`)
        ok(m.doctor >= MIN.doctor, `${tag}: اسم الدكتور ${m.doctor}px < ${MIN.doctor}`)
        if (waiting > 0) ok(m.upNum >= MIN.upNum, `${tag}: رقم الانتظار ${m.upNum}px < ${MIN.upNum}`)
        ok(m.specialty >= MIN.specialty, `${tag}: الاختصاص ${m.specialty}px < ${MIN.specialty}`)

        // ═══ الترتيب البصري: الرقم ← الغرفة ← الاسم ← الاختصاص ═══
        ok(m.number > m.room, `${tag}: الرقم (${m.number}) ليس أكبر من الغرفة (${m.room})`)
        ok(m.room >= m.doctor, `${tag}: الغرفة (${m.room}) أصغر من اسم الدكتور (${m.doctor})`)
        ok(m.doctor >= m.specialty, `${tag}: الاسم (${m.doctor}) أصغر من الاختصاص (${m.specialty})`)

        // ═══ لا شيء مقصوص — والغرفة خاصّةً (ثانية الأهمية) ═══
        ok(m.clipped.length === 0, `${tag}: عناصر مقصوصة: ${m.clipped.join(', ')}`)

        // ═══ صفّ المنتظرين ═══
        if (waiting === 0) {
          ok(m.shownNums.length === 0, `${tag}: ظهرت أرقامٌ ولا منتظر — ${JSON.stringify(m.shownNums)}`)
          ok(/لا أحد بانتظار/.test(m.text), `${tag}: قائمةٌ فارغة بلا رسالة`)
        } else {
          // المعروض + المخفيّ = عدد المنتظرين بالضبط — لا رقمَ يضيع بصمت
          const hidden = m.moreText ? Number(m.moreText.replace(/\D/g, '')) : 0
          ok(m.shownNums.length + hidden === waiting,
            `${tag}: ${m.shownNums.length} معروضاً + ${hidden} مخفيّاً ≠ ${waiting}`)
          ok(m.shownNums.length >= 1, `${tag}: لم يظهر ولا رقم`)
        }
        // ★ الخصوصية: أرقامٌ فقط
        ok(!PATIENT_NAMES.some((nm) => m.text.includes(nm)),
          `${tag}: ★ تسرّب اسم مريض إلى الشاشة العامة`)
        ok(!/إسعاف|عاجل|طارئ/.test(m.text), `${tag}: ★ ذُكرت الأولوية على الشاشة العامة`)
        // ★ غير الحاضرين لا يظهرون
        ok(!m.text.includes('901') && !m.text.includes('902'),
          `${tag}: ★ ظهر من حجز ولم يحضر (901/902)`)
        // ★ «العيادة» لا «الغرفة» على الشاشة.
        // عند الضيق الشديد تُختصر إلى رقمها وحده (roomCompact) فلا تظهر الكلمة
        // أصلاً — المهمّ ألّا تظهر «الغرفة» إطلاقاً.
        ok(!/الغرفة/.test(m.text), `${tag}: ★ ظهرت «الغرفة» — التسمية يجب أن تكون «العيادة»`)

        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)

        line.push(`${n}د/${waiting}:${m.shownNums.length}${m.moreText ? '+' : ''}`)
        await ctx.close()
       }
      }
      console.log(`  ${String(w).padStart(4)}×${String(h0).padEnd(4)}${bar ? ' +شريط' : '  ملء  '} │ ${line.join('  ')}`)
    }
  }

  // ═══ بطاقة النداء: التسمية «العيادة» ═══
  // فحصُ البطاقات وحدها لا يكفي: بطاقة النداء تظهر عند حدث call فقط، وقد بقيت
  // تقول «الغرفة» بعد تغيير التسمية — لا يراها إلا من ينادي.
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    await ctx.addInitScript((snap) => {
      const orig = CSS.supports.bind(CSS)
      CSS.supports = (...a) => /container-type|aspect-ratio/.test(a.join(' ')) ? false : orig(...a)
      class FakeES {
        constructor() { this.l = {}; window.__sse = this
          setTimeout(() => { if (this.onopen) this.onopen({})
            ;(this.l.snapshot || []).forEach((f) => f({ data: JSON.stringify(snap) })) }, 30) }
        addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f) }
        removeEventListener() {} close() {}
        emit(t, d) { (this.l[t] || []).forEach((f) => f({ data: JSON.stringify(d) })) }
      }
      window.EventSource = FakeES
    }, mkBoard(2, 3))
    const page = await ctx.newPage()
    await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__sse.emit('call', {
      queue_number: 7, room: '1', doctor_name: 'د. ضياء الدين المنقل 1',
      specialty: 'باطنية', seq: 99, repeat: false }))
    await page.waitForTimeout(900)
    const ban = await page.evaluate(() => {
      const el = document.querySelector('.pd-banner')
      return { shown: !!el, text: el ? el.innerText : '' }
    })
    ok(ban.shown, 'بطاقة النداء: لم تظهر عند حدث call')
    ok(/العيادة/.test(ban.text), `بطاقة النداء: ★ التسمية يجب أن تكون «العيادة» — ${ban.text}`)
    ok(!/الغرفة/.test(ban.text), `بطاقة النداء: ★ ظهرت «الغرفة» — ${ban.text}`)
    console.log(`  بطاقة النداء │ ${ban.text.replace(/\n/g, ' · ')}`)
    await ctx.close()
  }


  // ═══ الترويسة: «مجمع عيادات الشفاء الطبي» سطرٌ واحد، لا يُقصّ ولا يلامس الساعة ═══
  // بكلّ المقاسات المفحوصة، ملء الشاشة ومع شريط المتصفّح، بمحاكاة Chrome 66.
  {
    const HEAD_SIZES = [[1920, 1080], [1366, 768], [960, 540]]
    const line = []
    for (const [w, h0] of HEAD_SIZES) {
      for (const bar of [false, true]) {
        const h = bar ? h0 - BAR : h0
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        await ctx.addInitScript((snap) => {
          const orig = CSS.supports.bind(CSS)
          CSS.supports = (...a) => /container-type|aspect-ratio/.test(a.join(' ')) ? false : orig(...a)
          class FakeES {
            constructor() { this.l = {}
              setTimeout(() => { if (this.onopen) this.onopen({})
                ;(this.l.snapshot || []).forEach((f) => f({ data: JSON.stringify(snap) })) }, 30) }
            addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f) }
            removeEventListener() {} close() {}
          }
          window.EventSource = FakeES
        }, mkBoard(4, 5))
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
        await page.waitForTimeout(600)
        const hd = await page.evaluate(() => {
          const t = document.querySelector('.pd-title')
          const c = document.querySelector('.pd-clock')
          const head = document.querySelector('.pd-head')
          const tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect(), hr = head.getBoundingClientRect()
          const fsz = parseFloat(getComputedStyle(t).fontSize)
          return {
            text: t.textContent.trim(), fsz,
            oneLine: tr.height <= fsz * 1.9,
            notClipped: t.scrollWidth <= t.clientWidth + 1,
            inView: tr.left >= 0 && tr.right <= window.innerWidth,
            inHead: tr.top >= hr.top - 1 && tr.bottom <= hr.bottom + 1,
            // RTL: الهوية يميناً والساعة بعدها يساراً — المسافة بينهما
            gap: Math.round(tr.left - cr.right),
            scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          }
        })
        const tag = `ترويسة ${w}×${h0}${bar ? '+شريط' : ''}`
        ok(/مجمع عيادات الشفاء الطبي/.test(hd.text) && !/جمعية/.test(hd.text), `${tag}: الاسم «${hd.text}»`)
        ok(hd.oneLine, `${tag}: الاسم انكسر سطرين`)
        ok(hd.notClipped, `${tag}: الاسم مقصوص`)
        ok(hd.inView && hd.inHead, `${tag}: الاسم خارج الشاشة أو الترويسة`)
        ok(hd.gap >= 8, `${tag}: الاسم يلامس الساعة (المسافة ${hd.gap}px)`)
        ok(hd.scrollX <= 0, `${tag}: تمرير أفقي ${hd.scrollX}px`)
        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)
        line.push(`${w}×${h}:${hd.fsz}px/${hd.gap}px`)
        await ctx.close()
      }
    }
    console.log(`  الترويسة │ ${line.join('  ')}`)
  }

  await browser.close()
  stop()

  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) {
    failures.forEach((f) => console.error(`  ✖ ${f}`))
    process.exit(1)
  }
  console.log('✔ اللوحة تملأ الشاشة، بلا بطاقة يتيمة، وكل نصٍّ مقروء\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
