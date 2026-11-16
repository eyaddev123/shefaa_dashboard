import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import { initTheme } from './theme.js'
import { DialogProvider } from './dialogs.jsx'

initTheme()

// ═══ حارس الأخطاء: يحفظ «أيّ مكوّن» انهار، ثمّ يُعيد الخطأ نفسه لشاشة «تعذّر تشغيل الشاشة» ═══
// (2026-11-16: خطأٌ متكرّر على صفحة الجلسة لم يُعرف مكانه — الشاشة كانت تعرض مكان رمي React
// وحده.) مكدّس المكوّنات لشاشة index.html، والخطأ يُرمى بعد لحظة فتعرضه بمكدّسه الأصلي.
// ما يراه المستخدم كما كان: الشاشة نفسها تغطّي كلّ شيء.
class ErrorProbe extends React.Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error, info) {
    try { window.__shefaaComponentStack = info && info.componentStack } catch (e) { /* لا شيء */ }
    setTimeout(() => { throw error })
  }
  render() { return this.state.failed ? null : this.props.children }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorProbe>
      <BrowserRouter>
        {/* نوافذ التأكيد والإدخال متاحةٌ لكل الشاشات — بديل window.confirm/alert/prompt */}
        <DialogProvider>
          <App />
        </DialogProvider>
      </BrowserRouter>
    </ErrorProbe>
  </React.StrictMode>,
)
