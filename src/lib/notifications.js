/**
 * Âm báo + thông báo hệ thống khi có đơn mới.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG DÙNG FILE ÂM THANH?
 *
 * Tạo WAV ngay trong JS (sine wave + fade) thành Blob URL. Ưu điểm:
 *   - không phải ship file .mp3/.wav trong bundle;
 *   - không phụ thuộc asset ngoài, không bị lỗi 404 khi deploy;
 *   - chạy được cả ở chế độ demo (localStorage) lẫn bản Supabase.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN "MỞ KHOÁ ÂM THANH"?
 *
 * Cả iOS Safari lẫn Chrome trên Android đều chặn phát âm thanh tự động
 * cho tới khi người dùng có tương tác với trang (autoplay policy).
 * Vì vậy ta cần:
 *   1. một nút "🔔 Bật âm báo" mà chủ quán bấm 1 lần (chủ động),
 *   2. đồng thời tự động cố `resume()` AudioContext khi có bất kỳ
 *      tương tác nào đầu tiên nào trên trang.
 *
 * ---------------------------------------------------------------------------
 * GIỚI HẠN CỦA WEB APP (nói rõ để không ai bất ngờ)
 *
 *   - Điện thoại KHÓA MÀN HÌNH: hầu hết trình duyệt sẽ dừng JavaScript
 *     của tab nền -> không kêu được. Muốn có thông báo khi màn hình tắt
 *     hoàn toàn thì cần Web Push + Service Worker (cần server push).
 *   - iOS: chỉ hỗ trợ Notification API từ iOS 16.4+ và app PHẢI được
 *     cài (Add to Home Screen) thì mới bền hơn. Safari iOS cũng KHÔNG hỗ
 *     trợ `new Notification()` -> phải đi qua Service Worker (xem pwa.js).
 * ------------------------------------------------------------------ */

import { showNotification, assetUrl } from './pwa.js'

const SOUND_KEY = 'quan-an-sang:alert-sound'
const UNLOCKED_KEY = 'quan-an-sang:audio-unlocked'

/* ------------------------------------------------------------------ *
 * 1. TẠO WAV
 * ------------------------------------------------------------------ */

/**
 * Dựng WAV 16-bit mono từ danh sách nốt [tần số Hz, thời lượng ms].
 * @param {Array<[number, number]>} tones
 * @returns {Blob}
 */
