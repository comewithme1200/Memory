import { useEffect, useState } from 'react'
import { listMenu, createMenuItem, updateMenuItem, toggleMenuItem, deleteMenuItem } from '../lib/db.js'
import { fmtVND } from '../lib/format.js'

const EMPTY = { name: '', price: '', description: '', category: '', is_available: true, sort_order: 0 }

export default function MenuPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ---- MODAL THÊM / SỬA MÓN ------------------------------------------
  // `modal` = null (đang đóng) | { mode: 'add' } | { mode: 'edit', item }
  //
  // Trang này chỉ có 2 việc: XEM danh sách món và THÊM món. Mọi thao tác
  // sửa/xoá vẫn làm trực tiếp trên bảng, không cần modal.
  const [modal, setModal] = useState(null)

  const reload = () =>
    listMenu()
      .then(setItems)
      .catch((e) => setError(e.message || 'Không tải được danh sách món'))
      .finally(() => setLoading(false))

  useEffect(() => {
    reload()
  }, [])

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
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const categories = Array.from(new Set(items.map((m) => m.category).filter(Boolean)))

  return (
    <>
      <h2 className="page-heading">Quản lý món</h2>
      <p className="page-sub">Danh sách món ăn trong thực đơn</p>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title panel-title-mb0">Thực đơn ({items.length} món)</h2>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add' })}>
            ➕ Thêm món
          </button>
        </div>

        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="empty">
            Chưa có món nào. Bấm nút <strong>➕ Thêm món</strong> để thêm món đầu tiên.
          </div>
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
                    <td className="muted td-plain">{m.sort_order ?? i + 1}</td>
                    <td className="td-title">
                      <strong>{m.name}</strong>
                      {m.description && <div className="muted small">{m.description}</div>}
                    </td>
                    <td data-label="Nhóm">{m.category ? <span className="tag">{m.category}</span> : '-'}</td>
                    <td className="t-r" data-label="Giá">
                      {fmtVND(m.price)}
                    </td>
                    <td className="t-r" data-label="Trạng thái">
                      <button
                        className={`badge ${m.is_available ? 'badge-ok' : 'badge-off'}`}
                        onClick={() => onToggle(m)}
                      >
                        {m.is_available ? 'Đang bán' : 'Đã ẩn'}
                      </button>
                    </td>
                    <td className="t-r">
                      <div className="btn-row btn-row-end">
                        <button className="btn btn-sm" onClick={() => setModal({ mode: 'edit', item: m })}>
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

      {modal && (
        <DishFormModal
          item={modal.item || null}
          categories={categories}
          nextSortOrder={items.length + 1}
          onCancel={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await reload()
          }}
        />
      )}
    </>
  )
}

/* --------------------------------------------------------------- *
 * MODAL THÊM / SỬA MÓN
 *
 * Chứa toàn bộ form: tên, giá, nhóm món, thứ tự, mô tả, trạng thái bán.
 * --------------------------------------------------------------- */
function DishFormModal({ item, categories, nextSortOrder, onCancel, onSaved }) {
  const isEdit = Boolean(item)

  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: item.name,
          price: String(item.price),
          description: item.description || '',
          category: item.category || '',
          is_available: item.is_available !== false,
          sort_order: item.sort_order ?? 0,
        }
      : { ...EMPTY, sort_order: nextSortOrder },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Tên món không được để trống.')
    if (!form.price || Number(form.price) <= 0) return setError('Giá phải lớn hơn 0.')
    setError('')
    setBusy(true)
    try {
      if (isEdit) {
        await updateMenuItem(item.id, form)
      } else {
        await createMenuItem({ ...form, sort_order: form.sort_order || nextSortOrder })
      }
      await onSaved()
    } catch (err) {
      setError(err.message || 'Lưu món thất bại.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isEdit ? 'Sửa món' : 'Thêm món mới'}</h2>
          <button className="btn-icon" onClick={onCancel} aria-label="Đóng">
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-grid">
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
              <div className="field field-full">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.is_available}
                    onChange={(e) => setForm({ ...form, is_available: e.target.checked })}
                  />
                  Đang bán (bỏ chọn = tạm ẩn khỏi thực đơn)
                </label>
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Thêm món'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
