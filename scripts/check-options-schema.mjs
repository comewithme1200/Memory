/**
 * Kiểm tra nhanh trạng thái DB cho tính năng TUỲ CHỌN MÓN (kiểu GrabFood).
 *
 *   node scripts/check-options-schema.mjs
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

// 1. Bảng options
{
  const { error } = await s.from('options').select('*').limit(1)
  if (!error) ok('Bảng `options`')
  else {
    bad('Bảng `options`')
    info(`-> ${error.message}`)
  }
}

// 2. Bảng menu_item_options
{
  const { error } = await s.from('menu_item_options').select('*').limit(1)
  if (!error) ok('Bảng `menu_item_options`')
  else {
    bad('Bảng `menu_item_options`')
    info(`-> ${error.message}`)
  }
}

// 3. Bảng menu_item_option_groups
{
  const { error } = await s.from('menu_item_option_groups').select('*').limit(1)
  if (!error) ok('Bảng `menu_item_option_groups`')
  else {
    bad('Bảng `menu_item_option_groups`')
    info(`-> ${error.message}`)
  }
}

// 4. Bảng order_item_options
{
  const { error } = await s.from('order_item_options').select('*').limit(1)
  if (!error) ok('Bảng `order_item_options`')
  else {
    bad('Bảng `order_item_options`')
    info(`-> ${error.message}`)
  }
}

// 5. Cột order_items.line_index
{
  const { error } = await s.from('order_items').select('line_index').limit(1)
  if (!error) ok('Cột `order_items.line_index`')
  else {
    bad('Cột `order_items.line_index`')
    info(`-> ${error.message}`)
  }
}

// 6. RPC create_order co p_item_options?
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
    p_item_options: [],
  })
  if (!error) ok('RPC `create_order` đã có tham số `p_item_options`')
  else {
    bad('RPC `create_order` chưa có tham số `p_item_options`')
    info(`-> ${error.message}`)
  }
}

// 7. Dữ liệu mẫu: co nhóm tuỳ chọn chua?
{
  const { data, error } = await s.from('options').select('*')
  if (error) {
    bad('Đọc được danh sách nhóm tuỳ chọn')
    info(`-> ${error.message}`)
  } else if ((data?.length ?? 0) === 0) {
    console.log(`${Y}  CHƯA CÓ  ${X} Dữ liệu mẫu (nhóm "Size"/"Topping")`)
    info('Chạy: node scripts/seed-options.mjs')
  } else {
    ok(`Dữ liệu mẫu: ${data.length} nhóm tuỳ chọn (${data.map((o) => o.name).join(', ')})`)
  }
}

// 8. Co menu_item_options gan cho mon chua?
{
  const { data, error } = await s.from('menu_item_options').select('*')
  if (error) {
    info(`Đọc menu_item_options bị chặn: ${error.message}`)
  } else if ((data?.length ?? 0) === 0) {
    console.log(`${Y}  CHƯA CÓ  ${X} Lựa chọn nào gắn cho món`)
    info('Chạy: node scripts/seed-options.mjs')
  } else {
    ok(`Lựa chọn gắn cho món: ${data.length} dòng`)
  }
}

console.log('')
console.log(`${C}Nếu có dòng "THIẾU" -> chạy:${X} supabase/migration-options.sql`)
console.log(`${D}(chạy được nhiều lần, không mất dữ liệu)${X}`)
