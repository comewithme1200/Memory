import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function LoginPage() {
  const { signIn, signInWithPin, isDemoMode, demoPin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from || '/quan-tri/mon'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (isDemoMode) {
        signInWithPin(pin)
      } else {
        await signIn(email.trim(), password)
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại.')
      setBusy(false)
    }
  }

  return (
    <div className="page page-center">
      <div className="card login-card">
        <div className="brand-mark login-mark">🔐</div>
        <h1>Đăng nhập quản trị</h1>
        <p className="muted login-sub">
          Khu vực dành riêng cho chủ quán. Khách hàng không cần đăng nhập để đặt món.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit} className="login-form">
          {isDemoMode ? (
            <>
              <div className="alert alert-success demo-note">
                <div>
                  <strong>Chế độ demo</strong> — chưa kết nối Supabase nên dùng mã PIN.
                  <div className="small">Mã PIN: <code>{demoPin}</code></div>
                </div>
              </div>
              <div className="field">
                <label>Mã PIN</label>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Nhập PIN"
                  type="password"
                  inputMode="numeric"
                  autoFocus
                />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="chuquan@example.com"
                  type="email"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Mật khẩu</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="current-password"
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        <div className="login-foot">
          <Link to="/">← Về trang đặt món</Link>
        </div>
      </div>
    </div>
  )
}
