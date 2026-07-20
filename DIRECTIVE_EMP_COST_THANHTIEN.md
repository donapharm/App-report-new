# DIRECTIVE — "Chi phí của tôi": App Report TỰ tính Thành tiền + hiển thị % + cột "cuối năm" (C44)

> Claude Code giao bot. CEO chốt 2026-07-20: **DataHub KHÔNG mở thêm cột** → App Report **tự thêm cột Thành tiền và
> tự tính**. Module "Chi phí của tôi" (`6781517`) đã có; đây là phần bổ sung. Giữ nguyên khóa scope/C32-C47/token.

## 1. Công thức Thành tiền (CEO xác nhận)
- **`Thành tiền(dòng, cột%) = doanh thu dòng × % ÷ 100`.**
  - Ví dụ doanh thu dòng `10.000.000đ`: `8.0`→ **800.000đ** · `0.3`→ **30.000đ** · `10.0`→ **1.000.000đ**.
- **"Doanh thu dòng"** = doanh thu của đúng dòng đó (nhân viên × đơn vị × sản phẩm × kỳ). App Report **tự lấy từ
  dữ liệu doanh thu sẵn có** (`report_rows`/analytics), **ghép** với dòng chi phí theo **đơn vị (`c7`) + sản phẩm
  (`c16`)**. `c16` là **tên** → map sang **mã sản phẩm** qua `catalog` rồi khớp (khớp theo MÃ, không theo tên trần).
  - **Không khớp được** doanh thu cho 1 dòng → Thành tiền dòng đó để **`—`**, KHÔNG đoán, KHÔNG bịa (nguyên tắc #3).
  - Nếu tỉ lệ dòng khớp được thấp (vd < 90%) → **báo Claude/CEO** thay vì hiển thị số sai lệch.
- Đây là **phép tính xác định** (doanh thu thật × % thật), không phải chế số → hợp grounding.

## 2. Hiển thị cột % (CEO chốt)
- Ô % hiển thị **đúng con số, BỎ ký hiệu `%`**: `8,0%`→`8.0` · `0,3%`→`0.3` · `10,0%`→`10.0`.
- (Header/nhãn cột đã cho biết đây là % nên không cần lặp `%` mỗi ô.)

## 3. Cột Thành tiền + Tổng chi phí tháng
- Mỗi cột % đang bật → thêm **1 cột "Thành tiền"** tương ứng, **định dạng tiền VN** (`đ`, phân cách nghìn).
- **Tổng chi phí tháng** = **Σ Thành tiền các cột** — **TRỪ các cột "cuối năm"** (§4).
- % vẫn **KHÔNG cộng dồn**; Thành tiền (tiền) **ĐƯỢC** tổng (trừ cột cuối năm).

## 4. ‼ Cột "cuối năm" — mặc định `c44` (Claude tư vấn cách trình bày thông minh)
Bối cảnh: `c44` thanh toán **CUỐI NĂM (hết T12)**, **KHÔNG** tính vào chi phí **hàng tháng** của NV.
Cách trình bày (áp dụng):
- Cột `c44` **vẫn hiển thị Thành tiền theo dòng**, nhưng **LÀM MỜ** (chữ xám nhạt / opacity ~0.5, in nghiêng) +
  **badge "cuối năm"** (hoặc ⏳) ở header → NV thấy rõ đây là khoản **không tính vào tháng**.
- **KHÔNG cộng `c44` vào "Tổng chi phí tháng".** Nhãn tổng ghi rõ: **"Tổng chi phí tháng (chưa gồm khoản cuối năm)"**.
- Thêm **1 dòng tách riêng** dưới bảng: **"Khoản cuối năm (tạm tính · chi trả T12): [Σ Thành tiền c44] đ"** — cho NV
  thấy khoản tương lai, tách hẳn khỏi chi phí tháng.
- **Chú thích chân bảng:** "Cột [tên c44] thanh toán vào cuối năm (tháng 12), không tính vào chi phí hàng tháng."
- **Tập cột "cuối năm" cấu hình được** (hằng số/`config`, mặc định `{ c44 }`) — CEO đổi được, không rải hardcode.

## 5. Giữ nguyên tắc (không phá bản đã review ĐẠT)
- NV chỉ thấy của mình (backend scope); **C32/C47 vẫn chặn**; token chỉ ở backend; audit; không đưa vào LLM/NLQ.
- Số grounded (doanh thu thật × % thật). Không hardcode PII/số trong bundle.

## 6. Nghiệm thu
1. Dòng doanh thu `10.000.000đ`, `c36=8.0` → Thành tiền `800.000đ`; `=0.3` → `30.000đ`.
2. Cột % hiện `8.0` / `0.3` / `10.0` (không có ký hiệu `%`).
3. "Tổng chi phí tháng" **không gồm** `c44`; `c44` **mờ + badge**; có dòng **"Khoản cuối năm (T12)"** riêng + chú thích.
4. Dòng không khớp doanh thu → Thành tiền `—` (không đoán).
5. NV chỉ thấy của mình; C32/C47 vẫn chặn; test cũ vẫn PASS.
6. Ghi CHANGELOG; commit + push main; gửi CEO/anh xem bản có Thành tiền; báo Claude review.