function buildWav(tones) {
  const SAMPLE_RATE = 44100
  const segments = []
  let totalSamples = 0

  for (const [freq, ms] of tones) {
    const n = Math.floor((SAMPLE_RATE * ms) / 1000)
    totalSamples += n
    segments.push({ freq, n })
  }

  const dataSize = totalSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // kích thước khối fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits/sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  // Hình sin + fade in/out để không bị "click" (tiếng rè) khi bắt đầu/dừng.
  let offset = 44
  for (const { freq, n } of segments) {
    for (let i = 0; i < n; i++) {
      const t = i / n
      const fade = Math.min(1, t / 0.08) * Math.min(1, (1 - t) / 0.12)
      const sample = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * fade * 0.5
      view.setInt16(offset, sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

let soundUrl = null
function getSoundUrl() {
  if (!soundUrl) {
    // Hai nốt lên nhau: "ding-dong" quen thuộc, dễ nhận ra giữa tiếng ồn bếp.
    soundUrl = URL.createObjectURL(buildWav([[880, 180], [0, 60], [1174, 260]]))
  }
  return soundUrl
}

/* ------------------------------------------------------------------ *
 * 2. MỞ KHOÁ / PHÁT ÂM
 * ------------------------------------------------------------------ */

let audioCtx = null

function getAudioCtx() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) {
    try {
      audioCtx = new Ctx()
    } catch {
      return null
    }
  }
  return audioCtx
}

/**
 * Mở khoá phát âm thanh. Phải được gọi từ trong một sự kiện người dùng
 * (click/touch) thì trình duyệt mới cho phép phát sau đó.
 */
export function unlockAudio() {
  const ctx = getAudioCtx()
  if (!ctx) return false
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  // Phát một đoạn gần như im lặng để "mở khoá" đường âm thanh.
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  } catch {
    /* bỏ qua */
  }
  try {
    localStorage.setItem(UNLOCKED_KEY, '1')
  } catch {
    /* bỏ qua */
  }
  return true
}

/** Đã từng mở khoá chưa (để hiển thị trạng thái nút). */
export function isAudioUnlocked() {
  try {
    return localStorage.getItem(UNLOCKED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Phát âm báo đơn mới.
 * @param {boolean} force  bỏ qua trạng thái đã tắt âm báo
 */
export function playAlertSound(force = false) {
  if (!force) {
    try {
      if (localStorage.getItem(SOUND_KEY) === '0') return
    } catch {
      /* bỏ qua */
    }
  }

  // Cách 1: Web Audio — không cần file, độ trễ thấp nhất.
  const ctx = getAudioCtx()
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    try {
      const now = ctx.currentTime
      const master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(ctx.destination)

      const tones = [
        [880, 0],
        [1174, 0.24],
      ]
      for (const [freq, at] of tones) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, now + at)
        gain.gain.linearRampToValueAtTime(0.5, now + at + 0.02)
        gain.gain.linearRampToValueAtTime(0, now + at + 0.22)
        osc.connect(gain)
        gain.connect(master)
        osc.start(now + at)
        osc.stop(now + at + 0.25)
      }
      return
    } catch {
      /* rơi xuống cách 2 */
    }
  }

  // Cách 2: <audio> với WAV dựng sẵn.
  try {
    const audio = new Audio(getSoundUrl())
    audio.volume = 1
    const p = audio.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* bỏ qua */
  }
}

/* ------------------------------------------------------------------ *
 * 3. THÔNG BÁO HỆ THỐNG
 * ------------------------------------------------------------------ */

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Xin quyền hiển thị thông báo hệ thống.
 * @returns {Promise<string>} trạng thái sau khi xin: 'granted' | 'denied' | 'default' | 'unsupported'
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  try {
    const p = await Notification.requestPermission()
    return p
  } catch {
    return Notification.permission
  }
}

/**
 * Bắn thông báo hệ thống cho đơn mới.
 *
 * Dùng `showNotification()` của `pwa.js` -> ưu tiên
 * `registration.showNotification()` (BẮT BUỘC trên iOS, vì Safari iOS không
 * hỗ trợ `new Notification()`), fallback về `new Notification()`.
 *
 * @param {{id?:string, code?:string, customer_name?:string, customer_phone?:string, total?:number}} order
 */
export function showOrderNotification(order = {}) {
  if (!isNotificationSupported()) return null
  if (Notification.permission !== 'granted') return null

  const who = order.customer_name?.trim() || 'Khách'
  const phone = order.customer_phone?.trim()
  const title = '🔔 Đơn mới!' + (order.code ? ` #${order.code}` : '')
  const body = [
    who,
    phone && `SĐT ${phone}`,
    order.total ? `Tổng ${Number(order.total).toLocaleString('vi-VN')}đ` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  // Khi tab ĐANG HIỆN: ta tự phát tiếng bằng Web Audio (đảm bảo nghe rõ,
  // không phụ thuộc cài đặt chuông của hệ điều hành) -> tắt tiếng của
  // notification để không bị kêu 2 lần.
  //
  // Khi tab ĐANG ẨN (điện thoại nằm trong túi / màn hình tắt nhưng trình
  // duyệt còn sống): Web Audio thường bị throttle -> để hệ điều hành tự
  // phát tiếng chuông của notification.
  const pageHidden = typeof document !== 'undefined' && document.hidden

  try {
    const p = showNotification({
      title,
      body,
      tag: `order-${order.id || order.code || 'new'}`,
      url: './#/quan-tri/orders',
      icon: assetUrl('icon-192.png'),
      badge: assetUrl('icon-192.png'),
      silent: !pageHidden,
    })
    if (p && typeof p.then === 'function') {
      p.catch(() => {})
      return p
    }
    return p
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 4. RUNG (vibration) — chỉ Android hỗ trợ
 * ------------------------------------------------------------------ */

export function vibrateAlert() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180])
    }
  } catch {
    /* bỏ qua */
  }
}

/* ------------------------------------------------------------------ *
 * 5. BẬT / TẮT ÂM BÁO
 * ------------------------------------------------------------------ */

export function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    return true
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0')
  } catch {
    /* bỏ qua */
  }
}
