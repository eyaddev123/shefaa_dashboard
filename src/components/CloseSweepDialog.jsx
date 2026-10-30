import { useState } from 'react'
import { api } from '../api.js'
import { Modal } from './inventory/shared.jsx'

// ═══ الإغلاق الكانس — نافذة التأكيد ═══
// الدكتور يغادر وينسى آخر مريضٍ «قيد الكشف»، والاستقبال تعلّم الباقين «لم يحضر» واحداً
// واحداً. فـ«إغلاق العيادة» يسأل الخادم أوّلاً، وإن وجد معلَّقاً (409 CLOSE_PENDING) تُعرض
// هذه النافذة بملخّصه، وبالتأكيد يكنسه الخادم في معاملةٍ واحدة.
//   - قسمان للمنتظرين: «بانتظار الحضور» (محجوزٌ لم يحضر) ⇒ «لم يحضر»، و«حاضرون بانتظار الدور»
//     ⇒ كشفٌ منتهٍ (هم في العيادة ودفعوا عند الحضور — الجرد لا يتغيّر). الأسماء حتى ٥، وإلا العدد.
//   - الخارج مؤقتاً لا يُكنس بصمت: سطرٌ لكلٍّ منهم بخيارين، والتأكيد معطّل حتى يُختار.
//   - التأكيد يحمل ما رآه الموظف (expected): تغيّر الوضع أثناء النافذة ⇒ ملخّصٌ جديد هنا
//     (CLOSE_CHANGED) بدل كنس ما لم يُرَ.

// «مريضٌ واحد، مريضان، ٣ مرضى، ١١ مريضاً»
const patientsAr = (n) => n === 1 ? 'مريضٌ واحد' : n === 2 ? 'مريضان'
  : n >= 3 && n <= 10 ? `${n} مرضى` : `${n} مريضاً`

const NAMES_UP_TO = 5

const who = (p) => (
  <><b>{p.full_name || '—'}</b>{p.number != null && <span className="cs-num"> (الدور {p.number})</span>}</>
)

// قسمٌ من المنتظرين: العنوان والعدد والأثر، ثمّ الأسماء إن كانوا قليلين
function Group({ list, title, effect, note, kind }) {
  if (!list.length) return null
  return (
    <div className={`cs-line cs-group cs-${kind}`}>
      <p>
        <b>{title}</b> ({patientsAr(list.length)}) — <span className="cs-effect">{effect}</span>
      </p>
      {note && <p className="cs-note">{note}</p>}
      {list.length <= NAMES_UP_TO && (
        <ul className="cs-names">
          {list.map((p) => <li key={p.id}>{who(p)}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function CloseSweepDialog({ session, pending: initial, onDone, onClose }) {
  const [pending, setPending] = useState(initial)
  const [choices, setChoices] = useState({})   // id → 'no_show' | 'done'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [changed, setChanged] = useState(false)

  const { in_service: inService, arrived, not_arrived: notArrived, waiting_return: returning } = pending
  const allIds = [...inService, ...arrived, ...notArrived, ...returning].map((p) => p.id)
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

        <Group list={arrived} title="حاضرون بانتظار الدور" kind="arrived"
          effect={arrived.length === 1 ? 'سيُسجَّل كشفه منتهياً.' : 'ستُسجَّل كشوفهم منتهية.'}
          note="حضروا ودفعوا عند الحضور — جرد الصندوق لا يتغيّر." />
        <Group list={notArrived} title="بانتظار الحضور" kind="not-arrived"
          effect={notArrived.length === 1 ? 'سيُعلَّم «لم يحضر».' : 'سيُعلَّمون «لم يحضر».'} />

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
