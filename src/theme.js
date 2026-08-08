// مبدّل الوضع: light / dark / system
// خيار "system" يُحوَّل هنا إلى قيمة فعلية على data-theme ويتابع تغيّر نظام التشغيل حيّاً

const KEY = 'theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export const getThemePref = () => localStorage.getItem(KEY) || 'system'

const resolve = (pref) => (pref === 'system' ? (media.matches ? 'dark' : 'light') : pref)

const apply = (pref) => {
  document.documentElement.dataset.theme = resolve(pref)
}

export function setThemePref(pref) {
  localStorage.setItem(KEY, pref)
  apply(pref)
}

// يُستدعى مرة واحدة قبل أول رسم (من main.jsx)
export function initTheme() {
  apply(getThemePref())
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') apply('system')
  })
}
