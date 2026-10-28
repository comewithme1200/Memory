-- =====================================================================
-- Migration: OPTIONS (tuỳ chọn món) — kiểu GrabFood
--
-- Tính năng
--   1. Bảng `options` — nhóm tuỳ chọn dùng chung cho nhiều món
--      (vd: "Size", "Topping", "Mức cay").
--   2. Bảng `menu_item_options` — các lựa chọn cụ thể của 1 món trong 1 nhóm
--      (vd nhóm "Size": Size to +5k / Size vừa 0 / Size nhỏ -5k).
--   3. Bảng trung gian `menu_item_option_groups` — liên kết món <-> nhóm tuỳ chọn
--      (mỗi món có nhiều nhóm, mỗi nhóm dùng chung được cho nhiều món).
--   4. Bảng trung gian `order_item_options` — lưu tuỳ chọn KHÁCH CHỌN trong đơn
--      (nhiều tuỳ chọn cho 1 dòng món, 1 tuỳ chọn xuất hiện ở nhiều dòng món
--      -> đúng quan hệ nhiều-nhiều).
--
-- MÔ HÌNH
--   menu_items ──1:N──> menu_item_option_groups ──N:1──> options
--                                              │
--                                              └──> menu_item_options
--                                                    (lựa chọn cụ thể)
--
--   order_items ──1:N──> order_item_options ──N:1──> options
--
-- GIÁ
--   Giá cuối cùng = giá gốc của món + TỔNG price_delta của các tuỳ chọn đã chọn.
--   `price_delta` CÓ THỂ ÂM (vd "Size nhỏ" -5000) -> dùng integer có dấu.
--   Server LUÔN tra giá tuỳ chọn từ DB, KHÔNG tin giá client gửi lên.
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
-- 1) Bảng `options` — nhóm tuỳ chọn dùng chung
-- ---------------------------------------------------------------------
create table if not exists public.options (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  -- Mô tả ngắn hiển thị cạnh tên (vd "Phần ăn lớn hơn")
  description text        default '',
  -- Cho phép chọn nhiều lựa chọn trong cùng 1 nhóm không?
  --   false -> khách chọn tối đa 1 (vd Size: to / vừa / nhỏ)
  --   true  -> khách chọn được nhiều (vd Topping: thêm trứng + thêm gà)
  is_multi    boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_options_name on public.options (name);

comment on table public.options is
  'Nhóm tuỳ chọn dùng chung cho nhiều món (vd: Size, Topping, Mức cay).';

-- ---------------------------------------------------------------------
-- 2) Bảng `menu_item_options` — lựa chọn cụ thể, thuộc 1 nhóm + 1 món
-- ---------------------------------------------------------------------
create table if not exists public.menu_item_options (
  id           uuid primary key default gen_random_uuid(),
  option_id    uuid        not null references public.options(id) on delete cascade,
  menu_item_id uuid        not null references public.menu_items(id) on delete cascade,
  name         text        not null,
  -- Số tiền CỘNG (+) hoặc TRỪ (-) so với giá gốc của món. CÓ THỂ ÂM.
  price_delta  integer     not null default 0,
  image_url    text        default '',
  is_available boolean    not null default true,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_mio_option on public.menu_item_options (option_id);
create index if not exists idx_mio_item   on public.menu_item_options (menu_item_id);

comment on table public.menu_item_options is
  'Lựa chọn cụ thể của 1 món trong 1 nhóm tuỳ chọn. price_delta cộng/trừ vào giá gốc (có thể âm).';

-- ---------------------------------------------------------------------
-- 3) Bảng trung gian `menu_item_option_groups` — món <-> nhóm tuỳ chọn
-- ---------------------------------------------------------------------
create table if not exists public.menu_item_option_groups (
  menu_item_id uuid        not null references public.menu_items(id) on delete cascade,
  option_id    uuid        not null references public.options(id) on delete cascade,
  sort_order   integer     not null default 0,
  -- Nhóm này BẮT BUỘC khách phải chọn khi thêm món vào giỏ?
  is_required  boolean     not null default false,
  created_at   timestamptz not null default now(),
  primary key (menu_item_id, option_id)
);

