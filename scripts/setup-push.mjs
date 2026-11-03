/**
 * SETUP WEB PUSH TRỌN VẸN — 1 lần là xong.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN SCRIPT NÀY?
 *
 * Để nhận thông báo khi điện thoại đã TẮT MÀN HÌNH, cần đủ 4 thứ:
 *
 *   1. Bảng `push_subscriptions` trong DB            <- ĐÃ CÓ ✅
 *   2. Edge Function `register-push` (lưu subscription) <- CHƯA DEPLOY ❌
 *   3. Edge Function `send-push` (gửi push)           <- CHƯA DEPLOY ❌
 *   4. Database Webhook: đơn mới -> gọi `send-push`    <- CHƯA TẠO    ❌
 *
 * (Thiếu #1 thì client đăng ký push cũng không lưu được, nên bảng trống 0
 * subscription. Đó là lý do "Âm báo: BẬT / Thông báo: BẬT / Đã cài app" mà
 * vẫn không có gì khi tắt màn hình.)
 *
 * Script này làm hết #2 #3 #4 bằng **Supabase Management API** — không cần
 * Docker, không cần `supabase functions deploy` (cũng không cần copy SQL
 * tay vào SQL Editor).
 *
 * ---------------------------------------------------------------------------
 * CÁCH DÙNG
 *
 *   1) Đăng nhập Supabase CLI (chỉ 1 lần, mở trình duyệt đăng nhập):
 *
 *        npx supabase login
 *
 *   2) Chạy script:
 *
 *        npm run setup:push
 *
 *   3) Mở lại app trên điện thoại -> bấm "🔔 Bật thông báo" -> Cho phép.
 *
 * ---------------------------------------------------------------------------
 * BẢO MẬT
 *
 *   - Access token của Supabase chỉ dùng trong RAM, không ghi ra đĩa.
 *   - `service_role` key được cất trong **Supabase Vault** (bảng mã hoá),
 *     KHÔNG ghi thẳng vào SQL của trigger -> không lộ trong `pg_dump`.
 *   - `VAPID_PRIVATE_KEY` được đặt làm Secret của Edge Function (bí mật).
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
const warn = (m) => console.log(`${YELLOW} WARN ${RESET} ${m}`)
const step = (m) => console.log(`\n${CYAN}▸ ${m}${RESET}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)

/* ------------------------------------------------------------------ *
 * 0) Đọc .env
 * ------------------------------------------------------------------ */
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

const supabaseUrl = env.VITE_SUPABASE_URL
const vapidPublic = env.VITE_VAPID_PUBLIC_KEY
const vapidPrivate = env.VAPID_PRIVATE_KEY

// URL web app (GitHub Pages) -> dùng cho thông báo trỏ đúng app.
const APP_URL = env.VITE_APP_URL || env.APP_URL || 'https://comewithme1200.github.io/Memory/'

if (!supabaseUrl) {
  bad('Thiếu VITE_SUPABASE_URL trong .env')
  process.exit(1)
}
if (!vapidPublic || !vapidPrivate) {
  bad('Thiếu VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY trong .env')
  info('Chạy `npm run gen:vapid` rồi copy 2 dòng vào .env.')
  process.exit(1)
}

const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0]
const MGMT = 'https://api.supabase.com'

/* ------------------------------------------------------------------ *
 * 1) Lấy access token
 * ------------------------------------------------------------------ */
step('Lấy access token của Supabase')

let accessToken = process.env.SUPABASE_ACCESS_TOKEN || ''

// Cách 1 — file trong project: `.supabase-token` (đã gitignore).
//   Cách nhanh nhất: tạo PAT tại
//   https://supabase.com/dashboard/account/tokens rồi lưu vào file đó.
if (!accessToken) {
  const p = join(ROOT, '.supabase-token')
  if (existsSync(p)) {
    accessToken = readFileSync(p, 'utf8').trim()
  }
}

// Cách 2 — CLI đã đăng nhập (token nằm trong config/keyring của CLI).
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

// Cách 3 — CLI lưu token ở thư mục cấu hình riêng.
if (!accessToken) {
  for (const base of [process.env.APPDATA, process.env.USERPROFILE]) {
    if (!base) continue
    for (const rel of ['supabase/access-token', '.supabase/access-token']) {
      const p = join(base, rel)
      if (!existsSync(p)) continue
      try {
        const t = readFileSync(p, 'utf8').trim()
        if (t) {
          accessToken = t
          break
        }
      } catch {
        /* bỏ qua */
      }
    }
    if (accessToken) break
  }
}

if (!accessToken) {
  bad('Chưa có access token của Supabase.')
  console.log(`
${CYAN}CÁCH NHANH NHẤT (1 phút):${RESET}

1. Tạo Personal Access Token:
   ${CYAN}https://supabase.com/dashboard/account/tokens${RESET}
   -> bấm "Generate new token" -> copy chuỗi (bắt đầu bằng ${CYAN}sbp_${RESET})

2. Lưu vào file ${CYAN}.supabase-token${RESET} trong thư mục dự án:
   ${CYAN}npx supabase login --token sbp_xxxxx${RESET}

3. Chạy lại:  ${CYAN}npm run setup:push${RESET}

${DIM}File .supabase-token đã được .gitignore nên token KHÔNG bị commit lên GitHub.${RESET}
`)
  process.exit(1)
}
ok('Đã có access token.')

