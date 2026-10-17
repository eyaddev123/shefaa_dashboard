// ═══════════════════════════════════════════════════════════════════
// فحص النداء الصوتي في متصفّح حقيقي — المقاطع المسجَّلة هي التي تُنطق
//
// يُشغَّل بـ: npm run test:audio   (يحتاج كروم playwright)
//
// لماذا متصفّح حقيقي لا اختبار وحدة: العطب الذي كشفه هذا الفحص كان **سباقاً**
// بين الجلب والتشغيل، وAudioContext وdecodeAudioData وfetch لا تُحاكى بصدق.
//
// ولماذا لا نكتفي بالتوقيت: نداءةٌ «مدّتها صحيحة» قد تكون قراءةً آلية بالكامل.
// فنقيس لكل مقطع: أنّ له بفراً، ومدّته > 0، وذروته > 0 (أي فيه صوت لا صمت)،
// وأنّ مصدره **بدأ** و**وصل onended** (أي لم يُقطع).
// ═══════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.AUDIO_TEST_PORT || 5231)
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
const failures = []
const ok = (cond, label) => {
  if (cond) { pass++; return true }
  failures.push(label)
  return false
}

// ═══ الحالات: الرقم ٤ في الغرفة ٢ (مقطع رقمٍ واحد)، و٢١ في الغرفة ١٠
// (آحاد + واصل + عشرات، وغرفة من رقمين — وهي التي كانت تُسكَت) ═══
const CASES = [
  { queue_number: 4, room: '2', expect: ['chime', 'number', 'four', 'go-to', 'room-2'] },
  { queue_number: 21, room: '10',
    expect: ['chime', 'number', 'one', 'and', 'twenty', 'go-to', 'room-10'] },
]

// صفحة الفحص: تستورد الوحدة الحقيقية وتلفّ playBuffer وspeechSynthesis
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><title>audio check</title></head>
<body><script type="module">
import { callAudio } from '/src/call-audio.js'
import { buildCallClips, roomClip, RECORDED_ROOMS } from '/src/audio-clips.js'

window.__ca = callAudio
window.__spoken = []
const synth = window.speechSynthesis
if (synth) {
  const orig = synth.speak.bind(synth)
  synth.speak = (u) => { window.__spoken.push(String(u.text || '')); return orig(u) }
}

window.__played = []
const origPlay = callAudio.playBuffer.bind(callAudio)
callAudio.playBuffer = function (name) {
  const buf = this.buffers.get(name)
  let peak = 0
  if (buf) {
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i += 13) { const a = Math.abs(d[i]); if (a > peak) peak = a }
  }
  const rec = { name, hasBuffer: !!buf, duration: buf ? buf.duration : 0,
                peak: peak, started: false, ended: false }
  window.__played.push(rec)
  if (!buf) return Promise.resolve()
  rec.started = true
  return origPlay(name).then(() => { rec.ended = true })
}

