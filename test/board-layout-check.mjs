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
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chipMinPx, tierOf, SPECIALTY_FIT_MIN } from '../src/display-layout.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.BOARD_TEST_PORT || 5232)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; return true } failures.push(label); return false }

// الحدّ الأدنى المقروء من ٤–٥ أمتار (يطابق MIN في display-layout.js)؛ ورقم الحبّة
// حدّه من chipMinPx(عرض النافذة): ٣٤px على 1920 — القاعدة نفسها لا نسخةٌ منها.
// الاختصاص عنوانٌ (٢٠px محسوباً، ويصغر بالقياس حتى SPECIALTY_FIT_MIN)، والاسم تحته (١٣px)
const MIN = { number: 56, room: 28, specialty: 20, doctor: 13 }

const SIZES = [[1920, 1080], [1366, 768], [960, 540]]
// المستويات الثلاثة: ١–٢ كبير · ٣–٤ متوسّط · ٥+ مكبوس
const DOCS = [1, 2, 4, 7, 8]
// أعداد المنتظرين: فارغ · واحد · ستّة (سقف الكبير، و«+N» في الأصغر) · طويلٌ يتجاوز البطاقة
const WAITING = [0, 1, 6, 20]
// «بانتظار العودة» (خروج مؤقت): بلا · ثلاثة — سطرٌ رابع في البطاقة يجب ألّا يقصّ الغرفة
const RETURNING = [0, 3]
const BAR = 90   // شريط متصفّح التلفاز

// أسماء مرضى في البيانات عمداً: إن ظهر أحدها على الشاشة فهو تسريب
const PATIENT_NAMES = ['سمير خالد الحسن', 'ليلى أحمد النجار']

