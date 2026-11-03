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

/* ------------------------------------------------------------------ *
 * MÔ HÌNH DỮ LIỆU
 *
 *   options (nhóm)  ─┐
 *                    ├─ menu_item_option_groups ─> menu_item_options
 *   menu_items ─────┘
 *
 * Nhóm tuỳ chọn dùng CHUNG cho nhiều món (vd "Size" cho cả Phở và Bún bò).
 * Mỗi cặp (món, nhóm) có riêng một danh sách lựa chọn.
 *
 * Trang này hiển thị theo góc nhìn "nhóm": mỗi nhóm tuỳ chọn, và bên dưới
 * là các món đang dùng nhóm đó + các lựa chọn của từng món.
 * ------------------------------------------------------------------ */

export default function OptionsPage() {
  const [items, setItems] = useState([])
  const [groups, setGroups] = useState([])
  const [optsByItem, setOptsByItem] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  // ---- MODAL THÊM / SỬA NHÓM TUỲ CHỌN ----------------------------
  // `groupModal` = null | { mode: 'add' } | { mode: 'edit', group }
  const [groupModal, setGroupModal] = useState(null)
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP)
  const [busyGroup, setBusyGroup] = useState(false)

  // Món được chọn để gán kèm khi tạo nhóm (OPTIONAL — có thể bỏ trống).
  const [assignItems, setAssignItems] = useState([])
  const [assignRequired, setAssignRequired] = useState(false)

  // ---- MODAL GẮN TUỲ CHỌN CHO MÓN --------------------------------
  // Dùng khi quên gán lúc tạo nhóm -> gán bổ sung sau.
  //
  // Chọn MÓN QUA DROPDOWN, và danh sách dropdown CHỈ hiện những món CHƯA
  // có nhóm tuỳ chọn đang chọn (đã gán rồi thì bị lọc đi) -> tránh gán
  // trùng, và danh sách luôn gọn.
  const [assignModal, setAssignModal] = useState(false)
  const [assignGroupId, setAssignGroupId] = useState('')
  const [assignItemId, setAssignItemId] = useState('')
  const [busyAssign, setBusyAssign] = useState(false)

  // ---- MODAL THÊM / SỬA LỰA CHỌN ----------------------------------
  // `choiceCtx` = { menuItemId, groupId }
  const [choiceCtx, setChoiceCtx] = useState(null)
  const [choiceForm, setChoiceForm] = useState(EMPTY_CHOICE)
  const [editingChoiceId, setEditingChoiceId] = useState(null)
  const [busyChoice, setBusyChoice] = useState(false)

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

  const openAddGroup = () => {
    setGroupModal({ mode: 'add' })
    setGroupForm(EMPTY_GROUP)
    setAssignItems([])
    setAssignRequired(false)
    setError('')
  }

  const openEditGroup = (g) => {
    setGroupModal({ mode: 'edit', group: g })
    setGroupForm({
      name: g.name,
      description: g.description || '',
      is_multi: g.is_multi === true,
    })
    setAssignItems([])
    setError('')
  }

  const submitGroup = async (e) => {
    e.preventDefault()
    if (!groupForm.name.trim()) return setError('Tên nhóm tuỳ chọn không được để trống.')
    setError('')
    setBusyGroup(true)
    try {
      let groupId = groupModal?.group?.id
      if (groupModal?.mode === 'edit') {
        await updateOptionGroup(groupId, groupForm)
      } else {
        const created = await createOptionGroup(groupForm)
        groupId = created?.id
      }

      // Gán cho các món đã tick (nếu có) — chọn trong lúc tạo nhóm.
      if (groupId && assignItems.length > 0) {
        for (const itemId of assignItems) {
          await attachOptionGroup(itemId, groupId, { isRequired: assignRequired })
        }
      }

      await reload()
      setGroupModal(null)
      flash(
        groupModal?.mode === 'edit'
          ? 'Đã cập nhật nhóm tuỳ chọn.'
          : assignItems.length > 0
            ? `Đã thêm nhóm tuỳ chọn và gán cho ${assignItems.length} món.`
            : 'Đã thêm nhóm tuỳ chọn.',
      )
    } catch (err) {
      setError(err.message || 'Lưu nhóm tuỳ chọn thất bại.')
    } finally {
      setBusyGroup(false)
    }
  }

  const onDeleteGroup = async (g) => {
    if (
      !window.confirm(
        `Xoá nhóm tuỳ chọn "${g.name}"? Tất cả lựa chọn thuộc nhóm này (ở mọi món) cũng bị xoá.`,
      )
    )
      return
    try {
      await deleteOptionGroup(g.id)
      await reload()
      flash('Đã xoá nhóm tuỳ chọn.')
    } catch (e) {
      setError(e.message)
    }
  }

  /* ---------------------- GẮN NHÓM VÀO MÓN ---------------------- */

  const openAssign = () => {
    setAssignModal(true)
    setAssignGroupId(groups[0]?.id || '')
    setAssignItemId('')
    setAssignRequired(false)
    setError('')
  }

  const onAssign = async () => {
    if (!assignGroupId) return setError('Chọn nhóm tuỳ chọn.')
    if (!assignItemId) return setError('Chọn món ăn.')
    setError('')
    setBusyAssign(true)
    try {
      await attachOptionGroup(assignItemId, assignGroupId, { isRequired: assignRequired })
      await reload()
      setAssignModal(false)
      const name = items.find((m) => m.id === assignItemId)?.name
      flash(`Đã gắn nhóm tuỳ chọn cho món "${name}".`)
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

  /* ---------------------- LỰA CHỌN ---------------------- */

  const openChoiceForm = (menuItemId, groupId) => {
    setChoiceCtx({ menuItemId, groupId })
    setChoiceForm(EMPTY_CHOICE)
    setEditingChoiceId(null)
    setError('')
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
      setChoiceCtx(null)
      await reload()
    } catch (err) {
      setError(err.message || 'Lưu lựa chọn thất bại.')
    } finally {
      setBusyChoice(false)
    }
  }

  const onDeleteChoice = async (c) => {
    if (!window.confirm(`Xoá lựa chọn "${c.name}"?`)) return
    try {
      await deleteItemOption(c.id)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  /* ---------------------- DỮ LIỆU HIỂN THỊ ---------------------- */

  /**
   * Đảo ngược `optsByItem` (Map<mónId, groups[]>) thành
   * Map<nhómId, [{ item, group, choices }]> — để hiển thị theo góc nhìn
   * "nhóm tuỳ chọn này dùng cho món nào".
   */
  const usageByGroup = useMemo(() => {
    const map = new Map()
    for (const [itemId, list] of optsByItem) {
      const item = items.find((m) => m.id === itemId)
      if (!item) continue
      for (const g of list) {
        const arr = map.get(g.id) || []
        arr.push({ item, group: g, choices: g.choices || [] })
        map.set(g.id, arr)
      }
    }
    return map
  }, [optsByItem, items])

  /** Nhóm đang dùng cho 1 món (dùng để đánh dấu "đã gán" trong modal gán). */
  const groupIdsOfItem = (itemId) =>
    (optsByItem.get(itemId) || []).map((g) => g.id)

  /**
   * Món CHƯA có nhóm tuỳ chọn `groupId` — dùng cho dropdown trong modal gán.
   *
   * Món đã gán nhóm đó rồi thì bị LỌC ĐI: gán lần nữa vô nghĩa (bảng
   * `menu_item_option_groups` có khoá duy nhất (menu_item_id, option_id),
   * `upsert` chỉ ghi đè chứ không tạo bản sao), và nếu hiện ra thì chủ quán
   * dễ tick nhầm.
   */
  const itemsWithoutGroup = useMemo(() => {
    if (!assignGroupId) return items
    return items.filter((m) => !groupIdsOfItem(m.id).includes(assignGroupId))
  }, [items, assignGroupId, optsByItem])

  const toggleIn = (list, id) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <>
      <h2 className="page-heading">Tuỳ chọn món</h2>
      <p className="page-sub">
        Tạo các tuỳ chọn kiểu GrabFood (Size to +5k, Size nhỏ −5k…). Khách chọn tuỳ chọn
        ngay trên thực đơn, giá được cộng/trừ tự động.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {okMsg && <div className="alert alert-success">{okMsg}</div>}

      {/* ---- Danh sách nhóm tuỳ chọn + món dùng nhóm ---- */}
      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title panel-title-mb0">Tuỳ chọn ({groups.length} nhóm)</h2>
          <div className="btn-row">
            <button className="btn" onClick={openAssign} disabled={groups.length === 0}>
              🔗 Gán tuỳ chọn
            </button>
            <button className="btn btn-primary" onClick={openAddGroup}>
              ➕ Thêm tuỳ chọn
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty">Đang tải…</div>
        ) : groups.length === 0 ? (
          <div className="empty">
            Chưa có nhóm tuỳ chọn nào. Bấm <strong>➕ Thêm tuỳ chọn</strong> để tạo nhóm đầu
            tiên.
          </div>
        ) : (
          <div className="opt-groups">
            {groups.map((g) => {
              const used = usageByGroup.get(g.id) || []
              return (
                <article key={g.id} className="opt-group-card">
                  <div className="opt-group-card-head">
                    <div className="opt-group-card-title">
                      <span className="opt-group-name opt-group-name-lg">{g.name}</span>
                      {g.is_multi && <span className="opt-hint">chọn nhiều được</span>}
                      <span className="muted small">
                        {used.length > 0
                          ? `· dùng cho ${used.length} món`
                          : '· chưa gán cho món nào'}
                      </span>
                    </div>
                    <div className="btn-row btn-row-end">
                      <button className="btn btn-sm" onClick={() => openEditGroup(g)}>
                        Sửa
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => onDeleteGroup(g)}>
                        Xoá
                      </button>
                    </div>
                  </div>

                  {g.description && <div className="muted small">{g.description}</div>}

                  {used.length === 0 ? (
                    <div className="opt-item-empty">
                      Nhóm này chưa gắn vào món nào. Bấm “🔗 Gán tuỳ chọn” để gán.
                    </div>
                  ) : (
                    used.map(({ item, group, choices }) => (
                      <div key={item.id} className="opt-item-group">
                        <div className="opt-item-group-head">
                          <span className="opt-chip-name opt-dish-name">{item.name}</span>
                          <span className="muted small">· {fmtVND(item.price)}</span>
                          {group.is_required && <span className="opt-required">Bắt buộc</span>}
                          <div className="btn-row btn-row-end opt-group-actions">
                            <button
                              className="btn btn-sm"
                              onClick={() => openChoiceForm(item.id, g.id)}
                            >
                              + Lựa chọn
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => onDetach(item.id, g.id, g.name)}
                            >
                              Gỡ
                            </button>
                          </div>
                        </div>

                        {choices.length === 0 ? (
                          <div className="opt-item-empty">
                            Món này chưa có lựa chọn nào trong nhóm “{g.name}”.
                          </div>
                        ) : (
                          <div className="opt-choices opt-choices-rows">
                            {choices.map((c) => (
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
                                    onClick={() => startEditChoice(c, item.id, g.id)}
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
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* ---- MODAL THÊM / SỬA NHÓM TUỲ CHỌN ---- */}
      {groupModal && (
        <div className="modal-backdrop" onClick={() => setGroupModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{groupModal.mode === 'edit' ? 'Sửa nhóm tuỳ chọn' : 'Thêm nhóm tuỳ chọn'}</h2>
              <button className="btn-icon" onClick={() => setGroupModal(null)} aria-label="Đóng">
                ✕
              </button>
            </div>

            <form onSubmit={submitGroup}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}

                <div className="form-grid">
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
                  <div className="field field-full">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={groupForm.is_multi}
                        onChange={(e) => setGroupForm({ ...groupForm, is_multi: e.target.checked })}
                      />
                      Cho phép chọn nhiều lựa chọn trong nhóm này
                    </label>
                  </div>
                </div>

                {/* ---- Gán cho món ăn (OPTIONAL) ---- */}
                <div className="assign-block">
                  <div className="assign-head">
                    <div>
                      <strong>Gán cho món ăn</strong>
                      <div className="muted small">
                        Không bắt buộc. Nếu chưa gán được thì dùng nút “🔗 Gán tuỳ chọn” bên
                        ngoài để gán sau.
                      </div>
                    </div>
                    {assignItems.length > 0 && (
                      <span className="badge badge-new">{assignItems.length} món</span>
                    )}
                  </div>

                  {items.length === 0 ? (
                    <div className="opt-item-empty">Chưa có món nào trong thực đơn.</div>
                  ) : (
                    <div className="dish-picker">
                      {items.map((m) => {
                        const checked = assignItems.includes(m.id)
                        return (
                          <label key={m.id} className={`dish-pick ${checked ? 'dish-pick-on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setAssignItems((prev) => toggleIn(prev, m.id))}
                            />
                            <span className="dish-pick-name">{m.name}</span>
                            <span className="muted small">{fmtVND(m.price)}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {assignItems.length > 0 && (
                    <label className="check assign-required">
                      <input
                        type="checkbox"
                        checked={assignRequired}
                        onChange={(e) => setAssignRequired(e.target.checked)}
                      />
                      Bắt buộc chọn (khách không chọn thì không thêm vào giỏ được)
                    </label>
                  )}
                </div>
              </div>

              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setGroupModal(null)}>
                  Huỷ
                </button>
                <button type="submit" className="btn btn-primary" disabled={busyGroup}>
                  {busyGroup
                    ? 'Đang lưu…'
                    : groupModal.mode === 'edit'
                      ? 'Lưu thay đổi'
                      : 'Thêm tuỳ chọn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- MODAL GẮN TUỲ CHỌN CHO MÓN ---- */}
      {assignModal && (
        <div className="modal-backdrop" onClick={() => setAssignModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Gán tuỳ chọn cho món</h2>
              <button className="btn-icon" onClick={() => setAssignModal(false)} aria-label="Đóng">
                ✕
              </button>
            </div>

            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}

              <div className="field">
                <label>Nhóm tuỳ chọn *</label>
                <select value={assignGroupId} onChange={(e) => setAssignGroupId(e.target.value)}>
                  <option value="">— Chọn nhóm —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Món ăn *</label>
                <select value={assignItemId} onChange={(e) => setAssignItemId(e.target.value)}>
                  <option value="">— Chọn món —</option>
                  {itemsWithoutGroup.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {fmtVND(m.price)}
                    </option>
                  ))}
                </select>
                <div className="field-hint">
                  {assignGroupId ? (
                    itemsWithoutGroup.length === 0 ? (
                      <>
                        Tất cả món đã có nhóm này rồi. Muốn gán lại thì bấm “Gỡ” ở danh sách bên
                        ngoài.
                      </>
                    ) : (
                      <>
                        Chỉ hiện món <strong>chưa</strong> có nhóm này ({itemsWithoutGroup.length}{' '}
                        món). Món đã gán rồi được lọc đi.
                      </>
                    )
                  ) : (
                    'Chọn nhóm tuỳ chọn trước, danh sách món sẽ được lọc theo nhóm đó.'
                  )}
                </div>
              </div>

              <label className="check assign-required">
                <input
                  type="checkbox"
                  checked={assignRequired}
                  onChange={(e) => setAssignRequired(e.target.checked)}
                />
                Bắt buộc chọn (khách không chọn thì không thêm vào giỏ được)
              </label>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setAssignModal(false)}>
                Huỷ
              </button>
              <button
                className="btn btn-primary"
                onClick={onAssign}
                disabled={busyAssign || !assignGroupId || !assignItemId}
              >
                {busyAssign ? 'Đang gắn…' : 'Gán cho món'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- MODAL THÊM / SỬA LỰA CHỌN ---- */}
      {choiceCtx && (
        <div className="modal-backdrop" onClick={() => setChoiceCtx(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingChoiceId ? 'Sửa lựa chọn' : 'Thêm lựa chọn'}</h2>
              <button className="btn-icon" onClick={() => setChoiceCtx(null)} aria-label="Đóng">
                ✕
              </button>
            </div>
            <form onSubmit={submitChoice}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}
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
