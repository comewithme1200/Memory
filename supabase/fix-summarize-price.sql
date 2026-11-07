-- =====================================================================
-- BỔ SUNG: `summarize_orders` trả về thêm đơn giá trung bình của món
--
-- VÌ SAO?
--   Trang "Tổng kết" cần sắp xếp: các món CÙNG TÊN phải nằm cạnh nhau,
--   và trong mỗi nhóm thì đơn giá TĂNG DẦN. Để làm được, client cần biết
--   đơn giá của từng dòng -> trước đây RPC chỉ trả `qty` + `revenue`.
--
-- THAY ĐỔI:
--   - Thêm khoá `price` (đơn giá trung bình = doanh thu / số lượng) vào mỗi
--     dòng trong `rows`.
--   - KHÔNG đổi tên hàm, KHÔNG đổi danh sách tham số, KHÔNG đổi kiểu trả về
--     -> client cũ vẫn chạy bình thường, chỉ là có thêm 1 khoá.
--   - Sắp xếp mặc định trong SQL vẫn theo `qty desc` (giữ nguyên hành vi cũ);
--     client sẽ sắp lại theo quy tắc mới.
--
-- AN TOÀN DỮ LIỆU: hàm không ghi gì -> không ảnh hưởng dữ liệu.
-- Script idempotent: chạy lại nhiều lần vẫn đúng.
-- =====================================================================

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
      sum(oi.qty * oi.price_snapshot)::bigint as revenue,
      -- Đơn giá trung bình (làm tròn về đồng) để client sắp xếp tăng dần.
      case when sum(oi.qty) > 0
           then round(sum(oi.qty * oi.price_snapshot)::numeric / sum(oi.qty))::bigint
           else 0 end as price
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
            'revenue', revenue,
            'price', price
          ) order by qty desc
        ) from agg),
      '[]'::jsonb
    ),
    'totalQty',     coalesce((select sum(qty) from agg), 0),
    'totalRevenue', coalesce((select sum(total) from filtered), 0),
    'orderCount',   (select count(*) from filtered)
  );
$$;

-- Quyền: CHỈ chủ quán (authenticated). `anon` KHÔNG được xem doanh thu.
-- `DO` block -> không phụ thuộc hình dạng hàm.
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
-- Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- SELECT * from public.summarize_orders();
-- -> mỗi dòng trong `rows` có thêm khoá "price".
-- =====================================================================
