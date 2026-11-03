/**
 * Sinh icon PNG cho PWA (không phụ thuộc thư viện ngoài).
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO PHẢI LÀ PNG, KHÔNG PHẢI SVG?
 *
 *   - iOS KHÔNG dùng SVG cho `apple-touch-icon`. Nếu trỏ tới file .svg thì
 *     khi bấm "Thêm vào Màn hình chính" trên iPhone, icon màn hình chính sẽ
 *     bị trống / hiện ảnh chụp màn hình -> rất xấu.
 *   - Chrome/Android cũng bỏ qua icon SVG trong manifest khi hiện hộp thoại
 *     "Cài ứng dụng".
 *
 * ---------------------------------------------------------------------------
 * CÁCH DÙNG
 *
 *   node scripts/generate-icons.mjs
 *
 * Sinh ra trong `public/`:
 *   icon-192.png          -> manifest (icon chuẩn)
 *   icon-512.png          -> manifest (icon chuẩn)
 *   icon-512-maskable.png -> manifest (icon maskable, có viền an toàn)
 *   apple-touch-icon.png  -> iOS (180x180, KHÔNG bo góc, KHÔNG trong suốt)
 *   favicon.png           -> favicon 32x32
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public')

/* ------------------------------------------------------------------ *
 * BỘ MÃ HOÁ PNG TỐI GIẢN (RGBA 8-bit)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgba  w*h*4 byte
 * @returns {Buffer}
 */
function encodePng(w, h, rgba) {
  // Mỗi scanline: 1 byte filter (0 = None) + w*4 byte pixel
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(
      raw,
      y * (w * 4 + 1) + 1,
    )
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 * VẼ
 * ------------------------------------------------------------------ */

const ORANGE = [232, 89, 12]
const CREAM = [255, 249, 235]
const WHITE = [255, 255, 255]

/** Trộn màu nền trong suốt với màu vẽ. */
function blend(dst, i, rgb, alpha) {
  if (alpha <= 0) return
  const a = Math.min(1, alpha)
  dst[i] = Math.round(dst[i] * (1 - a) + rgb[0] * a)
  dst[i + 1] = Math.round(dst[i + 1] * (1 - a) + rgb[1] * a)
  dst[i + 2] = Math.round(dst[i + 2] * (1 - a) + rgb[2] * a)
  dst[i + 3] = Math.round(dst[i + 3] * (1 - a) + 255 * a)
}

/**
 * Vẽ icon "bát mì" đơn giản trên nền cam.
 * @param {number} size
 * @param {boolean} maskable nếu true -> nền full-bleed + nội dung nhỏ lại
 */
function drawIcon(size, maskable = false) {
  const px = new Uint8Array(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const s = size / 512 // hệ số scale (thiết kế ở 512x512)

  // ---- Nền ----
  const radius = maskable ? 0 : 112 * s // iOS tự bo góc -> vuông full cho apple-touch
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (radius > 0) {
        // bo góc có anti-alias mềm
        const dx = Math.max(radius - x, 0, x - (size - 1 - radius))
        const dy = Math.max(radius - y, 0, y - (size - 1 - radius))
        const d = Math.hypot(dx, dy)
        const alpha = d <= radius ? 1 : Math.max(0, 1 - (d - radius))
        if (alpha <= 0) continue
      }
      px[i] = ORANGE[0]
      px[i + 1] = ORANGE[1]
      px[i + 2] = ORANGE[2]
      px[i + 3] = 255
    }
  }

  // ---- Hình học (tọa độ thiết kế 512x512) ----
  // Bát: nửa tròn phía dưới + miệng bát
  const bowlCX = 256
  const bowlCY = 300
  const bowlR = 150
  // Mì: vòng cung nổi lên trên miệng bát
  const noodleCX = 256
  const noodleCY = 232
  const noodleR = 138
  // Hơi nước
  const steam = [
    { x: 200, y: 150, r: 13 },
    { x: 256, y: 122, r: 13 },
    { x: 312, y: 150, r: 13 },
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const px512 = x / s
      const py512 = y / s

      // --- Mì (vòng cung trên) ---
      const dn = Math.hypot(px512 - noodleCX, py512 - noodleCY)
      // chỉ vẽ phần trên miệng bát
      if (dn <= noodleR && py512 <= bowlCY - 22) {
        blend(px, i, CREAM, 1)
      }

      // --- Bát ---
      const db = Math.hypot(px512 - bowlCX, py512 - bowlCY)
      const insideBowl = db <= bowlR && py512 >= bowlCY - 34
      if (insideBowl) {
        blend(px, i, CREAM, 1)
      }
      // Viền miệng bát (hình chữ nhật dẹt ở trên)
      if (
        py512 >= bowlCY - 46 &&
        py512 <= bowlCY - 18 &&
        Math.abs(px512 - bowlCX) <= bowlR + 12
      ) {
        blend(px, i, WHITE, 1)
      }
      // Đáy bát (chân bát)
      if (
        py512 > bowlCY + 128 &&
        py512 <= bowlCY + 152 &&
        Math.abs(px512 - bowlCX) <= 62
      ) {
        blend(px, i, WHITE, 1)
      }

      // --- Hơi nước ---
      for (const st of steam) {
        const d = Math.hypot(px512 - st.x, py512 - st.y)
        const a = Math.max(0, 1 - d / st.r)
        if (a > 0) blend(px, i, WHITE, a * 0.85)
      }
    }
  }

  // Nếu maskable -> thu nhỏ nội dung vào vùng an toàn 80%
  if (maskable) {
    const out = new Uint8Array(size * size * 4)
    const scale = 0.72
    const off = (size * (1 - scale)) / 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = Math.round((x - off) / scale)
        const sy = Math.round((y - off) / scale)
        const di = (y * size + x) * 4
        if (sx < 0 || sy < 0 || sx >= size || sy >= size) {
          out[di] = ORANGE[0]
          out[di + 1] = ORANGE[1]
          out[di + 2] = ORANGE[2]
          out[di + 3] = 255
        } else {
          const si = (sy * size + sx) * 4
          out[di] = px[si]
          out[di + 1] = px[si + 1]
          out[di + 2] = px[si + 2]
          out[di + 3] = px[si + 3]
        }
      }
    }
    return out
  }

  return px
}

/* ------------------------------------------------------------------ *
 * GHI FILE
 * ------------------------------------------------------------------ */

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon.png', size: 32, maskable: false },
]

mkdirSync(OUT_DIR, { recursive: true })

for (const t of TARGETS) {
  const rgba = drawIcon(t.size, t.maskable)
  const buf = encodePng(t.size, t.size, rgba)
  writeFileSync(join(OUT_DIR, t.file), buf)
  console.log(`✓ ${t.file}  (${t.size}x${t.size}, ${(buf.length / 1024).toFixed(1)} KB)`)
}

console.log('\nĐã sinh icon PWA trong public/.')
