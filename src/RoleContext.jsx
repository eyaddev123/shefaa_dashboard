import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken } from './api.js'

// المصادقة الحقيقية: الدور وهوية عضو المجلس يأتيان من حساب الدخول
const AuthContext = createContext(null)

export function RoleProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())

  useEffect(() => {
    if (getToken()) {
      api.me().then(setUser).catch(() => localStorage.removeItem('token')).finally(() => setLoading(false))
    }
    const onExpire = () => setUser(null)
    window.addEventListener('auth-expired', onExpire)
    return () => window.removeEventListener('auth-expired', onExpire)
  }, [])

  const login = async (username, password) => {
    const { token, user: u } = await api.login(username, password)
    localStorage.setItem('token', token)
    setUser(u)
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  const value = {
    user,
    loading,
    login,
    logout,
    role: user?.role || null,
    member: user?.board_member_id
      ? { id: user.board_member_id, name: user.display_name, title: user.member_title }
      : null,
    isChairman: !!user?.is_chairman,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useRole = () => useContext(AuthContext)
