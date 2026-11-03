import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useOrderAlerts, useAutoUnlockAudio } from '../lib/useOrderAlerts.js'
import {
  isNotificationSupported,
  notificationPermission,
  requestNotificationPermission,
  isSoundEnabled,
  setSoundEnabled,
  unlockAudio,
  playAlertSound,
} from '../lib/notifications.js'
import {
  isStandalone,
  isIOS,
  isPushSupported,
  getInstallHint,
  subscribeToPush,
  registerPushWithServer,
  getPushSubscription,
  getVapidPublicKey,
  ensurePushSynced,
} from '../lib/pwa.js'

export default function AdminLayout() {
  const { email, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/quan-tri/dang-nhap', { replace: true })
  }

  /* ---------------- Âm báo đơn mới (toàn bộ khu vực quản trị) ---------------- */

  // Mở khoá âm thanh ngay khi có tương tác đầu tiên trên trang (iOS/Android
  // chặn autoplay nếu không).
  useAutoUnlockAudio()

  // Bật cảnh báo đơn mới (kêu + thông báo hệ thống) ở MỌI tab quản trị,
  // không chỉ tab "Đơn hàng".
  const [newOrders, setNewOrders] = useState([])

  const onNewOrder = useCallback((order) => {
    setNewOrders((prev) => {
      const next = [
        {
          id: order.id,
          code: order.code,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          total: order.total,
        },
        ...prev.filter((o) => o.id !== order.id),
      ]
      return next.slice(0, 5)
    })
  }, [])

  useOrderAlerts(true, onNewOrder)

  // Banner tự ẩn sau 20s (nhưng vẫn còn trong danh sách cho tới khi bấm X).
  useEffect(() => {
    if (newOrders.length === 0) return
    const t = setTimeout(() => setNewOrders((prev) => prev.slice(1)), 20000)
    return () => clearTimeout(t)
  }, [newOrders])

  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [perm, setPerm] = useState(notificationPermission())
  const [toast, setToast] = useState('')

  // Trạng thái PWA: đang mở từ màn hình chính (iPhone) hay trong trình duyệt?
  const [standalone, setStandalone] = useState(isStandalone)
  const [ios, setIos] = useState(isIOS)
  const [pushed, setPushed] = useState(false)

  // Cập nhật lại khi người dùng chuyển app (foreground/background).
  useEffect(() => {
    const refresh = () => {
      setStandalone(isStandalone())
      setIos(isIOS())
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // Kiểm tra đã đăng ký Web Push chưa.
  //
  // QUAN TRỌNG: không chỉ kiểm tra "browser có subscription" mà còn phải
  // ĐỒNG BỘ subscription lên server. Nếu lúc bấm "🔔 Bật thông báo" Edge
  // Function `register-push` chưa deploy (404) thì server không có gì để
  // gửi -> màn hình tắt là im lặng. `ensurePushSynced` tự gửi lại nếu thiếu.
  useEffect(() => {
    let alive = true

    const check = async () => {
      const sub = await getPushSubscription()
      if (!alive) return
      setPushed(Boolean(sub))

      if (sub) {
        const synced = await ensurePushSynced()
        if (alive) setPushed(Boolean(sub) && synced)
      }
    }

    check()
    // Thử lại sau 5s — phòng trường hợp vừa mới deploy function xong.
    const t = setTimeout(check, 5000)

    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const toggleSound = useCallback(() => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) {
      unlockAudio()
      playAlertSound(true) // thử tiếng ngay để chủ quán kiểm tra
      setToast('🔊 Đã bật âm báo đơn mới.')
    } else {
      setToast('🔇 Đã tắt âm báo.')
    }
  }, [soundOn])

  /**
   * Bật thông báo + Web Push.
   *
   * iOS BẮT BUỘC phải mở app từ màn hình chính thì `requestPermission()`
   * mới hoạt động -> nếu đang mở trong tab Safari thì báo rõ để người dùng
   * biết phải làm gì, thay vì báo lỗi chung chung.
   */
  const enableNotifications = useCallback(async () => {
    if (!isNotificationSupported()) {
      setToast('Trình duyệt này không hỗ trợ thông báo.')
      return
    }

    if (isIOS() && !isStandalone()) {
      const hint = getInstallHint()
      setToast(`📲 ${hint?.text || 'Hãy thêm app vào màn hình chính rồi mở lại từ icon.'}`)
      return
    }

    const p = await requestNotificationPermission()
    setPerm(p)

    if (p === 'granted') {
      unlockAudio()
      setToast('🔔 Đã bật thông báo hệ thống.')

      // Đăng ký Web Push để nhận cả khi app đã đóng / màn hình khoá.
      if (isPushSupported() && getVapidPublicKey()) {
        const res = await subscribeToPush()
        setPushed(res.ok)
        if (res.ok) {
          // Gửi lên server để server biết gửi push cho thiết bị này.
          const saved = await registerPushWithServer(res.subscription)
          setToast(
            saved
              ? '🔔 Đã bật thông báo + đăng ký push kể cả khi app đóng.'
              : '⚠️ Đã bật thông báo, nhưng CHƯA lưu được push lên server (server chưa có function). Bấm "📲 Đồng bộ push" sau khi deploy xong.',
          )
        } else {
          setToast('🔔 Đã bật thông báo (chưa đăng ký push khi app đóng).')
        }
      }
    } else if (p === 'denied') {
      setToast('⚠️ Đã chặn thông báo — hãy bật lại trong cài đặt trình duyệt.')
    } else {
      setToast('Chưa được cấp quyền thông báo.')
    }
  }, [])

  // Nhắc nhở bật thông báo hệ thống khi vào khu vực quản trị.
  useEffect(() => {
    if (perm === 'default' && isNotificationSupported()) {
      setToast('💡 Bấm "🔔 Bật thông báo" để nhận báo đơn mới khi đang lướt web.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Đồng bộ subscription lên server (thủ công).
   *
   * Dùng khi: vừa deploy Edge Function `register-push` xong mà app vẫn báo
   * chưa đồng bộ — bấm 1 phát là xong, không cần gỡ/cài lại app.
   */
  const resyncPush = useCallback(async () => {
    setToast('⏳ Đang đồng bộ push lên server...')
    const sub = await getPushSubscription()
    if (!sub) {
      setToast('⚠️ Chưa có subscription trên thiết bị này. Bấm "🔔 Bật thông báo" trước.')
      return
    }
    const saved = await registerPushWithServer(sub)
    setPushed(saved)
    setToast(
      saved
        ? '✅ Đã đồng bộ push lên server. Tắt màn hình thử lại nhé!'
        : '❌ Đồng bộ thất bại — server chưa có Edge Function `register-push`.',
    )
  }, [])

  const installHint = getInstallHint()
  const needsInstall = ios && !standalone

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

      {/* ---- Thanh công cụ âm báo đơn mới ---- */}
      <div className="alert-bar">
        <button
          className={`btn btn-alert ${soundOn ? 'btn-alert-on' : ''}`}
          onClick={toggleSound}
          title={soundOn ? 'Tắt âm báo' : 'Bật âm báo'}
        >
          {soundOn ? '🔊 Âm báo: BẬT' : '🔇 Âm báo: TẮT'}
        </button>

        {isNotificationSupported() && perm !== 'granted' && (
          <button className="btn btn-alert btn-alert-cta" onClick={enableNotifications}>
            🔔 Bật thông báo
          </button>
        )}

        {perm === 'granted' && (
          <span className="alert-bar-ok" title="Thông báo hệ thống đã được bật">
            ✅ Thông báo: BẬT
          </span>
        )}

        {pushed && (
          <span className="alert-bar-ok" title="Đã đăng ký Web Push — nhận được kể cả khi app đóng">
            📲 Push: BẬT
          </span>
        )}

        <button
          className="btn btn-alert"
          onClick={resyncPush}
          title="Gửi lại subscription lên server (dùng sau khi deploy Edge Function)"
        >
          📲 Đồng bộ push
        </button>

        {standalone && (
          <span className="alert-bar-ok" title="Đang chạy từ màn hình chính">
            📱 Đã cài app
          </span>
        )}

        <span className="alert-bar-tip">
          Đơn mới sẽ kêu + hiện thông báo dù bạn đang ở tab nào.
        </span>
      </div>

      {/* ---- Hướng dẫn cài app trên iPhone ---- */}
      {needsInstall && (
        <div className="install-hint" role="note">
          <div className="install-hint-title">{installHint?.title}</div>
          <div className="install-hint-text">{installHint?.text}</div>
          <ol className="install-hint-steps">
            <li>
              Mở trang này bằng <strong>Safari</strong>
            </li>
            <li>
              Bấm nút <strong>Chia sẻ</strong> (⬆️) ở thanh đáy →{' '}
              <strong>Thêm vào Màn hình chính</strong>
            </li>
            <li>
              <strong>Đóng tab Safari</strong>, mở app từ icon trên màn hình chính
            </li>
            <li>
              Bấm <strong>🔔 Bật thông báo</strong> → chọn <strong>Cho phép</strong>
            </li>
          </ol>
        </div>
      )}

      {toast && (
        <div className="alert alert-info alert-toast" role="status">
          {toast}
        </div>
      )}

      {/* ---- Banner đơn mới (nổi bật, tự ẩn sau 20s) ---- */}
      {newOrders.length > 0 && (
        <div className="new-order-banner" role="alert">
          <div className="new-order-banner-head">
            <span className="new-order-banner-title">🔔 Đơn mới!</span>
            <button
              className="btn-icon"
              onClick={() => setNewOrders([])}
              aria-label="Đóng thông báo đơn mới"
            >
              ✕
            </button>
          </div>
          <ul className="new-order-banner-list">
            {newOrders.map((o) => (
              <li key={o.id}>
                <strong>{o.customer_name?.trim() || 'Khách'}</strong>
                {o.customer_phone && (
                  <span className="new-order-banner-phone">📞 {o.customer_phone}</span>
                )}
                {o.code && <span className="new-order-banner-code">#{o.code}</span>}
                {o.total ? (
                  <span className="new-order-banner-total">
                    {Number(o.total).toLocaleString('vi-VN')}đ
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

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
