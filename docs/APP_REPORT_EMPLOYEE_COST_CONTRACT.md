# Hợp đồng tích hợp — CHIA CHI PHÍ NHÂN VIÊN cho App Report

Data Hub-new cung cấp cho App Report một endpoint **chỉ-đọc, máy-nối-máy (S2S)** để mỗi
nhân viên xem **chi phí của chính mình**, giới hạn đúng các cột chi tiết mà **CEO cho phép**.

> An toàn cốt lõi: **C32 (tổng chi phí)** và **C47 (đầu ra)** bị **khóa cứng vĩnh viễn** — không
> bao giờ xuất hiện trong dữ liệu trả về, kể cả khi cấu hình sai. Chỉ các cột trong **C33–C46**
> mà CEO bật (allowlist) mới được gửi. Mẫu full-time dùng **C36, C41, C43, C44, C45**;
> mẫu part-time dùng **C36**. Trường text **C48** được whitelist riêng làm ghi chú, không phải tỷ lệ.

## 1. Endpoint
```
GET /api/integrations/app-report/employee-cost?emp=<MÃ_NHÂN_VIÊN>&from=YYYY-MM&to=YYYY-MM
```
- App Report resolve `emp` bằng phiên đã xác thực và scope ở backend. Nhân viên luôn
  bị ép về mã của chính phiên; CEO/admin chỉ được chọn NV qua nhánh scope đã phân quyền.
  Trình duyệt không bao giờ được cung cấp/ghi đè employee-cost key.

## 2. Xác thực hai lớp S2S
- Header **`x-assignment-key: <service key>`**, App Report đọc từ
  `DATA_HUB_ASSIGNMENT_KEY` (phía Data Hub allowlist bằng `DATA_HUB_ASSIGNMENT_KEYS`).
- Header **`x-employee-cost-key: <employee-bound key>`**, App Report chọn chính xác
  từ `APP_REPORT_EMPLOYEE_COST_KEYS` dạng
  `DN001=<opaque-key-at-least-16-chars>,DN002=<another-key>` sau khi resolve scope.
- Mã NV được chuẩn hóa uppercase. Dòng sai định dạng/key ngắn bị bỏ; key trùng giữa
  hai NV, nhiều key xung đột cho một NV, hoặc key trùng assignment key đều không dùng được.
- Thiếu một trong hai key thì App Report fail closed **trước khi gọi mạng**. Không có
  fallback sang `APP_REPORT_COST_TOKEN`; key không bao giờ đi qua frontend/log/audit/error.
- Không có/sai key → **401** từ Data Hub.
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
    { "key": "c44", "pos": 44, "label": "Lương cuối năm (%)" },
    { "key": "c45", "pos": 45, "label": "Lương tăng thêm (13) (%)" }
  ],
  "count": 2,
  "rows": [
    { "c5": "QL1", "c7": "U1", "c16": "Tên thuốc A", "c25": "Viên", "c36": 8, "c41": 3, "c43": 2, "c44": 5, "c45": 4, "c48": "Ghi chú" },
    { "c5": "QL2", "c7": "U2", "c16": "Tên thuốc B", "c25": "Gói", "c36": 9, "c41": 1, "c43": 1, "c44": 5, "c45": 2, "c48": null }
  ]
}
```
- Mỗi dòng gồm **định danh công khai** (C5 mã QLNB, C7 mã đơn vị, C16 tên thuốc, C25 ĐVT) + **đúng các cột tỷ lệ allowlist** + C48 text nếu có.
- **Không bao giờ** có `c32`, `c47`, hay bất kỳ cột C33–C46 nào ngoài allowlist.
- C48 không được đưa vào `columns[]`; App Report sanitize và ánh xạ riêng thành `note`.
- App Report chỉ tính/hiển thị các cột được mẫu riêng của nhân viên cho phép. Full-time cần đủ 5 tỷ lệ; part-time (`DN021/DN022/DN023`) chỉ cần C36. Thiếu tỷ lệ bắt buộc → hiển thị `—` và tính vào độ phủ để fail closed tổng dưới 90%.

## 4. Ràng buộc & lỗi
- Chỉ trả các dòng có **C6 = emp** (nhân viên chỉ thấy phần của mình).
- Thiếu `emp` → **400**.
- Nếu hệ thống phát hiện cột cấm lọt vào payload → chặn cả gói, trả **502** (`CATALOG_PERMANENT_FIELD_BLOCKED`). App Report coi đây là lỗi tạm thời, thử lại sau.
- Giá trị các cột là **tỷ lệ (%) theo từng dòng danh mục** — không phải số tiền; **không được cộng dồn** giữa các dòng (nếu cần tổng hợp phải có cơ sở doanh thu theo kỳ, là báo cáo khác).

## 5. Ai điều khiển allowlist
- **CEO** bật/tắt cột trong **CEO Vault → "Chia chi phí cho App Report"** (chỉ C33–C46; C32/C47 khóa cứng). Mỗi thay đổi ghi nhật ký.
- Data Hub quyết định cột nào ra — App Report **không** yêu cầu được cột ngoài allowlist.

## 6. Phía App Report cần làm
1. Backend resolve NV từ phiên/scope, chọn đúng employee-bound key rồi gọi endpoint
   bằng cả `x-assignment-key` và `x-employee-cost-key`.
2. Chọn mẫu bằng `employee_cost_templates.json`, tách biệt hoàn toàn với nhóm công tắc hiển thị.
3. Dùng C48 duy nhất làm ghi chú; tiếp tục loại mọi field không thuộc hợp đồng.
4. Ghép tỷ lệ theo mã hàng × tháng vào từng order-line doanh thu self-scoped; tính tiền trên doanh thu **trước VAT** (`revenue / VAT_DIVISOR × tỷ lệ / 100`), tách C44 khỏi tổng tháng.
5. Xử lý 401 (sai key) / 502 (thử lại) / 400 (thiếu emp).

---
*Phía Data Hub: đã hoàn tất + kiểm thử bảo mật (C32/C47 không bao giờ lọt; chỉ trả cột allowlist của đúng nhân viên).*
