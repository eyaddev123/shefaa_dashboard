import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtMoney, fmtDay } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import { PeriodBar } from './DoctorAccounts.jsx'
import ProcedureEarnings from './ProcedureEarnings.jsx'
import StatementSheet from '../components/payroll/StatementSheet.jsx'

// ═══ الرواتب والأجور (طلب المستخدم 2026-11-18) ═══
// «صفحة مالية مخصّصة: رواتب الدكتور وأجوره وأجوره من الإجراءات» — و«المستحقات» خرجت من صفحة الإجراءات
// إليها (تبويب «تفصيل الإجراءات» بأدواته: بانتظار المحاسبة، تصحيح المواد، التنبيهات).
// «كشوف الأجور»: الفترة (شهرٌ افتراضاً، أو من–إلى) ⇒ الدكاترة بمستحقّهم ⇒ كشف الدكتور: كلّ مرضاه بالتاريخ
// والاسم الثلاثي ونوع الزيارة وإجراءاتها، ودوامه بالساعات، والحساب، ومكان استلامٍ وتوقيعٍ بخطّ اليد —
// إكسل وPDF (ملفٌّ ينزل مباشرةً) للطباعة والتوقيع. الأرقام من حساب «تقارير الدكاترة» نفسه (الخادم).
// قراءةٌ وحدها: لا تسجيل «استلم» (قرار المستخدم: ورقةٌ تُوقَّع).

const TABS = [['statements', 'كشوف الأجور'], ['procedures', 'تفصيل الإجراءات']]
const MODES = [['month', 'شهر'], ['custom', 'فترة']]
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
  const mode = from ? 'custom' : 'month'
  const query = mode === 'custom' ? { from, to } : { month }
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const k of ['month', 'from', 'to', 'day']) next.delete(k)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v)
    setParams(next, { replace: true })
  }
  return { params, setParams, mode, month, from, to, query, set }
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
      <div className="pay-paper"><StatementSheet st={st} /></div>
    </div>
  )
}

function StatementsTab({ showToast }) {
  const { params, setParams, mode, month, from, to, query, set } = usePeriod()
  const doctorId = /^\d+$/.test(params.get('doctor') || '') ? params.get('doctor') : null
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showIdle, setShowIdle] = useState(false)
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
  const { active, idle } = useMemo(() => {
    const ds = data?.doctors || []
    return { active: ds.filter(activityOf).sort((a, b) => (b.due ?? 0) - (a.due ?? 0) || a.doctor.localeCompare(b.doctor, 'ar')),
      idle: ds.filter((d) => !activityOf(d)) }
  }, [data])
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
      <PeriodBar mode={mode} cur={data?.month || month} from={from || data?.from} to={to || data?.to} data={data}
        set={(p) => set(p)} modes={MODES} />
      {doctorId ? (
        <StatementView doctorId={doctorId} query={query} onBack={() => openDoctor(null)} showToast={showToast} />
      ) : err ? <p className="error">{err}</p> : !data ? <p className="empty">جارٍ التحميل…</p> : (
        <>
          <div className="pr-summary">
            <div><span>المستحقّ لكلّ الدكاترة</span><strong>{fmtMoney(data.totals.due)}</strong><em>{period}</em></div>
            <div className="pr-toolbar-end">
              <button type="button" className="ghost" disabled={busy || !active.length}
                onClick={() => api.clinic.exportPayroll(query).catch((e) => showToast(e.message))}>Excel للكلّ</button>
              <button type="button" disabled={busy || !active.length} onClick={allPdf}>
                {busy ? 'جارٍ إنشاء الـ PDF…' : 'PDF للكلّ'}</button>
            </div>
          </div>
          {data.noPay > 0 && <p className="pr-note">{n(data.noPay)} من الدكاترة بلا طريقة حساب — راتبهم صفر حتى تُضبط من البروفايل.</p>}
          {active.length === 0 ? <p className="empty">لا نشاط لأيّ دكتور في هذه الفترة.</p> : (
            <ul className="pr-list">
              {active.map((d) => (
                <li key={d.doctorId}>
                  <button type="button" className="pr-card" onClick={() => openDoctor(d.doctorId)}>
                    <span className="pr-name">{d.doctor}{d.specialty && <small> — {d.specialty}</small>}</span>
                    <span className="pr-facts">
                      {d.attendance.days > 0 && <span>{n(d.attendance.days)} يوم دوام{d.attendance.minutes > 0 && ` · ${hm(d.attendance.minutes)} ساعة`}</span>}
                      <span>{n(d.patients)} مريض</span>
                      {d.procedures > 0 && <span>{n(d.procedures)} إجراء</span>}
                      {d.ironCount > 0 && <span>{n(d.ironCount)} حديد</span>}
                      {d.noPay && <span className="pr-flag">بلا طريقة حساب</span>}
                    </span>
                    <span className="pr-due">{d.due === null ? '—' : fmtMoney(d.due)}</span>
                    <span className="pr-open">الكشف ←</span>
                  </button>
                </li>
              ))}
            </ul>
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
            ? <>كشف كلّ دكتور للفترة: مرضاه، ودوامه بالساعات، وحصّته من الإجراءات، والمستحقّ له، بملف Excel أو PDF للطباعة والتوقيع. الحساب نفسه في <Link to="/clinic/doctor-reports">تقارير الدكاترة</Link>.</>
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

