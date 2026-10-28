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
        customers: [],
      }
      writeLocal(seed)
      return seed
    }
    const parsed = JSON.parse(raw)
    return {
      items: parsed.items || [],
      orders: parsed.orders || [],
      customers: parsed.customers || [],
    }
  } catch {
    return { items: [], orders: [], customers: [] }
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

export async function listOrders({ from, to, limit } = {}) {
  if (!supabase) {
    let orders = readLocal().orders
    if (from) orders = orders.filter((o) => new Date(o.created_at) >= new Date(from))
    if (to) orders = orders.filter((o) => new Date(o.created_at) <= new Date(to))
    orders = orders.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return limit ? orders.slice(0, limit) : orders
  }
  let q = supabase.from('orders').select('*').order('created_at', { ascending: false })
  if (from) q = q.gte('created_at', new Date(from).toISOString())
  if (to) q = q.lte('created_at', new Date(to).toISOString())
  // Giới hạn số đơn tải về: trang đơn hàng tự làm mới mỗi 15s, tải toàn bộ
  // lịch sử sẽ nặng dần theo thời gian.
  if (limit) q = q.limit(limit)
  const { data, error } = await q
  if (error) throw new Error(friendlyError(error, 'Tải danh sách đơn'))
  const orders = data || []
  if (orders.length === 0) return orders

  // Gắn món từ bảng trung gian `order_items`.
  // Nếu bảng này chưa tồn tại (chưa chạy migration) -> dùng luôn JSONB cũ.
  const byOrder = await fetchOrderItems(orders.map((o) => o.id))
  return orders.map((o) => {
    const items = byOrder.get(o.id)
    // `items` rỗng -> đơn cũ chưa được migrate -> đọc JSONB legacy
    if (!items || items.length === 0) return o
    return { ...o, items }
  })
}

/**
 * Lấy dòng món của các đơn từ bảng `order_items`, gom theo order_id.
 *
 * Trả về Map<orderId, items[]> với items đã đổi tên cột cho khớp giao diện:
 *   name_snapshot -> name, price_snapshot -> price.
 *
 * Nếu bảng `order_items` chưa tồn tại (chưa chạy migration) -> Map rỗng,
 * caller tự fallback sang JSONB `orders.items`.
 */
async function fetchOrderItems(orderIds) {
  const map = new Map()
  if (!orderIds.length) return map

  // Chia nhỏ danh sách id: URL query có giới hạn độ dài, `.in()` với hàng
  // nghìn uuid sẽ tạo URL quá dài -> PostgREST trả lỗi 414.
  const CHUNK = 100
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, menu_item_id, name_snapshot, price_snapshot, qty, note')
      .in('order_id', chunk)
      .order('created_at', { ascending: true })
    if (error) {
      // Bảng chưa tồn tại -> âm thầm dùng JSONB cũ.
      if (/does not exist|could not find|not found|schema cache/i.test(error.message || '')) return map
      throw new Error(friendlyError(error, 'Tải món của đơn'))
    }
    for (const r of data || []) {
      const list = map.get(r.order_id) || []
      list.push({
        id: r.menu_item_id,
        name: r.name_snapshot,
        price: r.price_snapshot,
        qty: r.qty,
        note: r.note || '',
      })
      map.set(r.order_id, list)
    }
  }
  return map
}

