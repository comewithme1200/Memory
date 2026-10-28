import { useEffect, useMemo, useState } from 'react'
import { fmtVND } from '../lib/format.js'
import DishOptions from './DishOptions.jsx'

/**
 * MODAL THÊM MÓN — kiểu GrabFood.
 *
 * Mở ra khi khách bấm "+ Thêm" trên thẻ món, hoặc khi khách bấm vào 1 dòng
 * trong giỏ để SỬA lại options / ghi chú của dòng đó.
 *
 * Props:
 *   item        — món ăn { id, name, price, description }
 *   groups      — các nhóm tuỳ chọn của món [{ id, name, is_multi, is_required, choices }]
 *   initial     — { options, note, qty }  (dùng khi SỬA dòng trong giỏ)
 *   onCancel    — () => void
 *   onConfirm   — ({ options, note, qty }) => void
 */
export default function DishAddModal({ item, groups = [], initial, onCancel, onConfirm }) {
  // Lựa chọn hiện tại: { [groupId]: [choiceId, ...] }
  const [picked, setPicked] = useState({})
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)
  const [err, setErr] = useState('')

  // Khởi tạo từ dữ liệu cũ (khi sửa dòng trong giỏ)
  useEffect(() => {
    const next = {}
    for (const o of initial?.options || []) {
      const gid = o.option_id
      if (!gid) continue
      next[gid] = [...(next[gid] || []), o.id]
    }
    setPicked(next)
    setNote(initial?.note || '')
    setQty(Math.max(1, Number(initial?.qty) || 1))
    setErr('')
  }, [item?.id, initial])

  /** Bấm 1 lựa chọn: nhóm đơn -> thay thế, nhóm đa -> bật/tắt. */
  const toggleOption = (groupId, choiceId) => {
    const group = groups.find((g) => g.id === groupId)
    setPicked((prev) => {
      const cur = prev[groupId] || []
      if (group && !group.is_multi) {
        // Chọn 1: bấm lại lựa chọn đang chọn -> bỏ chọn (cho phép không chọn)
        return { ...prev, [groupId]: cur.includes(choiceId) ? [] : [choiceId] }
      }
      return {
        ...prev,
        [groupId]: cur.includes(choiceId)
          ? cur.filter((x) => x !== choiceId)
          : [...cur, choiceId],
      }
    })
  }

  /** Gom lựa chọn hiện tại thành mảng object đầy đủ (có tên + giá). */
  const selectedOptions = useMemo(() => {
    const out = []
    for (const g of groups) {
      for (const cid of picked[g.id] || []) {
        const c = g.choices.find((x) => x.id === cid)
        if (c) {
          out.push({
            id: c.id,
            option_id: g.id,
            menu_item_option_id: c.id,
            name: c.name,
            price_delta: c.price_delta || 0,
          })
        }
      }
    }
    return out
  }, [groups, picked])

  // Nhóm BẮT BUỘC chưa chọn -> chưa cho xác nhận
  const missingRequired = groups
    .filter((g) => g.is_required && (picked[g.id] || []).length === 0)
    .map((g) => g.name)

  const unitPrice = (item?.price || 0) + selectedOptions.reduce((s, o) => s + (o.price_delta || 0), 0)
  const lineTotal = unitPrice * qty

  const submit = () => {
    if (missingRequired.length > 0) {
      setErr(`Vui lòng chọn: ${missingRequired.join(', ')}`)
      return
    }
    setErr('')
    onConfirm({ options: selectedOptions, note: note.trim(), qty })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-dish" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-text">
            <h2>{item?.name}</h2>
            {item?.description && <p className="modal-head-sub">{item.description}</p>}
          </div>
          <button className="btn-icon" onClick={onCancel} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {groups.length > 0 ? (
            <DishOptions groups={groups} value={picked} onChange={toggleOption} />
          ) : (
            <p className="muted">Món này không có tuỳ chọn thêm.</p>
          )}

          <div className="field">
            <label>Ghi chú cho món này</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ít cay, không hành, thêm ớt riêng..."
              rows={2}
              maxLength={200}
            />
            <div className="field-hint">
              Ghi chú này chỉ áp dụng cho phần bạn đang thêm. Muốn ghi chú khác thì bấm
              “+ Thêm” lần nữa.
            </div>
          </div>

          {err && <div className="alert alert-error">{err}</div>}
        </div>

        <div className="modal-foot modal-foot-dish">
          <div className="stepper stepper-sm">
            <button
              className="btn-step"
              onClick={() => setQty((v) => Math.max(1, v - 1))}
              disabled={qty <= 1}
              aria-label="Bớt 1"
            >
              −
            </button>
            <input
              className="qty-input"
              type="number"
              inputMode="numeric"
              min="1"
              max="999"
              value={qty}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value))
                if (Number.isFinite(n) && n >= 1) setQty(n)
                else if (e.target.value === '') setQty(1)
              }}
              aria-label="Số lượng"
            />
            <button className="btn-step" onClick={() => setQty((v) => v + 1)} aria-label="Thêm 1">
              +
            </button>
          </div>
          <div className="modal-foot-right">
            <div className="modal-dish-price">
              <span className="muted">{fmtVND(unitPrice)} / món</span>
              <strong>{fmtVND(lineTotal)}</strong>
            </div>
            <button className="btn btn-primary" onClick={submit} disabled={missingRequired.length > 0}>
              Thêm vào giỏ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
