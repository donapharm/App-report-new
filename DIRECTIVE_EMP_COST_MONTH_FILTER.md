# DIRECTIVE — "Chi phí của tôi": bộ lọc kỳ (Từ tháng → Đến tháng) + LẤY THỬ THỰC TẾ T07/2026

> Claude Code giao bot. CEO chốt 2026-07-20. Bổ sung bộ lọc kỳ cho module "Chi phí của tôi" và **lấy dữ liệu THẬT
> tháng 7 tính thử**. Giữ nguyên khóa scope NV / C32-C47 / token / grounding.

## 1. App Report — BỘ LỌC KỲ (bot làm)
- **FE trang "Chi phí của tôi":** thêm ô lọc **"Từ tháng"** và **"Đến tháng"** (dạng `MM/YYYY`, mặc định = tháng
  hiện tại). Cho chọn **1 tháng** (T07) hoặc **khoảng** (T07 → T08 …).
- **Backend `/api/employee-cost`:** nhận thêm `from`, `to` (định dạng `YYYY-MM`), **truyền xuống DataHub**
  `?emp=<emp đã scope>&from=<YYYY-MM>&to=<YYYY-MM>`. **Vẫn khóa scope NV** (NV chỉ của mình; CEO/admin chọn NV).
- **Hiển thị nhiều tháng = (A) TÁCH TỪNG THÁNG:** mỗi tháng 1 khối bảng, có **"Tổng chi phí tháng"** riêng; cột
  **cuối năm `c44`** vẫn mờ + tách "Khoản cuối năm (T12)" trong từng tháng (theo `DIRECTIVE_EMP_COST_THANHTIEN.md`).
  (Tùy chọn: thêm 1 dòng "Tổng cả kỳ" cuối trang — nhưng vẫn KHÔNG gộp `c44`.)
- **1 tháng** → hiển thị như hiện tại. Thành tiền mỗi tháng = **doanh thu dòng (đúng tháng đó) × % ÷ 100**.

## 2. DataHub — nhận THAM SỐ KỲ (bot phối hợp phiên DataHub)
- Endpoint `employee-cost` cần nhận thêm `from`/`to` (tháng) và trả dữ liệu **đúng kỳ** (chi phí là số liệu theo
  tháng — mỗi tháng một bản CP_TOTAL). **Đây là thêm THAM SỐ LỌC, KHÔNG phải thêm cột** (khác việc trước).
- Nếu endpoint **chưa** hỗ trợ `from/to` → bot phối hợp phiên DataHub bổ sung; App Report **vẫn build sẵn** phần lọc
  để ráp vào là chạy.

## 3. ‼ LẤY THỬ THỰC TẾ THÁNG 7/2026 (bot chạy trên server — Claude không có quyền dữ liệu thật)
- Bot gọi endpoint **thật** cho **T07/2026**, với **vài NV mẫu**, tính:
  `Thành tiền(dòng) = doanh thu dòng (T07) × % ÷ 100`.
- **Dán kết quả thật** (ẩn danh nếu cần) cho CEO + Claude soi:
  - Vài dòng: đơn vị · sản phẩm · % (dạng `8.0`) · doanh thu dòng · Thành tiền.
  - **Tổng chi phí tháng T07** (đã trừ cột cuối năm `c44`).
  - Cột `c44` hiển thị **mờ** + dòng **"Khoản cuối năm (T12)"** riêng.
  - Tỉ lệ dòng **khớp được doanh thu** (nếu < 90% → nêu rõ, không hiển thị số sai).

## 4. GIỮ NGUYÊN TẮC + NGHIỆM THU
- Số grounded (doanh thu thật × % thật; dòng không khớp → `—`). NV chỉ thấy của mình. C32/C47 vẫn chặn.
- Test cũ vẫn PASS + thêm test bộ lọc kỳ. Ghi CHANGELOG; commit + push main; **dán kết quả T07 thật**; báo Claude review.
