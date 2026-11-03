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
 * localStorage key lưu VAPID public key đã dùng để subscribe.
 *
 * Nếu sau này xoay VAPID key, subscription cũ trong máy sẽ không dùng được
 * (spec: `subscribe()` với key khác -> `InvalidStateError`). Biết key cũ là
 * gì thì ta tự huỷ subscription cũ và đăng ký lại, không cần chủ quán gỡ
 * cài app.
 */
const VAPID_KEY_STORAGE = 'quan-an-sang:vapid-key'

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

/**
 * Promise của registration, đã "warm up" từ lúc app khởi động.
 *
 * WebKit tiêu thụ transient activation khi hiện hộp thoại quyền. Nếu click
 * handler phải chờ đăng ký SW (mất vài trăm ms -> vài giây) thì activation
 * có thể hết hạn và hộp thoại không hiện. Giải pháp: đăng ký SW ngay khi
 * app mở, để lúc bấm nút thì đã có sẵn.
 */
let swRegistrationPromise = null

export function warmUpServiceWorker() {
  if (swRegistrationPromise) return swRegistrationPromise

  swRegistrationPromise = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
    try {
      const reg = await registerServiceWorker()
      if (reg) return reg
    } catch {
      /* bỏ qua */
    }
    return getActiveRegistration()
  })()

  return swRegistrationPromise
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

/* ------------------------------------------------------------------ *
 * LỖI PUSH GẦN NHẤT (để hiển thị cho chủ quán)
 * ------------------------------------------------------------------ */

/**
 * Lỗi push gần nhất, dạng chữ người đọc được.
 *
 * Mục đích: khi chủ quán báo "không có thông báo", ta cần biết CHÍNH XÁC
 * lỗi là gì (WebKit từ chối do thiếu gesture? SW chưa active? endpoint
 * bị Apple từ chối?) chứ không phải đoán.
 */
let lastPushError = ''

export function getLastPushError() {
  return lastPushError
}

export function setLastPushError(msg) {
  lastPushError = msg ? String(msg) : ''
  if (lastPushError) console.warn('[push] ' + lastPushError)
}

/**
 * Dịch lỗi của trình duyệt sang thông điệp dễ hiểu (tiếng Việt).
 */
export function explainPushError(e) {
  const name = e?.name || ''
  const msg = e?.message || String(e || '')

  if (name === 'NotAllowedError') {
    return `Trình duyệt từ chối (NotAllowedError): thiếu thao tác chạm của người dùng, hoặc quyền thông báo đã bị từ chối. ${msg}`
  }
  if (name === 'InvalidStateError') {
    return `InvalidStateError: ${msg.includes('active service worker') ? 'Service Worker chưa kích hoạt — hãy đóng app và mở lại từ icon màn hình chính.' : 'Có thể do đổi VAPID key (subscription cũ còn trong máy) — thử gỡ app rồi cài lại, hoặc bấm nút huỷ đăng ký push.'} ${msg}`
  }
  if (name === 'AbortError') {
    return `Đăng ký push bị hủy (AbortError): dịch vụ push của iOS từ chối. Thử gỡ app rồi cài lại. ${msg}`
  }
  if (name === 'NotSupportedError') {
    return `Trình duyệt/iOS không hỗ trợ Web Push (NotSupportedError): cần iOS 16.4+ và mở app từ màn hình chính. ${msg}`
  }
  if (name === 'SecurityError') {
    return `Không an toàn (SecurityError): Web Push chỉ chạy trên HTTPS. ${msg}`
  }
  return `${name ? name + ': ' : ''}${msg}`
}

