# SPEC — Bản tin chủ động qua Telegram + Sửa phiên đăng nhập

> Claude Code chốt (CEO duyệt 2026-07-02). Bot triển khai; Claude review.
> Tận dụng bot @Reportdonapharm_bot + mapping telegram_id đã có. Mọi số theo scope + chỉ NV đã map & đang hoạt động.

## PHẦN A — Sửa phiên đăng nhập (ưu tiên, lỗi UX hằng ngày)
Vấn đề: cùng thiết bị vẫn bị hỏi OTP lại vì session 60' TUYỆT ĐỐI.
Sửa:
1. **Rolling session:** mỗi request có token hợp lệ → gia hạn `expires_at = now + IDLE_TTL`. Dùng liên tục không bị out.
2. **Thiết bị tin cậy hạn dài:** `IDLE_TTL` = **7 ngày** (env `SESSION_IDLE_DAYS`, mặc định 7) trên thiết bị đã đăng nhập OTP thành công. Re-OTP chỉ khi: quá hạn nhàn rỗi, thiết bị mới/lạ, hoặc đổi SĐT/mã NV/quyền (purgeUser giữ nguyên).
3. **deviceId ổn định:** frontend sinh `deviceId` ngẫu nhiên lưu `localStorage` (1 lần), gửi kèm MỌI request (header `x-device-id`). Kiểm: cùng máy → cùng deviceId (không tạo mới mỗi lần) → không bị coi là thiết bị thứ 4 oan.
4. Giữ: tối đa 3 thiết bị/NV, admin xem/xoá thiết bị, audit.
Nghiệm thu: đăng nhập rồi dùng liên tục > 1h KHÔNG bị hỏi OTP; đóng/mở lại trong 7 ngày trên cùng máy → vào thẳng; máy lạ → phải OTP.

## PHẦN B — Bản tin chủ động (Telegram)
Kênh: bot @Reportdonapharm_bot gửi tới `telegram_id` đã map (chỉ NV đang hoạt động; bỏ NV nghỉ).

### Loại tin
1. **Bản tin sáng — CEO/admin** (mặc định 07:30 hằng ngày):
   *"📊 DNPHARMA — Kỳ MM.YYYY: DT <x tỷ> (▲/▼ y% so kỳ trước). ⚠ <N> NV chưa đạt · <M> cơ số sắp cạn · <K> đơn vị giảm mạnh. Mở app: <link>"*
2. **Bản tin NV sale** (mặc định 07:30):
   *"Chào <tên>. Kỳ MM.YYYY: DT của bạn <x> · đạt <p>% target. <nhắc nếu <80%>. Mở app: <link>"*
3. **(Tùy chọn, sau)** Cảnh báo tức thời khi 1 sản phẩm/đơn vị của NV có cơ số < ngưỡng.

### Quy tắc
- Nội dung theo **scope**: CEO = toàn công ty; NV = phần mình (tái dùng `overviewKpis`/`buildAlerts` với scope theo emp_code).
- **Chỉ gửi cho NV đã map telegram_id + đang hoạt động** (có doanh thu kỳ gần nhất hoặc status active). Không map → không gửi.
- **Opt-out:** NV nhắn `/tat` cho bot để ngừng nhận; `/bat` để bật lại (lưu preference bền).
- **Chống trùng:** ghi log đã gửi (telegram_id + loại + ngày) → không gửi lặp trong ngày.
- Lịch chạy: cron (env `DIGEST_CRON`, mặc định `30 7 * * *`), múi giờ VN. Có lệnh admin gửi thử `/digest_test` (chỉ gửi cho chính admin).
- An toàn: không lộ số cho người chưa map/nghỉ; dùng `TELEGRAM_BOT_SECRET` nội bộ; secret không commit.

### Kỹ thuật
- Thêm vào worker `telegram-bot.js` (đang chạy) một scheduler, hoặc worker riêng `digest-worker.js`. Dùng cron nhẹ (tự tính giờ, không cần lib nặng).
- Backend hàm dựng nội dung tin theo scope (tái dùng smart/analytics). Không đụng app cũ.

## Nghiệm thu tổng
- Phiên: dùng liên tục >1h không hỏi OTP; 7 ngày trên cùng máy vào thẳng; máy lạ hỏi OTP.
- Digest: gửi thử `/digest_test` cho CEO ra đúng số toàn công ty; 1 NV sale ra đúng số của mình; NV chưa map/nghỉ không nhận; `/tat` ngừng nhận.
