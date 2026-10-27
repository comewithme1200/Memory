import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

/**
 * Chặn mọi trang quản trị. Chưa đăng nhập thì chuyển sang trang đăng nhập.
 * Nhớ vị trí để sau khi đăng nhập xong quay lại đúng trang đang xem.
 */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="page"><div className="empty">Đang kiểm tra phiên đăng nhập…</div></div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/quan-tri/dang-nhap" replace state={{ from: location.pathname }} />
  }

  return children
}
