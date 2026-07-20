# Hợp đồng tích hợp — CHIA CHI PHÍ NHÂN VIÊN cho App Report

Data Hub-new cung cấp cho App Report một endpoint **chỉ-đọc, máy-nối-máy (S2S)** để mỗi
nhân viên xem **chi phí của chính mình**, giới hạn đúng các cột chi tiết mà **CEO cho phép**.

> An toàn cốt lõi: **C32 (tổng chi phí)** và **C47 (đầu ra)** bị **khóa cứng vĩnh viễn** — không
> bao giờ xuất hiện trong dữ liệu trả về, kể cả khi cấu hình sai. Chỉ các cột trong **C33–C46**
> mà CEO bật (allowlist) mới được gửi. Mặc định: **C36, C41, C43, C45**.

## 1. Endpoint
```
GET /api/integrations/app-report/employee-cost?emp=<MÃ_NHÂN_VIÊN>
```
- `emp` (bắt buộc): mã nhân viên (khớp cột C6 trong danh mục cha). Có thể thay bằng header `x-app-report-emp`.

## 2. Xác thực (giống các endpoint App Report hiện có)
- Header **`x-assignment-key: <service token>`** (token do bot cấu hình phía Data Hub qua biến môi trường `DATA_HUB_ASSIGNMENT_KEYS`).
- Không có/sai key → **401**.
- Response luôn kèm `Cache-Control: private, no-store`.

## 3. Dữ liệu trả về
```jsonc
{
  "contract": "app-report.employee-cost.v1",
  "empCode": "DN001",
  "columns": [                         // đúng các cột CEO đang cho phép (thứ tự theo Cn)
    { "key": "c36", "pos": 36, "label": "CP ctv/ khác (5) (%)" },
    { "key": "c41", "pos": 41, "label": "CP Đặt hàng ( 10) (%)" },
    { "key": "c43", "pos": 43, "label": "CP bs/td (12) (%)" },
    { "key": "c45", "pos": 45, "label": "Lương tăng thêm (13) (%)" }
  ],
  "count": 2,
  "rows": [
    { "c5": "QL1", "c7": "U1", "c16": "Tên thuốc A", "c25": "Viên", "c36": 8, "c41": 3, "c43": 2, "c45": 4 },
    { "c5": "QL2", "c7": "U2", "c16": "Tên thuốc B", "c25": "Gói", "c36": 9, "c41": 1, "c43": 1, "c45": 2 }
  ]
}
```
- Mỗi dòng gồm **định danh công khai** (C5 mã QLNB, C7 mã đơn vị, C16 tên thuốc, C25 ĐVT) + **đúng các cột allowlist**.
- **Không bao giờ** có `c32`, `c47`, hay bất kỳ cột C33–C46 nào ngoài allowlist.
- `columns` phản ánh allowlist hiện tại → App Report nên **render động** theo mảng này (đừng hardcode tên cột), vì CEO có thể thêm/bớt sau.

## 4. Ràng buộc & lỗi
- Chỉ trả các dòng có **C6 = emp** (nhân viên chỉ thấy phần của mình).
- Thiếu `emp` → **400**.
- Nếu hệ thống phát hiện cột cấm lọt vào payload → chặn cả gói, trả **502** (`CATALOG_PERMANENT_FIELD_BLOCKED`). App Report coi đây là lỗi tạm thời, thử lại sau.
- Giá trị các cột là **tỷ lệ (%) theo từng dòng danh mục** — không phải số tiền; **không được cộng dồn** giữa các dòng (nếu cần tổng hợp phải có cơ sở doanh thu theo kỳ, là báo cáo khác).

## 5. Ai điều khiển allowlist
- **CEO** bật/tắt cột trong **CEO Vault → "Chia chi phí cho App Report"** (chỉ C33–C46; C32/C47 khóa cứng). Mỗi thay đổi ghi nhật ký.
- Data Hub quyết định cột nào ra — App Report **không** yêu cầu được cột ngoài allowlist.

## 6. Phía App Report cần làm
1. Gọi endpoint trên bằng `x-assignment-key` cho từng nhân viên (hoặc theo lô nếu sau này bổ sung).
2. Render bảng chi phí theo mảng `columns` trả về (động).
3. Không lưu/không hiển thị bất cứ trường nào ngoài `rows` trả về.
4. Xử lý 401 (sai key) / 502 (thử lại) / 400 (thiếu emp).

---
*Phía Data Hub: đã hoàn tất + kiểm thử bảo mật (C32/C47 không bao giờ lọt; chỉ trả cột allowlist của đúng nhân viên).*