/**
 * Chờ một ServiceWorkerRegistration có worker ở trạng thái `active`.
 *
 * WebKit (iOS) ném `InvalidStateError: Subscribing for push requires an active
 * service worker` nếu `pushManager.subscribe()` được gọi khi registration
 * mới đăng ký mà worker vẫn đang `installing`/`waiting` (`reg.active === null`).
 *
 * @param {ServiceWorkerRegistration} reg
 * @param {number} timeoutMs
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
function waitForActiveWorker(reg, timeoutMs = 8000) {
  if (!reg) return Promise.resolve(null)
  if (reg.active && reg.active.state === 'activated') return Promise.resolve(reg)
  if (reg.active) return Promise.resolve(reg)

  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        worker?.removeEventListener('statechange', onStateChange)
      } catch {
        /* bỏ qua */
      }
      resolve(value)
    }

    const onStateChange = () => {
      const w = reg.installing || reg.waiting || reg.active
      if (w && w.state === 'activated') finish(reg)
      else if (w && w.state === 'redundant') finish(null)
    }

    const worker = reg.installing || reg.waiting || reg.active
    if (worker) {
      try {
        worker.addEventListener('statechange', onStateChange)
      } catch {
        /* bỏ qua */
      }
      // Trạng thái có thể đã đổi giữa lúc lấy worker và lúc gắn listener.
      onStateChange()
    }

    const timer = setTimeout(() => finish(reg.active ? reg : null), timeoutMs)
  })
}

/**
 * Lấy ServiceWorkerRegistration đang hoạt động, có timeout.
 *
 * `navigator.serviceWorker.ready` có thể KHÔNG BAO GIỜ resolve nếu đăng ký
 * SW thất bại (scope sai, SW script lỗi, iOS từ chối...). Khi đó `await` sẽ
 * treo vô hạn -> nút bấm "không phản ứng gì" và user không hiểu vì sao.
 * Hàm này luôn trả về trong tối đa `timeoutMs`.
 */
async function getActiveRegistration(timeoutMs = 8000) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  // Ưu tiên promise đã warm up (nhanh nhất, không cần chờ mạng).
  if (swRegistrationPromise) {
    try {
      const warm = await Promise.race([
        swRegistrationPromise,
        new Promise((resolve) => setTimeout(() => resolve(undefined), 1500)),
      ])
      if (warm?.active) return warm
    } catch {
      /* bỏ qua */
    }
  }

  // Ưu tiên registration đã biết (nhanh, không cần chờ).
  try {
    const existing = await navigator.serviceWorker.getRegistration()
    if (existing?.active) return existing
    if (existing) {
      const waited = await waitForActiveWorker(existing, timeoutMs)
      if (waited) return waited
    }
  } catch {
    /* bỏ qua */
  }

  // Chờ `ready` nhưng có timeout. `ready` chỉ resolve khi có worker active.
  try {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
    if (!ready) return null
    // Chắc chắn worker đã active trước khi trả về.
    if (!ready.active) {
      const waited = await waitForActiveWorker(ready, timeoutMs)
      return waited || null
    }
    return ready
  } catch {
    return null
  }
}

/**
 * Subscription hiện tại có dùng đúng VAPID key đang cấu hình không?
 *
 * Browser không expose `applicationServerKey` của subscription, nên ta tự
 * nhớ lại: lúc subscribe thành công, lưu VAPID public key vào localStorage.
 * Lần sau nếu key đã đổi (xoay khoá) -> subscription cũ không dùng được,
 * phải huỷ rồi đăng ký lại (nếu không `subscribe()` ném InvalidStateError).
 *
 * @returns {Promise<boolean>} true nếu khớp (hoặc không xác định -> coi như khớp)
 */
async function subscriptionMatchesVapid(sub, vapidPublicKey) {
  try {
    const stored = localStorage.getItem(VAPID_KEY_STORAGE)
    if (!stored) return true // chưa từng ghi -> không có thông tin, giữ nguyên
    return stored === vapidPublicKey
  } catch {
    return true
  }
}

/** Lưu VAPID public key đã dùng để subscribe (để phát hiện trường hợp xoay key). */
function rememberVapidKey(vapidPublicKey) {
  try {
    localStorage.setItem(VAPID_KEY_STORAGE, vapidPublicKey)
  } catch {
    /* bỏ qua */
  }
}

