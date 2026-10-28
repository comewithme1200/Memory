import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

/**
 * Đăng ký lắng nghe thay đổi của bảng `orders` qua Supabase Realtime.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN HOOK NÀY?
 *
 * Trước đây trang "Đơn hàng" tự làm mới mỗi 15s (`setInterval`). Cách đó
 * có 2 hạn chế:
 *   - 15s là lâu khi bếp đang chờ đơn (khách gọi xong mà chủ quán chưa thấy)
 *   - nếu rút xuống 3-5s thì mỗi máy đều poll liên tục -> tốn băng thông,
 *     dễ chạm giới hạn rate-limit của Supabase free plan.
 *
 * Realtime giải quyết cả hai: khi có đơn mới (hoặc đơn bị sửa/xoá), Supabase
 * ĐẨY sự kiện qua WebSocket tới trình duyệt -> ta nạp lại danh sách ngay.
 * Không tốn request khi không có gì thay đổi.
 *
 * ---------------------------------------------------------------------------
 * BẢO MẬT
 *
 * Realtime vẫn bị RLS áp dụng: chỉ tài khoản `authenticated` (chủ quán đã
 * đăng nhập) mới nhận được sự kiện của bảng `orders`. Khách (anon) không
 * có policy đọc `orders` -> không nhận được gì.
 *
 * ---------------------------------------------------------------------------
 * LƯU Ý VỀ REPLICA IDENTITY
 *
 * Cần chạy `supabase/migration-realtime.sql` để bảng `orders` có
 * `replica identity full` và nằm trong publication `supabase_realtime`.
 * Nếu chưa chạy, hook sẽ không nhận được sự kiện nào (vẫn chạy bình thường,
 * chỉ là không realtime) — polling 15s vẫn hoạt động như dự phòng.
 *
 * ---------------------------------------------------------------------------
 * @param {(payload) => void} onChange  gọi khi có INSERT/UPDATE/DELETE
 * @param {boolean} enabled            bật/tắt (ví dụ khi chưa đăng nhập)
 * @returns {{ live: boolean }}  `live = true` nếu kênh đã subscribe thành công
 *   (tức là sẽ nhận được sự kiện). Caller dùng để chọn chu kỳ polling:
 *   realtime hoạt động -> poll thưa (lưới an toàn), không hoạt động -> poll
 *   nhanh hơn để vẫn thấy đơn mới.
 */
export function useOrdersRealtime(onChange, enabled = true) {
  const [live, setLive] = useState(false)

  useEffect(() => {
    // Chế độ demo (localStorage) không có Realtime -> bỏ qua.
    if (!supabase || !enabled) {
      setLive(false)
      return
    }

    let disposed = false

    const channel = supabase
      .channel('orders-live')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT + UPDATE + DELETE
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          if (disposed) return
          onChange?.(payload)
        },
      )
      .subscribe((status) => {
        // SUBSCRIBED = kênh đã mở, nhưng để chắc chắn bảng `orders` đã
        // nằm trong publication `supabase_realtime`, ta coi là "live" khi
        // có ít nhất 1 sự kiện đến. Tới lúc đó polling sẽ tự chuyển sang
        // chu kỳ dài (xem OrdersPage).
        if (status === 'SUBSCRIBED') setLive(true)
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (!disposed) setLive(false)
        }
      })

    return () => {
      disposed = true
      setLive(false)
      // Gỡ channel để không rò rỉ khi rời trang / đổi tab.
      try {
        supabase.removeChannel(channel)
      } catch {
        /* bỏ qua lỗi dọn dẹp */
      }
    }
  }, [onChange, enabled])

  return { live }
}

export default useOrdersRealtime
