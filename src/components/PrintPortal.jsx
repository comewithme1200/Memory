import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Invoice from './Invoice.jsx'

/**
 * Render hoá đơn vào #print-area rồi gọi hộp thoại in của trình duyệt.
 * Dùng cho: in tự động khi hoàn thành đơn, và in lại từ danh sách đơn.
 */
export default function PrintPortal({ order, onPrinted }) {
  useEffect(() => {
    if (!order) return
    // Chờ trình duyệt kịp vẽ khối hoá đơn trước khi mở hộp thoại in
    const t = setTimeout(() => {
      window.print()
      // Dọn khối in sau khi hộp thoại đóng (fallback nếu onafterprint không bắn)
      setTimeout(() => onPrinted?.(), 300)
    }, 150)

    const after = () => {
      onPrinted?.()
    }
    window.addEventListener('afterprint', after)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', after)
    }
  }, [order, onPrinted])

  if (!order) return null
  const target = document.getElementById('print-area')
  if (!target) return null

  return createPortal(<Invoice order={order} />, target)
}
