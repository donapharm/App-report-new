# DIRECTIVE — Bot Telegram hiểu câu hỏi tự nhiên (nối "Hỏi nhanh" AI)

> Claude Code giao (CEO yêu cầu 2026-07-03). Bot triển khai; Claude review. Không đụng app cũ 3860.

## Mục tiêu
Trong con bot login (`@DonaLoginReport_bot`), khi user gõ **câu tự nhiên** (VD "doanh thu tháng 6?", "top sản phẩm", "tôi đạt bao nhiêu % target?") → bot **trả lời bằng số thật** thay vì câu "gửi mã".

## Cách làm (tái dùng cái đã có, KHÔNG viết AI mới)
- App đã có `smart.answerQuestion({ text, scope, session })` (CODE-FIRST, số do `analytics/smart` tính, LLM chỉ diễn giải grounded — không bịa) + endpoint `/api/ai/ask`.
- Trong `telegram-bot.js` `handleUpdate`, nhánh fallback hiện trả "Gửi mã đăng nhập…":
  1. Nếu text **khớp mã RP** hoặc **lệnh** (`/start /digest_test /tat /bat`) → xử như cũ.
  2. **Nếu KHÔNG** và người gửi **đã map telegram_id → emp_code** (`auth.resolveTelegram`) → gọi `answerQuestion`/`/api/ai/ask` **với scope của chính họ** → trả lời.
  3. Nếu **CHƯA map** → giữ hướng dẫn đăng nhập (không trả lời dữ liệu cho người lạ).

## ‼ BẢO MẬT (bắt buộc)
- **Scope theo đúng người hỏi:** CEO/admin → toàn công ty; NV/CTV sale → **CHỈ dữ liệu của mình**. Lấy scope từ mapping telegram_id → emp_code → `auth.scopeOf`, KHÔNG để hỏi lộ dữ liệu người khác. (Giống hệt phân quyền trên web.)
- **Chỉ user ĐÃ MAP mới được hỏi.** Người chưa map → không trả số, chỉ hướng dẫn đăng nhập.
- **Không bịa số:** giữ nguyên nguyên tắc code-first; nếu không chắc → trả gợi ý mẫu câu hỏi, không chế số.
- 4 CTV ngoài (DN021/022/023/VP004): Q&A là **pull (họ tự hỏi phần mình)** → cho phép theo scope (nhất quán "pull OK"). Guardrail `no_auto_notify` chỉ chặn **push chủ động**, không chặn họ tự hỏi dữ liệu của mình. Nếu CEO muốn chặn cả Q&A cho nhóm này → báo, sẽ thêm cờ.

## Trải nghiệm
- Trả lời gọn (text Telegram), có thể kèm vài dòng top. Câu không rõ → gợi ý mẫu: "Doanh thu kỳ này?", "Top sản phẩm/đơn vị", "Tôi đạt bao nhiêu % target?", "Cơ số thầu của tôi sắp cạn?".
- Có thể thêm gợi ý phím (reply keyboard) vài câu hay hỏi.

## Nghiệm thu
- CEO hỏi "doanh thu tháng 6" trong Telegram → ra số toàn công ty đúng (khớp app).
- 1 NV sale hỏi → chỉ ra số của mình; hỏi về người khác → không lộ (chỉ phạm vi mình).
- Người chưa map hỏi → không ra số, chỉ hướng dẫn đăng nhập.
- Số khớp app (code-first), không bịa; `/start /digest_test /tat /bat` + đăng nhập RP vẫn chạy như cũ.
