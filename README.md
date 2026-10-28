# 🍜 Quán Ăn Sáng

Ứng dụng quản lý bán đồ ăn sáng: khách đặt món trên điện thoại, chủ quán quản lý thực đơn, in hoá đơn và tổng kết số lượng từng món.

Xây dựng bằng **React + Vite + HTML/CSS thuần**, dữ liệu lưu trên **Supabase (free plan)**, deploy lên **GitHub Pages**.

---

## 📋 Các chức năng

| Trang | Đường dẫn | Dùng để |
|---|---|---|
| **Đặt hàng** | `#/` | Khách chọn món, ghi tên/SĐT/bàn, **ghi chú riêng cho từng món**, chọn **tiền mặt / chuyển khoản**, gửi đơn — *không cần đăng nhập* |
| **Đăng nhập** | `#/quan-tri/dang-nhap` | Chủ quán đăng nhập bằng email + mật khẩu |
| **Quản lý món** | `#/quan-tri/mon` | Thêm / sửa / xoá món, đặt giá, ẩn món hết hàng |
| **Đơn hàng** | `#/quan-tri/orders` | **🔥 Bảng món cần làm** (gom món của đơn chưa xong), xem đơn mới, chuyển trạng thái, **tick "Đã thanh toán"**, **in hoá đơn**, huỷ/xoá |
| **Tổng kết** | `#/quan-tri/tong-ket` | Tổng số suất từng món theo ngày/tuần/tháng, doanh thu |
| **Khách quen & mã QR** | `#/quan-tri/khach` | Thêm khách quen (tên/SĐT/địa chỉ), **sinh mã QR** để khách quét → vào thẳng trang đặt món, **thông tin đã điền sẵn** |
| **In hoá đơn** | tự động | Khi bấm "Xong & in hoá đơn" → mở hộp thoại in ngay, khổ giấy 80mm |

> 🔒 Toàn bộ trang `#/quan-tri/*` đều **yêu cầu đăng nhập** và được bảo vệ bởi **Supabase RLS**
> (xem mục *🗄️ Setup Supabase*).

---

## 🚀 Chạy server local

### Yêu cầu

