# SPEC — Màn đăng nhập V2 (Telegram + Zalo OTP + phiên 60' + thiết bị tin cậy)

> Spec do Claude Code (kiến trúc/review) chốt từ đề xuất của bot, CEO duyệt 2026-07-02.
> Bot server là người TRIỂN KHAI. Làm xong push + ghi CHANGELOG để Claude review.
> Nguyên tắc không đổi: mọi phiên đều qua `issueToken` + `scopeOf` (NV chỉ thấy phần mình);
> không đụng nguồn đã cách ly `dona-report` (3860); không commit secret.

---

## 1. Giao diện màn đăng nhập
- Logo DNPHARMA + tiêu đề **"Đăng nhập App Report"** + mô tả: *"Xem doanh thu, target, cơ số thầu theo quyền được phân công."*
- Nền xanh dược nhẹ, form thẻ trắng bo góc. Giữ QR Zalo OA ở cuối.
- Thứ tự: **(1) Nút "Đăng nhập bằng Telegram" (chính)** → (2) "Hoặc đăng nhập bằng SĐT (OTP Zalo)".

## 2. Đăng nhập Telegram (chính)
Luồng: bấm nút → app hiện mã `RP-XXXXXX` (+ link mở Report Bot) → NV gửi mã cho bot Telegram → bot hỏi xác nhận → NV bấm ✅ → app tự vào.

**API:**
```
POST /api/auth/telegram/start
  → { login_code: "RP-482913", poll_secret: "<random ≥32 ký tự>", expires_in: 120,
      bot_link: "https://t.me/<bot>?start=RP-482913" }

POST /api/auth/telegram/status   body: { poll_secret }
  → { status: "pending"|"confirmed"|"expired", token?, user? }

POST /api/auth/telegram/confirm  (chỉ bot Telegram gọi, nội bộ server)
  body: { login_code, telegram_id, secret_bot }
  → gắn user (từ mapping) vào phiên chờ; secret_bot lấy từ env TELEGRAM_BOT_SECRET
```

**BẮT BUỘC chống device-code phishing:**
1. Bot Telegram nhận mã → **hỏi lại bằng nút** *"✅ Xác nhận đăng nhập App Report lúc HH:MM"* — chỉ khi NV bấm mới gọi `confirm`. Kèm cảnh báo: *"Không gửi mã này theo yêu cầu của người khác."*
2. Mã TTL **120 giây**, **dùng 1 lần**, hủy ngay sau confirm/hết hạn.
3. Trình duyệt poll bằng **poll_secret** (không phải mã hiển thị) — biết mã cũng không rút được token.
4. Rate-limit: tạo mã ≤5/phút/IP; poll ≥2 giây/lần; confirm sai secret_bot → 403 + log.

**Mapping Telegram (admin duyệt trước):**
- Bảng `telegram_id ↔ emp_code` lưu backend (file/SQLite). Telegram chưa map → bot trả lời: *"Tài khoản Telegram chưa được cấp quyền App Report."*
- API admin (requireAdmin): `GET/POST/DELETE /api/admin/telegram-map` `{telegram_id, emp_code}`.

## 3. Đăng nhập SĐT / OTP Zalo (dự phòng)
- Giữ nguyên luồng hiện có (backend 3848: request → verify → chọn tài khoản nếu nhiều mã NV). Không đập đi.
- UI đặt dưới nút Telegram, dạng "Hoặc đăng nhập bằng SĐT".

## 4. Phiên đăng nhập & thiết bị tin cậy
**Session (áp cho CẢ 2 cách đăng nhập):**
- TTL **60 phút** (tuyệt đối). Trong 60': tắt tab/thoát trình duyệt/refresh/mở lại link → **không hỏi OTP lại** (token còn hạn trong localStorage như hiện tại).
- Hết 60' → đăng nhập lại; nếu là **thiết bị tin cậy** → luồng nhanh (điền sẵn SĐT / gợi ý Telegram).
- **Session chuyển sang lưu BỀN (file/SQLite)** — bỏ Map RAM hiện tại (restart server không văng phiên). Lưu: token(hash), emp_code, role, deviceId, issued_at, expires_at.

**Thiết bị tin cậy:**
- Trình duyệt sinh `deviceId` ngẫu nhiên bền (localStorage), gửi kèm khi đăng nhập.
- Mỗi tài khoản tối đa **3 thiết bị tin cậy**. Thiết bị thứ 4: **tự đá thiết bị cũ nhất** (mặc định — đơn giản, không chặn công việc) + ghi audit.
- API admin (requireAdmin): `GET /api/admin/devices?emp=`, `DELETE /api/admin/devices/:id` (xem/xoá thiết bị từng NV).
- **Tự hủy toàn bộ phiên + thiết bị** của NV khi: đổi SĐT, đổi mã NV, đổi quyền, hoặc xoá khỏi danh bạ.

## 5. Nghiệm thu (bot tự test trước khi báo)
1. Telegram: NV đã map → đăng nhập được; bot có nút ✅; mã hết hạn sau 120s; gửi mã của người khác cho bot mà không bấm ✅ → không vào được; telegram lạ → báo "chưa được cấp quyền".
2. Zalo OTP: vẫn chạy như trước; mã sai không vào (data.ok).
3. Session: refresh/tắt mở lại trong 60' không hỏi OTP; sau 60' hỏi lại; **restart PM2 app-report phiên còn sống** (session bền).
4. Thiết bị: đăng nhập thiết bị thứ 4 → thiết bị cũ nhất bị đá; admin xem/xoá được danh sách.
5. Phân quyền: CEO thấy toàn bộ; DN009 chỉ thấy phần mình (re-test sau mọi thay đổi auth).

## 6. Ngoài phạm vi đợt này
- SSO portal, sinh trắc học, đa yếu tố nâng cao — chưa làm.
- Không đổi gì ở các tab dữ liệu.
