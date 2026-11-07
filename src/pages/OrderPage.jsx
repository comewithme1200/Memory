import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listMenu, listAllItemOptions, createOrder, getCustomerByToken } from '../lib/db.js'
import { fmtVND, uid, dateKey } from '../lib/format.js'
import DishAddModal from '../components/DishAddModal.jsx'
import BankQr from '../components/BankQr.jsx'

const CART_KEY = 'quan-an-sang:cart:v2'

/**
 * Khoá lưu token QR trong sessionStorage.
 *
 * VÌ SAO CẦN?
 *   URL của QR là `#/?qr=<token>` — token nằm trong QUERY của hash route.
 *   Khi khách đặt xong và bấm "Đặt đơn khác", app điều hướng tới
 *   `#/dat-hang/thanh-cong` -> token biến mất khỏi URL -> quay lại trang
 *   đặt món thì KHÔNG còn `?qr=` -> mất toàn bộ thông tin điền sẵn
 *   (tên / SĐT / địa chỉ).
 *
 *   Lưu token vào sessionStorage giúp khôi phục lại khi quay về trang đặt
 *   món. sessionStorage (không phải localStorage) vì token là "vé mời" của
 *   riêng khách đó — đóng tab là hết, không lưu lâu trên máy.
 */
const QR_KEY = 'quan-an-sang:qr-token'

/**
 * Khoá lưu THÔNG TIN KHÁCH đã điền (tên / SĐT / địa chỉ / giờ nhận hàng).
 *
 *   Sau khi đặt xong, khách bấm "Đặt đơn khác" -> quay lại trang đặt món.
 *   Form là state của component nên bị mount lại -> mất sạch thông tin đã
 *   nhập (kể cả khi khách KHÔNG quét QR mà tự gõ tay).
 *
 *   Lưu vào sessionStorage -> lần sau mở lại trang đặt món, thông tin được
 *   điền lại. Dùng sessionStorage (không phải localStorage) vì đây là dữ liệu
 *   của phiên đặt hàng, đóng tab là hết.
 */
const CUSTOMER_INFO_KEY = 'quan-an-sang:customer-info'

/**
 * Ngưỡng cảnh báo: TỔNG số món trong giỏ ĐẠT ngưỡng này thì hiện banner.
 * Tính trên TỔNG số phần của cả giỏ (không phải từng dòng), để tách dòng
 * hay gộp dòng thì cảnh báo vẫn đúng.
 */
const QTY_WARN_THRESHOLD = 16

/* ------------------------------------------------------------------ *
 * MÔ HÌNH GIỎ HÀNG
 *
 * Giỏ là MỘT MẢNG các dòng. Mỗi dòng = 1 phần món + ghi chú riêng
 * + các TUỲ CHỌN riêng (kiểu GrabFood).
 *
 *   [
 *     {
 *       key,                 // id tạm của dòng
 *       itemId,              // id món
 *       qty,                 // số lượng
 *       note,                // ghi chú riêng
 *       options: [           // các tuỳ chọn đã chọn
 *         { id, option_id, name, price_delta }
 *       ]
 *     },
 *     ...
 *   ]
 *
 * MỖI LẦN BẤM "+ Thêm" TẠO MỘT DÒNG RIÊNG (kiểu GrabFood).
 * Không gộp dòng nào cả — kể cả khi khách chọn y hệt nhau. Nhờ vậy
 * mỗi dòng có ghi chú + options riêng, không cần nút "Tách riêng".
 *
 * Dữ liệu cũ (trước đây lưu dạng object { [id_món]: { qty, note } })
 * vẫn đọc được nhờ hàm chuẩn hoá bên dưới.
 * ------------------------------------------------------------------ */

/** Khoá so sánh 2 bộ tuỳ chọn (dùng để so sánh nhanh 2 dòng trong giỏ). */
const optionsKey = (options) =>
  (options || [])
    .map((o) => o.id)
    .sort()
    .join('|')