/** Gọi Management API. */
async function mgmt(path, options = {}) {
  const res = await fetch(`${MGMT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { ok: res.ok, status: res.status, data, text }
}

/* ------------------------------------------------------------------ *
 * 2) Lấy service_role key (để đặt trong Vault + kiểm tra webhook)
 * ------------------------------------------------------------------ */
step('Lấy service_role key')

let serviceRoleKey = ''
{
  const res = await mgmt(`/v1/projects/${projectRef}/api-keys`)
  if (!res.ok) {
    bad(`Không đọc được api-keys (${res.status})`)
    info(String(res.text).slice(0, 300))
    process.exit(1)
  }
  const keys = Array.isArray(res.data) ? res.data : []
  const found = keys.find(
    (k) =>
      k?.name === 'service_role' ||
      k?.type === 'service_role' ||
      k?.name === 'secret',
  )
  serviceRoleKey = found?.api_key || found?.key || found?.value || ''
  if (!serviceRoleKey) {
    bad('Không tìm thấy service_role key trong api-keys.')
    info(JSON.stringify(keys).slice(0, 400))
    process.exit(1)
  }
}
ok('Đã lấy service_role key.')

/* ------------------------------------------------------------------ *
 * 3) Deploy Edge Functions
 * ------------------------------------------------------------------ */
step('Deploy Edge Functions')

const FUNCTIONS = [
  { slug: 'register-push', dir: join(ROOT, 'supabase', 'functions', 'register-push') },
  { slug: 'send-push', dir: join(ROOT, 'supabase', 'functions', 'send-push') },
]

for (const fn of FUNCTIONS) {
  const indexPath = join(fn.dir, 'index.ts')
  if (!existsSync(indexPath)) {
    bad(`Thiếu file ${indexPath}`)
    process.exit(1)
  }

  const form = new FormData()
  form.append('metadata', JSON.stringify({ name: fn.slug, entrypoint_path: 'index.ts' }))
  form.append('file', new Blob([readFileSync(indexPath)], { type: 'text/plain' }), 'index.ts')

  const res = await fetch(
    `${MGMT}/v1/projects/${projectRef}/functions/deploy?slug=${fn.slug}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
  )
  const text = await res.text()

  if (!res.ok) {
    bad(`Deploy ${fn.slug} lỗi (${res.status})`)
    info(text.slice(0, 600))
    continue
  }

  let meta = null
  try {
    meta = JSON.parse(text)
  } catch {
    /* bỏ qua */
  }
  ok(`Đã deploy \`${fn.slug}\` (version ${meta?.version ?? '?'}, status ${meta?.status ?? '?'})`)
}

/* ------------------------------------------------------------------ *
 * 4) Đặt Secrets cho Edge Function
 * ------------------------------------------------------------------ */
step('Đặt secrets (VAPID keys) cho Edge Function')

{
  const res = await mgmt(`/v1/projects/${projectRef}/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { name: 'VAPID_PUBLIC_KEY', value: vapidPublic },
      { name: 'VAPID_PRIVATE_KEY', value: vapidPrivate },
      { name: 'APP_URL', value: APP_URL },
      // `sub` của JWT VAPID: phải là URL https: hợp lệ (Apple trả
      // 403 BadJwtToken nếu subject là localhost hoặc domain không thật).
      { name: 'VAPID_SUBJECT', value: APP_URL },
    ]),
  })
  if (!res.ok) {
    bad(`Không đặt được secrets (${res.status})`)
    info(String(res.text).slice(0, 400))
  } else {
    ok('Đã đặt VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + APP_URL.')
  }
}

/* ------------------------------------------------------------------ *
 * 5) SQL: RPC + Vault + trigger gọi send-push
 * ------------------------------------------------------------------ */
step('Bật Database Webhooks (tạo schema `net` + `supabase_functions`)')

{
  const res = await mgmt(`/v1/projects/${projectRef}/database/webhooks/enable`, {
    method: 'POST',
  })
  if (res.ok || res.status === 201 || res.status === 204) {
    ok('Database Webhooks đã bật.')
  } else {
    warn(`Không bật được webhooks (${res.status}) — có thể đã bật sẵn.`)
    info(String(res.text).slice(0, 300))
  }
}

step('Tạo RPC + Database Webhook (trigger gọi send-push)')

const SQL = `
-- ============================================================================
-- A) RPC cho client gọi (idempotent)
-- ============================================================================
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

grant execute on function public.upsert_push_subscription(text, text, text, uuid, text, text)
  to authenticated;
grant execute on function public.delete_push_subscription(text)
  to authenticated;

-- ============================================================================
-- B) Bảng push_subscriptions (nếu chưa có thì tạo)
-- ============================================================================
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_id     uuid references auth.users(id) on delete cascade,
  user_agent  text,
  platform    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

