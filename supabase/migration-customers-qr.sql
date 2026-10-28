-- =====================================================================
-- Migration: khách quen + QR code + địa chỉ giao hàng
--
-- Tính năng
--   1. Bảng `customers` — chủ quán lưu thông tin khách quen
--      (tên, SĐT, địa chỉ) và sinh 1 mã QR cho mỗi khách.
--   2. RPC `customer_by_token(token)` — khách quét QR -> app gọi hàm này
--      để lấy thông tin điền sẵn vào form đặt món.
--   3. Thêm cột `orders.customer_address` + `orders.customer_id`.
--   4. Đổi RPC `create_order` để nhận địa chỉ + token khách quen.
--   5. Sửa lỗ hổng: gỡ quyền xem doanh thu (`summarize_orders`) cho khách.
--
-- VÌ SAO QR CHỨA TOKEN, KHÔNG CHỨA THÔNG TIN?
--   Nếu nhúng thẳng tên/SĐT/địa chỉ vào URL của QR thì:
--     - URL rất dài -> QR rất dày, khó quét
--     - SĐT của khách nằm lộ trong lịch sử trình duyệt và log máy chủ
--   Với token: URL ngắn, dễ quét, và không lộ thông tin. Token là bí mật
--   tương đương "vé mời" — ai có token mới lấy được thông tin khách đó.
--
-- AN TOÀN DỮ LIỆU
--   - Không xoá bảng/dữ liệu nào.
--   - `orders.items` (JSONB legacy) vẫn giữ nguyên.
--   - Script chạy được nhiều lần (idempotent).
--
-- CÁCH CHẠY
--   Supabase Dashboard -> SQL Editor -> New query -> dán file này -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bảng khách quen
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null default '',
  phone      text        default '',
  address    text        default '',
  -- Token nằm trong URL của QR. Tự sinh, không ai đoán được.
  qr_token   text        not null default encode(gen_random_bytes(16), 'hex'),
  -- Tắt tạm thì QR cũ không dùng được nữa (khách quét ra thông báo).
  is_active  boolean     not null default true,
  note       text        default '',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_customers_token on public.customers (qr_token);
create index if not exists idx_customers_active on public.customers (is_active);

comment on table public.customers is
  'Khách quen — chủ quán nhập tên/SĐT/địa chỉ, app sinh QR để khách quét và đặt món.';
comment on column public.customers.qr_token is
  'Token nằm trong URL của QR. Bí mật tương đương vé mời — chia sẻ token là chia sẻ thông tin khách.';

-- ---------------------------------------------------------------------
-- 2) Cột mới cho bảng orders
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists customer_address text default '';
alter table public.orders add column if not exists customer_id uuid;

comment on column public.orders.customer_address is
  'Địa chỉ giao hàng (khách quen thì điền sẵn từ QR, khách mới thì tự nhập).';
comment on column public.orders.customer_id is
  'Liên kết tới khách quen. NULL nếu khách đặt không dùng QR.';

-- Khoá ngoại -> khách quen (xoá khách thì đơn cũ vẫn còn, chỉ mất liên kết).
-- `if not exists` không hỗ trợ cho CONSTRAINT nên phải kiểm tra trước.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_customer_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) RLS cho bảng customers
-- ---------------------------------------------------------------------
-- CHỦ QUÁN: toàn quyền đọc/thêm/sửa/xoá khách quen.
alter table public.customers enable row level security;

drop policy if exists "customers admin all" on public.customers;

create policy "customers admin all" on public.customers
  for all to authenticated
  using (true) with check (true);

-- KHÁCH (anon): KHÔNG có policy nào cho bảng customers.
--   -> Khách không đọc được danh sách khách quen.
--   -> Khách chỉ lấy được thông tin của CHÍNH MÌNH qua RPC
--      `customer_by_token` (phải biết token trong QR).

-- ---------------------------------------------------------------------
-- 4) RPC customer_by_token — lấy thông tin khách từ token trong QR
-- ---------------------------------------------------------------------
create or replace function public.customer_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',      c.id,
    'name',    c.name,
    'phone',   c.phone,
    'address', c.address
  )
  from public.customers c
  where c.qr_token = p_token
    and c.is_active
  limit 1;
