/**
 * Kiểm tra chức năng + bảo mật của database Supabase.
 *
 *   node scripts/check-supabase.mjs
 *
 * ---------------------------------------------------------------------------
 * BẢNG MÀU
 *   1. Phần A — kiểm tra bằng anon key (khách): app có chạy đúng không?
 *   2. Phần B — kiểm tra bằng tài khoản chủ quán (nếu có trong .env):
 *      chủ quán có thêm/sửa/xoá món, xem & sửa đơn không?
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN CẨN THẬN VỚI RLS
 *
 *   RLS có 2 kiểu phản ứng rất dễ gây hiểu nhầm:
 *
 *   a) Chặn CÓ LỖI  -> trả về error, ví dụ:
 *        "new row violates row-level security policy for table \"orders\""
 *      Đây là trường hợp INSERT kèm .select(): PostgREST gửi
 *      `Prefer: return=representation` nên Postgres phải ĐỌC LẠI dòng vừa
 *      insert, mà policy của `anon` chỉ cho phép INSERT chứ không cho SELECT
 *      -> bị chặn, VÀ ĐƠN KHÔNG ĐƯỢC LƯU.
 *
 *   b) Chặn ÂM THẦM  -> không lỗi, nhưng 0 dòng bị ảnh hưởng.
 *      Ví dụ: UPDATE bảng mà policy không cho phép -> `error = null`
 *      nhưng `data = []`. Nếu chỉ kiểm tra `error` thì sẽ tưởng là ĐƯỢC PHÉP.
 *
 *   Vì vậy script này luôn kiểm tra CẢ `error` LẪN số dòng trả về.
 *
 * ---------------------------------------------------------------------------
 * KỸ THUẬT "PROBE KHÔNG GÂY RÁC"
 *   Để kiểm tra quyền INSERT mà không tạo dữ liệu rác, ta cố tình insert
 *   một dòng THIẾU cột NOT NULL:
 *     - Nếu lỗi là RLS           -> quyền INSERT bị chặn  => an toàn
 *     - Nếu lỗi là NOT NULL       -> RLS đã cho qua, chỉ bị chặn bởi constraint
 *                                   => KHÔNG an toàn (quyền INSERT đang mở)
 *   Dòng không hợp lệ nên không bao giờ được ghi vào DB.
 *
 *   (Thứ tự kiểm tra trong PostgreSQL: RLS WITH CHECK chạy TRƯỚC NOT NULL,
 *    nên lỗi nào xuất hiện cũng cho biết chính xác tầng nào đã chặn.)
 * ---------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')

if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
}

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || ''
const adminEmail = (process.env.VITE_ADMIN_EMAIL || '').trim()
const adminPassword = process.env.VITE_ADMIN_PASSWORD || ''

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const ok = (m) => console.log(`${GREEN}  OK  ${RESET} ${m}`)
const fail = (m) => console.log(`${RED} FAIL ${RESET} ${m}`)
const warn = (m) => console.log(`${YELLOW} WARN ${RESET} ${m}`)
const skip = (m) => console.log(`${YELLOW} SKIP ${RESET} ${m}`)
const info = (m) => console.log(`${DIM}       ${m}${RESET}`)
const head = (m) => console.log(`\n${CYAN}${m}${RESET}`)

let failed = 0
const failCount = () => failed++

/* ================================================================== *
 * 0. Kiểm tra cấu hình
 * ================================================================== */
head('0. Cấu hình')

if (!url || !key) {
  fail('Thiếu cấu hình trong file .env')
  if (!url) {
    info('Thiếu VITE_SUPABASE_URL')
    info('  Gán: https://<project-ref>.supabase.co  (KHÔNG kèm /rest/v1)')
  }
  if (!key) {
    info('Thiếu VITE_SUPABASE_ANON_KEY')
    info('  Lấy tại: Supabase Dashboard -> Project Settings -> API -> anon public')
  }
  process.exit(1)
}

