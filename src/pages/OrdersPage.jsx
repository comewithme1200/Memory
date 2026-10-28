import { useCallback, useEffect, useMemo, useState } from 'react'
import { listOrders, updateOrderStatus, deleteOrder } from '../lib/db.js'
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

  const reload = useCallback(
    () =>
      listOrders({ limit: 200 })
        .then(setOrders)
        .catch((e) => setError(e.message || 'Không tải được danh đơn'))
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
      const updated = await updateOrderStatus(id, status)
      await reload()
      // Hoàn thành đơn -> in hoá đơn ngay
      if (status === 'done') {
        setPrinting(updated || orders.find((o) => o.id === id))
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

  return (
    <>
      <h2 className="page-heading">Đơn hàng</h2>
      <p className="page-sub">
        Mới <strong>{counts.new}</strong> · Đang làm <strong>{counts.preparing}</strong> · Hoàn thành{' '}
        <strong>{counts.done}</strong>
      </p>

      {error && <div className="alert alert-error">{error}</div>}

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
                    </div>
                    <div className="muted small">
                      {fmtTime(o.created_at)}
                      {o.customer_name ? ` · ${o.customer_name}` : ''}
                      {o.customer_phone ? ` · ${o.customer_phone}` : ''}
                      {o.table_no ? ` · Bàn ${o.table_no}` : ''}
                    </div>
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
                      {it.note?.trim() && <div className="oi-note">📝 {it.note}</div>}
                    </li>
                  ))}
                </ul>

                {o.note && <div className="order-note">📝 {o.note}</div>}

                <div className="order-actions">
                  {o.status === 'new' && (
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(o.id, 'preparing')}>
                      Bắt đầu làm
                    </button>
                  )}
                  {o.status === 'preparing' && (
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(o.id, 'done')}>
                      Xong &amp; in hoá đơn
                    </button>
                  )}
                  {o.status === 'done' && (
                    <>
                      <button className="btn btn-sm" onClick={() => setPrinting(o)}>
                        🖨️ In lại
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setPreview(o)}>
                        Xem hoá đơn
                      </button>
                    </>
                  )}
                  {o.status !== 'done' && o.status !== 'cancelled' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setStatus(o.id, 'cancelled')}>
                      Huỷ
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => onDelete(o.id)}>
                    Xoá
                  </button>
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
