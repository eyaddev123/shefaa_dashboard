import { useEffect, useState } from 'react'
import { api } from '../api.js'

// شاشة الإعدادات العامة: قيم النظام القابلة للتعديل بدل أن تكون أرقاماً مدفونة في الكود.
// كل إعداد سطر مستقل يُحفظ وحده.
const FLOW_MODE_OPTIONS = { slots: 'الخانات الزمنية (القديم)', attendance: 'ترتيب الحضور' }

function SettingRow({ setting, onSaved, onDirty }) {
  const [value, setValue] = useState(setting.value ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState(null)
  const dirty = String(value) !== String(setting.value ?? '')
  // الصفحة تجمع حالة كل الأسطر لتنبّه قبل المغادرة بتغيير لم يُحفظ
  useEffect(() => { onDirty(setting.key, dirty) }, [dirty])

  const save = async () => {
    // تبديل النمط قرارٌ يمسّ سير العيادة كلها — تأكيدٌ صريح بأثره الحقيقي
    if (setting.key === 'clinic_flow_mode' && !confirm(
      'يسري النمط الجديد على الجلسات التي تُولَّد بعد الحفظ فقط.\n' +
      'جلسات اليوم المولَّدة مسبقاً تبقى على نمطها. متابعة؟')) return
    setBusy(true); setSaved(false); setErr(null)
    try {
      await api.updateSetting(setting.key, value)
      setSaved(true); onSaved()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="setting-row">
      <div className="setting-info">
        <label htmlFor={`set-${setting.key}`}>{setting.label}</label>
        {setting.description && <p className="setting-desc">{setting.description}</p>}
        {setting.updated_by_name && (
          <p className="setting-meta">آخر تعديل: {setting.updated_by_name}</p>
        )}
      </div>
      <div className="setting-control">
        {setting.key === 'clinic_flow_mode' ? (
          // قائمة مغلقة (CHECK في القاعدة + فحص في الخادم) — لا حقل نصّي يُكتب فيه خطأ
          <div>
            <select id={`set-${setting.key}`} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }}>
              {Object.entries(FLOW_MODE_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {/* القيمة المحفوظة فعلاً بجانب القائمة: تغيير القائمة وحده لا يغيّر شيئاً حتى «حفظ» */}
            <div className="setting-saved-value">
              المحفوظ حالياً: <strong>{FLOW_MODE_OPTIONS[setting.value] || setting.value}</strong>
            </div>
          </div>
        ) : setting.value_type === 'bool' ? (
          <select id={`set-${setting.key}`} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }}>
            <option value="true">مفعّل</option>
            <option value="false">معطّل</option>
          </select>
        ) : (
          <input
            id={`set-${setting.key}`}
            type={setting.value_type === 'int' ? 'number' : 'text'}
            min={setting.value_type === 'int' ? 0 : undefined}
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false) }}
          />
        )}
        <button onClick={save} disabled={busy || !dirty}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        {saved && !dirty && <span className="badge good">تم</span>}
        {dirty && <span className="badge setting-unsaved">تغييرات غير محفوظة</span>}
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  )
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => api.settings().then(setSettings).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  // ═══ تنبيه قبل مغادرة الصفحة بتغيير لم يُحفظ ═══
  // حدث فعلاً: بُدّل النمط في القائمة وغودرت الصفحة بلا «حفظ»، فبقي الإعداد القديم
  // وولّدت جلسة اليوم به — بلا أي علامة.
  // البابان: إغلاق/تحديث الصفحة (beforeunload)، والتنقّل داخل التطبيق عبر الروابط.
  // التطبيق على BrowserRouter فلا يعمل useBlocker، فنعترض نقر الروابط في طور الالتقاط.
  const [dirtyKeys, setDirtyKeys] = useState(() => new Set())
  const onDirty = (key, dirty) => setDirtyKeys((prev) => {
    if (prev.has(key) === dirty) return prev
    const next = new Set(prev); dirty ? next.add(key) : next.delete(key); return next
  })
  const hasUnsaved = dirtyKeys.size > 0
  useEffect(() => {
    if (!hasUnsaved) return undefined
    const msg = 'في الإعدادات تغييرات غير محفوظة — المغادرة تُضيعها. متابعة؟'
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = msg; return msg }
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a || a.target === '_blank' || e.defaultPrevented) return
      if (!confirm(msg)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [hasUnsaved])

  if (err) return <p className="error">{err}</p>
  if (!settings) return <p className="empty">جارٍ التحميل…</p>

  return (
    <>
      <h2>الإعدادات</h2>
      <p className="subtitle">
        قيم النظام القابلة للتعديل. تُطبَّق فوراً على الحجوزات الجديدة —
        الحجوزات القائمة تحتفظ بما حُجزت عليه.
      </p>

      <div className="card">
        <h3>إعدادات العيادات</h3>
        {settings.length === 0
          ? <p className="empty">لا إعدادات.</p>
          : settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={load} onDirty={onDirty} />)}
      </div>
    </>
  )
}
