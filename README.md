# 🍜 Quán Ăn Sáng

Ứng dụng quản lý bán đồ ăn sáng: khách đặt món trên điện thoại, chủ quán quản lý thực đơn, in hoá đơn và tổng kết số lượng từng món.

Xây dựng bằng **React + Vite + HTML/CSS thuần**, dữ liệu lưu trên **Supabase (free plan)**, deploy lên **GitHub Pages**.

---

## 📋 Các chức năng

| Trang | Đường dẫn | Dùng để |
|---|---|---|
| **Đặt hàng** | `#/` | Khách chọn món, ghi tên/SĐT/bàn, **ghi chú riêng cho từng món**, gửi đơn — *không cần đăng nhập* |
| **Đăng nhập** | `#/quan-tri/dang-nhap` | Chủ quán đăng nhập bằng email + mật khẩu |
| **Quản lý món** | `#/quan-tri/mon` | Thêm / sửa / xoá món, đặt giá, ẩn món hết hàng |
| **Đơn hàng** | `#/quan-tri/orders` | Xem đơn mới, chuyển trạng thái, **in hoá đơn**, huỷ/xoá |
| **Tổng kết** | `#/quan-tri/tong-ket` | Tổng số suất từng món theo ngày/tuần/tháng, doanh thu |
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
| `npm run check` | Kiểm tra kết nối Supabase + hành vi RLS |
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
│   └── cleanup-test-data.sql  # Xoá đơn/món rác do script kiểm tra tạo ra
├── scripts/
│   └── check-supabase.mjs     # Kiểm tra kết nối + RLS (npm run check)
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

## 💡 Ghi chú

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
  - Lưu trong trường JSONB `items` của bảng `orders` → **không cần đổi cấu trúc database**.
- **Mã đơn** gồm 3 chữ + 3 số (vd `EMW315`) để bếp gọi khách.

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
