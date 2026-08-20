import { useState } from 'react'
import { useRole } from '../RoleContext.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

export default function Login() {
  const { login } = useRole()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try { await login(username, password) }
    catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <ThemeToggle variant="plain" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🏥</div>
        <h1>جمعية الشفاء الخيرية</h1>
        <p>نظام إدارة طلبات المساعدة الطبية</p>

        <div className="field">
          <label>اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoFocus required
                 name="username" autoComplete="username" />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" required
                 name="password" autoComplete="current-password" />
        </div>
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}</button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  )
}
