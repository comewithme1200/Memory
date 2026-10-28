import { useEffect, useMemo, useState } from 'react'
import {
  listMenu,
  listOptionGroups,
  listAllItemOptions,
  createOptionGroup,
  updateOptionGroup,
  deleteOptionGroup,
  createItemOption,
  updateItemOption,
  deleteItemOption,
  attachOptionGroup,
  detachOptionGroup,
} from '../lib/db.js'
import { fmtVND } from '../lib/format.js'

const EMPTY_GROUP = { name: '', description: '', is_multi: false }
const EMPTY_CHOICE = { name: '', price_delta: '0', is_available: true, sort_order: 0 }

export default function OptionsPage() {
  const [items, setItems] = useState([])
  const [groups, setGroups] = useState([])
  const [optsByItem, setOptsByItem] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  // Form nhóm tuỳ chọn
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP)
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [busyGroup, setBusyGroup] = useState(false)

  // Form lựa chọn (thuộc 1 món + 1 nhóm)
  const [choiceCtx, setChoiceCtx] = useState(null) // { menuItemId, groupId }
  const [choiceForm, setChoiceForm] = useState(EMPTY_CHOICE)
  const [editingChoiceId, setEditingChoiceId] = useState(null)
  const [busyChoice, setBusyChoice] = useState(false)

  // Món đang chọn để thêm nhóm tuỳ chọn
  const [assignItemId, setAssignItemId] = useState('')
  const [assignGroupId, setAssignGroupId] = useState('')
  const [assignRequired, setAssignRequired] = useState(false)
  const [busyAssign, setBusyAssign] = useState(false)

  const reload = async () => {
    try {
      const [m, g, oMap] = await Promise.all([listMenu(), listOptionGroups(), listAllItemOptions()])
      setItems(m)
      setGroups(g)
      setOptsByItem(oMap)
    } catch (e) {
      setError(e.message || 'Không tải được dữ liệu tuỳ chọn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const flash = (m) => {
    setOkMsg(m)
    setError('')
    setTimeout(() => setOkMsg(''), 3000)
  }

  /* ---------------------- NHÓM TUỲ CHỌN ---------------------- */

  const submitGroup = async (e) => {
    e.preventDefault()
    if (!groupForm.name.trim()) return setError('Tên nhóm tuỳ chọn không được để trống.')
    setError('')
    setBusyGroup(true)
    try {
      if (editingGroupId) {
        await updateOptionGroup(editingGroupId, groupForm)
        flash('Đã cập nhật nhóm tuỳ chọn.')
      } else {
        await createOptionGroup(groupForm)
        flash('Đã thêm nhóm tuỳ chọn.')
      }
      setGroupForm(EMPTY_GROUP)
      setEditingGroupId(null)
      await reload()
    } catch (err) {
      setError(err.message || 'Lưu nhóm tuỳ chọn thất bại.')
    } finally {
      setBusyGroup(false)
    }
  }

  const startEditGroup = (g) => {
    setEditingGroupId(g.id)
    setGroupForm({
      name: g.name,
      description: g.description || '',
      is_multi: g.is_multi === true,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onDeleteGroup = async (g) => {
    const n = groups.filter((x) => x.id === g.id).length
    if (
      !window.confirm(
        `Xoá nhóm tuỳ chọn "${g.name}"? Tất cả lựa chọn thuộc nhóm này (ở mọi món) cũng bị xoá.`,
      )
    )
      return
    try {
      await deleteOptionGroup(g.id)
      if (editingGroupId === g.id) {
        setEditingGroupId(null)
        setGroupForm(EMPTY_GROUP)
      }
      await reload()
      flash('Đã xoá nhóm tuỳ chọn.')
    } catch (e) {
      setError(e.message)
    }
  }

  /* ---------------------- LỰA CHỌN ---------------------- */

  const openChoiceForm = (menuItemId, groupId) => {
    setChoiceCtx({ menuItemId, groupId })
    setChoiceForm(EMPTY_CHOICE)
    setEditingChoiceId(null)
    setError('')
  }

  const submitChoice = async (e) => {
    e.preventDefault()
    if (!choiceCtx) return
    if (!choiceForm.name.trim()) return setError('Tên lựa chọn không được để trống.')
    setError('')
    setBusyChoice(true)
    try {
      if (editingChoiceId) {
        await updateItemOption(editingChoiceId, choiceForm)
        flash('Đã cập nhật lựa chọn.')
      } else {
        await createItemOption(choiceCtx.menuItemId, {
          ...choiceForm,
          option_id: choiceCtx.groupId,
        })
        flash('Đã thêm lựa chọn.')
      }
      setChoiceForm(EMPTY_CHOICE)
      setEditingChoiceId(null)
      await reload()
    } catch (err) {
      setError(err.message || 'Lưu lựa chọn thất bại.')
    } finally {
      setBusyChoice(false)
    }
  }

  const startEditChoice = (c, menuItemId, groupId) => {
    setChoiceCtx({ menuItemId, groupId })
    setEditingChoiceId(c.id)
    setChoiceForm({
      name: c.name,
      price_delta: String(c.price_delta ?? 0),
      is_available: c.is_available !== false,
      sort_order: c.sort_order ?? 0,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onDeleteChoice = async (c) => {
    if (!window.confirm(`Xoá lựa chọn "${c.name}"?`)) return
    try {
      await deleteItemOption(c.id)
      if (editingChoiceId === c.id) {
        setEditingChoiceId(null)
        setChoiceForm(EMPTY_CHOICE)
      }
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  /* ---------------------- GẮN NHÓM VÀO MÓN ---------------------- */

  const onAssign = async () => {
    if (!assignItemId || !assignGroupId) return setError('Chọn cả món và nhóm tuỳ chọn.')
    setError('')
    setBusyAssign(true)
    try {
      await attachOptionGroup(assignItemId, assignGroupId, { isRequired: assignRequired })
      await reload()
      flash('Đã gắn nhóm tuỳ chọn cho món.')
    } catch (e) {
      setError(e.message || 'Gắn nhóm tuỳ chọn thất bại.')
    } finally {
      setBusyAssign(false)
    }
  }

  const onDetach = async (menuItemId, groupId, name) => {
    if (!window.confirm(`Gỡ nhóm tuỳ chọn "${name}" khỏi món này?`)) return
    try {
      await detachOptionGroup(menuItemId, groupId)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  /* ---------------------- DANH SÁCH ---------------------- */

  const groupUsage = useMemo(() => {
    const map = new Map()
    for (const [, list] of optsByItem) {
      for (const g of list) {
        map.set(g.id, (map.get(g.id) || 0) + 1)
      }
    }
    return map
  }, [optsByItem])

  return (
    <>
      <h2 className="page-heading">Tuỳ chọn món</h2>
      <p className="page-sub">
        Tạo các tuỳ chọn kiểu GrabFood (Size to +5k, Size nhỏ −5k…). Khách chọn tuỳ chọn
        ngay trên thực đơn, giá được cộng/trừ tự động.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {okMsg && <div className="alert alert-success">{okMsg}</div>}

      {/* ---- Tạo nhóm tuỳ chọn ---- */}
      <section className="panel">
        <h2 className="panel-title">
          {editingGroupId ? 'Sửa nhóm tuỳ chọn' : 'Thêm nhóm tuỳ chọn'}
        </h2>
        <p className="panel-hint">
          Nhóm dùng chung cho nhiều món (vd: "Size" dùng cho cả Phở và Bún bò).
        </p>
        <form onSubmit={submitGroup} className="form-grid">
          <div className="field">
            <label>Tên nhóm *</label>
            <input
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              placeholder="Size / Topping / Mức cay"
              required
            />
          </div>
          <div className="field">
            <label>Mô tả</label>
            <input
              value={groupForm.description}
              onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
              placeholder="Chọn cỡ phần ăn"
            />
          </div>
          <div className="field field-full form-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={groupForm.is_multi}
                onChange={(e) => setGroupForm({ ...groupForm, is_multi: e.target.checked })}
              />
              Cho phép chọn nhiều lựa chọn trong nhóm này
            </label>
            <div className="btn-row">
              {editingGroupId && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingGroupId(null)
                    setGroupForm(EMPTY_GROUP)
                  }}
                >
                  Huỷ
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busyGroup}>
                {busyGroup ? 'Đang lưu…' : editingGroupId ? 'Lưu thay đổi' : 'Thêm nhóm'}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* ---- Danh sách nhóm ---- */}
      <section className="panel">
        <h2 className="panel-title">Nhóm tuỳ chọn ({groups.length})</h2>
        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : groups.length === 0 ? (
          <div className="empty">Chưa có nhóm tuỳ chọn nào. Hãy thêm ở ô bên trên.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên nhóm</th>
                  <th>Chọn nhiều</th>
                  <th style={{ textAlign: 'right' }}>Dùng cho</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="td-title">
                      <strong>{g.name}</strong>
                      {g.description && <div className="muted small">{g.description}</div>}
                    </td>
                    <td data-label="Chọn nhiều">{g.is_multi ? 'Có' : 'Không'}</td>
                    <td className="t-r" data-label="Dùng cho">
                      {groupUsage.get(g.id) || 0} món
                    </td>
                    <td className="t-r">
                      <div className="btn-row btn-row-end">
                        <button className="btn btn-sm" onClick={() => startEditGroup(g)}>
                          Sửa
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDeleteGroup(g)}>
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

      {/* ---- Gắn nhóm vào món ---- */}
      <section className="panel">
        <h2 className="panel-title">Gắn nhóm tuỳ chọn cho món</h2>
        <p className="panel-hint">
          Chọn món + nhóm tuỳ chọn. Nếu tick "bắt buộc", khách phải chọn mới thêm được món vào
          giỏ.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>Món</label>
            <select value={assignItemId} onChange={(e) => setAssignItemId(e.target.value)}>
              <option value="">— Chọn món —</option>
              {items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nhóm tuỳ chọn</label>
            <select value={assignGroupId} onChange={(e) => setAssignGroupId(e.target.value)}>
              <option value="">— Chọn nhóm —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-full form-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={assignRequired}
                onChange={(e) => setAssignRequired(e.target.checked)}
              />
              Bắt buộc chọn (khách không chọn thì không thêm vào giỏ được)
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onAssign}
                disabled={busyAssign || !assignItemId || !assignGroupId}
              >
                {busyAssign ? 'Đang gắn…' : 'Gắn cho món'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Tuỳ chọn của từng món ---- */}
      <section className="panel">
        <h2 className="panel-title">Tuỳ chọn theo món</h2>
        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="empty">Chưa có món nào.</div>
        ) : (
          <div className="opt-items">
            {items.map((m) => {
              const list = optsByItem.get(m.id) || []
              return (
                <div key={m.id} className="opt-item">
                  <div className="opt-item-head">
                    <div>
                      <strong>{m.name}</strong>
                      <span className="muted small"> · {fmtVND(m.price)}</span>
                    </div>
                  </div>

                  {list.length === 0 ? (
                    <div className="opt-item-empty">Món này chưa có tuỳ chọn nào.</div>
                  ) : (
                    list.map((g) => (
                      <div key={g.id} className="opt-item-group">
                        <div className="opt-item-group-head">
                          <span className="opt-group-name">{g.name}</span>
                          {g.is_required && <span className="opt-required">Bắt buộc</span>}
                          {g.is_multi && <span className="opt-hint">chọn nhiều được</span>}
                          <div className="btn-row btn-row-end opt-group-actions">
                            <button
                              className="btn btn-sm"
                              onClick={() => openChoiceForm(m.id, g.id)}
                            >
                              + Lựa chọn
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => onDetach(m.id, g.id, g.name)}
                            >
                              Gỡ
                            </button>
                          </div>
                        </div>

                        {g.choices.length === 0 ? (
                          <div className="opt-item-empty">Nhóm chưa có lựa chọn nào.</div>
                        ) : (
                          <div className="opt-choices">
                            {g.choices.map((c) => (
                              <div key={c.id} className="opt-choice-row">
                                <span className="opt-chip-name">{c.name}</span>
                                <span
                                  className={`opt-chip-price ${c.price_delta < 0 ? 'opt-chip-minus' : ''}`}
                                >
                                  {c.price_delta > 0 ? '+' : c.price_delta < 0 ? '−' : ''}
                                  {fmtVND(Math.abs(c.price_delta))}
                                  {c.price_delta === 0 ? ' (giá gốc)' : ''}
                                </span>
                                {!c.is_available && <span className="opt-hint">— đã ẩn</span>}
                                <div className="btn-row btn-row-end">
                                  <button
                                    className="btn btn-sm"
                                    onClick={() => startEditChoice(c, m.id, g.id)}
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => onDeleteChoice(c)}
                                  >
                                    Xoá
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ---- Form lựa chọn (modal) ---- */}
      {choiceCtx && (
        <div className="modal-backdrop" onClick={() => setChoiceCtx(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingChoiceId ? 'Sửa lựa chọn' : 'Thêm lựa chọn'}</h2>
              <button className="btn-icon" onClick={() => setChoiceCtx(null)}>
                ✕
              </button>
            </div>
            <form onSubmit={submitChoice}>
              <div className="modal-body">
                <div className="field">
                  <label>Tên lựa chọn *</label>
                  <input
                    value={choiceForm.name}
                    onChange={(e) => setChoiceForm({ ...choiceForm, name: e.target.value })}
                    placeholder="Size to"
                    required
                  />
                </div>
                <div className="field">
                  <label>Chênh lệch giá (đồng)</label>
                  <input
                    value={choiceForm.price_delta}
                    onChange={(e) => setChoiceForm({ ...choiceForm, price_delta: e.target.value })}
                    type="number"
                    step="1000"
                  />
                  <div className="panel-hint">
                    Dương = cộng thêm (vd <code>5000</code>), âm = giảm (vd <code>-5000</code>),{' '}
                    <code>0</code> = giá gốc.
                  </div>
                </div>
                <div className="field">
                  <label>Thứ tự hiển thị</label>
                  <input
                    value={choiceForm.sort_order}
                    onChange={(e) => setChoiceForm({ ...choiceForm, sort_order: e.target.value })}
                    type="number"
                    min="0"
                  />
                </div>
                <div className="field">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={choiceForm.is_available}
                      onChange={(e) =>
                        setChoiceForm({ ...choiceForm, is_available: e.target.checked })
                      }
                    />
                    Đang bán
                  </label>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setChoiceCtx(null)}>
                  Huỷ
                </button>
                <button type="submit" className="btn btn-primary" disabled={busyChoice}>
                  {busyChoice ? 'Đang lưu…' : 'Lưu lựa chọn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
