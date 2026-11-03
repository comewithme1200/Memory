/**
 * Đăng ký Service Worker + đăng ký Web Push (iOS cần cả hai).
 *
 * ---------------------------------------------------------------------------
 * BẢNG SO SÁNH nhanh
 *
 * | Tính năng              | Chrome Android | iPhone (Safari)  |
 * |------------------------|----------------|-------------------|
 * | `new Notification()`   | ✅             | ❌ KHÔNG hỗ trợ   |
 * | `showNotification()`   | ✅             | ✅ (cần SW)      |
 * | Web Push khi app đóng | ✅             | ✅ (iOS 16.4+)    |
 * | Add to Home Screen     | ✅             | ✅ (bắt buộc)    |
 *
 * -> Trên iPhone, BẮT BUỘC phải:
 *    1. Thêm vào Màn hình chính (Safari: Chia sẻ > Thêm vào MH chính)
 *    2. MỞ APP TỪ MÀN HÌNH CHÍNH (không mở từ tab Safari)
 *    3. Cấp quyền thông báo
 *    4. Đăng ký Web Push (VAPID) -> để nhận khi app đã đóng
 *
 * ---------------------------------------------------------------------------
 * VAPID LÀ GÌ?
 *
 * Web Push dùng cơ chế "VAPID" (Voluntary Application Server Identification).
 * Mỗi app có một CẶP KHOÁ:
 *   - PUBLIC key  -> đưa vào code web (an toàn, ai cũng biết)
 *   - PRIVATE key -> giữ ở server, dùng để KÝ gói tin push gửi đi
 *
 * Server dùng private key + private key đó + endpoint của thiết bị để gửi
 * push. Nếu không có server, ta vẫn dùng được phần "app đang mở" (qua
 * Realtime) — nhưng mất phần "app đã đóng".
 */

import { supabase } from './supabase.js'

const SW_PATH = 'sw.js'

/**
 * Đường dẫn tương đối tới gốc ứng dụng.
 *
 * Vite dùng `base: './'` -> bundle nằm ở thư mục con khi deploy lên
 * GitHub Pages (ví dụ `/Memory/`). Nếu dùng đường dẫn tuyệt đối `/icon.png`
 * thì sẽ 404 trên domain gốc. Dùng `import.meta.env.BASE_URL` để luôn
 * trỏ đúng.
 */
