# DIRECTIVE — SỬA "Tất cả NV" trống + THÊM lọc Vùng/Tỉnh · Nhóm mã đơn vị · Tuyến (CEO 2026-07-22)

> Claude Code giao Report Bot. 1 lỗi cần sửa gấp + 3 ô lọc mới cho bảng "Chi phí của tôi".

## 1. ‼ SỬA GẤP — "Tất cả nhân viên" đang hiện 0/0 (trống)
**Triệu chứng (ảnh CEO):** chọn "Tất cả nhân viên" → KPI 0đ, bảng "chưa có dữ liệu", và **hiện "Mẫu FULL-TIME · 0/0"**.
**Chẩn đoán:** chế độ tất cả NV lẽ ra dùng template **"TẤT CẢ NHÂN VIÊN"** (`mergeEmployeeReports`, label `TẤT CẢ NHÂN VIÊN`).
Hiện ra "FULL-TIME 0/0" ⇒ **backend KHÔNG chạy nhánh `emp=ALL`** — FE #139 đã lên nhưng **BE chưa nạp route/chưa restart**
(lệch phiên bản, giống vụ 404 trước), nên `emp=ALL` bị rơi vào path 1-NV, resolve 'ALL' như 1 mã → rỗng.
- **Việc bot:**
  1. **Xác minh version đang chạy** có branch `wantsAll → employeeCostAllPayload` không (`curl` `/employee-cost?emp=ALL&from=2026-07&to=2026-07` với session CEO → phải trả `empCode:"ALL"`, `template.label:"TẤT CẢ NHÂN VIÊN"`, rows>0). Nếu 404/không có → **deploy #139 BE + RESTART đồng bộ FE**.
  2. Nếu đã cùng version mà vẫn rỗng → debug `employeeCostAllPayload`/`mergeEmployeeReports`: mỗi NV `employeeCostPayload`
     phải trả `.periods[].rows` (đã có ở chế độ 1-NV); merge phải gộp ra rows>0. Thêm test "all-NV rows>0".
- **Nghiệm thu:** CEO chọn "Tất cả nhân viên" → **liệt kê ĐỦ dòng của mọi NV** (21 NV), cột NV + tổng phụ theo NV,
  phân trang chạy, template hiện **"TẤT CẢ NHÂN VIÊN"** (không phải FULL-TIME 0/0). **NV thường vẫn 403 với emp=ALL.**

## 2. THÊM 3 Ô LỌC (cạnh ô lọc Nhân viên, cùng hàng)
Áp cho **cả 1-NV lẫn tất cả NV**; **kết hợp** với nhau + ô tìm kiếm + kỳ. Lọc xong: **STT đánh lại**, **đếm X/Y**, **export
phản ánh** đúng bộ lọc. Mỗi ô là dropdown "Tất cả …" + danh sách giá trị **có thật trong dữ liệu đang xem** (động).

1. **Vùng/Tỉnh** — lọc theo tỉnh/vùng của đơn vị.
   - Nguồn: field tỉnh/vùng của đơn vị (App Sale/danh mục đơn vị). **Nếu chưa có field** → bot báo lại để bổ sung nguồn
     (App Sale/DataHub), **KHÔNG tự suy đoán tỉnh từ tên** (tránh sai). Tạm thời ẩn ô này nếu không có nguồn.
2. **Nhóm mã đơn vị** — lọc theo **nhóm/loại đơn vị** (vd BV · TTYT · PKĐK · NT…), phân theo tiền tố/loại mã đơn vị.
   - **Cấu hình được** (bảng map loại đơn vị), CEO đổi không sửa code. Nếu chưa có map → nhóm theo tiền tố mã sẵn có.
3. **Tuyến** — lọc theo **tuyến** (đã là 1 cột sẵn trong bảng). Dropdown các tuyến có thật.

## 3. GIỮ NGUYÊN / RANH GIỚI
- **Self-scope:** NV chỉ dữ liệu của mình; "Tất cả NV" + các bộ lọc trên tập toàn roster = **CEO/ADMIN only** (backend khóa).
- Số từ backend, **không đổi công thức/tiền**; C32/C47 không lộ; audit. Lọc chạy backend cho "tất cả NV" (dữ liệu lớn,
  phân trang) — không lọc thiếu ở client.

## 4. NGHIỆM THU
1. "Tất cả nhân viên" **liệt kê đủ** mọi NV (mục 1) — hết 0/0.
2. 3 ô lọc Vùng/Tỉnh · Nhóm mã đơn vị · Tuyến hoạt động, **kết hợp** nhau + tìm kiếm + kỳ; STT đánh lại; đếm X/Y; export
   phản ánh. Giá trị dropdown động theo dữ liệu.
3. NV thường: không có "Tất cả NV"/không vượt scope; C32/C47 + self-scope giữ. Test + build PASS. Push nhánh review (nối
   tiếp #139 hoặc nhánh mới off main); báo Claude; chưa deploy (trừ việc restart/deploy BE #139 ở mục 1 để hết trống).
