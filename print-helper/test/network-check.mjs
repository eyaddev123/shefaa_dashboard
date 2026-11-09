// ═══ فحص وضع الشبكة: الوسيط ⇒ TCP ⇒ طابعةٌ وهميّة ═══
//   node test/network-check.mjs   (ويشغّله npm test بعد فحص ESC/POS)
//
// ★ لا شيء يذهب لطابعةٍ حقيقيّة: كلّ «طابعة» هنا خادم TCP على 127.0.0.1 بمنفذٍ
// عشوائيّ، والوسيط يُشغَّل بإعدادٍ مؤقّت printer_ip=127.0.0.1. وقبل أيّ طلب
// طباعة نتحقّق من /health أنّ الوسيط المجيب هو وسيطنا بهذا العنوان بالضبط.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { decodePng, encodeGrayPng } from '../src/png.js'
import { rgbaToBits, buildJob } from '../src/escpos.js'
import { interpretStatus } from '../src/net-printer.js'

let pass = 0
const fails = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); return true }
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✘ ${label}${detail ? ` ${detail}` : ''}`)
  return false
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SERVER_JS = fileURLToPath(new URL('../src/server.js', import.meta.url))
const DIR = mkdtempSync(join(tmpdir(), 'shefaa-net-'))
const ORIGIN = 'http://test.local'
const TOKEN = 'tk'

/** منفذٌ حرّ الآن (يُغلق فوراً) */
async function freePort() {
  const s = net.createServer()
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise((r) => s.close(r))
  return port
}

/**
 * طابعةٌ وهميّة على TCP.
 *  oneAtATime: 'unlisten' (تتوقّف عن الاستماع وهي مشغولة ⇒ ECONNREFUSED حقيقيّ)
 *              أو 'drop' (تقبل الاتصال الثاني ثمّ تغلقه فوراً)
 *  holdMs:     بعد أن يُنهي الوسيط الإرسال تنتظر قبل أن تغلق (طابعةٌ تطبع)
 *  dropFirst:  تقبل أوّل N اتصالات ثمّ تغلقها فوراً بلا قراءة
 *  status:     { 1: byte, 4: byte, 2: byte } ردود DLE EOT — غيابها = طابعةٌ صامتة
 *  cutAt:      تغلق الاتصال بعد استلام هذا العدد من البايتات
 */
async function mockPrinter({ port = 0, oneAtATime = null, holdMs = 0, dropFirst = 0, status = null, cutAt = 0 } = {}) {
  const conns = []          // { kind, bytes, dropped }
  let active = 0, maxActive = 0, seen = 0
  // allowHalfOpen: وإلا ردّ Node على إغلاق الوسيط بإغلاقٍ فوريّ ولم تنتظر شيئاً
  const srv = net.createServer({ allowHalfOpen: true }, (sock) => {
    seen++
    const c = { kind: 'unknown', chunks: [], dropped: false, get bytes() { return Buffer.concat(this.chunks) } }
    conns.push(c)
    if (seen <= dropFirst || (oneAtATime === 'drop' && active > 0)) {
      c.dropped = true; sock.destroy(); return
    }
    active++; maxActive = Math.max(maxActive, active)
    if (oneAtATime === 'unlisten' && active === 1) srv.close()
    let got = 0
    sock.on('data', (d) => {
      c.chunks.push(d); got += d.length
      if (c.kind === 'unknown') c.kind = d[0] === 0x1b && d[1] === 0x40 ? 'job' : d[0] === 0x10 ? 'probe' : 'other'
      if (c.kind === 'probe' && status)
        for (let i = 0; i + 2 < d.length; i++)
          if (d[i] === 0x10 && d[i + 1] === 0x04 && status[d[i + 2]] != null) sock.write(Buffer.from([status[d[i + 2]]]))
      if (cutAt && c.kind === 'job' && got >= cutAt) { sock.pause(); sock.destroy() }
    })
    const release = () => {
      active--
      if (oneAtATime === 'unlisten' && active === 0 && !closed) srv.listen(mock.port, '127.0.0.1')
    }
    sock.on('end', () => {
      setTimeout(() => sock.end(), c.kind === 'job' ? holdMs : 0)
    })
    sock.on('close', release)
    sock.on('error', () => {})
  })
  let closed = false
  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  const mock = {
    port: srv.address().port, conns, srv,
    get maxActive() { return maxActive },
    jobs: () => conns.filter((c) => c.kind === 'job'),
    probes: () => conns.filter((c) => c.kind === 'probe'),
    close: () => { closed = true; return new Promise((r) => srv.close(() => r())).catch(() => {}) },
  }
  return mock
}

/** يشغّل وسيطاً بوضع الشبكة على طابعةٍ وهميّة */
async function startHelper(printerPort, extra = {}) {
  const port = await freePort()
  const cfg = join(DIR, `cfg-${port}.json`)
  writeFileSync(cfg, JSON.stringify({ port, printer: 'NO-SUCH-PRINTER', token: TOKEN,
    printer_ip: '127.0.0.1', printer_port: printerPort, net_timeout_ms: 2000,
    origins: [ORIGIN], log: join(DIR, `log-${port}.txt`), ...extra }))
  const env = { ...process.env, SHEFAA_PRINT_CONFIG: cfg }
  delete env.SHEFAA_PRINT_DRY_RUN
  const p = spawn(process.execPath, [SERVER_JS], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  for (let t = 0; t < 50 && !/يعمل على/.test(out); t++) await sleep(100)
  const base = `http://127.0.0.1:${port}`
  return {
    base, proc: p, get out() { return out },
    health: async () => (await fetch(`${base}/health`, { headers: { Origin: ORIGIN } })).json(),
    print: async (images) => {
      const r = await fetch(`${base}/print`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Print-Token': TOKEN },
        body: JSON.stringify({ images }) })
      return { status: r.status, body: await r.json() }
    },
    kill: () => p.kill(),
  }
}

