-- =====================================================================
-- Migration: trạng thái đơn "hết hạn" (expired) + tổng kết chỉ tính đơn hôm nay
--
-- BỐI CẢNH
--   Trước đây đơn bị bỏ lửng ở trạng thái `new` / `preparing` mãi mãi nếu
--   chủ quán không xử lý (khách đặt rồi quán đóng cửa, mạng đứt...).
--   Sang ngày hôm sau, những đơn đó vẫn hiện trong bảng "🔥 Món cần làm"
--   -> bếp tưởng còn món phải làm -> làm thừa.
--
-- SAU MIGRATION NÀY
--   1) Thêm trạng thái mới: `expired` (hết hạn).
--      Client tự động chuyển các đơn `new`/`preparing` tạo trước nửa đêm
--      hôm nay sang `expired` khi mở trang "Đơn hàng" (xem `expireStaleOrders`
--      trong `src/lib/db.js`).
--
--   2) RPC `summarize_orders` bỏ qua đơn `expired` (giống đơn `cancelled`)
--      -> doanh thu / suất bán không tính nhầm đơn đã hết hạn.
--
-- AN TOÀN DỮ LIỆU
--   - Không xoá bảng/dữ liệu nào.
--   - Script chạy được nhiều lần (idempotent).
--
-- CÁCH CHẠY
--   Supabase Dashboard -> SQL Editor -> New query -> dán file này -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Index phục vụ truy vấn "đơn hôm nay" + "đơn quá khứ chưa xong"
--
-- Trang "Đơn hàng" luôn lọc theo khoảng thời gian trong ngày, và lệnh
-- expire lọc theo `created_at < hôm nay` + `status in ('new','preparing')`.
-- Index phức hợp giúp cả hai nhanh hơn khi bảng `orders` đã lớn.
-- ---------------------------------------------------------------------
create index if not exists idx_orders_status_created_at
  on public.orders (status, created_at desc);

-- ---------------------------------------------------------------------
-- 2) RPC summarize_orders — bỏ qua đơn đã huỷ VÀ đã hết hạn
--
-- `create or replace function` dùng được khi chỉ đổi THÂN hàm (không đổi
-- chữ ký) -> an toàn, không cần drop.
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
    where o.status not in ('cancelled', 'expired')
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

-- Quyền: chỉ CHỦ QUÁN được xem tổng kết (khách không được biết doanh thu).
--
-- ⚠️ VÌ SAO DÙNG `DO` BLOCK?
--
-- PostgreSQL KHÔNG tạo hàm overload 0-tham-số cho các tham số có `default`.
-- `create function summarize_orders(p_from timestamptz default null, p_to timestamptz default null)`
-- tạo ra ĐÚNG MỘT hàm với 2 tham số. Do đó câu lệnh:
--
--     revoke all on function public.summarize_orders() from public;
--
-- sẽ báo lỗi "function public.summarize_orders() does not exist" — và vì
-- Supabase chạy file trong 1 transaction, lỗi đó làm HỎNG CẢ FILE:
-- các câu lệnh phía sau không được chạy.
--
-- `DO` block duyệt `pg_proc` nên chạy được với mọi hình dạng hàm.
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
-- 3) Dọn dẹp 1 lần: các đơn quá khứ còn bỏ lửng -> chuyển sang 'expired'
--
-- Mốc "hôm nay" tính theo GIỜ VIỆT NAM (Asia/Ho_Chi_Minh) — cùng múi giờ
-- mà app dùng ở máy chủ quán. So sánh trực tiếp trên trục giờ địa phương
-- để không phụ thuộc `timezone` của session Postgres.
--
-- Chạy SAU khi app đã deploy (để app không phải expire lại). Idempotent.
-- ---------------------------------------------------------------------
update public.orders
   set status = 'expired',
       completed_at = coalesce(completed_at, now())
 where status in ('new', 'preparing')
   and (created_at at time zone 'Asia/Ho_Chi_Minh')::date
       < (now() at time zone 'Asia/Ho_Chi_Minh')::date;

-- ---------------------------------------------------------------------
-- 4) Kiểm tra sau khi chạy
-- ---------------------------------------------------------------------
-- SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY status;
--
-- Kết quả mong muốn: không còn đơn `new`/`preparing` có `created_at` từ
-- hôm trước trở đi.
-- ---------------------------------------------------------------------
