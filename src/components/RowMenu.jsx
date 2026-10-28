import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * NÚT 3 CHẤM — gom các thao tác phụ của 1 dòng vào 1 menu.
 *
 * Dùng chung cho:
 *   - Danh sách đơn hàng (OrdersPage)
 *   - Danh sách khách quen (CustomersPage)
 *
 * LÝ DO cần gom:
 *   Nếu để tất cả nút cạnh nhau, mỗi dòng chiếm hết chỗ ngang (đặc biệt
 *   trên điện thoại) và chủ quán phải cuộn ngang để tìm nút. Menu 3 chấm
 *   giữ mỗi dòng gọn gàng, chỉ nút chính (Bắt đầu làm / Hoàn thành / In lại)
 *   nằm bên ngoài để bấm nhanh được.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO DÙNG `position: fixed` THAY VÌ `absolute`?
 *
 * Bảng admin nằm trong `.table-wrap` có `overflow-x: auto` (để bảng rộng
 * cuộn ngang được trên điện thoại). Mà `overflow` khác `visible` sẽ CẮT
 * mọi phần tử con nằm ngoài khung — kể cả menu `position: absolute`.
 * Hậu quả: bấm ⋮ mà menu bị cắt mất đầu, không thấy các mục.
 *
 * `position: fixed` thoát ra ngoài mọi vùng `overflow` của phần tử cha
 * (trừ khi cha có `transform`/`filter`), nên menu luôn hiện trọn vẹn.
 * Đổi lại phải tự tính toạ độ theo vị trí nút và cập nhật khi cuộn.
 * ---------------------------------------------------------------------------
 *
 * @param {Array<{ label: string, onClick: Function, danger?: boolean, icon?: string }>} items
 *        danh sách thao tác. Mỗi mục có thể có `danger: true` để tô đỏ.
 */
export default function RowMenu({ items = [], align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)

  // Đóng menu khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('touchstart', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('touchstart', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * Tính vị trí menu.
   *
   * Menu ưu tiên mở LÊN (phía trên nút) — giống menu quen thuộc. Nhưng nếu
   * không đủ chỗ phía trên (nút nằm sát đầu trang) thì mở XUỐNG.
   */
  useLayoutEffect(() => {
    if (!open) return

    const place = () => {
      const btn = btnRef.current
      const pop = popRef.current
      if (!btn || !pop) return

      const b = btn.getBoundingClientRect()
      const p = pop.getBoundingClientRect()
      const gap = 6
      const margin = 8 // chừa mép màn hình

      // Ưu tiên mở lên: menu nằm ngay TRÊN nút.
      let top = b.top - p.height - gap

      // Không đủ chỗ phía trên -> mở xuống.
      if (top < margin) {
        top = b.bottom + gap
      }
      // Mở xuống mà vẫn tràn dưới màn hình -> dồn lên.
      if (top + p.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - p.height - margin)
      }

      // Căn theo mép phải của nút (menu thường là dropdown ở góc phải).
      let left = b.right - p.width
      if (left < margin) left = b.left
      if (left + p.width > window.innerWidth - margin) {
        left = window.innerWidth - p.width - margin
      }

      setPos({ top, left })
    }

    place()
    // Cập nhật lại khi cuộn trang / đổi kích thước màn hình.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, items.length])

  // Mọi thao tác đều đóng menu sau khi bấm.
  const run = (fn) => () => {
    setOpen(false)
    fn?.()
  }

  if (!items.length) return null

  return (
    <div className="order-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        className={`btn btn-sm btn-icon-menu ${open ? 'btn-icon-menu-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tuỳ chọn khác"
        aria-label="Tuỳ chọn khác"
      >
        ⋮
      </button>

      {open && (
        <div
          ref={popRef}
          className="order-menu-pop order-menu-pop-fixed"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              className={`order-menu-item ${it.danger ? 'order-menu-item-danger' : ''}`}
              role="menuitem"
              onClick={run(it.onClick)}
            >
              {it.icon ? `${it.icon} ` : ''}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
