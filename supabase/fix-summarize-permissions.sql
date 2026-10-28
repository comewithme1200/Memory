-- =====================================================================
-- FIX: siết quyền RPC summarize_orders
--
-- VẤN ĐỀ PHÁT HIỆN
--   Khách (anon) gọi được `summarize_orders` -> đọc được doanh thu, số
--   đơn và số lượng bán của quán. Đây là rò rỉ dữ liệu kinh doanh.
--
--   Nguyên nhân: hàm được tạo với quyền EXECUTE mặc định cho role `public`
--   (mọi role, gồm cả anon). Lệnh `revoke ... from public` trong file
--   migration chưa được áp dụng cho hàm này.
--
-- SỬA
--   1. Gỡ quyền EXECUTE khỏi `public` và `anon`.
--   2. Chỉ cấp quyền cho `authenticated` (chủ quán đã đăng nhập).
--   3. Xử lý CẢ hai overload của hàm (bản 2 tham số và bản 0 tham số
--      do có `default`), tránh sót lỗ hổng.
--
-- KIỂM TRA SAU KHI CHẠY
--   Chạy lại `node scripts/check-supabase.mjs` -> phần "KHÔNG được xem
--   tổng kết" phải báo OK.
-- =====================================================================

-- Gỡ quyền khỏi mọi role (kể cả anon)
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
-- các câu lệnh phía sau không được chạy. Đó là lý do file này trước đây
-- chạy mà không có tác dụng gì.
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
-- Kiểm tra nhanh (chạy trong SQL Editor)
-- ---------------------------------------------------------------------
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        p.prosecdef AS security_definer,
--        ARRAY(SELECT r.rolname FROM pg_roles r
--              WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) AS can_execute
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname in ('summarize_orders','create_order');
--
-- Kết quả mong đợi:
--   summarize_orders -> can_execute = {authenticated}   (KHÔNG có anon, public)
--   create_order     -> can_execute = {anon, authenticated}
--
-- ---------------------------------------------------------------------
-- Ghi chú thêm: `create_order` CỐ TÌNH cho phép anon gọi, vì khách cần
-- đặt món. Hàm này đã tự kiểm tra đầu vào, chuẩn hoá dữ liệu và TÍNH LẠI
-- tổng tiền từ bảng `menu_items` (không tin giá do client gửi lên).
-- =====================================================================
