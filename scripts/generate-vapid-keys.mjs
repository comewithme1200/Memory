/**
 * Sinh cặp khoá VAPID cho Web Push.
 *
 * ---------------------------------------------------------------------------
 * VAPID LÀ GÌ?
 *
 * Web Push dùng cơ chế chữ ký VAPID (Voluntary Application Server
 * Identification) để xác thực server gửi push:
 *
 *   - PUBLIC key  -> đưa vào code web (`VITE_VAPID_PUBLIC_KEY`). Ai cũng
 *                    thấy được, không bí mật.
 *   - PRIVATE key -> giữ ở SERVER (biến môi trường `VAPID_PRIVATE_KEY` của
 *                    Edge Function). KHÔNG BAO GIỜ đưa vào code web.
 *
 * Trình duyệt dùng public key để đăng ký `pushManager.subscribe()`.
 * Server dùng private key để ký gói tin gửi tới endpoint của thiết bị.
 *
 * ---------------------------------------------------------------------------
 * CÁCH DÙNG
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * In ra 2 dòng -> copy vào `.env`:
 *
 *   VITE_VAPID_PUBLIC_KEY=<public key>
 *   VAPID_PRIVATE_KEY=<private key>     <- dùng cho Edge Function
 *
 * Lưu ý: sinh MỘT cặp và dùng lâu dài. Đổi khoá = mất hết đăng ký push
 * cũ (mọi thiết bị phải đăng ký lại).
 */

import { webcrypto } from 'node:crypto'

const crypto = webcrypto

/** base64url (không padding) — định dạng mà `applicationServerKey` cần. */
function base64url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateVapidKeys() {
  // Cặp khoá ECDSA P-256 (làm việc cho cả Web Push VAPID).
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )

  // Public key: dạng RAW (65 byte, 0x04 + X + Y) — ĐÚNG định dạng mà
  // PushManager yêu cầu. Xuất ra dạng "spki" rồi bỏ header 26 byte.
  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const rawPublic = Buffer.from(publicKey).subarray(26)

  // Private key: PKCS#8 -> base64url. Edge Function dùng để ký.
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  return {
    publicKey: base64url(rawPublic),
    privateKey: base64url(privateKey),
  }
}

const { publicKey, privateKey } = await generateVapidKeys()

console.log('\n=== VAPID keys đã sinh ===\n')
console.log('Copy 2 dòng dưới vào file .env (và vào Secrets của Edge Function):\n')
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}\n`)
console.log('⚠️  PRIVATE KEY phải giữ kín — KHÔNG commit lên GitHub,')
console.log('    KHÔNG đưa vào code web. Chỉ đặt trong Edge Function Secrets.\n')