if (!key.startsWith('eyJ')) {
  fail('VITE_SUPABASE_ANON_KEY có vẻ sai định dạng')
  info('Key hợp lệ bắt đầu bằng "eyJ" và dài khoảng 200 ký tự.')
  info('Bạn có thể đã copy nhầm "service_role" key.')
  process.exit(1)
}
if (key.length < 100) {
  fail(`VITE_SUPABASE_ANON_KEY quá ngắn (${key.length} ký tự)`)
  info('Key thường dài khoảng 200 ký tự. Hãy copy lại cho đủ.')
  process.exit(1)
}
if (!url.startsWith('http')) {
  fail(`VITE_SUPABASE_URL không hợp lệ: ${url}`)
  info('URL phải bắt đầu bằng http:// hoặc https://')
  process.exit(1)
}

ok(`Project URL: ${url}`)
ok(`Anon key: ${key.length} ký tự, định dạng hợp lệ`)

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/* ================================================================== *
 * PHẦN A — kiểm tra bằng anon key (giống hệt khách hàng)
 * ================================================================== */
head('PHẦN A — Khách (anon key) — đúng như trình duyệt của khách')

// --- A1. Đọc thực đơn -------------------------------------------------
let menuCount = 0
{
  const { data, error } = await anon.from('menu_items').select('*').order('sort_order')
  if (error) {
    fail(`Không đọc được thực đơn: ${error.message}`)
    info('Chạy supabase/schema.sql trong SQL Editor để tạo bảng + policy')
    failCount()
  } else {
    menuCount = data?.length || 0
    ok(`Đọc thực đơn được (${menuCount} món)`)
    if (menuCount === 0) {
      warn('Thực đơn đang trống — chạy lại supabase/schema.sql để nạp món mẫu')
    }
  }
}

// --- A2. Khách KHÔNG được thêm món ------------------------------------
{
  // Probe: thiếu cột NOT NULL `name` -> dòng không hợp lệ, không ghi được vào DB
  const { error } = await anon.from('menu_items').insert({ price: 1, description: 'probe' })
  if (!error) {
    fail('NGUY HIỂM: khách có thể THÊM món vào thực đơn')
    info('Cần policy giới hạn INSERT cho anon.')
    failCount()
  } else if (/row-level security/i.test(error.message)) {
    ok('RLS chặn đúng: khách không thêm được món')
  } else if (/not-null constraint/i.test(error.message)) {
    fail('NGUY HIỂM: khách CÓ quyền INSERT món (bị chặn mới bởi NOT NULL)')
    info('Policy INSERT cho anon đang mở — cần sửa lại.')
    failCount()
  } else {
    warn(`Không xác định được quyền INSERT món: ${error.message}`)
  }
}

// --- A3. Khách KHÔNG được sửa món -------------------------------------
// Dùng giá trị CŨ (không đổi) nên kể cả policy sai cũng không làm hỏng dữ liệu.
{
  const { data: first } = await anon.from('menu_items').select('id,price').limit(1)
  if (!first?.length) {
    skip('Không có món nào để thử quyền sửa')
  } else {
    const { data, error } = await anon
      .from('menu_items')
      .update({ price: first[0].price }) // giữ nguyên giá trị -> an toàn
      .eq('id', first[0].id)
      .select()
    if (error && /row-level security/i.test(error.message)) {
      ok('RLS chặn đúng: khách không sửa được món')
    } else if (!error && (data?.length ?? 0) === 0) {
      ok('RLS chặn đúng: khách không sửa được món (bị chặn âm thầm, 0 dòng)')
    } else if (!error && (data?.length ?? 0) > 0) {
      fail('NGUY HIỂM: khách sửa được món')
      info('Policy UPDATE cho anon đang mở.')
      failCount()
    } else {
      warn(`Không xác định được quyền sửa món: ${error?.message}`)
    }
  }
}

