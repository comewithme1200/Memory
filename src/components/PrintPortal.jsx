import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Invoice from './Invoice.jsx'

/**
 * Render hoá đơn vào #print-area rồi gọi hộp thoại in của trình duyệt.
 * Dùng cho: in tự động khi hoàn thành đơn, và in lại từ danh sách đơn.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO DÙNG useLayoutEffect + GỌI print() ĐỒNG BỘ (không setTimeout)?
 *
 * Trên điện thoại, `window.print()` chỉ hoạt động khi được gọi trong "user
 * gesture" (ngay khi người dùng bấm nút). Nếu bọc trong `setTimeout(...)`
 * thì trình duyệt coi đó là code tự chạy (không phải do người dùng bấm) ->
 * iOS Safari CHẶN im lặng -> bấm nút "In hoá đơn" không ra gì cả.
 *
 * `useLayoutEffect` chạy NGAY sau khi React đã cập nhật DOM, và vẫn nằm
 * trong cùng một "task" của cú click -> giữ được user gesture. Đây là cách
 * chuẩn để in ngay sau khi render nội dung cần in.
 *
 * Lưu ý thứ 2: hoá đơn phải được giữ trong DOM cho tới khi hộp thoại in
 * thực sự chụp lại nội dung. Nếu gỡ sớm (vài trăm ms) thì trên điện thoại
 * bản xem trước in có thể ra TRANG TRẮNG. Vì vậy ta chỉ gỡ khi nhận được
 * sự kiện 'afterprint', và có thêm 1 timer dự phòng dài hơn.
 * ---------------------------------------------------------------------------
 */
export default function PrintPortal({ order, onPrinted }) {
  // `onPrinted` thường là arrow function inline -> đổi identity mỗi lần
  // render. Nếu đưa thẳng vào deps của effect thì effect chạy lại -> in lặp.
  // Giữ trong ref để effect chỉ phụ thuộc vào `order`.
  const cbRef = useRef(onPrinted)
  cbRef.current = onPrinted

  useLayoutEffect(() => {
    if (!order) return

    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-invoice')
      cbRef.current?.()
    }

    // Gắn class để CSS @media print ẩn giao diện, chỉ in phần hoá đơn.
    document.body.classList.add('printing-invoice')

    // Gọi print() ĐỒNG BỘ, ngay trong effect -> giữ user gesture trên mobile.
    window.print()

    // Safari/Chrome desktop đôi khi không bắn 'afterprint'.
    // Timer dự phòng: đủ lâu để hộp thoại in chụp xong nội dung.
    const t = setTimeout(finish, 60_000)

    window.addEventListener('afterprint', finish)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-invoice')
    }
  }, [order])

  if (!order) return null
  const target = document.getElementById('print-area')
  if (!target) return null

  return createPortal(<Invoice order={order} />, target)
}
