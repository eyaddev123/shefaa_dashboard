import { useCallback, useEffect, useState } from 'react'
import { api, fmtMoney, openStaffStream } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { useToast } from '../action-feedback.jsx'

// ═══════════════════════════════════════════════════════════════════
// «أعمالي» — صفحة الطبيب المستقلّة في القائمة الجانبية (تحت «شاشتي»)
//
// المكان الوحيد الذي يرى فيه الطبيب أرقاماً ماليّة: اليوم / الأسبوع (من السبت) / الشهر، المرضى
// والإجراءات، والإجراءات المحاسَبة بحصّته من لقطة السطر ومجموعها — من /clinic/my-work، أي حساب
// صفحة المستحقات نفسه لطبيبه وحده (الخادم يأخذ الطبيب من الحساب لا من الطلب).
// ★ hideSplit بمعناه: لا سعر ولا حصّة الشفاء ولا قاعدة التوزيع — حصّته هو فقط.
// وتحتها ما ينتظر المحاسبة بالأسماء (بلا مبالغ)، ومنه يحذف الطبيب سطره قبل أن يُقبض.
// حيّة: حدث «procedure» على بثّ الموظفين (بلا أرقام) ⇒ إعادة تحميل من المسار المحميّ.
// ═══════════════════════════════════════════════════════════════════

// ═══ المحتوى — كما بُني في التبويب، منقولاً بلا إعادة بناء ═══
// اليوم / الأسبوع (من السبت) / الشهر: chips فورية بلا زرّ تطبيق. بطاقتا ملخّص (المرضى، الإجراءات)،
// ثمّ الإجراءات المقبوضة بحصّته من لقطة السطر، ثمّ المجموع — من /clinic/my-work، أي حساب صفحة
// المستحقات نفسه. وتحتها ما ينتظر المحاسبة بالأسماء وحدها (بلا مبالغ)، ومنه يحذف الطبيب سطره.
const WORK_PERIODS = [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']]

function MyWork({ reloadKey, pending, onRemove }) {
  const [period, setPeriod] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    api.clinic.myWork(period).then((d) => { if (alive) { setData(d); setErr(null) } })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [period, reloadKey])
  const shown = data && data.period === period ? data : null
  return (
    <div className="dk-work">
      <div className="dk-chips-filter" role="group" aria-label="الفترة">
        {WORK_PERIODS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={period === k}
            className={`dk-filter${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!shown ? (!err && <p className="empty">جارٍ التحميل…</p>) : (
        <>
          <div className="dk-stats">
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.patients.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">المرضى</span>
            </div>
            <div className="dk-stat">
              <span className="dk-stat-n">{shown.procedures.toLocaleString('ar-SY')}</span>
              <span className="dk-stat-l">الإجراءات</span>
            </div>
          </div>
          <div className="card dk-work-list">
            <h3>الإجراءات المحاسَبة <span className="dk-work-range" dir="ltr">
              {shown.from === shown.to ? shown.from : `${shown.from} — ${shown.to}`}</span></h3>
            {shown.lines.length === 0 ? <p className="empty">لا إجراءات محاسَبة في هذه الفترة.</p> : (
              <ul className="dk-lines">
                {shown.lines.map((l) => (
                  <li key={l.id} className="dk-line is-paid">
                    <div className="dk-line-main">
                      <span className="dk-line-proc">{l.procedure}</span>
                      <span className="dk-line-patient">{l.patient}</span>
                    </div>
                    <span className="dk-line-share">{fmtMoney(l.doctor_share)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="dk-work-total">
              <span>مجموع حصّتك</span>
              <strong>{fmtMoney(shown.total_share)}</strong>
            </div>
          </div>
        </>
      )}
      {pending.length > 0 && (
        <div className="card dk-work-pending">
          <h3>بانتظار المحاسبة <span className="dk-group-count">{pending.length.toLocaleString('ar-SY')}</span></h3>
          <p className="dk-hint">تُحتسب لك حين تقبضها الاستقبال. تحذف ما أضفته أنت قبل ذلك.</p>
          <ul className="dk-lines">
            {pending.map((l) => (
              <li key={l.id} className="dk-line is-unpaid">
                <div className="dk-line-main">
                  <span className="dk-line-proc">⏳ {l.name}</span>
                  <span className="dk-line-patient">{l.patient_name}</span>
                </div>
                {l.mine && (
                  <button type="button" className="ghost dk-line-x"
                    aria-label={`حذف ${l.name} عن ${l.patient_name}`} onClick={() => onRemove(l)}>حذف</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function MyWorkPage() {
  const dialogs = useDialogs()
  const [toast, showToast] = useToast()
  const [mine, setMine] = useState(null)
  const [key, setKey] = useState(0)
  const loadMine = useCallback(() => api.clinic.myProcedures().then(setMine).catch(() => {}), [])
  useEffect(() => { loadMine() }, [loadMine])
  useEffect(() => {
    let timer = null
    const close = openStaffStream((name) => {
      if (name !== 'procedure') return
      clearTimeout(timer)
      timer = setTimeout(() => { loadMine(); setKey((k) => k + 1) }, 250)
    })
    return () => { clearTimeout(timer); close() }
  }, [loadMine])

  const remove = async (line) => {
    const ok = await dialogs.confirm({
      title: 'حذف الإجراء؟', body: `«${line.name}» عن ${line.patient_name} — لم يُحاسَب بعد.`,
      confirmLabel: 'حذف', danger: true })
    if (!ok) return
    try {
      await api.clinic.removeAppointmentProcedure(line.appointment_id, line.id, '')
      showToast(`حُذف «${line.name}»`, 'success', 3000)
      loadMine(); setKey((k) => k + 1)
    } catch (ex) { showToast(`لم يُحذف «${line.name}»: ${ex.message}`) }
  }

  const pending = (mine?.lines || []).filter((l) => !l.paid_at)
  return (
    <div className="dk-work-page">
      <h2>أعمالي</h2>
      <p className="subtitle">مرضاك وإجراءاتك المحاسَبة وحصّتك — لليوم أو الأسبوع أو الشهر</p>
      {toast}
      <MyWork reloadKey={key} pending={pending} onRemove={remove} />
    </div>
  )
}
