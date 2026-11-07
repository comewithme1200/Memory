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

  // Menu bánh răng (gom các nút cài đặt thông báo).
  const [menuOpen, setMenuOpen] = useState(false)

  // Modal hiển thị kết quả / thông báo khi bấm các nút trong menu.
  const [modal, setModal] = useState(null) // { title, lines: string[] }

  // Trạng thái PWA: đang mở từ màn hình chính (iPhone) hay trong trình duyệt?
  const [standalone, setStandalone] = useState(isStandalone)
  const [ios, setIos] = useState(isIOS)
  const [pushed, setPushed] = useState(false)
  // Kết quả chẩn đoán push (hiển thị trong modal khi bấm "🩺 Chẩn đoán push")

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

  /**
   * Hiện thông báo kết quả trong MODAL (kèm nút Đóng).
   *
   * Trước đây các kết quả này hiện ở `toast` tự tắt sau 5s -> chủ quán
   * đọc không kịp, đặc biệt là thông báo lỗi dài. Nay hiện trong modal,
   * chủ quán đọc xong mới bấm "Đóng".
   */
  const showResult = useCallback((title, lines) => {
    setModal({
      title,
      lines: (Array.isArray(lines) ? lines : [lines]).filter(Boolean),
    })
    setMenuOpen(false)
  }, [])

  const toggleSound = useCallback(() => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) {
      unlockAudio()
      playAlertSound(true) // thử tiếng ngay để chủ quán kiểm tra
      showResult('Âm báo', ['🔊 Đã bật âm báo đơn mới.'])
    } else {
      showResult('Âm báo', ['🔇 Đã tắt âm báo.'])
    }
  }, [soundOn, showResult])

  /**
   * Bật thông báo + Web Push.
   *
   * iOS BẮT BUỘC phải mở app từ màn hình chính thì `requestPermission()`
   * mới hoạt động -> nếu đang mở trong tab Safari thì báo rõ để người dùng
   * biết phải làm gì, thay vì báo lỗi chung chung.
   */
  const enableNotifications = useCallback(async () => {
    if (!isNotificationSupported()) {
      showResult('Thông báo', ['Trình duyệt này không hỗ trợ thông báo.'])
      return
    }

    if (isIOS() && !isStandalone()) {
      const hint = getInstallHint()
      showResult('Thông báo', [
        `📲 ${hint?.text || 'Hãy thêm app vào màn hình chính rồi mở lại từ icon.'}`,
      ])
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
          showResult('Thông báo', [
            saved
              ? '🔔 Đã bật thông báo + đăng ký push kể cả khi app đóng.'
              : '⚠️ Đã bật thông báo, nhưng CHƯA lưu được push lên server. Bấm "📲 Đồng bộ push" sau khi deploy function xong.',
          ])
        } else {
          showResult('Thông báo', [
            `⚠️ Đã bật thông báo nhưng đăng ký push lỗi (${res.reason}${res.error ? `: ${res.error}` : ''}).`,
          ])
        }
      } else {
        showResult('Thông báo', ['🔔 Đã bật thông báo (trình duyệt này không hỗ trợ Web Push).'])
      }
    } else if (p === 'denied') {
      showResult('Thông báo', ['⚠️ Đã chặn thông báo — hãy bật lại trong cài đặt trình duyệt.'])
    } else {
      showResult('Thông báo', ['Chưa được cấp quyền thông báo.'])
    }
  }, [showResult])

  // Nhắc nhở bật thông báo hệ thống khi vào khu vực quản trị.
  useEffect(() => {
    if (perm === 'default' && isNotificationSupported()) {
      setToast('💡 Bấm nút ⚙️ ở góc phải → "🔔 Bật thông báo" để nhận báo đơn mới.')
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
    let sub = await getPushSubscription()

    // Chưa có subscription -> thử tạo mới (chỉ thành công nếu permission
    // đã granted, vì lúc đó WebKit không cần user gesture).
    if (!sub) {
      const res = await subscribeToPush({ needsGesture: true })
      if (!res.ok) {
        showResult('Đồng bộ push', [
          `⚠️ Chưa có subscription trên thiết bị này (${res.reason}${res.error ? `: ${res.error}` : ''}).`,
          'Nếu quyền thông báo đã bật, hãy bấm "🔄 Đăng ký push".',
        ])
        return
      }
      sub = await getPushSubscription()
    }
    if (!sub) {
      showResult('Đồng bộ push', ['⚠️ Chưa có subscription trên thiết bị này.'])
      return
    }

    const saved = await registerPushWithServer(sub)
    setPushed(saved)
    showResult('Đồng bộ push', [
      saved
        ? '✅ Đã đồng bộ push lên server. Tắt màn hình thử lại nhé!'
        : '❌ Đồng bộ thất bại — server chưa có Edge Function `register-push`.',
    ])
  }, [showResult])

  /**
   * Huỷ đăng ký push trên thiết bị này.
   *
   * Dùng khi máy đang kẹt vì subscription cũ (đổi VAPID key) — WebKit sẽ
   * ném `InvalidStateError` mãi. Huỷ đi rồi bấm "🔄 Đăng ký push" là sạch.
   */
  const resetPush = useCallback(async () => {
    const ok = await unsubscribeFromPush()
    try {
      localStorage.removeItem('quan-an-sang:vapid-key')
      localStorage.removeItem('quan-an-sang:push-synced')
    } catch {
      /* bỏ qua */
    }
    setPushed(false)
    showResult('Đặt lại push', [
      ok
        ? '🗑️ Đã huỷ đăng ký push. Bấm "🔄 Đăng ký push" để đăng ký lại.'
        : '⚠️ Không có subscription để huỷ.',
    ])
  }, [showResult])

  /**
   * Chẩn đoán trạng thái push, hiển thị ngay trên máy.
   *
   * Dùng khi chủ quán báo "không nhận được thông báo" -> chụp màn hình
   * gửi lại là biết ngay vướng ở bước nào.
   */
  const runPushDiagnostics = useCallback(async () => {
    const d = await getPushDiagnostics()
    const lines = [
      `App từ màn hình chính: ${d.standalone ? 'CÓ' : 'KHÔNG'}`,
      `iOS: ${d.ios ? 'CÓ' : 'không'}`,
      `Service Worker: ${d.swSupported ? 'có' : 'không'} | scope: ${d.swScope || '-'} | worker: ${d.swState || '-'}`,
      `Trang đang được SW kiểm soát: ${d.swController ? 'CÓ' : 'CHƯA'}`,
      `Quyền thông báo: ${d.permission}`,
      `Web Push hỗ trợ: ${d.pushSupported ? 'có' : 'KHÔNG'}`,
      `VAPID key: ${d.vapidKey ? 'có' : 'THIẾU'}`,
      `Subscription: ${d.hasSubscription ? 'ĐÃ CÓ' : 'CHƯA CÓ'}${d.endpointHost ? ' (' + d.endpointHost + ')' : ''}`,
      `Đã đồng bộ server: ${d.syncedLocally ? 'có' : 'chưa'}`,
      d.error ? `Lỗi: ${d.error}` : '',
      d.lastError ? `Lỗi push gần nhất: ${d.lastError}` : '',
    ].filter(Boolean)
    showResult('🩺 Chẩn đoán thông báo', lines)
  }, [showResult])

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

      {/* ---- Thanh công cụ âm báo đơn mới (gọn: 1 nút bánh răng) ---- */}
      <div className="alert-bar">
        {/* Trạng thái tóm tắt (chỉ đọc, không bấm được) */}
        <span
          className="alert-bar-ok"
          title={soundOn ? 'Âm báo đang BẬT' : 'Âm báo đang TẮT'}
        >
          {soundOn ? '🔊 Âm báo' : '🔇 Âm báo'}
        </span>

        {perm === 'granted' && (
          <span className="alert-bar-ok" title="Thông báo hệ thống đã được bật">
            ✅ Thông báo
          </span>
        )}

        {pushed && (
          <span
            className="alert-bar-ok"
            title="Đã đăng ký Web Push — nhận được kể cả khi app đóng"
          >
            📲 Push
          </span>
        )}

        {standalone && (
          <span className="alert-bar-ok" title="Đang chạy từ màn hình chính">
            📱 Đã cài app
          </span>
        )}

        <span className="alert-bar-tip">
          Đơn mới sẽ kêu + hiện thông báo dù bạn đang ở tab nào.
        </span>

        {/* ---- Nút bánh răng: gom toàn bộ nút cài đặt thông báo ---- */}
        <div className="kebab-wrap">
          <button
            className="btn btn-alert kebab-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Cài đặt thông báo"
            title="Cài đặt thông báo"
          >
            ⋮
          </button>

          {menuOpen && (
            <>
              {/* Bấm ra ngoài để đóng menu */}
              <div
                className="kebab-backdrop"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="kebab-menu" role="menu">
                <button
                  className="kebab-item"
                  role="menuitem"
                  onClick={toggleSound}
                >
                  <span>{soundOn ? '🔇 Tắt âm báo' : '🔊 Bật âm báo'}</span>
                  <span className="kebab-item-note">
                    {soundOn ? 'đang bật' : 'đang tắt'}
                  </span>
                </button>

                {isNotificationSupported() && perm !== 'granted' && (
                  <button
                    className="kebab-item"
                    role="menuitem"
                    onClick={enableNotifications}
                  >
                    <span>🔔 Bật thông báo</span>
                  </button>
                )}

                {/* Permission đã bật nhưng chưa có push subscription -> hiện nút
                    đăng ký lại. Không có nút này thì chủ quán không có đường nào
                    để subscribe lại khi WebKit tự xoá subscription. */}
                {perm === 'granted' && !pushed && (
                  <button
                    className="kebab-item"
                    role="menuitem"
                    onClick={enableNotifications}
                  >
                    <span>🔄 Đăng ký push</span>
                  </button>
                )}

                <button
                  className="kebab-item"
                  role="menuitem"
                  onClick={resyncPush}
                >
                  <span>📲 Đồng bộ push</span>
                </button>

                <button
                  className="kebab-item"
                  role="menuitem"
                  onClick={runPushDiagnostics}
                >
                  <span>🩺 Chẩn đoán push</span>
                </button>

                <button
                  className="kebab-item kebab-item-danger"
                  role="menuitem"
                  onClick={resetPush}
                >
                  <span>🗑️ Đặt lại push</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- MODAL kết quả / thông báo (có nút Đóng) ---- */}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => setModal(null)}
          role="presentation"
        >
          <div
            className="modal modal-result"
            role="dialog"
            aria-modal="true"
            aria-label={modal.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{modal.title}</h2>
              <button
                className="btn-icon"
                onClick={() => setModal(null)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <ul className="modal-result-list">
                {modal.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-primary"
                onClick={() => setModal(null)}
              >
                Đóng
              </button>
            </div>
          </div>
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
