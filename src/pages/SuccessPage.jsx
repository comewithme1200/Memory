import { Link, useLocation } from 'react-router-dom'
import { fmtVND, fmtTime } from '../lib/format.js'
import BankQr from '../components/BankQr.jsx'

export default function SuccessPage() {
  const location = useLocation()
  const order = location.state?.order
  const items = order?.items || []
  const count = items.reduce((s, it) => s + (it.qty || 0), 0)
  const isTransfer = order?.payment_method === 'transfer'

  /**
   * Link "Đặt đơn khác" — giữ lại token QR để thông tin điền sẵn không mất.
   *
   * Token lấy từ đơn vừa đặt (`customer_token`). Nếu không có (vd đơn cũ),
   * thử đọc từ sessionStorage — cùng nơi OrderPage lưu token khi đọc QR.
   */
  const nextOrderLink = (() => {
    let token = order?.customer_token || ''
    if (!token) {
      try {
        token = sessionStorage.getItem('quan-an-sang:qr-token') || ''
      } catch {
        token = ''
      }
    }
    return token ? `/?qr=${encodeURIComponent(token)}` : '/'
  })()

  return (
    <div className="page page-center">
      <div className="card success-card">
        <div className="success-icon">✅</div>
        <h1>Đặt món thành công!</h1>
        {order?.code && <div className="success-code">Mã đơn: #{order.code}</div>}
        {order?.pickup_time && (
          <div className="success-code">🕒 Nhận món lúc {fmtTime(order.pickup_time)}</div>
        )}
        {order && (
          <>
            <ul className="success-items">
              {items.map((it, i) => (
                <li key={`${it.id}-${i}`}>
                  <span className="oi-qty">{it.qty}×</span>
                  <span className="oi-name">{it.name}</span>
                  <span className="oi-price muted">{fmtVND(it.price * it.qty)}</span>
                  {it.note?.trim() && <div className="success-item-note">📝 {it.note}</div>}
                </li>
              ))}
            </ul>
            <div className="modal-total">
              <span>Tổng ({count} món)</span>
              <strong>{fmtVND(order.total)}</strong>
            </div>

            {/* ---- Thanh toán ---- */}
            <div className="success-pay">
              <div className="success-pay-head">
                {isTransfer ? '🏦 Chuyển khoản' : '💵 Thanh toán tiền mặt'}
              </div>
              {isTransfer ? (
                <>
                  <BankQr size={220} />
                  <p className="muted small">
                    Quét mã và chuyển đúng <strong>{fmtVND(order.total)}</strong>. Quán sẽ kiểm tra
                    và xác nhận cho bạn.
                  </p>
                </>
              ) : (
                <p className="muted small">Bạn trả tiền mặt khi nhận món. Cảm ơn bạn!</p>
              )}
            </div>
          </>
        )}
        <p className="muted">
          Bếp sẽ chuẩn bị ngay. Vui lòng chờ tại quán hoặc để người giao đến lấy.
        </p>
        {/*
          "Đặt đơn khác" phải GIỮ LẠI token QR trong URL.
          Nếu không, khách quay lại trang đặt món sẽ không còn `?qr=` -> mất
          toàn bộ thông tin đã điền sẵn (tên / SĐT / địa chỉ).
        */}
        <Link className="btn btn-primary" to={nextOrderLink}>
          Đặt đơn khác
        </Link>
      </div>
    </div>
  )
}
