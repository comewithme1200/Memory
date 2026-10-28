/**
 * Đăng ký 1 tài khoản test trên Supabase để kiểm tra trang quản trị
 * (tạo khách quen, sinh QR) mà không cần bạn đăng nhập thủ công.
 *
 *   node scripts/test-signup.mjs
 *
 * Nếu dự án bật "Confirm email" thì signUp sẽ không trả session ->
 * script báo rõ để bạn tự tạo user trong Dashboard.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || ''

const email = `qas-test-${Date.now()}@gmail.com`
const password = 'QaTest12345!'

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error } = await s.auth.signUp({ email, password })

if (error) {
  console.log('Đăng ký thất bại:', error.message)
  console.log('')
  console.log('Cách khác: Supabase Dashboard -> Authentication -> Users -> Add user')
  console.log('  Email: ' + email)
  console.log('  Password: ' + password)
  console.log('  BẮT BUỘC tick "Auto Confirm User"')
  process.exit(1)
}

if (!data.session) {
  console.log('Đăng ký OK nhưng CHƯA có session (dự án bắt buộc xác nhận email).')
  console.log('')
  console.log('Vào Dashboard -> Authentication -> Users, tìm email:')
  console.log('  ' + email)
  console.log('Bấm "Confirm User" hoặc bật Auto Confirm trong Settings.')
  process.exit(2)
}

console.log('Đăng ký + đăng nhập thành công!')
console.log('  Email:    ' + email)
console.log('  Password: ' + password)
console.log('')
console.log('TOKEN=' + data.session.access_token)
console.log('REFRESH=' + data.session.refresh_token)