/** ★ حارس: لا طلب طباعة إلا لوسيطنا بوضع الشبكة على 127.0.0.1 وبالمنفذ الوهميّ */
async function guard(h, mockPort) {
  const s = await h.health()
  if (!(s.mode === 'network' && s.printer_ip === '127.0.0.1' && s.printer_port === mockPort && s.dry_run === false)) {
    console.error('✖ الوسيط المجيب ليس بوضع الشبكة على الطابعة الوهميّة — توقّف الفحص قبل أيّ طباعة', JSON.stringify(s))
    process.exit(1)
  }
  return s
}

// ═══ صورٌ معروفة والمهمّة المتوقّعة بالبايت ═══
const W = 576
const pat = (seed) => (x, y) => y < 2 || ((x * 7 + y * 3 + seed) % 11 === 0) || (x > 200 && x < 300 && y > 40 && y < 120)
const png = (h, seed) => encodeGrayPng(W, h, pat(seed))
const url = (buf) => 'data:image/png;base64,' + buf.toString('base64')
const mono = (buf) => { const d = decodePng(buf); return rgbaToBits(d.width, d.height, d.rgba, 160) }
const PNG_A = png(600, 1), PNG_B = png(700, 5)
const IMAGES = [url(PNG_A), url(PNG_B)]
const EXPECTED = buildJob([mono(PNG_A), mono(PNG_B)], { feedMm: 5 })
const ONE = [url(PNG_A)]
const EXPECTED_ONE = buildJob([mono(PNG_A)], { feedMm: 5 })

const helpers = []
const mocks = []
const track = (x, list) => { list.push(x); return x }

