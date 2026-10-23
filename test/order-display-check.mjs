// ═══════════════════════════════════════════════════════════════════
// فحص شاشة «الدور» (/order) في متصفّح حقيقي بمحاكاة Chrome 66
//   npm run test:order
//
// يفحص لكل تركيبة: تملأ الشاشة · لا بطاقة يتيمة · لا تمرير · كل نصٍّ مقروء ·
// **الأرقام وحدها** (لا أسماء ولا تمييز إسعافي) · الحاضرون فقط · و«+N» عند الطول.
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.ORDER_TEST_PORT || 5233)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (c, label) => { if (c) { pass++; return true } failures.push(label); return false }

// يطابق MIN في OrderDisplay.jsx. والرقم الحالي أصغر من نظيره في شاشة النداء
// عمداً: هذه شاشة «أين موقعي» لا «من يُنادى»، فالقائمة تأخذ النصيب الأكبر.
const MIN = { doctor: 20, room: 22, current: 40, item: 24 }
const SIZES = [[1920, 1080], [1366, 768]]
const DOCS = [1, 4, 7]
const LISTS = [0, 5, 20]
const BAR = 90

// أسماء الدكاترة تُعرض عمداً. وأسماء **المرضى** يجب ألّا تظهر أبداً — ولذلك
// نضعها في البيانات (حيث لا تقرأها الشاشة) ونتحقّق أنّها لم تصل الصفحة.
const DOCTOR_NAMES = ['حسام حافظ', 'ديمة متولي', 'رود الخباز']
const PATIENT_NAMES = ['سمير خالد الحسن', 'ليلى أحمد النجار']

const mkBoard = (docs, listLen) => ({
  urgent_delays: 0, seq: 1,
  board: Array.from({ length: docs }, (_, i) => {
    // الحاضرون listLen، ومعهم اثنان **لم يحضرا** (waiting) يجب ألّا يظهرا
    const queue = [
      // اسم المريض حاضرٌ في البيانات عمداً: إن ظهر على الشاشة فهو تسريب
      ...Array.from({ length: listLen }, (_, k) => ({
        queue_number: 10 + k, arrived: true,
        full_name: PATIENT_NAMES[k % PATIENT_NAMES.length], priority: k === 0 ? 'urgent' : 'normal' })),
      { queue_number: 901, arrived: false, full_name: PATIENT_NAMES[0] },
      { queue_number: 902, arrived: false, full_name: PATIENT_NAMES[1] },
    ]
    return {
      doctor_name: `د. ${DOCTOR_NAMES[i % DOCTOR_NAMES.length]}`,
      specialty: 'باطنية', room: String(i + 1),
      current: listLen > 0 ? { queue_number: 5 + i } : null,
      next: null, after_next: null,
      queue, queue_length: queue.length,
    }
  }),
})

