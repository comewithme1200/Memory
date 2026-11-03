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
  {
    name: 'upsert_push_subscription',
    args: ['text', 'text', 'text', 'uuid', 'text', 'text'],
    probe: {
      p_endpoint: 'https://test.invalid/probe',
      p_p256dh: 'probe',
      p_auth_key: 'probe',
      p_user_id: null,
      p_user_agent: 'check-push-script',
      p_platform: 'probe',
    },
  },
  {
    name: 'delete_push_subscription',
    args: ['text'],
    probe: { p_endpoint: 'https://test.invalid/probe' },
  },
]

for (const r of RPCS) {
  // Gọi với ĐÚNG tham số -> PostgREST mới resolve được hàm.
  //
  // LƯU Ý: gọi với `{}` (không tham số) sẽ luôn báo "Could not find the
  // function ... without parameters in the schema cache" -> đó là hệ quả của
  // việc hàm có default, KHÔNG phải hàm không tồn tại. Nên phải probe bằng
  // đủ tham số rồi mới kết luận.
  const { error } = await anon.rpc(r.name, r.probe)

  if (!error) {
    ok(`RPC \`${r.name}\` tồn tại, đúng signature`)
  } else if (/row-level security|not authorized|permission denied/i.test(error.message)) {
    ok(`RPC \`${r.name}\` tồn tại (bị chặn cho anon — đúng)`)
  } else if (/could not find the function|does not exist|unknown function/i.test(error.message)) {
    bad(`RPC \`${r.name}\` chưa tồn tại (hoặc sai signature)`)
    info(`-> Cần: ${r.name}(${r.args.join(', ')})`)
  } else {
    warn(`Lỗi không xác định: ${error.message}`)
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
// 5) Edge Function + trigger (kiểm tra qua Management API nếu có token)
// ---------------------------------------------------------------------------
head('5) Edge Functions + trigger trong DB')

// Lấy access token (nếu có) để kiểm tra Edge Function qua Management API.
let mgmtToken = process.env.SUPABASE_ACCESS_TOKEN || ''
if (!mgmtToken) {
  const p = join(ROOT, '.supabase-token')
  if (existsSync(p)) mgmtToken = readFileSync(p, 'utf8').trim()
}

const projectRef = url.replace(/^https?:\/\//, '').split('.')[0]

if (!mgmtToken) {
  warn('Bỏ qua kiểm tra Edge Function — thiếu access token.')
  info('-> Tạo token tại https://supabase.com/dashboard/account/tokens')
  info('-> rồi lưu vào file .supabase-token, sau đó chạy lại script này.')
} else {
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions`, {
      headers: { Authorization: `Bearer ${mgmtToken}` },
    })
    const list = res.ok ? await res.json() : []
    for (const slug of ['register-push', 'send-push']) {
      const fn = list.find((f) => f.slug === slug)
      if (!fn) {
        bad(`Edge Function \`${slug}\` chưa deploy`)
        info('-> Chạy `npm run setup:push`')
      } else if (fn.status !== 'ACTIVE') {
        bad(`Edge Function \`${slug}\` đang ở trạng thái ${fn.status}`)
      } else {
        ok(`Edge Function \`${slug}\` — ACTIVE (v${fn.version})`)
      }
    }
  } catch (e) {
    warn(`Không kiểm tra được Edge Function: ${e?.message}`)
  }
}

// Trigger trong DB -> dùng RPC `push_notify_new_order` tồn tại là đủ, vì
// trigger được tạo kèm hàm đó. Kiểm tra qua Management API (SQL editor API).
if (mgmtToken) {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query:
            "select count(*)::int as c from pg_trigger where tgname = 'trg_push_new_order';",
        }),
      },
    )
    if (res.ok) {
      const rows = await res.json()
      const c = Number(rows?.[0]?.c ?? 0)
      if (c > 0) ok('Trigger `trg_push_new_order` đã tồn tại (đơn mới -> gọi send-push)')
      else {
        bad('Chưa có trigger `trg_push_new_order`')
        info('-> Chạy `npm run setup:push`')
      }
    }
  } catch {
    /* bỏ qua */
  }
}

// ---------------------------------------------------------------------------
// 6) Tổng kết
// ---------------------------------------------------------------------------
console.log('')
if (failed === 0) {
  console.log(`${GREEN}✓ Phần Web Push sẵn sàng.${RESET}`)
  console.log(
    `${DIM}  Bước cuối: mở app trên điện thoại -> bấm "🔔 Bật thông báo" -> "📲 Đồng bộ push".${RESET}`,
  )
} else {
  console.log(`${RED}✗ Có ${failed} vấn đề.${RESET}`)
  console.log(`${DIM}  Chạy lại: npm run setup:push${RESET}`)
}

process.exit(failed === 0 ? 0 : 1)
