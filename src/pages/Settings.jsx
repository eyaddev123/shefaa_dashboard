import { useEffect, useState } from 'react'
import { api } from '../api.js'

// شاشة الإعدادات العامة: قيم النظام القابلة للتعديل بدل أن تكون أرقاماً مدفونة في الكود.
// كل إعداد سطر مستقل يُحفظ وحده.
function SettingRow({ setting, onSaved }) {
  const [value, setValue] = useState(setting.value ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState(null)
  const dirty = String(value) !== String(setting.value ?? '')

  const save = async () => {
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
        {setting.value_type === 'bool' ? (
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
          : settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={load} />)}
      </div>
    </>
  )
}
