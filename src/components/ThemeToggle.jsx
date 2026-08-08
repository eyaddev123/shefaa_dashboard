import { useState } from 'react'
import { getThemePref, setThemePref } from '../theme.js'

const OPTIONS = [
  { value: 'light', label: '☀️ فاتح' },
  { value: 'dark', label: '🌙 داكن' },
  { value: 'system', label: '🖥️ تلقائي' },
]

// variant="sidebar" داخل الشريط الجانبي الداكن | variant="plain" فوق صفحة عادية (الدخول)
export default function ThemeToggle({ variant = 'sidebar' }) {
  const [pref, setPref] = useState(getThemePref)
  const choose = (value) => {
    setThemePref(value)
    setPref(value)
  }
  return (
    <div className={`theme-toggle ${variant === 'plain' ? 'plain' : ''}`} role="group" aria-label="وضع الألوان">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button"
                className={pref === o.value ? 'on' : ''}
                onClick={() => choose(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
