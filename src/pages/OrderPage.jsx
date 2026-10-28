import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listMenu, createOrder, getCustomerByToken } from '../lib/db.js'
import { fmtVND, uid } from '../lib/format.js'

const CART_KEY = 'quan-an-sang:cart'

/**
 * Ngưỡng cảnh báo: TỔNG số món trong giỏ ĐẠT ngưỡng này thì hiện banner.
 * Tính trên TỔNG số phần của cả giỏ (không phải từng dòng), để tách dòng
 * hay gộp dòng thì cảnh báo vẫn đúng.
 */
const QTY_WARN_THRESHOLD = 16

/* ------------------------------------------------------------------ *
 * MÔ HÌNH GIỎ HÀNG
 *
 * Giỏ là MỘT MẢNG các dòng. Mỗi dòng = 1 phần món + ghi chú riêng.
 * Dùng mảng (không phải object) để có thể chèn dòng mới NGAY SAU dòng đang
 * xử lý, thay vì nhảy xuống cuối danh sách.
 *
 *   [
 *     { key, itemId, qty, note },
 *     ...
 *   ]
 *
 * Ví dụ khách mua cùng 1 món 2 phần, mỗi phần ghi chú khác nhau:
 *
 *   Phở bò tái  x1  "không da gà"
 *   Phở bò tái  x1  "thêm ớt, nhiều hành"
 *
 * Dữ liệu cũ (trước đây lưu dạng object { [id_món]: { qty, note } })
 * vẫn đọc được nhờ hàm chuẩn hoá bên dưới.
 * ------------------------------------------------------------------ */
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cart, setCart] = useState(loadCart)
  const [activeCat, setActiveCat] = useState('all')

  // ---- Khách quen đến từ QR ---------------------------------------
  // Token nằm trong query của HashRouter: `#/?qr=<token>`.
  // Khi có token hợp lệ -> lấy tên/SĐT/địa chỉ từ DB rồi điền sẵn vào form.
  const [searchParams, setSearchParams] = useSearchParams()
  const qrToken = searchParams.get('qr') || ''
  const [customer, setCustomer] = useState(null)
  const [qrNotice, setQrNotice] = useState('')

  useEffect(() => {
    if (!qrToken) {
      setCustomer(null)
      setQrNotice('')
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
      })
      .catch(() => {
        if (!alive) return
        setQrNotice('Không kiểm tra được mã QR — bạn vui lòng nhập thông tin.')
      })
    return () => {
      alive = false
    }
  }, [qrToken])

  useEffect(() => {
    listMenu()
      .then(setMenu)
      .catch((e) => setError(e.message || 'Không tải được danh mục món'))
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
   * Thêm món vào giỏ.
   * - Nếu đã có dòng CÙNG MÓN và dòng đó CHƯA có ghi chú -> tăng số lượng dòng đó
   *   (mua 2 phần cùng món mà không cần ghi chú khác nhau -> gộp 1 dòng).
   * - Ngược lại -> tạo dòng MỚI ở cuối, để khách ghi chú riêng.
   */
  const addToCart = (itemId) => {
    update((prev) => {
      const idx = prev.findIndex((v) => v.itemId === itemId && !v.note.trim())
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { key: uid(), itemId, qty: 1, note: '' }]
    })
  }

  /**
   * ĐẶT SỐ LƯỢNG cho 1 MÓN (dùng ở thẻ món ngoài trang thực đơn).
   *
   * Món có thể nằm ở nhiều dòng (do đã tách riêng). Khi khách nhập số N:
   *   - N <= 0  -> bỏ hết món đó khỏi giỏ.
   *   - N > 0   -> gộp: đặt dòng ĐẦU TIÊN của món đó thành N, và xoá các
   *                dòng còn lại của món đó (ghi chú của dòng đầu được giữ).
   *                -> tổng số lượng của món luôn đúng bằng N.
   */
  const setQtyOfItem = (itemId, rawValue) => {
    const n = Math.floor(Number(rawValue))
    if (!Number.isFinite(n)) return

    update((prev) => {
      const idxs = prev.map((v, i) => (v.itemId === itemId ? i : -1)).filter((i) => i >= 0)
      if (idxs.length === 0) return prev

      const next = [...prev]

      if (n <= 0) {
        for (const i of idxs.reverse()) next.splice(i, 1)
        return next
      }

      // Giữ dòng đầu tiên, đặt qty = n, gộp các dòng còn lại vào đó
      const first = idxs[0]
      next[first] = { ...next[first], qty: n }
      for (const i of idxs.slice(1).reverse()) next.splice(i, 1)
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
   * - Nhập <= 0    -> xoá dòng khỏi giỏ (giống bấm "−" tới 0).
   *
   * Ghi chú của dòng sẽ áp cho TẤT CẢ các phần của dòng đó — giao diện hiển
   * thị cảnh báo "Ghi chú này áp dụng cho cả N phần" cho khách biết trước.
   * Nếu khách muốn mỗi phần một ghi chú khác nhau -> dùng nút "＋ Tách riêng".
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

  // Ghi chú riêng cho từng DÒNG (vd "không da gà, thêm ớt")
  const setNote = (lineKey, note) => {    update((prev) => {
      const idx = prev.findIndex((v) => v.key === lineKey)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], note }
      return next
    })
  }

  /**
   * "Tách riêng" — tách 1 phần từ dòng này ra thành dòng MỚI ngay BÊN DƯỚI,
   * để khách ghi chú khác.
   *
   * CHỈ tách được khi dòng có qty > 1:
   * - qty > 1: bớt 1 phần khỏi dòng này, tạo dòng mới qty = 1 ngay bên dưới
   *            (tổng số phần KHÔNG đổi — đúng nghĩa "tách").
   * - qty = 1: không còn phần nào để tách -> KHÔNG làm gì. Muốn mua thêm 1 phần
   *            cùng món thì bấm "+" (nút Thêm), dòng mới sẽ tự tách ra.
   */
  const splitLine = (lineKey) => {
    update((prev) => {
      const idx = prev.findIndex((v) => v.key === lineKey)
      if (idx < 0) return prev
      const cur = prev[idx]
      if (cur.qty <= 1) return prev // qty = 1: không có phần nào để tách

      const next = [...prev]
      next[idx] = { ...cur, qty: cur.qty - 1 }
      // Chèn NGAY SAU dòng hiện tại (không nhảy xuống cuối danh sách)
      next.splice(idx + 1, 0, { key: uid(), itemId: cur.itemId, qty: 1, note: '' })
      return next
    })
  }

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
        return item ? { ...item, ...v } : null
      })
      .filter(Boolean)
  }, [cart, menu])

  const total = cartItems.reduce((s, it) => s + it.price * it.qty, 0)
  const totalQty = cartItems.reduce((s, it) => s + it.qty, 0)

  return (
    <div className="page">
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
        <div className="chips">
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
        <div className="grid-menu">
          {visible.map((m) => {
            const qty = qtyByItem[m.id] || 0
            return (
              <div key={m.id} className={`card dish ${m.is_available ? '' : 'dish-off'}`}>
                <div className="dish-head">
                  <h3>{m.name}</h3>
                  <span className="price">{fmtVND(m.price)}</span>
                </div>
                {m.description && <p className="dish-desc">{m.description}</p>}
                {m.category && <span className="tag">{m.category}</span>}
                {m.is_available ? (
                  <div className="stepper">
                    {qty > 0 && (
                      <button
                        className="btn-step"
                        onClick={() => removeOneOfItem(m.id)}
                        title="Bỏ 1 phần khỏi giỏ"
                        aria-label={`Bỏ 1 phần ${m.name} khỏi giỏ`}
                      >
                        −
                      </button>
                    )}
                    {qty > 0 ? (
                      <QtyInput
                        value={qty}
                        name={m.name}
                        onCommit={(n) => setQtyOfItem(m.id, n)}
                      />
                    ) : (
                      <span className="qty-empty">0</span>
                    )}
                    <button className="btn-step btn-add" onClick={() => addToCart(m.id)}>
                      {qty > 0 ? '+ Thêm' : '+ Thêm vào giỏ'}
                    </button>
                  </div>
                ) : (
                  <div className="sold-out">Hết hàng</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {cartItems.length > 0 && (
        <CartBar
          cartItems={cartItems}
          total={total}
          totalQty={totalQty}
          onChange={changeQty}
          onSetQty={setQty}
          onNote={setNote}
          onSplit={splitLine}
          customer={customer}
          qrToken={qrToken}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------------------- */

function CartBar({
  cartItems,
  total,
  totalQty,
  onChange,
  onSetQty,
  onNote,
  onSplit,
  customer,
  qrToken,
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [table, setTable] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  /**
   * Section "Thông tin khách" mặc định THU GỌN.
   * - Đã điền đủ (tên + địa chỉ) -> vẫn thu gọn, hiện tóm tắt 1 dòng.
   * - Chưa điền -> thu gọn, và bấm "Xác nhận đặt món" sẽ MỞ RA + báo lỗi.
   */
  const [infoOpen, setInfoOpen] = useState(false)
  const [infoTouched, setInfoTouched] = useState(false)

  // Khách quen -> điền sẵn thông tin (chỉ lần đầu, không ghi đè nếu khách sửa)
  const prefillDone = useRef(false)
  useEffect(() => {
    if (prefillDone.current) return
    if (!customer) return
    prefillDone.current = true
    setName((v) => v || customer.name || '')
    setPhone((v) => v || customer.phone || '')
    setAddress((v) => v || customer.address || '')
  }, [customer])

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
      const order = await createOrder({
        customer_name: name,
        customer_phone: phone,
        customer_address: address,
        customer_token: qrToken,
        table_no: table,
        note,
        items: cartItems.map((c) => ({
          id: c.id,
          name: c.name,
          price: c.price,
          qty: c.qty,
          note: c.note, // ghi chú riêng của phần này (vd "không da gà, thêm ớt")
        })),
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
                      <strong>{it.name}</strong>
                      <span className="muted">{fmtVND(it.price)} / món</span>
                      <input
                        className="cart-note-input"
                        value={it.note || ''}
                        onChange={(e) => onNote(it.key, e.target.value)}
                        placeholder="Ghi chú cho phần này (không bắt buộc)…"
                        maxLength={200}
                      />
                      {it.note?.trim() && it.qty > 1 && (
                        <span className="cart-note-warn">
                          ⚠ Ghi chú này áp dụng cho cả {it.qty} phần
                        </span>
                      )}
                      {it.note?.trim() && it.qty === 1 && (
                        <span className="cart-note-hint">Có ghi chú cho phần này</span>
                      )}
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
                      {it.qty > 1 && (
                        <button
                          className="btn-split"
                          onClick={() => onSplit(it.key)}
                          title="Tách 1 phần thành dòng riêng để ghi chú khác"
                        >
                          ＋ Tách riêng
                        </button>
                      )}
                    </div>

                    <div className="cart-row-total">{fmtVND(it.price * it.qty)}</div>
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
                      <label>Số bàn (nếu có)</label>
                      <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="Bàn 5" />
                    </div>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Ghi chú cho bếp (áp dụng cho cả đơn)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ít cay, thêm nước sốt..."
                  rows={2}
                />
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
