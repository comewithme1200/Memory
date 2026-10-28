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

/* ------------------------------------------------------------------ *
 * TUỲ CHỌN MÓN (options) — kiểu GrabFood
 *
 * Cấu trúc:
 *   options (nhóm dùng chung)  ─┐
 *                                ├─ menu_item_option_groups (bảng trung gian)
 *   menu_items ─────────────────┘        │
 *                                         └─ menu_item_options (lựa chọn cụ thể)
 *
 * Ví dụ nhóm "Size" (dùng chung cho Phở và Bún bò):
 *   Size to    +5000
 *   Size vừa      0
 *   Size nhỏ   -5000
 *
 * Giá cuối = giá gốc của món + TỔNG price_delta của các tuỳ chọn đã chọn.
 * price_delta CÓ THỂ ÂM.
 * ------------------------------------------------------------------ */

// Tên nhóm tuỳ chọn dùng chung cho nhiều món (seed chế độ demo)
const SEED_OPTIONS = [
  { name: 'Size', description: 'Chọn cỡ phần ăn', is_multi: false },
  { name: 'Topping', description: 'Thêm món ăn kèm', is_multi: true },
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
        // Nhóm tuỳ chọn dùng chung
        options: SEED_OPTIONS.map((o) => ({
          id: uid(),
          ...o,
          created_at: new Date().toISOString(),
        })),
        // Lựa chọn cụ thể cho từng món
        menuItemOptions: [],
        // Liên kết món <-> nhóm tuỳ chọn
        menuItemOptionGroups: [],
      }
      writeLocal(seed)
      return seed
    }
    const parsed = JSON.parse(raw)
    return {
      items: parsed.items || [],
      orders: parsed.orders || [],
      customers: parsed.customers || [],
      options: parsed.options || [],
      menuItemOptions: parsed.menuItemOptions || [],
      menuItemOptionGroups: parsed.menuItemOptionGroups || [],
    }
  } catch {
    return {
      items: [],
      orders: [],
      customers: [],
      options: [],
      menuItemOptions: [],
      menuItemOptionGroups: [],
    }
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

/* --------------------------- OPTIONS ----------------------------- */

/**
 * Nhóm tuỳ chọn dùng chung (vd: Size, Topping).
 */
export async function listOptionGroups() {
  if (!supabase) {
    return readLocal().options.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }
  const { data, error } = await supabase
    .from('options')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw new Error(friendlyError(error, 'Tải danh sách nhóm tuỳ chọn'))
  return data || []
}

/**
 * Toàn bộ tuỳ chọn của 1 món, đã gom theo nhóm.
 *
 * Trả về: [{ id, name, is_multi, is_required, sort_order, choices: [...] }]
 *   choices: [{ id, name, price_delta, is_available, sort_order }]
 */
export async function listItemOptions(menuItemId) {
  if (!supabase) {
    const d = readLocal()
    const groups = d.menuItemOptionGroups
      .filter((g) => g.menu_item_id === menuItemId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return groups.map((g) => {
      const grp = d.options.find((o) => o.id === g.option_id)
      const choices = d.menuItemOptions
        .filter((o) => o.menu_item_id === menuItemId && o.option_id === g.option_id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      return {
        id: g.option_id,
        name: grp?.name || '',
        description: grp?.description || '',
        is_multi: grp?.is_multi !== false,
        is_required: g.is_required !== false,
        sort_order: g.sort_order ?? 0,
        choices,
      }
    })
  }

  // Lấy nhóm của món
  const { data: links, error: linkErr } = await supabase
    .from('menu_item_option_groups')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true })
  if (linkErr) {
    if (/does not exist|could not find|not found|schema cache/i.test(linkErr.message || '')) return []
    throw new Error(friendlyError(linkErr, 'Tải tuỳ chọn của món'))
  }
  if (!links?.length) return []

  // Lấy thông tin nhóm
  const groupIds = links.map((l) => l.option_id)
  const { data: groups, error: grpErr } = await supabase
    .from('options')
    .select('*')
    .in('id', groupIds)
  if (grpErr) throw new Error(friendlyError(grpErr, 'Tải nhóm tuỳ chọn'))

  // Lấy lựa chọn cụ thể
  const { data: choices, error: chErr } = await supabase
    .from('menu_item_options')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .in('option_id', groupIds)
    .order('sort_order', { ascending: true })
  if (chErr) throw new Error(friendlyError(chErr, 'Tải lựa chọn của món'))

  return links.map((l) => {
    const grp = (groups || []).find((g) => g.id === l.option_id)
    return {
      id: l.option_id,
      name: grp?.name || '',
      description: grp?.description || '',
      is_multi: grp?.is_multi !== false,
      is_required: l.is_required !== false,
      sort_order: l.sort_order ?? 0,
      choices: (choices || []).filter((c) => c.option_id === l.option_id),
    }
  })
}

/**
 * Tuỳ chọn của TẤT CẢ món — dùng cho trang quản trị (1 lần gọi, không gọi
 * lặp lại từng món để tránh N+1 request).
 *
 * Trả về: Map<menuItemId, groups[]>
 */
export async function listAllItemOptions() {
  if (!supabase) {
    const d = readLocal()
    const map = new Map()
    for (const item of d.items) {
      map.set(item.id, await listItemOptions(item.id))
    }
    return map
  }

  const { data: links, error: linkErr } = await supabase
    .from('menu_item_option_groups')
    .select('*')
  if (linkErr) {
    if (/does not exist|could not find|not found|schema cache/i.test(linkErr.message || '')) {
      return new Map()
    }
    throw new Error(friendlyError(linkErr, 'Tải tuỳ chọn'))
  }
  if (!links?.length) return new Map()

  const { data: groups } = await supabase.from('options').select('*')
  const { data: choices } = await supabase
    .from('menu_item_options')
    .select('*')
    .order('sort_order', { ascending: true })

  const map = new Map()
  for (const l of links) {
    const grp = (groups || []).find((g) => g.id === l.option_id)
    const list = map.get(l.menu_item_id) || []
    list.push({
      id: l.option_id,
      name: grp?.name || '',
      description: grp?.description || '',
      is_multi: grp?.is_multi !== false,
      is_required: l.is_required !== false,
      sort_order: l.sort_order ?? 0,
      choices: (choices || []).filter(
        (c) => c.menu_item_id === l.menu_item_id && c.option_id === l.option_id,
      ),
    })
    map.set(l.menu_item_id, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  return map
}

/** Tạo nhóm tuỳ chọn mới. */
export async function createOptionGroup(group) {
  const payload = {
    name: (group.name || '').trim().slice(0, 100),
    description: (group.description || '').trim().slice(0, 200),
    is_multi: group.is_multi === true,
  }
  if (!payload.name) throw new Error('Tên nhóm tuỳ chọn không được để trống.')
  if (!supabase) {
    return withLocal((d) => {
      const row = { id: uid(), ...payload, created_at: new Date().toISOString() }
      d.options.push(row)
      return row
    })
  }
  const row = { id: uuidV4(), ...payload }
  const { error } = await supabase.from('options').insert(row)
  if (error) throw new Error(friendlyError(error, 'Thêm nhóm tuỳ chọn'))
  return { ...row, created_at: new Date().toISOString() }
}

export async function updateOptionGroup(id, group) {
  const payload = {
    name: (group.name || '').trim().slice(0, 100),
    description: (group.description || '').trim().slice(0, 200),
    is_multi: group.is_multi === true,
  }
  if (!supabase) {
    return withLocal((d) => {
      const i = d.options.findIndex((x) => x.id === id)
      if (i >= 0) d.options[i] = { ...d.options[i], ...payload }
      return d.options[i] || null
    })
  }
  const { data, error } = await supabase
    .from('options')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật nhóm tuỳ chọn'))
  return data
}

export async function deleteOptionGroup(id) {
  if (!supabase) {
    return withLocal((d) => {
      d.options = d.options.filter((x) => x.id !== id)
      d.menuItemOptions = d.menuItemOptions.filter((x) => x.option_id !== id)
      d.menuItemOptionGroups = d.menuItemOptionGroups.filter((x) => x.option_id !== id)
      return true
    })
  }
  const { error } = await supabase.from('options').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error, 'Xoá nhóm tuỳ chọn'))
  return true
}

/**
 * Tạo lựa chọn cụ thể cho 1 món trong 1 nhóm.
 * `price_delta` có thể âm (vd size nhỏ -5000).
 */
export async function createItemOption(menuItemId, option) {
  const payload = {
    option_id: option.option_id,
    menu_item_id: menuItemId,
    name: (option.name || '').trim().slice(0, 100),
    price_delta: Math.round(Number(option.price_delta) || 0),
    is_available: option.is_available !== false,
    sort_order: Number(option.sort_order) || 0,
  }
  if (!payload.name) throw new Error('Tên lựa chọn không được để trống.')
  if (!supabase) {
    return withLocal((d) => {
      const row = { id: uid(), ...payload, created_at: new Date().toISOString() }
      d.menuItemOptions.push(row)
      return row
    })
  }
  const row = { id: uuidV4(), ...payload }
  const { error } = await supabase.from('menu_item_options').insert(row)
  if (error) throw new Error(friendlyError(error, 'Thêm lựa chọn'))
  return { ...row, created_at: new Date().toISOString() }
}

export async function updateItemOption(id, option) {
  const payload = {
    name: (option.name || '').trim().slice(0, 100),
    price_delta: Math.round(Number(option.price_delta) || 0),
    is_available: option.is_available !== false,
    sort_order: Number(option.sort_order) || 0,
  }
  if (!supabase) {
    return withLocal((d) => {
      const i = d.menuItemOptions.findIndex((x) => x.id === id)
      if (i >= 0) d.menuItemOptions[i] = { ...d.menuItemOptions[i], ...payload }
      return d.menuItemOptions[i] || null
    })
  }
  const { data, error } = await supabase
    .from('menu_item_options')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Cập nhật lựa chọn'))
  return data
}

export async function deleteItemOption(id) {
  if (!supabase) {
    return withLocal((d) => {
      d.menuItemOptions = d.menuItemOptions.filter((x) => x.id !== id)
      return true
    })
  }
  const { error } = await supabase.from('menu_item_options').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error, 'Xoá lựa chọn'))
  return true
}

