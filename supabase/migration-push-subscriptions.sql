-- ============================================================================
-- ĐĂNG KÝ WEB PUSH — bảng lưu "đường dẫn gửi thông báo" của thiết bị
-- ============================================================================
--
-- MỤC ĐÍCH
--
-- Khi chủ quán mở app trên điện thoại và bấm "🔔 Bật thông báo", trình duyệt
-- sinh ra một *push subscription* — gồm 2 thứ:
--
--   1. `endpoint` — URL mà dịch vụ push của trình duyệt (Apple/Google/Mozilla)
--      cung cấp. Server gửi POST tới URL này là thiết bị nhận thông báo.
--   2. `p256dh` + `auth` — khoá mã hoá để CHỈ thiết bị đó đọc được nội dung.
--
-- Bảng này lưu lại subscription đó. Khi có đơn mới, Edge Function `send-push`
-- đọc bảng này và gửi push cho từng thiết bị.
--
--   → Đây là thứ cho phép nhận thông báo khi ĐIỆN THOẠI ĐÃ KHOÁ MÀN HÌNH
--     hoặc app đã đóng hoàn toàn. (Realtime trong app chỉ hoạt động khi app
--     còn mở.)
--
-- ---------------------------------------------------------------------------
-- BẢO MẬT
--
--   - Chủ quán (`authenticated`) được ĐỌC và XOÁ subscription của mình.
--   - KHÔNG cấp quyền INSERT cho `anon` — tránh kẻ xấu spam subscription
--     vào DB của bạn. Việc ghi do Edge Function thực hiện bằng
--     service_role key (tự bypass RLS).
--   - Subscription tự được xoá khi gửi push thất bại (404/410) — Edge
--     Function tự dọn.
--
-- ---------------------------------------------------------------------------
-- AN TOÀN
--
--   - `create table if not exists` -> chạy lại nhiều lần không sao.
--   - `drop policy if exists` trước `create policy` (Postgres không có
--     `create policy if not exists`).
--   - Không đụng vào bảng `orders` hay bất kỳ bảng nào khác.
--   - File này IDEMPOTENT: chạy lại bao nhiêu lần cũng cho kết quả đúng.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Bảng
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  -- endpoint là duy nhất trong 1 thiết bị (1 endpoint = 1 subscription).
  endpoint    text        not null unique,
  p256dh      text        not null,
  auth        text        not null,
  -- Ghi lại máy nào đăng ký (để hiển thị cho chủ quán: "iPhone của anh").
  user_agent  text,
  platform    text,
  -- Token xác thực (JWT) của chủ quán -> để biết subscription thuộc ai.
  user_id     uuid        references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Cột `device_id`: id ổn định do client tự sinh (lưu localStorage).
-- Dùng để dọn endpoint cũ khi iOS sinh endpoint mới cho cùng một máy
-- -> tránh nhận nhiều thông báo trùng cho 1 đơn.
alter table public.push_subscriptions add column if not exists device_id text;

create index if not exists idx_push_subscriptions_device_id
  on public.push_subscriptions (device_id);

-- Xem nhanh các thiết bị đang đăng ký.
create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

-- Tự cập nhật `updated_at` mỗi lần UPDATE.
create or replace function public.touch_push_subscriptions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row
  execute function public.touch_push_subscriptions_updated_at();

-- ---------------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

-- Chủ quán đã đăng nhập: được đọc / xoá subscription của chính mình.
drop policy if exists "push_subs own read" on public.push_subscriptions;
create policy "push_subs own read"
  on public.push_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "push_subs own delete" on public.push_subscriptions;
create policy "push_subs own delete"
  on public.push_subscriptions
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- KHÔNG cấp quyền INSERT cho `anon` hay `authenticated`:
-- việc ghi subscription do Edge Function (`register-push`) thực hiện bằng
-- service_role key -> tự động bypass RLS.
--
-- Lý do: nếu cho `anon` insert được, bất kỳ ai cũng có thể spam hàng nghìn
-- dòng vào DB của bạn. Xem `supabase/functions/register-push/index.ts`.