const normalizeCart = (raw) => {
  const out = []

  const push = (key, v, fallbackItemId) => {
    const itemId = typeof v.itemId === 'string' ? v.itemId : fallbackItemId
    if (!itemId) return
    const qty = Math.max(0, Math.round(Number(v.qty) || 0))
    if (qty <= 0) return
    out.push({
      key: key || uid(),
      itemId,
      qty,
      note: typeof v.note === 'string' ? v.note : '',
      options: Array.isArray(v.options)
        ? v.options.map((o) => ({
            id: o.id,
            option_id: o.option_id || null,
            menu_item_option_id: o.menu_item_option_id || null,
            name: o.name || '',
            price_delta: Math.round(Number(o.price_delta) || 0),
          }))
        : [],
    })
  }

  if (Array.isArray(raw)) {
    // định dạng mới: mảng các dòng
    for (const v of raw) {
      if (v && typeof v === 'object') push(v.key, v, null)
    }
  } else if (raw && typeof raw === 'object') {
    // định dạng cũ: khoá chính là id món
    for (const [key, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue
      push(key, v, key)
    }
  }

  return out
}

const loadCart = () => {
  try {
    const raw = localStorage.getItem(CART_KEY)
    return raw ? normalizeCart(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

const saveCart = (cart) => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart))
  } catch {
    /* ignore */
  }
}

