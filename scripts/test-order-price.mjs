/**
 * Kiểm chứng giá đơn có đúng không (sau khi sửa lỗi lệch index dòng).
 *
 *   node scripts/test-order-price.mjs
 *
 * Tạo 1 đơn test: 2x "Size to" (+5k) + 1x "Size nhỏ" (-5k) của Xôi 30.000
 * -> tổng đúng = 2*35000 + 1*25000 = 95.000
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

// Lấy món đầu tiên + 2 lựa chọn của nhóm "Size"
const { data: items } = await s.from('menu_items').select('*').order('sort_order').limit(1)
const item = items?.[0]
if (!item) {
  console.log('Không có món nào.')
  process.exit(1)
}

const { data: choices } = await s
  .from('menu_item_options')
  .select('*')
  .eq('menu_item_id', item.id)
  .order('sort_order')

const to = choices?.find((c) => c.price_delta > 0) || choices?.[0]
const nho = choices?.find((c) => c.price_delta < 0) || choices?.[1]
if (!to) {
  console.log('Món này chưa có lựa chọn nào. Hãy chạy seed trước.')
  process.exit(1)
}

const grp = to.option_id
const pick = (c) => ({
  option_id: grp,
  menu_item_option_id: c.id,
  name: c.name,
  price_delta: c.price_delta,
})

const itemsArg = [
  { id: item.id, name: item.name, price: item.price, qty: 2, note: 'không da gà' },
  { id: item.id, name: item.name, price: item.price, qty: 1, note: '' },
]
const itemOptionsArg = [
  { line: 1, options: [pick(to)] },
  ...(nho ? [{ line: 2, options: [pick(nho)] }] : []),
]

const expected =
  2 * (item.price + to.price_delta) +
  (nho ? 1 * (item.price + nho.price_delta) : 0)

const code = 'TEST' + Date.now().toString().slice(-5)
const { data, error } = await s.rpc('create_order', {
  p_code: code,
  p_customer_name: 'Test gia',
  p_customer_phone: '0900000000',
  p_customer_address: '123 Test',
  p_table_no: '',
  p_note: '',
  p_items: itemsArg,
  p_customer_token: '',
  p_item_options: itemOptionsArg,
})

if (error) {
  console.log('LỖI RPC:', error.message)
  process.exit(1)
}

console.log(`\nMón: ${item.name} (${item.price} đ)`)
console.log(`  Dòng 1: 2 x "${to.name}" (${to.price_delta >= 0 ? '+' : ''}${to.price_delta})`)
if (nho) console.log(`  Dòng 2: 1 x "${nho.name}" (${nho.price_delta >= 0 ? '+' : ''}${nho.price_delta})`)
console.log(`\nTổng MONG ĐỢI: ${expected.toLocaleString('vi-VN')} đ`)
console.log(`Tổng THỰC TẾ: ${Number(data.total).toLocaleString('vi-VN')} đ`)

console.log('\nDòng món server trả về:')
for (const it of data.items || []) {
  const opts = (it.options || []).map((o) => o.name).join(', ') || '(không có)'
  console.log(`  qty=${it.qty} price=${it.price} note="${it.note || ''}" options=[${opts}]`)
}

const ok = Number(data.total) === expected
console.log(ok ? '\n✅ GIÁ ĐÚNG' : '\n❌ GIÁ SAI')
process.exit(ok ? 0 : 1)