-- ---------------------------------------------------------------------------
-- 3) RPC cho client gọi
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- 3 LỖI ĐÃ GẶP (đừng viết lại sai)
--
--   1. `return (insert into ... returning *)` -> ERROR 42601 syntax error at
--      or near "into". Trong PL/pgSQL, INSERT là CÂU LỆNH (statement), không
--      phải biểu thức -> không được đặt trong ngoặc của `return`.
--      Đúng: `insert ... returning * into v_row;` rồi `return v_row;`
--
--   2. `p_user_id uuid default auth.uid()` -> ERROR: default for parameter
--      cannot use column reference / non-constant default.
--      Default parameter phải là HẰNG SỐ. Đúng: `default null` + lấy
--      `auth.uid()` bên trong thân hàm.
--
--   3. Trong `ON CONFLICT DO UPDATE`, tham chiếu cột của dòng CŨ bằng tên
--      đầy đủ có dấu chấm (`public.push_subscriptions.user_id`) là rủi ro —
--      Postgres có thể không resolve đúng. Đúng: đặt ALIAS cho bảng đích
--      (`insert into ... as t`) rồi tham chiếu `t.user_id`.
--
-- ---------------------------------------------------------------------------
-- VÌ SAO BẰNG `security definer`?
--
--   Bảng `push_subscriptions` KHÔNG có policy INSERT cho `authenticated`
--   (cố ý — chống spam). Nếu hàm chạy với quyền của người gọi (`invoker`)
--   thì INSERT sẽ bị RLS chặn -> hàm không dùng được.
--   `security definer` -> hàm chạy với quyền của chủ sở hữu (postgres) ->
--   RLS được bypass, còn `auth.uid()` vẫn trả về đúng người đang đăng nhập.
--
-- ---------------------------------------------------------------------------
-- BẢO MẬT
--
--   `set search_path = ''` -> mọi tên phải viết đầy đủ
--   (`public.push_subscriptions`, `auth.uid()`). `pg_catalog` luôn được
--   tìm kiếm đầu tiên nên `now()`, `coalesce()` vẫn dùng được.
--   Chống kẻ xấu tạo object trong `public` để bị "search path hijack".
-- ---------------------------------------------------------------------------

-- Lưu subscription (idempotent theo endpoint).
create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth_key   text,
  p_user_id    uuid default null,
  p_user_agent text default null,
  p_platform   text default null,
  p_device_id  text default null
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
  -- Ưu tiên user_id được truyền vào; nếu không thì lấy người đang đăng nhập.
  v_user := coalesce(p_user_id, auth.uid());

  -- Dọn endpoint CŨ của cùng thiết bị (cùng device_id).
  --
  -- Mỗi lần đăng ký lại, iOS sinh endpoint MỚI cho cùng một máy. Endpoint cũ
  -- vẫn nằm trong bảng -> server gửi push cho tất cả -> chủ quán thấy N
  -- thông báo giống hệt cho 1 đơn.
  --
  -- `device_id` là id ổn định do client tự sinh (lưu trong localStorage) ->
  -- chỉ xoá endpoint của CHÍNH máy này, không đụng máy khác.
  if p_device_id is not null and p_device_id <> '' then
    delete from public.push_subscriptions
    where device_id = p_device_id
      and endpoint <> p_endpoint;
  end if;

  insert into public.push_subscriptions as t
    (endpoint, p256dh, auth, user_id, user_agent, platform, device_id)
  values
    (p_endpoint, p_p256dh, p_auth_key, v_user, p_user_agent, p_platform, p_device_id)
  on conflict (endpoint) do update
    set p256dh      = excluded.p256dh,
        auth        = excluded.auth,
        user_id     = coalesce(excluded.user_id, t.user_id),
        user_agent  = excluded.user_agent,
        platform    = excluded.platform,
        device_id   = coalesce(excluded.device_id, t.device_id),
        updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Xoá subscription của mình.
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

-- ---------------------------------------------------------------------------
-- 4) Cấp / gỡ quyền
-- ---------------------------------------------------------------------------
--
-- Dùng `DO` block + quét `pg_proc` thay vì `revoke ... on function ...`
-- trực tiếp:
--   - `revoke` trực tiếp sẽ lỗi 42883 nếu hàm chưa tồn tại -> làm HỎNG cả
--     file khi chạy trong 1 transaction.
--   - `DO` block quét `pg_proc` theo tên -> an toàn, chạy lại nhiều lần OK.
--
-- Gỡ quyền cho `public` / `anon` / `authenticated` trước, rồi chỉ cấp lại
-- cho `authenticated` -> chỉ chủ quán đã đăng nhập mới gọi được.
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

grant execute on function public.upsert_push_subscription(text, text, text, uuid, text, text, text)
  to authenticated;
grant execute on function public.delete_push_subscription(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Kiểm tra
-- ---------------------------------------------------------------------------
-- Chạy sau khi áp dụng:
--
--   select count(*) as thiet_bi from public.push_subscriptions;
--
-- Nếu có 1 dòng sau khi bấm "🔔 Bật thông báo" trên điện thoại -> OK.
--
-- Kiểm tra hàm đã tạo đúng:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('upsert_push_subscription', 'delete_push_subscription');
