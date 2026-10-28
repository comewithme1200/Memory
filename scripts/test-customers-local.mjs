/**
 * Test chế độ LOCAL (demo) — không cần Supabase.
 *
 * Kiểm tra luồng đầy đủ:
 *   1. Tạo khách quen -> sinh token
 *   2. Lấy khách bằng token (giống khách quét QR)
 *   3. Tạo đơn có địa chỉ + token
 *
 *   node scripts/test-customers-local.mjs
 *
 * Script này chạy trong Node, nên `localStorage` không có sẵn -> ta mô phỏng
 * một bộ nhớ đơn giản trước khi import module.
 */
import { webcrypto } from 'node:crypto'

// --- Mô phỏng localStorage cho môi trường Node ---
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

// --- Mô phỏng import.meta.env (Vite) ---
globalThis.__vite_env__ = {
  VITE_SUPABASE_URL: '', // rỗng -> chế độ local
  VITE_SUPABASE_ANON_KEY: '',
}

if (!globalThis.crypto) globalThis.crypto = webcrypto

// import.meta.env không tồn tại trong Node -> module supabase.js sẽ lỗi.
// Ta nạp module db.js SAU khi đặt lại import.meta.env qua loader tuỳ biến.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Tạo bản sao tạm của db.js + supabase.js với import.meta.env được thay thế
const tmp = mkdtempSync(join(tmpdir(), 'qas-'))
const dbSrc = readFileSync(join(root, 'src', 'lib', 'db.js'), 'utf8')
  .replace(/from '\.\/supabase\.js'/, "from './supabase.js'")

const supabaseSrc = `
export const SUPABASE_URL = ''
export const SUPABASE_ANON_KEY = ''
export const isSupabaseConfigured = false
export const supabase = null
`
writeFileSync(join(tmp, 'supabase.js'), supabaseSrc)
writeFileSync(
  join(tmp, 'format.js'),
  readFileSync(join(root, 'src', 'lib', 'format.js'), 'utf8'),
)
writeFileSync(join(tmp, 'db.js'), dbSrc)

const db = await import(pathToFileURL(join(tmp, 'db.js')).href)

let failed = 0
const ok = (m) => console.log(`  OK  ${m}`)
const fail = (m) => {
  console.log(`  FAIL ${m}`)
  failed++
}

console.log('=== Chế độ LOCAL (không có Supabase) ===\n')

// 1) Tạo khách quen
console.log('1. Tạo khách quen')
const c = await db.createCustomer({
  name: 'Nguyễn Văn A',
  phone: '0909 000 000',
  address: '123 Nguyễn Văn A, Quận 1',
})
if (c.id && c.qr_token) ok(`Tạo khách: ${c.name} — token ${c.qr_token.slice(0, 12)}…`)
else fail('Tạo khách không trả về id/token')

// 2) Lấy khách theo token (khách quét QR)
console.log('\n2. Lấy khách theo token (khách quét QR)')
const found = await db.getCustomerByToken(c.qr_token)
if (found && found.name === c.name && found.address === c.address) {
  ok(`Lấy đúng: ${found.name} — ${found.phone} — ${found.address}`)
} else {
  fail(`Sai dữ liệu: ${JSON.stringify(found)}`)
}

// 2b) Token sai -> null
const notFound = await db.getCustomerByToken('token-khong-ton-tai')
if (notFound === null) ok('Token sai -> trả về null (không lộ thông tin)')
else fail('Token sai vẫn trả về dữ liệu')

// 3) Tạo đơn có địa chỉ + token
console.log('\n3. Tạo đơn có địa chỉ + token khách quen')
const order = await db.createOrder({
  customer_name: '',
  customer_phone: '',
  customer_address: '',
  customer_token: c.qr_token,
  items: [{ id: 'x', name: 'Phở bò tái', price: 30000, qty: 2, note: 'không da gà' }],
})
if (order.customer_address === c.address) ok(`Đơn lưu địa chỉ: ${order.customer_address}`)
else fail(`Đơn sai địa chỉ: ${order.customer_address}`)
if (order.total === 60000) ok(`Tổng tiền: ${order.total}`)
else fail(`Tổng sai: ${order.total}`)

// 4) Danh sách khách quen
console.log('\n4. Liệt kê khách quen')
const list = await db.listCustomers()
if (list.length === 1 && list[0].name === c.name) ok(`Có ${list.length} khách`)
else fail(`Sai danh sách: ${list.length} khách`)

// 5) Sửa + xoá
console.log('\n5. Sửa và xoá')
const upd = await db.updateCustomer(c.id, { ...c, name: 'Tên Mới', is_active: true })
if (upd.name === 'Tên Mới') ok('Sửa thành công')
else fail(`Sửa sai: ${upd.name}`)

await db.deleteCustomer(c.id)
const after = await db.listCustomers()
if (after.length === 0) ok('Xoá thành công')
else fail(`Xoá sai: còn ${after.length} khách`)

console.log(failed === 0 ? '\n✓ Tất cả kiểm tra local đều đạt.' : `\n✗ ${failed} kiểm tra chưa đạt.`)
process.exit(failed === 0 ? 0 : 1)
