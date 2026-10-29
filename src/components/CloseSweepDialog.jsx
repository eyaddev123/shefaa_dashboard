import { useState } from 'react'
import { api } from '../api.js'
import { Modal } from './inventory/shared.jsx'

// ═══ الإغلاق الكانس — نافذة التأكيد ═══
// الدكتور يغادر وينسى آخر مريضٍ «قيد الكشف»، والاستقبال تعلّم الباقين «لم يحضر» واحداً
// واحداً. فـ«إغلاق العيادة» يسأل الخادم أوّلاً، وإن وجد معلَّقاً (409 CLOSE_PENDING) تُعرض
// هذه النافذة بملخّصه، وبالتأكيد يكنسه الخادم في معاملةٍ واحدة.
//   - الخارج مؤقتاً لا يُكنس بصمت: سطرٌ لكلٍّ منهم بخيارين، والتأكيد معطّل حتى يُختار.
//   - التأكيد يحمل ما رآه الموظف (expected): تغيّر الوضع أثناء النافذة ⇒ ملخّصٌ جديد هنا
//     (CLOSE_CHANGED) بدل كنس ما لم يُرَ.

// «مريضٌ واحد، مريضان، ٣ مرضى، ١١ مريضاً»
const patientsAr = (n) => n === 1 ? 'مريضٌ واحد' : n === 2 ? 'مريضان'
  : n >= 3 && n <= 10 ? `${n} مرضى` : `${n} مريضاً`

const who = (p) => (
  <><b>{p.full_name || '—'}</b>{p.number != null && <span className="cs-num"> (الدور {p.number})</span>}</>
)

export default function CloseSweepDialog({ session, pending: initial, onDone, onClose }) {
  const [pending, setPending] = useState(initial)
  const [choices, setChoices] = useState({})   // id → 'no_show' | 'done'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [changed, setChanged] = useState(false)

  const { in_service: inService, waiting, waiting_return: returning } = pending
  const allIds = [...inService, ...waiting, ...returning].map((p) => p.id)
  const unchosen = returning.filter((p) => !choices[p.id]).length

  const confirm = async () => {
    setBusy(true); setErr(null)
    try {
      await api.clinic.closeSession(session.id, {
        confirm: true, expected: allIds,
        returning: Object.fromEntries(returning.map((p) => [p.id, choices[p.id]])),
      })
      onDone()
    } catch (ex) {
      if (ex.data && ex.data.pending && (ex.data.code === 'CLOSE_CHANGED' || ex.data.code === 'RETURN_CHOICE_REQUIRED')) {
        // الوضع تغيّر: الملخّص الجديد مكان القديم، والاختيارات تبقى لمن بقي
        setPending(ex.data.pending)
        setChanged(ex.data.code === 'CLOSE_CHANGED')
      } else if (ex.data && ex.data.code === 'ALREADY_CLOSED') {
        onDone()
        return
      }
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={`إغلاق العيادة — ${session.doctor_name}`} onClose={onClose} busy={busy} sheet
      subtitle="في العيادة مرضى لم تُغلق زياراتهم. راجع ما سيحدث لكلٍّ منهم قبل الإغلاق:">
      <div className="cs-body">
        {changed && <p className="cs-changed" role="status">تغيّر وضع العيادة منذ فُتحت النافذة — هذا الملخّص المحدَّث.</p>}

        {inService.map((p) => (
          <p key={p.id} className="cs-line">
            مريضٌ قيد الكشف: {who(p)} — <span className="cs-effect">سيُسجَّل كشفه منتهياً.</span>
          </p>
        ))}

        {waiting.length > 0 && (
          <div className="cs-line">
            {/* «وفي الانتظار ٣ مرضى» لا «و٣ مرضى»: الواو ملاصقةً لرقمٍ لاتينيّ تنقلب «٣و» */}
            <p>
              {inService.length ? 'وفي' : 'في'} الانتظار {patientsAr(waiting.length)} —{' '}
              <span className="cs-effect">{waiting.length === 1 ? 'سيُعلَّم' : 'سيُعلَّمون'} «لم يحضر».</span>
            </p>
            <ul className="cs-names">
              {waiting.map((p) => <li key={p.id}>{who(p)}</li>)}
            </ul>
          </div>
        )}

        {returning.map((p) => (
          <div key={p.id} className="cs-return" role="group" aria-labelledby={`cs-q-${p.id}`}>
            <p id={`cs-q-${p.id}`} className="cs-return-q">مريضٌ بخروجٍ مؤقت: {who(p)} — ماذا نفعل به؟</p>
            <div className="cs-choices" role="radiogroup">
              {[['no_show', 'لم يحضر'], ['done', 'إنهاء كشفه']].map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={choices[p.id] === v}
                  className={`cs-choice${choices[p.id] === v ? ' on' : ''}`} disabled={busy}
                  onClick={() => setChoices((c) => ({ ...c, [p.id]: v }))}>{label}</button>
              ))}
            </div>
          </div>
        ))}

        {err && <p className="error cs-error">{err}</p>}

        <div className="cs-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>تراجع</button>
          <button type="button" className="danger" disabled={busy || unchosen > 0} onClick={confirm}>
            {busy ? 'جارٍ الإغلاق…' : unchosen > 0 ? 'اختر للخروج المؤقت أولاً' : 'تأكيد الإغلاق'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
