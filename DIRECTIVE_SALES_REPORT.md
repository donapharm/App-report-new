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

## 8-BIS) ‼ THƯƠNG HIỆU: viết "DONAPHARM" — KHÔNG "DNPHARMA" (CEO chốt 2026-07-09)
- Mọi chữ hiển thị (email + web + Telegram) ghi **"DONAPHARM"**, không phải "DNPHARMA".
- **Claude đã sửa text code** (targetNotify.js, notifyChannels.js, routes.js, web/src). **Bot còn phải đổi ENV
  `SMTP_FROM`** trong `.env` → `SMTP_FROM="DONAPHARM App Report <...>"` rồi `pm2 restart reportnew --update-env`
  (tên người gửi hiện đang là "DNPHARMA App Report" do env cũ). Tên file ảnh/cid (`logo-dnpharma.png`, cid
  `dnpharma-logo`) giữ nguyên — không ảnh hưởng hiển thị.
- **Ảnh logo — GIỮ NGUYÊN "DNPHARMA" (CEO chốt 2026-07-09):** cụm chữ trong logo là "DNPHARMA" — đó là
  **cấu trúc logo đúng/biểu tượng thương hiệu**, KHÔNG thay. Chỉ **chữ text** trong email/web ghi "DONAPHARM".
  → Bot **không** đổi file logo, không thay `logo-dnpharma.png`.

## 8-TER) MỤC I — CƠ SỐ THẦU (CST): NỐI API APP SALE (CEO chốt 2026-07-09, KHÔNG để placeholder)
- CEO xác nhận **cơ số thầu ĐÃ CÓ bên App Sale** → **bot nối API/nguồn App Sale**, không để "đang nối nguồn".
- App Report đã có khung CST (`store.getCst`, `analytics.cstTable`, `cst_rows.json` — hiện là **dữ liệu mẫu**).
  → Bot: (1) điều tra App Sale expose cơ số thầu qua **API endpoint hay bảng DB** nào (mã QLNB · đơn vị · cơ số
  được duyệt · đã dùng · **còn lại**); (2) nối vào App Report (materialize/API) thay dữ liệu mẫu; (3) mục I của
  báo cáo liệt kê **mã QLNB còn dư cơ số tại đơn vị NV phụ trách** (mã + đơn vị + số còn lại, ưu tiên còn nhiều).
- Trước khi code mục I: bot báo lại **App Sale lấy CST ở đâu, cột gì** để Claude review mapping (giống cách đã
  làm với `vat.db`). Nếu vì lý do kỹ thuật chưa nối kịp thì mới tạm placeholder — nhưng **ưu tiên nối thật**.

## 8-QUATER) MAPPING CST ĐÃ DUYỆT (Claude review 2026-07-09) — nguồn App Sale
**Nguồn:** `GET /api/reports/tender-quota` (bảng `cst_quota`, key `ma_qlnb × ma_dv × ky_thau`).
**KHÔNG dùng** `/api/reports/contract-tracking` (FIFO/MISA phức tạp, thừa nhu cầu).

**Quy tắc bắt buộc khi nối:**
1. **Còn lại = dùng thẳng `slConLai` API trả — KHÔNG tự tính lại** (để App Report ↔ App Sale cùng một số,
   tránh đá nhau như vụ đối soát). Các field `cstFormula` (cstChinh/cst30/trangThai30/dieuChuyen/daGiao/
   dangChoGiao) chỉ để **diễn giải hiển thị**, không dùng để tính lại còn lại.
2. **Chỉ lấy kỳ thầu đang hiệu lực** (hôm nay trong `hd_tu_ngay..hd_den_ngay` / kỳ active) — KHÔNG cộng gộp
   kỳ hết hạn.
3. **Khớp mã đơn vị:** xác nhận `unitCode`(`ma_dv`) App Sale **cùng định dạng** `unit_code` App Report
   (tiền tố 3 số, vd "025"). Chỗ dễ lệch nhất — bot xác nhận trước khi nối.

**Logic mục I (báo cáo NV):** `cst_quota` không có `emp_code` → lọc theo **đơn vị NV phụ trách**
(đơn vị NV có doanh thu/được phân công). Liệt kê mã QLNB `slConLai>0` tại các đơn vị đó, sắp giảm dần theo
còn lại; **ưu tiên/tô đậm đơn vị khối CL (điểm ×2)**. **NCL** giữ thông điệp "dư địa vô hạn" RIÊNG (không lấy
từ cst_quota vì NCL không phụ thuộc cơ số thầu).

**Bot xác nhận trước khi code mục I:** (a) `slConLai` API = còn lại chuẩn (khớp con số App Sale hiển thị)?
(b) cách chọn kỳ active + `la_ap_thau` lọc gì? (c) `unitCode` khớp `unit_code` App Report? (d) API gọi được từ
server App Report (cùng mạng + auth), real-time hay cần cache?

