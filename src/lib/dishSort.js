/**
 * Sắp xếp danh sách món theo quy tắc của bếp / thống kê:
 *
 *   1. CÁC MÓN CÙNG TÊN phải nằm CẠNH NHAU trong danh sách.
 *      (Ví dụ "Xôi gà" size to và "Xôi gà" size thường — 2 dòng, phải liền kề,
 *      không được nằm lơ lửng 2 đầu bảng.)
 *
 *   2. TRONG MỖI NHÓM CÙNG TÊN, sắp theo ĐƠN GIÁ TĂNG DẦN
 *      (rẻ hơn lên trước, đắt hơn xuống sau).
 *
 *   3. THỨ TỰ GIỮA CÁC NHÓM: nhóm nào có TỔNG số lượng lớn nhất thì lên
 *      trước (món nào cần làm nhiều nhất thì bếp thấy trước).
 *
 * Hàm trả về MẢNG MỚI, không sửa mảng gốc.
 */

/**
 * @param {Array} rows        danh sách dòng (mỗi dòng có `name`)
 * @param {Function} priceOf  lấy đơn giá của 1 dòng -> number
 * @param {Function} qtyOf    lấy số lượng của 1 dòng -> number
 */
export function sortByNameThenPrice(rows, priceOf, qtyOf) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length <= 1) return list.slice()

  const price = typeof priceOf === 'function' ? priceOf : (r) => Number(r?.price) || 0
  const qty = typeof qtyOf === 'function' ? qtyOf : (r) => Number(r?.qty) || 0

  // Gom theo tên (không phân biệt hoa/thường, bỏ khoảng trắng thừa).
  const groups = new Map()
  for (const row of list) {
    const key = String(row?.name || '')
      .trim()
      .toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  // Trong mỗi nhóm: đơn giá tăng dần; cùng giá -> số lượng giảm dần.
  for (const g of groups.values()) {
    g.sort((a, b) => {
      const d = price(a) - price(b)
      if (d !== 0) return d
      return qty(b) - qty(a)
    })
  }

  // Giữa các nhóm: tổng số lượng của nhóm giảm dần; cùng tổng -> tên A-Z.
  const ordered = Array.from(groups.values()).sort((ga, gb) => {
    const ta = ga.reduce((s, r) => s + qty(r), 0)
    const tb = gb.reduce((s, r) => s + qty(r), 0)
    if (ta !== tb) return tb - ta
    return String(ga[0]?.name || '').localeCompare(String(gb[0]?.name || ''), 'vi')
  })

  return ordered.flat()
}