const run = async () => {
  // ═══ نبني ثمّ نعاين، لا خادم تطوير ═══
  // خادم التطوير كان يسقط في منتصف جولةٍ طويلة (٣٦ سياقاً متتابعاً)، والمعاينة
  // تخدم الحزمة المبنيّة نفسها التي تصل الإنتاج — فالفحص أقرب للواقع وأثبت.
  const build = spawn('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' })
  await new Promise((r) => build.on('exit', r))
  const vite = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
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
  console.log('\n═══ فحص شاشة الدور (محاكاة Chrome 66) ═══\n')

  for (const [w, h0] of SIZES) {
    for (const bar of [false, true]) {
      const h = bar ? h0 - BAR : h0
      const line = []
      for (const docs of DOCS) {
        for (const listLen of LISTS) {
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
          }, mkBoard(docs, listLen))

          const page = await ctx.newPage()
          const errors = []
          page.on('pageerror', (e) => errors.push(e.message))
          // محاولةٌ ثانية عند تعثّر التنقّل: خادم المعاينة يتعثّر أحياناً وسط
          // جولةٍ طويلة، وذلك ليس فشلَ تخطيطٍ فلا يُسقط الفحص كلّه.
          let navOk = false
          for (let attempt = 0; attempt < 2 && !navOk; attempt++) {
            try {
              await page.goto(`${BASE}/order?key=test`, { waitUntil: 'load', timeout: 20000 })
              navOk = true
            } catch { await new Promise((r) => setTimeout(r, 1500)) }
          }
          if (!navOk) { failures.push(`${w}×${h0} ${docs}د/${listLen}: تعذّر فتح الصفحة`); await ctx.close(); continue }
          await page.waitForTimeout(600)

          const m = await page.evaluate(() => {
            const fs = (s) => { const e = document.querySelector(s)
              return e ? parseFloat(getComputedStyle(e).fontSize) : 0 }
            const cards = [...document.querySelectorAll('.od-card')]
            const grid = document.querySelector('.pd-grid')
            const gr = grid ? grid.getBoundingClientRect() : null
            const tops = {}
            cards.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top)
              tops[t] = (tops[t] || 0) + 1 })
            const used = cards.reduce((s, c) => { const r = c.getBoundingClientRect()
              return s + r.width * r.height }, 0)
            // قصٌّ فعلي: أيّ عنصرٍ يتجاوز بطاقته أو أسفل الشاشة
            const clipped = []
            cards.forEach((c, i) => {
              const cr = c.getBoundingClientRect()
              if (cr.bottom > document.documentElement.clientHeight + 1) clipped.push(`card${i}:below-fold`)
              const list = c.querySelector('.od-list-wrap')
              if (list) {
                const lr = list.getBoundingClientRect()
                ;[...c.querySelectorAll('.od-list li')].forEach((li, k) => {
                  if (li.getBoundingClientRect().bottom > lr.bottom + 1) clipped.push(`card${i}:row${k}`)
                })
              }
            })
            const first = cards[0]
            return {
              cards: cards.length,
              rowCounts: Object.keys(tops).sort((a, b) => Number(a) - Number(b)).map((k) => tops[k]),
              fillPct: gr ? Math.round(used / (gr.width * gr.height) * 100) : 0,
              clipped,
              items: first ? first.querySelectorAll('.od-list li').length : 0,
              hasMore: !!(first && first.querySelector('.od-more')),
              moreText: first && first.querySelector('.od-more')
                ? first.querySelector('.od-more').textContent : '',
              text: document.body.innerText,
              doctor: fs('.od-doctor'), room: fs('.od-room'),
              current: fs('.od-current-num'), item: fs('.od-list li .od-num'),
              scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            }
          })

          const tag = `${w}×${h0}${bar ? '+شريط' : ''} ${docs}د/${listLen}مريض`
          ok(m.cards === docs, `${tag}: ظهرت ${m.cards} بطاقة من ${docs}`)
          const orphan = m.rowCounts.length > 1 && m.rowCounts[m.rowCounts.length - 1] === 1 && docs > 2
          ok(!orphan, `${tag}: بطاقة يتيمة — ${JSON.stringify(m.rowCounts)}`)
          ok(m.fillPct >= 80, `${tag}: الملء ${m.fillPct}% (<80)`)
          ok(m.scrollY === 0, `${tag}: تمرير ${m.scrollY}px`)
          ok(m.clipped.length === 0, `${tag}: عناصر مقصوصة: ${m.clipped.join(', ')}`)
          ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)

          // ═══ الخصوصية: أرقامٌ فقط ═══
          ok(!PATIENT_NAMES.some((n) => m.text.includes(n)),
            `${tag}: ★ تسرّب اسم مريض إلى الشاشة العامة`)
          ok(!/إسعاف|عاجل|طارئ/.test(m.text),
            `${tag}: ★ ذُكرت الأولوية على الشاشة العامة`)
          // ★ «العيادة» لا «الغرفة» — نصّاً على الشاشة (والصوت يبقى «الغرفة»)
          ok(!/الغرفة/.test(m.text),
            `${tag}: ★ ظهرت «الغرفة» — التسمية يجب أن تكون «العيادة»`)
          // ═══ الحاضرون وحدهم ═══
          ok(!m.text.includes('901') && !m.text.includes('902'),
            `${tag}: ★ ظهر من لم يحضر بعد (901/902)`)

          if (listLen > 0) {
            ok(m.doctor >= MIN.doctor, `${tag}: اسم الدكتور ${m.doctor}px < ${MIN.doctor}`)
            ok(m.room >= MIN.room, `${tag}: الغرفة ${m.room}px < ${MIN.room}`)
            ok(m.current >= MIN.current, `${tag}: الرقم الحالي ${m.current}px < ${MIN.current}`)
            ok(m.item >= MIN.item, `${tag}: سطر القائمة ${m.item}px < ${MIN.item}`)
            // كل من يظهر يُعدّ: المعروض + المخفيّ = الحاضرون
            const shownRows = m.items - (m.hasMore ? 1 : 0)
            const hiddenNum = m.hasMore
              ? Number(m.moreText.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
              : 0
            ok(shownRows + hiddenNum === listLen,
              `${tag}: ★ ${shownRows} معروضاً + ${hiddenNum} مخفيّاً ≠ ${listLen} حاضراً`)
          } else {
            ok(/لا أحد بانتظار/.test(m.text), `${tag}: قائمة فارغة بلا رسالة`)
          }
          line.push(`${docs}د/${listLen}:${m.items}${m.hasMore ? '+' : ''}`)
          await ctx.close()
        }
      }
      console.log(`  ${String(w).padStart(4)}×${String(h0).padEnd(4)}${bar ? '+شريط' : '  ملء '} │ ${line.join('  ')}`)
    }
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
        await page.goto(`${BASE}/order?key=test`, { waitUntil: 'load' })
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
  if (failures.length) { failures.forEach((f) => console.error(`  ✖ ${f}`)); process.exit(1) }
  console.log('✔ شاشة الدور تملأ الشاشة، أرقامٌ فقط، والحاضرون وحدهم\n')
}
run().catch((e) => { console.error(e); process.exit(1) })
