-- =====================================================================
-- Migration: thời gian khách muốn nhận hàng (take away)
--
-- BỐI CẢNH
--   Quán làm TAKE AWAY -> khách không ngồi tại bàn, nên "Số bàn" không còn
--   ý nghĩa. Thay vào đó khách có thể ghi "thời gian muốn nhận hàng"
--   (tuỳ chọn) để bếp sắp xếp.
--
-- VÌ SAO TẠO HÀM MỚI `create_order_v2` MÀ KHÔNG SỬA `create_order`?
--
--   `create_order` đang được dùng bởi các phiên bản app đã cài trên máy
--   khách (service worker cache cũ vẫn còn). Nếu ta `drop` hàm cũ và
--   tạo hàm mới với 11 tham số, các client cũ gọi hàm cũ sẽ lỗi ->
--   khách không đặt được món nữa.
--
--   Nên: GIỮ NGUYÊN `create_order` (10 tham số) và TẠO THÊM
--   `create_order_v2` (11 tham số, có thêm `p_pickup_time`).
--   - Client MỚI thử `create_order_v2` trước -> có giờ nhận hàng.
--   - Client CŨ (chưa cập nhật) gọi `create_order` -> vẫn chạy bình thường.
--   - Client MỚI mà server CHƯA migrate -> tự fallback về `create_order`.
--   Tên hàm khác nhau nên KHÔNG bao giờ xảy ra "ambiguous function call".
--
-- AN TOÀN DỮ LIỆU
--   - Chỉ THÊM cột mới (nullable) -> không ảnh hưởng đơn cũ.
--   - Không xoá bảng/dữ liệu nào.
--   - Script idempotent: chạy lại nhiều lần vẫn đúng.
--
-- CÁCH CHẠY
--   node scripts/apply-sql.mjs supabase/migration-pickup-time.sql
--   hoặc dán file này vào Supabase Dashboard -> SQL Editor -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cột mới cho bảng orders
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists pickup_time timestamptz;

comment on column public.orders.pickup_time is
  'Thời gian khách muốn nhận hàng (take away). NULL = khách không chỉ định / muốn nhận ngay.';

-- ---------------------------------------------------------------------
-- 2) RPC create_order_v2 — bản sao của create_order + thêm p_pickup_time
-- ---------------------------------------------------------------------
-- Thân hàm giống HET create_order (đã dùng để chốt giá + tuỳ chọn),
-- chỉ khác 2 chỗ:
--   1) thêm tham số `p_pickup_time timestamptz default null`
--   2) insert giá trị đó vào `orders.pickup_time` và trả về trong JSON.
create or replace function public.create_order_v2(
  p_code            text,
  p_customer_name   text default '',
  p_customer_phone  text default '',
  p_customer_address text default '',
  p_table_no        text default '',
  p_note            text default '',
  p_items           jsonb default '[]'::jsonb,
  p_customer_token  text default '',
  p_payment_method  text default 'cash',
  p_item_options    jsonb default '[]'::jsonb,
  p_pickup_time     timestamptz default null
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
  v_payment     text := 'cash';
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

  -- --- Chuẩn hoá cách thanh toán: chỉ nhận 'transfer', còn lại thành 'cash' ---
  if lower(btrim(coalesce(p_payment_method, ''))) = 'transfer' then
    v_payment := 'transfer';
  else
    v_payment := 'cash';
  end if;

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
  -- price = giá gốc + TỔNG price_delta của các tuỳ chọn đã chọn
  --         (price_delta tra từ DB, KHÔNG tin giá client gửi lên).
  v_items := (
    select jsonb_agg(
      jsonb_build_object(
        'id',    m.id,
        'name',  coalesce(nullif(m.name, ''), nullif(e.item->>'name', ''), '(không rõ)'),
        'price', m.price + coalesce((
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
    table_no, note, total, status, payment_method, is_paid, pickup_time
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
    'new',
    v_payment,
    false,
    p_pickup_time
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
    'payment_method', v_payment,
    'is_paid', false,
    'pickup_time', p_pickup_time,
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

-- Quyền gọi hàm: khách (đặt món) + chủ quán.
-- `DO` block -> không phụ thuộc hình dạng hàm (xem giải thích ở migration khác).
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_order_v2'
  loop
    execute format('revoke all on function %s from public', r.oid::regprocedure);
    execute format('revoke all on function %s from anon', r.oid::regprocedure);
    execute format('grant execute on function %s to anon, authenticated', r.oid::regprocedure);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- -- Cột đã có chưa:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_time';
--
-- -- Hàm đã tồn tại chưa:
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('create_order','create_order_v2');
--
-- Kết quả mong đợi:
--   create_order     -> 10 tham số (KHÔNG đổi)
--   create_order_v2  -> 11 tham số (có p_pickup_time)
-- =====================================================================
