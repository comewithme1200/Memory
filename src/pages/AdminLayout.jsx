import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function AdminLayout() {
  const { email, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/quan-tri/dang-nhap', { replace: true })
  }

  return (
    <div className="page page-admin">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🍜</span>
          <div>
            <h1>Quản lý quán</h1>
            <p className="brand-sub">
              Đang đăng nhập: <strong>{email}</strong>
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={handleSignOut}>
          Đăng xuất
        </button>
      </header>

      <nav className="tabs">
        <NavLink className="tab" to="/quan-tri/mon">
          🍽️ Món ăn
        </NavLink>
        <NavLink className="tab" to="/quan-tri/tuy-chon">
          ⚙️ Tuỳ chọn
        </NavLink>
        <NavLink className="tab" to="/quan-tri/orders">
          🧾 Đơn hàng
        </NavLink>
        <NavLink className="tab" to="/quan-tri/khach">
          👥 Khách quen
        </NavLink>
        <NavLink className="tab" to="/quan-tri/tong-ket">
          📊 Tổng kết
        </NavLink>
      </nav>

      {/* Outlet hiển thị trang con (Món / Đơn hàng / Khách quen / Tổng kết) */}
      <Outlet />
    </div>
  )
}
