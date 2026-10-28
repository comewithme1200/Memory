import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listOrders, updateOrderStatus, deleteOrder, updateOrderPayment } from '../lib/db.js'
import { fmtVND, fmtTime } from '../lib/format.js'
import Invoice from '../components/Invoice.jsx'
import PrintPortal from '../components/PrintPortal.jsx'

const STATUS = {
  new: { label: 'Mới', cls: 'badge-new' },
  preparing: { label: 'Đang làm', cls: 'badge-prep' },
  done: { label: 'Hoàn thành', cls: 'badge-ok' },
  cancelled: { label: 'Đã huỷ', cls: 'badge-off' },
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('active')
  const [preview, setPreview] = useState(null) // xem trước trong modal
  const [printing, setPrinting] = useState(null) // đang in (mở hộp thoại in)

  /**
   * Tải lại danh sách đơn. TRẢ VỀ mảng đơn đã gắn món.
   *
   * Quan trọng: mảng trả về là nguồn đúng để in hoá đơn, vì `listOrders()`
   * mới gắn món từ bảng `order_items` vào mỗi đơn. Dữ liệu trả về trực tiếp
   * từ `updateOrderStatus()` là dòng thô của bảng `orders` — KHÔNG có
   * `items` -> in ra hoá đơn trống món.
   */
  const reload = useCallback(
    () =>
      listOrders({ limit: 200 })
        .then((list) => {
          setOrders(list)
          return list
        })
        .catch((e) => {
          setError(e.message || 'Không tải được danh đơn')
          return []
        })
        .finally(() => setLoading(false)),
    [],
  )

  useEffect(() => {
    reload()
    // tự làm mới mỗi 15s để bếp thấy đơn mới ngay
    const t = setInterval(reload, 15000)
    return () => clearInterval(t)
  }, [reload])

  const setStatus = async (id, status) => {
    try {
      await updateOrderStatus(id, status)
      // Nạp lại và LẤY ĐƯỢC BẢN ĐƠN CÓ MÓN từ kết quả reload.
      const list = await reload()
      // Hoàn thành đơn -> in hoá đơn ngay (bản có món + tuỳ chọn + ghi chú).
      if (status === 'done') {
        const full = list.find((o) => o.id === id)
        if (full) {
          setPrinting(full)
        } else {
          setError('Không tìm thấy đơn để in. Hãy bấm "In lại" trong danh sách.')
        }
      }
    } catch (e) {
      setError(e.message)
    }
  }

  const onDelete = async (id) => {
    if (!window.confirm('Xoá đơn này?')) return
    try {
      await deleteOrder(id)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return orders
    if (filter === 'active') return orders.filter((o) => o.status === 'new' || o.status === 'preparing')
    return orders.filter((o) => o.status === filter)
  }, [orders, filter])

  const counts = useMemo(() => {
    return {
      new: orders.filter((o) => o.status === 'new').length,
      preparing: orders.filter((o) => o.status === 'preparing').length,
      done: orders.filter((o) => o.status === 'done').length,
    }
  }, [orders])

  /**
   * "🔥 Món cần làm" — gom tất cả món của các đơn CHƯA XONG
   * (đang `new` hoặc `preparing`) theo tên món, cộng dồn số lượng.
   *
   * Đơn nào chuyển sang `done`/`cancelled` -> tự động biến mất khỏi bảng
   * (vì danh sách được tính lại mỗi lần reload). Không cần thao tác thủ công.
   */
  const kitchen = useMemo(() => {
    const map = new Map()
    for (const o of orders) {
      if (o.status !== 'new' && o.status !== 'preparing') continue
      for (const it of o.items || []) {
        const key = it.id || it.name
        const row = map.get(key) || {
          id: key,
          name: it.name,
          price: Number(it.price) || 0,
          qty: 0,
          notes: [],
          orders: [],
        }
        row.qty += Number(it.qty) || 0
        // Gom ghi chú của các phần cùng món (tránh trùng lặp).
        const note = (it.note || '').trim()
        if (note && !row.notes.includes(note)) row.notes.push(note)
        if (!row.orders.includes(o.code)) row.orders.push(o.code)
        map.set(key, row)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty)
  }, [orders])

  const onTogglePaid = async (o) => {
    try {
      await updateOrderPayment(o.id, !o.is_paid)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <h2 className="page-heading">Đơn hàng</h2>
      <p className="page-sub">
        Mới <strong>{counts.new}</strong> · Đang làm <strong>{counts.preparing}</strong> · Hoàn thành{' '}
        <strong>{counts.done}</strong>
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ---- 🔥 MÓN CẦN LÀM — gom tất cả món của đơn chưa xong ---- */}
      {kitchen.length > 0 && (
        <section className="panel kitchen-panel">
          <h2 className="panel-title">🔥 Món cần làm ({kitchen.length} loại)</h2>
          <p className="panel-hint">
            Tổng hợp món của tất cả đơn chưa hoàn thành. Bấm nút Xong ở đơn bên dưới thì món tương
            ứng tự trừ khỏi bảng này.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Món</th>
                  <th style={{ textAlign: 'right' }}>Cần làm</th>
                  <th style={{ textAlign: 'right' }}>Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {kitchen.map((row) => (
                  <tr key={row.id}>
                    <td className="td-title">
                      <strong>{row.name}</strong>
                      <span className="muted small"> · {fmtVND(row.price)}</span>
                      {row.notes.length > 0 && (
                        <div className="muted small">
                          📝 {row.notes.join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="t-r" data-label="Cần làm">
                      <span className="kitchen-qty">{row.qty}</span>
                    </td>
                    <td className="t-r muted small" data-label="Số đơn">
                      {row.orders.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="chips">
        {[
          { k: 'active', l: `Cần xử lý (${counts.new + counts.preparing})` },
          { k: 'new', l: 'Mới' },
          { k: 'preparing', l: 'Đang làm' },
          { k: 'done', l: 'Hoàn thành' },
          { k: 'all', l: 'Tất cả' },
        ].map((t) => (
          <button
            key={t.k}
            className={`chip ${filter === t.k ? 'chip-active' : ''}`}
            onClick={() => setFilter(t.k)}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">Đang tải…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">Chưa có đơn nào ở mục này.</div>
      ) : (
        <div className="order-list">
          {filtered.map((o) => {
            const count = (o.items || []).reduce((s, it) => s + (it.qty || 0), 0)
            return (
              <article key={o.id} className="card order-card">
                <div className="order-head">
                  <div>
                    <div className="order-code">
                      #{o.code} <span className={`badge ${STATUS[o.status]?.cls || ''}`}>
                        {STATUS[o.status]?.label || o.status}
                      </span>
                      {o.payment_method === 'transfer' && (
                        <span className={`badge ${o.is_paid ? 'badge-ok' : 'badge-prep'}`}>
                          {o.is_paid ? '💰 Đã chuyển khoản' : '🏦 Chuyển khoản'}
                        </span>
                      )}
                    </div>
                    <div className="muted small">
                      {fmtTime(o.created_at)}
                      {o.customer_name ? ` · ${o.customer_name}` : ''}
                      {o.customer_phone ? ` · ${o.customer_phone}` : ''}
                      {o.table_no ? ` · Bàn ${o.table_no}` : ''}
                    </div>
                    {o.customer_address && (
                      <div className="order-address">📍 {o.customer_address}</div>
                    )}
                  </div>
                  <div className="order-total">
                    <strong>{fmtVND(o.total)}</strong>
                    <div className="muted small">{count} món</div>
                  </div>
                </div>

                <ul className="order-items">
                  {(o.items || []).map((it, i) => (
                    <li key={`${it.id}-${i}`}>
                      <span className="oi-qty">{it.qty}×</span>
                      <span className="oi-name">{it.name}</span>
                      <span className="oi-price muted">{fmtVND(it.price * it.qty)}</span>
                      {it.options?.length > 0 && (
                        <div className="oi-opts">
                          {it.options.map((op, k) => (
                            <span key={k} className="oi-opt">
                              {op.name}
                              {op.price_delta
                                ? ` (${op.price_delta > 0 ? '+' : '−'}${fmtVND(
                                    Math.abs(op.price_delta),
                                  )})`
                                : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {it.note?.trim() && <div className="oi-note">📝 {it.note}</div>}
                    </li>
                  ))}
                </ul>

                {o.note && <div className="order-note">📝 {o.note}</div>}

                <div className="order-actions">
                  {/* Nút chính — đổi theo trạng thái đơn */}
                  {o.status === 'new' && (
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(o.id, 'preparing')}>
                      ▶️ Bắt đầu làm
                    </button>
                  )}
                  {o.status === 'preparing' && (
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(o.id, 'done')}>
                      ✅ Hoàn thành
                    </button>
                  )}
                  {o.status === 'done' && (
                    <button className="btn btn-sm" onClick={() => setPrinting(o)}>
                      🖨️ In lại
                    </button>
                  )}

                  {/* Nút 3 chấm — gom các thao tác phụ vào 1 menu */}
                  <OrderMenu
                    order={o}
                    onStart={() => setStatus(o.id, 'preparing')}
                    onDone={() => setStatus(o.id, 'done')}
                    onCancel={() => setStatus(o.id, 'cancelled')}
                    onPrint={() => setPrinting(o)}
                    onPreview={() => setPreview(o)}
                    onTogglePaid={() => onTogglePaid(o)}
                    onDelete={() => onDelete(o.id)}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Xem trước hoá đơn (không in) */}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Hoá đơn #{preview.code}</h2>
              <button className="btn-icon" onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body invoice-preview">
              <Invoice order={preview} />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Đóng
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPrinting(preview)
                  setPreview(null)
                }}
              >
                🖨️ In hoá đơn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tự động mở hộp thoại in */}
      {printing && (
        <PrintPortal order={printing} onPrinted={() => setPrinting(null)} />
      )}
    </>
  )
}

/* --------------------------------------------------------------- *
 * NÚT 3 CHẤM — gom mọi thao tác của 1 đơn vào 1 menu
 *
 * Nút chính (Bắt đầu làm / Hoàn thành / In lại) nằm NGOÀI menu để
 * chủ quán bấm nhanh được. Menu 3 chấm chứa các thao tác phụ:
 *   - Bắt đầu / Hoàn thành (tuỳ trạng thái)
 *   - Đánh dấu đã thanh toán (đơn chuyển khoản)
 *   - In hoá đơn / Xem hoá đơn
 *   - Huỷ đơn
 *   - Xoá đơn (ĐỎ, nằm CUỐI danh sách)
 * --------------------------------------------------------------- */
function OrderMenu({ order, onStart, onDone, onCancel, onPrint, onPreview, onTogglePaid, onDelete }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Đóng menu khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('touchstart', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('touchstart', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Mọi thao tác đều đóng menu sau khi bấm.
  const run = (fn) => () => {
    setOpen(false)
    fn()
  }

  const isNew = order.status === 'new'
  const isPreparing = order.status === 'preparing'
  const isDone = order.status === 'done'
  const isCancelled = order.status === 'cancelled'
  const isTransfer = order.payment_method === 'transfer'

  return (
    <div className="order-menu" ref={wrapRef}>
      <button
        className={`btn btn-sm btn-icon-menu ${open ? 'btn-icon-menu-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tuỳ chọn khác"
        aria-label="Tuỳ chọn khác"
      >
        ⋮
      </button>

      {open && (
        <div className="order-menu-pop" role="menu">
          {isNew && (
            <button className="order-menu-item" role="menuitem" onClick={run(onStart)}>
              ▶️ Bắt đầu làm
            </button>
          )}
          {isPreparing && (
            <button className="order-menu-item" role="menuitem" onClick={run(onDone)}>
              ✅ Hoàn thành
            </button>
          )}
          {isTransfer && (
            <button className="order-menu-item" role="menuitem" onClick={run(onTogglePaid)}>
              {order.is_paid ? '↩️ Bỏ đánh dấu đã trả' : '💰 Đã thanh toán'}
            </button>
          )}
          {isDone ? (
            <>
              <button className="order-menu-item" role="menuitem" onClick={run(onPrint)}>
                🖨️ In hoá đơn
              </button>
              <button className="order-menu-item" role="menuitem" onClick={run(onPreview)}>
                📄 Xem hoá đơn
              </button>
            </>
          ) : (
            <button className="order-menu-item" role="menuitem" onClick={run(onPrint)}>
              🖨️ In hoá đơn
            </button>
          )}
          {!isDone && !isCancelled && (
            <button className="order-menu-item" role="menuitem" onClick={run(onCancel)}>
              ✖️ Huỷ đơn
            </button>
          )}
          <button
            className="order-menu-item order-menu-item-danger"
            role="menuitem"
            onClick={run(onDelete)}
          >
            🗑️ Xoá đơn
          </button>
        </div>
      )}
    </div>
  )
}