/**
 * Đăng ký thiết bị nhận Web Push.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN CHIA 2 TRƯỜNG HỢP?
 *
 * Theo tài liệu WebKit (Apple):
 *
 *   - `Notification.requestPermission()` **tiêu thụ** "transient activation".
 *     Nếu permission đang là `"default"`, `subscribe()` sẽ bị WebKit từ chối
 *     với `NotAllowedError` ("Push notification prompting can only be done
 *     from a user gesture") — và `requestPermission()` sẽ resolve `"denied"`
 *     mà KHÔNG hiện hộp thoại.
 *
 *   - Nếu permission **đã là `"granted"`**, thì `subscribe()` KHÔNG cần
 *     gesture nữa -> có thể gọi tự động lúc mở app.
 *
 * Vì vậy:
 *   - `subscribeToPush({ needsGesture: true })` -> gọi KỰ trong event handler
 *     của nút bấm (chủ quán vừa bấm "🔔 Bật thông báo").
 *   - `subscribeToPush()` (không tham số) -> gọi tự động lúc mở app, CHỈ khi
 *     permission đã granted. Đây là đường tự phục hồi: nếu lúc trước
 *     subscribe lỗi (mất mạng, function chưa deploy...) thì lần mở sau sẽ
 *     tự thử lại.
 *
 * @param {{needsGesture?: boolean}} [opts]
 * @returns {Promise<{ok: true, subscription: object} | {ok: false, reason: string, error?: string}>}
 */
