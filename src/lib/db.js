import { supabase, isSupabaseConfigured } from './supabase.js'
import { uid, uuidV4, randomOrderCode } from './format.js'

/* ------------------------------------------------------------------ *
 * Lớp dữ liệu (data layer)
 * - Nếu đã cấu hình Supabase  -> dùng PostgreSQL qua anon key + RLS
 * - Nếu chưa cấu hình         -> tự động dùng localStorage (chế độ demo)
 *
 * Với Supabase, RLS quyết định quyền:
 *   - anon (khách)       : đọc menu_items, tạo orders
 *   - authenticated (chủ) : đọc/thêm/sửa/xoá menu_items, đọc/sửa/xoá orders
 * Vì vậy các hàm ghi (update/delete) sẽ tự động thất bại nếu chưa đăng nhập.
 * ------------------------------------------------------------------ */

const LS_KEY = 'quan-an-sang:v1'

const SEED_ITEMS = [
  { name: 'Phở bò tái', price: 30000, description: 'Nước dùng ngọt thanh, thịt bò mềm', category: 'Món chính', sort_order: 1 },
  { name: 'Bún bò Huế', price: 32000, description: 'Nước dùng đặc trưng, cay nhẹ', category: 'Món chính', sort_order: 2 },
  { name: 'Cơm tấm đầy đủ', price: 28000, description: 'Cơm tấm, trứng chiên, lạc, dưa leo', category: 'Món chính', sort_order: 3 },
  { name: 'Bánh mì ốp la', price: 15000, description: 'Trứng, pate, rau củ, dưa leo giòn', category: 'Món nhanh', sort_order: 4 },
  { name: 'Cà phê đen đá', price: 12000, description: 'Cà phê pha phin truyền thống', category: 'Nước uống', sort_order: 5 },
  { name: 'Nước mía', price: 10000, description: 'Nước mía tươi, đá lạnh', category: 'Nước uống', sort_order: 6 },
]

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) {
      // Chưa có dữ liệu -> nạp món mẫu để dùng thử ngay
      const seed = {
        items: SEED_ITEMS.map((it) => ({
          id: uid(),
          ...it,
          is_available: true,
          created_at: new Date().toISOString(),
        })),
        orders: [],
      }
      writeLocal(seed)
      return seed
    }
    const parsed = JSON.parse(raw)
    return { items: parsed.items || [], orders: parsed.orders || [] }
  } catch {
    return { items: [], orders: [] }
  }
}

const writeLocal = (data) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Không lưu được dữ liệu cục bộ', e)
  }
}

const withLocal = (fn) => {
  const data = readLocal()
  const result = fn(data)
  writeLocal(data)
  return result
}

export const MODE = isSupabaseConfigured ? 'supabase' : 'local'

/** Thông báo lỗi thân thiện khi bị RLS chặn (chưa đăng nhập) */
const friendlyError = (error, action) => {
  const msg = error?.message || ''
  if (/row-level security|violates|permission denied/i.test(msg)) {
    return 'Không có quyền thực hiện. Bạn cần đăng nhập tài khoản chủ quán.'
  }
  return msg || `${action} thất bại.`
}

/* ----------------------------- MENU ----------------------------- */

