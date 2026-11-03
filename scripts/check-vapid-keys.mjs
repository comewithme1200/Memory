/**
 * KIỂM TRA cặp khoá VAPID (public <-> private) trong `.env`.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN?
 *
 * Thư viện `web-push` (Edge Function `send-push`) yêu cầu:
 *
 *   - `publicKey`  = base64url của 65 byte (0x04 + X + Y)
 *   - `privateKey` = base64url của **32 byte thô** (đại lượng EC)
 *
 * Nếu 2 khoá KHÔNG phải một cặp -> server ký JWT sai -> Apple trả
 * `403 BadJwtToken` -> không có thông báo nào tới máy.
 *
 * ---------------------------------------------------------------------------
 * BUG ĐÃ GẶP (đừng làm lại)
 *
 * `scripts/generate-vapid-keys.mjs` từng dùng:
 *
 *     const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
 *     const rawPrivate = Buffer.from(pkcs8).subarray(-32)
 *
 * PKCS#8 của P-256 dài **138 byte**, KHÔNG phải 48. 32 byte CUỐI là **toạ độ
 * Y của public key** được nhúng trong private key, KHÔNG phải private scalar.
 *
 * -> Cặp khoá sinh ra KHÔNG khớp -> `BadJwtToken` mãi mãi.
 *
 * Cách ĐÚNG: export JWK -> `jwk.d` là private scalar 32 byte.
 *
 * ---------------------------------------------------------------------------
 * DÙNG
 *
 *     node scripts/check-vapid-keys.mjs
 *
 * Chỉ ĐỌC, không sửa gì. Exit code 1 nếu cặp khoá sai.
 */

import { createECDH } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const ok = (m) => console.log(`${GREEN}  OK  ${RESET} ${m}`)
const bad = (m) => console.log(`${RED} FAIL ${RESET} ${m}`)
const warn = (m) => console.log(`${YELLOW} WARN ${RESET} ${m}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)

const env = {}
{
  const p = join(ROOT, '.env')
  if (!existsSync(p)) {
    console.error('Không tìm thấy .env')
    process.exit(1)
  }
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const pub = env.VITE_VAPID_PUBLIC_KEY || ''
const priv = env.VAPID_PRIVATE_KEY || ''

if (!pub || !priv) {
  bad('Thiếu VITE_VAPID_PUBLIC_KEY hoặc VAPID_PRIVATE_KEY trong .env')
  process.exit(1)
}

const pubBuf = Buffer.from(pub, 'base64url')
const privBuf = Buffer.from(priv, 'base64url')

info(`public  : ${pubBuf.length} byte`)
info(`private : ${privBuf.length} byte`)

if (pubBuf.length !== 65 || pubBuf[0] !== 0x04) {
  bad('Public key phải là 65 byte và bắt đầu bằng 0x04 (điểm P-256 chưa nén).')
}
if (privBuf.length !== 32) {
  bad('Private key phải đúng 32 byte (đại lượng EC thô).')
  info('Chạy `npm run gen:vapid` để sinh cặp mới.')
  process.exit(1)
}

// Dẫn xuất public key từ private scalar -> so với public key trong .env.
let derived = ''
try {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privBuf)
  derived = ecdh.getPublicKey().toString('base64url')
} catch (e) {
  bad(`Private key không phải scalar EC hợp lệ: ${e.message}`)
  process.exit(1)
}

if (derived === pub) {
  ok('Cặp khoá KHỚP — server sẽ ký JWT đúng, Apple sẽ nhận.')
  process.exit(0)
}

bad('Cặp khoá KHÔNG KHỚP -> server ký JWT sai -> Apple trả 403 BadJwtToken.')
info(`public trong .env : ${pub}`)
info(`public dẫn xuất   : ${derived}`)
console.log('')
warn('Cách xử lý: sinh cặp khoá MỚI rồi đăng ký lại push trên mọi thiết bị.')
info('  1) node scripts/generate-vapid-keys.mjs')
info('  2) copy 2 dòng vào .env')
info('  3) npm run setup:push   (deploy lại function + đặt Secret)')
info('  4) npm run build && npm run deploy')
info('  5) MỞ app trên iPhone -> bấm "🗑️ Đặt lại push" rồi "🔄 Đăng ký push"')
process.exit(1)