/** Gắn 1 nhóm tuỳ chọn vào 1 món (bảng trung gian). */
export async function attachOptionGroup(menuItemId, optionId, { isRequired = false, sortOrder = 0 } = {}) {
  if (!supabase) {
    return withLocal((d) => {
      const existing = d.menuItemOptionGroups.find(
        (g) => g.menu_item_id === menuItemId && g.option_id === optionId,
      )
      if (existing) {
        existing.is_required = isRequired
        existing.sort_order = sortOrder
        return existing
      }
      const row = {
        menu_item_id: menuItemId,
        option_id: optionId,
        is_required: isRequired,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
      }
      d.menuItemOptionGroups.push(row)
      return row
    })
  }
  const { data, error } = await supabase
    .from('menu_item_option_groups')
    .upsert(
      { menu_item_id: menuItemId, option_id: optionId, is_required: isRequired, sort_order: sortOrder },
      { onConflict: 'menu_item_id,option_id' },
    )
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, 'Gắn nhóm tuỳ chọn'))
  return data
}

/** Gỡ 1 nhóm tuỳ chọn khỏi 1 món (không xoá nhóm/lựa chọn dùng chung). */
export async function detachOptionGroup(menuItemId, optionId) {
  if (!supabase) {
    return withLocal((d) => {
      d.menuItemOptionGroups = d.menuItemOptionGroups.filter(
        (g) => !(g.menu_item_id === menuItemId && g.option_id === optionId),
      )
      return true
    })
  }
  const { error } = await supabase
    .from('menu_item_option_groups')
    .delete()
    .eq('menu_item_id', menuItemId)
    .eq('option_id', optionId)
  if (error) throw new Error(friendlyError(error, 'Gỡ nhóm tuỳ chọn'))
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
      .select('id, order_id, menu_item_id, name_snapshot, price_snapshot, qty, note')
      .in('order_id', chunk)
      .order('created_at', { ascending: true })
    if (error) {
      // Bảng chưa tồn tại -> âm thầm dùng JSONB cũ.
      if (/does not exist|could not find|not found|schema cache/i.test(error.message || '')) return map
      throw new Error(friendlyError(error, 'Tải món của đơn'))
    }

    // Lấy tuỳ chọn của các dòng món vừa tải (bảng `order_item_options`).
    const itemIds = (data || []).map((r) => r.id)
    const optMap = await fetchOrderItemOptions(itemIds)

    for (const r of data || []) {
      const list = map.get(r.order_id) || []
      list.push({
        id: r.menu_item_id,
        name: r.name_snapshot,
        price: r.price_snapshot,
        qty: r.qty,
        note: r.note || '',
        options: optMap.get(r.id) || [],
      })
      map.set(r.order_id, list)
    }
  }
  return map
}

