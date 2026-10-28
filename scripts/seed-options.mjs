/**
 * Nạp dữ liệu mẫu cho tuỳ chọn món (chạy SAU khi đã chạy
 * supabase/migration-options.sql).
 *
 *   node scripts/seed-options.mjs
 *
 * Tạo:
 *   - Nhóm "Size"    (chọn 1): Size to +5k / Size vừa 0 / Size nhỏ -5k
 *   - Nhóm "Topping" (chọn nhiều): Thêm trứng +3k / Thêm gà +8k
 *   - Gắn vào các món phở/bún, kèm 1 lựa chọn riêng cho từng món.
 *
 * Script idempotent: chạy lại không tạo trùng.
 *
 * GHI CHÚ VỀ QUYỀN: bảng `options` chỉ cho `authenticated` ghi (RLS).
 * Nên script này CẦN đăng nhập. Đặt 2 biến môi trường trước khi chạy:
 *
 *   $env:SEED_EMAIL="chuquan@gmail.com"
 *   $env:SEED_PASSWORD="matkhau"
 *   node scripts/seed-options.mjs
 *
 * Nếu không có biến này, script sẽ báo hướng dẫn và dừng.
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
if (!url || !key) {
  console.log('Thiếu cấu hình trong .env')
  process.exit(1)
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** Đăng nhập để có quyền ghi (RLS chỉ cho `authenticated`). */
async function login() {
  const email = process.env.SEED_EMAIL
  const password = process.env.SEED_PASSWORD
  if (!email || !password) {
    console.log('')
    console.log('Cần đăng nhập để ghi dữ liệu (bảng `options` chỉ cho `authenticated` ghi).')
    console.log('Chạy lệnh sau trong PowerShell:')
    console.log('')
    console.log('  $env:SEED_EMAIL="email-cua-ban@gmail.com"')
    console.log('  $env:SEED_PASSWORD="mat-khau-cua-ban"')
    console.log('  node scripts/seed-options.mjs')
    console.log('')
    console.log('Hoặc bỏ qua bước này: vào trang quản trị > Tuỳ chọn > thêm nhóm/lựa chọn bằng giao diện.')
    process.exit(1)
  }
  const { error } = await s.auth.signInWithPassword({ email, password })
  if (error) {
    console.log(`  ! Đăng nhập thất bại: ${error.message}`)
    process.exit(1)
  }
  console.log(`  ✓ Đã đăng nhập: ${email}`)
}

/** Tìm hoặc tạo nhóm tuỳ chọn. */
async function ensureGroup(name, description, isMulti) {
  const { data: found } = await s.from('options').select('*').eq('name', name).maybeSingle()
  if (found) {
    console.log(`  · Nhóm "${name}" đã có -> dùng lại`)
    return found
  }
  const { data, error } = await s
    .from('options')
    .insert({ name, description, is_multi: isMulti })
    .select()
    .single()
  if (error) {
    console.log(`  ! Không tạo được nhóm "${name}": ${error.message}`)
    return null
  }
  console.log(`  ✓ Đã tạo nhóm "${name}"`)
  return data
}

/** Tìm hoặc tạo lựa chọn cho 1 món. */
async function ensureChoice(menuItemId, groupId, name, priceDelta) {
  const { data: found } = await s
    .from('menu_item_options')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .eq('option_id', groupId)
    .eq('name', name)
    .maybeSingle()
  if (found) return found
  const { data, error } = await s
    .from('menu_item_options')
    .insert({
      menu_item_id: menuItemId,
      option_id: groupId,
      name,
      price_delta: priceDelta,
      is_available: true,
    })
    .select()
    .single()
  if (error) {
    console.log(`  ! Không tạo được lựa chọn "${name}": ${error.message}`)
    return null
  }
  return data
}

/** Gắn nhóm vào món (idempotent). */
async function ensureLink(menuItemId, groupId, isRequired) {
  const { data: found } = await s
    .from('menu_item_option_groups')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .eq('option_id', groupId)
    .maybeSingle()
  if (found) return found
  const { data, error } = await s
    .from('menu_item_option_groups')
    .insert({ menu_item_id: menuItemId, option_id: groupId, is_required: isRequired })
    .select()
    .single()
  if (error) {
    console.log(`  ! Không gắn được nhóm: ${error.message}`)
    return null
  }
  return data
}

console.log('\n0) Đăng nhập')
await login()

console.log('\n1) Tạo nhóm tuỳ chọn')
const sizeGroup = await ensureGroup('Size', 'Chọn cỡ phần ăn', false)
const toppingGroup = await ensureGroup('Topping', 'Thêm món ăn kèm', true)

if (!sizeGroup || !toppingGroup) {
  console.log('\nDừng: chưa tạo được nhóm tuỳ chọn.')
  process.exit(1)
}

console.log('\n2) Lấy danh sách món')
const { data: items, error: itemErr } = await s.from('menu_items').select('*').order('sort_order')
if (itemErr) {
  console.log(`  ! Không đọc được menu_items: ${itemErr.message}`)
  console.log('    -> Chạy supabase/schema.sql trước đã.')
  process.exit(1)
}
console.log(`  ✓ ${items.length} món`)

console.log('\n3) Tạo lựa chọn + gắn vào món')
for (const m of items) {
  // Món chính -> có Size (bắt buộc) + Topping
  // Món khác -> chỉ có Size (không bắt buộc)
  const isMain = /phở|bún|com|cơm|mì|cháo/i.test(m.name)
  const hasSize = isMain || /cà phê|nước mía|bia|trà|sữa/i.test(m.name)

  if (hasSize) {
    await ensureChoice(m.id, sizeGroup.id, 'Size to', 5000)
    await ensureChoice(m.id, sizeGroup.id, 'Size vừa', 0)
    await ensureChoice(m.id, sizeGroup.id, 'Size nhỏ', -5000)
    await ensureLink(m.id, sizeGroup.id, isMain)
  }

  if (isMain) {
    await ensureChoice(m.id, toppingGroup.id, 'Thêm trứng', 3000)
    await ensureChoice(m.id, toppingGroup.id, 'Thêm gà', 8000)
    await ensureLink(m.id, toppingGroup.id, false)
  }
  console.log(`  ✓ ${m.name}`)
}

console.log('\nXong! Mở trang quản trị > Tuỳ chọn để kiểm tra.')
console.log('Hoặc mở trang đặt món để thử chọn Size to / Size nhỏ.')
