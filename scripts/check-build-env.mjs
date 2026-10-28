#!/usr/bin/env node
/**
 * KIỂM TRA ENV TRƯỚC KHI ĐĂNG TRANG LÊN GITHUB PAGES.
 *
 * BUG ĐÃ GẶP: build bị chạy trong shell còn sót biến môi trường demo
 * (VITE_SUPABASE_URL='local'). Vite ưu tiên process.env hơn file `.env`
 * -> bundle deploy ra KHÔNG có URL Supabase -> trang quản trị rơi về
 * "chế độ demo" (đăng nhập bằng PIN) và dữ liệu đơn không lưu được.
 *
 * Script này đọc bundle vừa build trong `dist/` và dừng deploy nếu:
 *   - thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong bundle, hoặc
 *   - còn sót giá trị demo ('local') thay vì URL Supabase thật.
 *
 * Chạy: node scripts/check-build-env.mjs
 * Dùng chung với `npm run deploy`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const assets = path.join(dist, 'assets')

const fail = (msg) => {
  console.error(`\n❌ [check-build-env] ${msg}\n`)
  process.exit(1)
}

if (!fs.existsSync(assets)) {
  fail(`Không thấy thư mục ${assets}. Hãy chạy "npm run build" trước.`)
}

// Gộp tất cả file JS trong dist/assets thành 1 chuỗi để tìm chuỗi.
const files = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
if (files.length === 0) fail('Không có file .js nào trong dist/assets.')

const bundle = files.map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')

// 1. Phải có URL Supabase thật (dạng https://xxx.supabase.co).
const hasSupabaseUrl = /https:\/\/[a-z0-9-]+\.supabase\.co/.test(bundle)
if (!hasSupabaseUrl) {
  fail(
    'Bundle KHÔNG chứa URL Supabase (https://xxx.supabase.co).\n' +
      '   -> Trang quản trị sẽ chạy ở "chế độ demo" (đăng nhập PIN) và KHÔNG lưu được đơn.\n' +
      '   Nguyên nhân thường gặp: có biến môi trường demo trong shell ghi đè file .env.\n' +
      '   Cách sửa: xoá các biến VITE_* trong shell rồi build lại, hoặc dùng\n' +
      '   npm run build:clean (script này tự dọn biến môi trường trước khi build).',
  )
}

// 2. Không được còn giá trị demo.
if (/VITE_SUPABASE_URL["'`\s:=]+local\b/.test(bundle)) {
  fail('Bundle vẫn còn giá trị demo "local" cho VITE_SUPABASE_URL.')
}

// 3. Phải có anon key (dạng "eyJ..." là JWT của Supabase).
if (!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(bundle)) {
  fail('Bundle không có anon key hợp lệ (JWT "eyJ...") của Supabase.')
}

console.log('✅ [check-build-env] Bundle hợp lệ: đã nối Supabase (không phải chế độ demo).')
