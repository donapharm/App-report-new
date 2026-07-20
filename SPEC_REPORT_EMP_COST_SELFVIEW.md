# SPEC — Module "Chi phí của tôi" (App Report) — NV tự theo dõi chi phí/hoa hồng CỦA CHÍNH MÌNH

> Claude Code (kiến trúc) giao bot triển khai. CEO chốt 2026-07-20. App Report **hiển thị**, **DataHub tính (SSOT)**.
> Lý do: DataHub Smart App là **CEO-only**, NV không vào được → mở một cửa sổ trong App Report để **mỗi NV xem
> phần chi phí/hoa hồng của riêng mình**. NV chỉ thấy **số của chính mình** (backend khóa scope) — không phải
> minh bạch toàn bộ chi phí.

## 0. ‼ THAY ĐỔI CHÍNH SÁCH (ghi để không nhầm về sau)
- `SPEC_DATAHUB_SMART_APP.md §8-BIS` (CEO 2026-07-09) từng ghi: hoa hồng "CEO-only tuyệt đối, KHÔNG bao giờ tới
  bề mặt NV". **CEO 2026-07-20 điều chỉnh:** cho NV thấy **chi phí/hoa hồng CỦA CHÍNH MÌNH** trong App Report
  (self-scoped, read-only). Vẫn cấm: thấy số người khác, tổng payout, hay rule/công thức của người khác.
- Cập nhật kèm: `CLAUDE.md` (ghi ngoại lệ này) — đã làm trong đợt commit này.

## 1. HỢP ĐỒNG TÍCH HỢP (CEO cung cấp — nguồn số)
DataHub expose service endpoint:
```
GET /api/integrations/app-report/employee-cost?emp=<MÃ_NHÂN_VIÊN>
Header: x-assignment-key: <service token>        # token DỊCH VỤ, chỉ ở backend App Report
```
Response (JSON) — **cột động**:
```json
{ "empCode": "DN001",
  "columns": [ { "key": "c36", "label": "CP ctv/khác (%)" }, ... ],   // render ĐỘNG theo mảng này
  "rows":    [ { "c5":"QL1", "c7":"U1", "c16":"Tên thuốc", "c25":"Viên",
                 "c36":8, "c41":3, "c43":2, "c45":4 }, ... ] }
```
- `columns[]` = danh sách cột (key + nhãn tiếng Việt) để **dựng header động**. **KHÔNG hardcode key** (`c36`…).
- `rows[]` = từng dòng; chiều cố định `c5`(quản lý/QL) · `c7`(đơn vị) · `c16`(tên thuốc/SP) · `c25`(ĐVT) + các
  cột % chi phí động (`c36/c41/c43/c45…`). Giá trị số = **% chi phí** (đơn vị %).
- **Bot xác nhận với DataHub 1 điểm:** `columns[]` đã bao gồm cả cột chiều (`c5/c7/c16/c25`) chưa, hay chỉ liệt kê
  cột %? → Nếu chỉ có cột %, App Report thêm nhóm cột chiều cố định phía trước theo map nhãn (`c5→Quản lý`,
  `c7→Đơn vị`, `c16→Sản phẩm`, `c25→ĐVT`). Tránh render trùng cột.
- **Tài liệu gốc:** hợp đồng đầy đủ ở `docs/APP_REPORT_EMPLOYEE_COST_CONTRACT.md` **trong repo DataHub** (không có
  trong repo App Report). Bot nên **đồng bộ 1 bản tham chiếu** vào repo App Report (vd `docs/`) để đối chiếu khi code.

### 1-BIS. RÀNG BUỘC BẢO MẬT (DataHub đã KHÓA sẵn — App Report chỉ cần tôn trọng)
- **`C32` (tổng) và `C47` (đầu ra) KHÔNG BAO GIỜ được gửi** — khóa cứng ở DataHub. App Report **không được kỳ vọng/
  suy ra** 2 cột này, không tự dựng lại "tổng"/"đầu ra".
