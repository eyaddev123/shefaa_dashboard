import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import useDraft, { fmtDraftTime } from '../useDraft.js'

const BLANK = {
  file_number: '', serial_no: '', head_name: '', applicant_name: '',
  current_address: '', previous_address: '', phone: '', mobile: '',
  family_card_no: '', notes: '',
}

// صفحة فتح ملف عائلة جديد — بحفظ تلقائي للمسودة
export default function NewFamily() {
  const { role } = useRole()
  const navigate = useNavigate()
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const { savedAt, restored, clearDraft } = useDraft(
    'draft:new-family',
    form,
    (d) => setForm({ ...BLANK, ...d }),
    (s) => Object.values(s).every((v) => !v || !String(v).trim()),
  )

  if (role !== 'officer') {
    return (
      <>
        <h2>فتح ملف عائلة جديد</h2>
        <div className="card"><p className="empty">فتح الملفات من صلاحية موظف الإدخال فقط.</p></div>
      </>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const created = await api.addFamily(form)
      clearDraft()
      navigate(`/families/${created.id}`)
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }

  const discard = () => {
    clearDraft()
    setForm(BLANK)
  }

  return (
    <>
      <h2>فتح ملف عائلة جديد</h2>
      <p className="subtitle">
        <Link className="plain" to="/families">← عودة إلى العائلات</Link>
        {' · '}بعد فتح الملف ستنتقل لصفحته لإضافة الأفراد
      </p>

      {restored && (
        <div className="draft-bar">
          📝 استُعيدت مسودة محفوظة تلقائياً {savedAt && `(آخر حفظ ${fmtDraftTime(savedAt)})`} — لم يضِع شيء.
          <button type="button" onClick={discard}>تجاهل المسودة والبدء من جديد</button>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="card">
          <h3 style={{ justifyContent: 'space-between' }}>
            ١ · بيانات الملف
            {savedAt && !restored && <span className="draft-saved">يُحفظ تلقائياً ✓ {fmtDraftTime(savedAt)}</span>}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="field"><label>رقم الملف *</label><input value={form.file_number} onChange={set('file_number')} required autoFocus placeholder="مثل 1.13" /></div>
            <div className="field"><label>المسلسل</label><input value={form.serial_no} onChange={set('serial_no')} placeholder="S-2026-013" dir="ltr" /></div>
            <div className="field"><label>رقم البطاقة العائلية</label><input value={form.family_card_no} onChange={set('family_card_no')} dir="ltr" /></div>
          </div>
        </div>

        <div className="card">
          <h3>٢ · رب العائلة ومقدّم الطلب</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 220 }}><label>اسم رب العائلة *</label><input value={form.head_name} onChange={set('head_name')} required /></div>
            <div className="field" style={{ minWidth: 220 }}><label>مقدّم الطلب (إن اختلف)</label><input value={form.applicant_name} onChange={set('applicant_name')} /></div>
          </div>
        </div>

        <div className="card">
          <h3>٣ · العنوان والتواصل</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 260 }}><label>العنوان الحالي</label><input value={form.current_address} onChange={set('current_address')} /></div>
            <div className="field" style={{ minWidth: 260 }}><label>العنوان السابق</label><input value={form.previous_address} onChange={set('previous_address')} /></div>
            <div className="field"><label>الهاتف</label><input value={form.phone} onChange={set('phone')} dir="ltr" /></div>
            <div className="field"><label>الجوال (واتساب) *</label><input value={form.mobile} onChange={set('mobile')} dir="ltr" placeholder="09XXXXXXXX" /></div>
          </div>
        </div>

        <div className="card">
          <h3>٤ · ملاحظات</h3>
          <textarea rows={3} style={{ width: '100%' }} value={form.notes} onChange={set('notes')}
                    placeholder="أرملة تعيل ثلاثة أولاد / عائلة نازحة / …" />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 30 }}>
          <button type="submit" disabled={busy || !form.file_number || !form.head_name} style={{ padding: '12px 32px', fontSize: 15 }}>
            {busy ? 'جارٍ الفتح…' : '✓ فتح الملف والانتقال لإضافة الأفراد'}
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/families')}>إلغاء (تبقى المسودة محفوظة)</button>
          {err && <span className="error" style={{ margin: 0 }}>{err}</span>}
        </div>
      </form>
    </>
  )
}
