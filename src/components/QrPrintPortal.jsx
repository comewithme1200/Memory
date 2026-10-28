import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * In mã QR khách quen.
 *
 * Ảnh QR được render vào `#qr-print-area` (nằm ở cấp <body>, ngoài modal)
 * để CSS in `body > *:not(#qr-print-area) { display: none }` ẩn sạch
 * giao diện admin mà vẫn giữ lại mã QR.
 *
 * `window.print()` được gọi ĐỒNG BỘ trong `useLayoutEffect` để giữ được
 * "user gesture" — trên điện thoại, nếu gọi trong setTimeout thì iOS Safari
 * coi là code tự chạy và chặn im lặng -> bấm nút không ra gì.
 */
export default function QrPrintPortal({ dataUrl, name, onPrinted }) {
  // onPrinted thường là arrow inline -> đổi identity mỗi render.
  // Giữ trong ref để effect chỉ phụ thuộc vào dataUrl.
  const cbRef = useRef(onPrinted)
  cbRef.current = onPrinted

  useLayoutEffect(() => {
    if (!dataUrl) return

    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-qr')
      cbRef.current?.()
    }

    document.body.classList.add('printing-qr')
    window.print()

    // Safari/Chrome desktop đôi khi không bắn 'afterprint' -> dọn sau 60s.
    const t = setTimeout(finish, 60_000)

    window.addEventListener('afterprint', finish)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-qr')
    }
  }, [dataUrl])

  if (!dataUrl) return null
  const target = document.getElementById('qr-print-area')
  if (!target) return null

  return createPortal(
    <div className="qr-print-inner">
      <img className="qr-image" src={dataUrl} alt={`Mã QR của ${name || 'khách'}`} />
      {name && <div className="qr-name">{name}</div>}
    </div>,
    target,
  )
}
