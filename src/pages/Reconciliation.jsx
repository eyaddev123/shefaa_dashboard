import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, fmtDate, fmtMoney } from '../api.js'

// كشف الأمين CSV: request_id,amount,date,doc_no (مع أو بدون سطر عناوين)
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const rows = []
  for (const line of lines) {
    const cols = line.split(/[,;\t]/).map((c) => c.trim())
    if (!cols[0] || isNaN(Number(cols[0]))) continue // تجاوز سطر العناوين
    rows.push({ request_id: cols[0], amount: cols[1], date: cols[2], doc_no: cols[3] })
  }
  return rows
}

export default function Reconciliation() {
  const [pending, setPending] = useState([])
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [drag, setDrag] = useState(false)

  const load = () => api.reconciliationPending().then(setPending)
  useEffect(() => { load() }, [])

  const handleFile = async (file) => {
    if (!file) return
    setErr(null); setResult(null)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length === 0) throw new Error('لم يُعثر على صفوف صالحة — الصيغة: request_id,amount,date,doc_no')
      const res = await api.reconciliationImport(rows)
      setResult(res)
      load()
    } catch (ex) { setErr(ex.message) }
  }

  const importFile = async (e) => {
    await handleFile(e.target.files?.[0])
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <>
      <h2>المطابقة مع برنامج الأمين</h2>
      <p className="subtitle">
        آخر الشهر/السنة: صدّر كشف القيود من الأمين (حقل مخصص فيه رقم الطلب) واستورده هنا.
        الطلب الموجود في الكشف = المستفيد استفاد فعلاً؛ غير الموجود = لم يستفد.
      </p>

      <div className="card">
        <h3>استيراد كشف الأمين (CSV)</h3>
        <p className="subtitle" style={{ marginBottom: 12 }}>
          الأعمدة المطلوبة بالترتيب: <code dir="ltr">request_id, amount, date, doc_no</code>
        </p>
        <label className={`dropzone ${drag ? 'drag' : ''}`} style={{ display: 'block' }}
               onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
               onDragLeave={() => setDrag(false)}
               onDrop={onDrop}>
          <span className="dz-icon">📥</span>
          اسحب ملف كشف الأمين هنا أو انقر للاختيار
          <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={importFile} />
        </label>
        {err && <p className="error">{err}</p>}
        {result && (
          <div style={{ marginTop: 14, fontSize: 13.5 }}>
            <p><span className="badge good">تمت المطابقة: {result.matched.length} طلب</span>{' '}
              {result.matched.map((id) => <Link key={id} className="plain" style={{ marginInlineStart: 6 }} to={`/requests/${id}`}>#{id}</Link>)}
            </p>
            {result.unknown.length > 0 && (
              <p style={{ marginTop: 6 }}><span className="badge bad">أرقام طلبات غير معروفة: {result.unknown.length}</span>{' '}
                {result.unknown.map((r, i) => <span key={i} style={{ marginInlineStart: 6 }}>{r.request_id}</span>)}
              </p>
            )}
            {result.skipped.length > 0 && (
              <p style={{ marginTop: 6 }}><span className="badge warn">تم تجاوزها: {result.skipped.length}</span></p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>طلبات معتمدة لم تظهر في الكشوف بعد — «أخذ الموافقة وما استفاد»</h3>
        <table>
          <thead>
            <tr>
              <th>الطلب</th><th>الملف</th><th>رب العائلة</th><th>النوع</th>
              <th>القرار</th><th>تاريخ القرار</th><th>أُبلغ؟</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id}>
                <td><Link className="plain" to={`/requests/${r.id}`}>#{r.id} (طلب {r.request_no})</Link></td>
                <td className="num">{r.file_number}</td>
                <td>{r.head_name}</td>
                <td>{AID_TYPES[r.aid_type]}</td>
                <td>{DECISION_TYPES[r.decision_type]}{r.decision_value != null && ` — ${r.decision_type === 'percentage' ? Number(r.decision_value) + '٪' : fmtMoney(r.decision_value)}`}</td>
                <td>{fmtDate(r.decided_at)}</td>
                <td>{r.notified_at ? <span className="badge good">نعم</span> : <span className="badge warn">لا</span>}</td>
              </tr>
            ))}
            {pending.length === 0 && <tr><td colSpan={7} className="empty">كل الطلبات المعتمدة تمت مطابقتها ✓</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