- Chỉ các cột trong **`C33–C46`** được **CEO bật (allowlist)** mới có trong `columns`. **CEO đổi allowlist bất cứ
  lúc nào** → App Report **render động theo `columns`**, **tuyệt đối không hardcode** key/số cột.
- **Giá trị là tỷ lệ % theo TỪNG DÒNG — KHÔNG cộng dồn.** ⇒ UI **không** có dòng "Tổng cộng", **không** cột tổng,
  **không** cộng/trung bình các %. Chỉ hiển thị đúng giá trị từng dòng.

## 2. BACKEND App Report (server/src) — QUYỀN & PROXY
Thêm route đọc: `GET /api/employee-cost` (cho FE App Report gọi bằng **session token của user**, KHÔNG phải service token).
1. **Scope quyền (bắt buộc):** `const s = auth.scopeOf(session)`.
   - NV sale → **ép `emp = mã của chính NV`**; **bỏ qua** mọi `?emp=` khác (không cho xem người khác).
   - CEO/ADMIN → được truyền `?emp=<mã>` để xem NV bất kỳ (và/hoặc chọn từ danh sách).
2. **Gọi DataHub server-to-server:** backend App Report fetch
   `GET {DATAHUB_BASE}/api/integrations/app-report/employee-cost?emp=<emp đã scope>` với header
   `x-assignment-key: {process.env.APP_REPORT_COST_TOKEN}`. **Token chỉ ở backend/.env — TUYỆT ĐỐI không ra FE.**
3. **Trả về FE** nguyên `{ empCode, columns, rows }` **chỉ của emp được phép**. Không kèm token, không kèm dữ liệu
   NV khác.