// --- A4. Khách KHÔNG được xoá món --------------------------------------
// Chỉ test được an toàn nếu có sẵn 1 dòng rác (tạo bởi admin ở Phần B).
// Nếu chưa có, ta test bằng điều kiện KHÔNG THỂ khớp -> kết luận không chắc,
// nên báo "bỏ qua" thay vì báo đạt giả.
let scratchItemId = null
{
  const { data } = await anon.from('menu_items').select('id').limit(1)
  if (data?.length) {
    const { data: del, error } = await anon
      .from('menu_items')
      .delete()
      .eq('id', data[0].id)
      .eq('name', '__khong-ton-tai-__') // điều kiện không thể khớp -> không xoá nhầm
      .select()
    if (error && /row-level security/i.test(error.message)) {
      ok('RLS chặn đúng: khách không xoá được món')
    } else {
      skip('Không xác định được quyền XOÁ món bằng anon (cần dòng rác để test)')
      info('Sẽ được kiểm tra chính xác ở Phần B (đăng nhập chủ quán).')
    }
  }
}

// --- A5. Khách CÓ được tạo đơn ----------------------------------------
const markerCode = 'CHK' + Date.now().toString().slice(-6)
let markerOrderId = null
{
  // 5a. Probe: thiếu cột NOT NULL `code`
  const { error } = await anon.from('orders').insert({ customer_name: 'probe' })
  if (error && /row-level security/i.test(error.message)) {
    fail('Khách không tạo được đơn — app sẽ báo lỗi khi khách đặt món')
    info('Cần policy INSERT cho anon trên bảng orders.')
    failCount()
  } else if (error && /not-null constraint/i.test(error.message)) {
    ok('RLS cho phép: khách có quyền tạo đơn')
  } else if (!error) {
    ok('RLS cho phép: khách có quyền tạo đơn')
  } else {
    warn(`Không xác định được quyền tạo đơn: ${error.message}`)
  }

  // 5b. Tạo 1 đơn thật (đánh dấu rõ ràng) để kiểm tra SELECT chặn đúng.
  //     Đơn này sẽ được dọn ở Phần B, hoặc bằng file cleanup-test-orders.sql.
  const row = {
    id: randomUUID(),
    code: markerCode,
    customer_name: 'Kiem tra tu dong',
    customer_phone: '0000000000',
    table_no: '0',
    note: 'CHECK-SCRIPT-MARKER',
    items: [{ id: 'probe', name: 'Món kiểm tra', price: 1000, qty: 1 }],
    total: 1000,
    status: 'new',
  }
  // KHÔNG kèm .select() — nếu kèm, RLS chặn và đơn KHÔNG được lưu
  const { error: insErr } = await anon.from('orders').insert(row)
  if (insErr) {
    fail(`Khách tạo đơn thất bại: ${insErr.message}`)
    failCount()
  } else {
    markerOrderId = row.id
    ok('Khách (anon) tạo đơn được')
    info(`Đơn kiểm tra: ${markerCode} (sẽ được dọn tự động nếu có tài khoản admin)`)
  }
}

// --- A6. Khách KHÔNG được xem danh sách đơn ----------------------------
{
  const { data, error } = await anon.from('orders').select('id,code,note')
  if (error && /row-level security/i.test(error.message)) {
    ok('RLS chặn đúng: khách không xem được danh sách đơn')
  } else if (!error && (data?.length ?? 0) === 0) {
    // Đơn kiểm tra chắc chắn đã tồn tại -> trả về 0 dòng nghĩa là bị RLS lọc
    ok('RLS chặn đúng: khách không xem được danh sách đơn (0 dòng dù đơn có thật)')
  } else if (!error && (data?.length ?? 0) > 0) {
    fail(`NGUY HIỂM: khách đọc được ${data.length} đơn của quán`)
    info('Policy SELECT cho anon trên bảng orders đang mở.')
    failCount()
  } else {
    warn(`Không xác định được quyền đọc đơn: ${error?.message}`)
  }
}

// --- A7. Khách KHÔNG được sửa đơn -------------------------------------
{
  if (!markerOrderId) {
    skip('Không có đơn kiểm tra để thử quyền sửa')
  } else {
    const { data, error } = await anon
      .from('orders')
      .update({ status: 'new' }) // giữ nguyên -> an toàn
      .eq('id', markerOrderId)
      .select()
    if (error && /row-level security/i.test(error.message)) {
      ok('RLS chặn đúng: khách không sửa được đơn')
    } else if (!error && (data?.length ?? 0) === 0) {
      ok('RLS chặn đúng: khách không sửa được đơn (bị chặn âm thầm, 0 dòng)')
    } else if (!error && (data?.length ?? 0) > 0) {
      fail('NGUY HIỊCH: khách sửa được đơn'.replace('Ị', 'I'))
      info('Policy UPDATE cho anon trên bảng orders đang mở.')
      failCount()
    } else {
      warn(`Không xác định được quyền sửa đơn: ${error?.message}`)
    }
  }
}

