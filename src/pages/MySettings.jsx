import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useToast } from '../action-feedback.jsx'
import { ReturnModeField, returnModeOf, returnModeValue } from '../waiting-return-ui.jsx'

// ═══ «الإعدادات» — ما يضبطه الطبيب لنفسه، صفحةٌ في القائمة الجانبية ═══
// كانت زرّاً أعلى «شاشتي» يفتح ورقة؛ نقلها المستخدم إلى القائمة (2026-11-15) ليبقى أعلى الشاشة
// للتنبيه وحده («أحتاج ممرضة» والصوت). الخروج المؤقت: «لحين ما تخبّر الاستقبال» أو «يرجع تلقائياً
// بعد كذا دقيقة» — الإعداد نفسه الذي تضبطه المشرفة في البروفايل، والتغيير في سجلّ الدكتور بفاعله.
export default function MySettingsPage() {
  const [toast, showToast] = useToast()
  const [value, setValue] = useState(null)
  const [saved, setSaved] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.clinic.mySettings().then((r) => { const v = returnModeOf(r.return_after_minutes); setValue(v); setSaved(v) })
      .catch((e) => setErr(e.message))
  }, [])
  const dirty = value && saved && JSON.stringify(value) !== JSON.stringify(saved)
  const save = async () => {
    const v = returnModeValue(value)
    if (v === undefined) return   // التنبيه تحت الحقل مباشرةً (ReturnModeField)
    setErr(null); setBusy(true)
    try {
      const r = await api.clinic.saveMySettings({ return_after_minutes: v })
      const now = returnModeOf(r.return_after_minutes)
      setValue(now); setSaved(now)
      showToast(r.return_after_minutes == null ? 'حُفظ: الخروج المؤقت لحين ما تخبّر الاستقبال'
        : `حُفظ: يرجع على الدور تلقائياً بعد ${Number(r.return_after_minutes).toLocaleString('ar-SY')} دقيقة`, 'success', 4000)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <div className="dp ds">
      <h2>الإعدادات</h2>
      <p className="subtitle">تخصّك وحدك — والمشرفة تراها في بروفايلك</p>
      {toast}
      <div className="card">
        {value ? <ReturnModeField value={value} onChange={(v) => { setValue(v); setErr(null) }} name="my_return_mode" />
          : !err && <p className="empty">جارٍ التحميل…</p>}
        {err && <p className="error" role="alert">{err}</p>}
        {value && (
          <div className="ds-foot">
            <button type="button" disabled={busy || !dirty} onClick={save}>حفظ</button>
            {dirty && <button type="button" className="ghost" onClick={() => { setValue(saved); setErr(null) }}>تراجع</button>}
          </div>
        )}
      </div>
    </div>
  )
}
