import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import { initTheme } from './theme.js'
import { DialogProvider } from './dialogs.jsx'

initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* نوافذ التأكيد والإدخال متاحةٌ لكل الشاشات — بديل window.confirm/alert/prompt */}
      <DialogProvider>
        <App />
      </DialogProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