// الاختصاصات المركّبة الطويلة أوّلاً: هي التي تفيض في البطاقة الضيّقة
const SPECIALTIES = ['نطق وتربية خاصة', 'غدد صم وسكري', 'عينية', 'بولية', 'عظمية', 'جلدية', 'قلبية', 'أطفال']
const mkBoard = (n, waiting = 2, returning = 0, extra = () => ({})) => ({
  urgent_delays: 0, seq: 1,
  board: Array.from({ length: n }, (_, i) => ({
    doctor_name: `د. ضياء الدين المنقل ${i + 1}`,
    specialty: SPECIALTIES[i % SPECIALTIES.length],
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
    returning: Array.from({ length: returning }, (_, k) => ({ queue_number: 60 + k })),
    ...extra(i),
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

  // BOARD_ONLY=call: أقسام النداء و«لم يصل» وحدها (للتكرار السريع) — الجولة الكاملة بلا متغيّر
  const ONLY = process.env.BOARD_ONLY || ''
  for (const [w, h0] of ONLY ? [] : SIZES) {
    for (const bar of [false, true]) {
      const h = bar ? h0 - BAR : h0
      const line = []
      for (const n of DOCS) {
       for (const waiting of WAITING) {
       for (const returning of RETURNING) {
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
        }, mkBoard(n, waiting, returning))

        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
        // الخطّ أولاً: عدد الحبّات محسوب بعرض أرقام Cairo، والقياس قبل تحميله (جهازٌ مشغول)
        // يرى خطّاً احتياطياً أعرض فيُبلغ عن قصٍّ لا وجود له — فشلٌ متنقّل بين الجولات
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 0) : 0))
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

          // ═══ الحبّات في أول بطاقة: كم ظهر، وهل خرج شيءٌ عن البطاقة أو صفّه ═══
          const first = cards[0]
          const q = (sel) => (first ? [...first.querySelectorAll(sel)] : [])
          const nextEls = q('.pd-chip:not(.pd-chip-return):not(.pd-chip-more)')
          const nextMore = q('.pd-chip-more:not(.pd-chip-return)')[0]
          const retEls = q('.pd-chip-return:not(.pd-chip-more)')
          const retMore = q('.pd-chip-return.pd-chip-more')[0]
          if (first) {
            const cr = first.getBoundingClientRect()
            q('.pd-chip').forEach((el, k) => {
              const r = el.getBoundingClientRect()
              const row = el.parentElement.getBoundingClientRect()
              if (r.bottom > cr.bottom + 1 || r.right > cr.right + 1 || r.left < cr.left - 1 || r.width < 2 ||
                r.right > row.right + 1 || r.left < row.left - 1 || r.bottom > row.bottom + 1 || r.top < row.top - 1)
                clipped.push(`card0:chip${k}(${el.textContent})`)
            })
            const block = first.querySelector('.pd-chips')
            if (block && block.getBoundingClientRect().bottom > cr.bottom + 1) clipped.push('card0:chips-block')
          }
          // كلّ حبّات الشبكة (لا الأولى وحدها): لا واحدة تحت الحدّ الأدنى ولا خارج بطاقتها
          let smallest = Infinity
          cards.forEach((c, i) => {
            const cr = c.getBoundingClientRect()
            c.querySelectorAll('.pd-chip').forEach((el) => {
              smallest = Math.min(smallest, parseFloat(getComputedStyle(el).fontSize))
              const r = el.getBoundingClientRect()
              if (r.right > cr.right + 1 || r.left < cr.left - 1 || r.bottom > cr.bottom + 1)
                clipped.push(`card${i}:chip(${el.textContent})`)
            })
          })
          const firstChip = nextEls[0]
          const rightmost = nextEls.length > 1 &&
            nextEls.every((e) => e.getBoundingClientRect().left <= firstChip.getBoundingClientRect().left)
          const fsOf = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0)
          // ═══ الترويسة: الاختصاص عنواناً والاسم تحته — كلاهما كاملٌ لا مقصوص ═══
          const heads = cards.map((c) => {
            const sp = c.querySelector('.pd-specialty'), dr = c.querySelector('.pd-doctor')
            return { sp: sp && sp.textContent, spFs: fsOf(sp), spWhole: !!sp && sp.scrollWidth <= sp.clientWidth + 1,
              spAbove: !!sp && !!dr && sp.getBoundingClientRect().bottom <= dr.getBoundingClientRect().top + 1,
              drFs: fsOf(dr), drWhole: !!dr && dr.scrollWidth <= dr.clientWidth + 1 }
          })
          const spVar = parseFloat(getComputedStyle(grid).getPropertyValue('--pd-specialty')) || 0
          const drVar = parseFloat(getComputedStyle(grid).getPropertyValue('--pd-doctor')) || 0

          return {
            cards: cards.length, rowCounts, clipped,
            fillPct: Math.round(used / (gr.width * gr.height) * 100),
            number: fs('.pd-number'), room: fs('.pd-room'), doctor: fs('.pd-doctor'),
            specialty: fs('.pd-specialty'), hasSpecialty: !!document.querySelector('.pd-specialty'),
            hasLabel: !!document.querySelector('.pd-label'),
            firstChip: fsOf(firstChip), smallestChip: smallest,
            firstIsFirst: !!firstChip && firstChip.classList.contains('pd-chip-first'),
            firstRightmost: nextEls.length < 2 || rightmost,
            shownNums: nextEls.map((e) => e.textContent.trim()),
            moreText: nextMore ? nextMore.textContent.trim() : '',
            returningNums: retEls.map((e) => e.textContent.trim()),
            retMoreText: retMore ? retMore.textContent.trim() : '',
            hasChipsBlock: !!(first && first.querySelector('.pd-chips')),
            titles: q('.pd-chip-title').map((e) => e.textContent.trim()),
            returnWord: q('.pd-return-word').length,
            returnIcon: q('.pd-return-icon').length,
            chipRows: q('.pd-chip-row').length,
            tier: first ? first.getAttribute('data-tier') : '',
            // الصفّ المدموج: «التالي» والعودة في الصندوق نفسه
            sameRow: !!(firstChip && retEls[0] && firstChip.parentElement === retEls[0].parentElement),
            returningFlash: !!document.querySelector('.pd-flash'),
            heads, spVar, drVar,
            text: document.body.innerText,
            scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          }
        })

        const tag = `${w}×${h0}${bar ? '+شريط' : ''} ${n}د/${waiting}منتظر/${returning}عودة`
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
        ok(m.drVar >= MIN.doctor, `${tag}: اسم الدكتور ${m.drVar}px < ${MIN.doctor}`)
        ok(m.spVar >= MIN.specialty, `${tag}: الاختصاص محسوباً ${m.spVar}px < ${MIN.specialty}`)
        // ★ القاعدة الذهبية: رقم الحبّة لا ينزل عن حدّه — في كلّ حبّات الشبكة
        const chipMin = chipMinPx(w)
        if (waiting > 0) ok(m.firstChip >= chipMin, `${tag}: أوّل حبّة ${m.firstChip}px < ${chipMin}`)
        if (m.smallestChip !== Infinity) ok(m.smallestChip >= chipMin, `${tag}: حبّةٌ ${m.smallestChip}px < ${chipMin}`)
        // ═══ الاختصاص عنوانٌ في كلّ بطاقة، كاملاً (يصغر بالقياس ولا يُقصّ)، والاسم تحته ═══
        m.heads.forEach((hd, i) => {
          ok(hd.sp === SPECIALTIES[i % SPECIALTIES.length], `${tag}: بطاقة ${i}: العنوان «${hd.sp}»`)
          ok(hd.spWhole, `${tag}: بطاقة ${i}: ★ الاختصاص «${hd.sp}» مقصوص (${hd.spFs}px)`)
          ok(hd.spFs >= SPECIALTY_FIT_MIN, `${tag}: بطاقة ${i}: الاختصاص صغُر إلى ${hd.spFs}px`)
          // ★ لا يصغر بلا حاجة: الاختصاص القصير بمقاسه المحسوب تماماً (والاسم كذلك)
          if (hd.sp.length <= 6) ok(Math.abs(hd.spFs - m.spVar) < 0.6, `${tag}: بطاقة ${i}: ★ «${hd.sp}» صغُر بلا حاجة ${hd.spFs} < ${m.spVar}`)
          if (hd.drWhole) ok(Math.abs(hd.drFs - m.drVar) < 0.6 || hd.drFs < m.drVar, `${tag}: بطاقة ${i}: الاسم أكبر من مقاسه`)
          ok(hd.spAbove, `${tag}: بطاقة ${i}: الاسم ليس تحت الاختصاص`)
          ok(hd.spFs > hd.drFs, `${tag}: بطاقة ${i}: الاسم (${hd.drFs}) ليس أصغر من الاختصاص (${hd.spFs})`)
        })

        // ═══ الترتيب البصري: الرقم ← الغرفة ← الاختصاص ← الاسم ═══
        ok(m.number > m.room, `${tag}: الرقم (${m.number}) ليس أكبر من الغرفة (${m.room})`)
        ok(m.room >= m.spVar, `${tag}: الغرفة (${m.room}) أصغر من الاختصاص (${m.spVar})`)
        ok(m.spVar > m.drVar, `${tag}: الاسم (${m.drVar}) ليس أصغر من الاختصاص (${m.spVar})`)

        // ═══ لا شيء مقصوص — والغرفة خاصّةً (ثانية الأهمية) ═══
        ok(m.clipped.length === 0, `${tag}: عناصر مقصوصة: ${m.clipped.join(', ')}`)

        // ═══ حبّات «التالي» ═══
        if (waiting === 0) {
          ok(m.shownNums.length === 0 && !m.moreText, `${tag}: ظهرت حبّاتٌ ولا منتظر — ${JSON.stringify(m.shownNums)}`)
          // لا منتظر ولا عائد: الصفّ لا يظهر ولا يحجز مكاناً
          if (returning === 0) ok(!m.hasChipsBlock, `${tag}: صفّ حبّاتٍ فارغ ظاهر`)
        } else {
          // المعروض + المخفيّ = عدد المنتظرين بالضبط — لا رقمَ يضيع بصمت
          const hidden = m.moreText ? Number(m.moreText.replace(/\D/g, '')) : 0
          ok(m.shownNums.length + hidden === waiting,
            `${tag}: ${m.shownNums.length} معروضاً + ${hidden} مخفيّاً ≠ ${waiting}`)
          ok(m.shownNums.length >= 1, `${tag}: لم تظهر ولا حبّة`)
          ok(m.shownNums[0] === '10', `${tag}: أوّل حبّة ${m.shownNums[0]} ليست التالي (10)`)
          ok(m.firstIsFirst, `${tag}: أوّل حبّة بلا تمييز`)
          ok(m.firstRightmost, `${tag}: أوّل حبّة ليست في أقصى اليمين (RTL)`)
          ok(!m.moreText || /^\+\d+$/.test(m.moreText), `${tag}: نصّ «+N» «${m.moreText}»`)
        }
        // ═══ المستوى ═══
        // المستوى بعدد العيادات، وقد ينزل درجةً في بطاقةٍ قصيرة (لا يصعد أبداً)
        const ORDER = ['large', 'medium', 'compact']
        const tier = m.tier
        ok(ORDER.indexOf(tier) >= ORDER.indexOf(tierOf(n)), `${tag}: المستوى «${tier}» أعلى من ${tierOf(n)}`)
        if (w === 1920) ok(tier === tierOf(n), `${tag}: على 1920 نزل المستوى إلى «${tier}»`)
        const cap = { large: 6, medium: 4, compact: 3 }[tier]
        ok(m.shownNums.length <= cap, `${tag}: ${m.shownNums.length} حبّة > سقف ${tier} (${cap})`)
        if (waiting > cap) ok(!!m.moreText, `${tag}: ${waiting} منتظراً بلا «+N»`)
        if (tier === 'compact') {
          ok(m.titles.length === 0 && m.returnWord === 0 && !m.hasLabel,
            `${tag}: نصٌّ في البطاقة المكبوسة (عنوان/يُخدَم الآن)`)
          ok(m.chipRows <= 1, `${tag}: ${m.chipRows} صفوف حبّات في المكبوس`)
          if (waiting > 0 && returning > 0 && m.returningNums.length > 0)
            ok(m.sameRow, `${tag}: التالي والعودة ليسا في صفٍّ واحد`)
        } else {
          if (waiting > 0) ok(m.titles.join() === 'التالي', `${tag}: عنوان الصفّ «${m.titles.join()}»`)
          if (returning > 0) {
            ok(m.returnIcon === 1, `${tag}: أيقونة العودة غائبة`)
            ok(m.returnWord === (tier === 'large' ? 1 : 0), `${tag}: كلمة «بانتظار العودة» في ${tier}`)
          }
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

        // ═══ «بانتظار العودة»: بترتيبها، والمعروض + «+N» = الكلّ، ولا تختلط بالمنتظرين، وبلا وميض ═══
        const retHidden = m.retMoreText ? Number(m.retMoreText.replace(/\D/g, '')) : 0
        ok(m.returningNums.join() === Array.from({ length: m.returningNums.length }, (_, k) => 60 + k).join() &&
          m.returningNums.length + retHidden === returning,
          `${tag}: أرقام «بانتظار العودة» ${JSON.stringify(m.returningNums)} +${retHidden}`)
        if (returning === 0) ok(m.returnIcon === 0 && !m.retMoreText, `${tag}: علامة عودة بلا عائدين`)
        ok(!m.shownNums.some((x) => Number(x) >= 60 && Number(x) < 70),
          `${tag}: ★ رقمٌ «بانتظار العودة» ظهر بين المنتظرين`)
        ok(!m.returningFlash, `${tag}: ★ وميضٌ على اللقطة الأولى`)

        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)

        if (returning === 0) line.push(`${n}د/${waiting}:${m.shownNums.length}${m.moreText ? '+' : ''}@${m.firstChip || '-'}`)
        await ctx.close()
       }
       }
      }
      console.log(`  ${String(w).padStart(4)}×${String(h0).padEnd(4)}${bar ? ' +شريط' : '  ملء  '} │ ${line.join('  ')}`)
    }
  }

  // ═══ بطاقة النداء: التسمية «العيادة»، وأحجامٌ تعمل على Chrome 66 ═══
  // فحصُ البطاقات وحدها لا يكفي: بطاقة النداء تظهر عند حدث call فقط، وقد بقيت
  // تقول «الغرفة» بعد تغيير التسمية — لا يراها إلا من ينادي. وكانت أحجامها clamp()
  // فنزل الرقم المنادى إلى ١٦px على التلفاز؛ الآن media queries، والحجم المتوقَّع
  // هنا = ما كانت clamp ستعطيه في كلّ عرض (والجوال تحت 1024 بحدوده هو).
  {
    const CALL_SIZES = [[1920, 1080], [1366, 768], [960, 540], [375, 667]]
    const between = (lo, v, hi) => Math.min(hi, Math.max(lo, v))
    const line = []
    for (const [w, h] of CALL_SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
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
      // الخطّ أولاً: عدد الحبّات محسوب بعرض أرقام Cairo، والقياس قبل تحميله (جهازٌ مشغول)
      // يرى خطّاً احتياطياً أعرض فيُبلغ عن قصٍّ لا وجود له — فشلٌ متنقّل بين الجولات
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 0) : 0))
      await page.waitForTimeout(900)
      await page.evaluate(() => window.__sse.emit('call', {
        queue_number: 17, room: '1', doctor_name: 'د. ضياء الدين المنقل 1',
        specialty: 'باطنية', seq: 99, repeat: false }))
      await page.waitForTimeout(900)
      const ban = await page.evaluate(() => {
        const el = document.querySelector('.pd-banner')
        if (!el) return { shown: false, text: '' }
        const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)
        const r = el.getBoundingClientRect()
        const ir = document.querySelector('.pd-banner-inner').getBoundingClientRect()
        const n = document.querySelector('.pd-banner-number')
        return { shown: true, text: el.innerText,
          number: fs('.pd-banner-number'), label: fs('.pd-banner-label'), dest: fs('.pd-banner-dest'),
          covers: r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight,
          innerIn: ir.left >= 0 && ir.right <= innerWidth && ir.top >= 0 && ir.bottom <= innerHeight,
          numberWhole: n.scrollWidth <= n.clientWidth + 1 }
      })
      const tag = `بطاقة النداء ${w}×${h}`
      if (!ok(ban.shown, `${tag}: لم تظهر عند حدث call`)) { await ctx.close(); continue }
      ok(/العيادة/.test(ban.text), `${tag}: ★ التسمية يجب أن تكون «العيادة» — ${ban.text}`)
      ok(!/الغرفة/.test(ban.text), `${tag}: ★ ظهرت «الغرفة» — ${ban.text}`)
      const mobile = w <= 1023
      const want = {
        number: mobile ? between(88, w * 0.34, 190) : between(90, w * 0.16, 300),
        label: mobile ? 16 : between(14, w * 0.015, 28),
        dest: between(18, w * 0.024, 46),
      }
      for (const k of ['number', 'label', 'dest']) {
        ok(Math.abs(ban[k] - want[k]) < 0.6, `${tag}: ★ خطّ ${k} ${ban[k]}px ≠ ${want[k].toFixed(1)} (ما كانت clamp ستعطيه)`)
      }
      ok(ban.number >= 88, `${tag}: ★ الرقم المنادى صغير ${ban.number}px`)
      ok(ban.covers, `${tag}: الطبقة لا تغطّي الشاشة كلّها`)
      ok(ban.innerIn, `${tag}: البطاقة تخرج من الشاشة`)
      ok(ban.numberWhole, `${tag}: الرقم مقصوص`)
      line.push(`${w}:${ban.number}/${ban.label}/${ban.dest}px`)
      await ctx.close()
    }
    console.log(`  بطاقة النداء │ رقم/تسمية/وجهة ${line.join('  ')}`)
  }


  // ═══ «الدكتور لم يصل بعد»: باهتة بجملتها كـ«انتهى الدوام»، وأوّل نداءٍ يُعيدها طبيعية ═══
  // اللقطة: ٤ (و٨) عيادات، الأولى والثالثة لم يصل دكتورهما (ومنتظروهما حاضرون)، والرابعة انتهت.
  // ثمّ نداءٌ في الأولى: الشاشة تسحب اللوحة (load) فتصلها الأولى «واصلة» — نعترض الطلب هنا.
  // ثمّ «وصل الطبيب» في الثالثة بلا نداء (refresh من الخادم): تعود طبيعية وهي بلا قيد كشف.
  const fakeES = (snap) => {
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
  }
  {
    const line = []
    for (const [w, h] of [[1920, 1080], [960, 540]]) {
      for (const n of [1, 4, 8]) {
        const waitingDocs = n === 1 ? [0] : [0, 2]
        const before = mkBoard(n, 3, 0, (i) => ({
          awaiting_doctor: waitingDocs.includes(i),
          closed: n > 1 && i === 3,
          current: waitingDocs.includes(i) || (n > 1 && i === 3) ? null : { queue_number: 100 + i },
        }))
        const after = JSON.parse(JSON.stringify(before))
        after.board[0].awaiting_doctor = false
        after.board[0].current = { queue_number: 10 }
        after.board[0].queue = after.board[0].queue.slice(1)
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        await ctx.addInitScript(fakeES, before)
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        let served = after
        await page.route('**/api/public/clinic/board*', (r) => r.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(served) }))
        await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 0) : 0))
        await page.waitForTimeout(700)
        const read = () => page.evaluate(() => [...document.querySelectorAll('.pd-card')].map((c) => {
          const msg = c.querySelector('.pd-awaiting')
          const cr = c.getBoundingClientRect()
          const mr = msg && msg.getBoundingClientRect()
          return {
            dim: c.classList.contains('pd-card-closed'), opacity: getComputedStyle(c).opacity,
            awaiting: !!msg, msgText: msg ? msg.textContent.trim() : '', ended: !!c.querySelector('.pd-closed:not(.pd-awaiting)'),
            msgFs: msg ? parseFloat(getComputedStyle(msg).fontSize) : 0,
            closedFs: parseFloat(getComputedStyle(c).getPropertyValue('--pd-room')) || 0,
            msgIn: !msg || (mr.left >= cr.left - 1 && mr.right <= cr.right + 1 && mr.bottom <= cr.bottom + 1 && mr.height > 4
              && msg.scrollWidth <= msg.clientWidth + 1),
            // «انتهى الدوام» كاملةً أيضاً: بجانب شارة العيادة في الصفّ المضغوط كانت تُقصّ
            endedIn: (() => { const e = c.querySelector('.pd-closed:not(.pd-awaiting)'); if (!e) return true
              const r = e.getBoundingClientRect(), w = c.querySelector('.pd-current-wrap').getBoundingClientRect()
              return r.left >= w.left - 1 && r.right <= w.right + 1 && e.scrollWidth <= e.clientWidth + 1 })(),
            chips: c.querySelectorAll('.pd-chip').length, number: !!c.querySelector('.pd-number'),
            head: c.querySelector('.pd-specialty') ? c.querySelector('.pd-specialty').textContent : '',
          }
        }))
        const tag = `لم يصل ${w}×${h} ${n}د`
        const b0 = await read()
        b0.forEach((c, i) => {
          if (waitingDocs.includes(i)) {
            ok(c.dim && c.awaiting && c.msgText === 'الدكتور لم يصل بعد', `${tag}: بطاقة ${i}: ليست باهتة بالجملة ${JSON.stringify(c)}`)
            ok(c.opacity === b0.find((x) => x.ended)?.opacity || n === 1 && c.opacity === '0.45',
              `${tag}: بطاقة ${i}: ★ التبهيت (${c.opacity}) غير «انتهى الدوام»`)
            ok(c.chips === 0 && !c.number, `${tag}: بطاقة ${i}: حبّاتٌ أو رقمٌ في بطاقة «لم يصل»`)
            ok(c.msgIn, `${tag}: بطاقة ${i}: ★ الجملة مقصوصة أو خارج البطاقة`)
            ok(Math.abs(c.msgFs - c.closedFs) < 0.6, `${tag}: بطاقة ${i}: خطّ الجملة ${c.msgFs} ≠ «انتهى الدوام» ${c.closedFs}`)
            ok(!!c.head, `${tag}: بطاقة ${i}: الترويسة غابت`)
          } else if (n > 1 && i === 3) {
            ok(c.dim && c.ended && !c.awaiting, `${tag}: بطاقة ${i}: «انتهى الدوام» تغيّرت ${JSON.stringify(c)}`)
            ok(c.endedIn, `${tag}: بطاقة ${i}: ★ «انتهى الدوام» مقصوصة`)
          } else {
            ok(!c.dim && !c.awaiting && c.number && c.chips > 0, `${tag}: بطاقة ${i}: العادية باهتة ${JSON.stringify(c)}`)
          }
        })
        // أوّل نداء
        await page.evaluate((sp) => window.__sse.emit('call', { queue_number: 10, room: '1',
          doctor_name: 'د. ضياء الدين المنقل 1', specialty: sp, patient_name: 'سمير خالد الحسن', seq: 50, repeat: false }),
          SPECIALTIES[0])
        await page.waitForTimeout(800)
        const b1 = await read()
        ok(!b1[0].dim && !b1[0].awaiting && b1[0].number, `${tag}: ★ بعد أوّل نداء بقيت البطاقة باهتة ${JSON.stringify(b1[0])}`)
        if (n > 1) ok(b1[2].awaiting && b1[2].dim, `${tag}: نداء الأولى أعاد غيرها`)
        // ★ «وصل الطبيب» بلا نداء: الخادم يبثّ refresh واللوحة تصل بلا awaiting ولا قيد كشف
        if (n > 1) {
          served = JSON.parse(JSON.stringify(after))
          served.board[2].awaiting_doctor = false
          await page.evaluate(() => window.__sse.emit('refresh', { seq: 51 }))
          await page.waitForTimeout(800)
          const b2 = await read()
          ok(!b2[2].dim && !b2[2].awaiting && b2[2].chips > 0, `${tag}: ★ بعد «وصل الطبيب» بلا نداء بقيت باهتة ${JSON.stringify(b2[2])}`)
          ok(!b2[0].awaiting && b2[3].ended, `${tag}: «وصل الطبيب» غيّر بطاقةً أخرى`)
        }
        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)
        line.push(`${w}/${n}:${b0.filter((c) => c.awaiting).length}→${b1.filter((c) => c.awaiting).length}`)
        await ctx.close()
      }
    }
    console.log(`  لم يصل بعد │ ${line.join('  ')}`)
  }

  // ═══ النداء بالاسم: الرقم كبيراً كما كان + اسم المريض تحته — والطويل يصغر ولا يكسر ═══
  {
    const NAMES = {
      normal: 'سمير خالد الحسن',
      long: 'عبد الرحمن محمد سعيد عبد الله الحسيني المصري الشامي',
      huge: 'عبد الرحمن محمد سعيد عبد الله الحسيني المصري الشامي أبو العلا الدمشقي الحلبي الحمصي',
    }
    const line = []
    for (const [w, h] of [[1920, 1080], [1366, 768], [960, 540], [375, 667]]) {
      for (const kind of ['none', 'normal', 'long', 'huge']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        await ctx.addInitScript(fakeES, mkBoard(4, 3))
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${BASE}/display?key=test`, { waitUntil: 'load' })
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 0) : 0))
        await page.waitForTimeout(700)
        await page.evaluate((nm) => window.__sse.emit('call', { queue_number: 17, room: '1',
          doctor_name: 'د. ضياء الدين المنقل 1', specialty: 'عينية', seq: 99, repeat: false,
          ...(nm ? { patient_name: nm } : {}) }), NAMES[kind] || null)
        await page.waitForTimeout(700)
        const b = await page.evaluate(() => {
          const el = document.querySelector('.pd-banner-name')
          const num = document.querySelector('.pd-banner-number')
          const inner = document.querySelector('.pd-banner-inner').getBoundingClientRect()
          const r = el && el.getBoundingClientRect(), nr = num.getBoundingClientRect()
          const lh = el ? parseFloat(getComputedStyle(el).lineHeight) : 1
          return {
            name: el ? el.textContent : null, fs: el ? parseFloat(getComputedStyle(el).fontSize) : 0,
            whole: !!el && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight - el.clientHeight <= lh / 2,
            lines: el ? Math.round(el.clientHeight / lh) : 0,
            clamped: !!el && getComputedStyle(el).webkitLineClamp === '2',
            below: !el || r.top >= nr.bottom - 1,
            innerIn: inner.left >= 0 && inner.right <= innerWidth && inner.top >= 0 && inner.bottom <= innerHeight,
            numFs: parseFloat(getComputedStyle(num).fontSize),
            numWhole: num.scrollWidth <= num.clientWidth + 1,
            text: document.querySelector('.pd-banner').innerText,
          }
        })
        const tag = `النداء بالاسم ${w}×${h} ${kind}`
        const mobile = w <= 1023
        const between = (lo, v, hi) => Math.min(hi, Math.max(lo, v))
        const wantNum = mobile ? between(88, w * 0.34, 190) : between(90, w * 0.16, 300)
        ok(Math.abs(b.numFs - wantNum) < 0.6, `${tag}: ★ رقم النداء تغيّر ${b.numFs} ≠ ${wantNum}`)
        ok(b.numWhole && b.innerIn, `${tag}: البطاقة تخرج من الشاشة أو الرقم مقصوص`)
        ok(/العيادة 1/.test(b.text), `${tag}: الوجهة غابت`)
        if (kind === 'none') {
          ok(b.name === null, `${tag}: سطر اسمٍ بلا اسم`)
        } else {
          ok(b.name === NAMES[kind], `${tag}: الاسم «${b.name}»`)
          ok(b.below, `${tag}: الاسم ليس تحت الرقم`)
          ok(b.fs >= 20, `${tag}: ★ الاسم صغُر إلى ${b.fs}px`)
          // ★ العاديّ بمقاسه الكامل — لا يصغر بلا حاجة
          const base = mobile && w <= 600 ? 24 : w >= 1800 ? 72 : w * 0.04
          if (kind === 'normal') ok(Math.abs(b.fs - base) < 0.6, `${tag}: ★ الاسم العاديّ صغُر بلا حاجة ${b.fs} < ${base}`)
          // العاديّ والطويل كاملان (الطويل سطران أو يصغر)؛ والمفرط وحده قد يبلغ الحدّ فيُقصّ بنقاط
          ok(b.lines >= 1 && b.lines <= 2, `${tag}: الاسم في ${b.lines} أسطر`)
          if (kind === 'normal') ok(b.lines === 1, `${tag}: الاسم العاديّ انكسر سطرين`)
          if (kind !== 'huge') ok(b.whole, `${tag}: ★ الاسم مقصوص (${b.fs}px)`)
          else ok(b.whole || b.clamped, `${tag}: المفرط يفيض بلا قصٍّ بنقاط`)
        }
        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)
        line.push(`${w}/${kind}:${b.fs || '-'}`)
        await ctx.close()
      }
    }
    console.log(`  النداء بالاسم │ ${line.join('  ')}`)
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
        // الخطّ أولاً: عدد الحبّات محسوب بعرض أرقام Cairo، والقياس قبل تحميله (جهازٌ مشغول)
        // يرى خطّاً احتياطياً أعرض فيُبلغ عن قصٍّ لا وجود له — فشلٌ متنقّل بين الجولات
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 0) : 0))
        await page.waitForTimeout(600)
        const hd = await page.evaluate(() => {
          const t = document.querySelector('.pd-title')
          const c = document.querySelector('.pd-clock')
          const head = document.querySelector('.pd-head')
          const tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect(), hr = head.getBoundingClientRect()
          const fsz = parseFloat(getComputedStyle(t).fontSize)
          return {
            text: t.textContent.trim(), fsz,
            // عدد صناديق السطر لا نسبة الارتفاع: صندوق Cairo ≈1.87em فالنسبة تخطئ بالتقريب
            oneLine: t.getClientRects().length === 1,
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
        // الحجم = ما كانت clamp(16px, 1.8vw, 34px) ستعطيه — بلا clamp
        const want = Math.min(34, Math.max(16, w * 0.018))
        ok(Math.abs(hd.fsz - want) < 0.6, `${tag}: خطّ الاسم ${hd.fsz}px ≠ ${want.toFixed(1)}`)
        ok(hd.scrollX <= 0, `${tag}: تمرير أفقي ${hd.scrollX}px`)
        ok(errors.length === 0, `${tag}: أخطاء صفحة: ${errors.join(' | ')}`)
        line.push(`${w}×${h}:${hd.fsz}px/${hd.gap}px`)
        await ctx.close()
      }
    }
    console.log(`  الترويسة │ ${line.join('  ')}`)
  }

  // ═══ CSS الشاشة بلا ما يغيب عن Chrome 66 ═══
  // Chrome 66 (تلفاز الصالة) لا يملك clamp()/min()/max() ولا inset ولا *-inline* ولا gap في flex
  // فيُسقط التصريح كلّه — الخطّ إلى ١٦px، والطبقة بلا حواف، والعناصر ملتصقة. والمتصفّح الحديث في هذا الفحص
  // يملكها فلا يرى العطب — فنفحص المصدر نفسه.
  {
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))

    // ١) كلّ قاعدةٍ تمسّ صنفاً تستعمله الشاشة (/display و/order): الأصناف تُجمع من شيفرتها
    //    نفسها، فصنفٌ جديد يدخل الفحص وحده بلا قائمة تُنسى. styles.css مشترك مع بقيّة النظام،
    //    فالقاعدة التي لا تمسّ أصناف الشاشة خارج الفحص.
    const SCREEN_SRC = ['src/pages/PublicDisplay.jsx', 'src/pages/OrderDisplay.jsx', 'src/display-layout.js', 'src/waiting-return.jsx']
    const cls = new Set()
    for (const f of SCREEN_SRC) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      for (const m of src.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\})/g)) {
        (m[1] || m[2] || m[3]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter((c) => /^[a-z][-a-z0-9]*$/.test(c)).forEach((c) => cls.add(c))
      }
      // أصنافٌ تُبنى في JS ('pd-chip-' + …) أو تُمرَّر نصّاً
      // وأصنافٌ شرطيّة داخل ${…} (' pd-current-row') — فاتت الفحص فبقي margin-inline-start فيها منذ 10-17
      for (const m of src.matchAll(/['"`\s]((?:pd|od)-[-a-z0-9]*[a-z0-9])(?![-a-z0-9])/g)) cls.add(m[1])
    }
    ok(cls.has('pd-banner-number') && cls.has('pd-title') && cls.has('pd-current-row') && cls.has('pd-offline-alert') && cls.size > 40,
      `CSS الشاشة: جمع الأصناف من الشيفرة ناقص (${cls.size})`)
    const CLS = [...cls].map((c) => new RegExp(`\\.${c}(?![-a-z0-9])`))
    const isScreen = (sel) => CLS.some((re) => re.test(sel))
    // clamp()/min()/max() (79) · inset/inset-* (87) · أيّ خاصيّة *-inline* (margin/padding/border/inset:
    // 69–87) · وgap في flex (84). gap الشبكة يعمل في 66 — فيُقبل gap فقط في قاعدةٍ تُعلن
    // display: grid بنفسها (وإلا لا يُعرف أهو flex)
    const why = (body) => {
      const r = []
      if (/\b(clamp|min|max)\(/.test(body)) r.push('clamp/min/max')
      if (/(^|[;\s])inset(-[a-z]+)?\s*:/.test(body)) r.push('inset')
      const inl = body.match(/(^|[;\s])([a-z-]*-inline(-[a-z]+)?)\s*:/)
      if (inl) r.push(inl[2])
      if (/(^|[;\s])(row-|column-)?gap\s*:/.test(body) && !/display\s*:\s*(inline-)?grid/.test(body)) r.push('gap بلا grid')
      return r
    }
    const bad = rules.filter((r) => isScreen(r.sel) && why(r.body).length).map((r) => `${r.sel} (${why(r.body).join('، ')})`)
    ok(bad.length === 0, `CSS الشاشة: خصائص غير مدعومة في Chrome 66 — ${bad.join(' | ')}`)
    console.log(`  CSS الشاشة │ ${cls.size} صنفاً، ${rules.filter((r) => isScreen(r.sel)).length} قاعدة: ${bad.length ? '✖ ' + bad.join(' | ') : 'بلا clamp/min/max/inset/*-inline*/flex gap'}`)
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