try {
  // ═══ ١) البايتات التي تصل الطابعة = buildJob حرفاً حرفاً ═══
  console.log('\n── ١) بطاقةٌ بنسختين ⇒ البايتات مطابقة تماماً ──')
  {
    const m = track(await mockPrinter({ status: { 1: 0x12, 4: 0x12 } }), mocks)
    const h = track(await startHelper(m.port), helpers)
    await guard(h, m.port)
    ok(/وضع الشبكة: 127\.0\.0\.1:\d+/.test(h.out) && /ورق 80مم/.test(h.out) && /الإعداد من/.test(h.out) && /برمز/.test(h.out),
      '★ سطر الإقلاع: الوضع والعنوان وعرض الورق ومصدر الإعداد والرمز', h.out.split('\n')[0].slice(0, 200))
    const r = await h.print(IMAGES)
    ok(r.status === 200 && r.body.copies === 2 && r.body.attempts === 1, '200 ونسختان من المحاولة الأولى', JSON.stringify(r.body))
    const jobs = m.jobs()
    ok(jobs.length === 1, '★ اتصال طباعةٍ واحد', String(jobs.length))
    ok(jobs[0] && jobs[0].bytes.equals(EXPECTED),
      `★★ Buffer كامل مطابق لـ buildJob (${EXPECTED.length} بايت)`, jobs[0] ? `وصل ${jobs[0].bytes.length}` : 'لا شيء')
    ok(!/NO-SUCH-PRINTER/.test(JSON.stringify(await h.health())), 'اسم printer مُتجاهَل تماماً في وضع الشبكة')
  }

  // ═══ ٢) الطابعة غير موجودة ⇒ 502 برسالةٍ مفهومة، والوسيط حيّ ═══
  console.log('\n── ٢) لا طابعة على العنوان ──')
  {
    const dead = await freePort()
    const h = track(await startHelper(dead), helpers)
    await guard(h, dead)
    const t0 = Date.now()
    const r = await h.print(ONE)
    const ms = Date.now() - t0
    ok(r.status === 502, '★ 502 لا انهيار', String(r.status))
    ok(r.body.error === 'الطابعة مشغولة أو غير متاحة — حاولي مرة أخرى', '★ الرسمة للموظفة', r.body.error)
    ok(/ECONNREFUSED/.test(r.body.detail || '') && /رفضت/.test(r.body.detail || ''), 'السبب التقنيّ في حقلٍ منفصل (detail)', r.body.detail)
    ok(r.body.attempts === 6 && r.body.wrote === false, '★ المحاولة الأولى + ٥ إعادات، ولم يُكتب شيء', `${r.body.attempts}`)
    ok(ms >= 5300 && ms < 9000, 'الفواصل المتزايدة ≈ ٥٫٤ ثانية', `${ms}ms`)
    const s = await h.health()
    ok(s.ok === true && s.printer_ready === false && /رفضت|ECONNREFUSED/.test(s.printer_state), 'الوسيط ما زال يجيب، و/health تقول السبب', s.printer_state)
    ok(h.proc.exitCode === null, 'العملية حيّة')
  }

  // ═══ ٣) /health بوضع الشبكة ═══
  console.log('\n── ٣) /health: الحقول وقراءة الحالة ──')
  {
    const OLD = ['ok', 'service', 'version', 'max_copies', 'dry_run', 'printer', 'printable_width',
                 'printer_ready', 'printer_state', 'needs_token']
    const cases = [
      ['جاهزة', { 1: 0x12, 4: 0x12 }, true, 'جاهزة'],
      ['صامتة (لا ردّ)', null, true, 'متصلة (لا تدعم قراءة الحالة)'],
      ['بلا ورق', { 1: 0x1a, 4: 0x72, 2: 0x32 }, false, 'لا يوجد ورق'],
      ['الغطاء مفتوح', { 1: 0x1a, 4: 0x12, 2: 0x16 }, false, 'الغطاء مفتوح'],
      ['خطأ', { 1: 0x1a, 4: 0x12, 2: 0x52 }, false, 'خطأ'],
    ]
    for (const [label, status, ready, state] of cases) {
      const m = track(await mockPrinter({ status }), mocks)
      const h = track(await startHelper(m.port, { printable_width: 58 }), helpers)
      const s = await h.health()
      if (label === 'جاهزة') {
        ok(OLD.every((k) => k in s), '★ كلّ الحقول القديمة باقية بأسمائها', OLD.filter((k) => !(k in s)).join(','))
        ok(s.version === 3 && s.mode === 'network' && s.printer_ip === '127.0.0.1' && s.printer_port === m.port,
          '★ version 3 و mode=network والعنوان والمنفذ', JSON.stringify(s))
        ok(typeof s.printer_checked_at === 'string' && !isNaN(Date.parse(s.printer_checked_at)), 'printer_checked_at وقتٌ صالح')
        ok(s.printable_width === 58, 'printable_width ما زال يُقرأ من الإعداد في وضع الشبكة')
        ok(s.printer === `127.0.0.1:${m.port}`, 'printer = العنوان (للواجهة الأقدم)', s.printer)
      }
      ok(s.printer_ready === ready && s.printer_state === state, `حالة «${label}» ⇒ ${state}`, `${s.printer_ready} ${s.printer_state}`)
      ok(m.probes().length === 1 && m.jobs().length === 0, `  الفحص لا يطبع شيئاً`)
    }
    // تفسير البايتات وحده
    ok(interpretStatus(0x12, 0x1e).state === 'جاهزة — الورق قارب على النفاد', 'قارب الورق على النفاد ⇒ جاهزة مع تنبيه')
  }

  // ═══ ٤) طابعةٌ تقبل اتصالاً واحداً وتنتظر ثانيةً قبل الإغلاق ═══
  console.log('\n── ٤) جهازان على طابعةٍ واحدة ──')
  for (const style of ['unlisten', 'drop']) {
    const m = track(await mockPrinter({ oneAtATime: style, holdMs: 1000 }), mocks)
    const h1 = track(await startHelper(m.port), helpers)
    const h2 = track(await startHelper(m.port), helpers)
    // انتظر أن ينتهي فحصا الحارس قبل الطباعة
    await guard(h1, m.port); await guard(h2, m.port); await sleep(100)
    const [a, b] = await Promise.all([h1.print(IMAGES), h2.print(ONE)])
    const jobs = m.jobs()
    ok(a.status === 200 && b.status === 200, `★ [${style}] وسيطان معاً ⇒ الاثنان 200`, `${a.status}/${b.status} ${a.body.error || ''}${b.body.error || ''}`)
    ok(jobs.length === 2, `★ [${style}] بطاقتان بالضبط، كلٌّ مرّةً واحدة`, String(jobs.length))
    const got = jobs.map((j) => j.bytes)
    ok(got.some((x) => x.equals(EXPECTED)) && got.some((x) => x.equals(EXPECTED_ONE)), `★★ [${style}] كلتاهما كاملة بالبايت`)
    ok(m.maxActive === 1, `[${style}] لم تُخدم إلا واحدةٌ بالوقت`)
    ok(Math.max(a.body.attempts, b.body.attempts) > 1, `[${style}] الثانية أُعيدت حين وجدتها مشغولة`, `${a.body.attempts}/${b.body.attempts}`)
  }
  {
    const m = track(await mockPrinter({ oneAtATime: 'unlisten', holdMs: 1000 }), mocks)
    const h = track(await startHelper(m.port), helpers)
    await guard(h, m.port); await sleep(100)
    const [a, b] = await Promise.all([h.print(IMAGES), h.print(ONE)])
    ok(a.status === 200 && b.status === 200 && m.jobs().length === 2, '★ طلبان متوازيان لوسيطٍ واحد ⇒ بطاقتان')
    ok(a.body.attempts === 1 && b.body.attempts === 1,
      '★ بالدور داخل الوسيط: لا اتصالين معاً، فلا رفض ولا إعادة', `${a.body.attempts}/${b.body.attempts}`)
  }

  // ═══ ٥) ترفض أوّل محاولتين ثمّ تقبل ═══
  console.log('\n── ٥) رفضٌ ثمّ قبول ⇒ مرّةٌ واحدة ──')
  {
    // ٣ إسقاطات: الأوّل يستهلكه فحص الحارس، فتصادف الطباعةُ إسقاطين ثمّ قبولاً
    const m = track(await mockPrinter({ dropFirst: 3 }), mocks)
    const h = track(await startHelper(m.port), helpers)
    const s = await guard(h, m.port)
    ok(s.printer_ready === false && /أغلقته قبل الإرسال/.test(s.printer_state), 'الفحص صادف إسقاطاً ⇒ «مشغولة غالباً»', s.printer_state)
    const r = await h.print(ONE)
    ok(r.status === 200 && r.body.attempts === 3, '★ إسقاطان قبل الكتابة (قبلت ثمّ أغلقت) ثمّ قبول ⇒ المحاولة الثالثة', JSON.stringify(r.body))
    ok(m.jobs().length === 1 && m.jobs()[0].bytes.equals(EXPECTED_ONE), '★★ وصلت مرّةً واحدة كاملة')
    ok(m.conns.filter((c) => c.dropped).every((c) => c.bytes.length === 0), 'المُسقَطة لم تستلم بايتاً واحداً')
  }
  {
    // رفضٌ حقيقيّ (ECONNREFUSED): لا مستمع أوّل ~٦٠٠ms، ثمّ تبدأ الاستماع
    const port = await freePort()
    const h = track(await startHelper(port), helpers)
    const pending = h.print(ONE)
    await sleep(600)
    const m = track(await mockPrinter({ port }), mocks)
    const r = await pending
    ok(r.status === 200 && r.body.attempts === 3, '★ ECONNREFUSED مرّتين ثمّ قبول ⇒ المحاولة الثالثة', JSON.stringify(r.body))
    ok(m.jobs().length === 1 && m.jobs()[0].bytes.equals(EXPECTED_ONE), '★★ وصلت مرّةً واحدة كاملة')
    ok(/إعادةٌ بعد 300ms/.test(h.out) && /إعادةٌ بعد 600ms/.test(h.out), 'السجلّ يذكر الإعادات وفواصلها')
  }

  // ═══ ٦) تُغلق بعد نصف البايتات ⇒ لا إعادة، و502 ═══
  console.log('\n── ٦) انقطاعٌ في منتصف البطاقة ──')
  {
    const m = track(await mockPrinter({ cutAt: Math.floor(EXPECTED.length / 2) }), mocks)
    const h = track(await startHelper(m.port), helpers)
    await guard(h, m.port)
    const r = await h.print(IMAGES)
    ok(r.status === 502, '★ 502', `${r.status} ${JSON.stringify(r.body)}`)
    ok(m.jobs().length === 1, '★★ اتصال طباعةٍ واحد — لا إعادة إرسال', String(m.jobs().length))
    ok(r.body.wrote === true && r.body.attempts === 1, 'wrote=true والمحاولة واحدة', JSON.stringify(r.body))
    ok(/انقطع الاتصال بالطابعة أثناء الطباعة/.test(r.body.error), 'الرسالة تطلب النظر للورقة قبل الإعادة', r.body.error)
    ok(m.jobs()[0].bytes.length < EXPECTED.length, 'الطابعة استلمت جزءاً فقط', `${m.jobs()[0].bytes.length}/${EXPECTED.length}`)
  }

  // ═══ ٧) /health خمس مرّات في ثانيتين ⇒ اتصال TCP واحد ═══
  console.log('\n── ٧) الفحص لا يزاحم الطابعة ──')
  {
    const m = track(await mockPrinter({ status: { 1: 0x12, 4: 0x12 } }), mocks)
    const h = track(await startHelper(m.port), helpers)
    const res = []
    for (let i = 0; i < 5; i++) { res.push(await h.health()); await sleep(400) }
    ok(m.conns.length === 1, '★ خمس طلبات /health ⇒ اتصالٌ واحد بالطابعة', String(m.conns.length))
    ok(new Set(res.map((s) => s.printer_checked_at)).size === 1, 'printer_checked_at نفسه في الخمس (نتيجةٌ مخزّنة)')
    // متزامنة تماماً أيضاً
    const m2 = track(await mockPrinter({ status: { 1: 0x12, 4: 0x12 } }), mocks)
    const h2 = track(await startHelper(m2.port), helpers)
    await Promise.all(Array.from({ length: 5 }, () => h2.health()))
    ok(m2.conns.length === 1, '★ خمس طلبات متزامنة ⇒ اتصالٌ واحد أيضاً', String(m2.conns.length))
    // وطباعةٌ جارية ⇒ لا اتصال فحص أصلاً
    const m3 = track(await mockPrinter({ holdMs: 1000 }), mocks)
    const h3 = track(await startHelper(m3.port), helpers)
    const printing = h3.print(ONE)
    await sleep(300)
    const during = await h3.health()
    ok(m3.probes().length === 0, '★ /health أثناء الطباعة لا يفتح اتصال فحص', `${m3.probes().length}`)
    ok(during.printer_ready === true && during.printer_checked_at === null, '  ويقول «تطبع الآن» بلا وقت فحص', during.printer_state)
    await printing
  }

  // ═══ ٨) طابعةٌ لا تُغلق طرفها بعد الاستلام ⇒ لا تعليق للطابور ═══
  console.log('\n── ٨) طابعةٌ تُبقي الاتصال مفتوحاً ──')
  {
    const m = track(await mockPrinter({ holdMs: 60000 }), mocks)
    const h = track(await startHelper(m.port), helpers)
    await guard(h, m.port)
    const t0 = Date.now()
    const [a, b] = await Promise.all([h.print(ONE), h.print(ONE)])
    const ms = Date.now() - t0
    ok(a.status === 200 && b.status === 200 && m.jobs().length === 2, 'البطاقتان طُبعتا')
    ok(m.jobs().every((j) => j.bytes.equals(EXPECTED_ONE)), '★★ كاملتين بالبايت رغم إغلاقنا نحن الاتصال')
    ok(ms < 5000, '★ لا ننتظر الطابعة إلى الأبد: ≈ ١٫٥ ثانية لكلّ بطاقة', `${ms}ms`)
  }
} finally {
  helpers.forEach((h) => h.kill())
  await Promise.all(mocks.map((m) => m.close()))
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${fails.length} فشلاً ═══`)
if (fails.length) { fails.forEach((f) => console.log(`  ✘ ${f}`)); process.exit(1) }
console.log('✔ وضع الشبكة: البايتات نفسها، إعادةٌ آمنة، وفحصٌ لا يزاحم الطباعة')
