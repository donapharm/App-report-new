# DIRECTIVE — "Chi phí của tôi": grain hiển thị = mỗi ĐƠN × mỗi MẶT HÀNG (không gộp)

> Claude Code giao Report Bot. **CEO chốt 2026-07-21.** Chỉnh **độ mịn dòng hiển thị** — thuần App Report, KHÔNG
> phụ thuộc DataHub (làm được ngay, không chờ blocker %). Nối tiếp `DIRECTIVE_EMP_COST_TIMELINE_REDESIGN.md`.

## 1. YÊU CẦU CEO
1. **Đơn hàng có nhiều mặt hàng → mỗi mặt hàng là 1 dòng.**
2. **Trong tháng có nhiều đơn của cùng mã QLNB → mỗi mã đơn hàng là 1 dòng** (KHÔNG gộp các đơn cùng mã lại).

⇒ **Grain = dòng giao dịch (order-line)**, **BỎ gộp** theo `(đơn vị × mã hàng)` như hiện tại.

## 2. SỬA (Report Bot)
- **Ngưng gộp doanh thu** theo `(đơn vị × mã hàng)`/tháng. **Mỗi dòng doanh thu thô (mỗi đơn × mỗi mặt hàng) = 1 dòng
  hiển thị.** (Dữ liệu App Report đã ở grain này — trước đây `82 giao dịch → 69 khóa` là do gộp; nay **giữ đủ 82 dòng**.)
- Mỗi dòng hiển thị gồm: **mã đơn hàng** (nếu nguồn có) · **ngày** · **đơn vị `c7`** · **mã hàng/QLNB `c5`** · **tên
  hàng `c16`** · **ĐVT `c25`** · (số lượng nếu có) · **doanh thu dòng** · **% (tra timeline theo mã hàng + tháng)** ·
  **Thành tiền = doanh thu dòng × % ÷ 100**.
- **% tra theo MÃ HÀNG + THÁNG** (timeline): **mọi dòng cùng mã hàng trong 1 tháng dùng CÙNG mức %** (rule ngày-đầu-tháng).
- **Giữ nguyên** phần đã đạt: tổng chi phí tháng = Σ Thành tiền các dòng; Tổng cả kỳ; **c44** tách cuối năm; `%` dạng
  `8.0`; self-scope NV; khóa `C32/C47`; công tắc bật/tắt. Thiếu %/không tra được → Thành tiền `—` + tính vào tỉ lệ chưa khớp.
- **Xem theo ngày:** vì dòng đã là order-line có ngày → "xem theo ngày" thành **gom/nhóm theo ngày** (Σ ngày = tổng
  tháng vẫn đúng). Sắp xếp gợi ý: theo ngày rồi theo đơn.

## 3. NGHIỆM THU (số thật)
1. **Cerecaps T06 DN001: 2 đơn → 2 DÒNG riêng** (`13.246.800đ` và `11.970.000đ`), **không gộp thành 1**.
2. Một đơn có N mặt hàng → **N dòng**.
3. T07: mỗi đơn/mặt hàng 1 dòng; Thành tiền mỗi dòng = doanh thu dòng × %(mã hàng, tháng).
4. Tổng tháng = Σ tất cả dòng (khớp). c44 vẫn tách. Test cũ + test grain mới PASS.
5. Push nhánh review lên **`donapharm/app-report-new`**; dán mẫu vài dòng thật; báo Claude review. Chưa deploy.

## 4. LƯU Ý
- Đây là **hiển thị App Report**, chạy được **ngay cả khi DataHub chưa xong timeline** (lúc đó % là `—`, nhưng vẫn
  hiện đủ dòng doanh thu theo grain mới). Blocker % vẫn do DataHub xử lý riêng.
