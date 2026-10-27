-- =====================================================================
-- Quán Ăn Sáng — schema Supabase (PostgreSQL)
-- Chạy trong: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Bảo mật: chỉ tài khoản đã ĐĂNG NHẬP mới được sửa món / xem & sửa đơn.
-- Khách chỉ được XEM thực đơn và TẠO đơn.
-- =====================================================================

-- 1) Bảng món ăn
create table if not exists public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  price       integer     not null default 0,
  description text        default '',
  category    text        default '',
  is_available boolean    not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- 2) Bảng đơn hàng
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null,
  customer_name text        default '',
  customer_phone text       default '',
  table_no      text        default '',
  note          text        default '',
  items         jsonb       not null default '[]'::jsonb,
  total         integer     not null default 0,
  status        text        not null default 'new',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_status      on public.orders (status);

-- 3) Bật RLS (Row Level Security)
alter table public.menu_items enable row level security;
alter table public.orders     enable row level security;

-- 4) Xoá sạch policy cũ (cho phép chạy lại script nhiều lần)
drop policy if exists "menu_items public read"   on public.menu_items;
drop policy if exists "menu_items public insert" on public.menu_items;
drop policy if exists "menu_items public update" on public.menu_items;
drop policy if exists "menu_items public delete" on public.menu_items;
drop policy if exists "menu_items admin all"    on public.menu_items;
drop policy if exists "orders public insert"     on public.orders;
drop policy if exists "orders public select"     on public.orders;
drop policy if exists "orders public update"     on public.orders;
drop policy if exists "orders public delete"     on public.orders;
drop policy if exists "orders admin all"        on public.orders;

-- ---------------- MENU_ITEMS ----------------
-- Khách (anon) chỉ được XEM thực đơn
create policy "menu_items public read" on public.menu_items
  for select to anon using (true);

-- Chủ quán (đã đăng nhập) được thêm/sửa/xoá món
create policy "menu_items admin all" on public.menu_items
  for all to authenticated
  using (true) with check (true);

-- ---------------- ORDERS ----------------
-- Khách (anon) chỉ được TẠO đơn, KHÔNG được xem danh sách đơn của quán
create policy "orders public insert" on public.orders
  for insert to anon with check (true);

-- Chủ quán (đã đăng nhập) được xem / sửa trạng thái / xoá đơn
create policy "orders admin all" on public.orders
  for all to authenticated
  using (true) with check (true);

-- 5) Dữ liệu món mẫu (chỉ chèn nếu bảng còn trống)
insert into public.menu_items (name, price, description, category, sort_order)
select * from (values
  ('Phở bò tái',      30000, 'Nước dùng ngọt thanh, thịt bò mềm',    'Món chính',  1),
  ('Bún bò Huế',     32000, 'Nước dùng đặc trưng, cay nhẹ',         'Món chính',  2),
  ('Cơm tấm đầy đủ', 28000, 'Cơm tấm, trứng chiên, lạc, dưa leo',   'Món chính',  3),
  ('Bánh mì ốp la',  15000, 'Trứng, pate, rau củ, dưa leo giòn',      'Món nhanh',  4),
  ('Cà phê đen đá',  12000, 'Cà phê pha phin truyền thống',          'Nước uống', 5),
  ('Nước mía',       10000, 'Nước mía tươi, đá lạnh',                'Nước uống', 6)
) as v(name, price, description, category, sort_order)
where not exists (select 1 from public.menu_items);

-- =====================================================================
-- 6) TẠO TÀI KHOẢN CHỦ QUÁN
-- =====================================================================
-- Cách 1 (khuyến nghị): Supabase Dashboard -> Authentication -> Users
--     -> "Add user" -> "Create new user" -> điền email + mật khẩu.
--
-- Cách 2 (chạy SQL): thay địa chỉ email + mật khẩu rồi bỏ comment dòng dưới.
-- CREATE USER 'chuquan@example.com' WITH PASSWORD 'mat-khau-cua-ban';
--
-- Lưu ý: nếu dự án bật "Confirm email" (mặc định), tài khoản mới tạo phải
-- xác nhận email trước khi đăng nhập được. Tắt trong:
-- Authentication -> Sign In / Providers -> Email -> bỏ tick "Confirm email".
-- =====================================================================