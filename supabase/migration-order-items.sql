-- =====================================================================
-- Migration: tách quan hệ nhiều-nhiều orders <-> menu_items
--
-- Bối cảnh
--   Trước đây các món trong đơn được lưu dạng JSONB trong cột
--   `orders.items` (mảng { id, name, price, qty, note }).
--   -> DB không biết quan hệ nhiều-nhiều, không có khóa ngoại,
--      và `summarize()` phải tải TOÀN BỘ đơn về JS rồi gom trong JS.
--
-- Sau migration
--   - Bảng trung gian `order_items` chứa từng dòng món của từng đơn.
--   - `orders.items` (JSONB) được giữ lại làm CỐT LƯU (legacy), KHÔNG ghi nữa.
--   - Tạo đơn dùng RPC `create_order(...)` -> ghi orders + order_items trong
--     MỘT transaction (không còn trường hợp đơn vào nhưng không có món).
--   - Tổng kết dùng RPC `summarize_orders(...)` -> GROUP BY trong SQL,
--     không tải đơn về máy khách.
--
-- AN TOÀN DỮ LIỆU
--   - Không xoá cột `orders.items`. Sau khi chạy script này, mọi đơn cũ vẫn
--     đọc được từ JSONB nếu cần rollback.
--   - Cột `orders.items` vẫn để nguyên giá trị cũ (không ghi đè).
--
-- CÁCH CHẠY
--   Supabase Dashboard -> SQL Editor -> New query -> dán file này -> Run.
--   Script chạy được nhiều lần (idempotent): dữ liệu cũ chỉ được migrate
--   1 lần, các đơn đã có `order_items` sẽ không bị nhân bản.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bảng trung gian order_items
-- ---------------------------------------------------------------------
-- `name_snapshot` / `price_snapshot` là BẢN CHỤP lúc khách đặt món.
-- Không join lấy từ `menu_items` — nếu không, việc sửa giá món sau này
-- sẽ làm sai lịch sử doanh thu và hoá đơn đã in.
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  -- Liên kết tới món trong thực đơn. NULL nếu món đã bị xoá khỏi thực đơn
  -- (đơn cũ vẫn giữ nguyên tên/giá đã chốt).
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  name_snapshot text        not null default '',
  price_snapshot integer    not null default 0,
  qty           integer    not null default 1 check (qty > 0),
  note          text        default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_item  on public.order_items (menu_item_id);

comment on table public.order_items is
  'Dòng món của từng đơn (bảng trung gian cho quan hệ nhiều-nhiều orders <-> menu_items). name_snapshot/price_snapshot là bản chụp lúc đặt món.';
comment on column public.order_items.menu_item_id is
  'NULL nếu món đã bị xoá khỏi thực đơn — đơn cũ vẫn giữ đúng tên/giá đã chốt.';
comment on column public.orders.items is
  'LEGACY: JSONB cũ, giữ lại để rollback. Từ migration này, món nằm ở bảng order_items.';

-- ---------------------------------------------------------------------
-- 2) RLS cho order_items
-- ---------------------------------------------------------------------
alter table public.order_items enable row level security;

drop policy if exists "order_items public read"    on public.order_items;
drop policy if exists "order_items public insert"  on public.order_items;
drop policy if exists "order_items public update"  on public.order_items;
drop policy if exists "order_items public delete"  on public.order_items;
drop policy if exists "order_items admin all"      on public.order_items;

-- KHÁCH (anon): KHÔNG có policy nào cho order_items.
--   - Không đọc được (không lộ đơn của quán)
--   - Không ghi trực tiếp được (chỉ ghi qua RPC create_order, đã kiểm tra
--     và chuẩn hoá dữ liệu bên trong hàm)
--
-- CHỦ QUÁN (authenticated): đọc/ghi/xoá để quản trị đơn.
create policy "order_items admin all" on public.order_items
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------
-- 3) RPC create_order — ghi đơn + dòng món trong MỘT transaction
-- ---------------------------------------------------------------------
-- Vì sao cần RPC?
--   PostgREST không có transaction cho nhiều bảng: nếu app insert `orders`
--   rồi insert `order_items` bằng 2 lệnh riêng, lệnh thứ 2 hỏng thì đơn
--   đã tồn tại nhưng không có món nào -> bếp không thấy gì để làm.
--   Hàm `security definer` chạy trong 1 transaction nên không có trạng thái
--   nửa vời.
--
-- HÀM TRẢ VỀ JSONB (không phải uuid) vì cần trả cả TỔNG TIỀN đã tính ở server.
--   Nếu trả về uuid, client phải tự tính tổng từ giá nó gửi lên -> khi giá
--   trong thực đơn đã đổi so với lúc khách mở trang, màn hình "đặt món
--   thành công" sẽ hiện sai số tiền.
--
-- ĐỔI KIỂU TRẢ VỀ (uuid -> jsonb) KHÔNG dùng được `create or replace`,
-- nên phải `drop` hàm cũ trước. `drop` không mất dữ liệu (hàm không lưu data).
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
  -- Giá & tên lấy từ bảng `menu_items` (giá tại thời điểm đặt). Chỉ khi món
  -- KHÔNG tồn tại trong thực đơn mới fallback sang giá client gửi lên.
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
  -- menu_item_id chỉ được gán nếu món thực sự tồn tại trong thực đơn,
  -- nếu không thì để NULL (không vi phạm khóa ngoại).
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

