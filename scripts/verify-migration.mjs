/**
 * Xác minh dữ liệu đơn cũ đã được migrate từ JSONB sang bảng `order_items`.
 *   node scripts/verify-migration.mjs
 *
 * Cần tài khoản chủ quán (VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD) vì RLS
 * chặn khách đọc đơn.
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
const adminEmail = (process.env.VITE_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.VITE_ADMIN_PASSWORD || '').trim()

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

if (!adminEmail || !adminPassword) {
  console.log('Thiếu VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env -> không kiểm tra được.')
  console.log('(Thêm 2 dòng này để chạy đầy đủ phần quản trị.)')
  process.exit(0)
}

const { error: signErr } = await supabase.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
})
if (signErr) {
  console.log(`Đăng nhập lỗi: ${signErr.message}`)
  process.exit(1)
}
console.log(`Đã đăng nhập: ${adminEmail}\n`)

// Lấy tất cả đơn + dòng món
const { data: orders, error: oErr } = await supabase
  .from('orders')
  .select('id,code,total,status,items,created_at')
  .order('created_at', { ascending: false })
if (oErr) {
  console.log(`Lỗi đọc đơn: ${oErr.message}`)
  process.exit(1)
}

const { data: items, error: iErr } = await supabase
  .from('order_items')
  .select('order_id,menu_item_id,name_snapshot,price_snapshot,qty,note')
if (iErr) {
  console.log(`Lỗi đọc order_items: ${iErr.message}`)
  process.exit(1)
}

const byOrder = new Map()
for (const it of items || []) {
  const list = byOrder.get(it.order_id) || []
  list.push(it)
  byOrder.set(it.order_id, list)
}

console.log(`Tổng đơn: ${orders.length} | Tổng dòng món: ${items.length}\n`)

let missing = 0
let mismatch = 0
let ok = 0

for (const o of orders) {
  const rows = byOrder.get(o.id) || []
  const legacy = o.items || []
  const legacyQty = legacy.reduce((s, it) => s + (Number(it.qty) || 0), 0)
  const newQty = rows.reduce((s, it) => s + (Number(it.qty) || 0), 0)

  if (rows.length === 0 && legacy.length === 0) continue

  if (rows.length === 0) {
    console.log(`✗ ${o.code}: có ${legacy.length} món trong JSONB nhưng CHƯA có trong order_items`)
    missing++
    continue
  }
  if (legacyQty !== newQty) {
    console.log(`✗ ${o.code}: JSONB qty=${legacyQty} vs order_items qty=${newQty}`)
    mismatch++
    continue
  }
  // So tổng tiền
  const newTotal = rows.reduce((s, it) => s + it.price_snapshot * it.qty, 0)
  if (legacy.length && newTotal !== o.total) {
    console.log(`✗ ${o.code}: tổng ${o.total} nhưng tính từ order_items ra ${newTotal}`)
    mismatch++
    continue
  }
  ok++
}

console.log(`\nKết quả:`)
console.log(`  Khớp hoàn toàn: ${ok}`)
console.log(`  Thiếu dòng món: ${missing}`)
console.log(`  Lệch số lượng/tổng tiền: ${mismatch}`)

if (missing || mismatch) {
  console.log('\n-> Chạy lại supabase/migration-order-items.sql để migrate phần còn thiếu.')
} else {
  console.log('\n✓ Dữ liệu đơn cũ đã được migrate đầy đủ sang order_items.')
}

// Xuất vài mẫu để đối chiếu
console.log('\n=== Mẫu 3 đơn gần nhất ===')
for (const o of orders.slice(0, 3)) {
  const rows = byOrder.get(o.id) || []
  console.log(`\n#${o.code} — total=${o.total} — status=${o.status}`)
  console.log(`  JSONB   : ${JSON.stringify(o.items)}`)
  console.log(`  order_items:`)
  for (const r of rows) {
    console.log(`    - ${r.name_snapshot} x${r.qty} @${r.price_snapshot}${r.note ? ` (note: ${r.note})` : ''}`)
  }
}
