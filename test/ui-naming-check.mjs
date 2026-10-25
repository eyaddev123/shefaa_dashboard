// ═══ «الدور» لا «طابور» في النصوص الظاهرة، وشارة رقم العيادة ═══
//   node test/ui-naming-check.mjs
// ١) لا «طابور» في أيّ نصٍّ يراه المستخدم: تُحذف التعليقات (// و/* */ و{/* */})
//    ثمّ يُبحث في الباقي. أسماء المتغيّرات والمسارات إنكليزية فلا تتأثّر.
// ٢) RoomBadge: «العيادة N» بالمصدر كما هو، و«بلا عيادة» تحذيرياً للفارغ.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const check = (label, ok, info = '') => {
  if (ok) { pass++; console.log(`  ✔ ${label}`) } else { fail++; console.log(`  ✘ ${label}${info ? `\n     ${info}` : ''}`) }
}

console.log('── ١) لا «طابور» في النصوص الظاهرة ──')
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|html)$/.test(f) ? [p] : []
})
// التعليقات وحدها تُحذف: «://» في رابطٍ ليس تعليقاً
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
const hits = []
for (const f of [...walk(join(root, 'src')), join(root, 'index.html')]) {
  stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (line.includes('طابور')) hits.push(`${f.slice(root.length + 1)}: ${line.trim()}`)
  })
}
check('لا نصّ ظاهر فيه «طابور»', hits.length === 0, hits.join('\n     '))

console.log('\n── ٢) شارة رقم العيادة ──')
// JSX → JS بـ esbuild (يأتي مع vite) ثمّ تُرسم بـ react-dom/server — بلا متصفّح
const require = createRequire(join(root, 'package.json'))
const { transformSync } = require('esbuild')
const { renderToStaticMarkup } = require('react-dom/server')
const React = require('react')
const tmp = mkdtempSync(join(tmpdir(), 'room-badge-'))
try {
  const { code } = transformSync(readFileSync(join(root, 'src/components/RoomBadge.jsx'), 'utf8'),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', format: 'cjs' })
  const file = join(tmp, 'RoomBadge.cjs')
  writeFileSync(file, code)
  global.React = React
  const RoomBadge = require(file).default
  const html = (props) => renderToStaticMarkup(React.createElement(RoomBadge, props))

  check('غرفة ٣ ⇒ «العيادة 3» خضراء', html({ room: '3' }) === '<span class="room-badge">العيادة 3</span>', html({ room: '3' }))
  check('الحجم الكبير في رأس الصفحة', html({ room: '3', size: 'lg' }).includes('class="room-badge lg"'))
  check('الرقم كما في المصدر (doctors.room) بلا تحويل', html({ room: '12' }).includes('12'))
  for (const v of [null, undefined, '', '   '])
    check(`بلا غرفة (${JSON.stringify(v)}) ⇒ «بلا عيادة» تحذيرية`,
      html({ room: v }).includes('class="room-badge none"') && html({ room: v }).includes('بلا عيادة'))
  check('الكبير بلا غرفة يبقى تحذيرياً', html({ room: null, size: 'lg' }).includes('class="room-badge lg none"'))
} finally { rmSync(tmp, { recursive: true, force: true }) }

console.log('\n── ٣) مواضع الشارة ──')
const sq = readFileSync(join(root, 'src/pages/SessionQueue.jsx'), 'utf8')
check('رأس صفحة الدور: الشارة الكبيرة بجانب الاسم، والرأس ثابت',
  /<h2 className="queue-head">دور \{data\.doctor_name\}<RoomBadge room=\{data\.room\} size="lg" \/>/.test(sq))
const cb = readFileSync(join(root, 'src/pages/ClinicBoard.jsx'), 'utf8')
check('لوحة العيادات: الشارة الصغيرة بجانب كل دكتور',
  cb.includes('{s.doctor_name}{rooms && <RoomBadge room={rooms[s.doctor_id]} />}'))

console.log(`\n═══ ${pass} ✔ · ${fail} ✘ ═══`)
process.exit(fail ? 1 : 0)