$$;

-- Khách cần gọi được hàm này (quét QR là hành động của khách).
-- Nhưng phải gỡ quyền mặc định của `public` trước.
revoke all on function public.customer_by_token(text) from public;
grant execute on function public.customer_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Sửa lỗ hổng: gỡ quyền xem doanh thu cho khách
-- ---------------------------------------------------------------------
-- `revoke ... from public` KHÔNG đủ vì `anon` là thành viên của `public`.
-- Phải revoke cho `anon` riêng.
--
-- ⚠️ VÌ SAO DÙNG `DO` BLOCK THAY VÌ VIẾT THẲNG `revoke`?
--
-- PostgreSQL KHÔNG tạo hàm overload 0-tham-số cho các tham số có `default`.
-- `create function summarize_orders(p_from timestamptz default null, p_to timestamptz default null)`
-- tạo ra ĐÚNG MỘT hàm với 2 tham số. Do đó câu lệnh:
--
--     revoke all on function public.summarize_orders() from public;
--
-- sẽ báo lỗi "function public.summarize_orders() does not exist".
--
-- Và ĐÓNG TOÀN BỘ SCRIPT (Supabase chạy file trong 1 transaction) — các câu
-- lệnh phía sau sẽ KHÔNG được chạy. Đây chính là lý do
-- `fix-summarize-permissions.sql` trước đây chạy mà không có tác dụng:
-- lỗi xảy ra ở dòng `revoke ... summarize_orders()` làm hỏng cả file.
--
-- `DO` block duyệt qua `pg_proc` nên chạy được với MỌI hình dạng hàm,
-- không sợ lỗi "does not exist".
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'summarize_orders'
  loop
    execute format('revoke all on function %s from public', r.oid::regprocedure);
    execute format('revoke all on function %s from anon', r.oid::regprocedure);
    execute format('grant execute on function %s to authenticated', r.oid::regprocedure);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6) RPC create_order — thêm địa chỉ + nhận token khách quen
-- ---------------------------------------------------------------------
-- ĐỔI DANH SÁCH THAM SỐ -> phải `drop` hàm cũ trước (PostgreSQL không cho
-- `create or replace` đổi kiểu trả về / danh sách tham số).
-- Hàm không lưu dữ liệu nên drop an toàn.
drop function if exists public.create_order(text, text, text, text, text, jsonb);
drop function if exists public.create_order();

