# DIRECTIVE — Bật lại Telegram login worker (BOT RIÊNG, tách khỏi agent)

> Claude Code giao (CEO chọn "bật lại, tạo bot riêng" 2026-07-02). Bot server cấu hình + start. Không đụng app cũ 3860. Token CHỈ vào .env, không commit/không dán chat.

## Bối cảnh
`reportnew-tgbot` đang tắt vì `.env` để `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` rỗng. Trước đây login worker + agent làm code DÙNG CHUNG 1 bot → xung đột getUpdates (409) → loạn "gửi mã". **Lần này bắt buộc: login worker dùng BOT RIÊNG, khác bot agent.**

## CEO làm (tạo bot mới qua @BotFather)
1. Telegram → chat `@BotFather` → `/newbot`.
2. Đặt tên hiển thị (VD `DNPHARMA App Report Login`) + username kết thúc `bot` (VD `DonaReportLogin_bot`, phải còn trống).
3. BotFather trả **token** dạng `123456789:ABC...`.
4. **KHÔNG dán token ra chat** — đưa cho bot server điền vào `.env`.

## Bot server làm (cấu hình + bật)
1. Điền `.env` reportnew:
   - `TELEGRAM_BOT_TOKEN=<token bot MỚI>`
   - `TELEGRAM_BOT_USERNAME=<username bot MỚI, không @>`
   - Giữ `TELEGRAM_BOT_SECRET` cũ (64 ký tự) + `APP_PUBLIC_URL=https://reportnew.donapharm.asia`.
2. **Kiểm bot MỚI ≠ bot agent làm code** (khác token/username) → không còn 2 tiến trình poll chung 1 bot.
3. `getMe` verify username đúng; `pm2 start`/khởi động `reportnew-tgbot`; `pm2 save`.
4. Login page dùng `TELEGRAM_BOT_USERNAME` để nút "Mở Report Bot" trỏ đúng bot MỚI.
5. Mapping `telegram_id → emp_code` cũ VẪN dùng được (telegram_id là ID tài khoản người dùng, không đổi theo bot). CEO đã map sẵn `1748199545→CEO`.

## Sau khi bật
- Mỗi người muốn dùng login/digest Telegram cần bấm **Start** con bot MỚI một lần.
- 4 CTV ngoài (DN021/022/023/VP004) có `no_auto_notify` → **KHÔNG nhận digest** dù đã map (guardrail giữ nguyên).
- Test: login web → "Đăng nhập bằng Telegram" → gửi RP-code cho bot MỚI → bấm ✅ → vào thẳng. `/digest_test` (CEO) ra bản tin.

## Nghiệm thu
- `pm2 list` có `reportnew-tgbot` online; `getMe` = bot MỚI.
- Đăng nhập Telegram chạy; không còn xung đột "gửi mã" (agent 1 bot, login 1 bot).
- Digest sáng 07:30 VN gửi đúng scope; 4 CTV ngoài không nhận.
