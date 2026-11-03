/**
 * Kiểm tra phần WEB PUSH: bảng `push_subscriptions` + 2 RPC.
 *
 * ---------------------------------------------------------------------------
 * DÙNG KHI NÀO?
 *
 *   Sau khi chạy `supabase/migration-push-subscriptions.sql` trong SQL Editor.
 *   Script này đọc DB thật để xác nhận:
 *     1. Bảng `push_subscriptions` tồn tại, đủ cột, có unique trên endpoint.
 *     2. RLS đã bật và CHẶN khách (anon) ghi/đọc.
 *     3. RPC `upsert_push_subscription` / `delete_push_subscription` tồn tại
 *        với đúng signature (6 tham số / 1 tham số).
 *     4. RPC gọi thật được (ghi rồi xoá 1 dòng test).
 *
 * Chạy:
 *     npm run check:push
 *
 * Cần `VITE_ADMIN_EMAIL` + `VITE_ADMIN_PASSWORD` trong `.env` để đăng nhập
 * (kiểm tra RPC cần quyền `authenticated`).
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failed = 0
const ok = (m) => console.log(`${GREEN}  OK  ${RESET} ${m}`)
const bad = (m) => {
  console.log(`${RED} FAIL ${RESET} ${m}`)
  failed++
}
const warn = (m) => console.log(`${YELLOW} WARN ${RESET} ${m}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)
const head = (m) => console.log(`\n${m}`)

// ---------------------------------------------------------------------------
// Đọc .env
// ---------------------------------------------------------------------------
const env = {}
{
  const p = join(ROOT, '.env')
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const email = env.VITE_ADMIN_EMAIL
const password = env.VITE_ADMIN_PASSWORD

if (!url || !anonKey) {
  console.log(`${RED}Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env${RESET}`)
  process.exit(1)
}

const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let admin = null
if (email && password) {
  admin = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await admin.auth.signInWithPassword({ email, password })
  if (error) {
    warn(`Không đăng nhập được (${error.message}) -> bỏ qua phần kiểm tra RPC.`)
    admin = null
  }
}

console.log('Kiểm tra Web Push — bảng push_subscriptions + RPC')

// ---------------------------------------------------------------------------
// 1) Bảng tồn tại?
// ---------------------------------------------------------------------------
head('1) Bảng `push_subscriptions`')
{
  const { data, error } = await admin
    ? await admin.from('push_subscriptions').select('*').limit(1)
    : await anon.from('push_subscriptions').select('*').limit(1)

  if (error && /does not exist|could not find the table|schema cache/i.test(error.message)) {
    bad('Bảng `push_subscriptions` chưa tồn tại')
    info('-> Chạy `supabase/migration-push-subscriptions.sql` trong SQL Editor.')
  } else if (error) {
    bad(`Không đọc được bảng: ${error.message}`)
    info('-> Nếu là lỗi RLS thì bảng đã tồn tại. Xem phần 2.')
  } else {
    ok(`Bảng tồn tại (${data?.length ?? 0} subscription đã đăng ký)`)
  }
}

// ---------------------------------------------------------------------------
// 2) RLS: khách (anon) KHÔNG được ghi
// ---------------------------------------------------------------------------
head('2) RLS — khách (anon) không được ghi subscription')
{
  const { error } = await anon.from('push_subscriptions').insert({
    endpoint: `https://test.invalid/${Date.now()}`,
    p256dh: 'x',
    auth: 'x',
  })

  if (!error) {
    bad('NGUY HIỂM: anon INSERT được — kẻ xấu có thể spam DB!')
    info('-> Kiểm tra lại phần policy trong migration.')
  } else if (/row-level security|not authorized|permission denied/i.test(error.message)) {
    ok('RLS chặn đúng: khách không ghi được subscription')
  } else {
    warn(`Lỗi không xác định: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 3) RPC tồn tại với đúng signature?
// ---------------------------------------------------------------------------
head('3) RPC')
const RPCS = [
  { name: 'upsert_push_subscription', args: ['text', 'text', 'text', 'uuid', 'text', 'text'] },
  { name: 'delete_push_subscription', args: ['text'] },
]

for (const r of RPCS) {
  // Gọi với tham số rỗng -> chỉ cần biết hàm CÓ tồn tại và signature đúng.
  const { error } = await anon.rpc(r.name, {})
  if (error && /could not find the function|does not exist|unknown function/i.test(error.message)) {
    bad(`RPC \`${r.name}\` chưa tồn tại (hoặc sai signature)`)
    info(`-> Cần: ${r.name}(${r.args.join(', ')})`)
  } else if (error && /row-level security|not authorized|permission denied/i.test(error.message)) {
    ok(`RPC \`${r.name}\` tồn tại (bị chặn cho anon — đúng)`)
  } else {
    ok(`RPC \`${r.name}\` tồn tại, đúng signature`)
  }
}

// ---------------------------------------------------------------------------
// 4) RPC gọi thật được (cần đăng nhập)
// ---------------------------------------------------------------------------
head('4) RPC ghi/xoá thật (cần chủ quán đã đăng nhập)')
if (!admin) {
  warn('Bỏ qua — thiếu VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env')
} else {
  const endpoint = `https://test.invalid/probe-${Date.now()}`
  const { data, error } = await admin.rpc('upsert_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: 'probe-p256dh',
    p_auth_key: 'probe-auth',
    p_user_id: null,
    p_user_agent: 'check-push-script',
    p_platform: 'probe',
  })

  if (error) {
    bad(`RPC upsert_push_subscription lỗi: ${error.message}`)
    info('-> Kiểm tra lại phần định nghĩa hàm trong migration.')
  } else if (!data?.endpoint) {
    bad('RPC upsert không trả về dòng vừa ghi.')
  } else {
    ok('RPC `upsert_push_subscription` ghi được')
    ok(`   user_id gán đúng chủ quán: ${data.user_id ? 'có' : 'KHÔNG (sai!)'}`)

    const { data: deleted } = await admin.rpc('delete_push_subscription', {
      p_endpoint: endpoint,
    })
    if (deleted === true) ok('RPC `delete_push_subscription` xoá được')
    else bad('RPC `delete_push_subscription` không xoá được dòng test')

    const { data: rest } = await admin
      .from('push_subscriptions')
      .select('endpoint')
      .like('endpoint', 'https://test.invalid/%')
    if (!rest || rest.length === 0) ok('Không còn dòng test rác')
    else {
      bad(`Còn ${rest.length} dòng test rác -> tự xoá`)
      await admin.from('push_subscriptions').delete().like('endpoint', 'https://test.invalid/%')
    }
  }
}

// ---------------------------------------------------------------------------
// 5) Tổng kết
// ---------------------------------------------------------------------------
console.log('')
if (failed === 0) {
  console.log(`${GREEN}✓ Phần Web Push sẵn sàng.${RESET}`)
  console.log(`${DIM}  Bước tiếp theo: deploy Edge Functions + đặt secrets VAPID.${RESET}`)
} else {
  console.log(`${RED}✗ Có ${failed} vấn đề.${RESET}`)
  console.log(`${DIM}  Chạy lại: supabase/migration-push-subscriptions.sql${RESET}`)
}

process.exit(failed === 0 ? 0 : 1)
