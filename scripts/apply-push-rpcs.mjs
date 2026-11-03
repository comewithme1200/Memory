/**
 * Tạo (hoặc tạo lại) 2 RPC cho Web Push trong Supabase.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN SCRIPT NÀY?
 *
 * `supabase/migration-push-subscriptions.sql` phải chạy trong SQL Editor của
 * Supabase (cần quyền DDL). Nhưng nếu file đó lỗi giữa chừng (đúng như lỗi
 * 42601 bạn gặp), thì bảng có thể đã tạo nhưng phần RPC chưa.
 *
 * Script này dùng **Supabase Management API** để chạy SQL trực tiếp:
 *   POST https://api.supabase.com/v1/projects/{ref}/database/query
 *
 * Yêu cầu:
 *   1. Cài Supabase CLI:  npm i -g supabase
 *   2. Đăng nhập:          supabase login
 *   3. Link project:       supabase link --project-ref <REF>
 *
 * Sau đó chạy:
 *   node scripts/apply-push-rpcs.mjs
 *
 * Nếu chưa có CLI/token, script sẽ in ra hướng dẫn dán tay vào SQL Editor.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

const ok = (m) => console.log(`${GREEN}  OK  ${RESET} ${m}`)
const bad = (m) => console.log(`${RED} FAIL ${RESET} ${m}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)

// ---------------------------------------------------------------------------
// 1) Đọc .env
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
if (!url) {
  console.log(`${RED}Thiếu VITE_SUPABASE_URL trong .env${RESET}`)
  process.exit(1)
}

// Project ref = phần giữa domain: https://abcdef.supabase.co -> abcdef
const projectRef = url.replace(/^https?:\/\//, '').split('.')[0]
console.log(`\nProject: ${CYAN}${projectRef}${RESET}`)

// ---------------------------------------------------------------------------
// 2) Lấy access token
// ---------------------------------------------------------------------------
let accessToken = process.env.SUPABASE_ACCESS_TOKEN || ''

if (!accessToken) {
  const cfgPath = join(ROOT, 'supabase', '.temp', 'supabase.json')
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      if (cfg?.access_token) accessToken = cfg.access_token
    } catch {
      /* bỏ qua */
    }
  }
}

if (!accessToken) {
  try {
    const out = execFileSync('supabase', ['token', '--format', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parsed = JSON.parse(out)
    accessToken = parsed?.access_token || parsed?.token || ''
  } catch {
    /* CLI chưa cài / chưa đăng nhập */
  }
}

if (!accessToken) {
  console.log(`
${YELLOW}Không lấy được access token của Supabase.${RESET}

Cách 1 — Dán tay vào SQL Editor (nhanh nhất):
${CYAN}  1. Mở Supabase Dashboard -> SQL Editor -> New query
  2. Mở file supabase/migration-push-subscriptions.sql
  3. Copy phần từ "-- 3) RPC cho client gọi" đến hết file
  4. Dán vào SQL Editor -> Run${RESET}

Cách 2 — Cài Supabase CLI rồi chạy lại script này:
${CYAN}  npm i -g supabase
  supabase login
  supabase link --project-ref ${projectRef}
  node scripts/apply-push-rpcs.mjs${RESET}
`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3) SQL cần chạy
// ---------------------------------------------------------------------------
const SQL = `
create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth_key   text,
  p_user_id    uuid default null,
  p_user_agent text default null,
  p_platform   text default null
)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.push_subscriptions;
  v_user uuid;
begin
  v_user := coalesce(p_user_id, auth.uid());

  insert into public.push_subscriptions as t
    (endpoint, p256dh, auth, user_id, user_agent, platform)
  values
    (p_endpoint, p_p256dh, p_auth_key, v_user, p_user_agent, p_platform)
  on conflict (endpoint) do update
    set p256dh      = excluded.p256dh,
        auth        = excluded.auth,
        user_id     = coalesce(excluded.user_id, t.user_id),
        user_agent  = excluded.user_agent,
        platform    = excluded.platform,
        updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint
    and user_id = auth.uid();

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('upsert_push_subscription', 'delete_push_subscription')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end;
$$;

grant execute on function public.upsert_push_subscription(text, text, text, uuid, text, text)
  to authenticated;
grant execute on function public.delete_push_subscription(text)
  to authenticated;
`

// ---------------------------------------------------------------------------
// 4) Gọi Management API
// ---------------------------------------------------------------------------
console.log('\nĐang chạy SQL qua Supabase Management API...')

try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  })

  const text = await res.text()

  if (!res.ok) {
    bad(`Management API lỗi ${res.status}`)
    info(text.slice(0, 800))
    process.exit(1)
  }

  ok('SQL đã chạy thành công.')
} catch (e) {
  bad(`Không gọi được Management API: ${e?.message}`)
  info('Có thể token sai hoặc mạng bị chặn -> dán tay trong SQL Editor.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 5) Kiểm tra lại
// ---------------------------------------------------------------------------
console.log('')
try {
  execFileSync('node', [join(ROOT, 'scripts', 'check-push-schema.mjs')], {
    stdio: 'inherit',
  })
} catch {
  /* check script trả exit code khác 0 -> đã in ở trên */
}
