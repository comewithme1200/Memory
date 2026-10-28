import { fmtVND } from '../lib/format.js'

/**
 * Bộ chọn tuỳ chọn cho 1 món (kiểu GrabFood).
 *
 * Props:
 *   groups      — danh sách nhóm tuỳ chọn của món
 *                 [{ id, name, is_multi, is_required, choices: [...] }]
 *   value       — { [groupId]: [choiceId, ...] }  (lựa chọn hiện tại)
 *   onChange    — (groupId, choiceId) => void
 *   compact     — hiển thị gọn (dùng trong thẻ món trên danh sách)
 *
 * Quy tắc:
 *   - Nhóm `is_multi = false` -> chọn tối đa 1 (radio).
 *   - Nhóm `is_multi = true`  -> chọn nhiều (checkbox).
 *   - Nhóm `is_required = true` -> phải chọn ít nhất 1.
 */
export default function DishOptions({ groups, value = {}, onChange, compact = false }) {
  if (!groups?.length) return null

  return (
    <div className={`dish-options ${compact ? 'dish-options-compact' : ''}`}>
      {groups.map((g) => {
        const picked = value[g.id] || []
        return (
          <div key={g.id} className="opt-group">
            <div className="opt-group-head">
              <span className="opt-group-name">{g.name}</span>
              {g.is_required && <span className="opt-required">Bắt buộc</span>}
              {g.is_multi && <span className="opt-hint">chọn nhiều được</span>}
            </div>
            <div className="opt-choices">
              {g.choices.map((c) => {
                const on = picked.includes(c.id)
                const disabled = c.is_available === false
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`opt-chip ${on ? 'opt-chip-on' : ''} ${disabled ? 'opt-chip-off' : ''}`}
                    disabled={disabled}
                    onClick={() => onChange(g.id, c.id)}
                    aria-pressed={on}
                  >
                    <span className="opt-chip-name">{c.name}</span>
                    {c.price_delta !== 0 && (
                      <span className={`opt-chip-price ${c.price_delta < 0 ? 'opt-chip-minus' : ''}`}>
                        {c.price_delta > 0 ? '+' : '−'}
                        {fmtVND(Math.abs(c.price_delta))}
                      </span>
                    )}
                  </button>
                )
              })}
              {g.choices.length === 0 && <span className="opt-empty">Chưa có lựa chọn</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