create index if not exists idx_miog_option on public.menu_item_option_groups (option_id);

comment on table public.menu_item_option_groups is
  'Liên kết món với nhóm tuỳ chọn. is_required = khách bắt buộc phải chọn.';

-- ---------------------------------------------------------------------
-- 4) Bảng trung gian `order_item_options` — tuỳ chọn đã chốt trong đơn
-- ---------------------------------------------------------------------
create table if not exists public.order_item_options (
  id                   uuid primary key default gen_random_uuid(),
  order_item_id        uuid        not null references public.order_items(id) on delete cascade,
  option_id            uuid        references public.options(id) on delete set null,
  menu_item_option_id  uuid        references public.menu_item_options(id) on delete set null,
  name_snapshot        text        not null default '',
  price_delta_snapshot integer     not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists idx_oio_order_item on public.order_item_options (order_item_id);
create index if not exists idx_oio_option     on public.order_item_options (option_id);

comment on table public.order_item_options is
  'Tuỳ chọn khách chọn cho 1 dòng món trong đơn. Chốt giá tại thời điểm đặt.';

-- ---------------------------------------------------------------------
-- 5) Cột `line_index` cho `order_items` — định vị dòng món
-- ---------------------------------------------------------------------
-- Cần để map chính xác "dòng món thứ N trong đơn" với "nhóm tuỳ chọn line N".
-- Không có cột này thì phải đoán theo created_at (không chắc chắn khi
-- nhiều dòng được insert trong cùng 1 transaction).
alter table public.order_items add column if not exists line_index integer default 0;

create index if not exists idx_order_items_line on public.order_items (order_id, line_index);

-- ---------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------
alter table public.options                 enable row level security;
alter table public.menu_item_options       enable row level security;
alter table public.menu_item_option_groups enable row level security;
alter table public.order_item_options      enable row level security;

-- Xoá policy cũ (cho phép chạy lại nhiều lần)
drop policy if exists "options public read" on public.options;
drop policy if exists "options admin all"  on public.options;
drop policy if exists "mio public read"    on public.menu_item_options;
drop policy if exists "mio admin all"      on public.menu_item_options;
drop policy if exists "miog public read"   on public.menu_item_option_groups;
drop policy if exists "miog admin all"     on public.menu_item_option_groups;
drop policy if exists "oio admin all"      on public.order_item_options;

-- ---------------- OPTIONS ----------------
-- KHÁCH (anon): chỉ được XEM (để hiển thị tuỳ chọn trên thực đơn)
create policy "options public read" on public.options
  for select to anon using (true);

-- CHỦ QUÁN: toàn quyền
create policy "options admin all" on public.options
  for all to authenticated
  using (true) with check (true);

-- ---------------- MENU_ITEM_OPTIONS ----------------
create policy "mio public read" on public.menu_item_options
  for select to anon using (true);

create policy "mio admin all" on public.menu_item_options
  for all to authenticated
  using (true) with check (true);

-- ---------------- MENU_ITEM_OPTION_GROUPS ----------------
create policy "miog public read" on public.menu_item_option_groups
  for select to anon using (true);

create policy "miog admin all" on public.menu_item_option_groups
  for all to authenticated
  using (true) with check (true);

-- ---------------- ORDER_ITEM_OPTIONS ----------------
-- KHÁCH (anon): KHÔNG có policy -> không đọc được tuỳ chọn của đơn.
-- CHỦ QUÁN: toàn quyền.
create policy "oio admin all" on public.order_item_options
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------
-- 7) Nâng cấp RPC `create_order` — nhận kèm tuỳ chọn
-- ---------------------------------------------------------------------
-- ĐỔI DANH SÁCH THAM SỐ -> phải `drop` hàm cũ trước (PostgreSQL không cho
-- `create or replace` đổi kiểu trả về / danh sách tham số).
-- Hàm không lưu dữ liệu nên drop an toàn.
drop function if exists public.create_order(text, text, text, text, text, text, jsonb, text, jsonb);
drop function if exists public.create_order(text, text, text, text, text, text, jsonb, text);
drop function if exists public.create_order(text, text, text, text, text, text, jsonb);
drop function if exists public.create_order(text, text, text, text, text, jsonb);