export function assetUrl(path) {
  const base = import.meta.env?.BASE_URL || './'
  const clean = String(path).replace(/^\.?\//, '')
  return `${base}${clean}`.replace(/([^:]\/)\/+/g, '$1')
}

/* ------------------------------------------------------------------ *
 * 1. ĐĂNG KÝ SERVICE WORKER
 * ------------------------------------------------------------------ */

/**
 * Đăng ký SW. Trả về registration (hoặc null nếu thất bại).
 */
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  // Chỉ hỗ trợ trên HTTPS hoặc localhost. GitHub Pages là HTTPS -> OK.
  if (!window.isSecureContext) return null

  try {
    const reg = await navigator.serviceWorker.register(assetUrl(SW_PATH), {
      scope: import.meta.env?.BASE_URL || './',
      updateViaCache: 'none',
    })
    return reg
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 2. KIỂM TRA ĐANG CHẠY Ở CHẾ ĐỘ APP ĐÃ CÀI (standalone)
 * ------------------------------------------------------------------ */

/**
 * iOS: sau khi "Thêm vào Màn hình chính", app mở từ icon sẽ chạy ở chế độ
 * `standalone` (không có thanh địa chỉ Safari).
 *
 * @returns {'standalone'|'browser'|'minimal-ui'|'unknown'}
 */
export function displayMode() {
  if (typeof window === 'undefined') return 'unknown'
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
      ? 'standalone'
      : 'browser'
  )
}

/** Đang mở từ màn hình chính (app đã cài) hay đang mở trong trình duyệt? */
export function isStandalone() {
  return displayMode() === 'standalone'
}

/* ------------------------------------------------------------------ *
 * MỞ APP TỪ MÀN HÌNH CHÍNH -> LUÔN VÀO TRANG QUẢN TRỊ
 * ------------------------------------------------------------------ */

/**
 * Khi bấm "Thêm vào Màn hình chính", iOS/Android lưu lại **URL đang mở lúc
 * đó** chứ không phải `start_url` trong manifest. Nên nếu bạn đang đứng ở
 * trang đặt hàng lúc bấm "Thêm vào MH chính", thì mở icon lên lại vẫn ra
 * trang đặt hàng — dù manifest đã khai `start_url` là trang quản trị.
 *
 * Cách sửa: khi app chạy ở chế độ `standalone` (tức mở từ icon) mà URL hiện
 * tại KHÔNG phải trang quản trị -> tự chuyển sang trang quản trị.
 *
 * Chuyển HAY chỉ 1 lần mỗi phiên: dùng `sessionStorage` làm cờ. Nhờ vậy sau
 * khi đã vào trang quản trị, chủ quán vẫn vào xem trang đặt hàng được bình
 * thường mà không bị bật lại về trang quản trị.
 */

/** Đường dẫn trang quản trị (dùng HashRouter -> có dấu `#`). */
const ADMIN_HOME = '#/quan-tri/orders'

/** Cờ: phiên này đã xử lý chuyển hướng lần đầu rồi. */
const REDIRECT_FLAG = 'qsHomeRedirectDone'

/** URL hiện tại có nằm trong khu vực quản trị không? */
function isAdminUrl() {
  const hash = window.location.hash || ''
  return hash.startsWith('#/quan-tri')
}

/**
 * Nếu đang mở app từ màn hình chính mà không ở trang quản trị -> chuyển.
 *
 * @returns {boolean} true nếu đã chuyển hướng.
 */
export function redirectToAdminIfFromHomeScreen() {
  if (typeof window === 'undefined') return false

  // Chỉ khi mở từ icon màn hình chính (chế độ standalone).
  if (!isStandalone()) return false

  let done = false
  try {
    done = sessionStorage.getItem(REDIRECT_FLAG) === '1'
    sessionStorage.setItem(REDIRECT_FLAG, '1')
  } catch {
    /* Safari private mode -> bỏ qua cờ, vẫn chuyển */
  }

  // Phiên này đã chuyển rồi -> không chuyển nữa (cho phép xem trang đặt hàng).
  if (done) return false

  if (!isAdminUrl()) {
    window.location.hash = ADMIN_HOME
    return true
  }

  return false
}

/** Là iPhone/iPad không? */
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOSUA = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ báo UA là Mac -> dò thêm qua touch + maxTouchPoints
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOSUA || iPadOS
}

/** Trình duyệt có hỗ trợ Web Push không? (iOS cần >= 16.4) */
export function isPushSupported() {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  return Notification.permission !== 'denied' || true
}

/* ------------------------------------------------------------------ *
 * 3. ĐĂNG KÝ WEB PUSH
 * ------------------------------------------------------------------ */

/** Chuyển base64url (VAPID) -> Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  // base64url -> base64: '-' thành '+', '_' thành '/'
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** Lấy VAPID public key từ biến môi trường. */
export function getVapidPublicKey() {
  const key = import.meta.env?.VITE_VAPID_PUBLIC_KEY
  return typeof key === 'string' && key.trim() ? key.trim() : ''
}

/**
 * Đăng ký thiết bị nhận Web Push.
 *
 * @returns {Promise<{ok: true, subscription: object} | {ok: false, reason: string, error?: string}>}
 */
export async function subscribeToPush() {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'no-service-worker' }
  }
  if (!('PushManager' in window)) {
    return { ok: false, reason: 'no-push-manager' }
  }

  const vapidKey = getVapidPublicKey()
  if (!vapidKey) {
    return { ok: false, reason: 'no-vapid-key' }
  }

  try {
    const reg = await navigator.serviceWorker.ready
    if (!reg) return { ok: false, reason: 'no-registration' }

    // Đã đăng ký rồi -> lấy lại subscription
    let existing = await reg.pushManager.getSubscription()
    if (!existing) {
      existing = await reg.pushManager.subscribe({
        userVisibleOnly: true, // BẮT BUỘC với Chrome/V8
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
    }

    return { ok: true, subscription: existing.toJSON() }
  } catch (e) {
    return { ok: false, reason: 'subscribe-failed', error: e?.message || String(e) }
  }
}

/**
 * Gửi subscription lên server để server có thể gửi push khi có đơn mới.
 *
 * Dùng Edge Function `register-push` vì RLS của bảng `push_subscriptions`
 * cố tình KHÔNG cho phép insert từ client (chống spam) — function xác thực
 * JWT rồi ghi bằng service_role.
 *
 * @param {object} subscription kết quả từ `subscribeToPush()`
 * @returns {Promise<boolean>} đã lưu lên server hay chưa
 */
export async function registerPushWithServer(subscription) {
  if (!subscription?.endpoint) return false
  try {
    if (!supabase) return false

    const { error } = await supabase.functions.invoke('register-push', {
      body: {
        subscription,
        userAgent: navigator.userAgent,
        platform: navigator.platform || '',
      },
    })
    if (error) {
      console.warn('Không lưu được push subscription lên server:', error)
      return false
    }
    return true
  } catch (e) {
    console.warn('Lỗi khi gửi push subscription lên server:', e)
    return false
  }
}
/**
 * Huỷ đăng ký push (khi chủ quán không muốn nhận nữa).
 */
export async function unsubscribeFromPush() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    await sub.unsubscribe()
    return true
  } catch {
    return false
  }
}

