/**
 * Kiểm tra Realtime của bảng `orders` đã bật chưa.
 *
 *   node scripts/check-realtime.mjs
 *
 * Cách kiểm tra:
 *   1. Mở kênh WebSocket lắng nghe thay đổi bảng `orders`.
 *   2. Tạo 1 đơn thật (RPC create_order).
 *   3. Xem sự kiện INSERT có về không trong vài giây.
 *
 * Kết quả:
 *   - "BẬT"    -> realtime hoạt động, trang quản trị tự thêm đơn mới.
 *   - "CHƯA BẬT" -> chạy supabase/migration-realtime.sql trong SQL Editor.
 *
 * Script tự xoá đơn test ở cuối.
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
const adminPassword = process.env.VITE_ADMIN_PASSWORD || ''

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const D = '\x1b[2m'
const X = '\x1b[0m'
const ok = (m) => console.log(`${G}  OK  ${X} ${m}`)
const bad = (m) => console.log(`${R}  FAIL ${X} ${m}`)
const warn = (m) => console.log(`${Y} WARN ${X} ${m}`)
const info = (m) => console.log(`${D}       ${m}${X}`)
const head = (m) => console.log(`\n${C}${m}${X}`)

if (!url || !key) {
  console.error('Thiếu cấu hình Supabase trong .env')
  process.exit(1)
}

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

head('1. Đăng nhập chủ quán (cần để nhận Realtime — RLS chặn anon)')

// Realtime tuân thủ RLS: chỉ `authenticated` mới nhận được sự kiện của
// bảng `orders`. Nên phải đăng nhập thật, không dùng anon.
let client = anon
if (adminEmail && adminPassword) {
  const { data, error } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })
  if (error) {
    bad(`Đăng nhập thất bại: ${error.message}`)
    process.exit(1)
  }
  ok(`Đã đăng nhập: ${adminEmail}`)
  client = anon // supabase-js tự dùng session vừa lấy
} else {
  warn('Chưa có VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env')
  info('Không đăng nhập được -> sẽ test với anon (có thể không nhận được sự kiện)')
}

head('2. Mở kênh lắng nghe bảng `orders`')

let gotEvent = null
const channel = client
  .channel('check-realtime-' + Date.now())
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'orders' },
    (payload) => {
      gotEvent = payload
    },
  )

const subStatus = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 8000)
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timer)
      resolve('subscribed')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer)
      resolve(status)
    }
  })
})

if (subStatus === 'subscribed') ok('Đã subscribe kênh WebSocket thành công.')
else if (subStatus === 'timeout') bad('Không subscribe được kênh WebSocket (timeout 8s).')
else bad(`Subscribe lỗi: ${subStatus}`)

head('3. Tạo đơn test và chờ sự kiện INSERT')

const { data: items } = await client.from('menu_items').select('id, name, price').limit(1)
if (!items?.length) {
  bad('Bảng menu_items trống -> không tạo được đơn test.')
  process.exit(1)
}
const it = items[0]
const code = 'RT' + Date.now().toString().slice(-6)

const { data: created, error: eCreate } = await client.rpc('create_order', {
  p_code: code,
  p_customer_name: 'TEST REALTIME',
  p_customer_phone: '0900000000',
  p_customer_address: 'TEST',
  p_table_no: '',
  p_note: '',
  p_items: [{ id: it.id, name: it.name, price: it.price, qty: 1, note: '' }],
  p_customer_token: '',
  p_item_options: [],
})
if (eCreate) {
  bad(`create_order lỗi: ${eCreate.message}`)
  process.exit(1)
}
info(`Đơn test: ${code} (${created?.id})`)

head('4. Chờ sự kiện (tối đa 10s)')

const deadline = Date.now() + 10000
while (!gotEvent && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 300))
}

if (gotEvent) {
  ok('NHẬN ĐƯỢC sự kiện Realtime!')
  info(`event = ${gotEvent.eventType}, table = ${gotEvent.table}`)
  if (gotEvent.eventType === 'INSERT') {
    const payload = gotEvent.new || {}
    info(`payload có đủ cột không: code=${payload.code ?? '(thiếu)'} total=${payload.total ?? '(thiếu)'}`)
    if (payload.code) {
      ok('Payload đầy đủ (replica identity full đã bật) -> không cần gọi thêm API.')
    } else {
      warn('Payload chỉ có khoá -> client sẽ phải nạp lại danh sách (vẫn hoạt động).')
    }
  }
} else {
  bad('KHÔNG nhận được sự kiện Realtime.')
  console.log('')
  console.log(`${C}Cách khắc phục:${X}`)
  console.log('  1. Supabase Dashboard -> SQL Editor -> New query')
  console.log('  2. Dán nội dung file supabase/migration-realtime.sql -> Run')
  console.log('  3. Chạy lại script này')
  console.log('')
  console.log(`${D}Ghi chú: nếu vẫn không được, kiểm tra Dashboard -> Database -> Replication,${X}`)
  console.log(`${D}bảng "orders" phải nằm trong publication "supabase_realtime".${X}`)
}

head('5. Dọn dữ liệu test')
if (created?.id) {
  await client.from('orders').delete().eq('id', created.id)
  info('Đã xoá đơn test.')
}

await client.removeChannel(channel)
process.exit(gotEvent ? 0 : 1)
