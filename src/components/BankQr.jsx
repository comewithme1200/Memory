import { useEffect, useState } from 'react'

/**
 * Ảnh QR ngân hàng.
 *
 * Chủ quán tự copy ảnh QR thật vào thư mục `public/` với tên
 * `bank-qr.png` (đặt tên khác thì sửa hằng số `SOURCES` bên dưới).
 *
 * Nếu chưa có ảnh -> hiện một khung placeholder kèm hướng dẫn, để khách
 * vẫn đặt món được bằng cách chuyển khoản thủ công.
 *
 * Có thể ép ảnh khác bằng biến môi trường `VITE_BANK_QR_URL` (không cần
 * sửa code), ví dụ trong `.env`:
 *   VITE_BANK_QR_URL=/bank-qr.png
 */
const SOURCES = [
  import.meta.env.VITE_BANK_QR_URL,
  `${import.meta.env.BASE_URL || './'}bank-qr.png`,
].filter(Boolean)

export default function BankQr({ size = 240 }) {
  // `src` = ảnh đã xác nhận load được; null = chưa có / đang thử.
  const [src, setSrc] = useState(null)

  useEffect(() => {
    let alive = true

    // Thử lần lượt từng nguồn ảnh cho tới khi có ảnh load được.
    // Dùng `Image` để kiểm tra TRƯỚC khi render, tránh tình trạng <img>
    // báo onError cho ảnh cũ rồi làm React đổi src liên tiếp.
    const tryNext = (i) => {
      if (!alive) return
      if (i >= SOURCES.length) {
        setSrc(null)
        return
      }
      const probe = new Image()
      probe.onload = () => {
        if (alive) setSrc(SOURCES[i])
      }
      probe.onerror = () => {
        if (alive) tryNext(i + 1)
      }
      probe.src = SOURCES[i]
    }

    tryNext(0)
    return () => {
      alive = false
    }
  }, [])

  if (!src) {
    return (
      <div className="bank-qr-missing" style={{ width: size, height: size }}>
        <svg
          className="bank-qr-placeholder-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="98" height="98" rx="8" fill="#f3f4f6" stroke="#d1d5db" strokeWidth="2" strokeDasharray="6 4" />
          <text x="50" y="44" textAnchor="middle" fontSize="13" fill="#9ca3af" fontFamily="sans-serif">
            QR NGÂN HÀNG
          </text>
          <text x="50" y="60" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="sans-serif">
            (placeholder)
          </text>
          <text x="50" y="78" textAnchor="middle" fontSize="7.5" fill="#6b7280" fontFamily="sans-serif">
            copy ảnh vào public/bank-qr.png
          </text>
        </svg>
      </div>
    )
  }

  return (
    <img
      className="bank-qr-img"
      src={src}
      alt="QR chuyển khoản ngân hàng"
      style={{ width: size, height: size }}
    />
  )
}
