/**
 * KIỂM TRA & SỬA cặp khoá VAPID trong `.env`.
 *
 * ---------------------------------------------------------------------------
 * LỊCH SỬ (đừng làm lại)
 *
 * Script này trước đây "sửa" khoá private bằng cách cắt 32 byte cuối của
 * PKCS#8. Điều đó SAI:
 *
 *   - PKCS#8 của P-256 dài **138 byte** (không phải 48).
 *   - 32 byte CUỐI là **toạ độ Y của public key** nhúng trong private key,
 *     KHÔNG phải private scalar.
 *   -> Cặp khoá sinh ra không khớp -> server ký JWT sai ->
 *      Apple trả `403 BadJwtToken` -> không có thông báo nào tới máy.
 *
 * Cách đúng: export JWK -> `jwk.d` là private scalar 32 byte.
 *
 * ---------------------------------------------------------------------------
 * VIỆC LÀM GIỜ
 *
 *   1. Kiểm tra cặp khoá có khớp không (dẫn xuất public từ private rồi so).
 *   2. Nếu KHÔNG khớp -> private scalar đã mất -> không sửa được, phải sinh
 *      cặp mới bằng `npm run gen:vapid`.
 *
 * Dùng:
 *   node scripts/fix-vapid-private.mjs
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-vapid-keys.mjs')], {
  stdio: 'inherit',
})

process.exit(res.status ?? 1)
