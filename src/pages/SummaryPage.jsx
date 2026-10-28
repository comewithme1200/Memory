import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { summarize } from '../lib/db.js'
import { useOrdersRealtime } from '../lib/useOrdersRealtime.js'
import { fmtVND, fmtNumber, dateKey, startOfDay, endOfDay } from '../lib/format.js'

const PRESETS = [
  { k: 'today', l: 'Hôm nay' },
  { k: 'yesterday', l: 'Hôm qua' },
  { k: 'week', l: '7 ngày' },
  { k: 'month', l: '30 ngày' },
  { k: 'all', l: 'Tất cả' },
]

const rangeFor = (preset) => {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: startOfDay(dateKey(now)), to: endOfDay(dateKey(now)) }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { from: startOfDay(dateKey(y)), to: endOfDay(dateKey(y)) }
    }
    case 'week': {
      const s = new Date(now)
      s.setDate(s.getDate() - 6)
      s.setHours(0, 0, 0, 0)
      return { from: s, to: endOfDay(dateKey(now)) }
    }
    case 'month': {
      const s = new Date(now)
      s.setDate(s.getDate() - 29)
      s.setHours(0, 0, 0, 0)
      return { from: s, to: endOfDay(dateKey(now)) }
    }
    default:
      return {}
  }
}

export default function SummaryPage() {
  const [preset, setPreset] = useState('today')
  const [data, setData] = useState({ rows: [], totalQty: 0, totalRevenue: 0, orderCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Hàm nạp lại tổng kết, tách riêng để dùng cho cả lần đầu, đổi bộ lọc
  // và khi Realtime báo có đơn mới.
  const load = useCallback(() => {
    const { from, to } = rangeFor(preset)
    return summarize({ from, to })
      .then(setData)
      .catch((e) => setError(e.message || 'Không tổng kết được'))
  }, [preset])

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

  const copySummary = () => {
    const lines = [
      `TỔNG KẾT ${PRESETS.find((p) => p.k === preset)?.l.toUpperCase()}`,
      `Số đơn: ${fmtNumber(data.orderCount)} | Tổng suất: ${fmtNumber(data.totalQty)} | Doanh thu: ${fmtVND(data.totalRevenue)}`,
      '---',
      ...data.rows.map((r, i) => `${i + 1}. ${r.name}: ${fmtNumber(r.qty)} suất (${fmtVND(r.revenue)})`),
    ]
    navigator.clipboard?.writeText(lines.join('\n'))
  }

  return (
    <>
      <h2 className="page-heading">Tổng kết số lượng</h2>
      <p className="page-sub">Số suất đã bán theo từng món</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.k}
            className={`chip ${preset === p.k ? 'chip-active' : ''}`}
            onClick={() => setPreset(p.k)}
          >
            {p.l}
          </button>
        ))}
      </div>

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
                {data.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="muted td-plain">{i + 1}</td>
                    <td className="td-title">
                      <strong>{r.name}</strong>
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