-- Chỉ khách và chủ quán được gọi hàm này.
-- LƯU Ý: tên hàm kèm kiểu trả về là `jsonb` (đã đổi từ `uuid`).
revoke all on function public.create_order(text, text, text, text, text, jsonb) from public;
revoke all on function public.create_order(text, text, text, text, text, jsonb) from anon;
-- Overload 0 tham số (do các tham số có `default`) — cũng phải gỡ quyền
-- khỏi `public` cho khớp, nhưng VẪN cấp cho `anon` (khách cần đặt món).
revoke all on function public.create_order() from public;
grant execute on function public.create_order(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_order() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) RPC summarize_orders — tổng kết bằng SQL, không tải đơn về JS
-- ---------------------------------------------------------------------
create or replace function public.summarize_orders(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select o.id, o.total
    from public.orders o
    where o.status <> 'cancelled'
      and (p_from is null or o.created_at >= p_from)
      and (p_to   is null or o.created_at <= p_to)
  ),
  agg as (
    select
      oi.menu_item_id,
      oi.name_snapshot as name,
      sum(oi.qty)::bigint as qty,
      sum(oi.qty * oi.price_snapshot)::bigint as revenue
    from public.order_items oi
    join filtered f on f.id = oi.order_id
    group by oi.menu_item_id, oi.name_snapshot
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(
          jsonb_build_object(
            'id', menu_item_id,
            'name', name,
            'qty', qty,
            'revenue', revenue
          ) order by qty desc
        ) from agg),
      '[]'::jsonb
    ),
    'totalQty',     coalesce((select sum(qty) from agg), 0),
    'totalRevenue', coalesce((select sum(total) from filtered), 0),
    'orderCount',   (select count(*) from filtered)
  );
$$;

-- Chỉ CHỦ QUÁN được xem tổng kết (khách không được biết doanh thu).
-- PHẢI revoke cho `anon` riêng: `revoke ... from public` KHÔNG đủ, vì `anon`
-- là thành viên của `public` -> vẫn gọi được hàm và đọc được doanh thu.
revoke all on function public.summarize_orders(timestamptz, timestamptz) from public;
revoke all on function public.summarize_orders(timestamptz, timestamptz) from anon;
-- Overload 0 tham số (do các tham số có `default`) cũng phải bị gỡ quyền.
revoke all on function public.summarize_orders() from public;
revoke all on function public.summarize_orders() from anon;
grant execute on function public.summarize_orders(timestamptz, timestamptz) to authenticated;
grant execute on function public.summarize_orders() to authenticated;

-- ---------------------------------------------------------------------
-- 5) Migrate dữ liệu cũ từ JSONB sang order_items
-- ---------------------------------------------------------------------
-- Chỉ migrate những đơn CHƯA có dòng món nào -> chạy lại script không
-- tạo bản sao.
insert into public.order_items (
  order_id, menu_item_id, name_snapshot, price_snapshot, qty, note
)
select
  o.id,
  (select m.id from public.menu_items m
    where lower(m.id::text) = lower(e->>'id') limit 1),
  coalesce(nullif(e->>'name', ''), '(không rõ)'),
  greatest(0, case when (e->>'price') ~ '^-?[0-9]+$' then (e->>'price')::int else 0 end),
  greatest(1, case when (e->>'qty') ~ '^-?[0-9]+$' then (e->>'qty')::int else 1 end),
  left(coalesce(e->>'note', ''), 200)
from public.orders o
cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as e
where not exists (select 1 from public.order_items oi where oi.order_id = o.id);

-- ---------------------------------------------------------------------
-- 6) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- SELECT count(*) AS orders,
--        (select count(*) from public.order_items) AS order_items_rows
--   FROM public.orders;
--
-- Hai số trên phải BẰNG NHAU (mỗi đơn có ít nhất 1 dòng món).
-- Nếu lệch, thường do đơn cũ có `items` rỗng -> xoá tay bằng:
--   DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE items = '[]'::jsonb);
