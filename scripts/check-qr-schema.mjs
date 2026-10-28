/**
 * Kiểm tra nhanh trạng thái DB: những thứ tính năng QR/khách quen CẦN.
 *
 *   node scripts/check-qr-schema.mjs
 *
 * Báo cáo từng món: ĐÃ CÓ / THIẾU.
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
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const D = '\x1b[2m'
const X = '\x1b[0m'

const ok = (m) => console.log(`${G}  ĐÃ CÓ  ${X} ${m}`)
const bad = (m) => console.log(`${R}  THIẾU  ${X} ${m}`)
const info = (m) => console.log(`${D}          ${m}${X}`)

// 1. Bảng customers
{
  const { data, error } = await s.from('customers').select('*').limit(1)
  if (!error) ok('Bảng `customers`')
  else {
    bad('Bảng `customers`')
    info(`-> ${error.message}`)
  }
}

// 2. Cột orders.customer_address
{
  const { error } = await s.from('orders').select('customer_address').limit(1)
  if (!error) ok('Cột `orders.customer_address`')
  else {
    bad('Cột `orders.customer_address`')
    info(`-> ${error.message}`)
  }
}

// 3. Cột orders.customer_id
{
  const { error } = await s.from('orders').select('customer_id').limit(1)
  if (!error) ok('Cột `orders.customer_id`')
  else {
    bad('Cột `orders.customer_id`')
    info(`-> ${error.message}`)
  }
}

// 4. RPC customer_by_token
{
  const { data, error } = await s.rpc('customer_by_token', { p_token: '__probe__' })
  if (!error) ok('RPC `customer_by_token`')
  else {
    bad('RPC `customer_by_token`')
    info(`-> ${error.message}`)
  }
}

// 5. RPC create_order co p_customer_address + p_customer_token?
{
  const { error } = await s.rpc('create_order', {
    p_code: '__probe__',
    p_customer_name: 'probe',
    p_customer_phone: '0',
    p_customer_address: 'probe',
    p_table_no: '0',
    p_note: 'probe',
    p_items: [{ id: 'x', name: 'probe', price: 1, qty: 1 }],
    p_customer_token: '',
  })
  if (!error) ok('RPC `create_order` đã có tham số địa chỉ + token')
  else {
    bad('RPC `create_order` chưa có tham số địa chỉ + token')
    info(`-> ${error.message}`)
  }
}

// 6. Quyen summarize_orders cho anon (phai bi chan)
{
  const { data, error } = await s.rpc('summarize_orders', { p_from: null, p_to: null })
  if (error) {
    ok('RPC `summarize_orders` đã bị chặn cho khách (anon)')
    info(`-> ${error.message}`)
  } else if (!data) {
    ok('RPC `summarize_orders` đã bị chặn cho khách (anon)')
  } else {
    bad('RPC `summarize_orders` KHÔNG bị chặn — khách đọc được doanh thu!')
    info('Chạy supabase/fix-summarize-permissions.sql')
  }
}

// 7. Khach co doc duoc bang customers khong? (phai bi chan)
{
  const { data, error } = await s.from('customers').select('*')
  if (error) {
    ok('RLS chặn đúng: khách không đọc được danh sách khách quen')
  } else if ((data?.length ?? 0) === 0) {
    ok('RLS chặn đúng: khách không đọc được danh sách khách quen (0 dòng)')
  } else {
    bad(`NGUY HIỂM: khách đọc được ${data.length} khách quen!`)
    info('Chạy supabase/migration-customers-qr.sql')
  }
}

console.log('')
console.log(`${C}Nếu có dòng "THIẾU" -> chạy:${X} supabase/migration-customers-qr.sql`)
console.log(`${D}(chạy được nhiều lần, không mất dữ liệu)${X}`)
