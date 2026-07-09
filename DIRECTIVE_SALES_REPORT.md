# DIRECTIVE — Báo cáo Điểm doanh thu & Xu tích lũy (tuần/tháng) per NV + CEO

> Claude Code giao (CEO **đã duyệt 2 bản mẫu 2026-07-09**). Bot triển khai code app + gắn lịch trên server
> (có dữ liệu thật + `vat.db`). Claude review. Đọc kèm `SPEC_DIEM_XU_TICH_LUY.md` (đầy đủ công thức, khung,
> phân tích thông minh A–I) và 2 **template chuẩn đã duyệt** ở `reference/diemxu_templates/`.

## 0) TÓM TẮT — làm gì
Dựng **`server/src/salesReport.js`**: sinh email HTML **báo cáo TUẦN + THÁNG cho từng NV** và **bản CEO tổng
hợp**, render dữ liệu LIVE (không hardcode số như bản mẫu), rồi **gắn lịch tự động** gửi Telegram + email.
Bản mẫu DN001 đã duyệt là **BỐ CỤC CHUẨN** — chỉ thay số/bảng bằng dữ liệu thật, GIỮ nguyên cấu trúc, theme
xanh lá DONAPHARM, logo `cid:logo_dona` trái, QR `cid:qr_zalo` phải.

## 1) Template chuẩn đã duyệt (BÁM SÁT — không đổi layout)
- `reference/diemxu_templates/APPROVED_tuan_DN001.html` — layout TUẦN, 9 mục.
- `reference/diemxu_templates/APPROVED_thang_DN001.html` — layout THÁNG, 9 mục.
- Hai điểm CEO chốt (ĐÃ nằm trong template, **giữ nguyên**):
  1. **KHÔNG đưa số dư/thiếu xu TOÀN CÔNG TY vào bản NV** (đã bỏ câu "toàn công ty đang dư xu"). Bản NV chỉ
     nói trạng thái xu của **riêng NV đó**.
  2. **Cả TUẦN và THÁNG đều có mục 9 "🧠 Phân tích thông minh & Định hướng"** (A–I).
  3. Phần Nguồn dữ liệu có dòng **"Xu chỉ tính theo QUÝ — sang quý mới tự reset về 0, không chuyển tiếp"**.

## 2) Dữ liệu — TÁI DÙNG code sẵn có (chỉ điểm/xu là mới)
Tất cả scope theo **1 emp_code** (bản NV) → truyền `scope={emp:[code]}` hoặc filter emp.
- **Doanh thu / tuyến CL-NCL-NT / top đơn vị / top mặt hàng / theo ngày / so cùng kỳ tháng trước:**
  `analytics.js` → `overviewKpis`, `revenueBreakdown({dimension})`, `applyFilters`; so kỳ dùng `store.comparePeriods`.
  Doanh thu theo ngày: gom `store.getRowsRange` theo `r.date`.
- **Điểm & Xu:** `server/src/diemXu.js` (ĐÃ BUILD, đã kiểm chứng công thức):
  - `scoreForEmp({empCode, weekRange, monthRange, quarterRange})` → `{diem_thang, diem_quy, xu_tuan, xu_thang,
    xu_quy, thieu_xu, du_xu, ty_le_quy, canh_bao}`. **xu theo quý, KHÔNG carry** (`xu_du_quy_truoc=0`).
  - Điểm: `pointsByEmpRange({from,to,empCode})`; Xu: `readVatXu({from,to,empCode})` (node:sqlite, `vat_bills`,
    lọc `hidden_at` rỗng, **chưa khoá `trang_thai_hd`**).
- **Dự báo cuối tháng (mục H):** `analytics.targetPacingMeta(ky)` cho ngày đã trôi/ngày trong tháng →
  `dự báo = doanh thu tới nay / (ngàyĐãTrôi / ngàyTrongTháng)`.
- **Khuyến nghị khai thác (mục I):** `analytics.cstTable` (cơ số thầu còn dư) cho mã QLNB còn khai thác tại
  đơn vị NV; đơn vị khối **CL** còn quota (điểm ×2); nhấn **NCL dư địa vô hạn** (không phụ thuộc cơ số thầu).
  Nếu chưa nối được CST theo NV, để câu "đang nối nguồn Cơ số thầu" như template (đừng bịa số).

## 2-BIS) ‼ AI ĐƯỢC NHẬN BÁO CÁO DOANH SỐ (CEO chốt 2026-07-09) — CHỐT CỨNG
- **CHỈ gửi báo cáo doanh số tuần/tháng cho NV PHÒNG KINH DOANH.** Nhân viên **VĂN PHÒNG / telesale KHÔNG nhận.**
- **Danh sách người nhận = `store.targetRosterCodes()`** (allowlist phòng KD CEO chốt trong
  `server/data/target_roster.json` / cờ `has_target`). Hàm này **cố tình không suy luận theo role** để tránh
  lẫn văn phòng/telesale — dùng ĐÚNG hàm này, **KHÔNG** tự quét theo `nv_emails.json` hay `users.json`.
- **`nv_emails.json` CHỈ là SỔ ĐỊA CHỈ** (mã → email), **KHÔNG phải danh sách người nhận.** Có email văn phòng
  trong sổ ≠ họ nhận báo cáo. Người nhận do `targetRoster` quyết, email chỉ để tra địa chỉ khi đã là người nhận.
