#!/usr/bin/env node
/**
 * BUILD SẠCH — dọn biến môi trường "demo" sót lại trong shell trước khi build.
 *
 * Vấn đề: Vite đọc `process.env` TRƯỚC file `.env`. Nếu shell còn sót
 * biến demo (VITE_SUPABASE_URL='local'...) thì bundle ra sẽ KHÔNG có
 * Supabase -> trang quản trị rơi về chế độ demo (đăng nhập PIN).
 *
 * Script này xoá các biến VITE_* khỏi process.env của chính nó rồi spawn
 * `vite build` — con tiến trình mới KHÔNG kế thừa biến đã xoá, nên build
 * sẽ đọc đúng giá trị trong file `.env`.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Các biến app đọc từ env — xoá hết để file `.env` là nguồn duy nhất.
const KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_ADMIN_PIN',
  'VITE_SHOP_NAME',
  'VITE_SHOP_ADDRESS',
  'VITE_SHOP_PHONE',
  'VITE_BANK_QR_URL',
]

const env = { ...process.env }
const removed = []
for (const k of KEYS) {
  if (k in env) {
    removed.push(k)
    delete env[k]
  }
}

if (removed.length) {
  console.log(`🧹 [build-clean] Đã xoá biến shell: ${removed.join(', ')}`)
}

// Cảnh báo nếu file .env không tồn tại -> build sẽ ra chế độ demo.
const envFile = path.join(root, '.env')
if (!fs.existsSync(envFile)) {
  console.warn(
    '⚠️  [build-clean] Không thấy file .env -> bản build sẽ chạy ở CHẾ ĐỘ DEMO ' +
      '(đăng nhập bằng PIN, dữ liệu chỉ lưu trên trình duyệt).',
  )
}

const isWin = process.platform === 'win32'
const cmd = isWin ? 'npx.cmd' : 'npx'
const args = ['vite', 'build']

const child = spawn(cmd, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: isWin,
})

child.on('exit', (code) => process.exit(code ?? 0))