/**
 * Lấy tuỳ chọn của các dòng món, gom theo `order_item_id`.
 *
 * Trả về Map<orderItemId, options[]>.
 * Nếu bảng `order_item_options` chưa tồn tại (chưa chạy migration) -> Map rỗng,
 * app vẫn chạy bình thường (đơn không có tuỳ chọn).
 */
async function fetchOrderItemOptions(orderItemIds) {
  const map = new Map()
  if (!orderItemIds.length) return map

  const CHUNK = 100
  for (let i = 0; i < orderItemIds.length; i += CHUNK) {
    const chunk = orderItemIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('order_item_options')
      .select('order_item_id, option_id, menu_item_option_id, name_snapshot, price_delta_snapshot')
      .in('order_item_id', chunk)
      .order('created_at', { ascending: true })
    if (error) {
      // Bảng chưa tồn tại -> không có tuỳ chọn, vẫn hiển thị đơn bình thường.
      if (/does not exist|could not find|not found|schema cache/i.test(error.message || '')) return map
      throw new Error(friendlyError(error, 'Tải tuỳ chọn của đơn'))
    }
    for (const r of data || []) {
      const list = map.get(r.order_item_id) || []
      list.push({
        option_id: r.option_id,
        menu_item_option_id: r.menu_item_option_id,
        name: r.name_snapshot,
        price_delta: r.price_delta_snapshot,
      })
      map.set(r.order_item_id, list)
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

  // Tuỳ chọn khách chọn, gom theo index dòng món.
  //
  // `line` PHẢI đánh số TỪ 1 — khớp với `with ordinality` trong RPC
  // `create_order` (Postgres đánh số phần tử mảng JSON từ 1).
  // Nếu gửi từ 0, mọi tuỳ chọn bị lệch 1 dòng: dòng N nhận tuỳ chọn của
  // dòng N+1, và dòng cuối mất sạch tuỳ chọn -> tính sai giá.
  const itemOptions = (order.itemOptions || [])
    .map((entry, index) => ({
      line: index + 1,
      options: (entry?.options || []).map((o) => ({
        optionId: o.option_id || o.optionId || null,
        menuItemOptionId: o.menu_item_option_id || o.menuItemOptionId || null,
        name: o.name || '',
        priceDelta: Math.round(Number(o.price_delta ?? o.priceDelta) || 0),
      })),
    }))
    .filter((e) => e.options.length > 0)

  const payload = {
    code: order.code || randomOrderCode(),
    customer_name: (order.customer_name || '').trim(),
    customer_phone: (order.customer_phone || '').trim(),
    customer_address: (order.customer_address || '').trim(),
    table_no: (order.table_no || '').trim(),
    note: (order.note || '').trim(),
    items,
    itemOptions,
    total,
    status: 'new',
    // Cách thanh toán khách chọn: 'cash' (tiền mặt) | 'transfer' (chuyển khoản).
    payment_method: order.payment_method === 'transfer' ? 'transfer' : 'cash',
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
    // Bản mới nhất (10 tham số): thêm cách thanh toán + địa chỉ + token + tuỳ chọn
    {
      p_code: payload.code,
      p_customer_name: payload.customer_name,
      p_customer_phone: payload.customer_phone,
      p_customer_address: payload.customer_address,
      p_table_no: payload.table_no,
      p_note: payload.note,
      p_items: payload.items,
      p_customer_token: payload.customer_token,
      p_payment_method: payload.payment_method,
      p_item_options: payload.itemOptions,
    },
    // Bản 9 tham số: có địa chỉ + token khách quen + tuỳ chọn
    {
      p_code: payload.code,
      p_customer_name: payload.customer_name,
      p_customer_phone: payload.customer_phone,
      p_customer_address: payload.customer_address,
      p_table_no: payload.table_no,
      p_note: payload.note,
      p_items: payload.items,
      p_customer_token: payload.customer_token,
      p_item_options: payload.itemOptions,
    },
    // Bản 8 tham số: có địa chỉ + token, chưa có tuỳ chọn
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
    // Sai chữ ký / hàm chưa có trong cache -> thử bản tiếp theo.
    //
    // PostgREST trả về CÙNG một câu cho cả 2 trường hợp:
    //   "Could not find the function public.create_order(...) in the schema cache"
    // nên KHÔNG thể phân biệt bằng message. Ta cứ thử hết các bản; nếu bản
    // nào khớp sẽ chạy được. Hết cách -> return null -> caller fallback
    // sang đường insert thẳng (xem createOrder).
    if (/does not exist|could not find|not found|schema cache|unknown function|invalid input/i.test(msg)) {
      continue
    }
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
    payment_method: payload.payment_method,
    is_paid: false,
    created_at: new Date().toISOString(),
    completed_at: null,
  }

  // Phiên bản mới: server trả về jsonb đầy đủ
  if (typeof data === 'object' && data !== null && data.id) {
    const serverItems = Array.isArray(data.items) && data.items.length ? data.items : payload.items
    return {
      ...base,
      id: data.id,
      code: data.code || payload.code,
      total: Number(data.total) || 0,
      payment_method: data.payment_method || payload.payment_method,
      is_paid: data.is_paid === true,
      items: serverItems.map((it, i) => ({
        ...it,
        // Server đã trả kèm `options` (đã chốt giá). Nếu không có (bản cũ),
        // gắn lại options client gửi lên để hoá đơn vẫn hiển thị đúng.
        options: Array.isArray(it.options) && it.options.length
          ? it.options
          : payload.itemOptions[i]?.options || [],
      })),
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

/**
 * Cập nhật trạng thái thanh toán của đơn (chủ quán tick tay).
 *
 * @param {string} id
 * @param {boolean} isPaid  true = đã thu tiền, false = chưa thu
 */
export async function updateOrderPayment(id, isPaid) {
  const patch = { is_paid: Boolean(isPaid) }
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
  if (error) throw new Error(friendlyError(error, 'Cập nhật thanh toán'))
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
