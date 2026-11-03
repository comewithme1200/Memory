/* eslint-env serviceworker */
/**
 * SERVICE WORKER — bắt buộc cho Web Push trên iOS.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN SERVICE WORKER?
 *
 * Trên iPhone (Safari), sau khi bấm "Thêm vào Màn hình chính" và mở app từ
 * màn hình chính:
 *   - `new Notification(...)` KHÔNG hoạt động (Safari iOS không có hàm khởi
 *     tạo thông báo trực tiếp).
 *   - Chỉ `ServiceWorkerRegistration.showNotification(...)` mới hoạt động.
 *   - Nhận thông báo khi app đã ĐÓNG / màn hình KHOÁ -> bắt buộc phải có
 *     Service Worker lắng nghe sự kiện `push`.
 *
 * Nên: đây không phải "nice to have" mà là điều kiện tiên quyết cho iPhone.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG CACHE APP SHELL?
 *
 * Vite sinh tên file có hash (`index-abc123.js`). Khi deploy bản mới, các
 * file cũ bị xoá -> nếu SW cache lại HTML cũ thì app sẽ tham chiếu file
 * không còn tồn tại và trắng trang. Với app này (cần mạng để thấy đơn)
 * cache cũng không có ích. Nên SW chỉ lo phần THÔNG BÁO.
 *
 * Lưu ý: `updateViaCache: 'none'` + `skipWaiting` để bản mới của SW có
 * hiệu lực ngay, không bị "dính" bản cũ.
 */

const SW_VERSION = 'v1'

self.addEventListener('install', (event) => {
  // `skipWaiting()` để bản SW mới có hiệu lực ngay.
  //
  // KHÔNG gọi `self.clients.claim()` ở đây! Theo spec, `Clients.claim()`
  // chỉ hợp lệ khi service worker đang ở trạng thái `activating`/`activated`.
  // Gọi ở pha `install` sẽ ném `InvalidStateError` -> `install` thất bại ->
  // worker KHÔNG BAO GIỜ active -> `pushManager.subscribe()` cũng ném
  // `InvalidStateError` ("Subscribing for push requires an active service worker").
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  // Xoá cache cũ nếu sau này có thêm cache, và tiếp quản các client đang mở.
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== SW_VERSION).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/* ------------------------------------------------------------------ *
 * NHẬN THÔNG BÁO TỪ SERVER (Web Push)
 * ------------------------------------------------------------------ */

/**
 * Payload server gửi xuống:
 *   { title, body, url, tag, icon, badge }
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }

  // Đường dẫn tương đối để đúng khi deploy ở thư mục con (GitHub Pages).
  const base = self.registration.scope || './'

  const title = data.title || '🔔 Đơn mới!'
  const options = {
    body: data.body || '',
    icon: data.icon || `${base}icon-192.png`,
    badge: data.badge || `${base}icon-192.png`,
    // `tag` giống nhau -> thông báo mới THAY THẾ cái cũ (thay vì cộng dồn).
    // Đây là lưới an toàn: nếu vì lý do gì đó server gửi trùng 2 lần, chủ
    // quán vẫn chỉ thấy 1 thông báo cho mỗi đơn.
    tag: data.tag || 'quan-an-sang-order',
    // KHÔNG bật `renotify` -> tránh kêu chuông lại khi thông báo bị thay thế.
    renotify: false,
    requireInteraction: false,
    // iOS: `silent` chưa được hỗ trợ đầy đủ, nhưng đặt false để chuông
    // mặc định của hệ thống được phát.
    silent: false,
    data: { url: data.url || `${base}#/quan-tri/orders` },
    vibrate: [180, 90, 180],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

/* ------------------------------------------------------------------ *
 * BẤM VÀO THÔNG BÁO -> MỞ ĐÚNG TRANG
 * ------------------------------------------------------------------ */

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = (event.notification.data && event.notification.data.url) || '/#/quan-tri/orders'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Nếu app đang mở -> focus tab đó và điều hướng tới trang đích.
      for (const client of clients) {
        if ('focus' in client) {
          try {
            await client.focus()
            if ('navigate' in client && client.url !== target) {
              await client.navigate(target)
            }
            return
          } catch {
            /* bỏ qua, thử client tiếp theo */
          }
        }
      }

      // App đang đóng -> mở cửa sổ mới.
      if (self.clients.openWindow) {
        await self.clients.openWindow(target)
      }
    })(),
  )
})

/* ------------------------------------------------------------------ *
 * CLICK VÀO THÔNG BÁO TỪ `showNotification()` CỦA TRANG (foreground)
 * ------------------------------------------------------------------ */

// Không cần xử lý gì thêm ở đây — trang tự xử lý onclick.
