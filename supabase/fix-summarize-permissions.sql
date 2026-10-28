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
revoke all on function public.summarize_orders(timestamptz, timestamptz) from public;
revoke all on function public.summarize_orders(timestamptz, timestamptz) from anon;
revoke all on function public.summarize_orders() from public;
revoke all on function public.summarize_orders() from anon;

-- Chỉ chủ quán (đã đăng nhập) được gọi
grant execute on function public.summarize_orders(timestamptz, timestamptz) to authenticated;
grant execute on function public.summarize_orders() to authenticated;

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
