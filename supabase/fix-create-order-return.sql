-- =====================================================================
-- FIX: đổi RPC create_order trả về `uuid` -> `jsonb`
--
-- VẤN ĐỀ
--   Bản đầu tiên của `create_order` trả về `uuid` (id đơn). Client phải tự
--   tính lại tổng tiền từ giá nó gửi lên -> khi giá trong thực đơn đã đổi so
--   với lúc khách mở trang, màn hình "Đặt món thành công" hiện SAI số tiền
--   (khác với tổng đã lưu trong DB).
--
--   Cần server trả về cả `total` (đã tính từ `menu_items`) và mảng `items`
--   đã chốt, để client hiển thị khớp 100% với dữ liệu lưu trong DB.
--
-- SỬA
--   1. `drop` hàm cũ (bắt buộc — `create or replace` không đổi được kiểu
--      trả về). Hàm không lưu dữ liệu nên drop an toàn.
--   2. Tạo lại hàm với `returns jsonb`, trả về { id, code, total, items }.
--   3. Cấp lại quyền EXECUTE cho `anon` + `authenticated`.
--
-- AN TOÀN
--   - Không đụng tới bảng `orders` / `order_items`.
--   - Đơn đã tạo trước đây không bị ảnh hưởng.
--   - Client tự phát hiện hình dạng trả về (uuid cũ vs jsonb mới) nên vẫn
--     chạy được với cả hai phiên bản hàm.
-- =====================================================================

drop function if exists public.create_order(text, text, text, text, text, jsonb);
drop function if exists public.create_order();

create or replace function public.create_order(
  p_code           text,
  p_customer_name  text default '',
  p_customer_phone text default '',
  p_table_no       text default '',
  p_note           text default '',
  p_items          jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_total    integer := 0;
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
    id, code, customer_name, customer_phone, table_no, note, total, status
  ) values (
    v_order_id,
    btrim(p_code),
    left(coalesce(p_customer_name, ''), 200),
    left(coalesce(p_customer_phone, ''), 50),
    left(coalesce(p_table_no, ''), 50),
    left(coalesce(p_note, ''), 500),
    v_total,
    'new'
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

-- Quyền: khách (đặt món) + chủ quán
revoke all on function public.create_order(text, text, text, text, text, jsonb) from public;
revoke all on function public.create_order(text, text, text, text, text, jsonb) from anon;
revoke all on function public.create_order() from public;
grant execute on function public.create_order(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_order() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- SELECT p.proname,
--        pg_get_function_result(p.oid) as returns,
--        ARRAY(SELECT r.rolname FROM pg_roles r
--              WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) as can_execute
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'create_order';
--
-- Kết quả mong đợi:
--   returns = jsonb
--   can_execute = {anon, authenticated}
-- =====================================================================