export async function listMenu() {
  if (!supabase) {
    return readLocal()
      .items.slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createMenuItem(item) {
  const payload = {
    name: item.name.trim(),
    price: Math.round(Number(item.price) || 0),
    description: (item.description || '').trim(),
    category: (item.category || '').trim(),
    is_available: item.is_available !== false,
    sort_order: Number(item.sort_order) || 0,
  }
  if (!supabase) {
    const now = new Date().toISOString()
    return withLocal((d) => {
      const row = { id: uid(), ...payload, created_at: now }
      d.items.push(row)
      return row
    })
  }
  // Giống createOrder: chủ quán đã đăng nhập (role `authenticated`) nên ĐƯỢC
  // select lại dòng vừa insert. Nhưng để nhất quán và tránh phụ thuộc policy,
  // ta tự sinh id rồi trả về object đã tạo.
  const row = { id: uuidV4(), ...payload }
  const { error } = await supabase.from('menu_items').insert(row)
  if (error) throw new Error(friendlyError(error, 'Thêm món'))
  return { ...row, created_at: new Date().toISOString() }
}

export async function updateMenuItem(id, item) {
  const payload = {
    name: item.name.trim(),
    price: Math.round(Number(item.price) || 0),
    description: (item.description || '').trim(),
    category: (item.category || '').trim(),
    is_available: item.is_available !== false,
    sort_order: Number(item.sort_order) || 0,
  }
  if (!supabase) {
    return withLocal((d) => {
      const i = d.items.findIndex((x) => x.id === id)
      if (i >= 0) d.items[i] = { ...d.items[i], ...payload }
      return d.items[i] || null
    })
  }
  const { data, error } = await supabase
    .from('menu_items')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật món'))
  return data
}

export async function toggleMenuItem(id, isAvailable) {
  if (!supabase) {
    return withLocal((d) => {
      const i = d.items.findIndex((x) => x.id === id)
      if (i >= 0) d.items[i].is_available = isAvailable
      return d.items[i] || null
    })
  }
  const { data, error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật trạng thái món'))
  return data
}

export async function deleteMenuItem(id) {
  if (!supabase) {
    return withLocal((d) => {
      d.items = d.items.filter((x) => x.id !== id)
      return true
    })
  }
  const { error } = await supabase.from('menu_items').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error, 'Xoá món'))
  return true
}

/* ---------------------------- ORDERS ---------------------------- */

export async function listOrders({ from, to } = {}) {
  if (!supabase) {
    let orders = readLocal().orders
    if (from) orders = orders.filter((o) => new Date(o.created_at) >= new Date(from))
    if (to) orders = orders.filter((o) => new Date(o.created_at) <= new Date(to))
    return orders.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }
  let q = supabase.from('orders').select('*').order('created_at', { ascending: false })
  if (from) q = q.gte('created_at', new Date(from).toISOString())
  if (to) q = q.lte('created_at', new Date(to).toISOString())
  const { data, error } = await q
  if (error) throw new Error(friendlyError(error, 'Tải danh sách đơn'))
  return data || []
}

/**
 * Tạo đơn. `items` là mảng { id, name, price, qty, note } đã chốt giá tại thời điểm đặt.
 *
 * Mỗi món có thể kèm `note` riêng (vd "không da gà, thêm ớt") — ghi chú này
 * lưu trong `items` (jsonb) nên KHÔNG cần đổi cấu trúc bảng `orders`.
 */
export async function createOrder(order) {
  const items = order.items.map((it) => ({
    id: it.id,
    name: it.name,
    price: Math.round(Number(it.price) || 0),
    qty: Math.max(1, Math.round(Number(it.qty) || 1)),
    // Ghi chú riêng cho món. Giới hạn 200 ký tự cho vừa máy in nhiệt 80mm.
    note: (it.note || '').trim().slice(0, 200),
  }))
  const total = items.reduce((s, it) => s + it.price * it.qty, 0)
  const payload = {
    code: order.code || randomOrderCode(),
    customer_name: (order.customer_name || '').trim(),
    customer_phone: (order.customer_phone || '').trim(),
    table_no: (order.table_no || '').trim(),
    note: (order.note || '').trim(),
    items,
    total,
    status: 'new',
  }
  if (!supabase) {
    const now = new Date().toISOString()
    return withLocal((d) => {
      const row = { id: uid(), ...payload, created_at: now, completed_at: null }
      d.orders.push(row)
      return row
    })
  }
  // KHÔNG dùng .insert(payload).select().single() ở đây!
  // Policy RLS cho `anon` chỉ cho phép INSERT vào bảng `orders`, KHÔNG cho phép
  // SELECT. Khi kèm .select(), PostgREST gửi `Prefer: return=representation`
  // -> Postgres phải đọc lại dòng vừa insert -> bị RLS chặn -> trả về lỗi
  // "new row violates row-level security policy" VÀ đơn KHÔNG được lưu.
  // Đây chính là lý do khách bấm "Xác nhận đặt món" bị báo lỗi dù đơn chưa
  // bao giờ vào bếp. Xem scripts/check-supabase.mjs để kiểm chứng.
  //
  // Ta tự sinh `id` (uuid v4) để có sẵn khóa chính, rồi tự dựng object trả về.
  const row = { id: uuidV4(), ...payload }
  const { error } = await supabase.from('orders').insert(row)
  if (error) throw new Error(friendlyError(error, 'Đặt hàng'))
  return { ...row, created_at: new Date().toISOString(), completed_at: null }
}

export async function updateOrderStatus(id, status) {
  const patch = {
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  }
  if (!supabase) {
    return withLocal((d) => {
      const i = d.orders.findIndex((x) => x.id === id)
      if (i >= 0) d.orders[i] = { ...d.orders[i], ...patch }
      return d.orders[i] || null
    })
  }
  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật đơn'))
  return data
}

export async function deleteOrder(id) {
  if (!supabase) {
    return withLocal((d) => {
      d.orders = d.orders.filter((x) => x.id !== id)
      return true
    })
  }
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error, 'Xoá đơn'))
  return true
}

/* --------------------------- SUMMARY ---------------------------- */

/**
 * Tổng kết số lượng từng món trong khoảng thời gian.
 * Đơn đã huỷ thì không tính; các đơn còn lại (mới / đang làm / hoàn thành) đều tính
 * vì khách đã đặt => bếp vẫn phải chuẩn bị.
 * Trả về: { rows: [{ id, name, qty, revenue }], totalQty, totalRevenue, orderCount }
 */
export async function summarize({ from, to } = {}) {
  const orders = await listOrders({ from, to })
  const map = new Map()
  let totalRevenue = 0
  let totalQty = 0
  let orderCount = 0

  for (const o of orders) {
    if (o.status === 'cancelled') continue
    orderCount += 1
    for (const it of o.items || []) {
      const key = it.id || it.name
      const row = map.get(key) || { id: key, name: it.name, qty: 0, revenue: 0 }
      row.qty += Number(it.qty) || 0
      row.revenue += (Number(it.price) || 0) * (Number(it.qty) || 0)
      map.set(key, row)
    }
    totalRevenue += Number(o.total) || 0
  }

  const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty)
  totalQty = rows.reduce((s, r) => s + r.qty, 0)
  return { rows, totalQty, totalRevenue, orderCount }
}
