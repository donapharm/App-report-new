# DIRECTIVE — GIAO BOT: triển khai NGAY báo cáo CHUYÊN SÂU (deck 32 trang) HTML+PPTX → email+Telegram

> Claude Code giao (CEO 2026-07-13 **đã đồng ý bot cầm code app**). Đọc kèm `SPEC_REPORT_DECK_CHUYENSAU.md`
> (chi tiết từng slide + nguồn số). File này = **thứ tự làm + lệnh nghiệm thu**. Bot triển khai, Claude review.

## 0. TRƯỚC KHI CODE (bắt buộc)
- **`git pull origin main`** (hoặc `git fetch && git reset --hard origin/main`) để có bản mới nhất.
- Spec + mẫu chuẩn + directive này đang ở nhánh **`claude/new-session-eifd44`** — **merge nhánh này vào main
  trước** (hoặc `git checkout origin/claude/new-session-eifd44 -- SPEC_REPORT_DECK_CHUYENSAU.md docs/report-samples/ DIRECTIVE_REPORT_DECK_KICKOFF.md`)
  rồi mới bắt đầu, để không code trên bản thiếu file.
- Mở mẫu: `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` (32 slide, navy #071F47 + vàng #F5C242).

## 1. THỨ TỰ TRIỂN KHAI (làm theo pha, mỗi pha xong tự test rồi mới sang pha sau)

**Pha 1 — `deckData.js` (FACTS, không render).** Gom toàn bộ số cho 1 kỳ ở **CEO scope** thành object thuần:
- Tổng DT kỳ + kỳ trước (`comparisonMeta`), DT theo ngày (`dailyBars`), tuyến (`routeBreakdown`),
  nguồn hàng, loại KH, nhóm điều trị (theo 4 bảng tra §3 của spec), top/tăng-giảm NV·đơn vị·SP (`groupRows`,
  `diffTop`), điểm+xu quý (`diemXu.scoreForEmp` với quarterRange), loại `diemXu.EXCLUDE`.
- **Test pha 1:** `node -e "require('./server/src/report/deckData').build({kind:'week'}).then(d=>console.log(Object.keys(d), d.totalRevenue))"` — ra số, không lỗi. Đối chiếu tay tổng DT với `analytics`/NLQ 1 kỳ live.

**Pha 2 — `deckHtml.js` (render 32 slide).** Tách CSS + skeleton từ mẫu thành template dùng lại, đổ số từ
`deckData`. **KHÔNG hardcode số Tuần 26.** Slide narrative (4, 29–31) dùng câu theo ngưỡng §4 spec (LLM tắt vẫn chạy).
- **Test pha 2:** sinh file HTML kỳ hiện tại, mở mắt: đủ 32 slide, bố cục/màu khớp mẫu, không tràn ngang;
  số slide 5/6/8/10/16/20/23/26 khớp `deckData`.

**Pha 3 — `deckPptx.js` (PPTX).** `npm i pptxgenjs`. Playwright (có sẵn, `executablePath:'/opt/pw-browsers/chromium'`,
viewport 1280×720) chụp từng slide HTML → PNG → `pptxgenjs` `LAYOUT_16x9`, mỗi slide 1 ảnh full-bleed.
Fallback PDF nếu Playwright fail (log cảnh báo, không chặn HTML).
- **Test pha 3:** mở PPTX trong PowerPoint/Google Slides — 32 slide, ảnh nét 16:9.

**Pha 4 — giao nhận.** Mở rộng `notifyChannels`:
- `sendEmail(...attachments)` đính `.html`+`.pptx` (nodemailer `[{filename,path}]`).
- **Thêm `sendDocument(chatId, filePath, caption)`** gọi Telegram `sendDocument` (multipart) — **hiện thiếu**,
  bắt buộc bổ sung; gửi cả 2 file.
- Người nhận mặc định **CEO** (`ceoRecipient()`); deck toàn công ty ⇒ **chỉ CEO/ADMIN**, không gửi NV sale.
- Chống trùng: `alreadySent/markSent` key `deck:<kind>:<period>`.
- **Test pha 4:** gửi thử email+Telegram CEO, nhận đủ 2 file, caption đúng kỳ.

**Pha 5 — kích hoạt + LỊCH GỬI CEO.** CLI `node server/src/report/deckReport.js --kind=week|month [--send=ceo]`
(mặc định chỉ ghi file). Route admin `POST /api/report/deck/preview` (CEO-only).
- **Mẫu này = báo cáo HÀNG TUẦN + HÀNG THÁNG** gửi CEO. Lịch chốt (CEO 2026-07-13):
  - **TUẦN:** gửi **13h00 Thứ 7 hằng tuần** (kỳ = tuần vừa qua).
  - **THÁNG:** gửi **18h00 ngày cuối tháng** (kỳ = tháng đó). Ngày cuối tháng động (28/29/30/31).
  - Múi giờ `Asia/Ho_Chi_Minh`. Scheduler kiểu `targetNotify`/`revenueRefresh`, ghi state để restart không lặp;
    dùng khóa chống trùng `deck:<kind>:<period>`.
- **‼ CHẾ ĐỘ DRAFT DUYỆT TRƯỚC (bắt buộc):** các đợt đầu KHÔNG gửi thẳng như bản chính thức. Bot **dựng bản
  DRAFT** (HTML+PPTX) rồi **gửi lại CEO duyệt** (email/Telegram CEO, tiêu đề/caption ghi rõ `[DRAFT — CHỜ CEO
  DUYỆT]`). Chỉ sau khi CEO OK mới coi là bản chính thức và để lịch chạy đều. Không tự ý gửi cho ai ngoài CEO.

## 1b. ‼ ĐỐI TƯỢNG & CHUẨN CHẤT LƯỢNG (CEO nhấn 2026-07-13)
- **CHỈ gửi CHO MỖI CEO** — **KHÔNG gửi nhân viên**. Đây là báo cáo để **CEO trình chiếu trên màn hình LED**
  cho toàn thể nhân viên xem. (Vì thế người nhận = CEO duy nhất; deck toàn công ty, không phân mảnh theo NV.)
- Vì trình chiếu LED trước toàn công ty ⇒ chuẩn **CAO CẤP**:
  - **Độ chính xác tuyệt đối:** mọi số phải khớp `analytics`/`diemXu` (đối chiếu tay trước khi gửi); sai 1 số là
    mất uy tín trước toàn thể NV. Cấm số bịa (nguyên tắc #3).
  - **Tinh xảo & thẩm mỹ:** bám đúng hệ màu/typography mẫu (navy #071F47 + vàng #F5C242, biến `--fs-*`), canh
    lề/khoảng cách đều, chữ đủ lớn để đọc từ xa trên LED, không tràn/không vỡ layout ở 16:9.
  - **Thông minh:** narrative (slide 4, 29–31) sắc, đúng trọng tâm điều hành (hứa hẹn/rủi ro/cơ hội, hành động
    cụ thể) — diễn giải trên FACTS, không sáo rỗng.

## 2. GIỮ NGUYÊN TẮC (Claude sẽ soi khi review)
1. Số do backend tính; **LLM cấm chế số** — chỉ diễn giải FACTS đã có (nguyên tắc #3).
2. **Không hardcode PII/nhân viên/số Tuần-26** trong template/bundle (#2).
3. Gửi/export **qua backend + kiểm quyền**; deck toàn công ty ⇒ CEO/ADMIN (#4).
4. **KHÔNG sửa render per-NV trong `salesReport.js`** — chỉ export/tách helper nếu cần.

## 3. NGHIỆM THU CUỐI + BÀN GIAO
- Chạy đủ test 5 pha ở trên (dán kết quả live 1 kỳ thật).
- `node -e "require('./server/src/report/deckReport')"` OK; grep narrative không có số lạ ngoài `deckData`.
- Ghi `CHANGELOG.md`; commit + push **main**; restart service liên quan nếu có.
- **Gửi bản DRAFT (tuần + tháng) tới email+Telegram CEO để duyệt** (tiêu đề/caption `[DRAFT — CHỜ CEO DUYỆT]`)
  trước khi để lịch 13h00 Thứ 7 / 18h00 ngày cuối tháng chạy chính thức.
- Báo Claude review (Claude giữ nhánh `claude/new-session-eifd44`).
