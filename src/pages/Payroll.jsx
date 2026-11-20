import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtMoney, fmtDay } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { PeriodBar } from './DoctorAccounts.jsx'
import ProcedureEarnings from './ProcedureEarnings.jsx'
import { matchesAr } from '../arabic-search.js'
import { procSummary } from '../components/payroll/proc-summary.js'

// ═══ الرواتب والأجور (طلب المستخدم 2026-11-18) ═══
// «صفحة مالية مخصّصة: رواتب الدكتور وأجوره وأجوره من الإجراءات» — و«المستحقات» خرجت من صفحة الإجراءات
// إليها (تبويب «تفصيل الإجراءات» بأدواته: بانتظار المحاسبة، تصحيح المواد، التنبيهات).
// «كشوف الأجور»: الفترة (شهرٌ افتراضاً، أو من–إلى) ⇒ الدكاترة بمستحقّهم ⇒ كشف الدكتور: كلّ مرضاه بالتاريخ
// والاسم الثلاثي ونوع الزيارة وإجراءاتها، ودوامه بالساعات، والحساب، ومكان استلامٍ وتوقيعٍ بخطّ اليد —
// إكسل وPDF (ملفٌّ ينزل مباشرةً) للطباعة والتوقيع. الأرقام من حساب «تقارير الدكاترة» نفسه (الخادم).
// قراءةٌ وحدها: لا تسجيل «استلم» (قرار المستخدم: ورقةٌ تُوقَّع).