## 8-QUINQUIES) ‼ NGÔN NGỮ EMAIL NV: TIẾNG VIỆT NGHIỆP VỤ, GIẤU TÊN HỆ THỐNG (CEO chốt 2026-07-09)
Email gửi NV **KHÔNG được lộ tên hệ thống/kỹ thuật nội bộ**. NV đọc không hiểu + thiếu chuyên nghiệp.
- **BỎ khỏi email NV:** "App Report-New", "App VAT (vat.db)", "App Sale tender-quota", "slConLai", "la_ap_thau",
  "cstFormula", đường dẫn file (vd `cst_appsale_tender_quota.json`), `data.cstSource`, mọi tên API/bảng/cột.
- **Khung "Nguồn dữ liệu" viết lại** (mẫu): *"Số liệu doanh thu, điểm thưởng, xu tích lũy và cơ số thầu được
  tổng hợp tự động từ hệ thống nội bộ DONAPHARM. Báo cáo không chứa chi phí, giá vốn, lợi nhuận. **Xu chỉ tính
  theo QUÝ** — sang quý mới tự động về 0, không chuyển tiếp."*
- **Cuối mục 9 / cột "Vì sao":** bỏ dòng "Nguồn CST: …/…json", "loại la_ap_thau…", "dùng thẳng slConLai App Sale".
  Thay bằng câu nghiệp vụ: vd "Đã có cơ số thầu — bán chắc, ưu tiên khai thác."
- Nguyên tắc: chỉ hiển thị **con số + ý nghĩa nghiệp vụ**; mọi chi tiết kỹ thuật để trong log/CHANGELOG, không lên email.

## 10) ✅ CEO DUYỆT BẢN MẪU + GẮN LỊCH (CEO chốt 2026-07-09)
CEO **đã duyệt** bản mẫu DN001 tuần+tháng (bản `+64,7%` — đã fix so sánh theo nhịp, giấu tên hệ thống,
mục 9 D–I). Review Claude ĐẠT. → Bot dựng phần **lịch + vòng gửi**:

**A. Vòng gửi (per NV + CEO) — ‼ GỬI CẢ 2 KÊNH:**
- **BẮT BUỘC dùng `notify.deliver({telegramId, email, ...})` — KHÔNG dùng `sendEmail` đơn lẻ.** `deliver` gửi
  **email + Telegram**. Lấy `telegramId` per NV từ `auth.listTelegramMap()` (build map `tidByEmp[emp]=telegram_id`
  như `routes.js`). `sendCeoApprovalSample` hiện chỉ `sendEmail` — vòng gửi lịch phải chuyển sang `deliver`.
- Người nhận = `salesRecipients()` (= 17 NV KD, đã loại 5 NV). CEO: `renderCeoDigest` → `deliver` tới tài khoản
  quản trị `CEO` (email + Telegram).
- **‼ Telegram chỉ tới người ĐÃ LIÊN KẾT** (luật Telegram — không nhắn được người chưa Start bot). Hiện mới ~3
  người map. Ai chưa link → nhận **email** (đủ 17/17 có email nên không ai mất báo cáo); Telegram phủ dần khi NV link.
- **ĐỢT LIÊN KẾT TELEGRAM (rollout):** gửi từng NV + CEO link `https://t.me/<bot>?start=<mã_NV>` → bấm Start →
  bot map `telegram_id↔emp_code`. Mục tiêu: đủ 17 NV + CEO link để nhận Telegram. Bot xác nhận ai đã/chưa link.
- **Idempotent:** đánh dấu đã gửi theo (kỳ + kind + emp) để restart worker KHÔNG gửi trùng (giống `targetNotify.markSent`/STATE_FILE).

**B. Lịch (giờ VN Asia/Ho_Chi_Minh):**
- **TUẦN:** Thứ 7 **13ह00** — gửi bản tuần cho 17 NV + digest CEO.
- **THÁNG:** chạy daily **18h30**, CHỈ gửi nếu hôm nay là **ngày cuối tháng** — bản tháng + digest.
- Gắn vào tiến trình worker (`reportnew-tgbot`) hoặc cron riêng; log mỗi lần gửi (số gửi/skip/lỗi).

**C. TRƯỚC KHI BẬT LỊCH — chạy thử 1 lượt thật:**
- Lệnh tay gửi **cả 17 NV** (hoặc chế độ `--dry-run` in danh sách sẽ gửi + kênh) để CEO/Claude soi lần cuối:
  đúng 17 người, không lọt văn phòng, email/telegram đúng, không double-send. Rồi mới bật cron.
- (Tùy chọn) cấp `APP_SALE_AUTH_TOKEN` để CST real-time thay cache.

**D. Nghiệm thu:** `node --check` + build OK; chạy thử 1 lượt khớp; ghi CHANGELOG; commit + push; báo Claude review lịch.

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
