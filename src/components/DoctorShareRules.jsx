import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtDateTime, toLatinDigits } from '../api.js'
import { useDialogs } from '../dialogs.jsx'
import { ShareRuleDialog } from './ShareRuleDialogs.jsx'
import { ruleText, afterDeleteText, afterPauseText } from '../share-rule.js'

// ═══ حصّة الدكتور من الإجراءات ═══
// نسبةٌ عامّة لكل إجراءاته (تُحسب **بعد** خصم المواد)، وحالاتٌ خاصّة لإجراءٍ بعينه
// تغلبها: مبلغٌ ثابت (لا تمسّه المواد) أو نسبةٌ أخرى. وبلا قاعدةٍ **تُرفض إضافة الإجراء**
// (الخادم يحرس، مفردةً ومتعدّدة) — لا «صفر صامت». و«كلّه للشفاء» قرارٌ يُسجَّل: نسبة 0٪.
//
// الإدارة كلّها هنا للمشرفة: النسبة العامّة، وإضافة/تعديل/حذف القواعد الخاصّة (نافذة).
// والقاعدة الموزَّعة من صفحة الإجراءات قاعدةٌ خاصّة كغيرها، تُعدَّل وتُحذف من هنا.
// كلّ تغييرٍ سطرٌ في «سجلّ التعديلات» أسفل البروفايل وفي تاريخ تسعيرة الإجراء.
//
// ★ تغيير قاعدةٍ هنا يسري على الإجراءات **القادمة** وحدها: كلُّ سطرٍ قائم يحمل
//   لقطة القاعدة لحظة إضافته، ولا يتغيّر ولو عُدّلت موادّه لاحقاً.
//
// «إيقاف» (2026-11-12): القاعدة تبقى بقيمتها ولا تُطبَّق — يُحسب الإجراء القادم بالنسبة العامّة —
// و«تشغيل» يُرجعها. لكلّ قاعدةٍ زرّها، و«إيقاف الكل»/«تشغيل الكل» لقواعد الدكتور كلّها.
const generalOf = (d) => (d.share_kind === 'percent' ? String(Number(d.share_value)) : '')
export default function DoctorShareRules({ doctor, canEdit, onSaved, showToast }) {
  const dlg = useDialogs()
  // قاعدةٌ عامّة «ثابتة» من التصميم السابق تُعرض كما هي حتى تُستبدل بنسبة
  const legacyFixed = doctor.share_kind === 'fixed'
  const [value, setValue] = useState(generalOf(doctor))
  const [rules, setRules] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [dialog, setDialog] = useState(null)   // {rule} — rule: null للإضافة
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // {text, ok}

  const load = () => {
    api.clinic.doctorProcedureShares(doctor.id).then(setRules).catch((e) => setMsg({ text: e.message }))
    if (canEdit && !catalog) api.clinic.procedures().then((r) => setCatalog(r.filter((x) => x.is_active)))
      .catch(() => {})
  }
  useEffect(() => { load() }, [doctor.id])
  useEffect(() => { setValue(generalOf(doctor)) }, [doctor.share_kind, doctor.share_value])

  // التحذير (ثابتٌ أعلى من السعر) يبقى ظاهراً أطول من نجاحٍ عادي
  const notify = (text, warnings = []) => {
    const full = warnings.length ? `${text} — ⚠ ${warnings.join('، ')}` : text
    if (showToast) showToast(full, warnings.length ? 'warning' : 'success', warnings.length ? 8000 : 3500)
    else setMsg({ text: full, ok: true })
  }
  const saveGeneral = async () => {
    const t = value.trim()
    if (t !== '' && (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > 100)) {
      setMsg({ text: /^-/.test(t) ? 'النسبة العامّة: لا يُقبل رقمٌ سالب' : 'النسبة العامّة: رقمٌ بين ٠ و١٠٠' }); return
    }
    setBusy(true); setMsg(null)
    try {
      await api.clinic.setDoctorShare(doctor.id, t === '' ? { share_kind: null } : { share_kind: 'percent', share_value: t })
      notify(t === '' ? 'أُزيلت النسبة العامّة — لا يُضاف له إجراءٌ بلا حالةٍ خاصّة حتى تُضبط'
        : Number(t) === 0 ? 'حُفظت النسبة العامّة 0٪ — كامل مبلغ إجراءاته للشفاء' : `حُفظت النسبة العامّة ${t}٪`)
      if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }
  // الإيقاف يُرجَع عنه بزرّ، فالقاعدة الواحدة بلا تأكيد؛ و«الكل» بتأكيدٍ يقول العدد والمصير
  const togglePause = async (r) => {
    const paused = !r.paused_at
    setBusy(true); setMsg(null)
    try {
      await api.clinic.pauseDoctorProcedureShare(doctor.id, r.procedure_id, paused)
      notify(paused ? `أُوقفت قاعدة «${r.procedure_name}» — ${afterPauseText(doctor)}`
        : `شُغّلت قاعدة «${r.procedure_name}» من جديد: ${ruleText(r)}`)
      load(); if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }
  const pauseAll = async (paused) => {
    const n = (rules || []).filter((r) => !r.paused_at === paused).length
    const ok = await dlg.confirm(paused ? {
      title: `إيقاف كل الحالات الخاصّة (${n})`,
      body: `${afterPauseText(doctor)}.\nالقواعد تبقى محفوظة بقيمها وتُشغَّل متى شئتم.\n`
        + 'يسري على الإجراءات القادمة وحدها — المسجَّل قبلها لا يتغيّر.',
      confirmLabel: 'إيقاف الكل',
    } : {
      title: `تشغيل كل الحالات الخاصّة (${n})`,
      body: 'ترجع كل قاعدةٍ موقوفة بقيمتها المحفوظة.\nيسري على الإجراءات القادمة وحدها — المسجَّل قبلها لا يتغيّر.',
      confirmLabel: 'تشغيل الكل',
    })
    if (!ok) return
    setBusy(true); setMsg(null)
    try {
      const out = await api.clinic.pauseAllDoctorProcedureShares(doctor.id, paused)
      notify(paused ? `أُوقفت ${out.changed} ${out.changed === 1 ? 'قاعدة' : 'قواعد'} — الإجراءات القادمة بالنسبة العامّة`
        : `شُغّلت ${out.changed} ${out.changed === 1 ? 'قاعدة' : 'قواعد'} من جديد`)
      load(); if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }
  const removeRule = async (r) => {
    const ok = await dlg.confirm({
      title: `حذف قاعدة «${r.procedure_name}»`,
      body: `القاعدة الحالية: ${ruleText(r)}.\n${afterDeleteText(doctor)}.\nيسري على الإجراءات القادمة وحدها.`
        + (r.paused_at ? '' : '\nلتعليقها مؤقّتاً بلا حذف استعملوا «إيقاف» — تبقى محفوظة وتُشغَّل لاحقاً.'),
      confirmLabel: 'حذف القاعدة', danger: true,
    })
    if (!ok) return
    setBusy(true); setMsg(null)
    try {
      await api.clinic.removeDoctorProcedureShare(doctor.id, r.procedure_id)
      notify(`حُذفت قاعدة «${r.procedure_name}»`)
      load(); if (onSaved) onSaved()
    } catch (e) { setMsg({ text: e.message }) }
    finally { setBusy(false) }
  }

  const pausedN = (rules || []).filter((r) => r.paused_at).length
  const activeN = (rules || []).length - pausedN
  const generalText = !doctor.share_kind ? null
    : doctor.share_kind === 'percent' ? (Number(doctor.share_value) === 0 ? '0٪ — كامل المبلغ للشفاء'
      : `${Number(doctor.share_value)}٪ بعد خصم المواد والمستهلكات`)
    : `مبلغ ثابت ${fmtMoney(doctor.share_value)} (قاعدة قديمة)`

  return (
    <div className="card">
      <h3>حصّة الدكتور من الإجراءات</h3>
      <p className="subtitle" style={{ marginTop: -6 }}>
        النسبة تُحسب <strong>بعد خصم المواد والمستهلكات</strong>: (السعر − المواد − المستهلكات) × النسبة،
        وتُقرَّب حصّة الدكتور <strong>لفوق لأقرب 50</strong> بما لا يتجاوز الباقي. والمبلغ الثابت لا يُقرَّب.
        والشفاء تأخذ الباقي. <strong>بلا قاعدة لا يُضاف للدكتور إجراء</strong> — ولمن مبلغ إجراءاته كلّه للشفاء
        سجّلوا نسبة 0٪. تغيير القواعد يسري على الإجراءات القادمة وحدها.
      </p>

      {!doctor.share_kind && (
        <p className="share-warn">⚠ لا نسبة عامّة لهذا الدكتور — <strong>لا يُقبل له إجراءٌ</strong> إلا ما له حالةٌ خاصّة أدناه.
          اضبطوا نسبته (أو 0٪ إن كان مبلغ إجراءاته كلّه للشفاء).</p>
      )}
      {legacyFixed && (
        <p className="share-warn">قاعدته العامّة مبلغٌ ثابت من التصميم السابق ({fmtMoney(doctor.share_value)}) —
          سارية حتى تُستبدل بنسبة. المبلغ الثابت مكانه الآن «حالة خاصّة» لإجراء.</p>
      )}

      {canEdit ? (
        <div className="share-general">
          <div className="field">
            <label htmlFor={`gen-share-${doctor.id}`}>النسبة العامّة لكل إجراءاته ٪</label>
            <input id={`gen-share-${doctor.id}`} value={value} inputMode="decimal" placeholder="مثلاً 50"
              onChange={(e) => setValue(toLatinDigits(e.target.value))} />
          </div>
          {value.trim() !== '' && Number(value) === 0 && <span className="muted">0٪ — كامل المبلغ للشفاء</span>}
          <button type="button" disabled={busy || value.trim() === generalOf(doctor)} onClick={saveGeneral}>حفظ النسبة</button>
        </div>
      ) : (
        <p>النسبة العامّة: <strong>{generalText || 'بلا قاعدة — لا يُقبل له إجراء'}</strong></p>
      )}

      <div className="share-rules-head">
        <h4>حالات خاصّة لإجراءات بعينها{rules ? ` (${rules.length}${pausedN ? `، منها ${pausedN} موقوفة` : ''})` : ''}</h4>
        {canEdit && (
          <div className="share-rules-head-actions">
            {activeN > 0 && <button type="button" className="ghost" disabled={busy}
              onClick={() => pauseAll(true)}>إيقاف الكل</button>}
            {pausedN > 0 && <button type="button" className="ghost" disabled={busy}
              onClick={() => pauseAll(false)}>تشغيل الكل</button>}
            <button type="button" disabled={busy || !catalog} onClick={() => setDialog({ rule: null })}>+ إضافة قاعدة</button>
          </div>
        )}
      </div>
      {pausedN > 0 && (
        <p className="share-paused-note" role="status">
          {pausedN === rules.length ? 'كل الحالات الخاصّة موقوفة' : `${pausedN} من ${rules.length} موقوفة`} —
          {' '}{afterPauseText(doctor)}. القواعد محفوظة بقيمها، والإجراءات المسجَّلة قبل الإيقاف لا تتغيّر.
        </p>
      )}
      {!rules ? <p className="empty">جارٍ التحميل…</p>
        : rules.length === 0 ? <p className="empty">لا حالات خاصّة — تُطبَّق النسبة العامّة على كل إجراءاته.</p>
        : (
          <table className="rtable">
            <thead><tr><th>الإجراء</th><th>سعره الحالي</th><th>القاعدة</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rules.map((r) => {
                const above = r.share_kind === 'fixed' && Number(r.share_value) > Number(r.price)
                const paused = !!r.paused_at
                return (
                  <tr key={r.id} className={paused ? 'rule-paused' : undefined}>
                    <td className="rt-title">{r.procedure_name}
                      {!r.procedure_active && <span className="badge" style={{ marginInlineStart: 6 }}>معطَّل</span>}</td>
                    <td className="num" data-label="سعره الحالي">{fmtMoney(r.price)}</td>
                    <td data-label="القاعدة">{ruleText(r)}
                      {paused && <span className="badge warn" style={{ marginInlineStart: 6 }}
                        title={`موقوفة منذ ${fmtDateTime(r.paused_at)}${r.paused_by_name ? ` — ${r.paused_by_name}` : ''}`}>موقوفة</span>}
                      {above && !paused && <span className="badge bad" style={{ marginInlineStart: 6 }}
                        title="المبلغ الثابت أعلى من سعر الإجراء — يأخذ الدكتور ما يبقى والشفاء صفر">أعلى من السعر</span>}</td>
                    {canEdit && (
                      <td className="rt-actions share-rule-actions">
                        <button type="button" className="ghost" disabled={busy}
                          onClick={() => setDialog({ rule: r })}>تعديل</button>
                        <button type="button" className="ghost" disabled={busy}
                          aria-label={`${paused ? 'تشغيل' : 'إيقاف'} قاعدة ${r.procedure_name}`}
                          onClick={() => togglePause(r)}>{paused ? 'تشغيل' : 'إيقاف'}</button>
                        <button type="button" className="ghost danger-text" disabled={busy}
                          onClick={() => removeRule(r)}>حذف</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      {msg && <p className={msg.ok ? 'success-text' : 'error'} style={{ marginTop: 8 }} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      {dialog && (
        <ShareRuleDialog doctor={doctor} rule={dialog.rule} rules={rules} catalog={catalog}
          onClose={() => setDialog(null)}
          onSaved={(out, text) => {
            setDialog(null); notify(text, out?.warnings || []); load(); if (onSaved) onSaved()
          }} />
      )}
    </div>
  )
}
