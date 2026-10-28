/**
 * Kiểm tra giá `price_snapshot` trong bảng `order_items` đã CỘNG price_delta
 * của các tuỳ chọn hay chưa.
 *
 *   node scripts/test-item-price.mjs
 *
 * Vì sao cần check:
 *   Bảng "🔥 Món cần làm" gom món theo (món + tuỳ chọn). Để hiển thị đúng
 *   giá của 1 phần, ta cần biết `price_snapshot` là:
 *     (A) giá gốc của món            -> UI tự cộng delta
 *     (B) giá gốc + tổng delta       -> UI dùng luôn, KHÔNG cộng thêm
 *
 *   Nếu chọn sai (A/B) thì giá hiển thị sai (cộng 2 lần hoặc thiếu).
 *
 * Script tạo 1 đơn thật có 1 món + 1 tuỳ chọn có delta khác 0, đọc lại
 * `price_snapshot` rồi so sánh với giá gốc của món. Dọn dữ liệu ở cuối.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || ''

const G = '\x1b[32m'
const R = '\x1b[31m'
const C = '\x1b[36m'
const X = '\x1b[0m'
const ok = (m) => console.log(`${G}  OK  ${X} ${m}`)
const fail = (m) => console.log(`${R} FAIL ${X} ${m}`)
const head = (m) => console.log(`\n${C}${m}${X}`)

if (!url || !key) {
  console.error('Thiếu cấu hình Supabase trong .env')
  process.exit(1)
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

head('1. Tìm 1 món có gắn tuỳ chọn')

const { data: items, error: eItems } = await s
  .from('menu_items')
  .select('id, name, price')
  .limit(50)
if (eItems) {
  fail(`Không đọc được menu_items: ${eItems.message}`)
  process.exit(1)
}
if (!items?.length) {
  fail('Bảng menu_items trống -> không có món để test.')
  process.exit(1)
}

// Tìm 1 món có nhóm tuỳ chọn (join bảng trung gian).
const { data: groups, error: eGroups } = await s
  .from('menu_item_option_groups')
  .select('menu_item_id, option_id, is_required')
if (eGroups) {
  fail(`Không đọc được menu_item_option_groups: ${eGroups.message}`)
  process.exit(1)
}
if (!groups?.length) {
  console.log('\nChưa có món nào gắn tuỳ chọn -> bỏ qua test giá.')
  console.log('Hãy gán tuỳ chọn cho ít nhất 1 món rồi chạy lại script này.')
  process.exit(0)
}

const withOpts = new Set(groups.map((g) => g.menu_item_id))
const item = items.find((i) => withOpts.has(i.id))
if (!item) {
  console.log('\nKhông tìm được món đã gắn tuỳ chọn -> bỏ qua test.')
  process.exit(0)
}

// Lấy 1 lựa chọn cụ thể của nhóm đầu tiên thuộc món này.
const grp = groups.find((g) => g.menu_item_id === item.id)
const { data: choices } = await s
  .from('menu_item_options')
  .select('id, name, price_delta')
  .eq('option_id', grp.option_id)
  .limit(5)
const choice = choices?.[0]
if (!choice) {
  console.log('\nNhóm tuỳ chọn này chưa có lựa chọn cụ thể -> bỏ qua test.')
  process.exit(0)
}

console.log(`Món: ${item.name} — giá gốc ${item.price}đ`)
console.log(`Chọn: ${choice.name} — delta ${choice.price_delta}đ`)

head('2. Tạo đơn test (1 món, 1 tuỳ chọn)')

const orderId = randomUUID()
const code = 'T' + Date.now().toString().slice(-6)
const { data: created, error: eCreate } = await s.rpc('create_order', {
  p_code: code,
  p_customer_name: 'TEST GIÁ',
  p_customer_phone: '0900000000',
  p_customer_address: 'TEST',
  p_table_no: '',
  p_note: '',
  p_items: [{ id: item.id, name: item.name, price: item.price, qty: 2, note: '' }],
  p_customer_token: null,
  p_item_options: [{ line: 1, options: [{ menuItemOptionId: choice.id, name: choice.name }] }],
})
if (eCreate) {
  fail(`create_order lỗi: ${eCreate.message}`)
  process.exit(1)
}
const newId = created?.id || orderId
console.log(`Đơn: ${code} (${newId})`)

head('3. Đọc price_snapshot')

// Đợi 1 nhịp cho chắc (PostgREST cache schema lần đầu).
await new Promise((r) => setTimeout(r, 800))

const { data: oi, error: eOi } = await s
  .from('order_items')
  .select('name_snapshot, price_snapshot, qty')
  .eq('order_id', newId)
if (eOi) {
  fail(`Không đọc được order_items: ${eOi.message}`)
} else {
  const row = oi?.[0]
  if (!row) {
    fail('Không tìm thấy dòng món trong order_items.')
    console.log(`  (đơn test: ${newId})`)
  } else {
    const expectedFinal = item.price + Number(choice.price_delta || 0)
    const snap = Number(row.price_snapshot)
    console.log(`  price_snapshot = ${snap}đ  (giá gốc ${item.price}đ, delta ${choice.price_delta}đ)`)
    if (snap === expectedFinal) {
      ok('Giá ĐÃ bao gồm price_delta (kiểu B) — UI dùng luôn, KHÔNG cộng thêm.')
    } else if (snap === item.price) {
      ok('Giá là giá GỐC, chưa cộng delta (kiểu A) — UI phải tự cộng delta.')
    } else {
      fail(`Giá không khớp: ${snap}đ (mong đợi ${item.price}đ hoặc ${expectedFinal}đ).`)
    }
  }
}

head('4. Dọn dữ liệu test')
await s.from('order_items').delete().eq('order_id', newId)
await s.from('order_item_options').delete().eq('order_item_id', newId)
await s.from('orders').delete().eq('id', newId)
console.log('Đã xoá đơn test.')
