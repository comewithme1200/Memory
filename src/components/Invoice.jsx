import { fmtVND, fmtDateTime } from '../lib/format.js'

const SHOP = {
  name: import.meta.env.VITE_SHOP_NAME || 'Quán Ăn Sáng',
  address: import.meta.env.VITE_SHOP_ADDRESS || '',
  phone: import.meta.env.VITE_SHOP_PHONE || '',
}

/**
 * Hoá đơn 80mm dùng cho máy in nhiệt.
 * Component này chỉ hiển thị; việc gọi window.print() do PrintPortal đảm nhiệm.
 */
export default function Invoice({ order }) {
  if (!order) return null
  const items = order.items || []
  const count = items.reduce((s, it) => s + (Number(it.qty) || 0), 0)

  return (
    <div className="invoice-wrap">
      <div className="invoice">
        <div className="invoice-center">
          <h1 className="inv-shop">{SHOP.name}</h1>
          {SHOP.address && <div className="inv-small">{SHOP.address}</div>}
          {SHOP.phone && <div className="inv-small">ĐT: {SHOP.phone}</div>}
        </div>

        <div className="inv-rule" />
        <div className="inv-small">HOÁ ĐƠN #{order.code}</div>
        <div className="inv-small">
          Ngày: {fmtDateTime(order.created_at)}
        </div>
        {order.customer_name && <div className="inv-small">Khách: {order.customer_name}</div>}
        {order.customer_phone && <div className="inv-small">SĐT: {order.customer_phone}</div>}
        {order.customer_address && (
          <div className="inv-small">Giao tại: {order.customer_address}</div>
        )}
        {order.table_no && <div className="inv-small">Bàn: {order.table_no}</div>}

        <div className="inv-rule" />

        <table className="inv-table">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Món</th>
              <th style={{ width: '14%', textAlign: 'right' }}>SL</th>
              <th style={{ width: '24%', textAlign: 'right' }}>Đơn giá</th>
              <th style={{ width: '24%', textAlign: 'right' }}>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.id}-${i}`}>
                <td>
                  {it.name}
                  {it.options?.length > 0 && (
                    <div className="inv-item-opts">
                      {it.options.map((o, k) => (
                        <span key={k}>
                          + {o.name}
                          {o.price_delta
                            ? ` (${o.price_delta > 0 ? '+' : '−'}${fmtVND(Math.abs(o.price_delta))})`
                            : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {it.note?.trim() && <div className="inv-item-note">* {it.note}</div>}
                </td>
                <td className="t-r">{it.qty}</td>
                <td className="t-r">{fmtVND(it.price)}</td>
                <td className="t-r">{fmtVND(it.price * it.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-rule" />

        <div className="inv-row">
          <span>Tổng cộng:</span>
          <strong>{fmtVND(order.total)}</strong>
        </div>
        <div className="inv-row">
          <span>Số lượng:</span>
          <span>{count} món</span>
        </div>

        {order.note && (
          <>
            <div className="inv-rule" />
            <div className="inv-small">Ghi chú: {order.note}</div>
          </>
        )}

        <div className="inv-rule" />
        <div className="invoice-center inv-small">Cảm ơn quý khách!</div>
        <div className="invoice-center inv-small">Hẹn gặp lại!</div>
      </div>
    </div>
  )
}