window.__run = async (card, opts) => {
  await callAudio.unlock()
  if (opts && opts.noPreload) {
    // يحاكي النداءة التي تسبق التحميل المسبق — السبب الأصلي للعطب
    callAudio.buffers.clear()
  } else {
    await callAudio.preload(RECORDED_ROOMS.map(roomClip))
  }
  callAudio.setSettings({ repeats: 1, gapMs: 0, volume: 0.9 })
  window.__played.length = 0
  window.__spoken.length = 0
  await callAudio.playCall(card)
  return { expected: buildCallClips(card), played: window.__played,
           spoken: window.__spoken.slice(), missing: callAudio.missingClips() }
}
</script></body></html>`

const run = async () => {
  // ── خادم Vite للتطوير: يخدم /src والمقاطع من public ──
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' })
  const stop = () => { try { vite.kill('SIGTERM') } catch { /* انتهى */ } }
  process.on('exit', stop)

  // انتظر إقلاعه فعلياً لا بمهلةٍ ثابتة
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false)
  }
  if (!up) { console.error('✖ لم يُقلع خادم Vite'); stop(); process.exit(1) }

  const { writeFile, unlink } = await import('node:fs/promises')
  const harnessPath = resolve(ROOT, 'public/__audio-check.html')
  await writeFile(harnessPath, HARNESS, 'utf8')

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  // كل طلب مقطع: الرمز والنوع — nginx يردّ index.html بـ 200 لمسارٍ غائب،
  // فالرمز وحده لا يكفي ويجب فحص Content-Type.
  const clipResponses = []
  page.on('response', (r) => {
    if (r.url().includes('/audio/calls/'))
      clipResponses.push({ url: r.url(), status: r.status(),
                           type: r.headers()['content-type'] || '' })
  })

  await page.goto(`${BASE}/__audio-check.html`, { waitUntil: 'load' })

  console.log('\n═══ فحص النداء الصوتي (متصفّح حقيقي) ═══\n')

  for (const c of CASES) {
    const label = `الرقم ${c.queue_number} / الغرفة ${c.room}`
    const r = await page.evaluate((card) => window.__run(card), c)

    console.log(`── ${label} ──`)
    ok(JSON.stringify(r.expected) === JSON.stringify(c.expect),
      `${label}: تركيب المقاطع = ${c.expect.join(' ')} (كان ${r.expected.join(' ')})`)

    // كل مقطعٍ كلاميّ (ما عدا النغمة المولَّدة) يجب أن يُشغَّل من التسجيل
    const speechClips = c.expect.filter((n) => n !== 'chime')
    for (const name of speechClips) {
      const rec = r.played.find((p) => p.name === name)
      if (!ok(rec, `${label}: المقطع «${name}» لم يُشغَّل إطلاقاً`)) continue
      ok(rec.hasBuffer, `${label}: «${name}» بلا بفر — لم يُفكّ ترميزه`)
      ok(rec.duration > 0.05, `${label}: «${name}» مدّته ${rec.duration.toFixed(3)}s ≤ 0.05`)
      ok(rec.peak > 0.01, `${label}: «${name}» ذروته ${rec.peak.toFixed(4)} — صامت`)
      ok(rec.started, `${label}: «${name}» لم يبدأ`)
      ok(rec.ended, `${label}: «${name}» لم يصل onended — قُطع قبل نهايته`)
    }

    // ═══ الشرط الذي كان مكسوراً: لا قراءة آلية والمقاطع كلّها حاضرة ═══
    ok(r.spoken.length === 0,
      `${label}: استُعمل الصوت الآلي والمقاطع كلّها موجودة — نطق: ${JSON.stringify(r.spoken)}`)
    ok(r.missing.length === 0, `${label}: مقاطع ناقصة: ${r.missing.join(', ')}`)

    const played = r.played.filter((p) => p.hasBuffer).map((p) => p.name)
    console.log(`   شُغّل: ${played.join(' → ')}`)
    console.log(`   آلي: ${r.spoken.length === 0 ? 'لا شيء ✔' : r.spoken.join(' | ')}\n`)
  }

  // ═══ نداءةٌ قبل التحميل المسبق: السباق الذي سبّب العطب ═══
  // playCall يجب أن يجلب وينتظر، فتُنطق الجملة من التسجيلات بلا صوت آلي.
  console.log('── نداءة قبل اكتمال التحميل المسبق (السباق) ──')
  const race = await page.evaluate(() => window.__run({ queue_number: 4, room: '2' },
    { noPreload: true }))
  const raceSpeech = ['number', 'four', 'go-to', 'room-2']
  for (const name of raceSpeech) {
    const rec = race.played.find((p) => p.name === name)
    ok(rec && rec.hasBuffer && rec.ended,
      `سباق: «${name}» لم يُشغَّل من التسجيل حتى نهايته — تخطّته النداءة`)
  }
  ok(race.spoken.length === 0,
    `سباق: استُعمل الصوت الآلي بدل التسجيلات — نطق: ${JSON.stringify(race.spoken)}`)
  console.log(`   شُغّل: ${race.played.filter((p) => p.hasBuffer).map((p) => p.name).join(' → ')}`)
  console.log(`   آلي: ${race.spoken.length === 0 ? 'لا شيء ✔' : race.spoken.join(' | ')}\n`)

  // ═══ الاحتياط الآلي يبقى عاملاً لمقطعٍ غائبٍ **فعلاً** ═══
  console.log('── مقطع غائب فعلاً: الاحتياط الآلي يرمّمه ──')
  const absent = await page.evaluate(async () => {
    const ca = window.__ca
    await ca.unlock()
    await ca.preload([])
    ca.setSettings({ repeats: 1, gapMs: 0, volume: 0.9 })
    // اجعل room-2 غائباً غياباً مثبَّتاً (كأنّ ملفّه غير مسجَّل بعد)
    ca.buffers.delete('room-2')
    ca.missing.add('room-2')
    window.__played.length = 0
    window.__spoken.length = 0
    await ca.playCall({ queue_number: 4, room: '2' })
    ca.missing.delete('room-2')
    return { played: window.__played.slice(), spoken: window.__spoken.slice() }
  })
  ok(absent.played.some((p) => p.name === 'number' && p.ended),
    'غياب: التسجيلات الحاضرة يجب أن تبقى تُشغَّل')
  ok(absent.spoken.length > 0, 'غياب: المقطع الغائب لم يُقرأ آلياً — ضاع من الجملة')
  ok(!absent.spoken.some((t) => t.includes('الرقم') && t.includes('يرجى')),
    `غياب: قُرئت الجملة كاملةً فوق التسجيلات (صوتان) — نطق: ${JSON.stringify(absent.spoken)}`)
  console.log(`   آلي (الناقص وحده): ${absent.spoken.join(' | ')}\n`)

  // ═══ كل طلبات المقاطع: نوعٌ صوتيّ حقيقي لا index.html ═══
  console.log('── طلبات المقاطع ──')
  // chime.mp3 غائبٌ **عمداً** — النغمة تُركَّب بـ Web Audio (انظر SYNTHESIZED_CLIPS).
  // فاستثناؤه هنا مقصود، وأيّ مقطعٍ آخر يُردّ بـ HTML هو عطبٌ حقيقي.
  const realClips = clipResponses.filter((r) => !r.url.includes('/chime.mp3'))
  const served = realClips.filter((r) => r.status === 200)
  const htmlServed = served.filter((r) => !/audio|octet-stream/i.test(r.type))
  ok(served.length === realClips.length,
    `مقاطع لم تُخدَم بـ200: ${realClips.filter((r) => r.status !== 200)
      .map((r) => `${r.url.split('/').pop()}→${r.status}`).join(', ')}`)
  ok(htmlServed.length === 0,
    `مقاطع رُدّت بنوع غير صوتي (nginx يردّ index.html بـ200): ${
      htmlServed.map((r) => `${r.url.split('/').pop()}→${r.type}`).join(', ')}`)
  const versioned = clipResponses.filter((r) => r.url.includes('?v='))
  ok(versioned.length === clipResponses.length,
    `طلبات بلا ?v=: ${clipResponses.filter((r) => !r.url.includes('?v=')).length}`)
  console.log(`   ${clipResponses.length} طلباً (${realClips.length} مقطعاً حقيقياً)، `
    + `${served.length} بـ200، كلّها بـ?v= ونوعٍ صوتي`)

  ok(pageErrors.length === 0, `أخطاء صفحة: ${pageErrors.join(' | ')}`)

  await browser.close()
  await unlink(harnessPath).catch(() => {})
  stop()

  console.log(`\n═══ ${pass} تحقّقاً ناجحاً، ${failures.length} فشلاً ═══`)
  if (failures.length) {
    failures.forEach((f) => console.error(`  ✖ ${f}`))
    process.exit(1)
  }
  console.log('✔ النداء يُنطق من التسجيلات، والصوت الآلي للناقص وحده\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