- Trình tự chọn người nhận trong `salesReport.js`:
  `targetRosterCodes()` → **bỏ 5 NV loại trừ** (mục 3) → ai có email/telegram thì gửi, ai thiếu kênh thì **skip**
  (log lại, không lỗi). Bản CEO tổng hợp gửi riêng cho tài khoản quản trị (`CEO`).

## 3) ‼ LOẠI TRỪ — TUYỆT ĐỐI (CEO chốt)
`diemXu.EXCLUDE = {DN021, DN022, DN023, VP004, VP018}` — **không tính điểm/xu, không gửi báo cáo** cho 5 NV này.
Đã hiện thực trong `diemXu.js`; salesReport phải lọc danh sách NV gửi theo cùng tập này.

## 4) Mốc tính kỳ (CEO chốt)
- **TUẦN:** tính vào **Thứ 7**, lũy kế từ đầu tháng đến hết Thứ 7 đó (ảnh chụp tiến độ). `weekRange`,
  `monthRange` (đầu tháng→Thứ 7), `quarterRange` (đầu quý→Thứ 7).
- **THÁNG:** tính vào **ngày cuối tháng**, lũy kế cả tháng + cả quý đến hết ngày đó.
- So sánh: **cùng kỳ THÁNG TRƯỚC** (tuần T-này so tuần tương ứng T-trước; tháng so tháng liền trước).

## 5) Bản CEO tổng hợp
Toàn đội: tổng điểm/xu/tỷ lệ + bảng per-NV (sắp **tỷ lệ tăng dần**, người thiếu lên đầu) + phân tích gọn
(số NV cảnh báo <90%, ai cần nhắc). Có thể tái dùng khung `targetNotify.ceoDigestHtml`. **KHÔNG** gửi bản
chi tiết từng NV cho CEO — chỉ bản tổng hợp.

## 6) Lịch gửi + kênh
- **Tuần:** Thứ 7 **13h00** VN. **Tháng:** chạy daily **18h30**, chỉ gửi nếu **là ngày cuối tháng**.
- Gửi qua `notifyChannels.deliver({telegramId, email, subject, text, html})` — CID logo/QR đính như email
  target (xem `targetNotify` + `notifyChannels`). Telegram: bản text gọn (điểm/xu/tỷ lệ + 3 việc ưu tiên).
- Worker: gắn vào tiến trình `reportnew-tgbot` (hoặc cron riêng). Múi giờ **Asia/Bangkok**.
- **Danh sách gửi target cũ (DN021/DN023/VP004) KHÔNG liên quan** — báo cáo điểm/xu dùng tập loại trừ ở (3).

## 7) Nghiệm thu
1. `node --check server/src/salesReport.js` OK; build web OK.
2. Chạy **bản mẫu THẬT DN001 trên server** (số live tuần + tháng) → xuất HTML → **gửi CEO duyệt lần cuối**
   TRƯỚC khi bật gửi cả đội.
3. Kiểm: 5 NV loại trừ không có trong output; xu quý không carry; số điểm khớp `diemXu`; logo/QR hiển thị.
4. Ghi `CHANGELOG.md`. Commit + **push** (đừng để local — bị `git reset --hard` xoá).

## 8) Nhắc phối hợp
- **`git pull origin main` / `git fetch && git log origin/main -1`** TRƯỚC khi làm để có directive + `diemXu.js`
  + template mới nhất Claude push.
- Không bịa số trong mục phân tích: số nào chưa có nguồn (cross-sell đội, cơ số CST theo NV) thì để câu
  "đang nối nguồn/đang tính" như template, KHÔNG chế số.

## 9) VẬN HÀNH ENV/EMAIL (ghi nhớ 2026-07-09)
- **Project KHÔNG cài `dotenv`.** App tự nạp `.env` (gốc repo) qua hàm `loadEnv` trong `server/src/index.js`,
  **chỉ chạy lúc process boot** + **không ghi đè biến sẵn có**. → Sửa `.env` xong PHẢI `pm2 restart` mới có hiệu lực.
  Chạy tay: đừng `require('dotenv')` (lỗi thiếu package) — load bằng shell (`set -a; . ./.env; set +a`) rồi mới `node`.
- Email: cần đủ (1) SMTP env (`SMTP_HOST/USER/PASS`, App Password Gmail) → **restart** để process nạp;
  (2) `server/data/nv_emails.json` map mã tài khoản → email (gitignored, tạo trên server) — email CEO gắn
  **mã tài khoản quản trị**, không phải DN001; (3) `TARGET_NOTIFY=1` để app **tự** gửi mốc target.
- **ĐÃ THÔNG SMTP (2026-07-09):** gửi thử `{ok:true}`. Còn lại: nv_emails.json đầy đủ + restart process reportnew
  (để "Gửi thử" trong app & lịch salesReport dùng được SMTP, không chỉ chạy shell) + bật TARGET_NOTIFY nếu muốn tự gửi.
- **Digest CEO** hiện chỉ gửi cho admin **đã link Telegram** (`listTelegramMap`). Nếu CEO chỉ muốn email:
  salesReport phải gửi digest CEO theo email tài khoản quản trị (qua `nv_emails.json`), đừng phụ thuộc telegram map.
