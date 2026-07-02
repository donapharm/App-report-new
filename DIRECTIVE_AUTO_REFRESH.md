# DIRECTIVE — Tự động cập nhật doanh thu mỗi 1 giờ (MISA + WEB) + nhãn giờ + nút Làm mới

> Claude Code giao (CEO chốt nhịp B = mỗi 1 giờ, 2026-07-03). Bot triển khai; Claude review. Không đụng app cũ 3860; App Sale/MISA chỉ ĐỌC (trừ bước chụp snapshot MISA vốn đã có ở hệ Đặt hàng).

## Mục tiêu
Số doanh thu kỳ đang chạy (T07…) **tự cập nhật mỗi 1 giờ**, không cần chạy tay. Mọi user (CEO + NV) mở app là thấy số mới nhất theo scope của mình.

## Scheduler (mỗi 60 phút)
Mỗi lần chạy, theo thứ tự:
1. **Chụp snapshot MISA → DB** (tái dùng cơ chế "Chụp snapshot MISA → DB" đã có; đây là bước gọi MISA thật → chỉ 1 lần/giờ, không dày hơn).
2. **Materialize kỳ ĐANG CHẠY** (`materialize_july_revenue.js` idempotent): kéo MISA snapshot mới nhất + WEB live → cập nhật slot `07.2026` (và kỳ hiện tại nói chung). Áp đúng quy tắc đã chốt: đã thực hiện = MISA xuất HĐ + WEB đã giao ĐỦ (PA-A); quy tắc gán kỳ đang chờ bot làm rõ (xem `DIRECTIVE_ENABLE_JULY_REVENUE.md`).
3. **Ghi mốc `data_as_of`** = thời điểm chạy xong (giờ VN) để frontend hiển thị.
- **CHỈ re-materialize kỳ đang chạy**; kỳ đã đóng (T06 trở về trước) **GIỮ NGUYÊN đóng băng**, không đụng.
- **KHUNG GIỜ CHẠY (CEO chốt 2026-07-03 — tiết kiệm token/tải MISA):** chỉ tự cập nhật trong giờ làm việc, giờ VN (UTC+7):
  - **Thứ 2 → Thứ 6:** **07:30 → 18:30** (chạy 07:30 rồi mỗi 60' đến 18:30).
  - **Thứ 7:** **07:30 → 13:00**.
  - **Chủ nhật:** **KHÔNG chạy.**
  - Ngoài khung → không gọi MISA; số giữ nguyên lần cập nhật gần nhất (nhãn "Cập nhật đến…" vẫn hiện). ⇒ ~66 lần/tuần thay vì 168 (giảm ~60%).
- **Cấu hình bằng env:** `REVENUE_REFRESH_MINUTES` (mặc định 60); khung giờ + ngày trong tuần cấu hình được (VD `REVENUE_REFRESH_WEEKDAY=07:30-18:30`, `REVENUE_REFRESH_SAT=07:30-13:00`, `REVENUE_REFRESH_SUN=off`). Scheduler kiểm giờ VN trước mỗi lần chạy; ngoài khung thì bỏ qua.
- Idempotent, có log; nếu 1 lần chạy lỗi (MISA timeout…) → giữ số cũ, thử lại lần sau, KHÔNG để trắng số.

## Frontend
- Hiện **"Cập nhật đến HH:MM ngày dd/mm"** (từ `data_as_of`) ở Tổng quan + các trang doanh thu, cho kỳ đang chạy.
- Nút **"↻ Làm mới"** (admin) → gọi refresh on-demand ngay (chạy lại bước scheduler 1 lần) khi cần số tức thì.
- (Tuỳ chọn) tự reload nhẹ số liệu phía client mỗi vài phút để user đang mở app không phải F5.

## Scope / trải nghiệm NV
- Refresh cập nhật **dữ liệu chung**; mỗi user đọc theo **scope của mình** như thường (NV chỉ thấy phần mình). NV **không thao tác gì** — mở app là thấy số mới nhất trong vòng 1 giờ.
- Không đổi mô hình quyền; không ảnh hưởng đăng nhập.

## Nghiệm thu
- Sau khi bật: số kỳ đang chạy đổi theo mỗi giờ; nhãn "Cập nhật đến…" đúng giờ VN.
- Nút Làm mới kéo được số mới ngay.
- Kỳ đã đóng không đổi; T06 vẫn 28.403.136.096.
- 1 NV mở app thấy số của mình cập nhật; không lộ người khác.
- MISA chỉ bị gọi ~1 lần/giờ (không quá tải).