- **Node.js 18 trở lên** → kiểm tra bằng `node -v` ([tải tại đây](https://nodejs.org))
- **npm** (đi kèm khi cài Node.js)

### Bước 1 — Cài đặt

Mở terminal tại thư mục dự án `d:\Memory` rồi chạy:

```bash
npm install
```

> Lệnh này tải các thư viện (React, Vite, Supabase…) vào thư mục `node_modules`. Chỉ cần chạy **một lần**.

### Bước 2 — Tạo file `.env` (tuỳ chọn)

Ứng dụng chạy được **ngay** mà không cần Supabase (chế độ demo, dữ liệu lưu trong trình duyệt).
Muốn dùng Supabase thật thì điền 2 dòng vào file `.env` (tôi đã tạo sẵn file này):

```env
VITE_SUPABASE_URL=https://xxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> Không điền thì app tự chuyển sang chế độ demo, đăng nhập bằng PIN `1234`.
> Muốn xoá dữ liệu demo: xoá key `quan-an-sang:v1` trong LocalStorage của trình duyệt.
> Chi tiết setup Supabase từng bước: mục **🗄️ Setup Supabase** bên dưới.

### Bước 3 — Chạy dev server

```bash
npm run dev
```

Mở trình duyệt tại: **http://localhost:5173**

```
  VITE v8.3.5  ready in 167 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/     <- dùng để test bằng điện thoại
```

> Muốn **khách hàng đặt món bằng điện thoại** trong lúc thử, dùng địa chỉ *Network* trên, 
> điện thoại và máy tính phải **cùng một mạng Wi‑Fi**.

### Các lệnh khác

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy dev server (có hot reload) |
| `npm run build` | Build ra thư mục `dist/` để deploy |
| `npm run preview` | Xem bản build tại http://localhost:4173 |
| `npm run check` | Kiểm tra kết nối Supabase + hành vi RLS (gồm cả bảng trung gian) |
| `npm run check:qr` | Kiểm tra riêng phần **khách quen / mã QR** (bảng `customers`, RPC, quyền) |
| `npm run test:payment` | Kiểm tra phần **thanh toán** (cột `payment_method`, `is_paid`, RPC `create_order`) |
| `npm run verify:migration` | So khớp dữ liệu đơn cũ (JSONB) với bảng `order_items` |
| `npm run deploy` | Build + đẩy lên GitHub Pages (cần `gh-pages`) |

**Dừng server:** nhấn `Ctrl + C` trong terminal.

---

## 🗄️ Setup Supabase (làm TRƯỚC khi chạy thật)

> Bỏ qua mục này nếu bạn chỉ muốn xem giao diện (app sẽ chạy ở chế độ demo với PIN).
> Làm theo thứ tự từ trên xuống dưới.

### Bước 1 — Tạo project

1. Vào [supabase.com](https://supabase.com) → **Start your project**
2. Đăng nhập bằng GitHub hoặc Google (miễn phí)
3. **Organization** → để mặc định hoặc tạo mới → **Next**
4. **Project name**: `quan-an-sang` → **Password**: bấm **Generate a strong password** và **lưu lại mật khẩu này** (dùng để vào Dashboard)
5. **Database Password**: bấm **Generate a strong password** → **lưu lại** (cần cho CLI/reset)
6. **Region**: chọn gần bạn nhất (Singapore cho Việt Nam) → **Next**
7. Chờ ~2 phút để Supabase khởi tạo → **Create new project**

### Bước 2 — Tạo bảng dữ liệu

1. Vào **SQL Editor** (biểu tượng `</>` ở menu trái) → **New query**
2. Xoá hết nội dung đang có, dán toàn bộ nội dung file [`supabase/schema.sql`](supabase/schema.sql)
   - Mở file đó bằng VS Code: `Ctrl+C` rồi `Ctrl+V` vào ô SQL Editor
3. Bấm **Run** (hoặc `Ctrl+Enter`)
4. Thấy thông báo `Success. No rows returned` là được

> Script này tạo bảng `menu_items` + `orders`, bật **RLS** (Row Level Security) và cấu hình policy:
> - `anon` (khách) → chỉ **đọc** thực đơn, chỉ **tạo** đơn
> - `authenticated` (chủ quán đã đăng nhập) → **toàn quyền**
>
> Kiểm tra: menu **Table Editor** → thấy 2 bảng `menu_items`, `orders`, trong `menu_items` có 6 món mẫu.

### Bước 2b — (Nâng cấp) Tách bảng trung gian `order_items`

> Bước này là **tuỳ chọn**. Nếu bạn chỉ dùng app với quán nhỏ, bỏ qua vẫn chạy bình thường.

Ban đầu các món trong đơn được lưu dạng JSONB trong cột `orders.items`. Bước này chuyển sang
**bảng trung gian `order_items`** — mô hình hoá đúng quan hệ nhiều-nhiều giữa đơn và món:

1. Vào **SQL Editor** → **New query**
2. Dán toàn bộ nội dung file [`supabase/migration-order-items.sql`](supabase/migration-order-items.sql)
3. Bấm **Run**

Script này:
- tạo bảng `order_items` (+ index, + RLS: khách **không** được đọc, chủ quán toàn quyền)
- tạo RPC `create_order(...)` — ghi đơn + dòng món trong **một transaction**
- tạo RPC `summarize_orders(...)` — tổng kết bằng `GROUP BY` ngay trong SQL
- **migrate** các đơn cũ từ JSONB sang bảng mới (chạy lại không tạo trùng)

> ⚠️ Cột `orders.items` (JSONB) **không bị xoá** — giữ lại để rollback an toàn.
> Script chạy được nhiều lần (idempotent).

### Bước 2c — (Quan trọng) Siết quyền & sửa kiểu trả về

Hai file SQL sau đã được viết sẵn để vá các lỗi bảo mật/tính đúng đã phát hiện
khi kiểm thử. Chạy cả hai trong SQL Editor:

| File | Sửa gì |
|---|---|
| [`supabase/fix-summarize-permissions.sql`](supabase/fix-summarize-permissions.sql) | Gỡ quyền `EXECUTE` của `summarize_orders` cho `anon` — nếu không, **khách đọc được doanh thu của quán** |
| [`supabase/fix-create-order-return.sql`](supabase/fix-create-order-return.sql) | Đổi `create_order` từ trả `uuid` sang trả `jsonb` (kèm `total` đã tính ở server + món đã chốt) → màn hình "đặt món thành công" hiện đúng số tiền |

> Lý do phải `revoke` cho `anon` **riêng** (không chỉ `from public`): `anon` là
> thành viên của role `public`, nên `revoke ... from public` **không** đủ.
> Chi tiết ở mục *Trợ giúp → Bẫy bảo mật #3*.

Sau khi chạy, kiểm tra bằng `npm run check`:
```
PHẦN A — Khách (anon key) — đúng như trình duyệt của khách
  OK   RLS chặn đúng: khách không xem được tổng kết (doanh thu)
  ...
PHẦN A2 — Bảng trung gian order_items
  OK   RLS chặn đúng: khách không đọc được dòng món của đơn (0 dòng)
  OK   Khách tạo đơn qua RPC create_order được
```

### Bước 2d — (Mới) Khách quen & mã QR

> Bước này **bắt buộc** nếu bạn muốn dùng tính năng *Khách quen & mã QR*
> (trang `#/quan-tri/khach`). Nếu không chạy, trang đó sẽ báo lỗi
> *"Could not find the table 'public.customers'"*.

1. Vào **SQL Editor** → **New query**
2. Dán toàn bộ nội dung file [`supabase/migration-customers-qr.sql`](supabase/migration-customers-qr.sql)
3. Bấm **Run**

Script này:
- tạo bảng `customers` (khách quen: tên, SĐT, địa chỉ, **token QR**)
- thêm cột `orders.customer_address` + `orders.customer_id`
- tạo RPC `customer_by_token(token)` — khách quét QR gọi hàm này để lấy thông tin
- nâng RPC `create_order(...)` lên 8 tham số (thêm địa chỉ + token khách quen)
- **gỡ quyền xem doanh thu cho khách** (đồng thời vá luôn lỗi ở Bước 2c)

> Script **chạy được nhiều lần** (idempotent) và **không xoá dữ liệu nào**.

Sau khi chạy, kiểm tra bằng `npm run check:qr`:
```
  ĐÃ CÓ  Bảng `customers`
  ĐÃ CÓ  Cột `orders.customer_address`
  ĐÃ CÓ  RPC `customer_by_token`
  ĐÃ CÓ  RPC `create_order` đã có tham số địa chỉ + token
  ĐÃ CÓ  RPC `summarize_orders` đã bị chặn cho khách (anon)
```

### Bước 2e — (Mới) Tuỳ chọn món kiểu GrabFood

> Bước này **bắt buộc** nếu bạn muốn dùng tính năng *tuỳ chọn món*
> (Size to +5k / Size nhỏ −5k, Topping, Mức cay…). Nếu không chạy, trang
> `#/quan-tri/tuy-chon` sẽ báo lỗi *"Could not find the table 'public.options'"*.

1. Vào **SQL Editor** → **New query**
2. Dán toàn bộ nội dung file [`supabase/migration-options.sql`](supabase/migration-options.sql)
3. Bấm **Run**

Script này tạo 4 bảng (mô hình nhiều-nhiều):

| Bảng | Vai trò |
|---|---|
| `options` | Nhóm tuỳ chọn dùng chung: `Size`, `Topping`, `Mức cay` |
| `menu_item_options` | Lựa chọn cụ thể của 1 món: *Size to +5k*, *Size nhỏ −5k* |
| `menu_item_option_groups` | Bảng trung gian: gắn nhóm vào món (1 món ↔ nhiều nhóm, 1 nhóm ↔ nhiều món) |
| `order_item_options` | Bảng trung gian: lưu tuỳ chọn khách đã chọn trong đơn (1 dòng món ↔ nhiều tuỳ chọn) |

Đồng thời thêm cột `order_items.line_index` và nâng RPC `create_order(...)` lên **9 tham số**
(thêm `p_item_options`).

> ⚠️ **Giá do server tính.** `price_delta` được tra lại từ DB trong `create_order`,
> không tin giá client gửi lên. Client có thể gửi `priceDelta: 999999` nhưng server
> vẫn lấy đúng `price_delta` thật của lựa chọn đó.

4. *(Tuỳ chọn)* Nạp dữ liệu mẫu — dán file
   [`supabase/seed-options.sql`](supabase/seed-options.sql) vào SQL Editor và **Run**.
   Tạo sẵn: Size (to/vừa/nhỏ), Topping (trứng/gà), Mức cay — gắn cho Xôi thập cẩm,
   Bánh mì, Mì trộn. Chạy lại nhiều lần không tạo trùng.

   > Hoặc không cần SQL: vào trang quản trị **Tuỳ chọn** để tự thêm nhóm/lựa chọn.

5. **Bắt buộc** — chạy file vá lỗi giá:
   [`supabase/fix-create-order-price.sql`](supabase/fix-create-order-price.sql)

   > ⚠️ **Bắt buộc**, nếu bỏ qua thì giá hiển thị trên hoá đơn **SẼ SAI**:
   > mỗi món có tuỳ chọn đều bị tính bằng **giá gốc**, mất hết phần
   > +5k / −5k của Size.
   >
   > Nguyên nhân: `jsonb_agg(eo->'options')` gom thành **mảng lồng mảng**
   > `[[{...}]]` → `o->>'menuItemOptionId'` = NULL → không join được
   > `menu_item_options` → `sum(price_delta)` = NULL → giá mất sạch phần delta.

6. Kiểm tra bằng `npm run check:options` và `npm run test:price`:

```
  ĐÃ CÓ  Bảng `options`
  ĐÃ CÓ  Bảng `menu_item_options`
  ĐÃ CÓ  Bảng `menu_item_option_groups`
  ĐÃ CÓ  Bảng `order_item_options`
  ĐÃ CÓ  Cột `order_items.line_index`
  ĐÃ CÓ  RPC `create_order` đã có tham số `p_item_options`
```

```
Tổng MONG ĐỢI: 95.000 đ
Tổng THỰC TẾ: 95.000 đ
✅ GIÁ ĐÚNG
```

### Bước 2f — (Mới) Thanh toán: tiền mặt / chuyển khoản

> Bước này **bắt buộc** nếu bạn muốn dùng tính năng *chọn cách thanh toán*
> và *tick "Đã thanh toán"*. Nếu không chạy, khách vẫn đặt món được (chỉ mất
> phần chuyển khoản), nhưng đơn sẽ luôn hiện là "Tiền mặt".

1. Vào **SQL Editor** → **New query**
2. Dán toàn bộ nội dung file [`supabase/migration-payment.sql`](supabase/migration-payment.sql)
3. Bấm **Run**

File này:
- thêm cột `orders.payment_method` (`cash` | `transfer`) và `orders.is_paid`
- nâng RPC `create_order` lên **10 tham số** (thêm `p_payment_method`)

> Script **chạy được nhiều lần** (idempotent) và **không xoá dữ liệu đơn cũ**
> (đơn cũ tự nhận `cash` + chưa thanh toán).

Kiểm tra bằng `npm run test:payment`:

```
  OK   RPC create_order nhận p_payment_method thành công
       Server trả về payment_method = transfer
  OK   is_paid mặc định = false (chưa thu tiền)
  OK   Chủ quán tick "Đã thanh toán" thành công
✓ Tính năng thanh toán hoạt động đúng.
```

#### 🏦 Đặt ảnh QR ngân hàng

Mặc định app hiện một khung placeholder. Để hiện **ảnh QR thật của bạn**:

1. Copy ảnh QR ngân hàng vào thư mục `public/` với tên **`bank-qr.png`**
   (ảnh vuông, nền trắng, khoảng 500×500px trở lên là quét tốt nhất)
2. Sửa `.env` (hoặc `.env.production`) nếu muốn dùng đường dẫn khác:

```env
VITE_BANK_QR_URL=/bank-qr.png
```

> Vite chỉ đọc biến `VITE_*` **lúc khởi động / build** → sửa xong phải tắt và
> chạy lại `npm run dev` (hoặc `npm run build`) mới có hiệu lực.

### Bước 3 — Tạo tài khoản chủ quán

1. Menu trái → **Authentication** → **Users** (tab)
2. Bấm **Add user** → **Create new user**
3. Điền:
   - **Email**: email của bạn (vd: `chuquan@gmail.com`)
   - **Password**: mật khẩu (tối thiểu 6 ký tự)
   - **Auto Confirm User**: ✅ **bật** (để không phải xác nhận email)
4. Bấm **Create user**

> **Bắt buộc bật "Auto Confirm User"**, nếu không sẽ phải xác nhận qua email mới đăng nhập được.
> Hoặc tắt hẳn: **Authentication → Sign In / Providers → Email** → bỏ tick **Confirm email**.

### Bước 4 — Lấy API key

1. Menu trái → **Project Settings** (biểu tượng bánh răng) → **API**
2. Ở mục **Project URL** → copy (dạng `https://xxxx.supabase.co`)
3. Ở mục **Project API keys** → copy **anon public** (dạng `eyJhbGciOi...`)

> ⚠️ Chỉ copy **anon public** key. Tuyệt đối không dùng **service_role** key trong mã frontend —
> key này bypass toàn bộ RLS, ai có nó là đọc/sửa/xoá được mọi dữ liệu.
> Nếu lỡ lộ service_role key: vào Dashboard → **API** → **Reset** ngay lập tức.

### Bước 5 — Điền vào file `.env`

Mở file `.env` trong thư mục dự án (tôi đã tạo sẵn cho bạn) và điền 2 dòng:

```env
VITE_SUPABASE_URL=https://xxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### Bước 6 — Kiểm tra kết nối

```bash
npm run check
```

Kết quả mong đợi:

```
PHẦN A — Khách (anon key) — đúng như trình duyệt của khách
  OK   Đọc thực đơn được (6 món)
  OK   RLS chặn đúng: khách không thêm được món
  OK   RLS chặn đúng: khách không sửa được món (bị chặn âm thầm, 0 dòng)
  OK   RLS cho phép: khách có quyền tạo đơn
  OK   Khách (anon) tạo đơn được
  OK   RLS chặn đúng: khách không xem được danh sách đơn (0 dòng dù đơn có thật)
  OK   RLS chặn đúng: khách không sửa được đơn (bị chặn âm thầm, 0 dòng)
  OK   RLS chặn đúng: khách không xoá được đơn (bị chặn âm thầm, 0 dòng)

PHẦN B — Chủ quán (đăng nhập) — quyền ghi dữ liệu
  OK   Đăng nhập thành công: chuquan@example.com
  OK   Chủ quán xem được danh sách đơn (N đơn)
  OK   Xác nhận đơn của khách đã được lưu đúng vào database
  OK   Chủ quán thêm được món
  OK   RLS chặn đúng: khách không xoá được món
  OK   Chủ quán sửa được món
  OK   Chủ quán xoá được món
  OK   Chủ quán sửa được trạng thái đơn
  OK   Đã dọn N đơn kiểm tra

✓ Tất cả kiểm tra đều đạt.
```

> **Để Phần B chạy được**, thêm vào file `.env` (không commit):
> ```env
> VITE_ADMIN_EMAIL=chuquan@example.com
> VITE_ADMIN_PASSWORD=mat-khau-cua-ban
> ```
> Bỏ trống 2 dòng này thì Phần B hiện `SKIP`, các phần còn lại vẫn kiểm tra bình thường.

> **Về "Đơn kiểm tra" còn sót trong DB:** script tự dọn ở Phần B. Nếu chạy Phần A
> mà bỏ qua Phần B thì có thể còn 1 đơn test. Xoá bằng
> `supabase/cleanup-test-data.sql` trong SQL Editor (chạy được nhiều lần, an toàn).

Nếu báo `FAIL`, đọc mục **Xử lý lỗi** ở cuối README.

### Bước 7 — Chạy app

```bash
npm run dev
```

Mở `http://localhost:5173` → vào `#/quan-tri/dang-nhap` → đăng nhập bằng **email + mật khẩu** đã tạo ở Bước 3.

> ⚠️ Vite chỉ đọc biến `VITE_*` **lúc khởi động**. Sửa `.env` xong phải **tắt và chạy lại** `npm run dev`.

### Bước 8 (tuỳ chọn) — Dùng Supabase CLI

Nếu bạn muốn chạy SQL từ terminal thay vì Dashboard:

```bash
npx supabase login          # mở trình duyệt để xác thực
npx supabase link --project-ref <mã-ref-của-bạn>
npx supabase db push        # đẩy file trong supabase/migrations lên
```

> `mã-ref` lấy ở **Project Settings → API → Project Ref**.

---

## 🚀 Deploy lên GitHub Pages

### 1. Đẩy code lên GitHub

```bash
git init
git add .
git commit -m "Quan an sang - lan dau"
git branch -M main
git remote add origin https://github.com/<tai-khoan-cua-ban>/<ten-repo>.git
git push -u origin main
```

### 2. Bật GitHub Pages

Vào repo → **Settings → Pages** → Source chọn **Deploy from a branch** → branch `main`, folder `/ (root)` → **Save**.

Chờ 1–2 phút, trang web sẽ ở: `https://<tai-khoan>.github.io/<ten-repo>/`

> **Cách nhanh hơn (tuỳ chọn):** nếu đã cài `gh-pages` (đã có sẵn trong devDependencies) thì chạy
> `npm run deploy` để build và đẩy thẳng lên nhánh `gh-pages`. Khi đó trong *Settings → Pages* chọn
> Source = **Deploy from a branch** → branch `gh-pages`, folder `/ (root)`.

### 3. Cấu hình biến môi trường cho bản deploy

Tạo file `.env.production` (cùng thư mục, **được commit**) với nội dung:

```env
VITE_SUPABASE_URL=https://xxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_SHOP_NAME=Quán Ăn Sáng
VITE_SHOP_ADDRESS=123 Nguyễn Văn A, Quận 1
VITE_SHOP_PHONE=0909 000 000
```

Rồi build lại và đẩy lên:

```bash
npm run build
git add .env.production dist
git commit -m "Deploy len GitHub Pages"
git push
```

> Vite chỉ đọc biến `VITE_*` **lúc build**, nên thay đổi thông tin quán phải build lại rồi push mới có hiệu lực.

---

## 🖨️ In hoá đơn

Hoá đơn được thiết kế theo khổ giấy **80mm** (máy in nhiệt), in tự động khi:

1. Vào `#/quan-tri/orders`
2. Bấm **"Xong & in hoá đơn"** → hộp thoại in mở ra ngay
3. Chọn máy in → **In**

Bấm **"🖨️ In lại"** ở đơn đã hoàn thành để in lại.

**Cài máy in nhiệt 80mm trên Windows:**
`Settings → Bluetooth & devices → Printers & scanners → Add device` → chọn máy in nhiệt → trong phần *Paper size* chọn **Roll 80mm**, khổ giấy **Receipt**.

---

## 📁 Cấu trúc thư mục

```
.
├── index.html                 # Entry HTML
├── vite.config.js             # Cấu hình Vite (base: './' cho GitHub Pages)
├── .env                       # Biến môi trường cục bộ (KHÔNG commit)
├── .env.example               # File mẫu biến môi trường
├── supabase/
│   ├── schema.sql             # SQL tạo bảng + RLS + dữ liệu mẫu
│   ├── migration-order-items.sql  # (Nâng cấp) tách bảng trung gian order_items
│   ├── migration-customers-qr.sql # (Nâng cấp) bảng customers + RPC khách quen/QR
│   ├── migration-options.sql  # (Nâng cấp) bảng options + tuỳ chọn món
│   ├── migration-payment.sql  # (Nâng cấp) cột payment_method + is_paid (thanh toán)
│   ├── fix-create-order-price.sql # Bản vá giá của RPC create_order (sinh tự động)
│   ├── fix-summarize-permissions.sql  # Gỡ quyền xem doanh thu cho khách
│   ├── fix-create-order-return.sql   # Đổi create_order trả về jsonb
│   └── cleanup-test-data.sql  # Xoá đơn/món rác do script kiểm tra tạo ra
├── scripts/
│   ├── check-supabase.mjs     # Kiểm tra kết nối + RLS (npm run check)
│   ├── check-qr-schema.mjs    # Kiểm tra phần khách quen/QR (npm run check:qr)
│   ├── test-payment.mjs       # Kiểm tra phần thanh toán (npm run test:payment)
│   ├── test-customers-local.mjs # Test luồng khách quen ở chế độ demo (npm run test:local)
│   └── verify-migration.mjs   # So khớp đơn cũ vs order_items (npm run verify:migration)
├── public/
│   └── bank-qr.png            # (Tuỳ chọn) ảnh QR ngân hàng khách quét — copy vào đây
└── src/
    ├── main.jsx               # Gốc ứng dụng
    ├── App.jsx                # Định tuyến (HashRouter cho GitHub Pages)
    ├── styles.css             # Toàn bộ CSS + @media print cho hoá đơn
    ├── lib/
    │   ├── supabase.js        # Khởi tạo Supabase client
    │   ├── auth.jsx           # Phiên đăng nhập (Supabase Auth / PIN demo)
    │   ├── db.js              # Lớp dữ liệu: Supabase hoặc localStorage fallback
    │   └── format.js          # Định dạng tiền tệ / ngày giờ
    ├── components/
    │   ├── Invoice.jsx        # Giao diện hoá đơn 80mm
    │   ├── BankQr.jsx         # Ảnh QR ngân hàng (public/bank-qr.png) + placeholder
    │   ├── PrintPortal.jsx    # Render hoá đơn vào #print-area rồi gọi window.print()
    │   └── ProtectedRoute.jsx # Chặn trang quản trị khi chưa đăng nhập
    └── pages/
        ├── OrderPage.jsx      # Trang khách đặt món
        ├── AdminLayout.jsx    # Khung trang quản trị + tab điều hướng
        ├── LoginPage.jsx      # Trang đăng nhập của chủ quán
        ├── MenuPage.jsx       # Quản lý món
        ├── OrdersPage.jsx     # Quản lý đơn + in hoá đơn
        ├── SummaryPage.jsx    # Tổng kết số lượng
        └── SuccessPage.jsx    # Màn hình đặt hàng thành công
```

---

## 📱 Khách quen & mã QR

Vào `#/quan-tri/khach` → nhập **tên / SĐT / địa chỉ** → bấm **"Thêm & tạo QR"**.

| | |
|---|---|
| **QR chứa gì** | Chỉ chứa **token ngẫu nhiên** (`#/?qr=<token>`) — **không** chứa SĐT/địa chỉ |
| **Khách quét** | Mở thẳng trang đặt món, tên/SĐT/địa chỉ **đã điền sẵn** |
| **Dùng ở đâu** | In ra **dán lên bàn**, hoặc gửi ảnh cho khách qua Zalo |
| **Tải ảnh** | Nút **⬇️ Ảnh** (tải PNG) hoặc **🖨️ In QR** (in riêng mã QR) |
| **Copy link** | Nút **🔗 Copy link** — gửi link cho khách quét trên máy tính |
| **Khách bị mất QR** | Nút **"Tạo lại QR"** → mã cũ không dùng được nữa |
| **Tắt khách** | Bỏ tick *"Đang hoạt động"* → QR cũ ngay lập tức không dùng được |

> **Vì sao không nhúng thẳng SĐT/địa chỉ vào QR?**
> - URL ngắn → **QR dễ quét**, ít lỗi khi in.
> - Không lộ thông tin cá nhân của khách trong **lịch sử trình duyệt** và log máy chủ.
> - Tắt được từng khách mà không phải in lại QR.

### Section "Thông tin giao hàng" trong giỏ (thu gọn)

| | |
|---|---|
| **Mặc định** | **Thu gọn** — khách thấy 1 dòng tóm tắt, không bị chật |
| **Tiêu đề khi đủ thông tin** | `Thông tin giao hàng ✓ Chị Lan · 12 Lý Thường Kiệt` |
| **Tiêu đề khi thiếu** | `Thông tin giao hàng * Thiếu tên và địa chỉ` |
| **Bấm "Xác nhận đặt món" mà thiếu** | Section **tự mở ra** + hiện lỗi, không phải tự tìm chỗ điền |
| **Khách quét QR** | Section **tự mở sẵn** vì đã có đủ thông tin từ QR |

---

- **Đường dẫn có dấu `#`** (ví dụ `#/quan-tri/mon`) là do dùng `HashRouter` → deploy GitHub Pages không cần cấu hình redirect 404.
- **Cập nhật đơn tự động**: trang Đơn hàng tự làm mới mỗi **15 giây** nên bếp thấy đơn mới gần như tức thì.
- **Chế độ demo** (chưa điền `.env`): dữ liệu lưu trong `localStorage` của trình duyệt — dữ liệu sẽ **không** đồng bộ giữa 2 thiết bị và sẽ mất khi xoá cache. Đăng nhập bằng PIN `1234`.
- **Bảo mật 2 lớp**:
  1. *Frontend* — `ProtectedRoute` chặn route `/quan-tri`, chưa đăng nhập thì chuyển về trang đăng nhập.
  2. *Supabase RLS* — lớp quan trọng hơn, không bypass được bằng cách sửa JS:
     - `anon` (khách): chỉ **đọc** thực đơn + **tạo** đơn
     - `authenticated` (chủ quán): toàn quyền món & đơn
  ⇒ Khách gõ `/#/quan-tri/orders` cũng **không xem được** danh sách đơn của quán.
- **Chủ quán vào trang quản trị bằng cách nào**: tự gõ `/#/quan-tri/dang-nhap` vào trình duyệt và đăng nhập
  (app cố tình **không** có nút chuyển trang để khách không tình ý bấm nhầm vào trang quản trị).
  Nên **lưu URL này làm bookmark** trên điện thoại/máy tính.
- **Ghi chú riêng cho từng phần món**: trong giỏ hàng, mỗi dòng có ô *"Ghi chú cho phần này"* — vd khách đặt **xôi thập cẩm** có thể ghi *"không da gà, thêm ớt"*.
  - Mua **cùng 1 món nhiều lần** mà mỗi lần muốn ghi chú khác nhau → bấm **"＋ Tách riêng"** để tách thành từng dòng.
    - Dòng mới **xuất hiện ngay bên dưới** dòng đang tách (không nhảy xuống cuối).
    - Nút "Tách riêng" chỉ hiện khi dòng đang có **số lượng > 1** (dòng có 1 phần thì không có gì để tách).
    - Ví dụ: 2 phần Phở bò tái → dòng 1 ghi *"không da gà"*, dòng 2 ghi *"thêm ớt, nhiều hành"*.
  - Ô **số lượng** là **input** ở **cả hai nơi**: thẻ món ngoài trang thực đơn và trong giỏ.
    - Gõ trực tiếp số lớn, cập nhật ngay khi gõ (không cần bấm Enter).
    - Gõ **0** hoặc bấm "−" tới 0 → bỏ món/dòng đó khỏi giỏ.
    - Xoá sạch ô rồi gõ lại: dòng **không bị mất** (chỉ xác nhận khi nhập số hợp lệ).
    - Ở thẻ món: nhập số N sẽ **gộp** các dòng của món đó thành 1 dòng qty = N
      (tách riêng xong vẫn nhập được số tổng).
  - **Banner cảnh báo** ở đầu modal giỏ, hiện khi **TỔNG số món trong giỏ ≥ 16**
    (ngưỡng `QTY_WARN_THRESHOLD` trong `OrderPage.jsx`):
    - Tính trên **tổng** số phần của cả giỏ → tách dòng / gộp dòng thì cảnh báo vẫn đúng.
    - Chỉ có 1 banner ở trên, không có cảnh báo riêng cho từng món.
  - Bấm **"−"** để bỏ 1 phần (bỏ hết thì dòng tự biến mất khỏi giỏ).
  - Nút **"−"** trên thẻ món ở trang thực đơn cũng bỏ được món khỏi giỏ.
  - Ghi chú hiện ở: trang đặt món (xác nhận), trang **Đơn hàng** (bếp đọc) và trên **hoá đơn in 80mm**.
  - Lưu ở bảng trung gian `order_items` (mỗi dòng món = 1 row) — xem phần *Cấu trúc dữ liệu* bên dưới.
- **Mã đơn** gồm 3 chữ + 3 số (vd `EMW315`) để bếp gọi khách.

---

## 🔥 Tính năng cho bếp: bảng "Món cần làm"

Vào `#/quan-tri/orders` → phía trên danh sách đơn có bảng **🔥 Món cần làm**.

| | |
|---|---|
| **Gom từ đâu** | Tất cả món của các đơn đang ở trạng thái *Mới* + *Đang làm* |
| **Cột hiển thị** | Tên món · giá · **số lượng cần làm** (cộng dồn) · số đơn có món đó |
| **Ghi chú** | Các ghi chú của món đó được gom lại, hiện ngay dưới tên món (vd `📝 không da gà`) |
| **Tự trừ** | Bấm **"Xong & in hoá đơn"** ở đơn → món của đơn đó **tự biến mất** khỏi bảng |
| **Huỷ đơn** | Đơn bị huỷ cũng tự trừ khỏi bảng |

> Bảng này **tự tính lại** mỗi lần trang làm mới (15 giây) → không cần bấm cập nhật.

**Ví dụ:** có 3 đơn — đơn 1 có 5 xôi + 3 nước, đơn 2 có 2 xôi, đơn 3 có 1 nước
→ bảng hiện: **Xôi: 7** (2 đơn) và **Nước: 4** (2 đơn).

---

## 💳 Tính năng thanh toán

### Khách chọn cách thanh toán

Trong modal giỏ hàng có ô **"Cách thanh toán"**:

| | |
|---|---|
| **💵 Tiền mặt** (mặc định) | Khách trả tiền mặt khi nhận món |
| **🏦 Chuyển khoản** | Hiện **mã QR ngân hàng** để khách quét + số tiền cần chuyển |

Sau khi khách bấm "Xác nhận đặt món", màn hình **"Đặt món thành công"** cũng hiện lại
QR ngân hàng + số tiền để khách quét lỡ mất màn hình.

### Chủ quán đánh dấu đã thu tiền

Ở trang `#/quan-tri/orders`, đơn chuyển khoản có:

- Badge **🏦 Chuyển khoản** (vàng) → đổi thành **💰 Đã chuyển khoản** (xanh) khi đã thu tiền
- Nút **💰 Đã thanh toán** → bấm 1 lần để đánh dấu đã nhận tiền
  (bấm lần 2 → **↩️ Bỏ đánh dấu đã trả** nếu nhầm)

> Trạng thái này **do chủ quán tick tay** — app không tự động đối soát với ngân hàng.
> (Sau này nếu muốn tự động thì thêm webhook từ ngân hàng.)

### Đặt ảnh QR ngân hàng

Copy ảnh QR vào `public/bank-qr.png` là dùng được ngay (xem mục *Bước 2f* ở trên).

---

## 🗃️ Cấu trúc dữ liệu (quan hệ nhiều-nhiều)

**1 món có thể nằm trong nhiều đơn, 1 đơn có thể chứa nhiều món** → quan hệ nhiều-nhiều.
Được mô hình hoá bằng **bảng trung gian `order_items`**:

```
menu_items                 orders                    order_items
┌──────────────┐          ┌──────────────┐          ┌────────────────────┐
│ id (PK)      │◄─────────┤ id (PK)      │◄─────────┤ order_id (FK)      │
│ name         │          │ code         │          │ menu_item_id (FK)  │
│ price        │          │ customer_name│          │ name_snapshot      │
│ is_available │          │ total        │          │ price_snapshot     │
│ ...          │          │ status       │          │ qty                │
└──────────────┘          │ created_at   │          │ note               │
                          └──────────────┘          └────────────────────┘
```

| Bảng | Vai trò |
|---|---|
| `menu_items` | Thực đơn — món ăn và giá hiện tại |
| `orders` | Đơn hàng — thông tin khách, tổng tiền, trạng thái |
| `order_items` | **Bảng trung gian** — từng dòng món của từng đơn |

**Vì sao `order_items` cần `name_snapshot` / `price_snapshot`?**
Đây là **bản chụp** tên và giá **tại thời điểm khách đặt món**. Nếu chỉ join lấy từ
`menu_items`, thì khi bạn sửa giá món tuần sau, toàn bộ lịch sử doanh thu và các hoá đơn
đã in sẽ bị đổi theo — sai. Vì vậy giá trong đơn **không bao giờ** lấy từ thực đơn lúc báo cáo.

**Ràng buộc:**
- Xoá đơn → `order_items` bị xoá theo (`ON DELETE CASCADE`)
- Xoá món khỏi thực đơn → `menu_item_id` thành `NULL`, nhưng đơn cũ **vẫn giữ** đúng tên/giá đã chốt (`ON DELETE SET NULL`)

**Hai chế độ lưu trữ:**

| | Chế độ cũ (mặc định) | Chế độ mới (sau migration) |
|---|---|---|
| Nơi lưu món | cột JSONB `orders.items` | bảng `order_items` |
| Tạo đơn | 1 `INSERT` | RPC `create_order` (1 transaction) |
| Tổng kết | gom trong JavaScript | RPC `summarize_orders` (`GROUP BY` trong SQL) |
| Rollback | — | xoá bảng `order_items`, app tự fallback về JSONB |

App tự phát hiện: nếu bảng `order_items` / RPC chưa có trong DB, nó **tự động dùng đường cũ**
→ chạy được ngay cả khi chưa chạy migration.

---

## 🔐 Vì sao mã QR chỉ chứa *token*, không chứa thẳng SĐT/địa chỉ?

Khi quét QR, URL mở ra là:

```
https://<domain-quan-cua-ban>/#/?qr=8f3a2b1c9d4e5f60a7b8c9d0e1f2a3b4
```

URL này **không** chứa tên/SĐT/địa chỉ. Nó chỉ chứa một **token ngẫu nhiên**
(lưu trong bảng `customers`). App gọi RPC `customer_by_token(token)` để lấy
thông tin thật từ database.

**Ba lý do:**

1. **QR gọn, dễ quét.** Nhúng thẳng tên + SĐT + địa chỉ vào URL thì URL dài
   60–80 ký tự → QR rất dày, in ra dễ bị lỗi, quét khó, và trên màn hình
   điện thoại phải cuộn mới thấy hết.
2. **Không lộ thông tin khách.** URL nằm trong lịch sử trình duyệt, trong log
   máy chủ, trong ảnh chụp màn hình khách gửi cho người khác. Nếu URL chứa
   SĐT + địa chỉ thì đó là rò rỉ dữ liệu cá nhân.
3. **Dễ thu hồi.** Khách báo mất QR → bấm "Tạo lại QR" là token cũ chết ngay,
   QR mới phát hành lại. Không cần đụng tới dữ liệu đơn cũ.

> Token là **vé mời**: ai có token thì lấy được thông tin của khách đó.
> Vì vậy đừng chia sẻ QR cho người không phải khách đó, và hãy tắt khách
> (bỏ tick "Đang hoạt động") nếu khách ngừng dùng.

**Về bảo mật:** bảng `customers` **không** có policy nào cho `anon` → khách
**không** đọc được danh sách khách quen của quán. Khách chỉ lấy được thông
tin của *chính mình* qua RPC, và chỉ khi có đúng token.

---

## 📞 Trợ giúp

### Hai cái bẫy của Supabase RLS (đã xử lý sẵn trong code)

**1. INSERT kèm `.select()` làm đơn KHÔNG được lưu**

Policy cho khách chỉ cho phép `INSERT` vào bảng `orders`, **không** cho phép `SELECT`.
Khi ghi `.insert(payload).select().single()`, PostgREST gửi `Prefer: return=representation`
→ Postgres phải **đọc lại** dòng vừa insert → bị RLS chặn → báo lỗi
*"new row violates row-level security policy"* **và đơn không hề vào bếp**.

Cách sửa (đã áp dụng trong `src/lib/db.js`): tự sinh `id` (UUID v4) trước, `INSERT`
không kèm `.select()`, rồi tự dựng lại object trả về.

**2. RLS chặn "âm thầm" — không lỗi nhưng cũng không hiệu lực**

Policy sai **không** luôn sinh lỗi. Ví dụ `UPDATE` bảng mà policy không cho phép
→ `error = null` nhưng **0 dòng** bị ảnh hưởng. Nếu chỉ kiểm tra `error` thì sẽ
tưởng là đã thành công. Vì vậy `npm run check` luôn kiểm tra **cả** `error`
**và** số dòng trả về.

**3. `revoke ... from public` KHÔNG đủ — phải revoke cho `anon` riêng**

`anon` là một thành viên của role `public`. Nên câu lệnh:
```sql
revoke all on function public.summarize_orders(timestamptz, timestamptz) from public;
```
**vẫn để lại** khả năng khách gọi được hàm. Phải revoke thêm:
```sql
revoke all on function public.summarize_orders(timestamptz, timestamptz) from anon;
```
Và nhớ xử lý **cả overload 0 tham số** (do các tham số có `default` tạo ra):
```sql
revoke all on function public.summarize_orders() from anon;
```

Nếu quên, khách gõ `/#/quan-tri/tong-ket` là đọc được **doanh thu** của quán —
`npm run check` sẽ bắt được lỗi này (mục *"khách đọc được tổng kết"*).

**4. Không tin giá do client gửi lên**

RPC `create_order` **tính lại tổng tiền** từ bảng `menu_items` thay vì lấy `price`
mà trình duyệt gửi lên. Nếu tin giá của client, khách chỉ cần sửa 1 request là
đặt được món giá 0đ.

### Sự cố thường gặp

| Lỗi | Cách sửa |
|---|---|
| `npm` không được nhận diện | Cài lại Node.js, mở lại terminal |
| `npm run check` báo *Chưa có VITE_SUPABASE_URL* | Chưa điền `.env` — xem Bước 5 mục Setup Supabase |
| `Invalid API key` | Copy lại **anon public** key trong Supabase → Project Settings → API |
| `Failed to fetch` | Kiểm tra mạng, hoặc URL sai (phải có `https://` và `.supabase.co`) |
| `relation "menu_items" does not exist` | Chạy `supabase/schema.sql` trong SQL Editor (Bước 2) |
| `new row violates row-level security policy` khi **tạo đơn** | Chạy lại `supabase/schema.sql` — policy INSERT cho `anon` đang thiếu |
| `Invalid login credentials` | Sai email/mật khẩu, hoặc tài khoản chưa **Auto Confirm** (Bước 3) |
| Không đăng nhập được dù đã tạo user | Bật **Auto Confirm User** khi tạo, hoặc tắt *Confirm email* trong Sign In / Providers |
| Sửa `.env` mà app không đổi | Vite chỉ đọc `VITE_*` lúc khởi động → tắt và chạy lại `npm run dev` |
| Trang trắng, không có dữ liệu | Kiểm tra `.env` đã điền đúng chưa, rồi restart `npm run dev` |
| Điện thoại không mở được Network URL | Kiểm tra cùng Wi‑Fi, tắt tạm tường lửa/VPN |
| Không in được | Chọn đúng máy in nhiệt 80mm, kiểm tra khổ giấy = Receipt |
| Còn đơn test trong DB | Chạy `supabase/cleanup-test-data.sql` trong SQL Editor |
| `npm run check` báo *"khách đọc được tổng kết + doanh thu"* | Chạy `supabase/fix-summarize-permissions.sql` — gỡ quyền EXECUTE của `summarize_orders` cho `anon` |
| `Could not find the table 'public.order_items'` | PostgREST chưa refresh schema cache → đợi vài giây rồi chạy lại, hoặc reload trang. Nếu vẫn lỗi thì chạy `supabase/migration-order-items.sql` |
