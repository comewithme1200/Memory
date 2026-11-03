import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { registerServiceWorker } from './lib/pwa.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Đăng ký Service Worker -> BẮT BUỘC cho Web Push trên iPhone
// (Safari iOS không hỗ trợ `new Notification()`, chỉ có
// `registration.showNotification()` mới hiện được thông báo).
//
// Đăng ký thất bại (http, trình duyệt cũ,...) không ảnh hưởng app.
registerServiceWorker()