create or replace function public.create_order(
  p_code            text,
  p_customer_name   text default '',
  p_customer_phone  text default '',
  p_customer_address text default '',
  p_table_no        text default '',
  p_note            text default '',
  p_items           jsonb default '[]'::jsonb,
  p_customer_token  text default '',
  -- Tuỳ chọn khách chọn cho từng dòng món.
  -- Định dạng: [{ "line": 0, "options": [
  --   { "optionId": "<uuid>", "menuItemOptionId": "<uuid>",
  --     "name": "Size to", "priceDelta": 5000 } ] }]
  -- `line` = index của dòng món trong p_items (bắt đầu từ 0).
  p_item_options    jsonb default '[]'::jsonb
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
  v_items       jsonb;
begin
  -- --- Kiểm tra đầu vào ---
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Thiếu mã đơn';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách món không hợp lệ';
  end if;

  if p_item_options is null or jsonb_typeof(p_item_options) <> 'array' then
    p_item_options := '[]'::jsonb;
  end if;

  -- --- Chuẩn hoá thông tin khách ---
  v_c_name    := left(coalesce(p_customer_name, ''), 200);
  v_c_phone   := left(coalesce(p_customer_phone, ''), 50);
  v_c_address := left(coalesce(p_customer_address, ''), 500);

  -- --- Tra cứu khách quen theo token ---
  if p_customer_token is not null and btrim(p_customer_token) <> '' then
    select c.id, c.name, c.phone, c.address
    into v_customer_id, v_c_name, v_c_phone, v_c_address
    from public.customers c
    where c.qr_token = btrim(p_customer_token)
      and c.is_active
    limit 1;

    if v_customer_id is not null then
      v_c_name    := coalesce(nullif(btrim(v_c_name), ''), v_c_name);
      v_c_phone   := coalesce(nullif(btrim(v_c_phone), ''), v_c_phone);
      v_c_address := coalesce(nullif(btrim(v_c_address), ''), v_c_address);
    end if;
  end if;

  -- --- Chuẩn hoá danh sách món: chốt tên/giá TỪ BẢNG menu_items ---
  -- Giá do client gửi lên KHÔNG ĐƯỢC TIN -> server tự tra.
  -- price = giá gốc + TỔNG price_delta của các tuỳ chọn đã chọn
  --         (price_delta tra từ DB, KHÔNG tin giá client gửi lên).
  v_items := (
    select jsonb_agg(
      jsonb_build_object(
        'id',    m.id,
        'name',  coalesce(nullif(m.name, ''), nullif(e.item->>'name', ''), '(không rõ)'),
        'price', m.price + coalesce((
              -- Lấy TẤT CẢ tuỳ chọn của dòng món này.
              -- Dùng jsonb_array_elements trực tiếp trên mảng `options` của
              -- đúng 1 entry (line = e.idx) — KHÔNG dùng jsonb_agg vì sẽ tạo
              -- mảng LỒNG mảng ([[{...}]]) -> o->>'menuItemOptionId' = NULL
              -- -> không join được menu_item_options -> giá mất hết phần delta.
              select sum(mio.price_delta)
              from jsonb_array_elements(p_item_options) eo
              cross join lateral jsonb_array_elements(
                case when jsonb_typeof(eo->'options') = 'array'
                     then eo->'options' else '[]'::jsonb end
              ) as o
              left join public.menu_item_options mio
                on mio.id::text = o->>'menuItemOptionId'
              where (eo->>'line')::int = e.idx
            ), 0),
        'qty',   greatest(1, case when (e.item->>'qty') ~ '^-?[0-9]+$'
                                  then (e.item->>'qty')::int else 1 end),
        'note',  left(coalesce(e.item->>'note', ''), 200),
        -- `with ordinality` đánh số TỪ 1 -> khớp với `line` client gửi lên.
        'idx',   e.idx
      )
      order by e.idx
    )
    from jsonb_array_elements(p_items) with ordinality as e(item, idx)
    left join lateral (
      select mi.id, mi.name, mi.price
      from public.menu_items mi
      where lower(mi.id::text) = lower(e.item->>'id')
      limit 1
    ) m on true
    where m.id is not null
  );

  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

  -- Tính tổng tiền từ giá đã chốt (bao gồm tuỳ chọn)
  select coalesce(sum((it->>'price')::int * (it->>'qty')::int), 0)
  into v_total
  from jsonb_array_elements(v_items) as it;

  -- --- Chèn đơn ---
  insert into public.orders (
    id, code, customer_name, customer_phone, customer_address, customer_id,
    table_no, note, total, status
  ) values (
    v_order_id,
    btrim(p_code),
    v_c_name,
    v_c_phone,
    v_c_address,
    v_customer_id,
    left(coalesce(p_table_no, ''), 50),
    left(coalesce(p_note, ''), 500),
    v_total,
    'new'
  );

  -- --- Chèn dòng món (giá đã chốt) ---
  insert into public.order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, qty, note, line_index
  )
  select
    v_order_id,
    (it->>'id')::uuid,
    it->>'name',
    (it->>'price')::int,
    (it->>'qty')::int,
    it->>'note',
    (it->>'idx')::int
  from jsonb_array_elements(v_items) as it
  where (it->>'id') ~ '^[0-9a-fA-F-]{36}$';

  -- --- Chèn tuỳ chọn đã chọn ---
  -- Map `line` -> order_item qua cột `line_index` (chính xác tuyệt đối).
  if jsonb_array_length(p_item_options) > 0 then
    insert into public.order_item_options (
      order_item_id, option_id, menu_item_option_id, name_snapshot, price_delta_snapshot
    )
    select
      oi.id,
      nullif(o->>'optionId', '')::uuid,
      nullif(o->>'menuItemOptionId', '')::uuid,
      left(coalesce(mio.name, o->>'name', ''), 200),
      coalesce(mio.price_delta, 0)
    from jsonb_array_elements(p_item_options) as eo
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(eo->'options') = 'array' then eo->'options' else '[]'::jsonb end
    ) as o
    join public.order_items oi
      on oi.order_id = v_order_id
     and oi.line_index = (eo->>'line')::int
    left join public.menu_item_options mio
      on mio.id::text = o->>'menuItemOptionId'
    where oi.id is not null;
  end if;

  -- --- Trả về ---
  return jsonb_build_object(
    'id',    v_order_id,
    'code', btrim(p_code),
    'total', v_total,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',      oi.menu_item_id,
          'name',    oi.name_snapshot,
          'price',   oi.price_snapshot,
          'qty',     oi.qty,
          'note',    oi.note,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id',              oio.option_id,
                'menuItemOptionId', oio.menu_item_option_id,
                'name',            oio.name_snapshot,
                'priceDelta',      oio.price_delta_snapshot
              ) order by oio.created_at, oio.id
            )
            from public.order_item_options oio
            where oio.order_item_id = oi.id
          ), '[]'::jsonb)
        ) order by oi.line_index, oi.created_at, oi.id
      )
      from public.order_items oi
      where oi.order_id = v_order_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Quyền gọi hàm: khách (anon) VÀ chủ quán đều được đặt đơn.
-- Dùng `DO` block để không lỗi "does not exist" với bất kỳ hình dạng hàm nào.
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
-- 8) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- -- Bảng mới
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name in ('options','menu_item_options','menu_item_option_groups','order_item_options');
--
-- -- RPC đã có 9 tham số
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.proname='create_order';
--
-- -- Dữ liệu mẫu: nhóm tuỳ chọn "Size" dùng chung
-- INSERT INTO public.options (name, is_multi) VALUES ('Size', false);
-- -- ... rồi tạo menu_item_options cho từng món và menu_item_option_groups
-- =====================================================================
