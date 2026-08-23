import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, AID_TYPES, DECISION_TYPES, PAYMENT_METHODS, RELATIONS, SERVICE_UNITS, STATUSES, committedFromDecision, fmtDate, fmtMoney } from '../api.js'
import { useRole } from '../RoleContext.jsx'

// 09XXXXXXXX → 9639XXXXXXXX لرابط واتساب
const waNumber = (mobile) => {
  const digits = (mobile || '').replace(/\D/g, '')
  if (digits.startsWith('09')) return '963' + digits.slice(1)
  if (digits.startsWith('963')) return digits
  return digits
}

function ReviewForm({ request, onSaved }) {
  const { member } = useRole()
  const [approved, setApproved] = useState('true')
  const [recommendation, setRecommendation] = useState('')
  const [err, setErr] = useState(null)
  if (!member) return null
  const mine = request.reviews.find((r) => r.board_member_id === member.id)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addReview(request.id, {
        board_member_id: member.id,
        approved: approved === 'true',
        recommendation,
      })
      setRecommendation('')
      onSaved()
    } catch (e) { setErr(e.message) }
  }

  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field">
        <label>رأيك ({member.name})</label>
        <select value={approved} onChange={(e) => setApproved(e.target.value)}>
          <option value="true">موافق</option>
          <option value="false">غير موافق</option>
        </select>
      </div>
      <div className="field" style={{ flex: 1 }}>
        <label>التوصية</label>
        <textarea rows={2} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} required />
      </div>
      <button type="submit">{mine ? 'تحديث مراجعتي' : 'تسجيل مراجعتي'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function DecisionForm({ request, onSaved }) {
  const { member } = useRole()
  const [form, setForm] = useState({ decision_type: 'percentage', decision_value: '', decision_text: '', session_no: '' })
  const [treasury, setTreasury] = useState(null)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => { api.treasury().then(setTreasury).catch(() => {}) }, [])

  // معاينة حية للالتزام الناتج عن القرار المُدخل
  const committed = committedFromDecision(form.decision_type, form.decision_value, request.expected_cost)
  const exceeds = treasury && committed > treasury.available

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addDecision(request.id, {
        ...form,
        decision_value: form.decision_value ? Number(form.decision_value) : null,
        board_member_id: member.id,
      })
      onSaved()
    } catch (e) { setErr(e.message) }
  }

  return (
    <>
      {treasury && (
        <div className="finance-mini" style={{ marginTop: 14 }}>
          <span>الكلفة المتوقعة لهذا الطلب: <strong>{fmtMoney(request.expected_cost)}</strong></span>
          <span>المتاح بالخزينة حالياً: <strong style={{ color: treasury.available < 0 ? 'var(--status-bad)' : 'var(--status-good)' }}>{fmtMoney(treasury.available)}</strong></span>
          {committed > 0 && (
            <span>التزام هذا القرار: <strong>{fmtMoney(committed)}</strong></span>
          )}
        </div>
      )}
      {exceeds && (
        <div className="warn-box" style={{ marginTop: 10 }}>
          ⚠️ الالتزام الناتج عن هذا القرار ({fmtMoney(committed)}) يتجاوز المتاح بالخزينة ({fmtMoney(treasury.available)})
          بمقدار {fmtMoney(committed - treasury.available)}. القرار بيدك — لكن يُنصح بتدبير إيرادات إضافية قبل الصرف.
        </div>
      )}
      <form className="inline" onSubmit={submit} style={{ marginTop: 14 }}>
        <div className="field">
          <label>نوع القرار</label>
          <select value={form.decision_type} onChange={set('decision_type')}>
            {Object.entries(DECISION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label>القيمة (نسبة أو مبلغ)</label><input type="number" value={form.decision_value} onChange={set('decision_value')} /></div>
        <div className="field"><label>رقم الجلسة</label><input value={form.session_no} onChange={set('session_no')} /></div>
        <div className="field" style={{ flex: 1 }}><label>نص القرار</label><textarea rows={2} value={form.decision_text} onChange={set('decision_text')} required /></div>
        <button type="submit">اعتماد القرار النهائي</button>
        {err && <p className="error">{err}</p>}
      </form>
    </>
  )
}

export default function RequestDetail() {
  const { id } = useParams()
  const [r, setR] = useState(null)
  const [err, setErr] = useState(null)
  const { role, isChairman } = useRole()

  const load = useCallback(() => api.request(id).then(setR).catch((e) => setErr(e.message)), [id])
  useEffect(() => { load() }, [load])

  if (err) return <p className="error">{err}</p>
  if (!r) return <p className="empty">جارٍ التحميل…</p>

  const totalMembers = r.board.length
  const approvals = r.reviews.filter((x) => x.approved).length
  // نفس شرط الخادم حرفياً: **لا عضو نشط بلا مراجعة**، لا مجرّد عدّ.
  // (r.reviews قد تحوي مراجعات أعضاء أُوقفوا لاحقاً، فيبلغ العدد النِّصاب زوراً
  //  بينما عضو نشط لم يراجع — فتَعِد الواجهة بقرار يرفضه الخادم بـ 409.)
  const pendingMembers = r.board.filter((m) => !r.reviews.some((x) => x.board_member_id === m.id))
  const allReviewed = pendingMembers.length === 0
  const decided = !!r.decision_type

  const notifyWhatsApp = async () => {
    try {
      await api.notify(r.id)
      const msg =
        `السلام عليكم، جمعية الشفاء الخيرية.\n` +
        `تمت الموافقة على طلبكم رقم ${r.request_no} (ملف ${r.file_number}) — ${DECISION_TYPES[r.decision_type]}` +
        (r.decision_value ? ` (${r.decision_type === 'percentage' ? r.decision_value + '٪' : fmtMoney(r.decision_value)})` : '') +
        `.\nالرجاء الحضور إلى مقر الجمعية لاستلام الوصل.`
      window.open(`https://wa.me/${waNumber(r.mobile || r.family_mobile || '')}?text=${encodeURIComponent(msg)}`, '_blank')
      load()
    } catch (e) { alert(e.message) }
  }

  // المرفقات لم تعد روابط مباشرة: مجلد uploads مغلق، والملف يُجلب بالتوكن ثم يُفتح
  const openAttachment = async (attachmentId) => {
    try { await api.openAttachment(attachmentId) } catch (ex) { alert(ex.message) }
  }

  const uploadFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try { await api.uploadAttachment(r.id, file); load() } catch (ex) { alert(ex.message) }
    e.target.value = ''
  }

  // مؤشر خطوات دورة الحياة
  const flowSteps = [
    { key: 'submitted', label: 'مُقدّم', done: true },
    { key: 'review', label: `مراجعة المجلس ${r.reviews.length}/${totalMembers}`, done: allReviewed, now: !allReviewed && !decided },
    { key: 'decided', label: 'القرار النهائي', done: decided, now: allReviewed && !decided },
    { key: 'notified', label: 'إبلاغ المستفيد', done: !!r.notified_at, now: decided && !r.notified_at && r.decision_type !== 'rejected' },
    { key: 'fulfilled', label: 'استفاد (مطابقة الأمين)', done: !!r.fulfilled_at, now: !!r.notified_at && !r.fulfilled_at },
  ]

  return (
    <>
      <h2>طلب رقم {r.request_no} — ملف {r.file_number}</h2>
      <p className="subtitle" style={{ marginBottom: 10 }}>
        {AID_TYPES[r.aid_type]} · قُدّم في {fmtDate(r.requested_at)} ·{' '}
        <span className="badge blue">{STATUSES[r.status]}</span>
        {r.notified_at && <> · <span className="badge good">أُبلغ المستفيد ✓</span></>}
        {r.fulfilled_at && <> · <span className="badge good">استفاد فعلاً ✓</span></>}
      </p>
      <div className="flow-steps" style={{ marginBottom: 20 }}>
        {flowSteps.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', gap: 6 }}>
            {i > 0 && <span className="arrow">←</span>}
            <span className={`step ${s.done ? 'done' : ''} ${s.now ? 'now' : ''}`}>
              {s.done ? '✓' : ''} {s.label}
            </span>
          </span>
        ))}
      </div>

      <div className="card">
        <h3>تفاصيل الطلب</h3>
        <p style={{ fontSize: 14, lineHeight: 1.8 }}>{r.description}</p>
        {(r.expected_cost || r.service_name) && (
          <p style={{ marginTop: 10, fontSize: 13 }}>
            💰 الكلفة المتوقعة: <strong>{fmtMoney(r.expected_cost)}</strong>
            {r.service_name && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {' '}— {r.service_name}
                {r.quantity > 1 && ` × ${r.quantity} ${SERVICE_UNITS[r.service_unit] === 'شهرياً' ? 'شهر' : 'جلسة/وحدة'}`}
              </span>
            )}
          </p>
        )}
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
          المستفيدون:{' '}
          {r.beneficiaries.map((b, i) => (
            <span key={b.id}>
              {i > 0 && '، '}
              <Link className="plain" to={`/persons/${b.id}`}>{b.name}</Link> ({RELATIONS[b.relation]})
            </span>
          ))}
        </p>
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>المرفقات:</strong>{' '}
          {r.attachments.length === 0 && <span className="empty">لا مرفقات</span>}
          {r.attachments.map((a) => (
            <button key={a.id} type="button" className="plain"
                    style={{ marginInlineStart: 10, fontSize: 13, background: 'none', border: 'none',
                             padding: 0, cursor: 'pointer', color: 'var(--primary)' }}
                    onClick={() => openAttachment(a.id)}>
              📎 {a.original_name}
            </button>
          ))}
          {role === 'officer' && (
            <label style={{ display: 'inline-block', marginInlineStart: 14, fontSize: 13, cursor: 'pointer', color: 'var(--primary)' }}>
              + إرفاق صورة/ملف
              <input type="file" style={{ display: 'none' }} onChange={uploadFile} />
            </label>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>
            مراجعات مجلس الإدارة — {r.reviews.length}/{totalMembers}{' '}
            <span className="progress5">
              {r.board.map((m) => {
                const rev = r.reviews.find((x) => x.board_member_id === m.id)
                const initial = m.name.replace(/^(د|أ|م)\. /, '').trim()[0]
                return (
                  <span key={m.id} className={rev ? (rev.approved ? 'ok' : 'no') : ''}
                        title={`${m.name} — ${rev ? (rev.approved ? 'موافق' : 'غير موافق') : 'لم يراجع بعد'}`}>
                    {initial}
                  </span>
                )
              })}
            </span>
          </h3>
          {r.reviews.map((rev) => (
            <div className="review" key={rev.id}>
              <div className="who">
                <div className="name">{rev.member_name}</div>
                <div className="title">{rev.member_title}</div>
                <span className={`badge ${rev.approved ? 'good' : 'bad'}`}>{rev.approved ? 'موافق' : 'غير موافق'}</span>
              </div>
              <div className="rec">{rev.recommendation}</div>
              <div className="when">{fmtDate(rev.reviewed_at)}</div>
            </div>
          ))}
          {r.reviews.length === 0 && <p className="empty">لم يراجع أحد بعد</p>}
          {/* سجلّ تعديلات المراجعات — الخادم لا يرسله إلا للرئيس، فلا يظهر لغيره */}
          {r.review_history?.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                سجلّ التعديلات على المراجعات ({r.review_history.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                {r.review_history.map((h) => (
                  <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>{h.member_name}</strong>
                    {' — كان: '}
                    <span className={`badge ${h.decision ? 'good' : 'bad'}`}>
                      {h.decision ? 'موافق' : 'غير موافق'}
                    </span>
                    {h.recommendation && <div className="rec">{h.recommendation}</div>}
                    <div className="when">عُدِّل في {fmtDate(h.changed_at)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {role === 'board' && !decided && <ReviewForm request={r} onSaved={load} />}
        </div>

        <div>
          <div className="card">
            <h3>القرار النهائي</h3>
            {decided ? (
              <div className={`decision-box ${r.decision_type === 'rejected' ? 'rejected' : ''}`}>
                <strong>{DECISION_TYPES[r.decision_type]}</strong>
                {r.decision_value != null && (
                  <> — {r.decision_type === 'percentage' ? `${Number(r.decision_value)}٪` : fmtMoney(r.decision_value)}</>
                )}
                <p style={{ fontSize: 13, marginTop: 6 }}>{r.decision_text}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  جلسة {r.session_no || '—'} · {fmtDate(r.decided_at)}
                </p>
                {r.decision_type !== 'rejected' && (
                  <button className="whatsapp" style={{ marginTop: 12 }} onClick={notifyWhatsApp}>
                    {r.notified_at ? 'إعادة إرسال إشعار واتساب' : '📱 إبلاغ المستفيد عبر واتساب'}
                  </button>
                )}
              </div>
            ) : allReviewed ? (
              isChairman
                ? <><p className="empty">اكتملت مراجعات الأعضاء — بانتظار قرارك</p><DecisionForm request={r} onSaved={load} /></>
                : <p className="empty">اكتملت المراجعات ({approvals} موافقة) — القرار النهائي بيد المدير المسؤول</p>
            ) : (
              <p className="empty">
                لا يُتخذ القرار قبل مراجعة كل الأعضاء النشطين — بقي {pendingMembers.length} من {totalMembers}
                {pendingMembers.length > 0 && `: ${pendingMembers.map((m) => m.name).join('، ')}`}
              </p>
            )}
          </div>

          <div className="card">
            <h3>سندات الصرف على هذا الطلب</h3>
            <table>
              <thead><tr><th>رقم السند</th><th>المبلغ</th><th>التاريخ</th><th>الطريقة</th><th>المصدر</th></tr></thead>
              <tbody>
                {r.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="num" dir="ltr">{v.voucher_no}</td>
                    <td className="num">{fmtMoney(v.amount)}</td>
                    <td>{fmtDate(v.disbursed_at)}</td>
                    <td>{PAYMENT_METHODS[v.payment_method]}</td>
                    <td>{v.source === 'ameen_import' ? <span className="badge blue">كشف الأمين</span> : 'يدوي'}</td>
                  </tr>
                ))}
                {r.vouchers.length === 0 && <tr><td colSpan={5} className="empty">لا صرف بعد — بانتظار مطابقة كشف الأمين</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>القصة الكاملة للعائلة — {r.head_name} <Link className="plain" style={{ fontSize: 13 }} to={`/families/${r.family_id}`}>فتح الملف</Link></h3>
        <p className="subtitle" style={{ marginBottom: 12 }}>
          إجمالي ما صُرف لهذه العائلة عبر كل الطلبات: <strong>{fmtMoney(r.family_disbursed_total)}</strong>
        </p>
        <div className="grid2">
          <table>
            <thead><tr><th>الفرد</th><th>القرابة</th><th>التولّد</th><th>المهنة</th></tr></thead>
            <tbody>
              {r.family_members.map((m) => (
                <tr key={m.id}>
                  <td><Link className="plain" to={`/persons/${m.id}`}>{m.name}</Link></td>
                  <td>{RELATIONS[m.relation]}</td>
                  <td className="num">{m.birth_year || '—'}</td><td>{m.occupation || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead><tr><th>طلب</th><th>النوع</th><th>الحالة</th><th>المصروف</th></tr></thead>
            <tbody>
              {r.family_requests.map((q) => (
                <tr key={q.id} style={q.id === r.id ? { background: 'rgba(42,120,214,.06)' } : undefined}>
                  <td className="num">
                    {q.id === r.id ? <strong>#{q.request_no} (هذا الطلب)</strong> : <Link className="plain" to={`/requests/${q.id}`}>#{q.request_no}</Link>}
                  </td>
                  <td>{AID_TYPES[q.aid_type]}</td>
                  <td><span className="badge">{STATUSES[q.status]}</span></td>
                  <td className="num">{fmtMoney(q.disbursed_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
