import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { listOrders, updateOrderStatus, updateOrderPayment } from '../lib/db.js'
import { useOrdersRealtime } from '../lib/useOrdersRealtime.js'
import { fmtVND, fmtTime } from '../lib/format.js'
import Invoice from '../components/Invoice.jsx'
import PrintPortal from '../components/PrintPortal.jsx'
import RowMenu from '../components/RowMenu.jsx'

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
   * 2 TAB trong trang "Đơn hàng":
   *   - 'kitchen': bảng "🔥 Món cần làm" — bếp nhìn tổng món cần làm.
   *   - 'orders' : danh sách đơn chi tiết (bấm từng đơn để xử lý).
   *
   * VÌ SAO tách?
   *   Trước đây bảng "Món cần làm" nằm TRÊN danh sách đơn. Mỗi lần chủ quán
   *   muốn xem danh sách đơn thì phải CUỘN LÊN XUỐNG qua cả bảng tổng hợp
   *   (bảng này càng dài càng tốn chỗ). Tách thành 2 tab thì mỗi phần có
   *   đúng 1 màn hình, không phải cuộn.
   */
  const [tab, setTab] = useState('kitchen')

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
  }, [reload])

  const reloadRef = useRef(reload)
  reloadRef.current = reload

  // Đơn mới vừa tới -> hiện bảng "có đơn mới" cho chủ quán biết ngay.
  const [flashNew, setFlashNew] = useState(false)
  const flashTimer = useRef(null)

  const onRealtimeChange = useCallback((payload) => {
    reloadRef.current()

    // Chỉ báo "đơn mới" khi có đơn MỚI (INSERT), không phải khi đơn cũ
    // được sửa/xoá (UPDATE/DELETE) — sửa trạng thái là việc của chủ quán.
    if (payload.eventType === 'INSERT') {
      setFlashNew(true)
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashNew(false), 8000)
    }
  }, [])

  const { live } = useOrdersRealtime(onRealtimeChange)

  useEffect(() => () => clearTimeout(flashTimer.current), [])

  /**
   * Polling dự phòng — chu kỳ TỰ THÍCH ỨNG theo trạng thái realtime.
   *
   *   - Realtime ĐANG CHẠY  -> poll mỗi 30s (chỉ là lưới an toàn khi
   *     WebSocket bị đứt: mất mạng, điện thoại ngủ).
   *   - Realtime CHƯA CHẠY  -> poll mỗi 5s, để vẫn thấy đơn mới gần như
   *     tức thì. (Thường là do chưa chạy supabase/migration-realtime.sql
   *     trên Supabase — xem README.)
   *
   * Cả hai đều gọi `reload` nên hành vi giống nhau, chỉ khác độ trễ.
   */
  useEffect(() => {
    const period = live ? 30000 : 5000
    const t = setInterval(reload, period)
    return () => clearInterval(t)
  }, [reload, live])

  const setStatus = async (id, status) => {
    try {
      await updateOrderStatus(id, status)
      // Nạp lại và LẤY ĐƯỢC BẢN ĐƠN CÓ MÓN từ kết quả reload.
      const list = await reload()
      // Hoàn thành đơn -> in hoá đơn ngay (bản có món + tuỳ chọn + ghi chú).
      if (status === 'done') {
        const full = list.find((o) => o.id === id)
        if (full) {
          // `flushSync` ép React render NGAY TRONG cú bấm (đồng bộ).
          //
          // LÝ DO: trên điện thoại, `window.print()` chỉ mở được khi được gọi
          // trong "user gesture" (ngay khi người dùng bấm). Nếu để React render
          // bằng setState bình thường, việc render + effect (gọi print()) xảy
          // ra ở task SAU -> mất user gesture -> iOS Safari chặn im lặng ->
          // bấm nút "In hoá đơn" không ra gì cả.
          flushSync(() => {
            setPrinting(full)
          })
        } else {
          setError('Không tìm thấy đơn để in. Hãy bấm "In lại" trong danh sách.')
        }
      }
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
   * (đang `new` hoặc `preparing`) theo tên món + TUỲ CHỌN, cộng dồn số lượng.
   *
   * Đơn nào chuyển sang `done`/`cancelled` -> tự động biến mất khỏi bảng
   * (vì danh sách được tính lại mỗi lần reload). Không cần thao tác thủ công.
   *
   * ---------------------------------------------------------------------------
   * VÌ SAO PHẢI TÁCH THEO TUỲ CHỌN?
   *
   * Ví dụ khách gọi "7 hộp xôi siêu to (30k)" và "3 hộp xôi thường (20k)".
   * Nếu gom chỉ theo id món thì cả 10 hộp bị gộp thành 1 dòng và bếp tưởng
   * phải làm 10 hộp SIÊU TO -> sai, thiếu hàng.
   *
   * Vì vậy khoá gom là (món + tập tuỳ chọn đã chọn), và giá hiển thị là
   * giá CUỐI CÙNG (giá món + tổng price_delta của các tuỳ chọn).
   * ---------------------------------------------------------------------------
   */
  const kitchen = useMemo(() => {
    const map = new Map()
    for (const o of orders) {
      if (o.status !== 'new' && o.status !== 'preparing') continue
      for (const it of o.items || []) {
        // Danh sách tuỳ chọn, SẮP XẾP THEO TÊN để thứ tự chọn không ảnh
        // hưởng tới khoá gom (cùng 1 món, cùng 1 bộ tuỳ chọn -> 1 dòng).
        const opts = (it.options || [])
          .map((o) => ({
            name: o.name || '',
            delta: Math.round(Number(o.price_delta) || 0),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))

        // Khoá gom: id món + tên các tuỳ chọn (giá delta đi kèm để phân biệt
        // 2 món cùng tên nhưng khác giá).
        const key = `${it.id || it.name}::${opts.map((o) => `${o.name}|${o.delta}`).join(',')}`

        const row = map.get(key) || {
          key,
          name: it.name,
          // `it.price` đã là GIÁ CUỐI (giá món + tổng price_delta tuỳ chọn).
          // Server chốt sẵn khi tạo đơn: `price_snapshot = m.price + SUM(price_delta)`
          // (xem RPC create_order). Vì vậy KHÔNG cộng thêm delta ở đây,
          // nếu không sẽ cộng 2 lần.
          price: Number(it.price) || 0,
          options: opts,
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
      <h2 className="page-heading">
        Đơn hàng
        {flashNew && (
          <span className="flash-new" role="status">
            🔔 Đơn mới vừa vào!
          </span>
        )}
      </h2>
      <p className="page-sub">
        Mới <strong>{counts.new}</strong> · Đang làm <strong>{counts.preparing}</strong> · Hoàn thành{' '}
        <strong>{counts.done}</strong>
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ---- TAB: Món cần làm / Danh sách đơn ---- */}
      <div className="chips" role="tablist">
        <button
          className={`chip ${tab === 'kitchen' ? 'chip-active' : ''}`}
          onClick={() => setTab('kitchen')}
          role="tab"
          aria-selected={tab === 'kitchen'}
        >
          🔥 Món cần làm ({kitchen.length})
        </button>
        <button
          className={`chip ${tab === 'orders' ? 'chip-active' : ''}`}
          onClick={() => setTab('orders')}
          role="tab"
          aria-selected={tab === 'orders'}
        >
          🧾 Danh sách đơn ({counts.new + counts.preparing})
        </button>
      </div>

      {tab === 'kitchen' && (
        <>
          {/* ---- 🔥 MÓN CẦN LÀM — gom tất cả món của đơn chưa xong ---- */}
          {kitchen.length > 0 ? (
            <section className="panel kitchen-panel">
              <h2 className="panel-title">🔥 Món cần làm ({kitchen.length} món)</h2>
              <p className="panel-hint">
                Tổng hợp món của tất cả đơn chưa hoàn thành, đã tách theo tuỳ chọn (vd xôi
                siêu to và xôi thường là 2 dòng riêng). Bấm nút Xong ở tab "Danh sách đơn" thì
                món tương ứng tự trừ khỏi bảng này.
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
                      <tr key={row.key}>
                        <td className="td-title">
                          <strong>{row.name}</strong>
                          <span className="muted small"> · {fmtVND(row.price)}</span>
                          {row.options.length > 0 && (
                            <div className="kitchen-opts">
                              {row.options.map((o, k) => (
                                <span key={k} className="kitchen-opt">
                                  + {o.name}
                                  {o.delta !== 0 && (
                                    <em className={o.delta < 0 ? 'opt-minus' : ''}>
                                      {' '}
                                      {o.delta > 0 ? '+' : '−'}
                                      {fmtVND(Math.abs(o.delta))}
                                    </em>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
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
          ) : (
            <div className="empty">
              Không có món nào cần làm. Mọi đơn đã xong 🎉
            </div>
          )}
        </>
      )}

      {tab === 'orders' && (
        <>
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
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}
        </>
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
 * MENU THAO TÁC CỦA 1 ĐƠN
 *
 * Nút chính (Bắt đầu làm / Hoàn thành / In lại) nằm NGOÀI menu để chủ quán
 * bấm nhanh được. Menu 3 chấm chứa các thao tác phụ.
 *
 * VÌ SAO KHÔNG CÓ NÚT "XOÁ ĐƠN"?
 *
 *   Trước đây có cả "Huỷ đơn" lẫn "Xoá đơn" — thừa và gây rối:
 *     - "Huỷ đơn"  = đơn không làm nữa nhưng VẪN CÒN trong lịch sử
 *                     (đã xong việc ghi nhận, có thể đối chiếu doanh thu).
 *     - "Xoá đơn"  = xoá hẳn khỏi DB, mất vĩnh viễn.
 *
 *   Chủ quán chỉ cần 1 thao tác cho trường hợp "khách đặt nhầm / đổi ý".
 *   Đó là HUỶ — đơn vẫn nằm trong lịch sử, bấm "Tất cả" là thấy, không mất
 *   số liệu. Xoá hẳn là thao tác nguy hiểm và hiếm khi cần, nên bỏ đi cho
 *   gọn, tránh bấm nhầm xoá mất đơn.
 * --------------------------------------------------------------- */
function OrderMenu({ order, onStart, onDone, onCancel, onPrint, onPreview, onTogglePaid }) {
  const isNew = order.status === 'new'
  const isPreparing = order.status === 'preparing'
  const isDone = order.status === 'done'
  const isCancelled = order.status === 'cancelled'
  const isTransfer = order.payment_method === 'transfer'

  // Gom danh sách thao tác phụ, theo trạng thái đơn.
  const items = []
  if (isNew) items.push({ label: 'Bắt đầu làm', icon: '▶️', onClick: onStart })
  if (isPreparing) items.push({ label: 'Hoàn thành', icon: '✅', onClick: onDone })
  if (isTransfer) {
    items.push({
      label: order.is_paid ? 'Bỏ đánh dấu đã trả' : 'Đã thanh toán',
      icon: order.is_paid ? '↩️' : '💰',
      onClick: onTogglePaid,
    })
  }
  items.push({ label: 'In hoá đơn', icon: '🖨️', onClick: onPrint })
  if (isDone) items.push({ label: 'Xem hoá đơn', icon: '📄', onClick: onPreview })
  // Chỉ đơn CHƯA XONG mới huỷ được (đơn đã xong rồi thì không huỷ nữa).
  if (!isDone && !isCancelled) {
    items.push({ label: 'Huỷ đơn', icon: '✖️', danger: true, onClick: onCancel })
  }

  return <RowMenu items={items} />
}
