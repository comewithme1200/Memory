/**
 * Đổi khoá VAPID PRIVATE từ định dạng PKCS#8 sang raw 32 bytes.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN?
 *
 * Thư viện `web-push` (dùng trong Edge Function `send-push`) yêu cầu:
 *
 *   - `publicKey`  = base64url của 65 byte (0x04 + X + Y)  -> ĐÚNG RỒI
 *   - `privateKey` = base64url của **32 byte thô** (đại lượng EC) — KHÔNG phải
 *                     DER/PKCS#8.
 *
 * Nhưng `scripts/generate-vapid-keys.mjs` xuất PKCS#8 (48 byte) -> Edge
 * Function báo lỗi:
 *     "Vapid private key should be 32 bytes long when decoded."
 *
 * Script này lấy 32 byte cuối của PKCS#8 (chính là đại lượng EC) rồi mã hoá
 * lại base64url -> giữ nguyên cặp khoá, chỉ đổi định dạng.
 *
 * Dùng:
 *     node scripts/fix-vapid-private.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function base64urlToBuffer(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/') + padding
  return Buffer.from(base64, 'base64')
}

function bufferToBase64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- Đọc .env ---
const envPath = join(ROOT, '.env')
if (!existsSync(envPath)) {
  console.error('Không tìm thấy .env')
  process.exit(1)
}

const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
const env = {}
for (const line of lines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const priv = env.VAPID_PRIVATE_KEY
if (!priv) {
  console.error('Thiếu VAPID_PRIVATE_KEY trong .env')
  process.exit(1)
}

const raw = base64urlToBuffer(priv)
console.log(`Khoá hiện tại: ${raw.length} byte (PKCS#8)`)

// PKCS#8 của P-256 dài 48 byte; 32 byte cuối chính là đại lượng EC.
let scalar
if (raw.length === 32) {
  console.log('Đã đúng định dạng raw 32 byte — không cần đổi.')
  scalar = raw
} else if (raw.length >= 32) {
  scalar = raw.subarray(raw.length - 32)
  console.log(`Lấy 32 byte cuối làm đại lượng EC.`)
} else {
  console.error(`Khoá quá ngắn (${raw.length} byte) — hãy sinh lại bằng \`npm run gen:vapid\`.`)
  process.exit(1)
}

const fixed = bufferToBase64url(scalar)

// Ghi lại .env
const out = lines.map((l) => {
  if (/^\s*VAPID_PRIVATE_KEY\s*=/.test(l)) return `VAPID_PRIVATE_KEY=${fixed}`
  return l
})
writeFileSync(envPath, out.join('\n'), 'utf8')

console.log(`\n✔ VAPID_PRIVATE_KEY đã đổi sang raw 32 byte:`)
console.log(`  ${fixed}`)
console.log(`\nCặp khoá VẪN HỢP LỆ (public key không đổi) -> không cần đăng ký lại push.`)
console.log(`\nBước tiếp theo: chạy lại \`npm run setup:push\` để cập nhật Secret cho Edge Function.`)
