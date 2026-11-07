import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { summarize } from '../lib/db.js'
import { useOrdersRealtime } from '../lib/useOrdersRealtime.js'
import { fmtVND, fmtNumber, dateKey, startOfDay, endOfDay } from '../lib/format.js'
import { sortByNameThenPrice } from '../lib/dishSort.js'

/**
 * Tổng kết CHỈ tính đơn trong ngày hôm nay.
 *
 * Trang này là bảng số liệu "trong ngày" của chủ quán — đối chiếu với bảng
 * "Món cần làm" ở tab "Đơn hàng" (cũng chỉ hiện đơn hôm nay). Nếu tổng kết
 * gộp cả lịch sử cũ thì hai màn hình sẽ lệch nhau rất xa.
 *
 * Vì vậy KHÔNG có bộ lọc "Hôm qua / 7 ngày / 30 ngày / Tất cả" nữa.
 */
const rangeFor = () => {
  const key = dateKey(new Date())
  return { from: startOfDay(key), to: endOfDay(key) }
}

export default function SummaryPage() {
  const [data, setData] = useState({ rows: [], totalQty: 0, totalRevenue: 0, orderCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Hàm nạp lại tổng kết, tách riêng để dùng cho cả lần đầu và khi
  // Realtime báo có đơn mới.
  const load = useCallback(() => {
    const { from, to } = rangeFor()
    return summarize({ from, to })
      .then(setData)
      .catch((e) => setError(e.message || 'Không tổng kết được'))
  }, [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  // Tổng kết cũng cập nhật realtime -> số suất bán ra hiện ngay khi có
  // đơn mới, không phải bấm "Tải lại" hay chờ polling.
  const loadRef = useRef(load)
  loadRef.current = load
  const onChange = useCallback(() => {
    loadRef.current()
  }, [])
  useOrdersRealtime(onChange)

  const maxQty = useMemo(() => Math.max(1, ...data.rows.map((r) => r.qty)), [data.rows])

  /**
   * Sắp xếp bảng "Số lượng từng món".
   *
   * QUY TẮC:
   *   1. Các món CÙNG TÊN nằm cạnh nhau (vd "Xôi gà" size nhỏ và size to
   *      là 2 dòng liền kề, không lơ lửng 2 đầu bảng).
   *   2. Trong mỗi nhóm cùng tên, đơn giá TĂNG DẦN (rẻ hơn lên trước).
   *   3. Thứ tự giữa các nhóm: món bán chạy nhất lên đầu (như cũ).
   */
  const sortedRows = useMemo(
    () =>
      sortByNameThenPrice(
        data.rows,
        (r) => Number(r.price) || 0,
        (r) => Number(r.qty) || 0,
      ),
    [data.rows],
  )

  const copySummary = () => {
    const lines = [
      'TỔNG KẾT HÔM NAY',
      `Số đơn: ${fmtNumber(data.orderCount)} | Tổng suất: ${fmtNumber(data.totalQty)} | Doanh thu: ${fmtVND(data.totalRevenue)}`,
      '---',
      ...sortedRows.map(
        (r, i) => `${i + 1}. ${r.name}: ${fmtNumber(r.qty)} suất (${fmtVND(r.revenue)})`,
      ),
    ]
    navigator.clipboard?.writeText(lines.join('\n'))
  }

  return (
    <>
      <h2 className="page-heading">Tổng kết số lượng</h2>
      <p className="page-sub">Số suất đã bán theo từng món trong ngày hôm nay</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-row">
        <div className="card stat">
          <div className="stat-label">Tổng số suất</div>
          <div className="stat-value">{fmtNumber(data.totalQty)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Số đơn</div>
          <div className="stat-value">{fmtNumber(data.orderCount)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Doanh thu</div>
          <div className="stat-value">{fmtVND(data.totalRevenue)}</div>
        </div>
        <div className="card stat stat-action">
          <button className="btn btn-sm" onClick={copySummary}>
            📋 Copy tổng kết
          </button>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-title">Số lượng từng món</h2>
        {loading ? (
          <div className="empty">Đang tổng kết…</div>
        ) : data.rows.length === 0 ? (
          <div className="empty">Chưa có dữ liệu trong khoảng thời gian này.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Món</th>
                  <th style={{ width: '40%' }}>Tỉ lệ</th>
                  <th style={{ textAlign: 'right' }}>Số lượng</th>
                  <th style={{ textAlign: 'right' }}>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="muted td-plain">{i + 1}</td>
                    <td className="td-title">
                      <strong>{r.name}</strong>
                      {r.price ? (
                        <span className="muted small"> · {fmtVND(r.price)}</span>
                      ) : null}
                    </td>
                    <td data-label="Tỉ lệ">
                      <div className="bar">
                        <div className="bar-fill" style={{ width: `${(r.qty / maxQty) * 100}%` }} />
                      </div>
                    </td>
                    <td className="t-r" data-label="Số lượng">
                      <strong>{fmtNumber(r.qty)}</strong>
                    </td>
                    <td className="t-r muted" data-label="Doanh thu">
                      {fmtVND(r.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
