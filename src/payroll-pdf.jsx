import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import StatementSheet from './components/payroll/StatementSheet.jsx'

// ═══ PDF كشوف الأجور — ملفٌّ ينزل مباشرةً (قرار المستخدم 2026-11-18، لا نافذة طباعة) ═══
// الورقة نفسها التي على الشاشة (StatementSheet) تُرسم خارج الشاشة بعرض A4، فتُصوَّر بـ html2canvas
// (النصّ العربيّ يُرسم بخطّ الصفحة وتشكيله كما يراه المتصفّح)، ثمّ تُقطَّع صفحاتٍ عند حدود data-unit
// — لا سطرٌ مقسومٌ بين صفحتين، ولا الحساب ولا مكان التوقيع. كلّ دكتور يبدأ صفحةً جديدة.
// هذه الوحدة تُحمَّل عند الضغط وحده (import() في الصفحة) فلا تثقل الحزمة الأساسيّة.

const PAGE_W = 794, PAGE_H = 1123            // A4 بنقاط CSS (96 dpi)
const MARGIN = 38                            // ≈ 1 سم
const CONTENT_W = PAGE_W - 2 * MARGIN
const CONTENT_H = PAGE_H - 2 * MARGIN - 18   // سطر رقم الصفحة أسفلها
const SAFE = 6                               // هامش أمانٍ لكلّ عمود (تقريب البكسلات وخطّ الجدول)

/**
 * توزيع قائمة المرضى على الصفحات بالارتفاع المقيس لا بعددٍ ثابت (إصلاح 2026-11-20: على الإنتاج التفّت أسماء
 * الإجراءات فطالت السطور، ففاضت كتلة الـ64 وبقيت الصفحة الأولى رأساً وحده). الورقة مرسومةٌ مرّةً بكلّ الزيارات
 * في العمود اليمين — العمودان بعرضٍ واحد فارتفاع السطر لا يتغيّر بينهما. كلّ صفحةٍ تُملأ: اليمين حتى آخره ثمّ
 * اليسار، والكتلة الأخيرة تُوزَّع بين العمودين بالتساوي (بالارتفاع).
 * @returns {[number, number][] | undefined} undefined = لا قائمة (لا زيارات)
 */
function measureLayout(sheet, top0) {
  const cols = sheet.querySelector('.pay-cols')
  const table = cols?.querySelector('table')
  if (!table) return undefined
  const rows = [...table.tBodies[0].rows].map((tr) => tr.getBoundingClientRect().height)
  const rowsSum = rows.reduce((a, b) => a + b, 0)
  const overhead = table.getBoundingClientRect().height - rowsSum          // رأس الجدول وإطاره
  const pad = cols.getBoundingClientRect().height - table.getBoundingClientRect().height
  const perCol = CONTENT_H - overhead - pad - SAFE
  const colsTop = cols.getBoundingClientRect().top - top0
  const h2 = cols.previousElementSibling
  const h2Top = h2 ? h2.getBoundingClientRect().top - top0 : colsTop
  // الصفحة الأولى: ما بقي تحت الرأس — وإن لم يتّسع لثلاثة أسطر نزل العنوان مع القائمة لصفحةٍ جديدة
  let first = perCol - colsTop
  if (first < 3 * Math.max(...rows)) first = perCol - (colsTop - h2Top)
  const fill = (from, room) => {   // كم سطراً يتّسع له عمودٌ يبدأ من from — سطرٌ واحدٌ على الأقلّ
    let h = 0, k = from
    while (k < rows.length && (k === from || h + rows[k] <= room)) h += rows[k++]
    return k - from
  }
  const out = []
  let at = 0
  while (at < rows.length) {
    const room = out.length ? perCol : first
    const r = fill(at, room)
    const l = fill(at + r, room)
    if (at + r + l >= rows.length) {   // آخر كتلة: تقسيمٌ متوازنٌ بالارتفاع يتّسع له العمودان
      const rest = rows.slice(at)
      let best = [r, rest.length - r], bestH = Infinity, acc = 0
      for (let i = 1; i <= rest.length; i++) {
        acc += rest[i - 1]
        const left = rest.slice(i).reduce((a, b) => a + b, 0)
        if (acc > room && i > 1) break
        if (left > room && i < rest.length) continue
        const h = Math.max(acc, left)
        if (h < bestH) { bestH = h; best = [i, rest.length - i] }
      }
      out.push(best)
      break
    }
    out.push([r, l])
    at += r + l
  }
  return out
}

/**
 * ورقةٌ مرسومة (خارج الشاشة بعرض CONTENT_W) ⇒ صفحات PDF مقطوعةٌ عند حدود data-unit، بترقيمٍ لكلّ ورقة.
 * مشتركة بين كشوف الأجور وتقرير «أرباح الشفاء من الأطباء» (2026-11-20).
 * @returns {Promise<boolean>} firstPage بعد الإضافة (false دائماً)
 */
