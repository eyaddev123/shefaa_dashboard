import { chromium } from 'playwright'
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1600,height:1000}})
const errs=[]
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message))
p.on('console',m=>m.type()==='error'&&errs.push('console: '+m.text().slice(0,180)))

await p.goto('https://dashboard-shefaa.abukm.com/',{waitUntil:'networkidle'})
await p.fill('input:not([type=password])','admin')
await p.fill('input[type=password]', process.argv[2])
await p.click('button[type=submit]'); await p.waitForTimeout(4000)
await p.goto('https://dashboard-shefaa.abukm.com/users',{waitUntil:'networkidle'})
await p.waitForTimeout(3000)
const roleSel = p.locator('select').first()
try { await roleSel.selectOption({label:'عضو مجلس الإدارة'}) } catch { await roleSel.selectOption('board') }
await p.waitForTimeout(2000)
console.log('board-member form present:', await p.locator('input[name="new-board-member-name"]').count())
console.log('add button type:', await p.locator('button:has-text("إضافة عضو المجلس")').getAttribute('type'))
console.log('nested-form warning:', errs.filter(e=>e.includes('validateDOMNesting')).length)
console.log('errors:', errs.slice(0,3))
await b.close()
