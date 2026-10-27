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
  and tablename in ('menu_items', 'orders')
order by tablename, cmd, policyname;

-- 2) Xoá các đơn do script kiểm tra tạo ra
delete from public.orders
where note in (
  'CHECK-SCRIPT-MARKER',
  'AUTO-CHECK',
  'RB-TEST',
  'RBK-TEST',
  'BUG-TEST',
  'DIAG don kiem tra tu dong',
  'DIAG don kiem tra tu dong DIAG123',
  'Test tự động'
)
   or code like 'CHK%'
   or code like 'DIA%'
   or code like 'DIB%'
   or code like 'DIC%'
   or code like 'RB%'
   or code like 'BUG%'
   or code like 'APP%'
   or customer_name = 'Kiem tra tu dong'
   or customer_name = 'diag'
   or customer_name = 'diag a'
   or customer_name = 'diag b'
   or customer_name = 'diag c'
   or customer_name = 'Khách Test App'
   or customer_name = 'rollback-test'
   or customer_name = 'cleanup'
   or customer_name like 'Nguyễn Test%'
   or customer_name like 'Nguyen Test%';

-- 3) Xoá món rác do script tạo (nếu còn)
delete from public.menu_items
where category = '__probe__'
   or name = '__don_kiem_tra_xoa_ngay__'
   or name = 'DIAG ITEM'
   or name = 'HACK TEST';

-- 4) Kiểm tra lại
select
  (select count(*) from public.menu_items) as so_mon,
  (select count(*) from public.orders)     as so_don,
  (select count(*) from public.orders where note = 'CHECK-SCRIPT-MARKER') as don_check_con_lai;