async function addSheetPages(pdf, sheet, firstPage) {
  const k = pdf.internal.pageSize.getWidth() / PAGE_W   // نقطة PDF لكلّ px
  const top0 = sheet.getBoundingClientRect().top
  const total = Math.ceil(sheet.getBoundingClientRect().height)
  // حدود القطع: أوّل وحدةٍ لا تتّسع لها الصفحة الجارية تبدأ صفحةً جديدة
  // rowCut: القطع بين سطرين من جدولٍ واحد — خطّهما المشترك يُرسم أسفل الصفحة وأعلى التالية فيُغلق الجدول
  // (ملاحظة المستخدم 2026-11-20: «مقطوش قطش»)؛ وغير ذلك يقف قبل الوحدة التالية بنقطة فلا يشرد حدّها العلويّ
  const starts = [0], rowCut = [null]
  const left0 = sheet.getBoundingClientRect().left
  // عنوان قسمٍ أو رأس جدول لا يبقى وحده آخر الصفحة: ينزل مع أوّل سطرٍ بعده (2026-11-20)
  const units = [...sheet.querySelectorAll('[data-unit]')]
  const topOf = (el) => el.getBoundingClientRect().top - top0
  const sticky = (el) => el.tagName === 'H2' || (el.tagName === 'TR' && el.parentElement?.tagName === 'THEAD')
  let start = 0
  for (let k = 0; k < units.length; k++) {
    let u = units[k]
    const r = u.getBoundingClientRect()
    let t = r.top - top0
    const b = r.bottom - top0
    if (b - start > CONTENT_H && t > start) {
      let j = k
      while (j > 0 && sticky(units[j - 1]) && topOf(units[j - 1]) > start) j--
      if (j < k) { u = units[j]; t = topOf(u) }
      start = t; starts.push(t)
      // صفحةٌ تكمل جدولاً: خطّه الأعلى فوق خلايا السطر — يُرسم لأنّ الحدود المنفصلة بلا خطٍّ أعلى السطر،
      // ويتخطّى عمود الفراغ (pay-gap) في جدول الإجراءات المزدوج
      const cont = u.tagName === 'TR' && u.previousElementSibling?.tagName === 'TR'
      rowCut.push(cont ? [...u.children].filter((c) => !c.classList.contains('pay-gap'))
        .map((c) => { const q = c.getBoundingClientRect(); return { x: q.left - left0, w: q.width } }) : null)
    }
  }
  // الدقّة: ضعفان ما سمح أقصى طول لوحة الرسم (≈ 32 ألف بكسل)
  const scale = Math.min(2, 30000 / Math.max(total, 1))
  const canvas = await html2canvas(sheet, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true })
  starts.forEach((s, i) => {
    const last = i + 1 >= starts.length
    const end = last ? total : starts[i + 1] - 1
    const h = Math.max(1, end - s)
    const page = document.createElement('canvas')
    page.width = canvas.width
    page.height = Math.max(1, Math.floor(h * scale))
    const ctx = page.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.width, page.height)
    ctx.drawImage(canvas, 0, Math.floor(s * scale), canvas.width, page.height, 0, 0, canvas.width, page.height)
    if (rowCut[i]) {
      ctx.fillStyle = '#9aa1a7'
      for (const seg of rowCut[i]) ctx.fillRect(Math.round(seg.x * scale), 0, Math.ceil(seg.w * scale), Math.max(1, Math.round(scale)))
    }
    if (!firstPage) pdf.addPage()
    firstPage = false
    pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN * k, MARGIN * k, CONTENT_W * k, (page.height / scale) * k)
    pdf.setFontSize(8)
    pdf.setTextColor(120)
    pdf.text(`${i + 1} / ${starts.length}`, (PAGE_W / 2) * k, (PAGE_H - MARGIN / 2) * k, { align: 'center' })
  })
  return firstPage
}

/** ورقةٌ أو أوراق (عناصر React) ⇒ ملفّ PDF ينزل مباشرةً — كلّ ورقةٍ تبدأ صفحةً بترقيمها — للتقارير غير كشف الأجور */
export async function sheetPdf(elements, filename) {
  const host = document.createElement('div')
  host.className = 'pay-host'
  host.style.width = `${CONTENT_W}px`
  document.body.appendChild(host)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
  let firstPage = true
  try {
    if (document.fonts?.ready) await document.fonts.ready
    for (const element of Array.isArray(elements) ? elements : [elements]) {
      const box = document.createElement('div')
      host.appendChild(box)
      const root = createRoot(box)
      flushSync(() => root.render(element))
      firstPage = await addSheetPages(pdf, box.firstElementChild, firstPage)
      root.unmount()
      box.remove()
    }
    pdf.save(filename)
  } finally {
    host.remove()
  }
}

/** @param {object[]} statements كشوف /clinic/payroll/:id · @param {string} filename */
export async function statementsPdf(statements, filename, printedAt) {
  const host = document.createElement('div')
  host.className = 'pay-host'
  host.style.width = `${CONTENT_W}px`
  document.body.appendChild(host)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
  let firstPage = true
  try {
    if (document.fonts?.ready) await document.fonts.ready
    for (const st of statements) {
      const box = document.createElement('div')
      host.appendChild(box)
      const root = createRoot(box)
      // مرّتان: الأولى تقيس السطور (كلّها بالعمود اليمين)، والثانية بالتوزيع المحسوب
      flushSync(() => root.render(<StatementSheet st={st} printedAt={printedAt} layout={[[st.visits.length, 0]]} />))
      const layout = measureLayout(box.firstElementChild, box.firstElementChild.getBoundingClientRect().top)
      flushSync(() => root.render(<StatementSheet st={st} printedAt={printedAt} layout={layout} />))
      firstPage = await addSheetPages(pdf, box.firstElementChild, firstPage)
      root.unmount()
      box.remove()
    }
    pdf.save(filename)
  } finally {
    host.remove()
  }
}
