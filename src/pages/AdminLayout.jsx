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
  getPushDiagnostics,
  unsubscribeFromPush,
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
  // Kết quả chẩn đoán push (hiển thị khi bấm nút "🩺 Chẩn đoán push")
  const [diag, setDiag] = useState(null)

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

      // `ensurePushSynced` tự TẠO subscription nếu chưa có (khi permission đã
      // granted) rồi đồng bộ lên server. Gọi luôn, không phụ thuộc `sub`.
      const res = await ensurePushSynced()
      if (!alive) return
      if (res?.ok) setPushed(true)
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

    // QUAN TRỌNG (WebKit/iOS): `Notification.requestPermission()` phải được
    // gọi KỰ trong event handler, không được `await` bất cứ thứ gì trước đó
    // (một await có thể làm mất "transient activation" -> hộp thoại không
    // hiện và trả về "denied" một cách bí ��t).
    //
    // Ta gọi `requestPermission()` trước, giữ promise, rồi mới làm việc khác.
    const permissionPromise = requestNotificationPermission()

    const p = await permissionPromise
    setPerm(p)

    if (p === 'granted') {
      unlockAudio()

      // Đăng ký Web Push để nhận cả khi app đã đóng / màn hình khoá.
      //
      // Lưu ý iOS/WebKit: `Notification.requestPermission()` đã tiêu thụ
      // transient activation của cú chạm. Nhưng khi permission đã "granted"
      // thì `subscribe()` KHÔNG cần gesture nữa -> gọi thoải mái.
      if (isPushSupported() && getVapidPublicKey()) {
        const res = await subscribeToPush({ needsGesture: true })
        setPushed(res.ok)
        if (res.ok) {
          // Gửi lên server để server biết gửi push cho thiết bị này.
          const saved = await registerPushWithServer(res.subscription)
          setPushed(saved)
          setToast(
            saved
              ? '🔔 Đã bật thông báo + đăng ký push kể cả khi app đóng.'
              : '⚠️ Đã bật thông báo, nhưng CHƯA lưu được push lên server. Bấm "📲 Đồng bộ push" sau khi deploy function xong.',
          )
        } else {
          setToast(
            `⚠️ Đã bật thông báo nhưng đăng ký push lỗi (${res.reason}${res.error ? `: ${res.error}` : ''}).`,
          )
        }
      } else {
        setToast('🔔 Đã bật thông báo (trình duyệt này không hỗ trợ Web Push).')
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
    let sub = await getPushSubscription()

    // Chưa có subscription -> thử tạo mới (chỉ thành công nếu permission
    // đã granted, vì lúc đó WebKit không cần user gesture).
    if (!sub) {
      const res = await subscribeToPush({ needsGesture: true })
      if (!res.ok) {
        setToast(
          `⚠️ Chưa có subscription trên thiết bị này (${res.reason}${res.error ? `: ${res.error}` : ''}). Nếu quyền thông báo đã bật, hãy bấm "🔄 Đăng ký push".`,
        )
        return
      }
      sub = await getPushSubscription()
    }
    if (!sub) {
      setToast('⚠️ Chưa có subscription trên thiết bị này.')
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

  /**
   * Huỷ đăng ký push trên thiết bị này.
   *
   * Dùng khi máy đang kẹt vì subscription cũ (đổi VAPID key) — WebKit sẽ
   * ném `InvalidStateError` mãi. Huỷ đi rồi bấm "🔄 Đăng ký push" là sạch.
   */
  const resetPush = useCallback(async () => {
    setToast('⏳ Đang huỷ đăng ký push...')
    const ok = await unsubscribeFromPush()
    try {
      localStorage.removeItem('quan-an-sang:vapid-key')
      localStorage.removeItem('quan-an-sang:push-synced')
    } catch {
      /* bỏ qua */
    }
    setPushed(false)
    setToast(
      ok
        ? '🗑️ Đã huỷ đăng ký push. Bấm "🔄 Đăng ký push" để đăng ký lại.'
        : '⚠️ Không có subscription để huỷ.',
    )
  }, [])

  /**
   * Chẩn đoán trạng thái push, hiển thị ngay trên máy.
   *
   * Dùng khi chủ quán báo "không nhận được thông báo" -> chụp màn hình
   * gửi lại là biết ngay vướng ở bước nào.
   */
  const runPushDiagnostics = useCallback(async () => {
    const d = await getPushDiagnostics()
    setDiag(d)
    const lines = [
      `App từ màn hình chính: ${d.standalone ? 'CÓ' : 'KHÔNG'}`,
      `iOS: ${d.ios ? 'CÓ' : 'không'}`,
      `Service Worker: ${d.swSupported ? 'có' : 'không'} | scope: ${d.swScope || '-'}`,
      `Quyền thông báo: ${d.permission}`,
      `Web Push hỗ trợ: ${d.pushSupported ? 'có' : 'KHÔNG'}`,
      `VAPID key: ${d.vapidKey ? 'có' : 'THIẾU'}`,
      `Subscription: ${d.hasSubscription ? 'ĐÃ CÓ' : 'CHƯA CÓ'}${d.endpointHost ? ' (' + d.endpointHost + ')' : ''}`,
      `Đã đồng bộ server: ${d.syncedLocally ? 'có' : 'chưa'}`,
      d.error ? `Lỗi: ${d.error}` : '',
    ].filter(Boolean)
    setToast(lines.join(' • '))
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

        {/* Permission đã bật nhưng chưa có push subscription -> hiện nút
            đăng ký lại. Không có nút này thì chủ quán không có đường nào
            để subscribe lại khi WebKit tự xoá subscription. */}
        {perm === 'granted' && !pushed && (
          <button className="btn btn-alert btn-alert-cta" onClick={enableNotifications}>
            🔄 Đăng ký push
          </button>
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

        <button
          className="btn btn-alert"
          onClick={runPushDiagnostics}
          title="Xem trạng thái push chi tiết (chụp màn hình gửi lại nếu chưa nhận được thông báo)"
        >
          🩺 Chẩn đoán push
        </button>

        <button
          className="btn btn-alert"
          onClick={resetPush}
          title="Huỷ đăng ký push trên máy này rồi đăng ký lại (dùng khi bị kẹt do đổi VAPID key)"
        >
          🗑️ Đặt lại push
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

      {/* ---- Kết quả chẩn đoán push (bấm "🩺 Chẩn đoán push") ---- */}
      {diag && (
        <div className="install-hint" role="note">
          <div className="install-hint-title">🩺 Chẩn đoán thông báo</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: '18px', lineHeight: 1.7 }}>
            <li>
              Mở từ màn hình chính: <strong>{diag.standalone ? 'CÓ' : 'KHÔNG'}</strong>{' '}
              {diag.standalone ? '' : '← phải mở app từ icon, không mở tab Safari'}
            </li>
            <li>
              Service Worker: <strong>{diag.swSupported ? 'có' : 'KHÔNG'}</strong>
              {diag.swScope ? ` (scope: ${diag.swScope})` : ''}
              {diag.swController ? '' : ' ← chưa có controller, thử đóng/mở lại app'}
            </li>
            <li>
              Quyền thông báo: <strong>{diag.permission}</strong>
              {diag.permission === 'default' ? ' ← bấm "🔔 Bật thông báo"' : ''}
              {diag.permission === 'denied' ? ' ← vào Cài đặt Safari để bật lại' : ''}
            </li>
            <li>
              Web Push: <strong>{diag.pushSupported ? 'có' : 'KHÔNG hỗ trợ'}</strong> • VAPID key:{' '}
              <strong>{diag.vapidKey ? 'có' : 'THIẾU'}</strong>
            </li>
            <li>
              Subscription: <strong>{diag.hasSubscription ? 'ĐÃ CÓ' : 'CHƯA CÓ'}</strong>
              {diag.endpointHost ? ` (${diag.endpointHost})` : ''}
              {diag.hasSubscription ? '' : ' ← bấm "🔄 Đăng ký push"'}
            </li>
            <li>
              Đã đồng bộ lên server: <strong>{diag.syncedLocally ? 'có' : 'chưa'}</strong>
              {diag.syncedLocally ? '' : ' ← bấm "📲 Đồng bộ push"'}
            </li>
            {diag.error ? <li>Lỗi: {diag.error}</li> : null}
            {diag.lastError ? (
              <li style={{ color: '#b45309' }}>
                <strong>Lỗi push gần nhất:</strong> {diag.lastError}
              </li>
            ) : null}
          </ul>
        </div>
      )}

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