export async function subscribeToPush(opts = {}) {
  const needsGesture = opts.needsGesture === true

  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'no-service-worker' }
  }
  if (!('PushManager' in window)) {
    return { ok: false, reason: 'no-push-manager' }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'permission-denied' }
  }

  const vapidKey = getVapidPublicKey()
  if (!vapidKey) {
    return { ok: false, reason: 'no-vapid-key' }
  }

  try {
    const reg = await getActiveRegistration()
    if (!reg) return { ok: false, reason: 'no-registration' }

    // Đã đăng ký rồi -> lấy lại subscription
    let existing = await reg.pushManager.getSubscription()

    if (existing) {
      // Subscription còn từ lần đăng ký với VAPID key KHÁC -> theo spec,
      // `subscribe()` sẽ ném InvalidStateError. Phải huỷ đăng ký cũ trước.
      if (!subscriptionMatchesVapid(existing, vapidKey)) {
        console.warn('[push] Subscription dùng VAPID key cũ -> huỷ và đăng ký lại.')
        try {
          await existing.unsubscribe()
        } catch {
          /* bỏ qua */
        }
        existing = null
      }
    }

    if (!existing) {
      existing = await reg.pushManager.subscribe({
        userVisibleOnly: true, // BẮT BUỘC với Chrome/V8
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      rememberVapidKey(vapidKey)
    }

    setLastPushError('')
    return { ok: true, subscription: existing.toJSON() }
  } catch (e) {
    // `InvalidStateError` xảy ra khi worker CHƯA ACTIVE, hoặc subscription cũ
    // dùng VAPID key khác. Xử lý cả hai: chờ worker active -> huỷ subscription
    // cũ (nếu có) -> subscribe lại.
    if (e?.name === 'InvalidStateError') {
      const detail = explainPushError(e)
      console.warn('[push] InvalidStateError -> ' + detail)
      try {
        const reg = await getActiveRegistration()
        if (!reg) {
          setLastPushError(
            `${detail}\n\nService Worker chưa kích hoạt. Hãy đóng app hẳn rồi mở lại từ icon màn hình chính (không mở trong tab Safari), rồi bấm "Đăng ký push" lần nữa.`,
          )
          return { ok: false, reason: 'subscribe-failed', error: getLastPushError() }
        }

        // Huỷ mọi subscription cũ (kể cả khi không lưu VAPID key) để chắc
        // chắn không còn subscription "mồ côi" gây InvalidStateError.
        const stale = await reg.pushManager.getSubscription()
        if (stale) {
          await stale.unsubscribe()
        }

        const fresh = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
        rememberVapidKey(vapidKey)
        setLastPushError('')
        return { ok: true, subscription: fresh.toJSON() }
      } catch (e2) {
        const detail2 = explainPushError(e2)
        setLastPushError(
          `${detail2}\n\nGợi ý: đóng app hẳn, mở lại từ icon màn hình chính, rồi bấm "Đăng ký push". Nếu vẫn lỗi, dùng nút "Đặt lại push" rồi thử lại.`,
        )
        return { ok: false, reason: 'subscribe-failed', error: getLastPushError() }
      }
    }

    const detail = explainPushError(e)
    setLastPushError(detail)
    return { ok: false, reason: 'subscribe-failed', error: detail }
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
    if (!supabase) {
      setLastPushError('Chưa cấu hình Supabase trong build (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
      return false
    }

    const { data, error } = await supabase.functions.invoke('register-push', {
      body: {
        subscription,
        userAgent: navigator.userAgent,
        platform: navigator.platform || '',
      },
    })

    if (error) {
      const detail = `Server từ chối lưu subscription: ${error.message || JSON.stringify(error)}`
      setLastPushError(detail)
      console.warn(detail)
      return false
    }

    // Nếu function trả về { error } dù HTTP 200 -> coi như lỗi.
    if (data?.error) {
      const detail = `Edge Function register-push báo lỗi: ${data.error}`
      setLastPushError(detail)
      console.warn(detail)
      return false
    }

    setLastPushError('')
    return true
  } catch (e) {
    const detail = `Lỗi gọi Edge Function register-push: ${e?.message || String(e)}`
    setLastPushError(detail)
    console.warn(detail)
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 3b. TỰ ĐỒNG BỘ SUBSCRIPTION LÊN SERVER (quan trọng)
 * ------------------------------------------------------------------ */

/**
 * Cờ đánh dấu "đã gửi subscription này lên server thành công".
 *
 * Lưu theo endpoint -> nếu endpoint đổi (gỡ app rồi cài lại, đổi VAPID
 * key...) thì coi như chưa từng gửi -> gửi lại.
 */
const SYNCED_KEY = 'quan-an-sang:push-synced'

function getSyncedEndpoints() {
  try {
    const raw = localStorage.getItem(SYNCED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function markSynced(endpoint) {
  try {
    const list = getSyncedEndpoints()
    if (!list.includes(endpoint)) {
      list.push(endpoint)
      // Giới hạn 20 mục cho khỏi phình to.
      localStorage.setItem(SYNCED_KEY, JSON.stringify(list.slice(-20)))
    }
  } catch {
    /* bỏ qua */
  }
}

function isSynced(endpoint) {
  return getSyncedEndpoints().includes(endpoint)
}

/**
 * Đảm bảo server ĐÃ CÓ subscription của thiết bị này — và TỰ TẠO nếu chưa có.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN HÀM NÀY?
 *
 * Subscription là thứ nằm trong browser. Server chỉ gửi push được nếu đã
 * lưu subscription đó trong DB. Có 2 tình huống hỏng:
 *
 *   1. Lúc bạn bấm "🔔 Bật thông báo", Edge Function `register-push` CHƯA
 *      được deploy (404) -> subscription có trong browser nhưng SERVER không
 *      có gì để gửi -> màn hình tắt là im lặng.
 *
 *   2. `pushManager.subscribe()` bị WebKit từ chối (`NotAllowedError`) vì
 *      không có user gesture -> browser KHÔNG có subscription nào.
 *
 * Hàm này chạy mỗi lần mở app:
 *   - chưa có subscription  -> TỰ subscribe (chỉ khi permission đã granted,
 *     vì lúc đó không cần gesture nữa);
 *   - có subscription nhưng server chưa biết -> GỬI LẠI lên server.
 *
 * Nhờ vậy chỉ cần deploy function là tự động có push, không cần thao tác lại
 * trên điện thoại.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function ensurePushSynced() {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' }
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no-service-worker' }

  try {
    let reg = await getActiveRegistration()
    if (!reg) {
      // Thử đăng ký lại SW (lần đầu mở app có thể SW chưa kịp activate).
      await registerServiceWorker()
      reg = await getActiveRegistration()
    }
    if (!reg) return { ok: false, reason: 'no-registration' }

    let sub = await reg.pushManager.getSubscription()

    // Chưa có subscription -> thử tự tạo (chỉ thành công nếu permission
    // đã granted; nếu chưa thì WebKit từ chối -> bỏ qua, chờ người dùng
    // bấm nút "🔔 Bật thông báo").
    if (!sub) {
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default'
      if (perm !== 'granted') {
        return { ok: false, reason: 'not-permitted' }
      }

      const res = await subscribeToPush()
      if (!res.ok) {
        console.warn('Không tạo được push subscription:', res.reason, res.error || '')
        return { ok: false, reason: res.reason }
      }
      sub = await reg.pushManager.getSubscription()
      if (!sub) return { ok: false, reason: 'subscribe-failed' }
    }

    const json = sub.toJSON()
    if (!json?.endpoint) return { ok: false, reason: 'no-endpoint' }

    // Đã sync rồi -> khỏi gọi mạng.
    if (isSynced(json.endpoint)) return { ok: true }

    const saved = await registerPushWithServer(json)
    if (saved) markSynced(json.endpoint)
    return { ok: saved, reason: saved ? undefined : 'server-save-failed' }
  } catch (e) {
    console.warn('Không đồng bộ push subscription:', e)
    return { ok: false, reason: 'error' }
  }
}
/**
 * Huỷ đăng ký push (khi chủ quán không muốn nhận nữa).
 */
export async function unsubscribeFromPush() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    const reg = await getActiveRegistration()
    if (!reg) return false
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
    const reg = await getActiveRegistration()
    if (!reg) return null
    const sub = await reg.pushManager.getSubscription()
    return sub ? sub.toJSON() : null
  } catch {
    return null
  }
}

/**
 * Thu thập trạng thái push để hiển thị chẩn đoán trên chính điện thoại.
 *
 * Mục đích: khi chủ quán báo "không có thông báo", ta cần biết chính xác
 * lỗi nằm ở bước nào (SW chưa active? permission chưa granted? subscribe
 * bị WebKit từ chối? đã có subscription nhưng chưa lên server?).
 */
export async function getPushDiagnostics() {
  const d = {
    standalone: false,
    ios: false,
    swSupported: false,
    swScope: '',
    swController: false,
    swState: '',
    pushSupported: false,
    permission: 'unknown',
    vapidKey: false,
    hasSubscription: false,
    endpointHost: '',
    syncedLocally: false,
    lastError: '',
    error: '',
  }
  if (typeof window === 'undefined') return d

  try {
    d.standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || false
    d.ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    d.swSupported = 'serviceWorker' in navigator
    d.pushSupported = 'PushManager' in window
    d.permission = 'Notification' in window ? Notification.permission : 'unsupported'
    d.vapidKey = Boolean(getVapidPublicKey())
    d.swController = Boolean(navigator.serviceWorker?.controller)

    if (d.swSupported) {
      try {
        const reg = await getActiveRegistration()
        d.swScope = reg?.scope || ''
        // Trạng thái worker: 'active' | 'installing' | 'waiting' | 'redundant'
        d.swState =
          reg?.active?.state || reg?.waiting?.state || reg?.installing?.state || 'none'
        if (!reg) d.error = 'Service Worker chưa kịp kích hoạt (chưa có registration active).'
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (sub) {
          d.hasSubscription = true
          try {
            d.endpointHost = new URL(sub.endpoint).host
          } catch {
            /* bỏ qua */
          }
          d.syncedLocally = isSynced(sub.endpoint)
        }
      } catch (e) {
        d.error = e?.message || String(e)
      }
    }

    d.lastError = getLastPushError()
  } catch (e) {
    d.error = e?.message || String(e)
  }

  return d
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
