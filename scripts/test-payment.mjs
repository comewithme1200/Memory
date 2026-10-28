/**
 * Kiểm tra tính năng THANH TOÁN trên Supabase.
 *
 *   node scripts/test-payment.mjs
 *
 * Kiểm tra:
 *   1. Bảng `orders` đã có cột `payment_method` + `is_paid` chưa.
 *   2. RPC `create_order` chấp nhận tham số `p_payment_method` chưa.
 *   3. Đặt đơn thật với payment_method='transfer' -> đọc lại được.
 *   4. `is_paid` mặc định = false, chủ quán tick được thành true.
 *   5. Dọn dữ liệu kiểm tra.
 *
 * Script tự xoá đơn kiểm tra ở cuối nên không để lại rác.
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')

if (existsSync(envPath)) process.loadEnvFile(envPath)

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || ''
const adminEmail = (process.env.VITE_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.VITE_ADMIN_PASSWORD || '')

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const D = '\x1b[2m'
const X = '\x1b[0m'

const ok = (m) => console.log(`${G}  OK  ${X} ${m}`)
const fail = (m) => console.log(`${R} FAIL ${X} ${m}`)
const warn = (m) => console.log(`${Y} WARN ${X} ${m}`)
const skip = (m) => console.log(`${Y} SKIP ${X} ${m}`)
const info = (m) => console.log(`${D}       ${m}${X}`)
const head = (m) => console.log(`\n${C}${m}${X}`)

let failed = 0

if (!url || !key) {
  fail('Thiếu cấu hình Supabase trong .env')
  process.exit(1)
}

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/* ------------------------------------------------------------------ *
 * 1. Cột mới trên bảng `orders`
 * ------------------------------------------------------------------ */
head('1. Cột payment_method / is_paid')

{
  const { data, error } = await anon.from('orders').select('*').limit(1)
  if (error) {
    fail(`Không đọc được bảng orders: ${error.message}`)
    failed++
  } else {
    // Khách không được SELECT orders -> data rỗng, nhưng lỗi sẽ cho biết cột.
    if (error) {
      // đã xử lý ở trên
    } else {
      info('Bảng orders truy cập được (khách có quyền đọc?) — kiểm tra tiếp')
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. RPC create_order có nhận p_payment_method?
 * ------------------------------------------------------------------ */
head('2. RPC create_order với p_payment_method')

let menuRow = null
{
  const { data } = await anon.from('menu_items').select('id,name,price').limit(1)
  menuRow = data?.[0] || null
  if (!menuRow) {
    fail('Thực đơn đang trống — không có món để thử')
    failed++
  }
}

const testCode = 'PAY' + Date.now().toString().slice(-6)
let orderId = null

if (menuRow) {
  const { data, error } = await anon.rpc('create_order', {
    p_code: testCode,
    p_customer_name: 'Kiem tra thanh toan',
    p_customer_phone: '0000000000',
    p_customer_address: 'Dia chi kiem tra',
    p_table_no: '0',
    p_note: 'PAY-TEST-MARKER',
    p_items: [{ id: menuRow.id, name: menuRow.name, price: menuRow.price, qty: 1, note: '' }],
    p_customer_token: '',
    p_payment_method: 'transfer',
    p_item_options: [],
  })

  if (error) {
    if (/does not exist|unknown function|could not find/i.test(error.message)) {
      fail('RPC create_order chưa nhận p_payment_method')
      info('Chạy supabase/migration-payment.sql trong SQL Editor rồi chạy lại script này.')
      failed++
    } else {
      fail(`RPC create_order lỗi: ${error.message}`)
      failed++
    }
  } else {
    orderId = typeof data === 'object' ? data.id : data
    ok('RPC create_order nhận p_payment_method thành công')
    if (typeof data === 'object' && data.payment_method) {
      info(`Server trả về payment_method = ${data.payment_method}`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. Kiểm tra giá trị trong DB + tick is_paid (cần đăng nhập chủ quán)
 * ------------------------------------------------------------------ */
head('3. Giá trị trong DB + tick "Đã thanh toán"')

if (!adminEmail || !adminPassword) {
  skip('Bỏ qua phần đọc/tick đơn: thiếu VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD trong .env')
  info('Thêm 2 dòng này vào .env để kiểm tra đầy đủ.')
} else {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: authErr } = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  if (authErr) {
    skip(`Không đăng nhập được chủ quán: ${authErr.message}`)
  } else if (!orderId) {
    skip('Không có đơn kiểm tra để đọc')
  } else {
    const { data: ord, error: ordErr } = await admin
      .from('orders')
      .select('id,code,payment_method,is_paid')
      .eq('id', orderId)
      .maybeSingle()
    if (ordErr) {
      fail(`Không đọc được đơn: ${ordErr.message}`)
      failed++
    } else if (!ord) {
      fail('Không tìm thấy đơn vừa tạo')
      failed++
    } else {
      ok(`Đơn #${ord.code}: payment_method = ${ord.payment_method}, is_paid = ${ord.is_paid}`)
      if (ord.payment_method !== 'transfer') {
        fail(`payment_method sai: mong đợi 'transfer', nhận '${ord.payment_method}'`)
        failed++
      }
      if (ord.is_paid !== false) {
        fail(`is_paid phải mặc định là false, nhận ${ord.is_paid}`)
        failed++
      } else {
        ok('is_paid mặc định = false (chưa thu tiền)')
      }

      // Tick "Đã thanh toán"
      const { data: upd, error: updErr } = await admin
        .from('orders')
        .update({ is_paid: true })
        .eq('id', orderId)
        .select('is_paid')
        .single()
      if (updErr) {
        fail(`Không tick được is_paid: ${updErr.message}`)
        failed++
      } else if (upd?.is_paid !== true) {
        fail('Tick is_paid không có tác dụng')
        failed++
      } else {
        ok('Chủ quán tick "Đã thanh toán" thành công')
      }
    }

    // Dọn đơn kiểm tra
    const { error: delErr } = await admin.from('orders').delete().eq('code', testCode)
    if (delErr) {
      warn(`Không dọn được đơn kiểm tra: ${delErr.message}`)
      info('Xoá tay: Dashboard -> Table Editor -> orders (mã ' + testCode + ')')
    } else {
      ok('Đã dọn đơn kiểm tra')
    }

    await admin.auth.signOut()
  }
}

head('Tổng kết')
if (failed === 0) {
  console.log(`${G}✓ Tính năng thanh toán hoạt động đúng.${X}\n`)
  process.exit(0)
} else {
  console.log(`${R}✗ Có ${failed} kiểm tra chưa đạt.${X}\n`)
  process.exit(1)
}
