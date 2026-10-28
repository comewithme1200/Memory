-- =====================================================================
-- Seed dữ liệu mẫu cho TUỲ CHỌN MÓN (kiểu GrabFood)
--
-- CÁCH CHẠY:
--   Supabase Dashboard -> SQL Editor -> dán toàn bộ file này -> Run
--   (chạy trực tiếp trong SQL Editor = quyền postgres, KHÔNG bị RLS chặn)
--
-- Script idempotent: chạy lại nhiều lần không tạo trùng.
--
-- Tạo:
--   Nhóm "Size"    (chọn 1): Size to +5k / Size vừa 0 / Size nhỏ -5k
--   Nhóm "Topping" (chọn nhiều): Thêm trứng +3k / Thêm gà +8k
--   Nhóm "Mức cay" (chọn 1): Cay / Vừa / Không cay
--
-- Gắn vào món: Xôi thập cẩm, Bánh mì, Mì trộn (Size bắt buộc + Topping).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Nhóm tuỳ chọn (dùng chung cho nhiều món)
-- ---------------------------------------------------------------------
insert into public.options (name, description, is_multi)
select 'Size', 'Chọn cỡ phần ăn', false
where not exists (select 1 from public.options where name = 'Size');

insert into public.options (name, description, is_multi)
select 'Topping', 'Thêm món ăn kèm', true
where not exists (select 1 from public.options where name = 'Topping');

insert into public.options (name, description, is_multi)
select 'Mức cay', 'Mức cay của món', false
where not exists (select 1 from public.options where name = 'Mức cay');

-- ---------------------------------------------------------------------
-- 2) Lựa chọn cụ thể cho TỪNG MÓN
--    menu_item_options: (món, nhóm, tên, chênh lệch giá)
-- ---------------------------------------------------------------------

-- === Xôi thập cẩm (30.000) ===
insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size to',  5000, 1
from public.menu_items m, public.options o
where m.name = 'Xôi thập cẩm' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size to'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size vừa', 0, 2
from public.menu_items m, public.options o
where m.name = 'Xôi thập cẩm' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size vừa'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size nhỏ', -5000, 3
from public.menu_items m, public.options o
where m.name = 'Xôi thập cẩm' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size nhỏ'
  );

-- === Bánh mì (28.000) ===
insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size to',  5000, 1
from public.menu_items m, public.options o
where m.name = 'Bánh mì' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size to'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size vừa', 0, 2
from public.menu_items m, public.options o
where m.name = 'Bánh mì' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size vừa'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size nhỏ', -5000, 3
from public.menu_items m, public.options o
where m.name = 'Bánh mì' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size nhỏ'
  );

-- === Mì trộn (15.000) ===
insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size to',  5000, 1
from public.menu_items m, public.options o
where m.name = 'Mì trộn' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size to'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size vừa', 0, 2
from public.menu_items m, public.options o
where m.name = 'Mì trộn' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size vừa'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Size nhỏ', -5000, 3
from public.menu_items m, public.options o
where m.name = 'Mì trộn' and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Size nhỏ'
  );

-- ---------------------------------------------------------------------
-- 3) Topping cho 3 món chính
-- ---------------------------------------------------------------------
insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Thêm trứng', 3000, 1
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Topping'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Thêm trứng'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Thêm gà', 8000, 2
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Topping'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Thêm gà'
  );

-- ---------------------------------------------------------------------
-- 4) Mức cay cho 3 món chính
-- ---------------------------------------------------------------------
insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Cay', 0, 1
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Mức cay'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Cay'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Vừa', 0, 2
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Mức cay'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Vừa'
  );

insert into public.menu_item_options (menu_item_id, option_id, name, price_delta, sort_order)
select m.id, o.id, 'Không cay', 0, 3
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Mức cay'
  and not exists (
    select 1 from public.menu_item_options x
    where x.menu_item_id = m.id and x.option_id = o.id and x.name = 'Không cay'
  );

-- ---------------------------------------------------------------------
-- 5) Gắn nhóm vào món (bảng trung gian)
--    is_required = true -> khách BẮT BUỘC phải chọn nhóm này
-- ---------------------------------------------------------------------
insert into public.menu_item_option_groups (menu_item_id, option_id, is_required)
select m.id, o.id, true
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name = 'Size'
  and not exists (
    select 1 from public.menu_item_option_groups x
    where x.menu_item_id = m.id and x.option_id = o.id
  );

insert into public.menu_item_option_groups (menu_item_id, option_id, is_required)
select m.id, o.id, false
from public.menu_items m, public.options o
where m.name in ('Xôi thập cẩm', 'Bánh mì', 'Mì trộn') and o.name in ('Topping', 'Mức cay')
  and not exists (
    select 1 from public.menu_item_option_groups x
    where x.menu_item_id = m.id and x.option_id = o.id
  );

-- ---------------------------------------------------------------------
-- 6) Kiểm tra kết quả
-- ---------------------------------------------------------------------
select 'options' as bang, count(*) as so_dong from public.options
union all
select 'menu_item_options', count(*) from public.menu_item_options
union all
select 'menu_item_option_groups', count(*) from public.menu_item_option_groups;

-- ---------------------------------------------------------------------
-- Sau khi chạy xong, kiểm tra lại bằng:
--   node scripts/check-options-schema.mjs
-- ---------------------------------------------------------------------