// --- A8. Khách KHÔNG được xoá đơn -------------------------------------
{
  if (!markerOrderId) {
    skip('Không có đơn kiểm tra để thử quyền xoá')
  } else {
    const { data, error } = await anon.from('orders').delete().eq('id', markerOrderId).select()
    if (error && /row-level security/i.test(error.message)) {
      ok('RLS chặn đúng: khách không xoá được đơn')
    } else if (!error && (data?.length ?? 0) === 0) {
      ok('RLS chặn đúng: khách không xoá được đơn (bị chặn âm thầm, 0 dòng)')
    } else if (!error && (data?.length ?? 0) > 0) {
      fail('NGUY HIỂNG: khách xoá được đơn'.replace('Ổ', 'O'))
      info('Policy DELETE cho anon trên bảng orders đang mở.')
      failCount()
    } else {
      warn(`Không xác định được quyền xoá đơn: ${error?.message}`)
    }
  }
}

/* ================================================================== *
 * PHẦN B — kiểm tra bằng tài khoản chủ quán
 * ================================================================== */
head('PHẦN B — Chủ quán (đăng nhập) — quyền ghi dữ liệu')

let admin = null

if (!adminEmail || !adminPassword) {
  skip('Bỏ qua: thiếu VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env')
  info('Thêm 2 dòng này vào .env để kiểm tra đầy đủ phần quản trị:')
  info('  VITE_ADMIN_EMAIL=email-cua-ban@gmail.com')
  info('  VITE_ADMIN_PASSWORD=mat-khau-cua-ban')
  info('(2 dòng này KHÔNG được commit — .env đã nằm trong .gitignore)')
} else {
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  if (error) {
    fail(`Đăng nhập chủ quán thất bại: ${error.message}`)
    info('Sai email/mật khẩu, hoặc tài khoản chưa được Auto Confirm.')
    failCount()
    admin = null
  } else {
    ok(`Đăng nhập thành công: ${adminEmail}`)

    // --- B1. Xem được danh sách đơn ---------------------------------
    {
      const { data, error } = await admin.from('orders').select('id,code,status,total').order('created_at', {
        ascending: false,
      })
      if (error) {
        fail(`Chủ quán không xem được danh sách đơn: ${error.message}`)
        failCount()
      } else {
        ok(`Chủ quán xem được danh sách đơn (${data?.length ?? 0} đơn)`)
        const marker = (data || []).find((o) => o.code === markerCode)
        if (marker) {
          ok('Xác nhận đơn của khách đã được lưu đúng vào database')
        } else if (markerOrderId) {
          warn('Không thấy đơn kiểm tra trong danh sách — kiểm tra lại insert')
        }
      }
    }

    // --- B2. Thêm / sửa / xoá món ------------------------------------
    {
      const scratch = {
        id: randomUUID(),
        name: '__don_kiem_tra_xoa_ngay__',
        price: 1,
        description: 'dòng rác, sẽ bị xoá ngay',
        category: '__probe__',
        is_available: false,
        sort_order: 9999,
      }
      const ins = await admin.from('menu_items').insert(scratch)
      if (ins.error) {
        fail(`Chủ quán không thêm được món: ${ins.error.message}`)
        failCount()
      } else {
        ok('Chủ quán thêm được món')

        // Sửa
        const upd = await admin.from('menu_items').update({ price: 2 }).eq('id', scratch.id).select()
        if (upd.error) {
          fail(`Chủ quán không sửa được món: ${upd.error.message}`)
          failCount()
        } else if ((upd.data?.length ?? 0) === 0) {
          fail('Chủ quán sửa món nhưng không đọc lại được dòng vừa sửa (thiếu quyền SELECT?)')
          failCount()
        } else {
          ok('Chủ quán sửa được món')
        }

        // XOÁ: dùng chính dòng rác này để xác nhận khách KHÔNG xoá được món.
        // (Đây là lúc duy nhất test được chính xác: cần có 1 dòng thật để xoá.)
        {
          const { data: del, error: delErr } = await anon
            .from('menu_items')
            .delete()
            .eq('id', scratch.id)
            .select()
          if (delErr && /row-level security/i.test(delErr.message)) {
            ok('RLS chặn đúng: khách không xoá được món')
          } else if (!delErr && (del?.length ?? 0) === 0) {
            ok('RLS chặn đúng: khách không xoá được món (bị chặn âm thầm, 0 dòng)')
          } else if (!delErr && (del?.length ?? 0) > 0) {
            fail('NGUY HIỂNG: khách xoá được món')
            info('Policy DELETE cho anon trên bảng menu_items đang mở.')
            failCount()
          } else {
            warn(`Không xác định được quyền xoá món: ${delErr?.message}`)
          }
        }

        // Chủ quán xoá dòng rác
        const del = await admin.from('menu_items').delete().eq('id', scratch.id).select()
        if (del.error) {
          fail(`Chủ quán không xoá được món: ${del.error.message}`)
          failCount()
        } else if ((del.data?.length ?? 0) === 0) {
          fail('Chủ quán xoá món nhưng 0 dòng bị xoá')
          failCount()
        } else {
          ok('Chủ quán xoá được món')
        }
      }
    }

    // --- B3. Sửa trạng thái đơn -------------------------------------
    {
      const { data: any } = await admin.from('orders').select('id,status').limit(1)
      if (!any?.length) {
        skip('Không có đơn nào để thử sửa trạng thái')
      } else {
        const before = any[0].status
        const next = before === 'preparing' ? 'new' : 'preparing'
        const upd = await admin.from('orders').update({ status: next }).eq('id', any[0].id).select()
        if (upd.error) {
          fail(`Chủ quán không sửa được trạng thái đơn: ${upd.error.message}`)
          failCount()
        } else if ((upd.data?.length ?? 0) === 0) {
          fail('Chủ quán sửa trạng thái đơn nhưng 0 dòng bị ảnh hưởng')
          failCount()
        } else {
          ok('Chủ quán sửa được trạng thái đơn')
          // trả lại trạng thái cũ
          await admin.from('orders').update({ status: before }).eq('id', any[0].id)
        }
      }
    }

    // --- B4. Dọn đơn kiểm tra + đơn rác do script cũ để lại -----------
    {
      const { data: junk, error } = await admin
        .from('orders')
        .delete()
        .in('code', [markerCode])
        .or('note.eq.CHECK-SCRIPT-MARKER,note.eq.AUTO-CHECK,note.eq.RB-TEST,note.eq.RBK-TEST,note.eq.BUG-TEST,note.eq.DIAG don kiem tra tu dong')
        .select()
      if (error) {
        warn(`Không dọn được đơn kiểm tra: ${error.message}`)
        info('Xoá tay: Dashboard -> Table Editor -> orders')
      } else {
        ok(`Đã dọn ${junk?.length ?? 0} đơn kiểm tra`)
      }
    }

    await admin.auth.signOut()
  }
}

/* ================================================================== *
 * Tổng kết
 * ================================================================== */
head('Tổng kết')

if (failed === 0) {
  console.log(`${GREEN}✓ Tất cả kiểm tra đều đạt.${RESET}`)
  if (!admin) {
    console.log(`${DIM}  (Phần B chỉ kiểm tra được một nửa — thêm VITE_ADMIN_EMAIL/VITE_ADMIN_PASSWORD để đạt đủ.)${RESET}`)
  }
  console.log('')
  process.exit(0)
} else {
  console.log(`${RED}✗ Có ${failed} kiểm tra chưa đạt.${RESET}`)
  console.log(`${DIM}  Xem "Xử lý lỗi" trong README.md${RESET}\n`)
  process.exit(1)
}
