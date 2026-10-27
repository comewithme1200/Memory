// Định dạng tiền tệ, ngày giờ phục vụ Việt Nam
export const fmtVND = (n) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)) + ' đ'

export const fmtNumber = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0)

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Khoá ngày theo định dạng YYYY-MM-DD (giờ địa phương) */
export const dateKey = (d = new Date()) => {
  const dt = typeof d === 'string' ? new Date(d) : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const todayKey = () => dateKey(new Date())

export const startOfDay = (key) => new Date(`${key}T00:00:00`)
export const endOfDay = (key) => new Date(`${key}T23:59:59.999`)

/** Mã đơn ngắn, dễ đọc: 3 chữ cái + 3 số */
export const randomOrderCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let s = ''
  for (let i = 0; i < 3; i++) s += letters[Math.floor(Math.random() * letters.length)]
  const n = Math.floor(Math.random() * 900) + 100
  return `${s}${n}`
}

/**
 * Sinh UUID v4.
 * KHÔNG dùng crypto.randomUUID() vì hàm đó chỉ có trong "secure context"
 * (https hoặc localhost). Khi mở app bằng địa chỉ LAN (http://192.168.x.x:5173)
 * để khách đặt món bằng điện thoại thì randomUUID() không tồn tại -> id sinh ra
 * không phải UUID hợp lệ -> lỗi khi insert vào cột `uuid`.
 */
export const uuidV4 = () => {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // version 4 + variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