export default function OrderPage() {
  const [menu, setMenu] = useState([])
  const [optionsByItem, setOptionsByItem] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cart, setCart] = useState(loadCart)
  const [activeCat, setActiveCat] = useState('all')

  // ---- MODAL THÊM MÓN (kiểu GrabFood) --------------------------------
  // `addModal` = { mode: 'add' | 'edit', item, lineKey }
  //   mode 'add' -> thêm món mới vào giỏ
  //   mode 'edit'-> sửa options/ghi chú của 1 dòng đã có trong giỏ
  const [addModal, setAddModal] = useState(null)

  // ---- Khách quen đến từ QR ---------------------------------------
  // Token nằm trong query của HashRouter: `#/?qr=<token>`.
  // Khi có token hợp lệ -> lấy tên/SĐT/địa chỉ từ DB rồi điền sẵn vào form.
  //
  // KHÔI PHỤC TOKEN KHI QUAY LẠI TRANG:
  //   Sau khi đặt xong, app điều hướng sang `#/dat-hang/thanh-cong` -> token
  //   biến mất khỏi URL. Bấm "Đặt đơn khác" -> quay lại `#/` cũng không có
  //   `?qr=` -> KHÁCH MẤT toàn bộ thông tin đã điền sẵn.
  //
  //   Vì vậy: token được ghi vào sessionStorage ngay khi đọc được từ URL,
  //   và khi vào trang mà URL KHÔNG có `?qr=`, ta lấy lại token đã lưu và
  //   ghi ngược vào URL (`setSearchParams`) để mọi thứ hoạt động như cũ.
  const [searchParams, setSearchParams] = useSearchParams()
  const qrToken = searchParams.get('qr') || ''
  const [customer, setCustomer] = useState(null)
  const [qrNotice, setQrNotice] = useState('')
  // Đã tra cứu xong khách quen (thành công hoặc thất bại) chưa.
  const [customerResolved, setCustomerResolved] = useState(false)

  // Khôi phục token đã lưu khi URL không có `?qr=`.
  // Chạy 1 lần khi mount (và mỗi khi token trong URL đổi).
  useEffect(() => {
    if (qrToken) {
      try {
        sessionStorage.setItem(QR_KEY, qrToken)
      } catch {
        /* bỏ qua (trình duyệt chặn storage) */
      }
      return
    }
    let saved = ''
    try {
      saved = sessionStorage.getItem(QR_KEY) || ''
    } catch {
      saved = ''
    }
    if (!saved) return
    // Ghi lại vào URL để trạng thái "khách quen" nhất quán (và để copy link
    // / F5 vẫn giữ được thông tin điền sẵn).
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('qr', saved)
      return next
    }, { replace: true })
  }, [qrToken, setSearchParams])

  useEffect(() => {
    if (!qrToken) {
      setCustomer(null)
      setQrNotice('')
      setCustomerResolved(true)
      return
    }
    let alive = true
    getCustomerByToken(qrToken)
      .then((c) => {
        if (!alive) return
        if (c) {
          setCustomer(c)
          setQrNotice(`Xin chào ${c.name}! Thông tin đã điền sẵn cho bạn.`)
        } else {
          setCustomer(null)
          setQrNotice('Mã QR không hợp lệ hoặc đã hết hạn — bạn vui lòng nhập thông tin.')
        }
        setCustomerResolved(true)
      })
      .catch(() => {
        if (!alive) return
        setQrNotice('Không kiểm tra được mã QR — bạn vui lòng nhập thông tin.')
        setCustomerResolved(true)
      })
    return () => {
      alive = false
    }
  }, [qrToken])

  useEffect(() => {
    Promise.all([listMenu(), listAllItemOptions()])
      .then(([items, optMap]) => {
        setMenu(items)
        setOptionsByItem(optMap)
      })
      .catch((e) => setError(e.message || 'Không tải được danh sách món'))
      .finally(() => setLoading(false))
  }, [])

  // Dùng updater hàm để tránh lỗi "stale state" khi bấm nhanh nhiều lần
  const update = (fn) => {
    setCart((prev) => {
      const next = fn(prev)
      saveCart(next)
      return next
    })
  }

  /**
   * Thêm món vào giỏ — LUÔN tạo dòng MỚI (kiểu GrabFood).
   *
   * Không gộp với dòng cũ, dù khách chọn y hệt. Mỗi lần bấm "+ Thêm" là
   * 1 dòng riêng -> mỗi dòng có ghi chú + options riêng của nó.
   */
  const addToCart = (itemId, options = [], note = '', qty = 1) => {
    const n = Math.max(1, Math.floor(Number(qty) || 1))
    update((prev) => [...prev, { key: uid(), itemId, qty: n, note, options }])
  }

  /**
   * Xác nhận modal thêm món.
   * - mode 'add' -> thêm dòng MỚI vào giỏ.
   * - mode 'edit'-> sửa dòng đang có trong giỏ (options/ghi chú/số lượng).
   */
  const confirmAdd = ({ options, note, qty }) => {
    if (!addModal) return
    if (addModal.mode === 'edit') {
      update((prev) => {
        const idx = prev.findIndex((v) => v.key === addModal.lineKey)
        if (idx < 0) return prev
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          qty: Math.max(1, Math.floor(Number(qty) || 1)),
          note,
          options,
        }
        return next
      })
    } else {
      addToCart(addModal.item.id, options, note, qty)
    }
    setAddModal(null)
  }

  /**
   * ĐẶT SỐ LƯỢNG cho 1 MÓN (từ ô input trên thẻ món).
   *
   * Món có thể nằm ở nhiều dòng (mỗi dòng 1 bộ options/ghi chú riêng).
   * Nên KHÔNG gộp các dòng lại — làm vậy sẽ mất options của dòng bị xoá.
   * Thay vào đó:
   *   - TĂNG số lượng -> cộng thêm vào dòng CUỐI CÙNG (giữ nguyên options).
   *   - GIẢM số lượng -> bớt dần từ dòng cuối về đầu; dòng nào về 0 thì
   *     xoá hẳn dòng đó.
   *   - N <= 0 -> xoá hết các dòng của món đó.
   *
   * Tổng số phần của món luôn đúng bằng N, và không mất tuỳ chọn nào.
   */
  const setQtyOfItem = (itemId, rawValue) => {
    const n = Math.floor(Number(rawValue))
    if (!Number.isFinite(n)) return

    update((prev) => {
      const idxs = prev.map((v, i) => (v.itemId === itemId ? i : -1)).filter((i) => i >= 0)
      if (idxs.length === 0) return prev

      const next = [...prev]
      const current = idxs.reduce((s, i) => s + next[i].qty, 0)

      if (n <= 0) {
        for (const i of idxs.reverse()) next.splice(i, 1)
        return next
      }

      const diff = n - current
      if (diff === 0) return prev

      if (diff > 0) {
        // Cộng thêm vào dòng cuối cùng -> giữ nguyên options của dòng đó
        const last = idxs[idxs.length - 1]
        next[last] = { ...next[last], qty: next[last].qty + diff }
        return next
      }

      // Giảm: bớt từ dòng cuối về đầu
      let need = -diff
      for (const i of idxs.slice().reverse()) {
        if (need <= 0) break
        const q = next[i].qty
        if (q <= need) {
          need -= q
          next.splice(i, 1)
        } else {
          next[i] = { ...next[i], qty: q - need }
          need = 0
        }
      }
      return next
    })
  }

  /**
   * Bỏ 1 phần món từ THẺ MÓN trên danh sách (nút "−").
   *
   * Món có thể nằm ở nhiều dòng (do đã tách riêng). Ta bỏ từ dòng CUỐI CÙNG
   * trong số các dòng của món đó — thường là dòng mới nhất, chưa ghi chú.
   * Nếu bỏ hết -> dòng đó biến mất khỏi giỏ.
   */
  const removeOneOfItem = (itemId) => {
    update((prev) => {
      let idx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].itemId === itemId) {
          idx = i
          break
        }
      }
      if (idx < 0) return prev

      const next = [...prev]
      const qty = next[idx].qty - 1
      if (qty <= 0) next.splice(idx, 1)
      else next[idx] = { ...next[idx], qty }
      return next
    })
  }

  /**
   * Tăng/giảm số lượng của 1 DÒNG trong giỏ. Giảm về 0 -> xoá dòng.
   */
  const changeQty = (lineKey, delta) => {
    update((prev) => {
      const idx = prev.findIndex((v) => v.key === lineKey)
      if (idx < 0) return prev
      const cur = prev[idx]
      const next = [...prev]

      const qty = cur.qty + delta
      if (qty <= 0) next.splice(idx, 1)
      else next[idx] = { ...cur, qty }
      return next
    })
  }

  /**
   * ĐẶT SỐ LƯỢNG TRỰC TIẾP (từ ô input).
   *
   * - Nhập số >= 1 -> đặt qty của dòng đó bằng số đó.
   * - Nhập số <= 0  -> xoá dòng khỏi giỏ (giống bấm "−" tới 0).
   */
  const setQty = (lineKey, rawValue) => {
    const n = Math.floor(Number(rawValue))
    if (!Number.isFinite(n)) return

    update((prev) => {
      const idx = prev.findIndex((v) => v.key === lineKey)
      if (idx < 0) return prev
      const cur = prev[idx]
      const next = [...prev]

      // <= 0 -> xoá dòng
      if (n <= 0) {
        next.splice(idx, 1)
        return next
      }

      if (n === cur.qty) return prev
      next[idx] = { ...cur, qty: n }
      return next
    })
  }

  /**
   * "Tách riêng" — KHÔNG CÒN DÙNG nữa.
   *
   * Mỗi lần bấm "+ Thêm" giờ đã tạo 1 dòng riêng (kiểu GrabFood) nên khách
   * không cần tách thủ công. Hàm này giữ lại để dữ liệu cũ trong localStorage
   * không bị hỏng, nhưng không được gọi từ giao diện.
   */
  const splitLine = () => {}

  const categories = useMemo(() => {
    const set = new Set(menu.map((m) => m.category).filter(Boolean))
    return ['all', ...Array.from(set)]
  }, [menu])

  const visible = useMemo(() => {
    if (activeCat === 'all') return menu
    return menu.filter((m) => m.category === activeCat)
  }, [menu, activeCat])

  // Tổng số lượng của 1 món trong giỏ (dùng để hiển thị trên thẻ món)
  const qtyByItem = useMemo(() => {
    const map = {}
    for (const v of cart) {
      map[v.itemId] = (map[v.itemId] || 0) + v.qty
    }
    return map
  }, [cart])

  const cartItems = useMemo(() => {
    return cart
      .map((v) => {
        const item = menu.find((m) => m.id === v.itemId)
        if (!item) return null
        // Giá 1 phần = giá gốc + tổng price_delta của tuỳ chọn đã chọn
        const optDelta = (v.options || []).reduce((s, o) => s + (Number(o.price_delta) || 0), 0)
        return { ...item, ...v, unitPrice: item.price + optDelta, options: v.options || [] }
      })
      .filter(Boolean)
  }, [cart, menu])

  const total = cartItems.reduce((s, it) => s + it.unitPrice * it.qty, 0)
  const totalQty = cartItems.reduce((s, it) => s + it.qty, 0)

  return (
    <div className="page page-mobile">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🍜</span>
          <div>
            <h1>{import.meta.env.VITE_SHOP_NAME || 'Quán Ăn Sáng'}</h1>
            <p className="brand-sub">Đặt món nhanh – Nhận món ngon</p>
          </div>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {qrNotice && (
        <div className={`alert ${customer ? 'alert-success' : 'alert-warn'}`}>
          {customer ? '👋' : '⚠'}
          <div>
            <div>{qrNotice}</div>
            {customer?.address && (
              <div className="qr-greet-sub">
                Địa chỉ: {customer.address}
                {customer.phone ? ` · ${customer.phone}` : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {categories.length > 1 && (
        <div className="chips chips-scroll">
          {categories.map((c) => (
            <button
              key={c}
              className={`chip ${activeCat === c ? 'chip-active' : ''}`}
              onClick={() => setActiveCat(c)}
            >
              {c === 'all' ? 'Tất cả' : c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="empty">Đang tải thực đơn…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          Chưa có món nào. Hãy thêm món trong trang quản trị.
        </div>
      ) : (
        /* DỌC TỪ TRÊN XUỐNG DƯỚI — 1 cột, giống app đặt món trên điện thoại */
        <div className="dish-list">
          {visible.map((m) => (
            <DishCard
              key={m.id}
              item={m}
              qty={qtyByItem[m.id] || 0}
              groups={optionsByItem.get(m.id) || []}
              onAdd={() => setAddModal({ mode: 'add', item: m })}
              onRemove={() => removeOneOfItem(m.id)}
              onSetQty={(n) => setQtyOfItem(m.id, n)}
            />
          ))}
        </div>
      )}

      {cartItems.length > 0 && (
        <CartBar
          cartItems={cartItems}
          total={total}
          totalQty={totalQty}
          onChange={changeQty}
          onSetQty={setQty}
          onEdit={(line) =>
            setAddModal({
              mode: 'edit',
              item: line,
              lineKey: line.key,
              initial: { options: line.options, note: line.note, qty: line.qty },
            })
          }
          customer={customer}
          qrToken={qrToken}
        />
      )}

      {addModal && (
        <DishAddModal
          item={addModal.item}
          groups={optionsByItem.get(addModal.item.id) || []}
          initial={addModal.initial}
          onCancel={() => setAddModal(null)}
          onConfirm={confirmAdd}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------------------- *
 * THẺ MÓN — 1 món, xếp dọc.
 * Bấm "+ Thêm" -> mở MODAL chọn tuỳ chọn + ghi chú (kiểu GrabFood).
 * --------------------------------------------------------------- */
function DishCard({ item, qty, groups, onAdd, onRemove, onSetQty }) {
  // Tên các nhóm bắt buộc -> hiển thị gợi ý nhỏ dưới tên món
  const requiredNames = groups.filter((g) => g.is_required).map((g) => g.name)
  // Món có tuỳ chọn -> giá hiển thị là "từ giá"
  const hasOptions = groups.length > 0

  return (
    <article className={`card dish dish-row ${item.is_available ? '' : 'dish-off'}`}>
      <div className="dish-row-head">
        <div className="dish-row-info">
          <h3 className="dish-name">{item.name}</h3>
          {item.description && <p className="dish-desc">{item.description}</p>}
          <div className="dish-meta">
            <span className="price">{hasOptions ? 'Từ ' : ''}{fmtVND(item.price)}</span>
            {item.category && <span className="tag">{item.category}</span>}
          </div>
          {requiredNames.length > 0 && (
            <div className="dish-req">Bắt buộc chọn: {requiredNames.join(', ')}</div>
          )}
        </div>

        {item.is_available ? (
          /* Số lượng hiển thị ở đây là TỔNG số phần của món đang có trong giỏ.
             Gõ số lớn ở đây sẽ TĂNG dòng cuối cùng (giữ nguyên options). */
          <div className="stepper stepper-row">
            {qty > 0 && (
              <button
                className="btn-step"
                onClick={onRemove}
                title="Bỏ 1 phần khỏi giỏ"
                aria-label={`Bỏ 1 phần ${item.name} khỏi giỏ`}
              >
                −
              </button>
            )}
            {qty > 0 ? (
              <QtyInput value={qty} name={item.name} onCommit={onSetQty} />
            ) : (
              /* Chừa chỗ trống để "+ Thêm" không bị nhảy khi món có trong giỏ.
                 Trước đây hiện số "0" ở đây -> gây rối mắt, KHÔNG mang
                 thông tin gì (món chưa chọn thì qty luôn = 0). */
              <span className="qty-empty" aria-hidden="true" />
            )}
            <button
              className="btn-step btn-add"
              onClick={() => onAdd()}
              title="Thêm vào giỏ (chọn tuỳ chọn + ghi chú)"
            >
              + Thêm
            </button>
          </div>
        ) : (
          <div className="sold-out">Hết hàng</div>
        )}
      </div>
    </article>
  )
}

/* --------------------------------------------------------------- */

function CartBar({
  cartItems,
  total,
  totalQty,
  onChange,
  onSetQty,
  onEdit,
  customer,
  qrToken,
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  /**
   * Thời gian khách MUỐN NHẬN HÀNG (tuỳ chọn).
   *
   * Quán làm TAKE AWAY -> không có "số bàn". Thay vào đó khách có thể chỉ
   * định giờ muốn nhận (vd "12:30"). Bỏ trống = nhận càng sớm càng tốt.
   *
   * Lưu dạng chuỗi "HH:MM" trong state, gửi lên server dạng ISO.
   */
  const [pickupTime, setPickupTime] = useState('')

  // Cách thanh toán: 'cash' (tiền mặt) | 'transfer' (chuyển khoản)
  const [paymentMethod, setPaymentMethod] = useState('cash')

  /**
   * Section "Thông tin khách" mặc định THU GỌN.
   * - Đã điền đủ (tên + địa chỉ) -> vẫn thu gọn, hiện tóm tắt 1 dòng.
   * - Chưa điền -> thu gọn, và bấm "Xác nhận đặt món" sẽ MỞ RA + báo lỗi.
   */
  const [infoOpen, setInfoOpen] = useState(false)
  const [infoTouched, setInfoTouched] = useState(false)

  // Khách quên -> điền sẵn thông tin (chỉ lần đầu, không ghi đè nếu khách sửa)
  const prefillDone = useRef(false)
  useEffect(() => {
    if (prefillDone.current) return
    if (!customer) return
    prefillDone.current = true
    setName((v) => v || customer.name || '')
    setPhone((v) => v || customer.phone || '')
    setAddress((v) => v || customer.address || '')
  }, [customer])

  /**
   * Khôi phục thông tin khách đã nhập ở LẦN TRƯỚC (cùng phiên).
   *
   *   Không có cơ chế này thì: đặt xong -> "Đặt đơn khác" -> form được mount
   *   lại -> các ô tên / SĐT / địa chỉ / giờ nhận hàng trống trơn, dù khách
   *   KHÔNG quét QR mà gõ tay.
   *
   *   Ưu tiên: dữ liệu QR (đã prefill ở trên) > dữ liệu phiên cũ.
   */
  const restoredInfo = useRef(false)
  useEffect(() => {
    if (restoredInfo.current) return
    if (!customerResolved) return // chờ tra cứu QR xong mới quyết định ưu tiên
    restoredInfo.current = true
    let saved = null
    try {
      const raw = sessionStorage.getItem(CUSTOMER_INFO_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch {
      saved = null
    }
    if (!saved || typeof saved !== 'object') return
    setName((v) => v || saved.name || '')
    setPhone((v) => v || saved.phone || '')
    setAddress((v) => v || saved.address || '')
    setPickupTime((v) => v || saved.pickupTime || '')
  }, [customerResolved, customer])

  // Lưu thông tin khách mỗi khi thay đổi -> giữ cho lần đặt hàng tiếp theo.
  useEffect(() => {
    if (!name && !phone && !address) return
    try {
      sessionStorage.setItem(
        CUSTOMER_INFO_KEY,
        JSON.stringify({ name, phone, address, pickupTime }),
      )
    } catch {
      /* bỏ qua (trình duyệt chặn storage) */
    }
  }, [name, phone, address, pickupTime])

  // Đã đủ thông tin chưa? (tên + địa chỉ)
  const infoComplete = Boolean(name.trim() && address.trim())
  const infoMissing = !name.trim() || !address.trim()

  // Cảnh báo dựa trên TỔNG số phần trong cả giỏ (tách/gộp dòng vẫn đúng)
  const overLimit = totalQty >= QTY_WARN_THRESHOLD
  const navigate = useNavigate()

  const submit = async () => {
    if (!name.trim()) {
      setErr('Vui lòng nhập tên để bếp gọi cho bạn.')
      setInfoOpen(true)
      setInfoTouched(true)
      return
    }
    if (!address.trim()) {
      setErr('Vui lòng nhập địa chỉ để chúng tôi giao món.')
      setInfoOpen(true)
      setInfoTouched(true)
      return
    }
    setErr('')
    setSending(true)
    try {
      // "HH:MM" -> ISO đầy đủ (giờ địa phương) để server lưu timestamptz.
      // Nếu khách không chọn giờ -> null = "nhận càng sớm càng tốt".
      //
      // Nếu giờ đã chọn ĐÃ QUA trong ngày hôm nay (vd lúc 14:00 khách
      // chọn 09:00) -> hiểu là khách muốn nhận 9:00 SÁNG MAI, chứ không phải
      // một mốc thời gian nằm trong quá khứ.
      let pickupIso = null
      if (pickupTime) {
        const base = new Date(`${dateKey(new Date())}T${pickupTime}:00`)
        if (Number.isNaN(base.getTime())) {
          pickupIso = null
        } else if (base.getTime() <= Date.now()) {
          base.setDate(base.getDate() + 1)
          pickupIso = base.toISOString()
        } else {
          pickupIso = base.toISOString()
        }
      }

      const order = await createOrder({
        customer_name: name,
        customer_phone: phone,
        customer_address: address,
        customer_token: qrToken,
        pickup_time: pickupIso,
        note,
        payment_method: paymentMethod,
        items: cartItems.map((c) => ({
          id: c.id,
          name: c.name,
          // Giá đã gồm tuỳ chọn — server sẽ tự tra lại từ DB.
          price: c.unitPrice,
          qty: c.qty,
          note: c.note, // ghi chú riêng của phần này (vd "không da gà, thêm ớt")
        })),
        // Tuỳ chọn theo đúng thứ tự dòng món (index khớp với `items`).
        itemOptions: cartItems.map((c) => ({ options: c.options || [] })),
      })
      saveCart([])
      navigate('/dat-hang/thanh-cong', { state: { order } })
    } catch (e) {
      setErr(e.message || 'Đặt hàng thất bại, vui lòng thử lại.')
      setSending(false)
    }
  }

  return (
    <>
      <div className="cartbar">
        <div className="cartbar-info">
          <strong>{totalQty} món</strong>
          <span>{fmtVND(total)}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Xem giỏ &amp; đặt hàng
        </button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Giỏ hàng</h2>
              <button className="btn-icon" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              {overLimit && (
                <div className="alert alert-warn">
                  <span className="alert-warn-icon">⚠</span>
                  <div>
                    <strong>Số lượng có vẻ quá lớn</strong>
                    <div className="alert-warn-body">
                      Giỏ hiện có <strong>{totalQty} món</strong> — từ {QTY_WARN_THRESHOLD} món
                      trở lên được cảnh báo.
                      <div className="alert-warn-hint">
                        Vui lòng kiểm tra lại — số lượng lớn có thể nhầm. Liên hệ quán nếu cần
                        đặt số lượng lớn hơn.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="cart-list">
                {cartItems.map((it) => (
                  <div key={it.key} className="cart-row">
                    <div className="cart-row-main">
                      <div className="cart-row-title">
                        <strong>{it.name}</strong>
                        <button
                          className="btn-edit"
                          onClick={() => onEdit(it)}
                          title="Sửa tuỳ chọn / ghi chú của phần này"
                        >
                          ✏️ Sửa
                        </button>
                      </div>
                      {it.options?.length > 0 && (
                        <div className="cart-opts">
                          {it.options.map((o) => (
                            <span key={o.id} className="cart-opt">
                              {o.name}
                              {o.price_delta !== 0 && (
                                <em className={o.price_delta < 0 ? 'opt-minus' : ''}>
                                  {o.price_delta > 0 ? '+' : '−'}
                                  {fmtVND(Math.abs(o.price_delta))}
                                </em>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {it.note?.trim() && (
                        <div className="cart-note-view">📝 {it.note}</div>
                      )}
                      <span className="muted">{fmtVND(it.unitPrice)} / món</span>
                    </div>

                    <div className="cart-row-side">
                      <div className="stepper stepper-sm">
                        <button
                          className="btn-step"
                          onClick={() => onChange(it.key, -1)}
                          title="Bỏ 1 phần"
                          aria-label={`Bỏ 1 phần ${it.name}`}
                        >
                          −
                        </button>
                        <QtyInput value={it.qty} name={it.name} onCommit={(n) => onSetQty(it.key, n)} />
                        <button
                          className="btn-step"
                          onClick={() => onChange(it.key, 1)}
                          title="Thêm 1 phần"
                          aria-label={`Thêm 1 phần ${it.name}`}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="cart-row-total">{fmtVND(it.unitPrice * it.qty)}</div>
                  </div>
                ))}
              </div>

              {/* ---- SECTION THÔNG TIN KHÁCH (thu gọn mặc định) ---- */}
              <div className={`info-box ${infoOpen ? 'info-box-open' : ''} ${infoMissing && infoTouched ? 'info-box-error' : ''}`}>
                <button
                  type="button"
                  className="info-head"
                  onClick={() => setInfoOpen((v) => !v)}
                  aria-expanded={infoOpen}
                >
                  <span className="info-head-left">
                    <span className="info-head-title">
                      Thông tin giao hàng {infoComplete ? '✓' : '*'}
                    </span>
                    {infoComplete ? (
                      <span className="info-head-summary">
                        {name} · {address}
                        {pickupTime ? ` · nhận lúc ${pickupTime}` : ''}
                      </span>
                    ) : (
                      <span className="info-head-summary info-head-summary-warn">
                        Thiếu {[!name.trim() && 'tên', !address.trim() && 'địa chỉ'].filter(Boolean).join(' và ')}
                      </span>
                    )}
                  </span>
                  <span className="info-caret">{infoOpen ? '▲' : '▼'}</span>
                </button>

                {infoOpen && (
                  <div className="info-body">
                    {customer && (
                      <div className="info-prefill">
                        ✓ Đã điền sẵn từ mã QR của bạn
                      </div>
                    )}
                    <div className="field">
                      <label>Tên của bạn *</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nguyễn Văn A"
                      />
                    </div>
                    <div className="field">
                      <label>Số điện thoại</label>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="0909 000 000"
                        inputMode="tel"
                      />
                    </div>
                    <div className="field">
                      <label>Địa chỉ giao hàng *</label>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="123 Nguyễn Văn A, Quận 1"
                      />
                    </div>
                    <div className="field">
                      <label>Thời gian muốn nhận hàng (tuỳ chọn)</label>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={(e) => setPickupTime(e.target.value)}
                        placeholder="Bỏ trống = nhận càng sớm càng tốt"
                      />
                      <div className="muted small">
                        Quán làm take away — bạn muốn nhận món lúc mấy giờ? Bỏ trống nếu muốn nhận
                        sớm nhất có thể.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Ghi chú cho bếp (áp dụng cho cả đơn)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>

              {/* ---- CHỌN CÁCH THANH TOÁN ---- */}
              <div className="pay-box">
                <div className="pay-head">Cách thanh toán</div>
                <div className="pay-choices">
                  <button
                    type="button"
                    className={`pay-choice ${paymentMethod === 'cash' ? 'pay-choice-on' : ''}`}
                    onClick={() => setPaymentMethod('cash')}
                  >
                    <span className="pay-choice-icon">💵</span>
                    <span className="pay-choice-label">Tiền mặt</span>
                  </button>
                  <button
                    type="button"
                    className={`pay-choice ${paymentMethod === 'transfer' ? 'pay-choice-on' : ''}`}
                    onClick={() => setPaymentMethod('transfer')}
                  >
                    <span className="pay-choice-icon">🏦</span>
                    <span className="pay-choice-label">Chuyển khoản</span>
                  </button>
                </div>

                {paymentMethod === 'transfer' && (
                  <div className="pay-transfer">
                    <BankQr size={200} />
                    <div className="pay-transfer-hint">
                      <strong>Quét mã để chuyển khoản</strong>
                      <div className="muted small">
                        Chuyển đúng số tiền <strong>{fmtVND(total)}</strong> rồi bấm "Xác nhận
                        đặt món". Quán sẽ kiểm tra và báo bạn.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {err && <div className="alert alert-error">{err}</div>}

              <div className="modal-total">
                <span>Tổng cộng</span>
                <strong>{fmtVND(total)}</strong>
              </div>
            </div>

            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Quay lại
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={sending}>
                {sending ? 'Đang gửi…' : 'Xác nhận đặt món'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* --------------------------------------------------------------- *
 * Ô NHẬP SỐ LƯỢNG
 *
 * Người dùng gõ trực tiếp -> cập nhật giỏ ngay (không cần bấm nút).
 * Ô này giữ state cục bộ (text) để hỗ trợ việc "xoá sạch rồi gõ lại":
 * khi text rỗng / không phải số thì KHÔNG gửi lên giỏ (tránh xoá nhầm
 * dòng khi người dùng đang xoá để gõ số mới). Khi rời ô mà text vẫn rỗng
 * thì khôi phục lại số cũ.
 * --------------------------------------------------------------- */
function QtyInput({ value, onCommit, name }) {
  const [text, setText] = useState(String(value))
  const textRef = useRef(String(value))
  textRef.current = text

  // Đồng bộ khi giá trị đổi từ bên ngoài (bấm +/−, tách dòng, thêm món...).
  // CHỈ bỏ qua khi người dùng đang gõ dở (ô rỗng hoặc số chưa hợp lệ) —
  // lúc đó không được ghi đè ký tự họ đang nhập.
  useEffect(() => {
    const t = textRef.current.trim()
    const isMidEdit = t === '' || !Number.isFinite(Number(t)) || Number(t) < 0
    if (isMidEdit) return
    setText(String(value))
  }, [value])

  const commit = (raw) => {
    const s = String(raw).trim()
    if (s === '') return // đang xoá dở -> chưa gửi gì lên giỏ
    const n = Math.floor(Number(s))
    if (!Number.isFinite(n) || n < 0) return
    // n = 0 -> bỏ món/dòng đó khỏi giỏ (giống bấm "−" tới 0)
    if (n !== value) onCommit(n)
  }

  const onChange = (e) => {
    const raw = e.target.value
    setText(raw)
    commit(raw)
  }

  const onBlur = () => {
    // Rời ô mà text rỗng / lỗi -> trả về giá trị cũ
    const s = text.trim()
    if (s === '' || !Number.isFinite(Number(s)) || Number(s) < 0) {
      setText(String(value))
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  return (
    <input
      className="qty-input"
      type="number"
      inputMode="numeric"
      min="0"
      max="999"
      step="1"
      value={text}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      aria-label={`Số lượng ${name}`}
      title="Nhập số lượng trực tiếp"
    />
  )
}
