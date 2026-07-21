# DIRECTIVE — "Chi phí của tôi": chốt (C) + xem theo NGÀY + cách LẤY ĐÚNG cột khi DataHub khóa C32–C47

> Claude Code giao bot. CEO chốt 2026-07-20. Nối tiếp `DIRECTIVE_EMP_COST_THANHTIEN.md` +
> `DIRECTIVE_EMP_COST_MONTH_FILTER.md`. Giữ scope NV / C32-C47 / token / grounding.

## 0. CEO chốt
- Khoảng nhiều tháng = **(C)**: **tách từng tháng** + thêm **1 dòng "Tổng cả kỳ"** cuối trang.
  (Tổng tháng và Tổng cả kỳ đều **KHÔNG gộp `c44`**; `c44` cuối năm luôn tách riêng.)
- NV **bấm xem theo NGÀY** trong một tháng.
- Chỉ lấy các **cột được chỉ định** từ DataHub.

## 1. Xem theo NGÀY (App Report tự tính từ doanh thu ngày)
- Trong 1 tháng, NV bấm để **xổ chi tiết theo ngày**. Mỗi ngày:
  `Thành tiền ngày = doanh thu ngày đó × %(của tháng) ÷ 100`.
- **%** là tỉ lệ THÁNG (không đổi theo ngày). App Report dùng **doanh thu theo ngày sẵn có** (`report_rows.date`)
  để tách Thành tiền theo ngày. **Tổng các ngày = Thành tiền tháng** (phải khớp — nghiệm thu).
- Dòng ngày không khớp doanh thu → `—` (không đoán). `c44` theo ngày vẫn **mờ** + không vào tổng tháng.

## 2. ‼ CÁCH LẤY ĐÚNG CỘT khi DataHub khóa C32–C47 (điểm CEO hỏi — Claude tư vấn)
**Nguyên tắc: KHÔNG phá khóa, KHÔNG đọc thẳng cột khóa. Dùng đúng "cửa được cấp phép".**
- DataHub **giữ khóa C32–C47** ở mức chung (đúng — đó là bảo mật). Ngoại lệ hợp lệ **duy nhất** là **endpoint dịch vụ**
  `/api/integrations/app-report/employee-cost` xác thực bằng `x-assignment-key`.
- Qua endpoint đó, DataHub **chủ động "công bố" đúng danh sách cột CEO chỉ định** (trong **C33–C46**),
  **self-scoped theo từng NV**, và **luôn loại `C32` (tổng) + `C47` (đầu ra)**.
- Bot **CHỈ lấy qua endpoint + token** — **KHÔNG** đọc file/cột khóa trực tiếp, **KHÔNG** tự mở khóa, không dò cột.
- **Danh sách cột được lấy = CEO bật/tắt ở DataHub** (allowlist). App Report render đúng cột endpoint trả về; `c44`
  nằm trong danh sách nhưng đánh dấu **"cuối năm"** (mờ + tách, theo directive Thành tiền).
- **Bot cần DataHub xác nhận danh sách cột endpoint sẽ trả** (key + nhãn) để App Report hiển thị đúng.
- App Report vẫn **chặn phòng vệ 2 lớp** C32/C47 (backend + FE) kể cả nếu endpoint lỡ trả — đã có, giữ nguyên.

→ Tóm cho bot: *lock giữ nguyên; endpoint + assignment key là cửa hợp lệ; DataHub whitelist C33–C46 (CEO chọn)
qua endpoint + khóa cứng C32/C47; bot chỉ dùng endpoint, không lách, không đọc cột khóa trực tiếp.*

## 3. Nghiệm thu
1. Nhiều tháng: tách từng tháng + có dòng **"Tổng cả kỳ"**; `c44` không vào tổng tháng lẫn tổng kỳ.
2. Bấm 1 tháng → xổ theo ngày; **Σ ngày = Thành tiền tháng**. Ngày không khớp doanh thu → `—`.
3. Chỉ hiển thị cột endpoint công bố; C32/C47 không bao giờ xuất hiện; NV chỉ thấy của mình.
4. Lấy thử THẬT T07 (theo directive trước) — dán kết quả cho CEO/Claude.
5. Test cũ vẫn PASS + test day-view/tổng-kỳ. Ghi CHANGELOG; commit + push main; báo Claude review.
