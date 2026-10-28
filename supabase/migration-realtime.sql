-- =====================================================================
-- Realtime: đẩy đơn mới lên trang quản trị NGAY, không cần reload
--
-- VÌ SAO CẦN?
-- Trước đây trang "Đơn hàng" tự làm mới mỗi 15s. Nhưng:
--   - 15s là lâu khi bếp đang chờ (khách gọi mà chủ quán chưa thấy)
--   - hoặc ngắn hơn thì tốn băng thông và bị giới hạn rate-limit
-- Với Realtime của Supabase, đơn mới được ĐẨY tới trình duyệt ngay
-- khi có bản ghi mới -> không cần reload, không cần polling.
--
-- CÁCH HOẠT ĐỘNG
--   1) Thêm bảng `orders` vào publication `supabase_realtime`.
--   2) Client đăng ký `supabase.channel('orders').on('postgres_changes', ...)`
--      -> nhận payload khi có INSERT/UPDATE/DELETE.
--   3) Trang quản trị tự nạp lại danh sách đơn khi nhận được tín hiệu.
--
-- BẢO MẬT
--   Realtime chạy qua WebSocket và VẪN bị RLS áp dụng: chỉ tài khoản
--   `authenticated` (chủ quán đã đăng nhập) mới nhận được sự kiện của bảng
--   `orders`. Khách (anon) không có policy đọc `orders` -> không nhận được
--   gì, cũng không đọc được nội dung đơn.
--
-- AN TOÀN DỮ LIỆU
--   - Không xoá bảng/dữ liệu nào.
--   - Script chạy được nhiều lần (idempotent).
--
-- CÁCH CHẠY
--   Supabase Dashboard -> SQL Editor -> New query -> dán file này -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bảng `orders` phải có REPLICA IDENTITY FULL
--
-- Vì sao: Realtime gửi payload là bản ghi ĐẦY ĐỦ của dòng vừa thay đổi.
-- Mặc định Postgres chỉ gửi các cột KHÓA (REPLICA IDENTITY DEFAULT) -> client
-- chỉ nhận được `id`, phải gọi thêm 1 request để lấy nội dung -> chậm và
-- tốn băng thông. `FULL` khiến payload có đủ thông tin ngay.
-- ---------------------------------------------------------------------
alter table public.orders replica identity full;

-- ---------------------------------------------------------------------
-- 2) Đưa bảng `orders` vào publication `supabase_realtime`
--
-- `supabase_realtime` là publication mặc định của Supabase, tự tồn tại.
-- Dùng `drop ... if exists` trước để chạy lại không bị lỗi trùng.
-- ---------------------------------------------------------------------
do $$
begin
  -- Bảng `orders` đã nằm trong publication -> không cần làm gì.
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    raise notice 'Bảng public.orders đã bật Realtime.';
    return;
  end if;

  -- Publication chưa tồn tại (hiếm gặp) -> tạo mới.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  alter publication supabase_realtime add table public.orders;
  raise notice 'Đã bật Realtime cho bảng public.orders.';
end
$$;

-- ---------------------------------------------------------------------
-- 3) Chỉ admin được nhận sự kiện Realtime của bảng `orders`
--
-- Supabase kiểm tra RLS khi gửi sự kiện: client chỉ nhận sự kiện cho các
-- dòng mà RLS cho phép đọc. Policy `orders admin all` (to authenticated)
-- đã có sẵn trong schema.sql -> chủ quán đăng nhập nhận được, khách thì không.
--
-- Nhưng để chắc chắn (và để chủ quán đọc được ngay cả khi policy bị lỡ),
-- ta tạo policy riêng cho `select` với `authenticated`.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders realtime read'
  ) then
    raise notice 'Policy "orders realtime read" đã tồn tại.';
  else
    create policy "orders realtime read" on public.orders
      for select to authenticated
      using (true);
    raise notice 'Đã tạo policy "orders realtime read".';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4) Xác nhận
--
-- LƯU Ý: `pg_publication_tables.attnames` là kiểu MẢNG text (danh sách cột
-- được publish), KHÔNG phải `attname` (kiểu text đơn). Sai tên cột -> lỗi:
--   ERROR: 42703: column pt.attname does not exist
-- ---------------------------------------------------------------------
select
  p.pubname                             as publication,
  pt.schemaname || '.' || pt.tablename   as bang,
  pt.attnames                           as cot_dc_publish,
  p.pubinsert,
  p.pubupdate,
  p.pubdelete
from pg_publication p
join pg_publication_tables pt on pt.pubname = p.pubname
where pt.tablename = 'orders';

-- Kiểm tra `replica identity` của bảng `orders`.
-- Giá trị mong đợi: 'f' (FULL). Nếu là 'd' (DEFAULT) thì payload Realtime
-- chỉ có cột khoá -> client phải gọi thêm API mới lấy được nội dung đơn.
select
  c.relname                                as bang,
  case c.relreplident
    when 'd' then 'DEFAULT'
    when 'f' then 'FULL'
    when 'i' then 'INDEX'
    when 'n' then 'NOTHING'
  end                                     as replica_identity,
  case c.relreplident
    when 'f' then 'OK - payload day du'
    else 'CANH BAO - payload chi co cot khoa'
  end                                     as ket_luan
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relname = 'orders'
  and n.nspname = 'public';
