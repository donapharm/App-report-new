# DIRECTIVE — MÀN ĐĂNG NHẬP CHỈ TELEGRAM, ẨN OTP ZALO ĐANG LỖI (08/08/2026)

Phạm vi bot đề xuất, Claude ghi lại làm căn cứ Gate 2:

1. Chỉ hiện đăng nhập **Telegram**.
2. **Ẩn hoàn toàn** nút/form OTP Zalo đang lỗi — ẨN, không xoá code; Zalo sửa xong
   thì mở lại được bằng một thay đổi nhỏ.
3. Hướng dẫn ngay trên màn: *mở Report Bot → gửi mã → bấm ✅*.
4. **KHÔNG đổi token/config/backend OTP** — backend Zalo giữ nguyên để không phá
   đường sửa sau này.

## Checklist Gate 2 (Claude soát)

- Diff CHỈ chạm file giao diện đăng nhập (`web/src/pages/Login.jsx` + css/test);
  0 dòng đụng `server/src/auth.js`, `.env`, token.
- Đăng nhập Telegram chạy trọn vòng trên PROD (gửi mã → ✅ → vào app).
- KHÔNG khoá thêm ai: 16 mã bị chặn giữ nguyên danh sách, không thêm bớt.
- Ẩn Zalo = ẩn UI; route backend OTP còn nguyên (gọi thẳng vẫn hoạt động / báo lỗi
  như hiện tại) — để bật lại không cần deploy backend.
- Test: bản chụp màn login chỉ còn 1 đường đăng nhập + hướng dẫn 3 bước.
