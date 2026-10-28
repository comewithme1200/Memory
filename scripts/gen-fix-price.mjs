/**
 * Sinh file vá `supabase/fix-create-order-price.sql` từ `migration-options.sql`
 * bằng cách copy NGUYÊN VĂN hàm `create_order` + khối revoke quyền.
 *
 *   node scripts/gen-fix-price.mjs
 *
 * Mục đích: hàm trong DB đã được tạo từ migration CŨ (còn lỗi jsonb_agg),
 * nên cần một file riêng chỉ chứa hàm ĐÃ SỬA để `create or replace`.
 * Sinh tự động từ migration -> luôn khớp, không bao giờ sót logic.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'supabase/migration-options.sql'
const OUT = 'supabase/fix-create-order-price.sql'

const src = readFileSync(SRC, 'utf8')

// --- Cắt hàm create_order ---
const fnStart = src.indexOf('create or replace function public.create_order')
if (fnStart < 0) throw new Error('Không tìm thấy hàm create_order trong migration')

const endMatch = src.slice(fnStart).match(/\r?\nend;\r?\n\$\$;/)
if (!endMatch) throw new Error('Không tìm thấy phần kết thúc hàm')
const fnEnd = fnStart + endMatch.index
const fnBody = src.slice(fnStart, fnEnd + endMatch[0].length)

// --- Kiểm tra: hàm phải ĐÃ có bản sửa (không còn jsonb_agg bọc ngoài) ---
if (/jsonb_agg\(eo->'options'\)/.test(fnBody)) {
  throw new Error(
    'Hàm trong migration VẪN còn lỗi jsonb_agg. Hãy sửa migration trước rồi sinh lại.',
  )
}

// --- Cắt khối revoke quyền (để giữ nguyên cấu hình quyền của DB) ---
const revokeStart = src.indexOf('do $$')
const revokeEnd = src.indexOf('end $$;', revokeStart)
if (revokeStart < 0 || revokeEnd < 0) throw new Error('Không tìm thấy khối revoke quyền')
const revokeBlock = src.slice(revokeStart, revokeEnd + 'end $$;'.length)

const header = `-- =====================================================================
-- VÁ LỖI GIÁ: tuỳ chọn không được cộng vào giá món
--
-- VÌ SAO LỖI:
--   Đoạn tính giá trong RPC create_order (bản tạo từ migration-options.sql
--   CŨ) dùng:
--
--     select sum(mio.price_delta)
--     from jsonb_array_elements(
--            coalesce(
--              (select jsonb_agg(eo->'options')      <-- LỖI Ở ĐÂY
--               from jsonb_array_elements(p_item_options) eo
--               where (eo->>'line')::int = e.idx),
--              '[]'::jsonb
--            )
--          ) as opts
--     cross join lateral jsonb_array_elements(opts) as o
--     left join public.menu_item_options mio
--       on mio.id::text = o->>'menuItemOptionId'
--
--   jsonb_agg(eo->'options') gom các mảng lại thành MẢNG LỒNG MẢNG:
--       [[{...},{...}]]
--   -> jsonb_array_elements(opts) cho ra phần tử là MẢNG, không phải object
--   -> o->>'menuItemOptionId' = NULL
--   -> left join không khớp -> sum(...) = NULL -> coalesce(..., 0) = 0
--   -> giá món = GIÁ GỐC, mất hết phần +5k / -5k của Size.
--
--   Kết quả: đơn "2x Size to + 1x Size nhỏ" ra 90.000đ thay vì 95.000đ.
--
-- CÁCH SỬA:
--   Bỏ jsonb_agg + lớp jsonb_array_elements bọc ngoài, dùng thẳng
--   jsonb_array_elements(eo->'options') cho entry đang xét.
--
-- CÁCH CHẠY:
--   Supabase Dashboard -> SQL Editor -> dán file này -> Run
--
-- Script idempotent: chạy lại nhiều lần vẫn cho kết quả đúng.
--
-- File này được SINH TỰ ĐỘNG từ supabase/migration-options.sql
-- (scripts/gen-fix-price.mjs): hàm create_order + khối revoke quyền
-- được copy NGUYÊN VĂN -> không bao giờ sót logic nào.
-- =====================================================================

-- Xoá hàm cũ trước.
-- "create or replace" KHÔNG cho đổi tên tham số đầu vào, nên nếu hàm đang
-- có trong DB dùng tên khác sẽ báo lỗi. "drop" cho an toàn.
-- Hàm không lưu dữ liệu nên drop không mất gì.
drop function if exists public.create_order(text, text, text, text, text, text, jsonb, text, jsonb);
drop function if exists public.create_order(text, text, text, text, text, text, jsonb, text);
drop function if exists public.create_order(text, text, text, text, text, text, jsonb);
drop function if exists public.create_order(text, text, text, text, text, jsonb);

`

const footer = `

-- ---------------------------------------------------------------------
-- Kiểm tra sau khi chạy:
--   node scripts/test-order-price.mjs
-- Kết quả mong đợi:
--   Tổng MONG ĐỢI: 95.000 đ
--   Tổng THỰC TẾ: 95.000 đ
--   ✅ GIÁ ĐÚNG
-- ---------------------------------------------------------------------
`

writeFileSync(OUT, header + fnBody + '\n\n' + revokeBlock + footer, 'utf8')
console.log(`Đã sinh ${OUT}`)
console.log(`  Hàm create_order: ${fnBody.length} ký tự`)
console.log(`  Khối revoke quyền: ${revokeBlock.length} ký tự`)
console.log(`  Đã kiểm tra: không còn jsonb_agg bọc ngoài ✓`)