drop policy if exists "push_subs own read" on public.push_subscriptions;
create policy "push_subs own read"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_subs own delete" on public.push_subscriptions;
create policy "push_subs own delete"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- C) Bảo đảm pg_net + Vault có sẵn
--
-- LƯU Ý: schema "net" và "supabase_functions" do Supabase tạo khi bật
-- Database Webhooks (endpoint "POST /v1/projects/{ref}/database/webhooks/enable"
-- — script này gọi trước khi chạy SQL). "pg_net" cũng được cài sẵn kèm.
--
-- Nếu "create extension" báo lỗi "schema net does not exist" thì đã bật
-- webhooks thất bại -> chạy lại script.
-- ============================================================================
create extension if not exists pg_net with schema net;
create extension if not exists pgcrypto with schema extensions;

-- Cất service_role key vào Vault (mã hoá, không lộ trong pg_dump)
--
-- "vault.create_secret" bao loi trung ten neu secret da ton tai -> xoa
-- ban cu truoc roi tao lai (idempotent, chay lai nhieu lan van dung).
delete from vault.secrets where name = 'push_service_key';

select vault.create_secret(
  '${serviceRoleKey.replace(/'/g, "''")}',
  'push_service_key',
  'service_role key cho Database Webhook goi Edge Function send-push'
);

-- ============================================================================
-- D) Trigger: đơn mới -> gọi Edge Function send-push
--
-- Dùng "supabase_functions.http_request" (wrapper chuẩn của Supabase cho
-- Database Webhook) -> tự động thêm header Authorization + apikey.
--
-- Nếu hàm này không tồn tại, đổi sang "net.http_post" (bên dưới).
-- ============================================================================
create or replace function public.push_notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_payload jsonb;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'push_service_key';

  if v_key is null then
    raise warning 'Chua co secret push_service_key trong Vault -> bo qua push.';
    return new;
  end if;

  v_payload := jsonb_build_object(
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema,
    'record', to_jsonb(new),
    'old_record', null
  );

  perform net.http_post(
    url := '${supabaseUrl.replace(/'/g, "''")}/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_payload,
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_push_new_order on public.orders;
create trigger trg_push_new_order
  after insert on public.orders
  for each row execute function public.push_notify_new_order();
`

{
  const res = await mgmt(`/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
  })
  if (!res.ok) {
    bad(`Chạy SQL lỗi (${res.status})`)
    info(String(res.text).slice(0, 900))
    process.exit(1)
  }
  ok('Đã tạo RPC + Vault + trigger trg_push_new_order.')
}

/* ------------------------------------------------------------------ *
 * 6) Kiểm tra lại
 * ------------------------------------------------------------------ */
step('Kiểm tra kết quả')

{
  const res = await mgmt(`/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        select
          (select count(*) from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('upsert_push_subscription','delete_push_subscription','push_notify_new_order')
          ) as functions_count,
          (select count(*) from pg_trigger
            where tgname = 'trg_push_new_order') as trigger_count,
          (select count(*) from public.push_subscriptions) as subs_count;
      `,
    }),
  })

  if (res.ok) {
    const row = Array.isArray(res.data) ? res.data[0] : null
    if (row) {
      row.functions_count >= 3 ? ok(`${row.functions_count} hàm đã tạo.`) : bad(`Chỉ có ${row.functions_count}/3 hàm.`)
      row.trigger_count >= 1 ? ok('Trigger trg_push_new_order đã tồn tại.') : bad('Chưa có trigger.')
      info(`Subscription đang đăng ký: ${row.subs_count}`)
    }
  }
}

{
  const res = await mgmt(`/v1/projects/${projectRef}/functions`)
  if (res.ok && Array.isArray(res.data)) {
    for (const fn of res.data) {
      if (['register-push', 'send-push'].includes(fn.slug)) {
        ok(`Edge Function \`${fn.slug}\` — ${fn.status}`)
      }
    }
  }
}

console.log(`
${GREEN}╔══════════════════════════════════════════════════════════╗${RESET}
${GREEN}║  XONG! Bước cuối cùng: bật thông báo trên điện thoại     ║${RESET}
${GREEN}╚══════════════════════════════════════════════════════════╝${RESET}

1. MỞ LẠI app trên điện thoại (đóng hẳn rồi mở từ icon màn hình chính)
2. Bấm nút  **🔔 Bật thông báo**  ->  chọn **Cho phép**
3. Thanh công cụ phải hiện đủ:
      ✅ Thông báo: BẬT
      📲 Push: BẬT
      📱 Đã cài app
4. TẮT MÀN HÌNH rồi đặt 1 đơn thử -> phải có tiếng + thông báo.

${YELLOW}Nếu vẫn chưa có:${RESET}
  - Kiểm tra lại: ${CYAN}npm run check:push${RESET}  (mục 4 phải là số > 0)
  - Xem log function: Supabase Dashboard -> Edge Functions -> send-push -> Logs
  - Trên iPhone: Cài đặt -> Quán Ăn Sáng -> Thông báo -> Bật (và tắt chế độ
    Không làm phiền nếu đang bật).
`)
