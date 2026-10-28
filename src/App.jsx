import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/auth.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import OrderPage from './pages/OrderPage.jsx'
import AdminLayout from './pages/AdminLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MenuPage from './pages/MenuPage.jsx'
import OrdersPage from './pages/OrdersPage.jsx'
import SummaryPage from './pages/SummaryPage.jsx'
import SuccessPage from './pages/SuccessPage.jsx'
import CustomersPage from './pages/CustomersPage.jsx'
import OptionsPage from './pages/OptionsPage.jsx'

// Dùng HashRouter (#) để deploy lên GitHub Pages không cần cấu hình redirect 404.
export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          {/* Trang cho khách đặt hàng - KHÔNG cần đăng nhập */}
          <Route path="/" element={<OrderPage />} />
          <Route path="/dat-hang/thanh-cong" element={<SuccessPage />} />

          {/* Trang đăng nhập của chủ quán */}
          <Route path="/quan-tri/dang-nhap" element={<LoginPage />} />

          {/* Toàn bộ trang quản trị đều phải đăng nhập */}
          <Route
            path="/quan-tri"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="mon" replace />} />
            <Route path="mon" element={<MenuPage />} />
            <Route path="tuy-chon" element={<OptionsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="tong-ket" element={<SummaryPage />} />
            <Route path="khach" element={<CustomersPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
