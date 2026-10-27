import { useEffect, useState } from 'react'
import { listMenu, createMenuItem, updateMenuItem, toggleMenuItem, deleteMenuItem } from '../lib/db.js'
import { fmtVND } from '../lib/format.js'

const EMPTY = { name: '', price: '', description: '', category: '', is_available: true, sort_order: 0 }

export default function MenuPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = () =>
    listMenu()
      .then(setItems)
      .catch((e) => setError(e.message || 'Không tải được danh sách món'))
      .finally(() => setLoading(false))

  useEffect(() => {
    reload()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Tên món không được để trống.')
    if (!form.price || Number(form.price) <= 0) return setError('Giá phải lớn hơn 0.')
    setError('')
    setBusy(true)
    try {
      if (editingId) {
        await updateMenuItem(editingId, form)
      } else {
        await createMenuItem({ ...form, sort_order: items.length + 1 })
      }
      setForm(EMPTY)
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err.message || 'Lưu món thất bại.')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (m) => {
    setEditingId(m.id)
    setForm({
      name: m.name,
      price: String(m.price),
      description: m.description || '',
      category: m.category || '',
      is_available: m.is_available !== false,
      sort_order: m.sort_order ?? 0,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY)
  }

  const onToggle = async (m) => {
    try {
      await toggleMenuItem(m.id, !m.is_available)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const onDelete = async (m) => {
    if (!window.confirm(`Xoá món "${m.name}"?`)) return
    try {
      await deleteMenuItem(m.id)
      if (editingId === m.id) cancelEdit()
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const categories = Array.from(new Set(items.map((m) => m.category).filter(Boolean)))

  return (
    <>
      <h2 className="page-heading">Quản lý món</h2>
      <p className="page-sub">Thêm, sửa, ẩn/hiện món trong thực đơn</p>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel">
        <h2 className="panel-title">{editingId ? 'Sửa món' : 'Thêm món mới'}</h2>
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label>Tên món *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Phở bò tái"
              required
            />
          </div>
          <div className="field">
            <label>Giá (đồng) *</label>
            <input
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="25000"
              inputMode="numeric"
              type="number"
              min="0"
              step="1000"
              required
            />
          </div>
          <div className="field">
            <label>Nhóm món</label>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Món chính / Nước / Tráng miệng"
              list="cat-list"
            />
            <datalist id="cat-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Thứ tự hiển thị</label>
            <input
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              type="number"
              min="0"
            />
          </div>
          <div className="field field-full">
            <label>Mô tả</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Nước dùng ngọt thanh, thịt bò mềm"
            />
          </div>
          <div className="field field-full form-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={form.is_available}
                onChange={(e) => setForm({ ...form, is_available: e.target.checked })}
              />
              Đang bán (bỏ chọn = tạm ẩn khỏi thực đơn)
            </label>
            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Huỷ
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Thêm món'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Thực đơn ({items.length} món)</h2>
        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="empty">Chưa có món nào. Hãy thêm món ở ô bên trên.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Món</th>
                  <th>Nhóm</th>
                  <th style={{ textAlign: 'right' }}>Giá</th>
                  <th style={{ textAlign: 'right' }}>Trạng thái</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m, i) => (
                  <tr key={m.id}>
                    <td className="muted">{m.sort_order ?? i + 1}</td>
                    <td>
                      <strong>{m.name}</strong>
                      {m.description && <div className="muted small">{m.description}</div>}
                    </td>
                    <td>{m.category ? <span className="tag">{m.category}</span> : '-'}</td>
                    <td className="t-r">{fmtVND(m.price)}</td>
                    <td className="t-r">
                      <button
                        className={`badge ${m.is_available ? 'badge-ok' : 'badge-off'}`}
                        onClick={() => onToggle(m)}
                      >
                        {m.is_available ? 'Đang bán' : 'Đã ẩn'}
                      </button>
                    </td>
                    <td className="t-r">
                      <div className="btn-row btn-row-end">
                        <button className="btn btn-sm" onClick={() => startEdit(m)}>
                          Sửa
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(m)}>
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
    </>
  )
}
