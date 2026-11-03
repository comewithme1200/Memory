/**
 * Kiểm tra hình dạng hàm `summarize_orders` trong DB + logic expire đơn.
 *
 *   node scripts/check-expire-orders.mjs
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ SCRIPT NÀY?
 *
 * Khi gặp lỗi "ERROR: 42883: function public.summarize_orders() does not exist"
 * khi chạy migration trên Supabase SQL Editor.
 *
 * NGUYÊN NHÂN: PostgreSQL KHÔNG tạo hàm overload 0-tham-số cho các tham số
 * có `default`. `create function summarize_orders(p_from timestamptz default null,
 * p_to timestamptz default null)` tạo ra ĐÚNG MỘT hàm với 2 tham số.
 *
 * Do đó câu lệnh:
 *     revoke all on function public.summarize_orders() from public;
 * báo lỗi 42883 — và vì Supabase chạy file trong 1 transaction, lỗi đó làm
 * HỎNG CẢ FILE (các câu lệnh phía sau không được chạy).
 *
 * CÁCH ĐÚNG: dùng `DO` block duyệt `pg_proc` (như `fix-summarize-permissions.sql`).
 * Script này giúp kiểm tra nhanh DB đang ở trạng thái nào.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
}

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const adminEmail = (process.env.VITE_ADMIN_EMAIL || '').trim()
const adminPassword = process.env.VITE_ADMIN_PASSWORD || ''

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const ok = (m) => console.log(`${GREEN}  OK  ${RESET} ${m}`)
const fail = (m) => console.log(`${RED} FAIL ${RESET} ${m}`)
const skip = (m) => console.log(`${YELLOW} SKIP ${RESET} ${m}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)
const head = (m) => console.log(`\n${CYAN}${m}${RESET}`)

if (!url || !key) {
  fail('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env')
  process.exit(1)
}

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// ---------------------------------------------------------------------
// 1) Hàm summarize_orders tồn tại & gọi được bằng 2 tham số?
// ---------------------------------------------------------------------
head('1) RPC summarize_orders(p_from, p_to)')

let admin = null
if (adminEmail && adminPassword) {
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  if (error) {
    fail(`Đăng nhập chủ quán thất bại: ${error.message}`)
    admin = null
  } else {
    ok(`Đăng nhập chủ quán thành công: ${adminEmail}`)
  }
} else {
  skip('Bỏ qua phần gọi hàm: thiếu VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env')
  info('Thêm 2 dòng này vào .env để kiểm tra đầy đủ (KHÔNG commit .env).')
}

if (admin) {
  const { data, error } = await admin.rpc('summarize_orders', { p_from: null, p_to: null })
  if (error) {
    fail(`Gọi RPC lỗi: ${error.message}`)
    info('Nếu lỗi là "does not exist" -> chưa chạy migration-order-items.sql.')
  } else {
    const d = data || {}
    ok(`Gọi được. rows: ${d.rows?.length ?? 0} | totalQty: ${d.totalQty ?? 0} | orderCount: ${d.orderCount ?? 0}`)
  }
}

// ---------------------------------------------------------------------
// 2) Overload 0-tham-số KHÔNG tồn tại -> đừng viết `revoke ... ()`
// ---------------------------------------------------------------------
head('2) Gọi summarize_orders() [0 tham số]')
const r0 = await anon.rpc('summarize_orders')
if (r0.error) {
  const msg = r0.error.message || ''
  if (/does not exist/i.test(msg)) {
    ok('Lỗi "does not exist" — đúng như kỳ vọng, hàm không có overload 0 tham số.')
    info('-> KHÔNG được viết `revoke ... summarize_orders()` trong migration.')
  } else {
    ok(`Lỗi: ${msg}`)
    info('-> "permission denied" = hàm CÓ tồn tại, chỉ là anon không được gọi (đúng RLS).')
    info('-> Đây cũng là lý do phải dùng `DO` block để revoke/grant quyền.')
  }
} else {
  skip('RPC 0 tham số trả về được — DB có overload 0 tham số (hiếm).')
}

// ---------------------------------------------------------------------
// 3) Đơn quá khứ chưa hoàn thành -> sẽ bị app expire khi mở trang "Đơn hàng"
// ---------------------------------------------------------------------
head('3) Đơn quá khứ chưa hoàn thành (ứng viên bị expire)')
const client = admin || anon
const startOfToday = new Date()
startOfToday.setHours(0, 0, 0, 0)

const { data: stale, error: staleErr } = await client
  .from('orders')
  .select('id, code, status, created_at')
  .in('status', ['new', 'preparing'])
  .lt('created_at', startOfToday.toISOString())

if (staleErr) {
  skip(`Không xem được đơn (cần đăng nhập chủ quán): ${staleErr.message}`)
} else {
  if (stale.length === 0) {
    ok('Không có đơn quá khứ nào bị bỏ lửng.')
  } else {
    console.log(`${YELLOW}  WARN ${RESET} ${stale.length} đơn quá khứ chưa xong:`)
    for (const o of stale) console.log(`       - ${o.code} [${o.status}] ${o.created_at}`)
    info('App sẽ tự chuyển chúng sang `expired` khi mở trang "Đơn hàng".')
    info('Chạy `supabase/migration-expire-orders.sql` để dọn ngay trong DB.')
  }
}

// ---------------------------------------------------------------------
// 4) Đếm đơn theo trạng thái
// ---------------------------------------------------------------------
head('4) Trạng thái các đơn')
const { data: byStatus } = await client.from('orders').select('status')
if (byStatus) {
  const counts = {}
  for (const o of byStatus) counts[o.status] = (counts[o.status] || 0) + 1
  for (const [s, n] of Object.entries(counts)) console.log(`       ${s}: ${n}`)
}

console.log('')