4. **Xử lý lỗi theo hợp đồng:**
   - **401** (sai/thiếu `x-assignment-key`) → không lộ token, log cảnh báo cho admin, FE hiện "chưa cấu hình được
     nguồn chi phí".
   - **400** (thiếu `emp`) → không bao giờ xảy ra nếu backend luôn ép emp; nếu gặp, trả rỗng + log.
   - **502/timeout** (DataHub tạm lỗi) → **thử lại có backoff** (vài lần, vd 2s/4s) rồi mới trả rỗng.
   - Mọi lỗi khác/empty → trả `{ empCode, columns:[], rows:[], note:"chưa có dữ liệu chi phí kỳ này" }`.
   - **Không bịa số** (nguyên tắc #3); không đẩy chi tiết lỗi/token ra FE.
5. **Không** đưa số chi phí vào LLM facts / NLQ public của App Report. **Audit** mỗi lượt gọi (ai, emp nào, khi nào).
6. **`// TODO(LIVE)`** trong `store.js`/config: `DATAHUB_BASE`, `APP_REPORT_COST_TOKEN` đọc từ `.env`.

## 3. FRONTEND (web/src) — trang "Chi phí của tôi"
- Route/tab mới **"Chi phí của tôi"** trong nav (NV thấy của mình; CEO/ADMIN có thêm ô **chọn NV**).
- **Bảng render ĐỘNG từ `columns[]`:** lặp `columns` dựng `<th>` theo `label`; mỗi `row` render `row[col.key]`.
  **Không** viết cứng tên cột.
- **Hiển thị cột %:** ô % hiện **đúng con số, BỎ hậu tố `%`** (CEO chốt 2026-07-20): `8,0%` → **`8.0`**,
  `0,3%` → **`0.3`**, `10,0%` → **`10.0`** (header đã cho biết là %).
- Cột chiều cố định (`c5/c7/c16/c25`) đứng trước (theo map §1), cột % theo sau.
- **CỘT "THÀNH TIỀN" — App Report TỰ TÍNH (CEO chốt 2026-07-20; DataHub KHÔNG mở thêm cột).** Chi tiết đầy đủ ở
  **`DIRECTIVE_EMP_COST_THANHTIEN.md`**. Tóm tắt:
  - `Thành tiền(dòng, cột%) = doanh thu dòng × % ÷ 100`. "Doanh thu dòng" = doanh thu đúng dòng (đơn vị×SP×NV×kỳ),
    App Report **tự lấy từ dữ liệu doanh thu sẵn có**, ghép theo đơn vị (`c7`) + sản phẩm (`c16`, tên→mã qua catalog).
    Không khớp được → để `—`, **không đoán**. (Phép tính xác định trên doanh thu thật × % thật — không bịa số.)
  - Mỗi cột % có 1 cột Thành tiền (tiền VN). **Tổng chi phí tháng** = Σ Thành tiền, **TRỪ cột "cuối năm" (§4b)**.
- **§4b — Cột "cuối năm" (mặc định `c44`):** thanh toán CUỐI NĂM (T12), **KHÔNG tính vào chi phí tháng**. Vẫn hiện
  Thành tiền theo dòng nhưng **làm mờ** + badge "cuối năm"; tách **1 dòng "Khoản cuối năm (tạm tính, T12)"** riêng;
  chú thích chân bảng. Tập cột cuối năm **cấu hình được** (không hardcode 1 chỗ). Chi tiết ở directive.
- **% KHÔNG cộng dồn; Thành tiền (tiền) ĐƯỢC tổng** (trừ cột cuối năm).
- **Cột chiều nằm trong `row` (không trong `columns`):** DataHub xác nhận `columns[]` chỉ liệt kê cột % động; App
  Report **tự đưa 4 cột chiều `c5/c7/c16/c25` lên trước** (map nhãn Quản lý/Đơn vị/Sản phẩm/ĐVT), tránh render trùng.
- **Chuẩn desktop** = mẫu trang "Phân tích": hàng KPI trên (vd tổng chi phí kỳ, số dòng, kỳ) → panel bảng bên dưới
  trong `.page-desktop`. **Mobile 1 cột**, bảng rộng cuộn ngang trong khung `overflow-x:auto` (không tràn body).
- **Không hardcode PII/số chi phí** trong bundle — mọi số từ `/api/employee-cost` (nguyên tắc #2).
- Trạng thái rỗng: hiện `note` "chưa có dữ liệu chi phí kỳ này".

## 4. NGUYÊN TẮC (Claude soi khi review)
1. **Quyền quyết ở backend** — NV chỉ thấy của mình; FE không tự lọc quyền (nguyên tắc #1).
2. Số **do DataHub tính**; App Report chỉ hiển thị, không dựng engine thứ 2, không bịa (#3).
3. Service token chỉ ở backend; không lộ FE; không log token.
4. Không đưa chi phí vào LLM/NLQ public; audit truy cập.

## 5. NGHIỆM THU (trước khi push main)
1. NV sale đăng nhập → `/api/employee-cost` chỉ trả **emp của chính họ**; thử `?emp=` mã khác → **vẫn ra của chính
   họ** (backend ép scope). CEO/ADMIN → xem được NV bất kỳ.
2. Bảng FE **render đúng theo `columns[]`** (đổi số cột động vẫn đúng, không vỡ), cột chiều + cột % đúng nhãn.
3. Tắt/đổi sai `APP_REPORT_COST_TOKEN` → nguồn lỗi → FE hiện "chưa có dữ liệu", **không lộ lỗi/token**, không bịa số.
4. `grep` bundle FE: **không** có token, không có số chi phí tĩnh.
5. Desktop bám mẫu Phân tích; mobile cuộn ngang OK.
6. Ghi `CHANGELOG.md`; commit + push `main`; báo Claude review.

## 6. RANH GIỚI
- Không dựng engine tính chi phí trong App Report (DataHub là SSOT). Không đụng báo cáo per-NV / deck báo cáo.
- Không phát số chi phí NV khác, tổng payout, hay rule người khác ra bất kỳ bề mặt nào.