create or replace function public.create_order(
  p_code            text,
  p_customer_name   text default '',
  p_customer_phone  text default '',
  p_customer_address text default '',
  p_table_no        text default '',
  p_note            text default '',
  p_items           jsonb default '[]'::jsonb,
  p_customer_token  text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id    uuid := gen_random_uuid();
  v_total       integer := 0;
  v_customer_id uuid := null;
  v_c_name      text := '';
  v_c_phone     text := '';
  v_c_address   text := '';
begin
  -- --- Kiểm tra đầu vào ---
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Thiếu mã đơn';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách món không hợp lệ';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Đơn không có món nào';
  end if;

  -- --- Tra cứu khách quen theo token trong QR ---
  -- Nếu token hợp lệ -> dùng thông tin trong DB (nguồn chân lý).
  -- Client KHÔNG tự khai báo được tên/địa chỉ của khách quen.
  if p_customer_token is not null and btrim(p_customer_token) <> '' then
    select c.id, c.name, c.phone, c.address
      into v_customer_id, v_c_name, v_c_phone, v_c_address
    from public.customers c
    where c.qr_token = btrim(p_customer_token)
      and c.is_active
    limit 1;
  end if;

  -- Khách quen -> lấy thông tin từ DB.
  -- Khách mới -> lấy thông tin client gửi lên (đã chuẩn hoá bên dưới).
  if v_customer_id is not null then
    p_customer_name   := coalesce(nullif(btrim(p_customer_name), ''),   v_c_name);
    p_customer_phone  := coalesce(nullif(btrim(p_customer_phone), ''),  v_c_phone);
    p_customer_address := coalesce(nullif(btrim(p_customer_address), ''), v_c_address);
  end if;

  -- --- Tính tổng tiền TỪ DỮ LIỆU ĐÃ CHUẨN HOÁ (không tin giá do client gửi) ---
  -- Giá & tên lấy từ bảng `menu_items`. Chỉ khi món KHÔNG tồn tại trong thực
  -- đơn mới fallback sang giá client gửi lên.
  -- Lý do: nếu tin giá của client, khách có thể gửi price = 0 để đặt miễn phí.
  select coalesce(sum(
      greatest(1, case when (e->>'qty') ~ '^-?[0-9]+$' then (e->>'qty')::int else 1 end)
      * greatest(0, coalesce(
          (select m.price from public.menu_items m
            where lower(m.id::text) = lower(e->>'id') limit 1),
          case when (e->>'price') ~ '^-?[0-9]+$' then (e->>'price')::int else 0 end
        ))
    ), 0)
  into v_total
  from jsonb_array_elements(p_items) as e;

  -- --- Chèn đơn ---
  insert into public.orders (
    id, code, customer_name, customer_phone, customer_address,
    table_no, note, total, status, customer_id
  ) values (
    v_order_id,
    btrim(p_code),
    left(coalesce(p_customer_name, ''), 200),
    left(coalesce(p_customer_phone, ''), 50),
    left(coalesce(p_customer_address, ''), 500),
    left(coalesce(p_table_no, ''), 50),
    left(coalesce(p_note, ''), 500),
    v_total,
    'new',
    v_customer_id
  );

  -- --- Chèn dòng món ---
  insert into public.order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, qty, note
  )
  select
    v_order_id,
    m.id,
    coalesce(nullif(m.name, ''), nullif(e->>'name', ''), '(không rõ)'),
    greatest(0, coalesce(
      m.price,
      case when (e->>'price') ~ '^-?[0-9]+$' then (e->>'price')::int else 0 end
    )),
    greatest(1, case when (e->>'qty') ~ '^-?[0-9]+$' then (e->>'qty')::int else 1 end),
    left(coalesce(e->>'note', ''), 200)
  from jsonb_array_elements(p_items) as e
  left join lateral (
    select mi.id, mi.name, mi.price
    from public.menu_items mi
    where lower(mi.id::text) = lower(e->>'id')
    limit 1
  ) m on true;

  -- --- Trả về id + tổng tiền + món đã chốt (để client hiển thị khớp DB) ---
  return jsonb_build_object(
    'id',    v_order_id,
    'code', btrim(p_code),
    'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',    oi.menu_item_id,
        'name',  oi.name_snapshot,
        'price', oi.price_snapshot,
        'qty',   oi.qty,
        'note',  oi.note
      ) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = v_order_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Quyền gọi hàm: khách (anon) VÀ chủ quán đều được đặt đơn.
-- Dùng `DO` block để không lỗi "does not exist" với bất kỳ hình dạng hàm nào
-- (xem giải thích ở mục 5 ở trên).
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_order'
  loop
    execute format('revoke all on function %s from public', r.oid::regprocedure);
    execute format('revoke all on function %s from anon', r.oid::regprocedure);
    execute format('grant execute on function %s to anon, authenticated', r.oid::regprocedure);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- -- Bảng + cột mới
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='customers';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='orders'
--     AND column_name IN ('customer_address','customer_id');
--
-- -- Quyền của các RPC (anon KHÔNG được có trong summarize_orders)
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        ARRAY(SELECT r.rolname FROM pg_roles r
--              WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) AS can_execute
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('summarize_orders','create_order','customer_by_token')
--  ORDER BY p.proname;
--
-- Kết quả mong đợi:
--   customer_by_token -> {anon, authenticated}
--   create_order      -> {anon, authenticated}
--   summarize_orders  -> {authenticated}      <-- KHÔNG có anon
-- =====================================================================