/**
 * Tạo đơn. `items` là mảng { id, name, price, qty, note } đã chốt giá tại thời điểm đặt.
 *
 * Mỗi món có thể kèm `note` riêng (vd "không da gà, thêm ớt").
 *
 * Nơi lưu:
 * - Supabase: RPC `create_order` -> ghi vào bảng trung gian `order_items`
 *   (mỗi dòng món là 1 row, có `name_snapshot` / `price_snapshot` chốt giá).
 * - Local (demo): mảng JSON trong localStorage.
 *
 * Cột `orders.items` (jsonb) vẫn được giữ làm legacy để rollback an toàn.
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
    customer_address: (order.customer_address || '').trim(),
    table_no: (order.table_no || '').trim(),
    note: (order.note || '').trim(),
    items,
    total,
    status: 'new',
    // Token khách quen (từ QR). Server dùng nó để lấy thông tin trong DB.
    customer_token: (order.customer_token || '').trim(),
  }
  if (!supabase) {
    // Chế độ demo (localStorage): tự tra cứu khách quen theo token.
    // Ở chế độ Supabase, việc này do RPC create_order làm trên server —
    // đó là nơi chuẩn hoá dữ liệu, không tin giá/thông tin từ client.
    if (payload.customer_token) {
      const c = readLocal().customers.find(
        (x) => x.qr_token === payload.customer_token && x.is_active !== false,
      )
      if (c) {
        payload.customer_name = payload.customer_name || c.name || ''
        payload.customer_phone = payload.customer_phone || c.phone || ''
        payload.customer_address = payload.customer_address || c.address || ''
        payload.customer_id = c.id
      }
    }
    const now = new Date().toISOString()
    return withLocal((d) => {
      const row = { id: uid(), ...payload, created_at: now, completed_at: null }
      d.orders.push(row)
      return row
    })
  }

  // --- Đường mới: RPC create_order (ghi orders + order_items trong 1 transaction)
  // Nếu hàm RPC chưa được tạo trong DB (chưa chạy migration), ta phát hiện
  // và dùng đường cũ (insert thẳng vào bảng orders) để app vẫn chạy được.
  const viaRpc = await tryCreateOrderRpc(payload)
  if (viaRpc) return viaRpc

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

/**
 * Gọi RPC `create_order` — đường ưu tiên (bảng trung gian `order_items`).
 *
 * Trả về `null` nếu hàm RPC chưa tồn tại trong DB (chưa chạy
 * `supabase/migration-order-items.sql`) -> caller dùng đường insert thẳng.
 *
 * LƯU Ý: KHÔNG dùng `.select()` sau `.rpc()`.
 * PostgREST gửi `Prefer: return=representation` -> Postgres phải đọc lại dòng
 * vừa insert -> policy của `anon` không cho SELECT bảng `orders` -> RLS chặn
 * -> đơn KHÔNG được lưu.
 *
 * HÀM CÓ 2 PHIÊN BẢN (tự phát hiện theo hình dạng kết quả):
 *   - Cũ: trả về `uuid` (chỉ id đơn). Ta tự dựng object, tổng tiền lấy từ
 *     client -> có thể lệch nếu giá món đã đổi.
 *   - MỚI: trả về `jsonb` { id, code, total, items } — server đã tính sẵn
 *     và chốt tên/giá -> client hiển thị khớp 100% với DB.
 */
async function tryCreateOrderRpc(payload) {
  // Hàm có 3 phiên bản (tự phát hiện qua lỗi của PostgREST):
  //   1. KHÔNG CÓ hàm           -> `does not exist` -> fallback insert thẳng
  //   2. CŨ (6 tham số)         -> không nhận p_customer_address / p_customer_token
  //   3. MỚI (8 tham số)        -> có địa chỉ + token khách quen
  // Thử bản mới trước; nếu báo lỗi về tham số -> thử bản cũ.
  const attempts = [
    {
      p_code: payload.code,
      p_customer_name: payload.customer_name,
      p_customer_phone: payload.customer_phone,
      p_customer_address: payload.customer_address,
      p_table_no: payload.table_no,
      p_note: payload.note,
      p_items: payload.items,
      p_customer_token: payload.customer_token,
    },
    {
      p_code: payload.code,
      p_customer_name: payload.customer_name,
      p_customer_phone: payload.customer_phone,
      p_table_no: payload.table_no,
      p_note: payload.note,
      p_items: payload.items,
    },
  ]

  let data = null
  for (const args of attempts) {
    const res = await supabase.rpc('create_order', args)
    if (!res.error) {
      data = res.data
      break
    }
    const msg = res.error.message || ''
    // Hàm không tồn tại -> fallback đường cũ.
    if (/does not exist|could not find|not found|schema cache/i.test(msg)) return null
    // Sai danh sách tham số -> thử bản tiếp theo.
    if (/function .*create_order.*does not exist|unknown function|invalid input/i.test(msg)) continue
    throw new Error(friendlyError(res.error, 'Đặt hàng'))
  }
  if (!data) return null

  const base = {
    code: payload.code,
    customer_name: payload.customer_name,
    customer_phone: payload.customer_phone,
    customer_address: payload.customer_address,
    table_no: payload.table_no,
    note: payload.note,
    status: 'new',
    created_at: new Date().toISOString(),
    completed_at: null,
  }

  // Phiên bản mới: server trả về jsonb đầy đủ
  if (typeof data === 'object' && data !== null && data.id) {
    return {
      ...base,
      id: data.id,
      code: data.code || payload.code,
      total: Number(data.total) || 0,
      items: Array.isArray(data.items) && data.items.length ? data.items : payload.items,
    }
  }

  // Phiên bản cũ: server trả về uuid
  return {
    ...base,
    id: data,
    items: payload.items,
    total: payload.total,
  }
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
 *
 * ƯU TIÊN: RPC `summarize_orders` -> GROUP BY ngay trong SQL, KHÔNG tải đơn về JS.
 * Nếu hàm chưa tồn tại (chưa chạy migration) -> fallback gom trong JS.
 */
export async function summarize({ from, to } = {}) {
  if (supabase) {
    const { data, error } = await supabase.rpc('summarize_orders', {
      p_from: from ? new Date(from).toISOString() : null,
      p_to: to ? new Date(to).toISOString() : null,
    })
    if (!error && data) {
      const rows = (data.rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        qty: Number(r.qty) || 0,
        revenue: Number(r.revenue) || 0,
      }))
      return {
        rows,
        totalQty: Number(data.totalQty) || 0,
        totalRevenue: Number(data.totalRevenue) || 0,
        orderCount: Number(data.orderCount) || 0,
      }
    }
    // Hàm chưa tồn tại -> rơi xuống đường gom trong JS bên dưới.
    if (error && !/does not exist|could not find|not found|schema cache/i.test(error.message || '')) {
      throw new Error(friendlyError(error, 'Tổng kết số lượng'))
    }
  }

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

