import { fmtMoney, fmtDay } from '../../api.js'

// ═══ ورقة كشف أجور الدكتور — A4 ═══
// مكوّنٌ واحد للشاشة والـ PDF (payroll-pdf.js يصوّره): ألوانٌ ثابتة فاتحة لا رموز السمة — الورقة تُطبع
// بيضاء ولو كانت الشاشة داكنة. كلّ ما لا يُقسَم بين صفحتين يحمل data-unit (سطر جدول، عنوان قسم، الحساب،
// مكان التوقيع) فيقطع الـ PDF عند حدوده لا في منتصف سطر.
// طلب المستخدم 2026-11-18: التاريخ والاسم الثلاثي، معاينة/مراجعة/إجراء، الحساب الأخير بالساعات واليومية
// والإجراءات، وتحت مساحة عريضة يكتب فيها الدكتور بإيده الرقم الذي استلمه ويوقّع.

const day = (d) => fmtDay(`${d}T12:00:00Z`, { utc: true })
const n = (v) => Number(v || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const hm = (m) => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`)
const BRAND = 'مجمع عيادات الشفاء الطبي'
// كتل الصفحات لقائمة المرضى: الأولى أقصر (رأس الكشف فوقها)، وبعدها 80 بالصفحة (40 بكلّ عمود) — قرار المستخدم
const FIRST_PAGE = 68, PER_PAGE = 80
// التاريخ في القائمة يومٌ/شهر: السنة في رأس الكشف (الفترة)، والعرض الموفَّر للاسم
const shortDay = (d) => { const [, m, dd] = String(d).split('-'); return `${Number(dd)}/${Number(m)}` }
const chunks = (visits) => {
  const all = visits.map((v, i) => ({ v, i }))
  const out = [all.slice(0, FIRST_PAGE)]
  for (let k = FIRST_PAGE; k < all.length; k += PER_PAGE) out.push(all.slice(k, k + PER_PAGE))
  return out.filter((x) => x.length > 0)
}
// رقم المريض في القائمة يبقى معه في جدول الإجراءات — فيُعثر عليه بها
const withProcs = (visits) => visits.map((v, i) => ({ v, i })).filter(({ v }) => v.procedures.length > 0)
const pairs = (list) => Array.from({ length: Math.ceil(list.length / 2) }, (_, r) => [list[2 * r], list[2 * r + 1]])
// نصف السطر: الرقم، التاريخ، المريض، الإجراء، للطبيب — والنصف الأيسر بخطٍّ فاصلٍ أعرض
const sideCls = (side, cls = '') => [cls, side === 1 && 'pay-pair-start'].filter(Boolean).join(' ') || undefined
function PairHead({ side }) {
  return (
    <>
      <th className={sideCls(side, 'pay-num')}>#</th><th className="pay-date">التاريخ</th><th>اسم المريض</th>
      <th className="pay-proc-col">الإجراء</th><th className="pay-amt">للطبيب</th>
    </>
  )
}
function ProcCells({ side, x }) {
  if (!x) return <><td className={sideCls(side)} /><td /><td /><td /><td /></>
  const { v, i } = x
  return (
    <>
      <td className={sideCls(side, 'pay-num')}>{n(i + 1)}</td>
      <td className="pay-date">{shortDay(v.date)}</td>
      <td className="pay-name">{v.patient}</td>
      <td className="pay-procs">{v.procedures.map((p, k) => (
        <span key={k} className={p.paid ? undefined : 'pay-pending'}>{k > 0 && '، '}{p.name}{!p.paid && ' (بانتظار)'}</span>))}</td>
      <td className="pay-amt">{v.procShare ? n(v.procShare) : ''}</td>
    </>
  )
}

export default function StatementSheet({ st, printedAt }) {
  const d = st.doctor
  const c = st.counts
  return (
    <article className="pay-sheet" dir="rtl">
      <header className="pay-head" data-unit>
        <div className="pay-brand">{BRAND}</div>
        <h1>كشف أجور الطبيب</h1>
        <div className="pay-meta">
          <div><span>الطبيب</span><strong>{d.doctor}</strong>{d.specialty && <em> — {d.specialty}</em>}</div>
          <div><span>الفترة</span><strong>من {day(st.from)} إلى {day(st.to)}</strong></div>
          <div><span>طريقة الحساب</span><strong>{st.payKindLabel || 'لم تُضبط'}</strong></div>
        </div>
      </header>

      <h2 className="pay-h2" data-unit>المرضى ({n(c.visits)} زيارة: معاينة {n(c.consultation)} · مراجعة {n(c.followup)}{c.procedureOnly ? ` · إجراء فقط ${n(c.procedureOnly)}` : ''})</h2>
      {st.visits.length === 0 ? <p className="pay-empty" data-unit>لا زيارات في هذه الفترة.</p> : (
        <>
          {/* ★ عمودان بالصفحة (طلب المستخدم 2026-11-20: «200 مريض ما بطبعلهم 10 صفحات»): كلّ كتلةٍ صفحة —
              العمود اليمين ثمّ اليسار بترقيمٍ متّصل، وكلّ كتلةٍ data-unit فلا تُقسم بين صفحتين */}
          {chunks(st.visits).map((ch, k) => (
            <div key={k} className="pay-cols" data-unit>
              {[ch.slice(0, Math.ceil(ch.length / 2)), ch.slice(Math.ceil(ch.length / 2))].map((col, c) => (
                <table key={c} className="pay-table pay-mini">
                  <thead><tr><th className="pay-num">#</th><th className="pay-date">التاريخ</th><th>اسم المريض</th><th className="pay-kind">الزيارة</th></tr></thead>
                  <tbody>
                    {col.map(({ v, i }) => (
                      <tr key={v.id}>
                        <td className="pay-num">{n(i + 1)}</td>
                        <td className="pay-date">{shortDay(v.date)}</td>
                        <td className="pay-name">{v.patient}</td>
                        <td className="pay-kind">{v.visitType}{!v.inRange && <small> *</small>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          ))}
          {st.visits.some((v) => !v.inRange) && <p className="pay-foot-note" data-unit>* زيارةٌ قبل الفترة، محسوبٌ إجراؤها فيها.</p>}

          {/* الإجراءات جدولٌ لحاله: المرضى ذوو الإجراء وحدهم، بحصّة الطبيب — **إجراءان بكلّ سطر** (طلب المستخدم
              2026-11-20: «100 إجراء ما بيطلعوا 20 صفحة»): السطر وحدةٌ فتمتلئ الصفحة لآخرها وتُقطع بين سطرين بخطّ */}
          {withProcs(st.visits).length > 0 && (
            <>
              <h2 className="pay-h2" data-unit>الإجراءات ({n(c.procedures)} إجراء)</h2>
              <table className="pay-table pay-mini pay-pairs">
                <thead>
                  <tr data-unit>{[0, 1].map((k) => (
                    <PairHead key={k} side={k} />
                  ))}</tr>
                </thead>
                <tbody>
                  {pairs(withProcs(st.visits)).map((pr, r) => (
                    <tr key={r} data-unit>
                      {[0, 1].map((k) => <ProcCells key={k} side={k} x={pr[k]} />)}
                    </tr>
                  ))}
                  <tr className="pay-total" data-unit>
                    <td colSpan={9}>مجموع حصّته من الإجراءات</td>
                    <td className="pay-amt">{n(d.procDoctor)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {st.iron.length > 0 && (
        <>
          <h2 className="pay-h2" data-unit>خدمات العيادة ({n(st.iron.length)})</h2>
          <table className="pay-table">
            <thead><tr data-unit><th className="pay-num">#</th><th>التاريخ</th><th>اسم المريض</th><th>الجلسة</th><th className="pay-amt">للطبيب</th></tr></thead>
            <tbody>
              {st.iron.map((x, i) => (
                <tr key={i} data-unit><td className="pay-num">{n(i + 1)}</td><td className="pay-date">{day(x.date)}</td>
                  <td className="pay-name">{x.patient}</td><td>{x.service || 'حديد'}{x.serviceDual === false ? '' : x.withDrug ? ' — مع الدواء' : ' — بلا دواء'}</td><td className="pay-amt">{n(x.share)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {st.shifts.length > 0 && (
        <>
          <h2 className="pay-h2" data-unit>أيام الدوام ({n(d.attendance.days)} يوم · {hm(d.attendance.minutes)} ساعة)</h2>
          <table className="pay-table pay-shifts">
            <thead><tr data-unit><th>التاريخ</th><th>الوصول</th><th>الانصراف</th><th>الساعات</th></tr></thead>
            <tbody>
              {st.shifts.map((s, i) => (
                <tr key={i} data-unit><td className="pay-date">{day(s.date)}</td><td>{s.arrived}</td>
                  <td>{s.departed || 'لم يُسجَّل'}</td><td>{hm(s.minutes)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* الحساب ومكان التوقيع كتلةٌ واحدة: لا يوقّع الدكتور على صفحةٍ لا يرى فيها المبلغ */}
      <div className="pay-end" data-unit>
      <section className="pay-calc">
        <h2 className="pay-h2">الحساب</h2>
        <dl>
          {st.payLines.map((l, i) => (
            <div key={i}><dt>{l.label}</dt><dd>{fmtMoney(l.amount)}</dd></div>
          ))}
        </dl>
        {/* ما يُسلَّم: بلا كسور، مجبوراً لفوق لأقرب 5 (طلب المستخدم 2026-11-18) — والمجموع قبله سطرٌ صغير إن اختلف */}
        <div className="pay-due"><span>المستحقّ للطبيب</span><strong>{st.payable === null || st.payable === undefined ? '—' : fmtMoney(st.payable)}</strong></div>
        {st.payable !== null && st.payable !== undefined && d.due !== null && st.payable !== d.due && (
          <p className="pay-preround">قبل التقريب لأقرب 5: {fmtMoney(d.due)}</p>
        )}
        {(st.warnings.pendingProcedures > 0 || st.warnings.noDeparture > 0) && (
          <p className="pay-note">
            {st.warnings.pendingProcedures > 0 && `${n(st.warnings.pendingProcedures)} إجراء بانتظار المحاسبة لا يدخل المجموع. `}
            {st.warnings.noDeparture > 0 && `${n(st.warnings.noDeparture)} يوم بلا انصراف مسجَّل لا تُحسب ساعاته.`}
          </p>
        )}
      </section>

      <section className="pay-sign">
        <div className="pay-sign-row"><span>المبلغ المستلم (رقماً وكتابةً):</span><i /></div>
        <div className="pay-sign-row pay-sign-wide"><i /></div>
        <div className="pay-sign-2">
          <div className="pay-sign-row"><span>اسم المستلم:</span><i /></div>
          <div className="pay-sign-row"><span>التوقيع:</span><i /></div>
        </div>
        <div className="pay-sign-row pay-sign-date"><span>التاريخ:</span><i /></div>
        {printedAt && <p className="pay-printed">أُعدّ الكشف: {printedAt}</p>}
      </section>
      </div>
    </article>
  )
}
