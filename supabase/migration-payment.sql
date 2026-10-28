-- =====================================================================
-- Migration: THANH TOÁN (payment) — tiền mặt / chuyển khoản + đã thu tiền
--
-- Tính năng
--   1. Khách chọn cách thanh toán khi đặt món:
--        'cash'     -> tiền mặt (mặc định)
--        'transfer' -> chuyển khoản -> app hiện QR ngân hàng để khách quét
--   2. Chủ quán tick "Đã thanh toán" sau khi nhận tiền / thấy báo ngân hàng.
--
-- Cột mới trên `orders`:
--   payment_method text    not null default 'cash'   -- 'cash' | 'transfer'
--   is_paid        boolean not null default false    -- chủ quán tick tay
--
-- RPC `create_order` lên 10 tham số (thêm p_payment_method ở CUỐI để các
-- app cũ gọi 9 tham số vẫn chạy được nhờ `default`).
--
-- AN TOÀN DỮ LIỆU
--   - Chỉ ADD COLUMN IF NOT EXISTS -> chạy lại nhiều lần không mất dữ liệu.
--   - Đơn cũ tự nhận payment_method='cash', is_paid=false.
--
-- CÁCH CHẠY
--   Supabase Dashboard -> SQL Editor -> New query -> dán file này -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Thêm cột (nếu chưa có)
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_method text not null default 'cash';

alter table public.orders
  add column if not exists is_paid boolean not null default false;

comment on column public.orders.payment_method is
  'Cách thanh toán khách chọn: cash (tiền mặt) | transfer (chuyển khoản).';
comment on column public.orders.is_paid is
  'Chủ quán tick tay sau khi nhận tiền / thấy thông báo ngân hàng.';

-- ---------------------------------------------------------------------
-- 2) Nâng cấp RPC `create_order` — nhận p_payment_method, trả kèm thanh toán
-- ---------------------------------------------------------------------
-- ĐỔI DANH SÁCH THAM SỐ -> phải `drop` hàm cũ trước (PostgreSQL không cho
-- `create or replace` đổi kiểu trả về / danh sách tham số).
-- Hàm không lưu dữ liệu nên drop an toàn.
-- Bản trong DB hiện tại là 9 tham số (bản options) — drop đúng chữ ký đó.
drop function if exists public.create_order(text, text, text, text, text, text, jsonb, text, jsonb);

create or replace function public.create_order(
  p_code            text,
  p_customer_name   text default '',
  p_customer_phone  text default '',
  p_customer_address text default '',
  p_table_no        text default '',
  p_note            text default '',
  p_items           jsonb default '[]'::jsonb,
  p_customer_token  text default '',
  -- Cách thanh toán khách chọn: 'cash' | 'transfer'.
  -- Server chuẩn hoá về 'cash' nếu giá trị lạ. Trạng thái ĐÃ THU TIỀN (is_paid)
  -- do CHỦ QUÁN tick tay sau khi nhận tiền / thấy thông báo ngân hàng.
  p_payment_method  text default 'cash',
  -- Tuỳ chọn khách chọn cho từng dòng món.
  -- Định dạng: [{ "line": 1, "options": [
  --   { "optionId": "<uuid>", "menuItemOptionId": "<uuid>",
  --     "name": "Size to", "priceDelta": 5000 } ] }]
  -- `line` = số thứ tự dòng món trong p_items (bắt đầu từ 1, theo
  -- `with ordinality` của Postgres).
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
    table_no, note, total, status, payment_method, is_paid
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
    false
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
    'payment_method', v_payment,
    'is_paid', false,
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
-- 3) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- -- Cột đã có
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='orders'
--     AND column_name in ('payment_method','is_paid');
--
-- -- RPC đã có 10 tham số
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.proname='create_order';
-- =====================================================================
