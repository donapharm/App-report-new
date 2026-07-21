# DIRECTIVE — "Chi phí của tôi": CÔNG TẮC bật/tắt hiển thị theo Phòng / Nhóm / Cá nhân (CEO-only)

> Claude Code giao bot. CEO chốt 2026-07-21. Cho CEO **bật/tắt quyền NV tự xem chi phí của mình** ở 3 mức: toàn
> phòng KD / theo nhóm (vd CTV quản lý khác) / theo cá nhân. **Quyền quyết ở backend.** Giữ mọi nguyên tắc module.

## 1. Mô hình cấu hình (backend, persist, CEO-only)
- File config (persist) `employee_cost_visibility.json`:
  - `department`: `"on" | "off"` — toàn phòng KD (mặc định).
  - `groups`: `{ "<groupKey>": "on" | "off" }` — bật/tắt theo nhóm.
  - `employees`: `{ "<EMP_CODE>": "on" | "off" }` — override cá nhân.
- **Nhóm** mặc định theo **vai trò/trạng thái** NV trong master data (vd `CTV` = trạng thái "Cộng tác";
  `NV` = chính thức). CEO đặt/đổi nhóm được (không hardcode danh sách trong bundle).
- **‼ Thứ tự ưu tiên khi quyết 1 NV:** **cá nhân > nhóm > phòng** (cụ thể nhất thắng).
- **Mặc định an toàn:** `department = "off"` cho tới khi CEO bật (tránh lộ chi phí ngoài ý muốn). CEO đổi mặc định được.

## 2. ‼ CHỐT QUYỀN Ở BACKEND (bắt buộc)
- `/api/employee-cost` (self-view của NV, role sale): tính visibility cho NV đang đăng nhập.
  - **OFF** → trả `{ disabled: true, note: "Chức năng chi phí đang tắt cho bạn.", columns: [], rows: [] }`,
    **KHÔNG gọi DataHub, KHÔNG lộ số.** FE ẩn tab.
  - **ON** → chạy như hiện tại (self-scoped).
- **CEO/ADMIN** xem NV bất kỳ **vẫn được** (mục đích quản lý) — công tắc chỉ khống chế **self-view của NV**, không
  chặn admin.
- FE ẩn/hiện tab "Chi phí của tôi" theo cờ `disabled` — nhưng **FE không tự quyết quyền**, chỉ theo backend.

## 3. Trang quản trị công tắc (CEO/ADMIN-only)
- Panel quản trị: bật/tắt **toàn phòng**; danh sách **nhóm** (bật/tắt); danh sách **NV** (on / off / theo nhóm).
- Route: `GET /api/employee-cost/visibility` (xem trạng thái) + `POST /api/employee-cost/visibility` (lưu) — cả hai
  `auth.requireAuth, auth.requireAdmin`. **Audit** mọi thay đổi (ai · khi · đổi gì · giá trị cũ→mới).
- Danh sách NV/nhóm lấy từ **master data**, không hardcode.

## 4. GIỮ NGUYÊN TẮC
- Quyền quyết ở backend; NV chỉ thấy của mình; C32/C47 + token vẫn khóa; grounded; không PII/số cứng trong bundle.

## 5. NGHIỆM THU
1. CEO **tắt toàn phòng** → mọi NV self-view bị ẩn (backend trả `disabled`); **bật lại** → hiện.
2. **Tắt nhóm CTV** → chỉ CTV bị ẩn; nhóm khác vẫn thấy.
3. **Override 1 NV** on/off → đúng ưu tiên **cá nhân > nhóm > phòng**.
4. Gọi API trực tiếp khi OFF → `disabled`, **không có số** (không chỉ ẩn ở FE). CEO/ADMIN vẫn xem được NV.
5. Audit đủ; test mới + test cũ PASS. Ghi CHANGELOG; commit + push main; báo Claude review.