const TABS = [['statements', 'كشوف الأجور'], ['procedures', 'تفصيل الإجراءات']]
// «يوم» كـ«تقارير الدكاترة» (طلب المستخدم 2026-11-18: «بدي يوم وشهر وفترة») — اليوم = من اليوم إلى اليوم نفسه
const MODES = [['day', 'يوم'], ['month', 'شهر'], ['custom', 'فترة']]   // الترتيب بطلب المستخدم: يوم ثمّ شهر ثمّ فترة
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')
const n = (v) => Number(v || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const stamp = () => {
  const d = new Date()
  return `${fmtDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const activityOf = (d) => (d.due ?? 0) > 0 || d.patients > 0 || d.procedures > 0 || d.attendance.days > 0 || d.ironCount > 0

async function downloadPdf(statements, filename, setBusy, showToast) {
  setBusy(true)
  try {
    // المكتبتان (jspdf وhtml2canvas) تُحمَّلان هنا وحدهما
    const { statementsPdf } = await import('../payroll-pdf.jsx')
    await statementsPdf(statements, filename, stamp())
  } catch (ex) { showToast(`تعذّر إنشاء الـ PDF: ${ex.message}`) } finally { setBusy(false) }
}

function usePeriod() {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : null
  const from = isDay(params.get('from')) ? params.get('from') : null
  const to = isDay(params.get('to')) ? params.get('to') : from
  const day = isDay(params.get('day')) ? params.get('day') : null
  const mode = from ? 'custom' : day ? 'day' : 'month'
  const query = mode === 'custom' ? { from, to } : mode === 'day' ? { from: day, to: day } : { month }
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const k of ['month', 'from', 'to', 'day']) next.delete(k)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v)
    setParams(next, { replace: true })
  }
  return { params, setParams, mode, month, day, from, to, query, set }
}

// ═══ الكشف في الصفحة: بطاقاتٌ وجداول بسمة النظام (لا ورقة A4 مرسومة — طلب المستخدم 2026-11-18:
// «بدي يعرضلي إياه جداول عادية بنفس ثيم المشروع»). الورقة البيضاء بمكان التوقيع للـ PDF وحده.
// جدول المرضى واحدٌ بالتاريخ (قراره)، وعلى الجوال كلّ سطرٍ بطاقة (table.rtable).
const dayOf = (d) => fmtDay(`${d}T12:00:00Z`, { utc: true })
function StatementBody({ st }) {
  const d = st.doctor, c = st.counts
  const ps = procSummary(st.visits)
  const rounded = st.payable !== null && st.payable !== undefined && d.due !== null && st.payable !== d.due
  return (
    <>
      <div className="dr-summary pr-stats">
        <div className="dr-stat">
          <span className="dr-stat-lbl">المستحقّ للطبيب</span>
          <strong className="dr-stat-val">{st.payable === null || st.payable === undefined ? '—' : fmtMoney(st.payable)}</strong>
          <span className="dr-stat-sub">{rounded ? `قبل التقريب لأقرب 5: ${fmtMoney(d.due)}` : (st.payKindLabel || 'بلا طريقة حساب')}</span>
        </div>
        <div className="dr-stat">
          <span className="dr-stat-lbl">الدوام</span>
          <strong className="dr-stat-val">{n(d.attendance.days)} يوم</strong>
          <span className="dr-stat-sub">{d.attendance.minutes ? `${hm(d.attendance.minutes)} ساعة` : 'لا ساعات مسجّلة'}</span>
        </div>
        <div className="dr-stat">
          <span className="dr-stat-lbl">المرضى</span>
          <strong className="dr-stat-val">{n(c.visits)}</strong>
          <span className="dr-stat-sub">معاينة {n(c.consultation)} · مراجعة {n(c.followup)}{c.procedureOnly ? ` · إجراء فقط ${n(c.procedureOnly)}` : ''}</span>
        </div>
        <div className="dr-stat">
          <span className="dr-stat-lbl">من الإجراءات</span>
          <strong className="dr-stat-val">{fmtMoney(d.procDoctor)}</strong>
          <span className="dr-stat-sub">{n(c.procedures)} إجراء{d.ironCount ? ` · خدمات ${fmtMoney(d.ironDoctor)}` : ''}</span>
        </div>
      </div>

      <section className="card pr-section">
        <h3>الحساب</h3>
        <dl className="pcx-facts">
          {st.payLines.map((l, i) => <div key={i}><dt>{l.label}</dt><dd>{fmtMoney(l.amount)}</dd></div>)}
          {rounded && <div className="pr-calc-sub"><dt>المجموع قبل التقريب</dt><dd>{fmtMoney(d.due)}</dd></div>}
          <div className="pr-calc-total"><dt>المستحقّ للطبيب</dt><dd>{st.payable === null || st.payable === undefined ? '—' : fmtMoney(st.payable)}</dd></div>
        </dl>
      </section>

      <section className="card pr-section">
        <h3>المرضى ({n(c.visits)})</h3>
        {st.visits.length === 0 ? <p className="empty">لا زيارات في هذه الفترة.</p> : (
          <table className="rtable pr-table">
            <thead><tr><th>التاريخ</th><th>المريض</th><th>الزيارة</th><th>الإجراءات</th><th className="num">للطبيب</th></tr></thead>
            <tbody>
              {st.visits.map((v) => (
                <tr key={v.id}>
                  <td data-label="التاريخ" className="pr-nowrap">{dayOf(v.date)}</td>
                  <td className="rt-title">{v.patient}</td>
                  <td data-label="الزيارة">{v.visitType}{!v.inRange && <span className="muted"> (قبل الفترة)</span>}</td>
                  <td data-label="الإجراءات">{v.procedures.length === 0 ? <span className="muted">—</span> : v.procedures.map((p, k) => (
                    <span key={k} className={p.paid ? undefined : 'muted'}>{k > 0 && '، '}{p.name}{!p.paid && ' (بانتظار المحاسبة)'}</span>))}</td>
                  <td data-label="للطبيب" className="num">{v.procShare ? fmtMoney(v.procShare) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {ps.rows.length > 0 && (
        <section className="card pr-section">
          <h3>حصّة الطبيب من الإجراءات</h3>
          {/* جدولٌ عاديّ حتى على الجوال (لا بطاقات rtable): أربعة أعمدة قصيرة تتّسع، والعين تقرأ العدد × الحصّة سطراً */}
          <table className="pr-table pr-proc-sum">
            <thead><tr><th>الإجراء</th><th className="num">العدد</th><th className="num">حصّة الواحد</th><th className="num">المجموع</th></tr></thead>
            <tbody>
              {ps.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td className="num">{n(r.count)}</td>
                  <td className="num">{fmtMoney(r.share)}</td>
                  <td className="num">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="pr-sum-row">
              <td colSpan={3}>المجموع ({n(ps.kinds)} {ps.kinds === 1 ? 'نوع' : 'أنواع'} · {n(ps.count)} إجراء)</td>
              <td className="num">{fmtMoney(ps.total)}</td>
            </tr></tfoot>
          </table>
        </section>
      )}

      {st.shifts.length > 0 && (
        <section className="card pr-section">
          <h3>أيام الدوام ({n(d.attendance.days)})</h3>
          <table className="rtable pr-table">
            <thead><tr><th>التاريخ</th><th>الوصول</th><th>الانصراف</th><th className="num">الساعات</th></tr></thead>
            <tbody>
              {st.shifts.map((x, i) => (
                <tr key={i}>
                  <td className="rt-title">{dayOf(x.date)}</td>
                  <td data-label="الوصول">{x.arrived}</td>
                  <td data-label="الانصراف">{x.departed || <span className="muted">لم يُسجَّل</span>}</td>
                  <td data-label="الساعات" className="num">{x.minutes === null ? '—' : hm(x.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {st.iron.length > 0 && (
        <section className="card pr-section">
          <h3>خدمات العيادة ({n(st.iron.length)})</h3>
          <table className="rtable pr-table">
            <thead><tr><th>التاريخ</th><th>المريض</th><th>الجلسة</th><th className="num">للطبيب</th></tr></thead>
            <tbody>
              {st.iron.map((x, i) => (
                <tr key={i}>
                  <td data-label="التاريخ" className="pr-nowrap">{dayOf(x.date)}</td>
                  <td className="rt-title">{x.patient}</td>
                  <td data-label="الجلسة">{x.service || 'حديد'}{x.serviceDual === false ? '' : x.withDrug ? ' — مع الدواء' : ' — بلا دواء'}</td>
                  <td data-label="للطبيب" className="num">{fmtMoney(x.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function StatementView({ doctorId, query, onBack, showToast }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(query)
  useEffect(() => {
    let live = true
    setSt(null); setErr(null)
    api.clinic.payrollStatement(doctorId, query).then((r) => live && setSt(r)).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [doctorId, key])
  if (err) return <p className="error">{err}</p>
  if (!st) return <p className="empty">جارٍ تحميل الكشف…</p>
  const d = st.doctor
  const base = `كشف-أجور-${d.doctor}-${st.from}_${st.to}`
  return (
    <div className="pr-statement">
      <div className="pr-toolbar">
        <button type="button" className="ghost" onClick={onBack}>→ كلّ الدكاترة</button>
        <div className="pr-toolbar-end">
          <button type="button" className="ghost" disabled={busy}
            onClick={() => api.clinic.exportPayroll(query, doctorId).catch((e) => showToast(e.message))}>Excel</button>
          <button type="button" disabled={busy} onClick={() => downloadPdf([st], `${base}.pdf`, setBusy, showToast)}>
            {busy ? 'جارٍ إنشاء الـ PDF…' : 'تنزيل PDF'}</button>
        </div>
      </div>
      {/* اسم الدكتور والفترة رأس الكشف (ملاحظة المستخدم 2026-11-20: «طالع لي اسمه… مشان اعرف بأي دكتور وقت اعمل تحميل») */}
      <div className="pr-doc-head">
        <h3>{d.doctor}</h3>
        <span className="pr-doc-meta">{d.specialty ? `${d.specialty} · ` : ''}كشف الفترة من <bdi>{fmtDay(`${st.from}T12:00:00Z`, { utc: true })}</bdi> إلى <bdi>{fmtDay(`${st.to}T12:00:00Z`, { utc: true })}</bdi></span>
      </div>
      {/* قبل التسليم: ما يجعل الرقم ناقصاً — على الشاشة وحدها، والورقة تذكره سطراً */}
      {(st.warnings.noPay || st.warnings.pendingProcedures > 0 || st.warnings.noDeparture > 0) && (
        <div className="warn-box pr-warn" role="note">
          <strong>قبل التسليم:</strong>
          <ul>
            {st.warnings.noPay && <li>لم تُضبط طريقة حساب هذا الدكتور — الراتب صفر. <Link to={`/clinic/doctors/${d.doctorId}#pf-pay`}>اضبطها من بروفايله</Link></li>}
            {st.warnings.pendingProcedures > 0 && <li>{n(st.warnings.pendingProcedures)} إجراء بانتظار المحاسبة لا يدخل المجموع. <Link to="/clinic/payroll?tab=procedures">راجعها في «تفصيل الإجراءات»</Link></li>}
            {st.warnings.noDeparture > 0 && <li>{n(st.warnings.noDeparture)} يوم بلا انصراف مسجَّل — ساعاته لا تُحسب. سجّلوا الانصراف من اللوحة اليومية.</li>}
          </ul>
        </div>
      )}
      <StatementBody st={st} />
    </div>
  )
}

