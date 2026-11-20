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

/** @param {object[]} statements كشوف /clinic/payroll/:id · @param {string} filename */
export async function statementsPdf(statements, filename, printedAt) {
  const host = document.createElement('div')
  host.className = 'pay-host'
  host.style.width = `${CONTENT_W}px`
  document.body.appendChild(host)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
  const k = pdf.internal.pageSize.getWidth() / PAGE_W   // نقطة PDF لكلّ px
  let firstPage = true
  try {
    if (document.fonts?.ready) await document.fonts.ready
    for (const st of statements) {
      const box = document.createElement('div')
      host.appendChild(box)
      const root = createRoot(box)
      flushSync(() => root.render(<StatementSheet st={st} printedAt={printedAt} />))
      const sheet = box.firstElementChild
      const top0 = sheet.getBoundingClientRect().top
      const total = Math.ceil(sheet.getBoundingClientRect().height)
      // حدود القطع: أوّل وحدةٍ لا تتّسع لها الصفحة الجارية تبدأ صفحةً جديدة
      // rowCut: القطع بين سطرين من جدولٍ واحد — خطّهما المشترك يُرسم أسفل الصفحة وأعلى التالية فيُغلق الجدول
      // (ملاحظة المستخدم 2026-11-20: «مقطوش قطش»)؛ وغير ذلك يقف قبل الوحدة التالية بنقطة فلا يشرد حدّها العلويّ
      const starts = [0], rowCut = [null]
      const left0 = sheet.getBoundingClientRect().left
      let start = 0
      for (const u of sheet.querySelectorAll('[data-unit]')) {
        const r = u.getBoundingClientRect()
        const t = r.top - top0, b = r.bottom - top0
        if (b - start > CONTENT_H && t > start) {
          start = t; starts.push(t)
          // صفحةٌ تكمل جدولاً: مكان خطّه الأعلى (عرض الجدول) — يُرسم لأنّ الحدود المنفصلة بلا خطٍّ أعلى السطر
          const tbl = u.tagName === 'TR' && u.previousElementSibling?.tagName === 'TR' ? u.closest('table')?.getBoundingClientRect() : null
          rowCut.push(tbl ? { x: tbl.left - left0, w: tbl.width } : null)
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
        if (rowCut[i]) { ctx.fillStyle = '#c8cdd2'; ctx.fillRect(Math.round(rowCut[i].x * scale), 0, Math.round(rowCut[i].w * scale), Math.max(1, Math.round(scale))) }
        if (!firstPage) pdf.addPage()
        firstPage = false
        pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN * k, MARGIN * k, CONTENT_W * k, (page.height / scale) * k)
        pdf.setFontSize(8)
        pdf.setTextColor(120)
        pdf.text(`${i + 1} / ${starts.length}`, (PAGE_W / 2) * k, (PAGE_H - MARGIN / 2) * k, { align: 'center' })
      })
      root.unmount()
      box.remove()
    }
    pdf.save(filename)
  } finally {
    host.remove()
  }
}
