-- =====================================================================
-- VÁ LỖI GIÁ: tuỳ chọn không được cộng vào giá món
--
-- VÌ SAO LỖI:
--   Đoạn tính giá trong RPC create_order (bản tạo từ migration-options.sql
--   CŨ) dùng:
--
--     select sum(mio.price_delta)
--     from jsonb_array_elements(
--            coalesce(
--              (select jsonb_agg(eo->'options')      <-- LỖI Ở ĐÂY
--               from jsonb_array_elements(p_item_options) eo
--               where (eo->>'line')::int = e.idx),
--              '[]'::jsonb
--            )
--          ) as opts
--     cross join lateral jsonb_array_elements(opts) as o
--     left join public.menu_item_options mio
--       on mio.id::text = o->>'menuItemOptionId'
--
--   jsonb_agg(eo->'options') gom các mảng lại thành MẢNG LỒNG MẢNG:
--       [[{...},{...}]]
--   -> jsonb_array_elements(opts) cho ra phần tử là MẢNG, không phải object
--   -> o->>'menuItemOptionId' = NULL
--   -> left join không khớp -> sum(...) = NULL -> coalesce(..., 0) = 0
--   -> giá món = GIÁ GỐC, mất hết phần +5k / -5k của Size.
--
--   Kết quả: đơn "2x Size to + 1x Size nhỏ" ra 90.000đ thay vì 95.000đ.
--
-- CÁCH SỬA:
--   Bỏ jsonb_agg + lớp jsonb_array_elements bọc ngoài, dùng thẳng
--   jsonb_array_elements(eo->'options') cho entry đang xét.
--
-- CÁCH CHẠY:
--   Supabase Dashboard -> SQL Editor -> dán file này -> Run
--
-- Script idempotent: chạy lại nhiều lần vẫn cho kết quả đúng.
--
-- File này được SINH TỰ ĐỘNG từ supabase/migration-options.sql
-- (scripts/gen-fix-price.mjs): hàm create_order + khối revoke quyền
-- được copy NGUYÊN VĂN -> không bao giờ sót logic nào.
-- =====================================================================

-- Xoá hàm cũ trước.
-- "create or replace" KHÔNG cho đổi tên tham số đầu vào, nên nếu hàm đang
-- có trong DB dùng tên khác sẽ báo lỗi. "drop" cho an toàn.
-- Hàm không lưu dữ liệu nên drop không mất gì.
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
  -- Cách thanh toán khách chọn: 'cash' (tiền mặt) | 'transfer' (chuyển khoản).
  -- Server chuẩn hoá về 'cash' nếu giá trị lạ. Trạng thái ĐÃ THU TIỀN (is_paid)
  -- do CHỦ QUÁN tick tay sau khi nhận tiền / thấy thông báo ngân hàng.
  p_payment_method  text default 'cash',
  -- Tuỳ chọn khách chọn cho từng dòng món.
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
  -- payment_method chuẩn hoá: chỉ nhận 'transfer', còn lại thành 'cash'.
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
    case when lower(btrim(coalesce(p_payment_method, ''))) = 'transfer' then 'transfer' else 'cash' end,
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
    'payment_method', case when lower(btrim(coalesce(p_payment_method, ''))) = 'transfer' then 'transfer' else 'cash' end,
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
-- Kiểm tra sau khi chạy:
--   node scripts/test-order-price.mjs
-- Kết quả mong đợi:
--   Tổng MONG ĐỢI: 95.000 đ
--   Tổng THỰC TẾ: 95.000 đ
--   ✅ GIÁ ĐÚNG
-- ---------------------------------------------------------------------
