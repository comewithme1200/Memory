import { useEffect, useRef } from 'react'
import { supabase } from './supabase.js'
import { listOrders } from './db.js'
import {
  playAlertSound,
  showOrderNotification,
  vibrateAlert,
  isSoundEnabled,
  unlockAudio,
} from './notifications.js'

/**
 * Báo đơn mới TOÀN CỤC trong khu vực quản trị.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TÁCH RIÊNG KHỎI `OrdersPage`?
 *
 * Chủ quán dùng điện thoại thường để ở tab khác (Món ăn, Tổng kết...) hoặc
 * để màn hình trong khi chờ. Nếu chỉ báo trong `OrdersPage` thì khi họ đang
 * ở tab khác sẽ KHÔNG có âm báo -> tương đương với không có gì.
 *
 * Hook này được mount ở `AdminLayout` (bọc toàn bộ khu vực quản trị) nên
 * đơn mới sẽ kêu / hiện thông báo dù đang ở tab nào.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO DÙNG KÊNH REALTIME RIÊNG (`orders-alerts`)?
 *
 * `OrdersPage` đã có kênh `orders-live` để nạp lại danh sách. Nếu dùng
 * chung tên kênh thì Supabase JS có thể gộp/hủy nhầm khi một trong hai
 * unmount. Tách tên cho an toàn.
 *
 * ---------------------------------------------------------------------------
 * CHẾ ĐỘ DEMO (localStorage)
 *
 * Không có Realtime -> không có push. Để vẫn "kêu" được, hook này có
 * thêm cơ chế poll nhẹ: so sánh số đơn `new` với lần poll trước, nếu
 * tăng lên -> báo đơn mới.
 *
 * @param {boolean} enabled bật/tắt (chỉ bật khi đã đăng nhập)
 * @param {(order:object) => void} [onNewOrder] callback khi có đơn mới
 *   (dùng để hiện banner trong app — hoạt động kể cả khi người dùng đã
 *   từ chối quyền thông báo hệ thống).
 */
export function useOrderAlerts(enabled = true, onNewOrder) {
  // Danh sách id đơn đã báo -> tránh báo trùng khi poll hoặc khi StrictMode
  // chạy effect 2 lần.
  const seenRef = useRef(new Set())
  const primedRef = useRef(false)
  const onNewOrderRef = useRef(onNewOrder)
  onNewOrderRef.current = onNewOrder

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let channel = null

    /** Báo đơn mới: kêu + thông báo hệ thống + banner trong app. */
    const notify = (row) => {
      if (disposed) return
      fireAlert(row)
      try {
        onNewOrderRef.current?.(row)
      } catch {
        /* bỏ qua lỗi callback */
      }
    }

    /* ---------------- Realtime (bản có Supabase) ---------------- */
    // Đẩy sự kiện tức thì khi có đơn mới -> kêu ngay.
    if (supabase) {
      channel = supabase
        .channel('orders-alerts')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          (payload) => {
            const row = payload?.new || {}
            if (!row.id || seenRef.current.has(row.id)) return
            seenRef.current.add(row.id)
            notify(row)
          },
        )
        .subscribe()
    }

    /* ---------------- Poll dự phòng ----------------
     *
     * Chạy cả 2 chế độ:
     *   - Demo (localStorage): KHÔNG có realtime -> poll là nguồn chính.
     *   - Supabase: poll thưa (20s) làm lưới an toàn, phòng khi
     *     `supabase/migration-realtime.sql` chưa được chạy -> realtime
     *     im lặng, hoặc điện thoại bị ngủ làm WebSocket rớt.
     *
     * Cơ chế chống báo trùng: set `seenRef` chung cho cả 2 nguồn -> cùng
     * một đơn chỉ báo đúng 1 lần dù đến từ realtime hay từ poll.
     */
    let cancelled = false

    const poll = async () => {
      try {
        const list = await listOrders({ limit: 50 })
        if (cancelled || !Array.isArray(list)) return

        const newOnes = list.filter((o) => o.status === 'new')
        if (!primedRef.current) {
          // Lần đầu chỉ ghi nhớ trạng thái, KHÔNG báo (tránh kêu ồn khi
          // vừa mở app).
          primedRef.current = true
          newOnes.forEach((o) => seenRef.current.add(o.id))
          return
        }

        // So với danh sách id đã biết -> đơn nào chưa từng thấy là đơn mới.
        // (Không so sánh SỐ LƯỢNG: nếu một đơn bị huỷ/hết hạn thì số đơn
        // "new" giảm, đơn mới về sau sẽ không làm số tăng -> bị bỏ sót.)
        const fresh = newOnes
          .filter((o) => !seenRef.current.has(o.id))
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

        fresh.forEach((o) => {
          seenRef.current.add(o.id)
          notify(o)
        })
      } catch {
        /* bỏ qua lỗi poll */
      }
    }

    poll()
    const timer = setInterval(poll, supabase ? 20000 : 5000)

    return () => {
      disposed = true
      cancelled = true
      clearInterval(timer)
      try {
        if (channel) supabase.removeChannel(channel)
      } catch {
        /* bỏ qua lỗi dọn dẹp */
      }
    }
  }, [enabled])
}

/**
 * Kêu + hiện thông báo cho 1 đơn mới.
 */
export function fireAlert(order) {
  if (isSoundEnabled()) {
    playAlertSound()
    vibrateAlert()
  }
  showOrderNotification(order)
}
/**
 * Bật khoá âm thanh khi người dùng tương tác lần đầu tiên trên trang.
 *
 * iOS/Android đều yêu cầu "user gesture" mới cho phép phát âm thanh. Nếu
 * chủ quán mở app bằng link trên điện thoại và chạm vào màn hình bất kỳ
 * lần nào, ta sẽ mở khoá luôn -> các đơn về sau đều kêu được.
 */
export function useAutoUnlockAudio() {
  useEffect(() => {
    const handler = () => {
      try {
        unlockAudio()
      } catch {
        /* bỏ qua */
      }
    }
    const opts = { once: true, passive: true }
    window.addEventListener('pointerdown', handler, opts)
    window.addEventListener('touchstart', handler, opts)
    window.addEventListener('keydown', handler, opts)
    return () => {
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('touchstart', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [])
}

export default useOrderAlerts
