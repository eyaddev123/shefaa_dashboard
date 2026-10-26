// ═══ ترتيب القائمة الجانبية لكل دور ═══
//   node test/sidebar-order-check.mjs
// يقرأ <nav> من App.jsx كما هو، ويقيّم شرط كل رابط بدوال permissions.js الحقيقية،
// فيخرج لكل دورٍ ما يراه بترتيبه. والمطلوب:
//   مشرفة العيادات: لوحة القيادة، اللوحة اليومية، الدكاترة، الإجراءات، الإحالات، المخزون، الطابعة، الإعدادات
//   صفحات العيادات الثلاث متتالية لكل من يراها، واليوميّ قبل الإداري، والإعدادات أخيراً.
//   وما يراه كل دور لم يتغيّر (المجموعة نفسها قبل التعديل).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const perms = await import(pathToFileURL(join(root, 'src/permissions.js')))
let pass = 0, fail = 0
const check = (label, ok, info = '') => {
  if (ok) { pass++; console.log(`  ✔ ${label}`) } else { fail++; console.log(`  ✘ ${label}${info ? `\n     ${info}` : ''}`) }
}

const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const nav = /<nav>([\s\S]*?)<\/nav>/.exec(app)[1]
const links = []
for (const line of nav.split('\n')) {
  const m = /^\s*(?:\{(.+?) && )?<NavLink to="([^"]+)"[^>]*>\{I\.\w+\} ([^<]+)<\/NavLink>/.exec(line)
  if (m) links.push({ cond: m[1] || 'true', to: m[2], label: m[3].trim() })
}
const names = Object.keys(perms)
const visible = (role) => links.filter((l) => {
  // eslint-disable-next-line no-new-func
  const f = new Function('role', 'aid', ...names, `return (${l.cond})`)
  return f(role, perms.canReadAid(role), ...names.map((n) => perms[n]))
}).map((l) => l.label)

const ROLES = ['clinic_admin', 'clinic_reception', 'doctor', 'board', 'super_admin', 'manager', 'officer', 'accountant']
// ما كان كل دورٍ يراه قبل التعديل (مجموعةً لا ترتيباً) — الترتيب وحده تغيّر
const BEFORE = {
  clinic_admin: ['لوحة القيادة', 'العيادات — الدكاترة والدوام', 'العيادات — الإجراءات', 'المخزون',
    'العيادات — الإحالات', 'لوحة العيادات اليومية', 'إعداد الطابعة', 'الإعدادات'],
  clinic_reception: ['لوحة القيادة', 'لوحة العيادات اليومية', 'إعداد الطابعة'],
  doctor: ['لوحة القيادة', 'شاشتي'],
}

console.log('── مشرفة العيادات: الترتيب المطلوب حرفياً ──')
const admin = visible('clinic_admin')
const WANT = ['لوحة القيادة', 'لوحة العيادات اليومية', 'العيادات — الدكاترة والدوام', 'العيادات — الإجراءات',
  'العيادات — الإحالات', 'المخزون', 'إعداد الطابعة', 'الإعدادات']
check('★ الترتيب الثمانيّ كما طُلب', JSON.stringify(admin) === JSON.stringify(WANT), admin.join(' ← '))

console.log('\n── كل الأدوار ──')
for (const role of ROLES) {
  const v = visible(role)
  console.log(`   ${role}: ${v.join(' ← ')}`)
  if (BEFORE[role]) check(`${role}: المجموعة نفسها (لم يُضَف ولم يُحذف شيء)`,
    JSON.stringify([...v].sort()) === JSON.stringify([...BEFORE[role]].sort()), v.join('، '))
  const idx = (label) => v.indexOf(label)
  check(`${role}: لوحة القيادة أولاً`, v[0] === 'لوحة القيادة')
  const clinic = ['العيادات — الدكاترة والدوام', 'العيادات — الإجراءات', 'العيادات — الإحالات']
    .map(idx).filter((i) => i >= 0)
  if (clinic.length > 1)
    check(`${role}: صفحات العيادات متتالية`, clinic.every((x, k) => k === 0 || x === clinic[k - 1] + 1), String(clinic))
  if (idx('لوحة العيادات اليومية') >= 0 && clinic.length)
    check(`${role}: اللوحة اليومية قبل صفحات الإدارة`, idx('لوحة العيادات اليومية') < clinic[0])
  if (idx('الإعدادات') >= 0) check(`${role}: الإعدادات أخيراً`, v.at(-1) === 'الإعدادات')
  if (idx('إعداد الطابعة') >= 0 && clinic.length)
    check(`${role}: الطابعة بعد صفحات العيادات والمخزون`, idx('إعداد الطابعة') > Math.max(...clinic, idx('المخزون')))
}

console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass} نجح، ${fail} فشل`)
process.exit(fail === 0 ? 0 : 1)