/** Đang đã đăng ký push hay chưa? */
export async function getPushSubscription() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? sub.toJSON() : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 4. HIỂN THỊ THÔNG BÁO (dùng SW nếu có — bắt buộc trên iOS)
 * ------------------------------------------------------------------ */

/**
 * Hiện thông báo. Ưu tiên `registration.showNotification()` vì:
 *   - iOS KHÔNG hỗ trợ `new Notification()`.
 *   - SW notification có thể tồn tại lâu hơn, có onclick xử lý mở app.
 *
 * @param {{title?:string, body?:string, tag?:string, url?:string, icon?:string}} opts
 */
export async function showNotification(opts = {}) {
  if (typeof window === 'undefined') return null
  if (!('Notification' in window)) return null
  if (Notification.permission !== 'granted') return null

  const title = opts.title || '🔔 Đơn mới!'
  const iconUrl = opts.icon || assetUrl('icon-192.png')
  const badgeUrl = opts.badge || assetUrl('icon-192.png')
  const options = {
    body: opts.body || '',
    icon: iconUrl,
    badge: badgeUrl,
    tag: opts.tag || 'quan-an-sang-order',
    renotify: true,
    requireInteraction: false,
    // Khi tab đang hiện -> ta tự phát tiếng bằng Web Audio (chắc chắn nghe
    // rõ). Khi tab ẩn -> để hệ thống phát chuông.
    silent: typeof document !== 'undefined' && !document.hidden ? true : false,
    data: { url: opts.url || './#/quan-tri/orders' },
    vibrate: [180, 90, 180],
  }

  // 1) Ưu tiên Service Worker (bắt buộc cho iOS)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready
      if (reg) {
        const n = await reg.showNotification(title, options)
        n.onclick = () => {
          try {
            window.focus()
          } catch {
            /* bỏ qua */
          }
          n.close()
        }
        return n
      }
    } catch {
      /* rơi xuống cách 2 */
    }
  }

  // 2) Fallback: `new Notification()` (Chrome desktop/Android, không phải iOS)
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* bỏ qua */
      }
      n.close()
    }
    return n
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 5. HƯỚNG DẪN CÀI APP TRÊN IOS
 * ------------------------------------------------------------------ */

/**
 * iOS KHÔNG có hộp thoại "Cài ứng dụng" như Chrome. Người dùng phải tự
 * làm: Safari > Chia sẻ > Thêm vào Màn hình chính.
 *
 * Hàm này trả về hướng dẫn phù hợp với tình huống hiện tại.
 */
export function getInstallHint() {
  if (typeof window === 'undefined') return null

  if (isStandalone()) {
    return {
      mode: 'installed',
      title: '✅ Đã cài app',
      text: 'Đang chạy từ màn hình chính — thông báo sẽ hoạt động.',
    }
  }

  if (isIOS()) {
    return {
      mode: 'ios',
      title: '📲 Cài app lên iPhone',
      text:
        'Safari → nút Chia sẻ (⬆️) → "Thêm vào Màn hình chính" → MỞ APP TỪ ICON ' +
        'trên màn hình chính (không mở từ tab Safari) → bấm "Cho phép" khi được hỏi.',
    }
  }

  return {
    mode: 'browser',
    title: '💡 Mẹo nhận thông báo khi đang lướt web',
    text:
      'Trên iPhone: thêm app vào màn hình chính. Trên Android: bấm menu ⋮ → ' +
      '"Cài ứng dụng" (Install app).',
  }
}
