-- =====================================================================
-- Dọn rác dữ liệu kiểm tra + xem policy hiện tại
--
-- Chạy trong: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Chạy được nhiều lần, không ảnh hưởng dữ liệu thật.
-- =====================================================================

-- 1) Xem các policy đang có (để đối chiếu với schema.sql)
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('menu_items', 'orders', 'order_items')
order by tablename, cmd, policyname;

-- 1b) Xem quyền EXECUTE của các RPC (quan trọng cho bảo mật)
--     `summarize_orders` KHÔNG được có `anon` trong danh sách.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  ARRAY(
    SELECT r.rolname FROM pg_roles r
    WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')
  ) as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('summarize_orders', 'create_order')
order by p.proname, args;

-- 2) Xoá các đơn do script kiểm tra tạo ra
delete from public.orders
where note in (
  'CHECK-SCRIPT-MARKER',
  'CHECK-RPC-MARKER',
  'TEST-SCRIPT-MARKER',
  'AUTO-CHECK',
  'RB-TEST',
  'RBK-TEST',
  'BUG-TEST',
  'DIAG don kiem tra tu dong',
  'DIAG don kiem tra tu dong DIAG123',
  'Test tự động'
)
   or code like 'CHK%'
   or code like 'RPC%'
   or code like 'TST%'
   or code like 'DIA%'
   or code like 'DIB%'
   or code like 'DIC%'
   or code like 'RB%'
   or code like 'BUG%'
   or code like 'APP%'
   or customer_name = 'Kiem tra tu dong'
   or customer_name = 'Kiem tra RPC'
   or customer_name = 'Test fallback'
   or customer_name = 'Test RPC'
   or customer_name = 'diag'
   or customer_name = 'diag a'
   or customer_name = 'diag b'
   or customer_name = 'diag c'
   or customer_name = 'Khách Test App'
   or customer_name = 'rollback-test'
   or customer_name = 'cleanup'
   or customer_name like 'Nguyễn Test%'
   or customer_name like 'Nguyen Test%';
-- (order_items tự xoá theo do ON DELETE CASCADE)

-- 3) Xoá món rác do script tạo (nếu còn)
delete from public.menu_items
where category = '__probe__'
   or name = '__don_kiem_tra_xoa_ngay__'
   or name = 'DIAG ITEM'
   or name = 'HACK TEST';

-- 4) Kiểm tra lại
select
  (select count(*) from public.menu_items)   as so_mon,
  (select count(*) from public.orders)       as so_don,
  (select count(*) from public.order_items)  as so_dong_mon,
  (select count(*) from public.orders where note = 'CHECK-SCRIPT-MARKER') as don_check_con_lai;
