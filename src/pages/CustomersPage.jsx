import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  regenerateCustomerToken,
} from '../lib/db.js'

const EMPTY = { name: '', phone: '', address: '', note: '', is_active: true }

/**
 * URL mà QR trỏ tới.
 *
 * Dùng HashRouter nên URL có dạng `#/?qr=<token>`. Token NẰM TRONG URL —
 * không nhúng thẳng tên/SĐT/địa chỉ, vì:
 *   - URL ngắn -> QR dễ quét, ít lỗi khi in
 *   - không lộ SĐT/địa chỉ khách trong lịch sử trình duyệt và log máy chủ
 *
 * Lưu ý: `pathname` trên GitHub Pages là `/Memory/` (có dấu `/` cuối) -> phải
 * cắt bớt để không sinh ra `//` trong URL.
 */
const qrUrlFor = (token) => {
  const base = `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`
  return `${base}/#/?qr=${token}`
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  // Khách đang xem QR (mở modal)
  const [qrFor, setQrFor] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  /** Copy đường dẫn QR vào clipboard (để gửi link cho khách). */
  const copyLink = async (token) => {
    const url = qrUrlFor(token)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Trình duyệt chặn clipboard (http, hoặc không có quyền) -> cho xem tay
      window.prompt('Copy đường dẫn này để gửi cho khách:', url)
    }
  }

  /**
   * Tải ảnh QR của 1 khách (để gửi qua Zalo cho khách).
   * Sinh ảnh riêng thay vì dùng ảnh trong modal -> không phụ thuộc modal đang mở.
   */
  const downloadQr = async (c) => {
    try {
      const url = await QRCode.toDataURL(qrUrlFor(c.qr_token), {
        width: 600,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#1f2328', light: '#ffffff' },
      })
      const a = document.createElement('a')
      a.href = url
      a.download = `qr-${(c.name || 'khach').replace(/\s+/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setError(e.message || 'Không tải được ảnh QR.')
    }
  }

  /**
   * In mã QR.
   *
   * Thêm class `printing-qr` vào <body> để CSS `@media print` chỉ hiện mã QR.
   * Class được gỡ sau khi in xong (dùng cả `afterprint` lẫn timeout dự phòng).
   */
  const printQr = () => {
    document.body.classList.add('printing-qr')
    const cleanup = () => {
      document.body.classList.remove('printing-qr')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
    // Safari/Chrome có thể không bắn 'afterprint' -> dọn sau 1s.
    setTimeout(cleanup, 1000)
  }

  const reload = () =>
    listCustomers()
      .then(setCustomers)
      .catch((e) => setError(e.message || 'Không tải được danh sách khách quen'))
      .finally(() => setLoading(false))

  useEffect(() => {
    reload()
  }, [])

  // Sinh ảnh QR khi chọn khách
  useEffect(() => {
    if (!qrFor?.qr_token) {
      setQrDataUrl('')
      return
    }
    let alive = true
    QRCode.toDataURL(qrUrlFor(qrFor.qr_token), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1f2328', light: '#ffffff' },
    })
      .then((url) => {
        if (alive) setQrDataUrl(url)
      })
      .catch((e) => {
        if (alive) setError(e.message || 'Không tạo được mã QR')
      })
    return () => {
      alive = false
    }
  }, [qrFor])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Tên khách không được để trống.')
    if (!form.phone.trim()) return setError('Số điện thoại không được để trống.')
    setError('')
    setBusy(true)
    try {
      if (editingId) {
        await updateCustomer(editingId, form)
        setForm(EMPTY)
        setEditingId(null)
        await reload()
      } else {
        // Thêm xong -> MỞ NGAY modal QR để chủ quán lấy/gửi cho khách.
        const created = await createCustomer(form)
        setForm(EMPTY)
        await reload()
        setQrFor(created)
      }
    } catch (err) {
      setError(err.message || 'Lưu khách quen thất bại.')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c) => {
    setEditingId(c.id)
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      note: c.note || '',
      is_active: c.is_active !== false,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY)
  }

  const onDelete = async (c) => {
    if (!window.confirm(`Xoá khách "${c.name}"? Mã QR của họ sẽ không dùng được nữa.`)) return
    try {
      await deleteCustomer(c.id)
      if (editingId === c.id) cancelEdit()
      if (qrFor?.id === c.id) setQrFor(null)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const onRegenerate = async (c) => {
    if (!window.confirm(`Tạo lại mã QR cho "${c.name}"? Mã cũ sẽ không dùng được nữa.`)) return
    try {
      const updated = await regenerateCustomerToken(c.id)
      await reload()
      if (qrFor?.id === c.id) setQrFor(updated)
    } catch (e) {
      setError(e.message)
    }
  }

  const activeCount = useMemo(() => customers.filter((c) => c.is_active !== false).length, [customers])

  return (
    <>
      <h2 className="page-heading">Khách quen &amp; mã QR</h2>
      <p className="page-sub">
        Thêm thông tin khách quen, sinh mã QR để khách quét và đặt món — thông tin đã điền
        sẵn, khách không phải gõ lại.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel">
        <h2 className="panel-title">{editingId ? 'Sửa khách quen' : 'Thêm khách quen'}</h2>
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label>Tên khách *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nguyễn Văn A"
              required
            />
          </div>
          <div className="field">
            <label>Số điện thoại *</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="0909 000 000"
              inputMode="tel"
              required
            />
          </div>
          <div className="field field-full">
            <label>Địa chỉ</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Nguyễn Văn A, Quận 1"
            />
          </div>
          <div className="field field-full">
            <label>Ghi chú (nội bộ)</label>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Thường gọi phở tái, giao lúc 7h sáng..."
            />
          </div>
          <div className="field field-full form-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Đang hoạt động (bỏ chọn = QR không dùng được nữa)
            </label>
            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Huỷ
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Thêm & tạo QR'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          Danh sách khách quen ({customers.length} khách · {activeCount} đang hoạt động)
        </h2>
        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : customers.length === 0 ? (
          <div className="empty">Chưa có khách quen nào. Hãy thêm ở ô bên trên.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>SĐT</th>
                  <th>Địa chỉ</th>
                  <th style={{ textAlign: 'right' }}>Trạng thái</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.note && <div className="muted small">{c.note}</div>}
                    </td>
                    <td className="t-r">{c.phone || '-'}</td>
                    <td className="small">{c.address || '-'}</td>
                    <td className="t-r">
                      <span className={`badge ${c.is_active !== false ? 'badge-ok' : 'badge-off'}`}>
                        {c.is_active !== false ? 'Đang hoạt động' : 'Đã tắt'}
                      </span>
                    </td>
                    <td className="t-r">
                      <div className="btn-row btn-row-end">
                        <button className="btn btn-sm btn-primary" onClick={() => setQrFor(c)}>
                          📱 Xem QR
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => downloadQr(c)}
                          title="Tải ảnh QR để gửi khách qua Zalo"
                        >
                          ⬇️ Ảnh
                        </button>
                        <button className="btn btn-sm" onClick={() => startEdit(c)}>
                          Sửa
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => onRegenerate(c)}>
                          Tạo lại QR
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(c)}>
                          Xoá
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {qrFor && (
        <div className="modal-backdrop" onClick={() => setQrFor(null)}>
          <div className="modal modal-qr" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>QR của {qrFor.name}</h2>
              <button className="btn-icon" onClick={() => setQrFor(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body qr-body">
              {qrDataUrl ? (
                <>
                  <img
                    id="qr-print-area"
                    className="qr-image"
                    src={qrDataUrl}
                    alt={`Mã QR của ${qrFor.name}`}
                  />
                  <div className="qr-name">{qrFor.name}</div>
                </>
              ) : (
                <div className="empty">Đang tạo mã QR…</div>
              )}

              {qrFor.phone && <div className="qr-meta">📞 {qrFor.phone}</div>}
              {qrFor.address && <div className="qr-meta">📍 {qrFor.address}</div>}

              <p className="qr-hint">
                Khách quét mã này → mở thẳng trang đặt món, tên/SĐT/địa chỉ <b>đã điền sẵn</b>.
                <br />
                In ra dán lên bàn, hoặc gửi ảnh cho khách qua Zalo.
              </p>

              <details className="qr-details">
                <summary>Đường dẫn (copy để gửi link, dùng khi quét trên máy tính)</summary>
                <code className="qr-url">{qrUrlFor(qrFor.qr_token)}</code>
              </details>
            </div>
            <div className="modal-foot">
              <a
                className="btn btn-ghost"
                href={qrDataUrl}
                download={`qr-${(qrFor.name || 'khach').replace(/\s+/g, '-')}.png`}
              >
                ⬇️ Tải ảnh PNG
              </a>
              <button className="btn btn-ghost" onClick={() => copyLink(qrFor.qr_token)}>
                {copied ? '✓ Đã copy' : '🔗 Copy link'}
              </button>
              <button className="btn btn-ghost" onClick={() => printQr()}>
                🖨️ In QR
              </button>
              <button className="btn btn-primary" onClick={() => setQrFor(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
