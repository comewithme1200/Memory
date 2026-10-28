import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/styles.css'
let css = readFileSync(path, 'utf8')

// 1) Xoá TOÀN BỘ khối .btn-split (còn tồn tại 2 bản trùng nhau) và thay
//    bằng .btn-edit + các style mới cho modal thêm món.
const splitBlocks = css.match(/\.btn-split\s*\{[^}]*\}\s*(\/\*[^*]*\*\/\s*)?/g) || []
for (const b of splitBlocks) css = css.replace(b, '')

css = css.replace(/\.btn-split:hover\s*\{[^}]*\}\s*/g, '')

const newCss = `
/* Nút "Sửa" trên dòng giỏ (mở lại modal để đổi options / ghi chú) */
.btn-edit {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.btn-edit:hover {
  color: var(--brand);
  border-color: var(--brand);
  background: #fffdf7;
}

/* Tên món + nút Sửa nằm cùng hàng */
.cart-row-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* Ghi chú hiển thị (không sửa trực tiếp trong giỏ) */
.cart-note-view {
  font-size: 12.5px;
  color: var(--ink-2);
  background: #fffaf0;
  border: 1px solid #f2e3c4;
  border-radius: 8px;
  padding: 5px 8px;
  margin-top: 4px;
  word-break: break-word;
}

/* Gợi ý nhóm bắt buộc dưới tên món */
.dish-req {
  font-size: 11.5px;
  color: var(--danger);
  margin-top: 4px;
  font-weight: 600;
}

/* ------------------- MODAL THÊM MÓN (kiểu GrabFood) ---------------- */
.modal-dish {
  max-width: 480px;
}

.modal-head-text {
  min-width: 0;
}

.modal-head-sub {
  font-size: 12.5px;
  color: var(--muted);
  margin-top: 2px;
}

.field-hint {
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 5px;
  line-height: 1.4;
}

.modal-foot-dish {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.modal-foot-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.modal-dish-price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
}

.modal-dish-price strong {
  font-size: 16px;
}

/* Trên điện thoại: modal thêm món bám đáy màn hình, giống app Grab */
@media (max-width: 560px) {
  .modal-dish {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 18px 18px 0 0;
  }

  .modal-foot-dish {
    flex-direction: column;
    align-items: stretch;
  }

  .modal-foot-right {
    margin-left: 0;
    justify-content: space-between;
  }
}
`

// Chèn khối mới ngay trước ".cart-row-total {"
const anchor = '.cart-row-total {'
const idx = css.indexOf(anchor)
if (idx < 0) {
  console.log('Không tìm thấy điểm chèn .cart-row-total')
  process.exit(1)
}
css = css.slice(0, idx) + newCss.trim() + '\n\n' + css.slice(idx)

writeFileSync(path, css, 'utf8')
console.log(`Đã xoá ${splitBlocks.length} khối .btn-split và chèn style mới.`)
