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
const DOCS = [1, 2, 4, 7, 9]
const BAR = 90   // شريط متصفّح التلفاز

const mkBoard = (n) => ({
  urgent_delays: 0, seq: 1,
  board: Array.from({ length: n }, (_, i) => ({
    doctor_name: `د. ضياء الدين المنقل ${i + 1}`,
    specialty: 'باطنية',
    room: String(i + 1),
    current: { queue_number: 100 + i },
    next: { queue_number: 111 + i },
    after_next: { queue_number: 122 + i },
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
        }, mkBoard(n))

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

          return {
            cards: cards.length, rowCounts, clipped,
            fillPct: Math.round(used / (gr.width * gr.height) * 100),
            number: fs('.pd-number'), room: fs('.pd-room'), doctor: fs('.pd-doctor'),
            upNum: fs('.pd-up-num'), specialty: fs('.pd-specialty'),
            scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          }
        })

        const tag = `${w}×${h0}${bar ? '+شريط' : ''} ${n}د`
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
        ok(m.upNum >= MIN.upNum, `${tag}: التالي/بعده ${m.upNum}px < ${MIN.upNum}`)
        ok(m.specialty >= MIN.specialty, `${tag}: الاختصاص ${m.specialty}px < ${MIN.specialty}`)

        // ═══ الترتيب البصري: الرقم ← الغرفة ← الاسم ← الاختصاص ═══
        ok(m.number > m.room, `${tag}: الرقم (${m.number}) ليس أكبر من الغرفة (${m.room})`)
        ok(m.room >= m.doctor, `${tag}: الغرفة (${m.room}) أصغر من اسم الدكتور (${m.doctor})`)
        ok(m.doctor >= m.specialty, `${tag}: الاسم (${m.doctor}) أصغر من الاختصاص (${m.specialty})`)

        // ═══ لا شيء مقصوص — والغرفة خاصّةً (ثانية الأهمية) ═══
        ok(m.clipped.length === 0, `${tag}: عناصر مقصوصة: ${m.clipped.join(', ')}`)

        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)

        line.push(`${n}د:${JSON.stringify(m.rowCounts).replace(/[[\]]/g, '')}/${m.fillPct}%/${m.number}px`)
        await ctx.close()
      }
      console.log(`  ${String(w).padStart(4)}×${String(h0).padEnd(4)}${bar ? ' +شريط' : '  ملء  '} │ ${line.join('  ')}`)
    }
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
