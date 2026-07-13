# SPEC — Báo cáo doanh số CHUYÊN SÂU (deck 32 trang) tuần/tháng → HTML + PPTX → email + Telegram

> Claude Code (kiến trúc) giao bot triển khai. CEO 2026-07-13 gửi **mẫu chuẩn**
> `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` (+ bản `.pptx` 14MB trong upload) và yêu cầu:
> *"làm báo cáo doanh thu bán hàng chi tiết theo tuần/theo tháng và gửi vào email/telegram cả hai định dạng
> PowerPoint và HTML. Anh sẽ gửi mẫu để làm theo."*
>
> Đây là **loại báo cáo MỚI, toàn công ty (CEO scope)** — KHÁC với báo cáo email per-NV hiện có trong
> `server/src/salesReport.js` (giữ nguyên, không đụng). Nguyên tắc bất di bất dịch #3 vẫn tối thượng:
> **mọi con số do `analytics.js`/`diemXu.js`/helper tính — LLM (nếu bật) chỉ diễn giải trên FACTS, cấm chế số.**

## 0. Mẫu chuẩn = nguồn sự thật hình ảnh
- File: `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` (đã commit, 32 slide 16:9, nền navy #071F47,
  nhấn vàng #F5C242, CSS biến `--fs-*` đồng cỡ chữ). Bot **bám đúng bố cục/màu/typography** file này.
- Deck = nhiều `<div class="slide">` tuyệt đối căn giữa `min(100vw,100vh*16/9) × min(100vh,100vw*9/16)`, chỉ slide
  `.active` hiện; có điều hướng ‹/›. Header `.hd` (logo trắng + kicker vàng + tiêu đề + QR), footer `.ft`.
- Bot **tách CSS + skeleton** của mẫu thành template dùng lại (vd `server/src/report/deckTemplate.js` hoặc
  `.html` + slot), **KHÔNG hardcode số Tuần 26** — mọi số đổ từ data runtime.

## 1. Vị trí code (đề xuất — bot tự cân chỉnh)
```
server/src/report/
  deckData.js      # gom toàn bộ FACTS cho 1 kỳ (week|month) ở CEO scope -> object thuần số
  deckHtml.js      # render 32 slide HTML từ deckData (bám CSS mẫu)
  deckPptx.js      # HTML slide -> ảnh (Playwright) -> pptxgenjs 16:9 full-bleed
  deckDeliver.js   # đính kèm .html + .pptx, gửi email + Telegram (document)
  deckReport.js    # orchestrator: build(kind,ranges) -> {data, htmlPath, pptxPath}; sendCeo()
```
Tái dùng tối đa helper đã có trong `salesReport.js` (đừng chép cứng — export/pull sang `report/` hoặc require):
`defaultRanges`, `comparisonMeta`, `rowsInRange`, `groupRows`, `routeBreakdown`, `dailyBars`, `diffTop`,
`periodKysBetween` và `diemXu.scoreForEmp / pointsByEmpRange / readVatXu`.

## 2. Ánh xạ 32 slide → NGUỒN SỐ (grounded). "có sẵn" = helper/analytics đã tính; "cần map" = bảng tra thêm.
| Slide | Nội dung | Nguồn số | Ghi chú |
|---|---|---|---|
| 1 | Bìa (kỳ, ngày chốt, logo/QR) | `ranges`, `latestDataDate()` | tĩnh + tham số |
| 2–3 | Doanh nghiệp · Nguồn dữ liệu & phương pháp | text cố định | **giữ disclaimer**: số nội bộ, KHÔNG giá vốn/lợi nhuận; "Xu tính theo QUÝ" |
| 4 | Tóm tắt điều hành (Hứa hẹn/Rủi ro/Cơ hội) | suy từ FACTS ngưỡng (§4) | narrative theo rule/LLM-grounded |
| 5 | Tổng DT kỳ vs kỳ trước + chỉ số kỳ | `sum(rows)`, `comparisonMeta`, `prevRevenue` | **kỳ làm việc thực tế** (bám nhãn mẫu) |
| 6 | DT theo ngày (triệu đồng) | `dailyBars(rows)` | cột/ngày |
| 7 | Biến động chi tiết theo hạng mục | `diffTop` các chiều | bảng ▲/▼ |
| 8–9 | So sánh & đào sâu tuyến CL·NCL·NT | `routeBreakdown` | **cần map** `route`→CL/NCL/NT (§3.1) |
| 10 | Theo nguồn hàng Group-Dona vs Đối tác | `groupRows` theo nguồn | **cần map** `contractor_code`→nhóm nguồn (§3.2) |
| 11 | Nhóm DT cao theo tuyến | `routeBreakdown` | dùng lại §3.1 |
| 12 | Theo loại KH (BVĐK·TTYT·PKĐK) | `groupRows` theo loại KH | **cần map** `unit`→loại (§3.3) |
| 13 | Theo nhóm điều trị | `groupRows` theo nhóm SP | **cần map** `iit_code`→nhóm (§3.4, `catalog.json`) |
| 14–15 | Group-Dona chi tiết · nhóm đối tác | §3.2 + `comparisonMeta` | cơ cấu theo tuyến |
| 16–19 | Nhân viên: phân tầng, xếp hạng, kéo lên/xuống, DT cao–xu thấp | `groupRows(emp)`, `diffTop(emp)`, `diemXu.scoreForEmp` | loại `diemXu.EXCLUDE` |
| 20–22 | Đơn vị: top, tăng/giảm, dư địa hạng giữa | `groupRows(unit)`, `diffTop(unit)` | hạng 5–12 = slice |
| 23–25 | Sản phẩm: top & cơ cấu, tăng/giảm/mới, định hướng | `groupRows(iit)`, `diffTop(iit)` | "mới" = có kỳ này, kỳ trước 0 |
| 26–28 | Điểm DT & tích xu Quý 2 (tổng, theo tuyến, cảnh báo) | `diemXu.scoreForEmp` (quarterRange) | **giữ**: xu theo quý, không carry |
| 29 | Rủi ro & Cơ hội tổng hợp | tổng hợp §4 | |
| 30 | Khuyến nghị hành động cụ thể | §4 | trình BGĐ |
| 31 | Kết luận điều hành cho CEO | §4 | |
| 32 | Bìa cuối/liên hệ | tĩnh | |

> **Cấm bịa:** slide narrative (4, 29–31, "nhận định"/"định hướng") KHÔNG được chứa con số nào không rút từ
> `deckData`. Nếu bật LLM: truyền FACTS đã tính (object số + nhãn) → LLM viết lời, **không** đưa dòng thô,
> **không** cho LLM tạo số mới. Nếu chưa có key → dùng câu mẫu theo ngưỡng (rule-based) trong §4.

## 3. Bảng tra cần bổ sung (đặt trong `catalog.json` / file map riêng, KHÔNG hardcode trong bundle FE)
Dữ liệu mẫu ẩn danh hiện có: `route ∈ {Tuyến A..D}`, `contractor_code ∈ {NCC01..03}`, `unit_code ∈ {BV*,NT*,PK*}`,
`iit_code`. Live sẽ khác → map phải **dữ liệu-hóa**, không cứng trong code.
1. **§3.1 route→tuyến chuẩn CL/NCL/NT:** thêm field `line` (CL|NCL|NT) vào `catalog.units`, hoặc map
   `route→line`. Thiếu map → hiện nhãn route gốc (đừng bịa CL/NCL/NT).
2. **§3.2 nguồn hàng:** map `contractor_code`→`{group:'Group-Dona'|'Đối tác', name}` (Group-Dona = Donapharm+AFP
   Pharma). Bảng nằm ở data, bot điền theo live.
3. **§3.3 loại KH:** suy từ tiền tố/loại đơn vị (BV→BVĐK, TT/TTYT→TTYT, PK/PKĐK→PKĐK, NT→Nhà thuốc). Ưu tiên
   field tường minh trong `catalog.units` nếu có.
4. **§3.4 nhóm điều trị:** thêm `group`/`therapy` cho sản phẩm trong `catalog` (tra theo `iit_code`). Thiếu →
   gộp "Chưa phân nhóm".

## 4. Narrative theo NGƯỠNG (rule-based mặc định, LLM chỉ diễn giải)
- **Hứa hẹn:** đơn vị/SP/NV tăng mạnh nhất (`diffTop.up`), tuyến/nguồn tăng tỷ trọng.
- **Rủi ro:** `diffTop.down` (đơn vị "ngủ": kỳ trước >0, kỳ này =0); NV/đơn vị `ty_le_quy < 90` (`canh_bao`).
- **Cơ hội:** nhóm hạng giữa 5–12 (dư địa), tuyến NCL (không bị cơ số thầu chặn), SP mới nổi.
- Mọi câu chèn số phải lấy từ `deckData` (vd `fmtMoney(x.diff)`), không tự nghĩ %.

## 5. PPTX (thêm dep `pptxgenjs`)
- Cách chuẩn (khớp mẫu 14MB = ảnh full slide): render từng slide HTML bằng **Playwright** (đã cài sẵn ở môi
  trường, `executablePath: '/opt/pw-browsers/chromium'`, viewport 1280×720) → screenshot PNG mỗi slide →
  `pptxgenjs` layout `LAYOUT_16x9`, mỗi slide 1 ảnh full-bleed `x:0,y:0,w:'100%',h:'100%'`.
- Ưu điểm: PPTX **trông y hệt** HTML, không phải dựng lại chart trong PPTX. Nhược: file lớn (chấp nhận, giống mẫu).
- Fallback nếu Playwright fail: xuất PDF (Chromium print) đính kèm thay PPTX + log cảnh báo; KHÔNG chặn email HTML.
- Đặt tên: `BAO_CAO_DOANH_SO_{TUAN_WW|THANG_MM}_{YYYY}_DONAPHARM.{html,pptx}` vào `artifacts/sales-report/`.

## 6. Giao nhận (email + Telegram)
- **Email:** mở rộng `notifyChannels.sendEmail(to,subject,text,html,attachments=[])` để nhận `attachments`
  (nodemailer: `[{filename, path}]` cho .html + .pptx). Body email = tóm tắt ngắn + ghi "xem file đính kèm".
- **Telegram:** thêm `notifyChannels.sendDocument(chatId, filePath, caption)` gọi `sendDocument` (multipart
  `FormData`) — hiện chỉ có `sendMessage`, **đây là điểm thiếu bắt buộc bổ sung**. Gửi cả .pptx và .html.
- **Người nhận:** mặc định CEO (`ceoRecipient()`), có cờ mở rộng danh sách sau khi CEO duyệt. Tôn trọng
  `diemXu.EXCLUDE`. **Quyền & phạm vi số vẫn quyết ở backend** (deck = toàn công ty ⇒ chỉ CEO/ADMIN được nhận
  bản đầy đủ; KHÔNG gửi bản toàn-công-ty cho NV sale).
- **Chống gửi trùng:** dùng cơ chế `alreadySent/markSent` sẵn trong `salesReport.js` với key riêng
  `deck:<kind>:<period>`.

## 7. Kích hoạt
- CLI trước (để CEO duyệt): `node server/src/report/deckReport.js --kind=week|month --send=ceo` (mặc định chỉ
  ghi file, `--send` mới gửi). Route admin `POST /api/report/deck/preview` (CEO-only) trả link file.
- Lịch tự động: **tắt mặc định**, chỉ bật sau khi CEO duyệt mẫu (tuần: sáng Thứ 2; tháng: ngày 01). Tái dùng
  scheduler kiểu `targetNotify`/`revenueRefresh` (ghi state để restart không lặp).

## 8. Nghiệm thu (bắt buộc trước khi push main)
1. `node -e "require('./server/src/report/deckData')"` OK; build deck kỳ hiện tại **không lỗi**, 32 slide.
2. Mở HTML sinh ra: bố cục/màu **khớp mẫu**, không tràn ngang; số ở slide 5/6/8/10/16/20/23/26 **khớp**
   `analytics`/`diemXu` (đối chiếu tay 1 kỳ live).
3. PPTX mở được trong PowerPoint/Google Slides, 32 slide, ảnh nét 16:9.
4. Gửi thử tới **email + Telegram CEO**: nhận đủ 2 file; caption đúng kỳ.
5. Kiểm **grounding**: grep narrative không có số lạ ngoài `deckData`; LLM tắt vẫn ra bản rule-based hợp lệ.
6. Ghi `CHANGELOG.md`; commit; push main; báo Claude review. (Claude giữ nhánh `claude/new-session-eifd44`.)

## 9. Ranh giới (để không đụng repo bot / không vỡ nguyên tắc)
- KHÔNG sửa `salesReport.js` render per-NV hiện có (khác loại báo cáo). Chỉ **export/tách helper** nếu cần.
- KHÔNG hardcode PII/nhân viên/số Tuần-26 trong template hay FE bundle (nguyên tắc #2).
- Export/gửi **đi qua backend + kiểm quyền** (nguyên tắc #4). Deck toàn công ty ⇒ CEO/ADMIN.
- Không để LLM chế số (nguyên tắc #3).
