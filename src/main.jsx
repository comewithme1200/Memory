import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import {
  registerServiceWorker,
  warmUpServiceWorker,
  redirectToAdminIfFromHomeScreen,
} from './lib/pwa.js'

// Mở app từ ICON màn hình chính -> luôn vào trang quản trị.
//
// iOS lưu lại URL đang mở lúc bấm "Thêm vào Màn hình chính", không phải
// `start_url` trong manifest. Nên nếu lúc đó bạn đang đứng ở trang đặt
// hàng, mở icon lên lại vẫn ra trang đặt hàng. Hàm này sửa lại điều đó.
//
// CHỈ chuyển 1 lần mỗi phiên -> sau đó vẫn xem được trang đặt hàng bình thường.
//
// Phải chạy TRƯỚC khi render React: HashRouter đọc `location.hash` lúc mount,
// nên đổi hash trước đó thì router khởi tạo đúng trang quản trị.
redirectToAdminIfFromHomeScreen()

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
//
// `warmUpServiceWorker()` giữ lại promise của registration để lúc chủ quán
// bấm nút "🔔 Bật thông báo" thì KHÔNG phải chờ đăng ký SW — WebKit yêu cầu
// thao tác chạm còn "sống" tại thời điểm hiện hộp thoại quyền.
warmUpServiceWorker()
registerServiceWorker()