/* -------------------------- CUSTOMERS ----------------------------- */

/**
 * Khách quen — chủ quán lưu thông tin + sinh QR.
 *
 * Mỗi khách có 1 `qr_token` (chuỗi ngẫu nhiên). Token nằm trong URL của QR:
 *   https://<domain>/#/?qr=<token>
 * Khi khách quét, app gọi RPC `customer_by_token` để lấy tên/SĐT/địa chỉ
 * rồi điền sẵn vào form đặt món.
 *
 * Lưu ý bảo mật: token là "vé mời" — ai có token thì lấy được thông tin khách
 * đó. Vì vậy KHÔNG nhúng thẳng SĐT/địa chỉ vào URL (vừa dài vừa lộ thông tin).
 */
export async function listCustomers() {
  if (!supabase) {
    return readLocal().customers.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(friendlyError(error, 'Tải danh sách khách quen'))
  return data || []
}

export async function createCustomer(customer) {
  const payload = {
    name: (customer.name || '').trim().slice(0, 200),
    phone: (customer.phone || '').trim().slice(0, 50),
    address: (customer.address || '').trim().slice(0, 500),
    note: (customer.note || '').trim().slice(0, 500),
    is_active: customer.is_active !== false,
  }
  if (!supabase) {
    return withLocal((d) => {
      const row = {
        id: uid(),
        ...payload,
        qr_token: localToken(),
        created_at: new Date().toISOString(),
      }
      d.customers.push(row)
      return row
    })
  }
  // Tự sinh token ở client để có token ngay, rồi insert.
  const row = { id: uuidV4(), ...payload, qr_token: localToken() }
  const { error } = await supabase.from('customers').insert(row)
  if (error) throw new Error(friendlyError(error, 'Thêm khách quen'))
  return { ...row, created_at: new Date().toISOString() }
}

export async function updateCustomer(id, customer) {
  const payload = {
    name: (customer.name || '').trim().slice(0, 200),
    phone: (customer.phone || '').trim().slice(0, 50),
    address: (customer.address || '').trim().slice(0, 500),
    note: (customer.note || '').trim().slice(0, 500),
    is_active: customer.is_active !== false,
  }
  if (!supabase) {
    return withLocal((d) => {
      const i = d.customers.findIndex((x) => x.id === id)
      if (i >= 0) d.customers[i] = { ...d.customers[i], ...payload }
      return d.customers[i] || null
    })
  }
  const { data, error } = await supabase
    .from('customers')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật khách quen'))
  return data
}

export async function deleteCustomer(id) {
  if (!supabase) {
    return withLocal((d) => {
      d.customers = d.customers.filter((x) => x.id !== id)
      return true
    })
  }
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error, 'Xoá khách quen'))
  return true
}

/**
 * Sinh lại token (khi khách bị mất QR / token bị lộ).
 * Token cũ ngay lập tức không dùng được.
 */
export async function regenerateCustomerToken(id) {
  const token = localToken()
  if (!supabase) {
    return withLocal((d) => {
      const i = d.customers.findIndex((x) => x.id === id)
      if (i >= 0) d.customers[i].qr_token = token
      return d.customers[i] || null
    })
  }
  const { data, error } = await supabase
    .from('customers')
    .update({ qr_token: token })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Tạo lại mã QR'))
  return data
}

/**
 * Lấy thông tin khách quen từ token trong QR.
 *
 * Dùng RPC `customer_by_token` (security definer) vì khách (anon) không được
 * đọc bảng `customers` — chỉ được đọc đúng 1 khách mà mình có token.
 *
 * Trả về `null` nếu token sai / khách đã bị tắt.
 */
export async function getCustomerByToken(token) {
  const t = String(token || '').trim()
  if (!t) return null

  if (!supabase) {
    return readLocal().customers.find((c) => c.qr_token === t && c.is_active !== false) || null
  }

  const { data, error } = await supabase.rpc('customer_by_token', { p_token: t })
  if (error) {
    if (/does not exist|could not find|not found|schema cache/i.test(error.message || '')) return null
    throw new Error(friendlyError(error, 'Lấy thông tin khách'))
  }
  return data || null
}

/** Sinh token ngẫu nhiên (dùng lúc tạo khách quen). */
const localToken = () => {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