function StatementsTab({ showToast }) {
  const { params, setParams, mode, month, day, from, to, query, set } = usePeriod()
  const doctorId = /^\d+$/.test(params.get('doctor') || '') ? params.get('doctor') : null
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showIdle, setShowIdle] = useState(false)
  // البحث بالاسم أو الاختصاص («ال» والهمزات لا تفرق — matchesAr)، والترتيب (طلب المستخدم 2026-11-18)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('due')
  const key = JSON.stringify(query)
  useEffect(() => {
    let live = true
    setErr(null)
    api.clinic.payroll(query).then((r) => live && setData(r)).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [key])
  const openDoctor = (id) => {
    const next = new URLSearchParams(params)
    if (id) next.set('doctor', id); else next.delete('doctor')
    setParams(next)
  }
  const { active, idle, shown } = useMemo(() => {
    const ds = data?.doctors || []
    const act = ds.filter(activityOf).sort(sort === 'name'
      ? (a, b) => a.doctor.localeCompare(b.doctor, 'ar')
      : (a, b) => (b.payable ?? b.due ?? 0) - (a.payable ?? a.due ?? 0) || a.doctor.localeCompare(b.doctor, 'ar'))
    const needle = q.trim()
    return { active: act, idle: ds.filter((d) => !activityOf(d)),
      shown: needle ? act.filter((d) => matchesAr(d.doctor, needle) || matchesAr(d.specialty || '', needle)) : act }
  }, [data, q, sort])
  const period = data ? (data.from === data.to ? fmtDay(`${data.from}T12:00:00Z`, { utc: true })
    : `من ${fmtDay(`${data.from}T12:00:00Z`, { utc: true })} إلى ${fmtDay(`${data.to}T12:00:00Z`, { utc: true })}`) : ''
  const allPdf = async () => {
    setBusy(true)
    try {
      const r = await api.clinic.payrollStatements(query)
      if (!r.statements.length) { showToast('لا نشاط لأيّ دكتور في هذه الفترة'); setBusy(false); return }
      await downloadPdf(r.statements, `كشوف-الأجور-${r.from}_${r.to}.pdf`, setBusy, showToast)
    } catch (ex) { showToast(ex.message); setBusy(false) }
  }

  return (
    <>
      {/* كشريط «تقارير الدكاترة»: مسافةٌ عن خطّ التبويبات وعمّا تحته (طلب المستخدم 2026-11-18) */}
      <div className="pr-period">
        <PeriodBar mode={mode} cur={data?.month || month} curDay={day} from={from || data?.from} to={to || data?.to} data={data}
          set={(p) => set(p)} modes={MODES} />
      </div>
      {doctorId ? (
        <StatementView doctorId={doctorId} query={query} onBack={() => openDoctor(null)} showToast={showToast} />
      ) : err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          {/* المجموع سطرٌ واحد نحيف، والأزرار على السطر نفسه */}
          <div className="pr-summary">
            <div className="pr-sum-text">
              <span>المستحقّ لكلّ الدكاترة</span>
              <strong>{fmtMoney(data.totals.payable ?? data.totals.due)}</strong>
              <em>{n(active.length)} {active.length === 1 ? 'دكتور' : 'دكاترة'} · {period}</em>
            </div>
            <div className="pr-toolbar-end">
              <button type="button" className="ghost" disabled={busy || !active.length}
                onClick={() => api.clinic.exportPayroll(query).catch((e) => showToast(e.message))}>Excel للكلّ</button>
              <button type="button" disabled={busy || !active.length} onClick={allPdf}>
                {busy ? 'جارٍ إنشاء الـ PDF…' : 'PDF للكلّ'}</button>
            </div>
          </div>
          {data.noPay > 0 && <p className="pr-note">{n(data.noPay)} من الدكاترة بلا طريقة حساب — راتبهم صفر حتى تُضبط من البروفايل.</p>}
          {active.length === 0 ? <p className="empty">لا نشاط لأيّ دكتور في هذه الفترة.</p> : (
            <>
              <div className="pr-bar">
                <input type="search" className="pr-search" value={q} placeholder="ابحث عن دكتور بالاسم أو الاختصاص"
                  aria-label="بحث عن دكتور" onChange={(e) => setQ(e.target.value)} />
                <div className="pcx-sort" role="group" aria-label="الترتيب">
                  {[['due', 'الأعلى مستحقاً'], ['name', 'أبجدياً']].map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={sort === k} className={`rev-flag${sort === k ? ' is-on' : ''}`}
                      onClick={() => setSort(k)}>{label}</button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? <p className="empty">لا دكتور يطابق «{q.trim()}».</p> : (
                // جدول مرتّب (قرار المستخدم): سطرٌ لكلّ دكتور، والسطر كلّه يفتح الكشف؛ على الجوال كلّ سطرٍ بطاقة
                <table className="rtable pr-doctors">
                  <thead><tr><th>الطبيب</th><th>الدوام</th><th className="num">المرضى</th><th className="num">الإجراءات</th><th className="num">المستحقّ</th><th aria-hidden="true" /></tr></thead>
                  <tbody>
                    {shown.map((d) => (
                      <tr key={d.doctorId} className="pr-row" onClick={() => openDoctor(d.doctorId)}>
                        <td className="rt-title">
                          <button type="button" className="pr-row-name" onClick={(e) => { e.stopPropagation(); openDoctor(d.doctorId) }}>
                            {d.doctor}</button>
                          {d.specialty && <small className="pr-spec">{d.specialty}</small>}
                          {d.noPay && <small className="pr-flag"> · بلا طريقة حساب</small>}
                        </td>
                        <td data-label="الدوام">{d.attendance.days > 0
                          ? <>{n(d.attendance.days)} {d.attendance.days === 1 ? 'يوم' : 'أيام'}{d.attendance.minutes > 0 && <span className="muted"> · {hm(d.attendance.minutes)}</span>}</>
                          : <span className="muted">—</span>}</td>
                        <td data-label="المرضى" className="num">{n(d.patients)}</td>
                        <td data-label="الإجراءات" className="num">{d.procedures ? n(d.procedures) : <span className="muted">—</span>}</td>
                        <td data-label="المستحقّ" className="num pr-due">{d.payable === null || d.payable === undefined ? '—' : fmtMoney(d.payable)}</td>
                        <td className="pr-chev" aria-hidden="true">‹</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {idle.length > 0 && (
            <div className="pr-idle">
              <button type="button" className="link-btn" onClick={() => setShowIdle((v) => !v)}>
                {showIdle ? 'إخفاء' : 'عرض'} الدكاترة بلا نشاط في الفترة ({n(idle.length)})</button>
              {showIdle && <p className="pr-idle-names">{idle.map((d) => d.doctor).join('، ')}</p>}
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function Payroll() {
  const [params, setParams] = useSearchParams()
  const [toast, showToast] = useToast()
  const { clinicRole: role } = useRole()
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'statements'
  // تبديل التبويب يُفرغ معايير الآخر (لكلٍّ فترته وأسماء معاييره)
  const setTab = (k) => setParams(k === 'statements' ? {} : { tab: k }, { replace: true })
  return (
    <div className="pr-page">
      <div className="pcx-head">
        <h2>الرواتب والأجور</h2>
        <p className="subtitle pcx-lead">
          {tab === 'statements'
            ? <>كشف كلّ دكتور للفترة: مرضاه، ودوامه بالساعات، وحصّته من الإجراءات، والمستحقّ له، بملف Excel أو PDF للطباعة والتوقيع.{/* بلا رابطٍ لتقارير الدكاترة (طلب المستخدم 2026-11-18) */}</>
            : 'ما طلع لكلّ دكتور من الإجراءات، وحصّة الشفاء منها — من لحظة القبض، كما سُجّل.'}
        </p>
      </div>
      {toast}
      <div className="pcx-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={`pcx-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'procedures'
        ? <ProcedureEarnings showToast={showToast} canEdit={role === 'clinic_admin'} />
        : <StatementsTab showToast={showToast} />}
    </div>
  )
}

