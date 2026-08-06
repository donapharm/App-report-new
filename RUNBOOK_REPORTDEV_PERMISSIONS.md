# RUNBOOK — REPORTDEV MẤT QUYỀN EXEC (sự cố 06/08/2026, đã xử xong)

> Triệu chứng: bot REPORTDEV báo *"Runtime chỉ còn read/write; thiếu exec, edit,
> apply_patch, browser, subagent"* — không pull code, không chạy test, không deploy được.
> Toàn bộ hàng đợi việc đứng yên. Cẩm nang này do chính bot tự chẩn đoán ghi lại
> (06/08/2026), Claude lưu vào repo để lần sau xử trong 5 phút.

## Hạ tầng đang chạy bot (ghi lại để khỏi hỏi lại)

- Phần mềm: **OpenClaw** `2026.5.6` · agent `reportdev` · kênh Telegram
- Máy chủ: Linux x64, Node.js 22.22.x · workspace `/home/osboxes/.openclaw/workspace-report-dev`
- Cấu hình: `/home/osboxes/.openclaw/openclaw.json`
- Control UI: `http://127.0.0.1:18789/` (mở TRÊN máy chủ)
- Telegram có `configWrites: false` ⇒ **không** sửa được cấu hình từ chat.

## Nguyên nhân vụ 06/08

KHÔNG phải `openclaw.json` (file này vẫn cho `exec` đầy đủ, `deny` chỉ gồm
`gateway/cron/sessions_send/canvas/nodes/tts/memory_get/memory_search`).
Là **tool manifest của PHIÊN** bị thu hẹp lúc khởi tạo — phiên cũ mở với
allowlist chỉ `read/write`. Mở phiên mới là hết.

## Cách xử — theo thứ tự, dừng ở bước nào ăn bước đó

1. Trong Telegram gửi: `/tools verbose` — xem `exec` có trong danh sách không.
2. Không thấy ⇒ gửi `/new` (mở phiên mới, nạp lại tool policy) → `/tools verbose` kiểm lại.
3. Thấy `exec` rồi thì đặt chế độ: `/exec host=gateway security=full ask=off`
   (lệnh này chỉ CẤU HÌNH tool đã được cấp — không làm tool xuất hiện được).
4. `/new` vẫn chỉ read/write ⇒ quyền bị giới hạn từ **launcher/phần mềm tạo phiên**:
   - Mở Control UI `http://127.0.0.1:18789/` → **Chat** → chọn agent `reportdev` → **New Chat**.
   - KHÔNG chọn profile/allowlist chỉ gồm `read, write`; manifest phải có đủ **`exec` và `process`**.
   - Có thể ép rõ trong Control UI → Config, khối `tools` của agent `reportdev`
     (quanh dòng 378–419): thêm `"alsoAllow": ["exec", "process"]`, GIỮ NGUYÊN
     `deny`, rồi Apply + Restart + New Chat.
   - Vẫn bị ⇒ operator phải bỏ allowlist read/write hoặc thêm `exec`+`process`
     vào tool manifest của launcher — sửa `openclaw.json` KHÔNG chèn thêm tool
     được vào một phiên đã tạo sẵn.

Ghi chú thao tác Telegram: cấu hình `native: false` ⇒ các lệnh `/tools`, `/new`,
`/exec` KHÔNG hiện trong menu gợi ý — phải **gõ tay nguyên văn**, mỗi lệnh một tin nhắn riêng.

## Hai điều rút ra (đã áp dụng)

- **Bot bị trói vẫn phải BÁO THẬT trạng thái blocked** — vụ này bot làm đúng:
  không bịa kết quả, ghi kế hoạch chờ vào file. Giữ chuẩn đó.
- Việc dựng lại slot doanh thu đã có **script một-lệnh fail-closed**
  (`server/scripts/rebuild_t08_slot_safely.sh`) để khi bot kẹt, BẤT KỲ ai có
  terminal trên server cũng chạy nghiệm thu được — không phụ thuộc một mình bot.

## Ghi chú cho việc V-D (lịch chạy)

Tool `cron` của OpenClaw nằm trong `deny` của reportdev — **không liên quan** đến
crontab hệ thống của server. Cài lịch `run_due_jobs.js` bằng `crontab` qua `exec`
như thường; bot không được viện cớ "cron bị cấm" để báo blocked.
