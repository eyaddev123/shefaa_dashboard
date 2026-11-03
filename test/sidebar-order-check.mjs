// ═══ القائمة الجانبية لكل دور: قسمان بعنوانين ═══
//   node test/sidebar-order-check.mjs
// يقرأ <nav> من App.jsx كما هو — الروابط وعناوين الأقسام والفاصل — ويقيّم شرط كلّ سطرٍ بدوال
// permissions.js الحقيقية، فيخرج لكل دورٍ ما يراه بترتيبه. والمطلوب:
//   «طلبات المساعدة»: صفحات المساعدات كلّها (الطلبات … الخزينة والإيرادات، الأسعار الطبية، المطابقة)
//   «العيادات»: اللوحة اليومية، الدكاترة والدوام، الإجراءات والمستحقات، المخزون، صندوق العيادات،
//                تقارير الدكاترة (+ شاشتي/أعمالي للطبيب، الإحالات والطابعة للمشرفة)
//   كلّ رابطٍ تحت عنوان قسمه، ولا عنوانٌ بلا روابط، وكلّ دورٍ يرى ما له وحده.
//   المدير (اطّلاع) والمشرف العام: كلّ صفحات العيادات المذكورة أعلاه ومعها الإحالات. والمجلس لا يرى
//   الإحالات ولا تقارير الدكاترة (قرار المستخدم 2026-11-03).
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
const items = []
for (const line of nav.split('\n')) {
  let m = /^\s*(?:\{(.+?) && )?<NavLink to="([^"]+)"[^>]*>\{I\.\w+\} ([^<]+)<\/NavLink>/.exec(line)
  if (m) { items.push({ kind: 'link', cond: m[1] || 'true', to: m[2], label: m[3].trim() }); continue }
  m = /^\s*\{(.+?) && <div className="nav-section">([^<]+)<\/div>\}/.exec(line)
  if (m) { items.push({ kind: 'section', cond: m[1], label: m[2].trim() }); continue }
  m = /^\s*\{(.+?) && <div className="nav-sep" \/>\}/.exec(line)
  if (m) items.push({ kind: 'sep', cond: m[1], label: '—' })
}
const names = Object.keys(perms)
const visible = (role) => items.filter((l) => {
  // eslint-disable-next-line no-new-func
  const f = new Function('role', 'aid', ...names, `return (${l.cond})`)
  return f(role, perms.canReadAid(role), ...names.map((n) => perms[n]))
})

const SECTION_OF = (to) => to === '/' ? null
  : to.startsWith('/clinic/') || to === '/inventory' ? 'العيادات'
  : ['/users', '/settings'].includes(to) ? 'عام' : 'طلبات المساعدة'

const ROLES = ['clinic_admin', 'clinic_reception', 'doctor', 'board', 'super_admin', 'manager', 'officer', 'accountant']
const AID = ['الطلبات', 'العائلات (الملفات)', 'مراجعة البيانات', 'سندات الصرف', 'الخزينة والإيرادات', 'الأسعار الطبية']
const CLINIC_ALL = ['اللوحة اليومية', 'الدكاترة والدوام', 'الإجراءات والمستحقات', 'الإحالات', 'المخزون', 'صندوق العيادات',
  'تقارير الدكاترة']
// المطلوب لكلّ دورٍ حرفياً (بالترتيب، والعناوين بين [ ]). ما يراه كلّ دور هو ما كان يراه قبل
// القسمين — بأسماءٍ أقصر تحت العنوان — زائداً «تقارير الدكاترة» لمن يرى حسابات الدكاترة.
const WANT = {
  clinic_admin: ['لوحة القيادة', '[العيادات]', 'اللوحة اليومية', 'الدكاترة والدوام', 'الإجراءات والمستحقات', 'الإحالات',
    'المخزون', 'صندوق العيادات', 'تقارير الدكاترة', 'إعداد الطابعة', '—', 'الإعدادات'],
  clinic_reception: ['لوحة القيادة', '[العيادات]', 'اللوحة اليومية', 'إعداد الطابعة'],
  doctor: ['لوحة القيادة', '[العيادات]', 'شاشتي', 'أعمالي'],
  manager: ['لوحة القيادة', '[طلبات المساعدة]', ...AID, '[العيادات]', ...CLINIC_ALL, '—', 'الإعدادات'],
  super_admin: ['لوحة القيادة', '[طلبات المساعدة]', ...AID, '[العيادات]', ...CLINIC_ALL, '—', 'الموظفون والصلاحيات', 'الإعدادات'],
  board: ['لوحة القيادة', '[طلبات المساعدة]', ...AID, '[العيادات]', 'اللوحة اليومية', 'الدكاترة والدوام', 'الإجراءات',
    'المخزون', '—', 'الإعدادات'],
  officer: ['لوحة القيادة', '[طلبات المساعدة]', ...AID, 'مطابقة الأمين'],
  accountant: ['لوحة القيادة', '[طلبات المساعدة]', ...AID, 'مطابقة الأمين'],
}
const show = (v) => v.map((x) => (x.kind === 'section' ? `[${x.label}]` : x.label))

for (const role of ROLES) {
  console.log(`\n── ${role} ──`)
  const v = visible(role)
  const s = show(v)
  console.log(`   ${s.join(' ← ')}`)
  check(`${role}: القائمة كما طُلبت حرفياً`, JSON.stringify(s) === JSON.stringify(WANT[role]), s.join(' ← '))
  // كلّ رابطٍ تحت عنوان قسمه، والعامّ بعد الفاصل
  let cur = null, ok = true, bad = ''
  for (const x of v) {
    if (x.kind === 'section') cur = x.label
    else if (x.kind === 'sep') cur = 'عام'
    else if (SECTION_OF(x.to) !== cur) { ok = false; bad = `${x.label} تحت ${cur}` }
  }
  check(`${role}: كلّ رابطٍ تحت عنوان قسمه`, ok, bad)
  const empty = v.filter((x, i) => x.kind !== 'link' && (i === v.length - 1 || v[i + 1].kind !== 'link'))
  check(`${role}: لا عنوان ولا فاصل بلا روابط تحته`, empty.length === 0, show(empty).join('، '))
}

console.log('\n── المدير المسؤول (manager) ──')
const mgr = show(visible('manager'))
check('★ المدير يرى كلّ صفحات العيادات: اللوحة اليومية، الدكاترة والدوام، الإجراءات والمستحقات، الإحالات، المخزون، صندوق العيادات، تقارير الدكاترة',
  CLINIC_ALL.every((l) => mgr.includes(l)), mgr.join('، '))
check('★ تقارير الدكاترة والإحالات لا تظهر للطبيب ولا للاستقبال ولا للمجلس',
  ['doctor', 'clinic_reception', 'board'].every((r) => !['تقارير الدكاترة', 'الإحالات'].some((l) => show(visible(r)).includes(l))))

console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass} نجح، ${fail} فشل`)
process.exit(fail === 0 ? 0 : 1)
