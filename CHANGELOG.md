### 2026-07-11 — Bot triển khai (Report Bot) — Vá UI thẻ Target trên Tổng quan
- **Deploy bản vá review `4207800` cho 3 file UI:** `web/src/charts.jsx`, `web/src/pages/Overview.jsx`, `web/src/styles.css`. Gauge target nay dùng thang 0–100 nên 44,x% lấp đúng khoảng 44% vòng, không còn góc nhỏ do thang cũ.
- **Khôi phục caption dưới vòng:** tách 2 cụm “Đã đạt” và “Mục tiêu tháng”, mỗi cụm có nhãn, số in đậm; “Đã đạt” đổi màu theo mức target (<80% đỏ đậm), “Mục tiêu tháng” xám đậm.
- **Build/deploy:** `npm --prefix web run build` OK; reload PM2 `reportnew` OK; domain public đang phục vụ asset hash mới `index-Pk5r85JG.js` / `index-Bp3OXr0t.css`.
- **Xác minh live:** trang Tổng quan T07.2026 hiển thị 44,7% (dữ liệu cập nhật 12:30 11-07), vòng lấp gần nửa; caption “Đã đạt 14.158.741.270đ” màu đỏ đậm và “Mục tiêu tháng 31.710.318.669đ” màu xám đậm, đều in đậm.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ họ mã đơn vị 034 trả hẹp
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** hint mã trần như `034`/`034*` khi khớp nhiều đơn vị khác nhãn sẽ trả cả họ mã để liệt kê, không thu về một đơn vị doanh thu cao nhất và không hỏi lại oan.
- **Giữ phân biệt cụ thể/mơ hồ:** `034.PKĐK Y ĐỨC TRẢNG BOM` vẫn ra đúng một chi nhánh; `034.PKĐK Y ĐỨC` vẫn ra riêng mã cha; `Y ĐỨC` chung chung vẫn hỏi lại; mã đơn nhất/cùng nhãn như `001` vẫn ra một đơn vị.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test live T07 6/6 PASS cho họ mã 034, mã cụ thể, mã cha, mã 001 và câu mơ hồ.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ hỏi lại vô tận đơn vị cùng tiền tố 034.PKĐK Y ĐỨC
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** ưu tiên khớp cụ thể nhất trước khi hỏi lại; nếu câu chứa nguyên mã đơn vị thì chọn mã dài/cụ thể nhất, tránh mã cha `034.PKĐK Y ĐỨC` chen vào mọi chi nhánh `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE` và gây vòng lặp hỏi lại.
- **Giữ câu mơ hồ thật:** chỉ gõ “Y ĐỨC” vẫn hỏi lại danh sách chi nhánh để NV chọn, không tự đoán.
- **Bổ sung pending-clarify trong `server/telegram-bot.js`:** nhớ câu hỏi/options 2 phút theo user; nếu NV trả lời bằng mã/tên ngắn ở lượt kế, bot map thẳng về option đã chọn rồi hỏi lại engine, không re-plan mất ngữ cảnh.
- **Test:** `node --check server/src/nlqEngine.js` OK; `node --check server/telegram-bot.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test bot thật 6/6 PASS cho `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE`, mã cha `034.PKĐK Y ĐỨC`, và câu mơ hồ “Y ĐỨC”.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ chặn oan tên đơn vị có “Công ty”
- **Sửa guard phạm vi NV trong `server/src/nlqEngine.js`:** tách `empScopeAsk` và `companyScopeAsk`; chỉ chặn khi hỏi thật sự “toàn/cả/toàn bộ công ty”, “doanh thu công ty”, “công ty mình/tôi/chúng ta” hoặc “tất cả/nv khác”. Không còn bắt nhầm chữ “CÔNG TY” trong tên pháp nhân đơn vị như “CÔNG TY TNHH/CỔ PHẦN …”.
- **Bổ sung nhận diện alias đơn vị:** bỏ tiền tố “đơn vị” trong hint và map `PKĐK` → “phòng khám đa khoa” để câu hỏi theo tên đầy đủ/viết tắt đơn vị resolve đúng.
- **Nhãn quyền rõ ràng:** các breakdown/ranking khi NV hỏi trong scope sẽ ghi “của Anh/Chị” trên tiêu đề để tránh hiểu nhầm là tổng đơn vị/toàn công ty.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= node server/scripts/test_smart_nlq_regression.js` OK; test bot thật theo directive 10/10 PASS (2 câu qua, 5 câu vẫn chặn, 3 câu cũ không vỡ).

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ Mức 3:** thêm kiến trúc 3 tầng `nlqEngine` gồm PLANNER (Claude → JSON DSL), EXECUTOR tham số hóa chạy trên dòng doanh thu đã scope quyền, và NARRATOR tiếng Việt không tự tính số.
- Executor hỗ trợ lọc kỳ/ngày/nguồn/tuyến/thực thể, groupBy/topN theo đơn hàng/nguồn/đơn vị/sản phẩm/NV/nhà thầu/tỉnh/tuyến/ngày, split 5 MISA + 5 WEB, so sánh theo nhịp tháng trước, so hôm nay với hôm qua, và chặn NV hỏi ngoài phạm vi.
- Advisory dùng LLM chỉ trên FACTS đã tính: tổng, top sản phẩm/đơn vị/nguồn, đơn vị tăng/giảm theo nhịp; không gửi dòng thô và không để LLM bịa số.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Revenue rollover:** `salesReport.defaultRanges()` nay nhận diện slot doanh thu active mới nhất ngay cả khi kỳ mới chưa có dòng, dùng `data_as_of/dateFrom` để cuộn báo cáo sang tháng mới.
- **Revenue refresh:** tick scheduler ngày 01 tháng mới chốt sổ kỳ vừa đóng đúng 1 lần (`final_close:<ky>`) trước khi materialize kỳ hiện tại; trạng thái lưu `server/data/revenue_refresh_state.json` để restart không chạy lặp.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ fast-path cho câu chắc chắn.** Các intent rõ như `top`, `theo ...`, `overview`, target/comparison/revenue tổng chạy code-first ngay; chỉ gọi `llm.interpretQuery()` cho `unknown`/`entity_drilldown`/`entity_lookup` hoặc câu tự nhiên regex không chắc, giảm trễ cho câu đơn giản.
- **Bỏ hardcode kỳ trong interpretQuery.** `llm.interpretQuery(question, { currentPeriod })` nhận kỳ hiện tại từ App Report; tháng tiếng Anh/không năm suy ra theo năm của `currentPeriod`, không cố định `07.2026`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ LLM interpretQuery theo directive.** Thêm `llm.interpretQuery(question)` để Claude chỉ trả JSON ý định (`metric/dimension/unitHint/productHint/selfScoped/period/listAll`), không gửi số liệu/PII; App Report tự resolve thực thể, giữ scope và tính số bằng code Mức 1.
- **Fix ca NV hỏi tự nhiên/không dấu/tiếng Anh.** Các câu như “doanh thu tại mã đơn vị 001… tôi bán được bao nhiêu”, `001.bvdk dong nai`, và `how much did I sell at Dong Nai hospital in July` trả doanh thu của chính NV tại đơn vị 001; câu mơ hồ “benh vien dong nai” hỏi lại 001/025.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ drill-down mức 1 theo thực thể.** Ưu tiên câu có “ở/tại/của/trong/bên …” hoặc “ai/đơn vị nào bán …” để đào sâu đúng đơn vị/sản phẩm trước khi rơi vào breakdown/ranking chung.
- **Xử lý tên trùng/mơ hồ.** Câu “Đồng Nai/BVĐK Đồng Nai” hỏi lại mã 001/025 thay vì tự đoán; nếu có mã rõ như 001 thì trả chi tiết đúng đơn vị.
- **Giữ quyền & câu cũ.** NV thường chỉ thấy phần mình; “top 5 đơn vị”, “doanh thu theo sản phẩm” vẫn liệt kê toàn bộ như trước.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Tăng an toàn idempotent cho Sales Report.** Ngoài dấu batch theo kỳ/kind, ghi thêm dấu từng người theo `key#emp_code` ngay sau khi gửi thành công; nếu chạy lại sau lỗi giữa chừng sẽ bỏ qua người đã nhận, không gửi trùng hàng loạt.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Gộp kênh gửi Sales Report Email + Telegram.** Lệnh `send-all` và scheduler dùng `notify.deliver()` để gửi email và Telegram khi NV/CEO đã liên kết Telegram.
- **Dry-run recipients có trạng thái Telegram.** `node server/src/salesReport.js recipients` in đủ 17 NV + CEO, ai đã/chưa liên kết Telegram theo `listTelegramMap()`, kèm link `t.me/<bot>?start=<mã>` cho người chưa link.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Wire lịch gửi Sales Report vào Telegram worker.** Scheduler dùng cùng cách so giờ VN như digest hiện tại (`process.env.TZ=Asia/Ho_Chi_Minh`, `vnDate().getUTC*()`), log rõ mốc armed: tuần Thứ 7 13:00 và tháng 18:30 nếu là ngày cuối tháng; có thể tắt bằng `SALES_REPORT_NOTIFY=0`.
- **Thêm idempotent sales report.** Lưu dấu gửi theo `kind + kỳ + range`, restart worker không gửi trùng; CLI/scheduler dùng chung log.
- **Thêm lệnh tay gửi thật:** `node server/src/salesReport.js send-all [week|month]` gửi 17 NV KD + CEO digest, có `--force` nếu cần chạy lại có chủ đích.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa so sánh kỳ trước theo nhịp cho báo cáo điểm/xu.** `prevRange` vẫn lấy trọn tháng trước để đọc được dữ liệu tổng kỳ T01–T06, nhưng các chỉ tiêu so sánh giữa tháng/tuần quy đổi theo `ngày đã trôi / ngày trong tháng`; nhãn email đổi thành “So với nhịp cùng kỳ T06/2026”. Bản cuối tháng giữ full-vs-full.
- **Chạy lại mẫu DN001 sau sửa nhịp.** DN001 T07 đến 09/07: doanh thu `1.169.154.080đ`; T06 full `2.444.530.837đ`; nhịp T06 quy đổi `709.702.501đ`; chênh `+64,7%`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa mẫu email điểm/xu DN001 theo review CEO/Claude.** Email NV đã giấu tên hệ thống/API/bảng/file kỹ thuật; khung nguồn dữ liệu chuyển sang ngôn ngữ nghiệp vụ nội bộ DONAPHARM, bỏ cột “Xu tuần” bị trùng, thêm D/E/G trong mục 9 và chú thích dự báo tháng là sơ bộ/còn biến động.
- **Sửa so sánh kỳ trước không còn 0 giả.** Chẩn đoán `getRows(06.2026, DN001)` có 262 dòng / `2.444.530.837đ`; nguyên nhân do dữ liệu T06 là tổng kỳ, không lọc được ngày lẻ. `salesReport.js` nay dùng trọn tháng trước cho `prevRange` để so sánh không bị rỗng giả.
- **Gửi lại mẫu thật DN001 tuần + tháng cho CEO duyệt.** Đã xuất HTML mới và gửi email test CEO; chưa bật lịch, chưa gửi 17 NV.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Dựng `server/src/salesReport.js` theo directive điểm/xu.** Sinh báo cáo tuần/tháng từng NV KD + CEO digest, lọc người nhận bằng `targetRosterCodes()` và loại `DN021/DN022/DN023/VP004/VP018`; dùng `diemXu.js` cho điểm/xu, số live App Report, text thương hiệu `DONAPHARM`.
- **Nối mục I với nguồn CST App Sale đã duyệt.** Thêm `server/src/appSaleCst.js`: ưu tiên `GET /api/reports/tender-quota` có Bearer token; nếu API 401/chưa cấp token thì dùng cache materialized `server/data/cst_appsale_tender_quota.json` (runtime, không commit). Mục I dùng thẳng `slConLai`, lọc theo đơn vị NV, loại `la_ap_thau`, NCL hiển thị riêng là “dư địa vô hạn”.
- **Gửi mẫu thật DN001 cho CEO duyệt.** Đã xuất HTML tuần + tháng vào `artifacts/sales-report/` và gửi 2 email `[CEO DUYỆT]` tới `trungdangxuan@gmail.com`, SMTP trả OK. `node --check` và `npm --prefix web run build` OK. Chưa bật lịch, chưa gửi 17 NV.

# CHANGELOG & TIẾN TRÌNH — App Report New

> **QUY TRÌNH (đọc trước):** Đây là nhật ký DUY NHẤT ghi lại **mọi thay đổi của app** và **tiến trình hiện tại**.
> - Bot/người đọc repo hãy bắt đầu từ file này để nắm toàn cảnh, rồi đọc tiếp `CLAUDE.md` (bản đồ code) và `HANDOFF.md` (việc còn lại).
> - **Dev chính (Claude Code) BẮT BUỘC ghi 1 mục vào đây cho mỗi thay đổi** (mới nhất ở trên cùng), kèm ngày, việc đã làm, lý do, và trạng thái test.
> - Vai trò: Claude Code = dev chính; Bot server = hỗ trợ môi trường/deploy/tunnel. Tác vụ lớn ảnh hưởng hệ đang chạy phải hỏi bot server trước.

---

## 📍 TRẠNG THÁI HIỆN TẠI — 2026-07-01
- **Giai đoạn:** ĐÃ LIVE tại `https://reportnew.donapharm.asia` (cổng 3873, PM2 `reportnew` + `cloudflared-reportnew`); app cũ `dona-report` cổng 3860 giữ nguyên.
- **Dữ liệu DOANH THU đã THẬT:** import 04/05/06.2026 từ app cũ (T04 34.79 tỷ · T05 30.40 tỷ · T06 28.40 tỷ), đủ đơn vị/SP/nhà thầu/gói thầu. **Cơ số thầu + Target VẪN là dữ liệu mẫu** (nguồn riêng, chưa nối).
- **GitHub:** `donapharm/App-report-new` — nhánh `main`, đồng bộ.
- **✅ ĐĂNG NHẬP OTP THẬT ĐÃ CHẠY + PUBLIC MỞ:** đăng nhập bằng SĐT→OTP (backend nội bộ 3848), demo đã tắt. CEO (role backend `full`→admin) thấy toàn bộ; NV sale chỉ thấy phần mình. Site mở tại `https://reportnew.donapharm.asia` (bảo vệ bằng OTP; Cloudflare Access là tùy chọn phụ, chưa bật).
- **Kế tiếp:**
  1. **Đúng danh sách NV** (vừa fix: Target/Dự báo chỉ lấy NV có doanh thu thật) — bot pull + restart để áp.
  2. **Đồng bộ nốt số liệu từ app cũ:** target thật (`import_targets.js` — cần bot dump nguồn target) + **cơ số thầu** thật (hiện còn mẫu, cần nguồn ORDS/file).
  3. Lấy **đủ dữ liệu từ 01/2026** (importer thư mục đã sẵn).

---

## 🗒️ LỊCH SỬ THAY ĐỔI (mới nhất trên cùng)

### 2026-07-09 (ah) — Claude Code — CEO DUYỆT 2 bản mẫu Điểm/Xu (tuần+tháng) → chốt template + directive bot
- **CEO duyệt cả bản TUẦN và THÁNG** của DN001 (bản "thông minh", có mục 9 A–I). Chốt 2 sửa cuối:
  1. **BỎ câu "toàn công ty đang dư xu"** (câu cũ dư 944,87 xu) — tránh NV ỷ lại tưởng công ty không cần
     chi tiêu xu. Bản NV chỉ nói trạng thái xu **riêng NV**.
  2. **Bản TUẦN cũng có mục 9 "Phân tích thông minh"** (trước chỉ bản tháng có).
  3. Thêm dòng nhắc **"Xu chỉ tính theo QUÝ — sang quý mới reset về 0, không chuyển tiếp"** ở Nguồn dữ liệu.
- **Thêm template chuẩn đã duyệt:** `reference/diemxu_templates/APPROVED_tuan_DN001.html` +
  `APPROVED_thang_DN001.html` (giữ `cid:logo_dona`/`cid:qr_zalo` để bot render dữ liệu live vào).
- **Thêm `DIRECTIVE_SALES_REPORT.md`** giao bot dựng `server/src/salesReport.js` (email tuần/tháng per NV +
  bản CEO tổng hợp, tái dùng `analytics.js` + `diemXu.js`, mục 9 A–I, dự báo `targetPacingMeta`, khai thác
  `cstTable`) + gắn lịch (Thứ 7 13h00 tuần · ngày cuối tháng 18h30 tháng) gửi Telegram + email; loại 5 NV.
- **Cập nhật `SPEC_DIEM_XU_TICH_LUY.md`:** mục 4h (CEO duyệt + khoá layout), mục 5 (checklist triển khai bot),
  chỉnh query `vat.db` mục 4d (chỉ lọc `hidden_at`, **chưa khoá `trang_thai_hd`** tới khi Finance xác nhận).
- **Test:** render 2 bản mẫu (`node --check` generator OK); template giữ cid refs. Chỉ tài liệu +
  template — **không đụng code app đang chạy**. Bước sau: bot dựng `salesReport.js` → chạy mẫu THẬT DN001 →
  CEO duyệt lần cuối → bật gửi cả đội.

### 2026-07-09 (ag) — Claude Code — Đồng bộ MỨC email target với màu biểu đồ (thêm mốc XUẤT SẮC ≥120%)
- **CEO:** biểu đồ NV có mức "xuất sắc ≥120%" nhưng email chỉ có 50/90/100 → thêm mốc email cho khớp.
- **`MILESTONES = [50, 90, 100, 120]`** — thêm **120% = XUẤT SẮC** (mỗi mốc gửi 1 lần/kỳ/NV, chống spam).
- **Email + Telegram cho mốc 120:** màu **tím `#7c3aed`** (khớp biểu đồ), emoji 🌟, huy hiệu "Vượt 120%
  target — Xuất sắc", tiêu đề "Xuất sắc, {tên}!". Telegram: "🌟 XUẤT SẮC! … VƯỢT 120% target".
- **Digest CEO:** NV ≥120% hiện icon 🌟 + màu tím (đồng bộ).
- **Test:** `node --check` OK; render preview email xuất sắc. Chỉ logic app → bot restart (không materialize).


### 2026-07-09 (af) — Claude Code — Biểu đồ Top doanh thu đẹp hơn + bar NV tô màu theo % target
- **CEO giao thiết kế:** làm biểu đồ top đẹp mắt, và tab Nhân viên tô màu theo mức đạt target.
- **TopBarChart nâng cấp:** số **hạng** trước tên, **#1 nổi bật cam**, top 2–3 xanh đậm, còn lại gradient;
  **nhãn tiền + % ngay cuối mỗi thanh**; trục/ lưới nhẹ nhàng hơn; tooltip tiền đầy đủ.
- **Tab Nhân viên — màu theo % đạt target** (CEO gợi ý): `<50%` đỏ · `50–89%` cam · `90–99%` xanh nhạt ·
  `100–119%` xanh · **`≥120%` tím (xuất sắc)**; nhãn hiện **% TG** thay cho % tổng; có **chú thích màu**.
  % lấy từ `/targets` (per-NV) ghép theo `emp_code`. NV thường không mở tab này (chỉ admin).
- Overview + Analysis: truyền `dimension` + `totalRevenue`; gộp `pctTarget` khi tab NV.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ae) — Claude Code — KHÔI PHỤC Top 20 (Tổng quan) + tab "Nhân viên" trong biểu đồ (bị git reset xoá)
- **CEO phát hiện:** hôm qua đã có Top 20 ở Tổng quan + tab Nhân viên trong biểu đồ top, nay MẤT.
- **Điều tra:** Phân tích còn Top 20 (đã trên `main`), nhưng **Tổng quan tụt về Top 10** và **cả 2 trang mất
  tab Nhân viên**. Nguyên nhân: phần này bot làm **local trên server, CHƯA merge `main`** → mỗi lần
  `git reset --hard origin/main` (deploy đợt fix của Claude) **xoá sạch**. Code còn trong nhánh backup
  `origin/bot-server-local-2`.
- **Khôi phục (port sạch sang `main` hiện tại):** Overview lên **Top 20** (`topLimit`) + thêm tab **Nhân viên**
  (admin); Analysis thêm tab **Nhân viên**. `TopBarChart` đã sẵn `limit`/`label` nên render đủ.
- **‼ PHÒNG NGỪA:** bot PHẢI **commit + push (PR lên `main`)** mọi thay đổi app — KHÔNG để local, vì
  auto-deploy `git reset --hard` sẽ xoá. Đây là lần lặp lại của lỗi mất code local.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ad) — Claude Code — FIX thông báo target sai tháng (T06 → phải là THÁNG HIỆN TẠI T07)
- **CEO phát hiện:** bot + email nhắc target/doanh số **tháng 06** trong khi đang là **T07** → sai.
- **Gốc:** `targetNotify.evaluate` mặc định `store.lastCompleteKy()` = tháng hoàn thành gần nhất (T06).
  Scheduler (telegram-bot) gọi không truyền ky → gửi T06.
- **Sửa:** mặc định đổi sang **`store.currentKyByDate()`** (tháng hiện tại theo ngày) cho `evaluate`
  (áp cho mọi thông báo: scheduler, preview, gửi, gửi đích danh, digest CEO) + route `/targets/kpi`.
  Kiểm chứng: `evaluate().ky` = **07.2026** (trước 06.2026). Anti-spam theo key `ky|emp` nên mốc T07 là mới,
  gửi lại đúng.
- **Áp:** chỉ là logic app → **bot RESTART PM2** (reportnew + reportnew-tgbot), KHÔNG cần materialize.


### 2026-07-09 (ac) — Claude Code — Tên nhà thầu MISA ra ĐẦY ĐỦ (khoá join lệch code)
- **Gốc:** MISA dùng `legal_entity_code` dạng `01.DONA`/`02.AFP`, còn `legal_entities.code` là `DONAPHARM`/`AFP`
  → join `le.code = l.legal_entity_code` KHÔNG khớp → rớt về tên ngắn "DONAPHARM"/"AFP PHARMA".
- **Khoá khớp thực tế:** DONA → `legal_entity_name`="DONAPHARM"=`le.code`; AFP → `legal_entity_bucket`="AFP"=`le.code`.
- **Sửa:** thay join bằng **subquery dò `le.code` theo cả `legal_entity_name`/`bucket`/`code`** (LIMIT 1, ưu tiên
  name→bucket→code) → tránh nhân đôi dòng. Ra "Công ty TNHH Dược phẩm Donapharm" / "Công ty TNHH AFP Pharma".
- **Áp:** materialize đổi → **bot chạy lại materialize**. `node --check` OK.


### 2026-07-09 (ab) — Claude Code — Fill Hoạt chất/Hàm lượng/Giá thầu/Ưu tiên từ bảng `products` nguồn
- **Gốc:** 4 cột này trước lấy từ CST (mẫu/chưa đủ) → trống 27–37%. Bot gửi schema `products` có sẵn:
  `active_ingredient`, `strength`, `price`, `tech_rank`.
- **Sửa:** materialize (MISA + partner) lấy thẳng từ `products`: Hoạt chất←`active_ingredient`,
  Hàm lượng←`strength`, Giá trúng thầu←`price`, **Ưu tiên←`tech_rank`** (giả định — mã dạng "H.x" hợp với
  hạng kỹ thuật; **cần bot/CEO xác nhận** sau khi chạy lại: cột Ưu tiên có ra đúng "H.D/H.B" không, nếu sai
  đổi sang `tech_group`/`nhom_dieu_tri`).
- Các cột này gắn vào MỌI dòng doanh thu → không còn phụ thuộc CST mẫu; export điền đủ như Số QĐ.
- **Áp:** materialize đổi → **bot phải CHẠY LẠI materialize** (không chỉ restart). `node --check` OK.


### 2026-07-09 (aa) — Claude Code — Export Doanh thu đầy đủ: thêm cột "Số QĐ" + bỏ chặn Hoạt chất/Hàm lượng
- **CEO phản ánh** file xuất thiếu cột **Số QĐ**, và Hoạt chất/Hàm lượng/Ưu tiên/Giá trúng thầu trống nhiều.
- **Số QĐ:** thêm cột (key `qd`, đã có sẵn từ enrichProductMeta) — QĐ139/QĐ141… suy từ mã QLNB + gói thầu.
- **Hoạt chất/Hàm lượng (trống 37%):** trước bị **chặn chỉ hiện cho QĐ139**; nay ở FILE XUẤT bỏ chặn —
  có trong metaMap là hiện (trang web vẫn giữ như cũ để gọn).
- **CÒN LẠI — Ưu tiên + Giá trúng thầu (trống 27%):** lấy từ nguồn **Cơ số thầu (CST) — vẫn là dữ liệu
  mẫu/chưa nối đủ**; SP bán ra chưa có trong CST → trống. Sửa triệt để: cho materialize lấy từ bảng
  `products`/nguồn thầu (đang chờ schema `products` để wire đúng cột).
- **Test:** xuất file thật, đủ 22 cột, có "Số QĐ". `node --check` OK.


### 2026-07-09 (z) — Claude Code — Thiết kế lại EMAIL thông báo target (HTML + logo + QR Zalo OA)
- **CEO chê email cũ "cùi bắp"** (text trơn). Làm lại thành **email HTML** chỉn chu, an toàn client email
  (bảng + inline style): logo DONAPHARM đầu trang (nền trắng), **thanh tiến độ**, bảng số liệu (doanh thu
  đạt / target / % / còn thiếu / cần/ngày), màu brand **xanh dương** + cam nhấn, **QR Zalo OA** ở chân trang,
  footer "email tự động".
- **Ảnh nhúng kiểu CID** (Gmail chặn data-URI): `notifyChannels` đính kèm `web/public/logo-dnpharma.png` +
  `zalo-oa-qr.png` với cid `dnpharma-logo`/`dnpharma-zalo`; html tham chiếu `src="cid:..."`.
- **3 mẫu:** sự kiện milestone/behind (`emailHtmlFor`), trạng thái đích danh (`emailHtmlForStatus` qua
  `statusFor`), tổng hợp CEO (`ceoDigestHtml`). Telegram vẫn giữ TEXT (`messageFor` không đổi).
- `notifyChannels.sendEmail/deliver` thêm tham số `html`; routes + telegram-bot truyền html qua.
- **Cho dễ hiểu (CEO giao tự quyết):** thêm **huy hiệu kết quả** to rõ ("✓ Đã đạt 100%" / "Đã đạt 90%
  target" / "⚡ Cần tăng tốc") + **nút "Xem báo cáo chi tiết →"** mở thẳng app (`APP_PUBLIC_URL`, mặc định
  reportnew.donapharm.asia). Digest CEO có nút "Xem toàn bộ báo cáo".
- **Trạng thái:** `node --check` toàn bộ OK; đã render preview. CEO giao tự quyết → chốt bản này, merge deploy.


### 2026-07-08 (y) — Claude Code — Lọc tỉnh theo cột `units.province` + sửa tên đối tác partner
- **Lọc tỉnh/vùng (gốc lỗi):** `province.js` đoán tỉnh theo TÊN đơn vị → sai (vd "033.PKĐK AN NGÃ TƯ
  VŨNG TÀU" tên có "Vũng Tàu" nhưng `units.province` thật = **ĐỒNG NAI**). Sửa: materialize lấy
  `units.province` gắn vào từng dòng (MISA join `units ON u.code=l.unit_code`; partner đã có join units).
  Store ưu tiên `row.province` → lọc tỉnh giờ theo ĐÚNG mã tỉnh, không đoán tên nữa.
- **Tên đối tác (partner):** `legal_entities.name` của partner thường là nhóm rác **"Đối tác khác"** →
  ưu tiên **`contractors.name`** (tên đối tác thật): `COALESCE(NULLIF(NULLIF(le.name,''),'Đối tác khác'),
  NULLIF(c.name,''), '')`. (Đảo lại logic #78 vốn ưu tiên le.name.)
- **Tên MISA đầy đủ (đã xong):** `legal_entities` có cột `code` → join `le.code = l.legal_entity_code`,
  `contractor_name = COALESCE(NULLIF(le.name,''), l.legal_entity_name)` → ra "Công ty TNHH Dược phẩm
  Donapharm" thay vì "DONAPHARM". (Xác nhận: partner như Tự Đức/Tuệ Nam có `contractors.name` là tên đầy
  đủ, `legal_entity_id=4`="Đối tác khác" nên fix partner ưu tiên c.name là đúng.)
- **Test:** `node --check` OK. Cần bot chạy lại materialize để áp province + tên nhà thầu (MISA + partner).


### 2026-07-08 (x) — Claude Code — Tên pháp nhân đầy đủ cho nhà thầu WEB/đối tác (đưa fix của bot vào git)
- **Bối cảnh:** MISA đã có tên pháp nhân đầy đủ (`legal_entity_name`), nhưng nhánh WEB/partner chỉ lấy
  `contractors.name` (tên ngắn). Bot đã tìm đúng schema và sửa **trực tiếp trên server** rồi chạy lại T07
  (slot `rev_2src_072026_20260708234245`, tổng 13.528.199.293đ, **đối soát Sale-New ✅ KHỚP**).
- **Vì sao Claude commit vào git:** bot sửa ở BẢN LÀM VIỆC trên server; `main` chưa có → auto-deploy
  (`git reset --hard origin/main`) sẽ **xóa mất** đoạn sửa ở lần deploy kế. Đưa vào repo để giữ vĩnh viễn.
- **Fix (đúng schema bot xác nhận — DB KHÔNG có `c.legal_name`, `contractors` có `legal_entity_id`):**
  - `contractor_name`: `COALESCE(NULLIF(le.name,''), c.name, '')` — ưu tiên tên pháp nhân, fallback tên contractor.
  - Thêm `LEFT JOIN legal_entities le ON le.id=c.legal_entity_id`.
- **Trạng thái test:** `node --check` OK (không chạy DB ở đây). Bot đã xác nhận chạy thật T07 khớp.

### 2026-07-08 (w) — Claude Code — Export doanh thu: chốt bộ cột theo CEO
- Theo CEO chốt: **bỏ cột Đơn giá** (chỉ giữ "Giá trúng thầu"); **ĐVT → "Đơn vị tính"** (ghi rõ);
  giữ **STT** ở cột đầu; **thêm cột "Ghi chú" ở cuối** (để trống cho kế toán ghi tay).
- 21 cột: STT · Kỳ · Ngày · Mã NV · Tên NV · Tuyến · Mã đơn vị · Tên đơn vị · Mã QLNB · Sản phẩm ·
  Hoạt chất · Hàm lượng · Đơn vị tính · Mã nhà thầu · Tên nhà thầu · Gói thầu · Ưu tiên · Giá trúng thầu ·
  Số lượng · Doanh thu · Ghi chú. Vẫn giữ định dạng kế toán VN + in A4 ngang lề ~1.5cm.
- **Test:** xuất file thật, đọc lại: đúng 21 cột, STT đầu, không còn Đơn giá, có Đơn vị tính, Ghi chú cuối.

### 2026-07-08 (v) — Claude Code — Export doanh thu: thêm Đơn giá, tên nhà thầu đầy đủ, in A4 ngang lề sát
- **CEO bổ sung:** (a) tên nhà thầu phải **đầy đủ** (vd "Công ty TNHH Dược phẩm DONAPHARM"); (b) **thiếu cột
  Đơn giá**; (c) in ra **A4 ngang vừa đủ, lề ~1.5cm cho sát**.
- **(a)** Materialize MISA nay ghi `contractor_name = legal_entity_name` (tên pháp nhân đầy đủ) vào từng dòng;
  `contractorNameFor` ưu tiên tên có sẵn nên tên đầy đủ được giữ nguyên qua enrich. (Cần bot chạy lại
  materialize để dòng MISA có tên; dòng partner đã có tên từ bảng contractors.)
- **(b)** Thêm cột **"Đơn giá" (unit_price)** cạnh "Giá trúng thầu" — đơn giá bán thực tế mỗi dòng.
- **(c)** `styleAccountingSheet` set `pageSetup`: khổ **A4**, **ngang (landscape)**, co vừa **1 trang chiều
  ngang** (fitToWidth=1), **lề 0.59in (~1.5cm)** cả 4 phía, **lặp dòng tiêu đề** mọi trang, canh giữa ngang,
  đánh số trang ở footer.
- **Chờ CEO:** gửi thứ tự cột mong muốn → em sắp lại + tinh chỉnh độ rộng để in A4 ngang đọc rõ (bớt cột thừa
  thì chữ in càng to).
- **Test:** xuất file thật, đọc lại: có cột Đơn giá, `pageSetup` A4/landscape/fitToWidth/margin 0.59/printTitles OK.

### 2026-07-08 (u) — Claude Code — XUẤT EXCEL "Doanh thu đầy đủ": tên nhà thầu + nhiều NV + chuẩn kế toán VN
- **CEO phản ánh 3 điểm ở tab "Doanh thu đầy đủ":** (1) file Excel thiếu **tên nhà thầu**; (2) chỉ lọc/xuất
  được **1 NV**, muốn chọn **nhiều NV**; (3) muốn **định dạng chuẩn kế toán VN**.
- **(1) Tên nhà thầu:** export cũ dùng `store.getRows` thô + cột "Nhà thầu" chỉ ghi *mã*. Nay export
  **enrich giống hệt trang** (`contractorLookup` + `enrichContractorNames` + `enrichProductMeta`) → thêm cột
  **"Tên nhà thầu"** (kèm "Mã nhà thầu"), và bổ sung đủ trường: Ngày, Hoạt chất, Hàm lượng, ĐVT, Ưu tiên,
  **Giá trúng thầu**, STT. File xuất giờ khớp 100% dữ liệu đang xem trên trang.
- **(2) Nhiều NV:** ô lọc NV đổi từ chọn-đơn → **chọn-nhiều** (MultiSelect, chung `revenueFilters`); backend
  `applyFilters` nhận `emp` là danh sách nối `|` (1 hay nhiều mã đều được, để trống = tất cả NV). Đã test:
  `emp=DN001|DN002` → chỉ 2 NV; không lọc → đủ 12 NV.
- **(3) Chuẩn kế toán VN:** helper `styleAccountingSheet` — số nhóm nghìn `#,##0`, **âm trong ngoặc đỏ**,
  canh phải; tiêu đề đậm nền xanh + **freeze dòng tiêu đề** + **AutoFilter**; thêm dòng **TỔNG CỘNG** (in đậm)
  cộng Số lượng/Doanh thu.
- **Trạng thái test:** dựng server thật + xuất file, đọc lại bằng ExcelJS: đủ 20 cột, đúng numFmt, freeze,
  autofilter, tổng cộng, lọc nhiều NV đúng. Web build OK. (Tên nhà thầu trống trên dữ liệu MẪU vì mẫu chưa
  map tên NCC — trên production trang & file đều hiện tên như nhau.)

### 2026-07-08 (t) — Claude Code — CÔNG CỤ ĐỐI SOÁT Report-New ↔ Sale-New (tự phát hiện lệch)
- **Lý do (CEO yêu cầu sau vụ DN009):** không đợi NV báo mới biết mất dữ liệu — phải TỰ phát hiện lệch
  theo từng NV/kỳ.
- **`server/src/reconcile.js` (mới):** đối soát toàn vẹn 1 kỳ trên dữ liệu Report-New (KHÔNG cần DB), đọc
  file slot GỐC (trước khi kéo biên) để bắt đúng dấu vân tay lỗi:
  1) `dateOutOfBand` — dòng có ngày ngoài [dateFrom,dateTo] (đúng ca 01/07→30/06);
  2) `metaMismatch` — số dòng/doanh thu metadata ≠ thực tế file;
  3) `duplicateLines` — trùng `source_line_id`;
  4) `unitDrop` — theo từng NV, đơn vị có doanh thu kỳ trước nhưng biến mất kỳ này (cảnh báo sớm kiểu DN009).
- **API `GET /admin/reconcile?ky=` (admin):** trả JSON đối soát để hiển thị/đẩy cảnh báo.
- **Web:** thêm tab **“Đối soát dữ liệu”** trong trang Upload (admin) — chọn kỳ → xem lệch ngay.
- **`server/scripts/reconcile_revenue.js` (mới, chạy trên server bot):** Lớp 1 (như trên) + **Lớp 2** DỰNG
  LẠI doanh thu từ **nguồn Sale-New** bằng chính truy vấn của materialize (require lại, KHÔNG chạy
  materialize) rồi đối chiếu per (NV, đơn vị): thiếu ở Report-New / lệch doanh thu / dư ở Report-New.
  `materialize_july_revenue.js` được bọc `require.main===module` + export hàm để tái sử dụng an toàn.
- **Trạng thái test:** `node --check` toàn bộ OK; web build OK; test tái hiện DN009 (2 dòng 30/06 +
  meta lệch + dòng trùng) → tool bắt đủ. Lớp 2 cần chạy trên server bot có DB Sale-New.

### 2026-07-08 (s) — Claude Code — TÌM ĐÚNG GỐC LỖI NGÀY 01/07→30/06 (fix tại nguồn materialize)
- **Bối cảnh:** Sếp bác bỏ cách "kéo về biên kỳ" (mục r) vì đó chỉ là **vá triệu chứng**, yêu cầu tìm
  **đúng chỗ sinh ra ngày sai**. Dữ liệu Sếp cung cấp: 11 dòng 034 Y ĐỨC HEALTHCARE đều `source: CRM_MISA`,
  `date: "2026-06-30"`, nằm trong file `ky: 07.2026` (order DH479815515, MISA:16889…).
- **GỐC LỖI (đã chứng minh):** `server/scripts/materialize_july_revenue.js` dòng 39:
  `dateOnly(v) = new Date(v).toISOString().slice(0,10)`.
  - `misa_revenue_snapshot_lines.revenue_date` là kiểu **DATE = 01/07** (nên vẫn LỌT qua bộ lọc SQL
    `revenue_date >= '2026-07-01'::date` → có mặt trong file T07).
  - node-postgres đọc DATE thành **nửa đêm giờ máy** → trên server VN (GMT+7) là
    `2026-07-01T00:00:00+07` = `2026-06-30T17:00:00Z`.
  - `.toISOString()` quy về **UTC** rồi cắt 10 ký tự → ra **`2026-06-30`**. Vì DATE luôn là nửa đêm nên
    **TẤT CẢ** dòng bị lùi đúng 1 ngày (giải thích vì sao cả 11 dòng đều 30/06, không phải vài dòng).
  - Sau đó `store.js` lọc theo `dateFrom=01/07` → rớt sạch khỏi Report-New T07.
- **Đã sửa (tại nguồn):**
  1. `dateOnly()` lấy ngày theo **giờ VN** bằng `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok'})`,
     KHÔNG dùng `toISOString()`. Kiểm chứng: `pg DATE 01/07 → CŨ=2026-06-30, MỚI=2026-07-01` (đúng).
  2. Nhánh WEB partner: các cast `timestamptz::date` (`o.created_at`, `resp.responded_at`,
     `resp.updated_at`) đổi sang `(x AT TIME ZONE 'Asia/Bangkok')::date` để không lệch ngày với đơn
     đầu giờ sáng khi session DB chạy UTC.
- **Cách áp:** bot `git reset --hard origin/main` + chạy lại materialize (hoặc chờ scheduler) → dữ liệu
  MISA T07 sẽ mang đúng ngày 01/07. "Kéo về biên kỳ" (mục r) giữ lại làm **lưới an toàn có log**, gần như
  không còn phải kích hoạt sau fix này.
- **Trạng thái test:** `node --check` OK; unit-test tái hiện lỗi cũ + xác nhận fix trên máy TZ=Asia/Ho_Chi_Minh.
  Cần bot chạy lại materialize thật để xác nhận DN009 = 12 đơn vị.

### 2026-07-08 (r) — Claude Code — FIX MẤT DOANH THU: không bỏ dòng "ngày gán sai", kéo về biên kỳ
- **Triệu chứng (NV DN009 phát hiện):** DN009 tháng 7 chỉ ra 9 đơn vị thay vì 12; thiếu 034 Y ĐỨC
  HEALTHCARE + TRỊ AN. Sale-New CÓ, Report-New KHÔNG.
- **Điều tra:** file materialize T07 CÓ đủ các dòng đó (Healthcare 11, Trị An 6) nhưng **ghi ngày
  2026-06-30**. `store.js slotRows` (fix #70) lọc BỎ mọi dòng ngày < dateFrom(01/07) → rớt sạch.
  Mà **go-live 01/07 + NV xác nhận + Sale-New đều 01/07** → ngày 30/06 là **GÁN SAI ở nguồn** (lệch
  múi giờ), KHÔNG phải doanh thu tháng 6. Không có file materialize T06 → không lo tính trùng.
- **Sửa:** `slotRows` **KHÔNG bỏ dòng nữa** (mất doanh thu âm thầm là cực nguy hiểm) — thay bằng **KÉO
  ngày sai về đúng biên kỳ** (30/06 → 01/07) + **GHI LOG** số dòng đã kéo (minh bạch, không im lặng).
- **Còn lại (bot):** sửa GỐC ở **materialize** — chuẩn hoá ngày về **giờ VN (GMT+7)/ngày bán Sale-New**
  để nguồn không còn ngày lệch.
- **File:** `server/src/store.js`. Test: store nạp OK, số mẫu không đổi, regression PASS.


### 2026-07-08 (q) — Claude Code — TÍCH HỢP ROUTER NLQ (hết "bơi ngáo") + gỡ khóa cứng T07
- **Việc lớn:** thay mớ ~30 regex intent xếp chồng (dễ lạc ý, vá chỗ này lòi chỗ kia) bằng **router
  phân loại ý định** `nlqIntent.js` (bot server xây, đã review). Router quyết intent RÕ RÀNG trước
  (sensitive/ranking/breakdown/overview/target/comparison/revenue…) rồi mới tới tra cứu/help.
- **Sửa lỗi trong ảnh CEO:** "báo cáo chi tiết các **mã hàng** có doanh thu cao" nay ra **báo cáo sản
  phẩm** (trước bị nhầm thành "tra cứu 1 thuốc" → "không tìm thấy"). "lấy **tất cả** mã qlnb" cũng ra
  báo cáo (thêm "tất cả/toàn bộ" vào tín hiệu liệt kê của router).
- **GỠ khóa cứng T07:** `employeeRevenueLocked=false` — T07 đã đúng (gom nhóm chuẩn + fix lọc ngày slot)
  và đã có nhãn "dữ liệu tới ngày DD/MM". NV giờ xem được số T07 của mình.
- **GIỮ trọn** tính năng của Claude: tra cứu đích danh thuốc/đơn vị (web `/lookup` dùng), buildFacts giàu
  cho LLM, và 3 fix mới nhất được ghép lại: **#71** chống lặp nhãn đơn vị, **#72** báo "tháng chưa có số",
  **#73** nhãn "dữ liệu tới ngày".
- **Test:** `scripts/test_smart_nlq_regression.js` (viết lại, chạy được cả mẫu lẫn server) — PASS:
  top đơn vị/NV, báo cáo sản phẩm, chặn nội dung nhạy cảm, NV không xem NV khác, tháng chưa có số, NV
  xem số của mình. Các ca của Claude (tra cứu, cơ số, exports web) đều OK.
- **File:** `server/src/smart.js`, `server/src/nlqIntent.js` (mới), `server/scripts/test_smart_nlq_regression.js`.
- **Phân công từ nay:** bot server phát triển tiếp NLQ trên `nlqIntent.js`; Claude review + tích hợp.
  `bot-server-local` giữ làm mốc.


### 2026-07-08 (p) — Claude Code — Nhãn "dữ liệu tới ngày DD/MM" cho kỳ đang cập nhật (web + bot)
- **Mục đích:** chặn hiểu nhầm "thiếu đơn vị/số" khi kỳ đang xem là THÁNG ĐANG CHẠY (chưa đủ ngày).
  Nhìn phát biết kỳ đã đủ hay đang nạp tiếp.
- **Backend:** `store.periodFreshness(ky)` — tính dữ liệu tới ngày nào (chỉ với kỳ có dữ liệu THEO NGÀY;
  kỳ tổng-tháng coi như đủ). `/periods` trả kèm `throughDate/dayCovered/daysInMonth/complete`.
- **Web:** `PeriodFilter` hiện dòng "📅 Dữ liệu tới DD/MM · X/Y ngày — kỳ đang cập nhật" khi tháng chưa đủ.
- **Bot:** câu trả lời có số (top/báo cáo/doanh thu/chi tiết) tự thêm dòng "📅 Dữ liệu tới DD/MM (X/Y ngày)"
  khi kỳ chưa đủ. Kỳ đã đủ (tổng tháng) thì KHÔNG thêm (tránh nhiễu).
- **File:** `server/src/store.js`, `server/src/routes.js`, `server/src/smart.js`,
  `web/src/pages/PeriodFilter.jsx`, `web/src/styles.css`.


### 2026-07-08 (o) — Claude Code — FIX bot lặng lẽ trả kỳ khác khi hỏi tháng CHƯA có dữ liệu
- **Triệu chứng:** NV hỏi "doanh số từ đầu tháng 8 đến hôm nay" (T8 chưa có số) → bot **lặng lẽ lấy kỳ
  mới nhất (T7)** rồi trả danh sách → NV tưởng là số tháng 8, thấy "thiếu đơn vị" (thực ra là số T7).
- **Nguyên nhân:** `answerQuestion` dùng `resolveKyFromQuestion(q) || store.latestKy()` — khi tháng
  người hỏi không có dữ liệu thì rơi về kỳ mới nhất, không báo gì.
- **Sửa:** thêm `monthMention(q)` — nếu người hỏi **nêu rõ 1 tháng** mà kỳ đó **chưa có dữ liệu** →
  trả thẳng "Kỳ MM.YYYY chưa có dữ liệu" + liệt kê các kỳ đang có số. Câu không nêu tháng vẫn dùng kỳ
  mới nhất như cũ.
- **Test:** "tháng 8.2026"/"tháng 12" → báo chưa có dữ liệu; "tháng 6"/"kỳ này"/"top 10 đơn vị" → bình thường.
- **File:** `server/src/smart.js`.


### 2026-07-08 (n) — Claude Code — Fix nhãn đơn vị bị LẶP ĐÔI trên Telegram (data T07)
- **Triệu chứng:** bot ghi "002.BVĐK Thống Nhất ĐN**.BVĐK Thống Nhất ĐN**" (lặp 2 lần).
- **Nguyên nhân:** data T07 có `unit_code` chứa cả tên ("034.PKĐK Y ĐỨC") còn `unit_name` chỉ là tên
  ("PKĐK Y ĐỨC") → `unitText` backend ghép thành `code.name` bị lặp. (Frontend `util.js` ĐÃ có chống
  lặp; backend `smart.js` thiếu.)
- **Sửa:** thêm vào `unitText` (smart.js) đúng guard như frontend: `if (/^\d{3}\./.test(c) && c.includes(nm)) return c;`
- **LƯU Ý (không phải lỗi):** việc "thiếu đơn vị 034 ở T07" KHÔNG do lệch mã — `unit_code` T06=T07 giống
  nhau, gom nhóm ĐÚNG. Các ĐV đó **chưa bán ở T07** (đầu kỳ); màn web so là **T06 đã hoàn tất**.
- **File:** `server/src/smart.js`.


### 2026-07-08 (m) — Claude Code — Cherry-pick 2 fix DỮ LIỆU từ bot-server-local
- **Bối cảnh:** bot server làm song song 1 nhánh (`bot-server-local`, 5 commit). Sau khi soi + thống nhất
  với bot: **8b09419** trùng fix #68 (bỏ), **b1d29f6** khóa cứng T07 (KHÔNG merge — dễ chặn nhầm),
  router NLQ (50740f1/7da6b7c) để review sau. Chỉ lấy 2 fix dữ liệu thật sự còn thiếu:
  - **store.js `slotRows`:** lọc theo ngày của slot — chặn invoice 30/06 lọt nhầm vào materialize T07
    (đây là GỐC khiến số T07 sai; fix đúng chỗ này thì không cần khóa cứng tháng 7).
  - **llm.js:** thêm ràng buộc đơn vị tiền cho LLM (231.000.000đ = 231 triệu, KHÔNG phải 231 tỷ).
- **Kỹ thuật:** đã xác minh 2 file chỉ khác đúng phần fix (store.js 1 hunk `slotRows`, llm.js 1 dòng),
  không đụng memo-hoá/logic khác của main. `bot-server-local` giữ làm backup cho router NLQ.
- **File:** `server/src/store.js`, `server/src/llm.js`.


### 2026-07-08 (l) — Claude Code — Bot: "báo cáo chi tiết" ra nhiều phần + "tất cả mặt hàng" + từ "mặt hàng"
- **Báo cáo chi tiết:** câu "báo cáo doanh thu **chi tiết**" (không nêu chiều) trước chỉ ra **1 dòng tổng**
  → nay ra **nhiều phần**: doanh thu + %target + **top 5 sản phẩm** + **top 5 đơn vị** + gợi ý xem đầy đủ.
- **"Tất cả mặt hàng":** khi có "tất cả/toàn bộ/đầy đủ/chi tiết" thì liệt kê tới **50 mục** (thay 15),
  LUÔN kèm **tổng số** + gợi ý xuất Excel (tin Telegram giới hạn độ dài).
- **Fix từ khóa:** nhận diện **"mặt hàng"** (trước chỉ "sản phẩm/mã hàng").
- **File:** `server/src/smart.js`.
- **⚠ GHI CHÚ:** phát hiện bot server chạy **code KHÁC `main`** (bot ghi "15 **mục đầu**" + nhận "mặt hàng"
  — cả 2 KHÔNG có trong repo) → server có **sửa tay chưa commit** → cây git dirty → **auto-deploy bị chặn**
  → #64–#68 (kể cả fix "top 10") CHƯA lên. Cần đội bot **commit bản sửa tay vào main**.

### 2026-07-08 (k) — Claude Code — FIX bot: "top 10" bị hiểu nhầm thành tra cứu đơn vị "010"
- **Triệu chứng:** Hỏi "những đơn vị nào nằm trong top 10" → bot trả tra cứu đơn vị **010.BV Quân Y 7B**
  (0đ) thay vì danh sách top đơn vị.
- **Nguyên nhân:** intent tra-cứu-đích-danh (khớp "doanh thu…đơn vị") chạy trước "top đơn vị", rồi khớp
  nhầm đơn vị mã "010" vì câu có " 10 " (từ "top 10").
- **Sửa:** thêm cờ `rankingLike` — câu dạng xếp hạng/liệt kê (`top`, `nào`, `cao nhất`, `nhiều nhất`,
  `bán chạy`…) KHÔNG kích hoạt tra cứu đích danh (thuốc + đơn vị), nhường cho intent "top…". Bổ sung
  "bán chạy" vào mẫu "top đơn vị".
- **Giữ nguyên:** "BV007 ai bán", "đơn vị BV001 bán được bao nhiêu", "giá thầu B02", "doanh thu thuốc E05"
  vẫn ra tra cứu đích danh đúng (đã test).
- **File:** `server/src/smart.js`.

### 2026-07-08 (j) — Claude Code — Thông báo target: bảng "Trạng thái sẵn sàng" (biết còn thiếu gì để bật)
- **Việc:** Màn Quản target → Thông báo (xem trước) thêm card **⚙️ Trạng thái sẵn sàng gửi tự động**:
  - Tự động BẬT/TẮT (`TARGET_NOTIFY`), kênh **Telegram** sẵn sàng chưa, kênh **Email (SMTP)** sẵn sàng chưa.
  - Bao nhiêu NV **liên hệ được** (đã map Telegram / có email) trên tổng danh sách, bao nhiêu **bị chặn** (opt-out).
  - Nếu chưa NV nào liên hệ được → gợi ý cụ thể (NV nhắn bot để map / cấu hình SMTP).
- **Lý do:** Bật gửi tự động phụ thuộc 3 thứ cấu hình NGOÀI (env `TARGET_NOTIFY=1`, NV map Telegram, SMTP).
  Card này cho CEO thấy NGAY còn thiếu gì thay vì "bật rồi không ai nhận".
- **Backend:** `/admin/notifications/preview` trả thêm `readiness`.
- **File:** `server/src/routes.js`, `web/src/pages/Target.jsx`.
- **Còn lại (ops, ngoài code):** để gửi tự động chạy thật cần bot đặt `TARGET_NOTIFY=1`, NV nhắn bot để map
  Telegram, và (nếu gửi email) cấu hình SMTP. Gửi TAY ("Gửi ngay/Gửi thử/Gửi 1 NV") đã dùng được ngay
  cho ai đã có kênh.

### 2026-07-08 (i) — Claude Code — Cơ số thầu: sắp theo "cơ hội" + KPI tiền đang để trống
- **Việc:** Màn Cơ số thầu thêm:
  - Nút sắp xếp **💰 Cơ hội (TT còn)** — xếp theo TT còn (SL còn × giá thầu) lớn nhất, để CEO thấy ngay
    tiền đang để trống; ở chế độ gom-đơn-vị thì đơn vị có TT còn lớn nhất lên đầu.
  - KPI **💰 TT chưa khai thác** = tổng TT còn của các dòng CHƯA bán (sold=0) + số dòng chưa bán.
  - (Cột **Giá trúng thầu** và filter **Chưa bán** = còn 100% chưa khai thác đã có sẵn từ trước.)
- **File:** `web/src/pages/TenderQuota.jsx` (sortBy 'action'|'opportunity'|'none' + KPI untapped).
- **Test:** build web OK.

### 2026-07-08 (h) — Claude Code — Tra cứu nhanh TRÊN WEB (thuốc/mã QLNB/đơn vị) có thẻ kết quả
- **Việc:** Trang "Hỏi nhanh" thêm ô **🔎 Tra cứu nhanh** — gõ tên thuốc / mã QLNB / mã-tên đơn vị →
  hiện **thẻ kết quả có cấu trúc**: thuốc (doanh thu, giá thầu, cơ số còn lại, đơn vị đang bán),
  đơn vị (doanh thu, AI bán, top sản phẩm). Không phải đọc chat như trước.
- **Backend:** route `GET /lookup?q=&ky=` (scoped) tái dùng `smart.lookupProducts/lookupUnits` (đã export).
- **Quyền:** cùng `scope` — NV chỉ thấy phần của mình ("Bạn bán"); admin thấy tất cả.
- **File:** `server/src/smart.js` (export), `server/src/routes.js` (route `/lookup`), `web/src/api.js`,
  `web/src/pages/AiChat.jsx` (LookupPanel + thẻ), `web/src/styles.css`.
- **Test:** node harness lookup ra đúng + kín quyền; build web OK.

### 2026-07-08 (g) — Claude Code — DỨT ĐIỂM deploy kẹt: bỏ track output materialize
- **Việc:** `.gitignore` thêm `artifacts/*materialize*` + `git rm --cached` 4 file materialize doanh thu
  (bot tự sinh lại mỗi kỳ). Từ nay bot sinh file thoải mái, working tree KHÔNG dirty → auto-deploy
  không còn bị kẹt (đã 2 lần hôm nay phải `git stash` tay).
- **An toàn:** app KHÔNG đọc `artifacts/` (đã kiểm tra grep server/) — chỉ là output phân tích; file
  vẫn còn trên đĩa server, chỉ thôi track trong git.
- **File:** `.gitignore` (+ untrack 4 file materialize).

### 2026-07-08 (f) — Claude Code — Phân tích: Top 20 + biểu đồ tròn hiện số tiền rút gọn & %
- **Top doanh thu:** màn Phân tích nâng từ Top 10 → **Top 20** (Overview giữ Top 10). `TopBarChart`
  thêm prop `limit` (mặc định 20) để nâng trần mà không ảnh hưởng chỗ gọi khác.
- **3 biểu đồ tròn (Tuyến / Nhà thầu / Gói thầu):** hiện **% ngay trên lát bánh** (lát ≥7% cho đỡ rối)
  và **chú thích kèm số tiền rút gọn + %** (vd "NCL  1,23 tỷ · 62%") — đọc nhanh không cần rê chuột.
- **File:** `web/src/charts.jsx` (TopBarChart limit, DonutChart nhãn % + legend tiền/%) ,
  `web/src/pages/Analysis.jsx` (slice 20 + tiêu đề "Top 20").
- **Test:** build web OK.

### 2026-07-08 (e) — Claude Code — Phân tích: thêm 2 ô cho cân hàng dưới (chưa khai thác + biến động tuyến)
- **Việc:** Hàng panel dưới của màn Phân tích trước chỉ có 2 ô (SP cần đẩy mạnh, SP sắp hết CST) → trống
  2 ô. Bổ sung đúng 2 ô (theo gợi ý CEO):
  - **🆕 SP chưa khai thác (còn 100% CST):** mặt hàng đã trúng thầu nhưng kỳ này CHƯA bán viên nào
    (sold_qty=0, còn nguyên cơ số) — cơ hội để trống, sắp theo số lượng còn lại giảm dần.
  - **🛣️ Biến động theo tuyến (so kỳ trước):** mỗi tuyến tăng/giảm bao nhiêu so kỳ trước, sắp theo
    mức chênh lệch tuyệt đối lớn nhất.
- **Backend `/analysis`:** thêm `cstUntouched` (cstTable status=empty) + `routeDelta` (compareGroup theo
  route trên 2 kỳ so sánh). Cùng chịu bộ lọc + phạm vi quyền như phần còn lại.
- **File:** `server/src/routes.js`, `web/src/pages/Analysis.jsx`.
- **Test:** node harness — routeDelta ra đúng (Tuyến A +25.8%…); cstUntouched=0 trên dữ liệu MẪU vì seed
  không có mặt hàng chưa bán (đúng — server thật sẽ có). Build web OK.

### 2026-07-08 (d) — Claude Code — FIX Phân tích: "tăng mạnh/giảm mạnh" bị lẫn lộn tăng với giảm
- **Triệu chứng:** Màn Phân tích, mục "Đơn vị giảm mạnh" lại có dòng TĂNG (+37%, +117%…) và mục
  "Đơn vị tăng mạnh" lại lòi ra dòng GIẢM (−28%).
- **Nguyên nhân:** `/analysis` chỉ lọc `prevRevenue>0` rồi sort theo `delta` và lấy top 10. Khi số đơn
  vị giảm < 10, danh sách "giảm" lấy bù bằng đơn vị TĂNG (và ngược lại) → lẫn lộn.
- **Sửa:** lọc đúng chiều — "tăng mạnh" chỉ `delta > 0`, "giảm mạnh" chỉ `delta < 0` (áp cho cả đơn vị
  và sản phẩm). Đã test dữ liệu mẫu: 0 dòng lẫn ở cả 2 danh sách.
- **File:** `server/src/routes.js` (route `/analysis`).

### 2026-07-08 (c) — Claude Code — FIX bot đòi mã RP hoài (map Telegram lệch giữa 2 tiến trình)
- **Triệu chứng:** CEO nhắn hỏi bot nhưng bot chỉ trả "Gửi mã đăng nhập dạng RP-XXXXXX…", không
  trả lời — dù trước đó đã nhận được digest (tức đã từng có trong map).
- **Nguyên nhân gốc:** `auth.js` giữ map Telegram trong RAM (`let tgMap` nạp 1 lần lúc khởi động).
  Backend `reportnew` và worker `reportnew-tgbot` là **2 TIẾN TRÌNH riêng** → thêm map ở tiến trình
  này thì tiến trình kia KHÔNG thấy (worker cứ đòi mã RP; digest sót), và 2 bên có thể **ghi đè** map
  của nhau bằng bản RAM cũ (mất map).
- **Sửa:** map Telegram nay lấy **FILE `data/auth/telegram_map.json` làm nguồn sự thật** — đọc thẳng
  file mỗi lần `resolveTelegram/listTelegramMap`, và `add/removeTelegramMap` dùng read-modify-write.
  Không còn RAM lệch, không còn ghi đè. (Đã test: tiến trình A ghi → tiến trình B thấy ngay + không mất.)
- **UX:** khi tài khoản CHƯA liên kết, bot trả về **mã Telegram (id)** của người hỏi để CEO/admin
  liên kết nhanh (thay vì câu cụt "gửi mã RP").
- **File:** `server/src/auth.js`, `server/telegram-bot.js`.
- **Việc còn lại (ops):** nếu file map trên server đang trống, cần thêm lại 1 dòng cho CEO
  (`auth.addTelegramMap('<telegram_id>','<mã CEO>','ceo')` hoặc route `POST /api/admin/telegram-map`).
  Sau fix này worker **không cần restart** vẫn nhận map mới.

### 2026-07-08 (b) — Claude Code — Bot TRA CỨU ĐÍCH DANH ĐƠN VỊ (bán bao nhiêu + AI bán)
- **Việc:** Hỏi theo MỘT đơn vị cụ thể (mã hoặc tên): **bán được bao nhiêu**, **AI bán** (NV nào),
  **top sản phẩm tại đơn vị**, số dòng cơ số + số sắp cạn. Nhận diện đơn vị theo mã (BV007), theo
  số (kể cả bỏ số 0: "17"→"017") và theo từ đặc trưng của tên.
- **Sửa xung đột:** câu "đơn vị X bán được **bao nhiêu**" trước đây bị mẫu "top đơn vị" bắt nhầm
  (vì "bao **nhiêu**" khớp "nhiều") → đã đưa các intent TRA CỨU ĐÍCH DANH (thuốc + đơn vị) lên TRƯỚC
  các mẫu "top…".
- **Quyền:** "ai bán" chỉ liệt kê trong `scope` — NV thường chỉ thấy CHÍNH MÌNH ("Bạn bán"); admin
  thấy tất cả NV bán ở đơn vị đó. Cắm vào facts LLM (`tra_cuu_don_vi`).
- **File:** `server/src/smart.js` (`lookupUnits`, `sayUnitLookup`, intent + reorder + menu).
- **Test:** node harness — "đơn vị BV007 bán bao nhiêu ai bán", "phòng khám mẫu 17…", "đơn vị 19…"
  ra đúng; "top đơn vị / báo cáo theo đơn vị / đơn vị nào chưa bán / giảm mạnh / nhà thầu / doanh thu
  kỳ này" GIỮ NGUYÊN; NV DN001 chỉ thấy phần mình.

### 2026-07-08 — Claude Code — Bot TRA CỨU ĐÍCH DANH thuốc/mã QLNB (giá thầu + cơ số còn lại)
- **Việc:** Thêm khả năng hỏi bot theo MỘT thuốc cụ thể (theo TÊN hoặc MÃ QLNB), trả lời gọn:
  doanh thu, số lượng, **giá thầu**, **cơ số còn lại** (SL/tổng + %), và **đơn vị nào đang bán**.
  - Nhận diện thuốc bằng "từ điển sản phẩm" trong phạm vi quyền (khớp mã QLNB, tên thuốc, hoạt chất,
    và mã ngắn kiểu B02/E05) — không cần cú pháp cứng.
  - Ưu tiên đúng: "giá thầu / doanh thu thuốc X" trả lời theo SẢN PHẨM, không rơi vào doanh thu tổng;
    các mẫu tổng hợp cũ ("top sản phẩm", "báo cáo theo từng sản phẩm") giữ nguyên.
  - Cắm cả vào FACTS đưa LLM (`tra_cuu_san_pham`) để LLM diễn giải sâu hơn khi hỏi lắt léo.
- **Lý do:** Sếp kiểm tra "giá thầu / mã QLNB / tên thuốc… bot trả lời rành rọt chưa" — trước đây 2 loại
  này (giá thầu + tra cứu đích danh 1 thuốc) chưa được surface, trả lời yếu.
- **Quyền:** dùng `store.getRows/getCst` theo `scope` — NV sale CHỈ thấy phần của mình (đã test: DN001
  chỉ thấy số + đơn vị của mình, không lộ NV khác). Không thêm PII vào bundle FE.
- **File:** `server/src/smart.js` (thêm `lookupProducts`, `sayProductLookup`, 2 intent tra cứu + cắm vào
  facts LLM + cập nhật menu/gợi ý).
- **Test:** node harness với dữ liệu mẫu — tra cứu theo tên (E05/B02) + mã (QLNB105) ra đúng số; câu
  chung ("doanh thu kỳ này") KHÔNG bị bắt nhầm; "top/ báo cáo theo sản phẩm" giữ nguyên; NV scope kín.
  (Giá thầu chỉ hiện khi dữ liệu CST có `bid_price` — server thật có; bản mẫu local chưa có nên bỏ dòng đó.)

### 2026-07-07 — Claude Code — Mở rộng "bộ số" đưa LLM → bot trả lời sâu/nhiều ngữ cảnh hơn
- `buildFacts` (dữ liệu app đưa cho LLM) nay giàu hơn nhiều, VẪN theo quyền (NV chỉ thấy mình):
  thêm **con_thieu_target + cần bán/ngày + tiến độ thời gian**, **xu hướng doanh thu 6 kỳ**,
  **top nhà thầu / gói thầu / tỉnh**, **đơn vị tăng/giảm mạnh**, **cơ số chưa bán**, và (chỉ admin)
  **danh sách TỪNG NV** (mã/tên/doanh thu/target/%đạt) + **NV chưa đạt**.
- LLM vẫn KHÔNG bịa số — chỉ diễn giải trên bộ số này → trả lời được nhiều tình huống (phân tích
  từng NV, so xu hướng, hỏi nhà thầu/tỉnh…).
- **Test:** các mảnh dữ liệu chạy đúng cho cả admin lẫn NV; NV KHÔNG lộ danh sách người khác.

### 2026-07-07 — Claude Code — LLM ĐÃ BẬT (hỏi tự nhiên) + dọn markdown tin Telegram
- ✅ **ANTHROPIC_API_KEY đã vào `.env`, `llm.isEnabled()=true`** — bot hiểu ngôn ngữ tự nhiên,
  số vẫn do code tính (không bịa). Verified: hỏi "NV nào đang dẫn đầu t07" → trả lời đúng NV + doanh thu.
- `formatAnswerForTelegram`: **bỏ ký hiệu markdown** (`**đậm**`, `*`, `` `code` ``, `#`, `- ` → `• `)
  vì Telegram gửi text thô → hết cảnh hiện dấu sao thô quanh tên.
- **Test:** `node -c` pass; stripMd bỏ đúng `**...**` và đổi gạch đầu dòng thành `•`.

### 2026-07-07 — Claude Code — Thêm mẫu câu "báo cáo theo từng đơn vị/sản phẩm/tổng hợp"
- `smart.answerQuestion` thêm 3 mẫu: **báo cáo theo từng đơn vị** (vd "báo cáo bán hàng theo từng
  mã đơn vị"), **theo từng sản phẩm**, **báo cáo tổng hợp/tổng quan** → bớt "đơ" cho câu kiểu báo cáo.
- **Lưu ý (thẳng):** vẫn là khớp-mẫu; muốn hiểu **ngôn ngữ tự nhiên bất kỳ** thì BẮT BUỘC bật LLM
  (`.env` đang thiếu `ANTHROPIC_API_KEY`). Đây là giới hạn bản chất của bot khớp-mẫu.
- **Test:** 4 câu báo cáo kiểu tự nhiên trả đúng breakdown; `node -c` pass.

### 2026-07-07 — Claude Code — FIX gốc: auto-deploy restart bot worker + sửa giờ digest
- **🐛 GỐC "bot không đổi":** `auto-deploy.sh` **chỉ restart `reportnew`**, KHÔNG restart
  `reportnew-tgbot` → bot Telegram chạy CODE CŨ mãi (mọi thay đổi câu hỏi/LLM/thông báo không tới).
  Fix: auto-deploy nay **restart luôn `reportnew-tgbot`** (biến `PM2_WORKER`, bỏ qua nếu chưa chạy).
- **🐛 Báo cáo lúc 1h30 (lệch múi giờ):** `startDigestScheduler` trừ dư 7 tiếng → bắn sớm 7h.
  Fix: so THẲNG giờ VN. Mặc định `DIGEST_CRON` đổi sang **`0 0 * * *` (nửa đêm giờ VN)**.
- **Test:** `bash -n` + `node -c` pass; kiểm 17:00 UTC = 00:00 VN → khớp cron `0 0` (bắn đúng nửa đêm).
- **Cần thủ công 1 lần:** thêm `ANTHROPIC_API_KEY` thật vào `.env` + `pm2 restart reportnew reportnew-tgbot`
  (từ lần deploy sau, worker tự restart).

### 2026-07-07 — Claude Code — Bot múi giờ GMT+7 + mở rộng nhiều nhóm câu hỏi
- **Múi giờ:** đặt `process.env.TZ = 'Asia/Ho_Chi_Minh'` ở đầu `index.js` + `telegram-bot.js`
  (cho env override) → mọi mốc thời gian/log/lịch theo GMT+7.
- **Mở rộng hỏi–đáp (`smart.answerQuestion`)** — trước chỉ loanh quanh doanh thu; nay thêm:
  top **nhà thầu / gói thầu / tỉnh**, **đơn vị giảm mạnh/tăng mạnh**, **NV chưa đạt** (admin),
  **đơn vị chưa bán**, **còn thiếu bao nhiêu để đạt target (+ cần ~X/ngày)**, **so kỳ trước**,
  **chào hỏi**, **menu "giúp"**. Fallback đổi thành **gợi ý đầy đủ** thay vì "đơ".
- **Test:** ~13 kiểu câu hỏi trả đúng số (code-first); giúp/help/menu ra menu; câu vô nghĩa ra gợi ý;
  TZ in GMT+0700. Áp cho cả bot Telegram lẫn "Hỏi nhanh" trong app (chung 1 engine).

### 2026-07-07 — Claude Code — GĐ2 Email: kênh Gmail/Workspace + gửi 2 kênh (Telegram + email)
- Thêm dep **nodemailer**. `notifyChannels`: `sendEmail()` qua SMTP (Gmail/Workspace) gated bằng env
  `SMTP_HOST/PORT/USER/PASS/FROM`; `emailFor(emp)` đọc **`server/data/nv_emails.json`** (bot điền,
  gitignored) → fallback `user.email`; `deliver()` gửi **cả Telegram + email**, ok nếu ≥1 kênh thành công.
- Các nút/worker gửi qua `deliver` (2 kênh): `/admin/notifications/send`, `/send-one`, `runTargetMilestones`.
  Guard đổi sang `anyReady()` (có Telegram HOẶC email là gửi được). Vẫn tôn trọng danh sách CHẶN + no_auto_notify.
- `config/nv_emails.example.json` (committed): mẫu định dạng cho bot.
- **Test:** emailReady=false khi thiếu SMTP; emailFor đọc file + fallback + loại email sai định dạng;
  deliver không kênh → ok=false; build web PASS.
- **Cần bot cấp:** SMTP env (Gmail app password) + tạo `server/data/nv_emails.json` (trích lục email phòng KD).

### 2026-07-07 — Claude Code — Danh sách CHẶN thông báo (DN021/DN023/VP004) ở tầng engine
- **`config/notify_optout.json`** (CEO chốt, committed): `codes: [DN021, DN023, VP004]` — tuyệt đối
  không nhận thông báo (Telegram + email + mọi kênh sau này).
- `targetNotify.isMuted(emp)`: chặn nếu mã trong config **HOẶC** user có cờ `no_auto_notify`.
- `pendingEvents` bỏ qua NV bị chặn → mọi nút/lịch (Gửi ngay, tự động, email GĐ2) đều loại tự nhiên.
  Endpoint `send-one` chặn thẳng với thông báo rõ. (Vẫn có thể hiện trong bản tổng gửi CEO để CEO nắm.)
- **Test:** isMuted đúng cho DN021/DN023/VP004; dù vượt 100% vẫn KHÔNG có sự kiện gửi; DN001 vẫn có.

### 2026-07-07 — Claude Code — Gửi ĐÍCH DANH 1 NV (test DN001/DN007)
- `targetNotify.statusFor(emp, ky)`: dựng tin trạng thái hiện tại của 1 NV bất kỳ (đạt %/còn thiếu/cần
  ngày + đúng/chậm nhịp) — không cần vừa vượt mốc.
- Route `POST /admin/notifications/send-one` (admin): gửi tin đó qua Telegram; báo lỗi rõ nếu NV chưa
  giao target / chưa liên kết Telegram / tắt nhận / app thiếu token.
- Màn "🔔 Thông báo": thêm ô nhập **mã NV** + nút **👤 Gửi cho 1 NV này** (mặc định DN001).
- **Test:** statusFor render đúng cho DN001, mã lạ → null; build web PASS.

### 2026-07-07 — Claude Code — Nút "Gửi ngay" + "Gửi thử cho tôi" (gửi chủ động) trên màn Thông báo
- Làm rõ 2 cách gửi: **Tự động** (bot theo giờ, `TARGET_NOTIFY=1`) và **Chủ động** (CEO bấm).
- `src/notifyChannels.js`: `sendTelegram()` dùng `TELEGRAM_BOT_TOKEN` của app (fetch api.telegram.org).
- Route `POST /admin/notifications/send`: `testOnly=true` → gửi thử bản tổng cho chính CEO; ngược lại
  gửi tin từng NV (mốc/chậm nhịp) + bản tổng cho admin, **đánh dấu đã gửi** (chống trùng với lịch tự động).
  Thiếu token → báo lỗi gọn (không crash).
- Màn "🔔 Thông báo": thêm nút **🧪 Gửi thử cho tôi** + **📤 Gửi ngay (N)** + giải thích 2 cơ chế.
- **Test:** build web PASS; endpoint báo lỗi gọn khi app chưa có token.

### 2026-07-07 — Claude Code — Màn "🔔 Thông báo" (xem trước) trong app cho CEO
- Thêm tab **🔔 Thông báo** ở trang Target (admin): gọi `/admin/notifications/preview` (DRY-RUN)
  → hiện **bản tổng gửi CEO** + **danh sách tin sẽ gửi cho từng NV** (mốc 50/90/100 hoặc chậm nhịp),
  kèm banner nhắc "chưa gửi gì; bật thật bằng TARGET_NOTIFY=1".
- Không gửi, không đổi trạng thái — chỉ để CEO duyệt trực quan trước khi bật.
- **Test:** build web PASS (preview API đã test 200 ở PR trước).

### 2026-07-07 — Claude Code — GĐ1 Thông báo target chủ động (engine + preview + worker gated)
- **`src/targetNotify.js` (engine):** tính %đạt từng NV theo kỳ + nhịp thời gian; phát hiện sự kiện
  **vượt mốc 50/90/100%** (1 lần/mốc/kỳ) + **"đang chậm nhịp"** (%đạt < %thời gian − 15%, tối đa
  1 lần/tuần). Chống spam bằng `data/notif_state.json` (gitignored). Soạn nội dung tin (dùng chung
  Telegram/email) + **bản tổng theo từng NV cho CEO** (`ceoDigest`).
- **API (CEO duyệt trước):** `GET /admin/notifications/preview?ky=` — DRY-RUN xem chính xác tin sẽ
  gửi, KHÔNG gửi/không đổi trạng thái.
- **Worker `telegram-bot.js`:** `runTargetMilestones()` + scheduler (giờ VN `TARGET_NOTIFY_HOURS`,
  mặc định 8,20) — **TẮT mặc định**, chỉ chạy khi `TARGET_NOTIFY=1`. Gửi Telegram cho NV có map
  + tôn trọng `no_auto_notify`/opt-out; đẩy CEO digest cho admin.
- **Email:** để GĐ2 (chờ thu thập email NV sale + cấu hình SMTP). Engine đã soạn nội dung sẵn dùng lại.
- **Test:** engine phát hiện mốc 50 đúng, chống spam OK (lần 2 = 0), CEO digest render; preview API 200.

### 2026-07-07 — Claude Code — Đợt 2: bấm NV → trang phân tích chi tiết từng NV
- Ở "Kỳ này", **bấm card 1 NV** → mở trang chi tiết NV đó (breadcrumb Target › Kỳ này › Tên NV):
  dải KPI (tháng+quý+pacing) theo NV, **xu hướng Target vs Đã đạt theo từng tháng** (thanh
  xám target / thanh màu đạt), **Top sản phẩm** + **Top đơn vị** của NV trong kỳ.
- Backend: route `GET /employee/detail?emp=&ky=` (NV thường khoá theo chính mình qua scope;
  admin xem NV bất kỳ). Tái dùng `revenueBreakdown` (top SP/ĐV) + `targetKpiSummary` (thêm
  tham số danh sách mã để tính theo 1 NV) + resolver target theo từng tháng.
- **Test:** build web PASS; HTTP `/employee/detail?emp=DN001` trả đúng emp/kpi/monthly(04→06)/
  top SP(8)/top ĐV(2).

### 2026-07-07 — Claude Code — TỐI ƯU tốc độ: cache dòng doanh thu + CST (Phân công/catalog chậm)
- **Nguyên nhân chậm:** `store.allRows()` ĐỌC LẠI file slot upload + `enrich` (có `provinceOf`)
  MỖI LẦN gọi; `getRowsRange` gọi nó **1 lần/kỳ** → `catalog/sales?all=1` (mọi kỳ) đọc+enrich
  toàn bộ dòng **N lần/1 request**. `getCst` cũng đọc lại + merge + enrich mỗi lần.
- **Sửa:** cache `allRows()` theo chữ ký slot (id+kỳ+mtime); cache `getCstAll()` theo mtime
  `cst_real.json` + chữ ký slot; memo `provinceOf` theo (mã|tên). Cache tự hết hạn khi
  upload/kỳ đổi (mtime) hoặc `clearCache()`. KHÔNG đổi kết quả.
- **Test:** getCst/getRowsRange trả y hệt; province 4/4 đúng; đường dẫn cache 0,09ms/lần (demo).
  Lợi ích lớn trên server thật (nhiều dòng upload).

### 2026-07-07 — Claude Code — Dải KPI target ở "Kỳ này" + "Phân tích" + card NV giàu hơn
- Tách component chung `TargetKpiStrip` (tháng+quý+tiến độ thời gian), dùng ở **Quản target,
  Kỳ này, Phân tích** (đồng bộ 1 kiểu).
- Backend: `/targets` trả thêm `kpi`; thêm route `GET /targets/kpi` (theo scope) cho trang Phân tích.
- Card từng NV ở "Kỳ này": thêm dòng **"còn thiếu … · N ngày → cần ~X/ngày để kịp"** (theo pacing),
  hoặc **"✅ đã đạt/vượt"**.
- **Test:** build web PASS; HTTP `/targets/kpi` + `/targets` trả đúng kpi (quý Q2=04+05+06).

### 2026-07-07 — Claude Code — Dải KPI ở trang Quản target (target & đã đạt: tháng + quý)
- Đầu trang **Quản target** thêm 4 ô KPI: **Target giao tháng**, **Đã đạt trong tháng**
  (kèm % target + tiến độ thời gian ngày/tháng), **Target giao quý** (gộp 3 tháng của quý),
  **Đã đạt trong quý** (% target quý). Ô "đã đạt" đổi màu ok/warn theo việc %đạt có bắt
  kịp %thời gian đã trôi hay không.
- Backend: `/admin/targets` trả thêm `kpi` (targetKpiSummary: target tháng/quý từ resolver,
  doanh thu thực before-VAT của roster theo tháng/quý, pacing thời gian).
- **Test:** build web PASS; HTTP `/admin/targets` trả đúng `kpi`; đối chiếu quý Q2 = 04+05+06,
  đã đạt quý > tháng khớp số.

### 2026-07-07 — Claude Code — Nút "🗑️ Gỡ sửa tay" trên card target
- Mỗi NV nếu target đang dùng là **Sửa tay đè lên nguồn khác** (upload/nhân bản/AI) thì
  hiện nút **"🗑️ Gỡ sửa tay"** cạnh "Sửa tay". Bấm 1 phát → bỏ override → tự quay về
  nguồn kế, KHỎI phải nhờ bot rollback (như vụ DN001).
- Backend: `resolveTargets` thêm tuỳ chọn `excludeSources` để tính "nguồn thay thế";
  `overrideInfo` gắn cờ `manual_override` + nguồn/số sẽ quay về; `clearManualOverride`
  gỡ mọi entry manual active của NV/kỳ (audit `target_manual_clear`); route
  `POST /admin/targets/manual/clear`. `targetMatrix` trả kèm cờ cho UI.
- Xác nhận trước khi gỡ, nói rõ "sẽ quay về: Upload 2,3 tỷ".
- **Test:** build web PASS; smoke test: manual 0 đè upload 2,3 tỷ → gỡ → về upload 2,3 tỷ.

### 2026-07-07 — Claude Code — Nhân bản target sang kỳ sau + chặn Sửa tay ghi 0 nhầm
- **Nút "📤 Nhân bản target sang kỳ sau":** copy toàn bộ target đang dùng của kỳ nguồn
  sang kỳ đích (KHÔNG cần file), rồi Sửa tay vài NV là xong. Nguồn mới `carryover`
  (ngang upload, dưới manual — Sửa tay không bị đè). Backend `targetAdmin.carryOverTargets`
  + route `POST /admin/targets/carryover`; mặc định **chỉ điền NV kỳ đích chưa giao**
  (tick để ghi đè). Sau khi nhân bản tự chuyển sang kỳ đích để sửa tay. Test: nhân bản
  07→09 đúng số + nguồn carryover; chạy lại (không đè) skip đúng; rollback theo batch OK.
- **Chặn "Sửa tay" ghi target = 0 do bỏ trống (vụ DN001):** ô Sửa tay bỏ trống nay =
  HUỶ (không ghi đè về 0); nhập 0 phải xác nhận; số không hợp lệ báo lỗi. Trước đây xoá
  trắng rồi OK là ghi 0 → đè cả upload → NV thành "Chưa giao".
- **Nhãn nguồn dễ đọc:** `carryover→"Nhân bản kỳ trước"`, `upload→"Upload"`, `manual→"Sửa tay"`.
- **Test:** build web PASS; smoke test carryover + rollback. Chờ merge `main`.

### 2026-07-07 — Claude Code — 3 fix từ ảnh Sếp: đoán tỉnh viết tắt, chọn nhiều gói thầu, mã ĐV lặp
- **Fix 1 — "Không tìm thấy CST còn lại" (lọc tỉnh + đơn vị ra 0 dòng):** đơn vị thật
  hay viết tắt tỉnh ở đuôi tên (vd `011.BV Cao Su ĐN`) nên đoán tỉnh CŨ trả rỗng →
  lọc tỉnh Đồng Nai loại luôn đơn vị đó. `province.js`: nhận diện **viết tắt dạng
  token** (`ĐN`→Đồng Nai, `BP`→Bình Phước) + fallback đoán trên **mã đơn vị** khi tên
  trống. Test: `BV Cao Su ĐN`→Đồng Nai, `TTYT Bù Đăng BP`→Bình Phước; `DNA` KHÔNG dính.
- **Fix 2 — Chọn NHIỀU gói thầu:** thêm component `MultiSelect` (lưu chuỗi nối `|`,
  serialize params không đổi); thay ô chọn gói thầu 1-giá-trị ở **Cơ số thầu** và
  **Doanh thu/DT đầy đủ/Sản phẩm**. Backend `analytics.bidMatch` tách `|`, khớp nếu
  thuộc BẤT KỲ gói nào chọn (dùng ở `applyFilters` + `cstTable`). Test: 1 gói 45 dòng,
  2 gói 90 dòng, đều đúng.
- **Fix 3 — Mã đơn vị lặp 2 lần** (`011.BV Cao Su ĐN · 011.BV Cao Su ĐN`): `optionLabel`
  bỏ lặp khi mã đã chứa/bằng tên → chỉ hiện 1 lần.
- **Test:** build web PASS; smoke test analytics (province + multi-bid). Chờ merge `main`.

### 2026-07-07 — Claude Code — Lọc tỉnh cho CST + mở rộng đoán tỉnh + QR Zalo trong app
- **Mục 1 — Lọc tỉnh/thành cho Cơ số thầu (CST):** dòng CST nay được gắn `province`
  (giống dòng doanh thu) trong `store.getCst`; thêm lọc tỉnh ở `cstTable`, truyền
  param `province` ở route `/cst` và export CST; `/filters` gộp cả CST vào danh sách
  tỉnh. Frontend `TenderQuota.jsx` thêm ô chọn tỉnh + đếm lọc. **Test HTTP thật:**
  `/cst?province=Đồng Nai` → 34/34 dòng đúng tỉnh; `/filters` liệt kê Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu.
- **Mục 2 — Mở rộng đoán tỉnh theo tên đơn vị:** `province.js` thêm nhiều tỉnh miền
  Nam/lân cận (BR-VT, Bình Dương, TP.HCM, Long An, Tây Ninh, Lâm Đồng, Bình Thuận,
  Ninh Thuận, Đắk Nông, Đắk Lắk, Tiền Giang) — chỉ dùng TÊN TỈNH + TP/huyện KHÔNG
  trùng tên (tránh 'châu thành', 'tân châu'…). 14/14 case đúng, không hồi quy. ⇒ ít
  đơn vị rơi vào "Chưa gán tỉnh"; phần còn lại bot chạy `scripts/list_unmapped_provinces.js`
  trên server rồi điền `unit_province.json`.
- **Mục 3 — QR Zalo OA trong app + icon:** thêm `ZaloCard` (QR `zalo-oa-qr.png`) ở
  cuối trang Tổng quan (trước chỉ có ở màn Login). **Icon home-screen** đã là logo DP
  đúng (`app-icon-180/512.png`) — hình "chữ A" Sếp thấy trước đó là icon mặc định CŨ
  bị cache; nút "Có bản mới"/gỡ-thêm lại app 1 lần là hết.
- **Test:** `npm run build` web PASS; smoke test API trên cổng tạm 3899 (KHÔNG đụng
  3873/3860). Trạng thái: chờ merge `main`.

### 2026-07-07 — Claude Code — Auto-deploy TỰ GỠ KẸT khi working tree dirty (#37)
- **Vấn đề:** `scripts/auto-deploy.sh` có guard "tree dirty → BỎ QUA im lặng",
  kẹt **vô thời hạn** → Sếp thấy "không có thay đổi" trên iPhone dù đã merge code.
- **Đã xác minh:** KHÔNG có code app ghi vào file tracked lúc chạy (`targetAdmin.js`
  chỉ ghi `target_entries/target_audit.json` — gitignored; `target_baseline_202606`
  & `target_roster` chỉ ĐỌC). ⇒ tree dirty đến từ sửa tay/việc dở chưa commit.
- **Sửa:** (1) LUÔN ghi rõ file nào dirty vào log (`git status --short`); (2) cửa
  thoát: dirty > `STALE_SECS` (mặc định 15') coi là KẸT → `git stash` (khôi phục
  được) rồi deploy tiếp; (3) tree sạch → xoá mốc `.auto-deploy.dirty-since`.
- **Test:** `bash -n` pass. Bot tự áp bản mới ở lượt cron kế (tree đã sạch sau
  reset của Sếp). Trạng thái: đã merge `main` (ee62dd8).

### 2026-07-07 — Claude Code — Tiêu đề nổi bật + KPI thấp gọn + lọc mặc định ẩn
- **Tiêu đề trang** (crumb active): chip xanh gradient chữ trắng cho nổi bật (cả
  base lẫn media mobile). `styles.css .drill-crumbs button.active`.
- **Chiều cao ô KPI**: hạ padding (9→6px), thắt line-height label/value/delta +
  money-big, giảm value 19→18px → bớt dư chiều cao.
- **Bộ lọc mặc định ẨN** ở mọi màn có lọc: `useCollapse` (Phân tích, Cơ số thầu)
  + collapse nội bộ của `RevenueFilters` (Doanh thu, DT đầy đủ, Sản phẩm) đổi
  mặc định về đóng; nhấn "▾ Bộ lọc" mở, nhấn "▴ Thu gọn lọc" thu lại.
- Nghiệm thu: build OK; kiểm headless: tiêu đề chip xanh, KPI gọn hơn, filter-toggle
  hiện "▾ Bộ lọc" (đang ẩn) khi vào trang.

### 2026-07-07 — Claude Code — Bộ lọc TỈNH/THÀNH (Đồng Nai, Bình Phước, …)
- CEO cần lọc theo tỉnh. Dữ liệu chưa có trường tỉnh → thêm nguồn tỉnh:
  1) `row.province` nếu upload có cột "Tỉnh" (thêm alias trong upload.js);
  2) map chính thức `server/config/unit_province.json` (unit_code→tỉnh, bot điền);
  3) đoán theo tên đơn vị (`server/src/province.js` — Đồng Nai/Bình Phước + huyện).
- `store.enrich`: gắn `province` vào mỗi dòng. `analytics.applyFilters`: lọc theo
  `province`. `/filters`: trả `provinces`. `revenueFiltersFromQuery`: thêm province.
- Frontend: dropdown gọn "Tất cả tỉnh/thành" ở thanh lọc (Doanh thu, DT đầy đủ,
  Sản phẩm qua RevenueFilters; và Phân tích). `emptyRevenueFilters` thêm province.
- `scripts/list_unmapped_provinces.js`: liệt kê đơn vị chưa có tỉnh để bot điền nhanh.
- Demo: `server/config/unit_province.json` gán sẵn 20 đơn vị mẫu (Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu) để lọc chạy ngay.
- **‼ Trên dữ liệu THẬT:** nhiều đơn vị tự nhận tỉnh theo tên; đơn vị còn lại bot
  chạy `node scripts/list_unmapped_provinces.js` rồi điền vào `unit_province.json`
  (hoặc thêm cột "Tỉnh" vào file upload hàng tháng).
- Nghiệm thu: node --check backend OK, build OK, dropdown hiện 3 tỉnh + lọc chạy.

### 2026-07-07 — Claude Code — Nút gạt "Tháng liền trước ↔ Cùng kỳ năm ngoái" (làm sẵn)
- CEO muốn làm sẵn: sang 2027 thì so tăng/giảm với 2026 (cùng kỳ năm ngoái).
- `store.comparePeriods(kys, mode)`: thêm `mode='yoy'` — lấy cùng tháng năm trước
  (T06/2027→T06/2026). Nếu chưa có dữ liệu năm trước → `yoyMissing=true`.
- `/alerts` + `/analysis`: nhận `compareMode` (prev|yoy); note đổi theo mode
  ("So tháng liền trước…" / "So cùng kỳ năm ngoái…" / "Chưa có dữ liệu cùng kỳ…").
- Overview + Analysis: thêm nút gạt **[Tháng liền trước] [Cùng kỳ năm ngoái]**
  (nhớ lựa chọn qua localStorage `rpt_cmp_mode`). Mặc định "Tháng liền trước".
- Hiện data mới có 2026 → chọn "Cùng kỳ năm ngoái" báo rõ "chưa có dữ liệu 2025";
  khi bot nạp dữ liệu năm trước là tự chạy, không cần sửa code.
- Nghiệm thu: node --check backend OK, build OK, kiểm headless nút gạt + note YoY.

### 2026-07-07 — Claude Code — Nút "Có bản mới — bấm để cập nhật" (hết kẹt cache iOS)
- **Vấn đề:** iOS giữ cache PWA rất lì → sau deploy, NV cứ hỏi "sao dữ liệu chưa đổi",
  phải xoá–thêm lại app thủ công.
- **Giải pháp:** app tự phát hiện bản mới và mời cập nhật:
  - `vite.config.js`: plugin `emit-version-json` xuất `/version.json` (SHA + giờ build).
  - `index.js`: phục vụ `version.json` với `no-cache`.
  - `UpdateBanner` (components): định kỳ 60s + mỗi khi quay lại app, fetch
    `/version.json?_=ts` (no-store); nếu version khác `__BUILD_VER__` đang chạy →
    hiện nút xanh nổi **"🔄 Có bản mới — bấm để cập nhật"**. Bấm → `location.replace('?v=<ver>')`
    (đổi URL để phá cache iOS) → tải bản mới.
- Nghiệm thu: build ra `version.json` đúng SHA, header no-cache OK; test giả lập
  version khác → nút hiện; version trùng → không hiện.

### 2026-07-07 — Claude Code — So sánh tăng/giảm CÔNG BẰNG + ghi rõ mốc (①+②)
- **Vấn đề (CEO nêu):** "so kỳ trước" đang lấy CẢ kỳ này (tháng dở, mới vài
  ngày theo mốc "Cập nhật đến") so với CẢ tháng trước (đủ) → hầu hết đơn vị hiện
  "giảm 90–100%" ảo. (Bằng chứng: cập nhật thêm ngày thì % giảm nhỏ lại 82,6%→76,2%.)
- **② So công bằng:** thêm `store.comparePeriods(kys)` — nếu kỳ đang xem chạm
  THÁNG HIỆN TẠI (chưa đủ) thì tự lùi về **2 tháng đã HOÀN TẤT** gần nhất (vd
  T07 dở → so T06 với T05). Áp cho: nhóm tăng/giảm ở Tổng quan (`smart.js`) và
  bảng tăng/giảm ở Phân tích (`routes.js /analysis`).
- **① Ghi rõ mốc:** mỗi mục tăng/giảm hiện dòng chú thích "So sánh T06/2026 với
  T05/2026"; nếu phải lùi kỳ thì hiện cảnh báo vàng "⚠ Tháng đang xem chưa đủ
  ngày — đang so 2 tháng đã hoàn tất…". CSS `.alert-group-note(.warn)`.
- KPI "Doanh thu {kỳ}"/"So với {kỳ trước}" ở Phân tích GIỮ theo kỳ Sếp chọn
  (số thô trung thực); chỉ bảng tăng/giảm tự lùi kỳ cho đúng bản chất.
- Nghiệm thu: `node --check` store/smart/routes OK, build OK, kiểm headless thấy
  note trên cả Tổng quan lẫn Phân tích.

### 2026-07-07 — Claude Code — Thêm "Đơn vị tăng trưởng mạnh" + chip mũi tên
- **Tổng quan:** thêm nhóm cảnh báo `unit_up` "Đơn vị tăng trưởng mạnh (so kỳ
  trước)" (MoM ≥ +15%), đặt NGAY TRÊN nhóm "giảm mạnh"; viền xanh (tone `ok`),
  📈, mỗi dòng có chip xanh **▲ Tăng x%**. Thanh tóm tắt thêm "x đơn vị tăng".
  `count` (Cần chú ý) KHÔNG tính unit_up (tin vui, không phải cảnh báo); mục
  cảnh báo hiện khi có bất kỳ nhóm nào có dữ liệu.
- **Phân tích:** `DeltaRow` thêm chip **▲ Tăng %** (xanh) / **▼ Giảm %** (đỏ)
  cho từng dòng ở các block tăng/giảm (đơn vị + sản phẩm).
- `smart.js`: gom cả tăng & giảm trong 1 vòng; sort unit tăng giảm dần theo %.
- Nghiệm thu: `node --check` smart.js OK, build OK, kiểm headless thấy mục tăng
  trưởng + chip xanh trên cả Tổng quan lẫn Phân tích.

### 2026-07-05 — Claude Code — Dựng lại bản Tổng quan "màu chuẩn CEO" (đưa vào git)
- **Bối cảnh:** Bản Tổng quan nhiều màu + đồng hồ (bot làm trên server) **chưa từng
  push lên GitHub**. Các lệnh deploy `git reset --hard origin/main` (untrack-data +
  auto-deploy) ép giống main nên **xoá mất bản local đó** → về bản trắng. CEO gửi ảnh
  yêu cầu khôi phục.
- **Sửa (commit thẳng vào repo để KHÔNG mất lần nữa):**
  - `Kpi` thêm prop `variant` (blue/purple/green/red/amber) + `icon` (góc phải).
  - `Clock` mới: đồng hồ chạy giây (giờ VN) trên header mobile + topbar desktop.
  - Overview: 6 ô KPI tô màu đúng ảnh chuẩn (Doanh thu xanh dương ⚠️/📊 theo tăng-giảm,
    Trước VAT tím 🧾, Đạt target + NV đạt target xanh lá 🎯, Cơ số thầu đỏ ⚠️, Quy mô
    kỳ vàng 🗺️); số Doanh thu/Trước VAT hiện 2 dòng (gọn + đầy đủ) qua `MoneyBig`.
  - CSS: `.kpi.k-*` (viền trái đậm + nền tô nhạt + số theo màu), `.kpi-ic`, `.clock-pill`.
- Nghiệm thu: build OK; kiểm headless mobile 390px khớp 1:1 ảnh CEO (đồng hồ + 6 ô màu).
- **‼ Bài học:** mọi thay đổi giao diện của bot PHẢI push lên `main`, nếu không lần
  deploy kế tiếp (`reset --hard`/auto-deploy) sẽ xoá. Nay bản màu đã nằm trong git.

### 2026-07-03 — Claude Code — Auto-deploy (server tự cập nhật khi main đổi)
- Thêm `scripts/auto-deploy.sh` + hướng dẫn cron (mỗi 1 phút). Merge lên `main`
  là server tự: fetch → (fast-forward mới đi tiếp) → reset --hard → build → restart
  PM2. Hết cảnh copy-paste lệnh deploy.
- **An toàn:** flock chống chạy chồng; chỉ deploy khi HEAD là tổ tiên origin/main
  (không đè commit local chưa push của bot); bỏ qua nếu tree có thay đổi tracked
  chưa commit; **build ra thư mục tạm rồi mới tráo** — build lỗi thì giữ nguyên
  bản đang chạy, không restart. Cài lại deps nếu package(-lock).json đổi.
- `.gitignore`: thêm `web/dist.new/`, `web/dist.old/`, `.auto-deploy.lock`.
- Đường repo trên server: `~/.openclaw/workspace-report/App-report-new` (đặt qua
  biến REPO_DIR nếu khác). Log ghi ở `auto-deploy.log`.
- Nghiệm thu: `bash -n` OK; thử `build -- --outDir dist.new` tạo đủ dist (index +
  assets + manifest + icon). **Cần cài cron 1 lần trên server để kích hoạt.**

### 2026-07-03 — Claude Code — ‼ AN TOÀN DỮ LIỆU: gỡ 4 file runtime khỏi git
- **Vấn đề:** 4 file dữ liệu người dùng GHI lúc chạy vẫn bị track trong repo:
  `assignments.json`, `assignment_audit.json`, `target_adjustments.json`,
  `target_adjustment_audit.json`. Deploy dùng `git reset --hard origin/main`
  → mỗi lần deploy **ghi đè** chúng bằng bản cũ trong repo ⇒ nguy cơ **mất**
  phân công / điều chỉnh target người dùng vừa nhập.
- **Sửa:** `git rm --cached` 4 file (file vẫn nằm trên đĩa server). `.gitignore`
  đã có sẵn pattern `server/data/*.json` nên từ nay git không đụng chúng nữa;
  dữ liệu người dùng nằm yên trên server qua mọi lần deploy.
- **GIỮ track (chỉ đọc, cấu hình versioned):** `target_baseline_202606.json`,
  `target_roster.json`, `sample_upload.xlsx`.
- **‼ DEPLOY LẦN NÀY PHẢI THEO QUY TRÌNH AN TOÀN** (sao lưu → cập nhật → phục hồi
  → build → restart) vì cú `git reset --hard` kế tiếp sẽ xoá 4 file khỏi working
  tree (do commit này bỏ chúng khỏi index). Xem prompt deploy an toàn kèm theo.
  Từ deploy sau trở đi thì bình thường, không cần bước sao lưu nữa.

### 2026-07-03 — Claude Code — Dấu mốc bản build ở màn login (PR mới)
- **Vấn đề:** Sau deploy, khó biết bản web đang chạy là bản nào (bot `git pull` nhưng dist là artifact — không rebuild thì UI vẫn cũ; cộng cache PWA → "hình như vẫn bản cũ").
- **Sửa:** `vite.config.js` inject `__BUILD_VER__` (SHA commit, hoặc `BUILD_VER` env) + `__BUILD_AT__` (giờ build) lúc build; màn Login hiện dòng mờ `Bản <sha> · build <giờ>`. Mở site (kể cả chế độ Riêng tư) là biết ngay bản nào đang live, hết mơ hồ.
- Nghiệm thu: `npm run build` OK, kiểm headless thấy `Bản efc50d7 · build 22:39 03-07`.
- **‼ Nhắc bot:** `git pull` KHÔNG đủ để đổi UI — PHẢI `npm --prefix web run build` rồi `pm2 restart reportnew`. dist bị .gitignore nên không tự cập nhật theo git.

### 2026-07-03 — Claude Code — Mobile/PWA polish (PR #14)
- **Số lớn luôn hiện đủ:** bỏ cơ chế "chạm để đổi" (không đáng tin trên PWA khi kẹt cache) → `MoneyBig` luôn hiện số gọn (`4,76 tỷ`) kèm số đầy đủ (`4.758.211.000đ`) ngay bên dưới. File: `web/src/components.jsx`, `web/src/styles.css`.
- **Nút bottom-nav cao hơn đáy:** tăng padding đáy nav + cộng `safe-area-inset-bottom`, `.page` chừa thêm chỗ → icon dễ chạm hơn trên máy có gesture bar. File: `web/src/styles.css`.
- **Hết kẹt bản cũ (PWA cache):** `index.html` + `.webmanifest` trả `Cache-Control: no-cache, must-revalidate`; asset có hash tên (`/assets/*`) cache dài `immutable`. Sau deploy, PWA luôn lấy shell mới. File: `server/src/index.js`.
- Nhãn KPI "Trước VAT" ghi rõ `đã ÷ 1,05`. File: `web/src/pages/Overview.jsx`.
- Nghiệm thu: `node --check` index.js OK, `npm run build` OK, kiểm tra headless mobile 390px (số hiện đủ 2 dòng, header no-cache xác nhận). **Bot cần `git pull` + `npm --prefix web run build` + `pm2 restart reportnew` để áp.**

### 2026-07-03 — Bot triển khai (Report Bot) — TARGET_ADJUSTMENT GĐ2a
- Đã implement `DIRECTIVE_TARGET_ADJUSTMENT.md` GĐ2a, chưa làm GĐ2b multidimensional.
- Thêm module `server/src/targetAdjustment.js`, lưu `server/data/target_adjustments.json` + audit `target_adjustment_audit.json`: lý do `dut_hang`/`cong_no`/`khac`, số tiền ảnh hưởng, trạng thái `pending/approved/rejected`, người đề xuất/duyệt.
- API: `/target-adjustments`, `/admin/target-adjustments/:id/approve|reject`, `/admin/target-adjustments/suggestions`; chỉ adjustment `approved` mới hạ target chính thức.
- `/targets` trả thêm target gốc, target sau điều chỉnh, `% đạt gốc`, `% đạt sau điều chỉnh`, gap sau điều chỉnh, tổng giảm theo lý do.
- UI Target thêm tab `Điều chỉnh`: NV/admin ghi lý do, admin xem gợi ý Hết CST/còn nợ, duyệt/từ chối; thẻ target hiển thị 2 dòng % đạt và số đã trừ theo lý do.
- Gợi ý tự động: đứt hàng lấy draft từ CST hết/cạn; công nợ ghi rõ thiếu nguồn WEB partner nên tạo draft 0 để CEO nhập/duyệt, không tự áp.
- Nghiệm thu: `node -c` routes/targetAdjustment OK, `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — SỬA nhà thầu: chỉ 1 tên theo (mã QLNB + mã nhà thầu)
- CEO: thẻ đang nối HẾT tên biến thể của 1 mã nhà thầu (dài/rối/sai, VD Ediwel). → sửa: **thẻ chỉ hiện 1 TÊN**, khóa tra `(iit_code + contractor_code) → 1 tên` (ưu tiên contractor_name của dòng; else tên đại diện cặp); **không nối "/"**. Ô lọc giữ gom theo mã nhưng nhãn 1 tên đại diện. Áp mọi thẻ + Danh mục tổng (GĐ1). Ghi `DIRECTIVE_CARD_V2.md`.
- Soạn trước trong khi chờ GĐ1. → [`DIRECTIVE_TARGET_MULTIDIM.md`](DIRECTIVE_TARGET_MULTIDIM.md).
- **Cốt lõi:** các chiều là **kính lọc CHỒNG NHAU** (1 giao dịch tính vào nhiều target: tổng+nhóm+đơn vị+tuyến) → **KHÔNG cộng dồn %đạt**; target chi tiết là **tùy chọn** (đặt ở chiều muốn nhấn, còn lại roll-up tổng).
- Dùng `scope{type,value}`; nhập target chọn chiều + template thêm cột scope; %đạt lọc doanh thu theo chiều (`route/unit/iit/priority` đã có); special "hàng cần đẩy" resolve thành tập mã (CST/doanh số). Thẻ NV bung theo chiều đã đặt; cảnh báo lệch trong CÙNG chiều (không chéo).

### 2026-07-03 — Bot triển khai (Report Bot) — SPEC_TARGET_ASSIGNMENT GĐ1
- Đã `git pull origin main`, đọc `SPEC_TARGET_ASSIGNMENT.md`; chỉ làm GĐ1, chưa làm target chi tiết GĐ2/thưởng GĐ3.
- Thêm danh mục bán hàng tổng `/api/catalog/sales`: hợp nhất SP, hoạt chất/hàm lượng, nhóm UT, tuyến, gói, nhà thầu mã-tên, giá thầu, CST còn.
- Thêm model phân công `assignment{id, emp_code, type, value, from_ky, to_ky, active, note, by, at}` + `source`/`special_kind`, lưu `server/data/assignments.json`, audit `assignment_audit.json`; gieo mầm 1.687 phân công auto từ lịch sử 04-06/2026 hiệu lực từ 07.2026.
- Thêm API admin/mine/special: CEO xem-sửa-thêm-ngưng hiệu lực + audit; NV chỉ thấy `/assignments/mine` theo session; upload Excel backend cho phân công.
- Thêm UI Target: tab `Phân công` cho admin và `Tôi phụ trách` cho NV/admin; special `tồn nhiều`/`hàng ngách` auto, `cận date` và `sắp hết thầu-CST lớn` ghi rõ thiếu nguồn hạn dùng/hạn gói thầu để CEO chọn thủ công.
- Review độc lập sau GĐ1 yêu cầu bổ sung: đã thêm UI/client upload Excel phân công, nút Sửa nạp dòng hiện có vào form, hiển thị `hang_ngach` trong “Tôi phụ trách”, seed lại auto có thêm `all`/`group` (tổng 1.808 dòng: all 22, group 99, iit 1328, route 45, unit 314), và `/catalog/sales` lọc theo assignment cho NV thường.
- Nghiệm thu: `node -c` routes/assignmentAdmin OK, `npm run build` OK, restart `reportnew` OK, health local/public OK; API catalog/admin/mine/special/history OK; UI Phân công render catalog 342 mã + phân công auto.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec điều chỉnh target theo lý do (đứt hàng/công nợ)
- CEO: cần ghi lý do không đạt (đứt hàng/công nợ) để hạ tỷ lệ target tháng đó + phân tích. → [`DIRECTIVE_TARGET_ADJUSTMENT.md`](DIRECTIVE_TARGET_ADJUSTMENT.md) (thuộc Target GĐ2).
- Model `target_adjustment{emp_code,ky,reason_type,impact_amount,status,...}`; **CEO DUYỆT mới áp**. Target điều chỉnh = target gốc − Σ impact duyệt; thẻ hiện %đạt gốc + %đạt sau điều chỉnh + "đã trừ đứt hàng X/công nợ Y". Gợi ý tự động từ Hết CST (đứt hàng) + "còn nợ chưa giao" (công nợ), CEO duyệt. Phân tích tổng hợp mất theo lý do.
- CEO: làm luôn kế hoạch target chi tiết + danh mục NV phụ trách. → [`SPEC_TARGET_ASSIGNMENT.md`](SPEC_TARGET_ASSIGNMENT.md) (3 giai đoạn).
- **GĐ1 (làm trước):** Danh mục bán hàng tổng + bảng PHÂN CÔNG (`assignment{emp_code,type,value,hiệu lực}`) — **gieo mầm tự động từ lịch sử bán** (NV↔đơn vị/SP), CEO sửa tay; màn "Tôi phụ trách" cho NV. Không hồi tố + audit.
- **GĐ2:** Target theo CHIỀU (nhóm H.A*/tuyến/đơn vị/QLNB/đặc biệt) dùng field `scope` đã có; %đạt tính theo đúng chiều; kỳ đang chạy pro-rate.
- **GĐ3 (sau):** Thưởng bậc thang (duyệt mới gửi).
- **Chờ CEO chốt:** chiều phân công chính (đề xuất Đơn vị + Nhóm UT + Tuyến); gieo mầm từ lịch sử (04–06/2026)?
- Đã `git pull origin main`, đọc mục FIX trong `DIRECTIVE_CARD_V2.md`.
- Enrich metadata theo `iit_code` từ CST/filter vào thẻ: hoạt chất+hàm lượng cho QĐ139, giá trúng thầu, ưu tiên, nhà thầu mã-tên, tuyến/đơn vị/NV cho Sản phẩm · DT đầy đủ · Doanh thu.
- Frontend không ẩn field bắt buộc: nếu thật sự thiếu nguồn sẽ hiện `Thiếu nguồn ...`; kỳ T07 mẫu đã đủ giá/UT/hoạt chất.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Đã mở từng tab và chụp 1 thẻ: `verification-screenshots/card-v2-fix/products-card-8-fields.png`, `revenue-full-card-8-fields.png`, `revenue-card-8-fields.png`; manifest đối chiếu tại `card-v2-fix-manifest.json`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.

### 2026-07-03 — Bot triển khai (Report Bot) — Card V2 bổ sung nhà thầu MÃ-TÊN
- Bổ sung lookup dùng chung mã nhà thầu → tên đầy đủ từ dữ liệu filter/phân tích hiện có; hỗ trợ nguồn legacy có tên công ty nằm trong `contractor_code` và nguồn App Sale chỉ có mã ngắn như `AFP`/`DONA`.
- API `/filters`, `/revenue/full`, `/products`, `/cst` enrich `contractor_name`; thẻ tiếp tục dùng `pairText()` nên chỉ hiện mã trần khi thật sự không tìm được tên.
- Nghiệm thu live: `AFP - Công Ty Tnhh Afp Pharma`, `DONA - Công Ty Tnhh Dược Phẩm Donapharm` xuất hiện trong filter, DT đầy đủ và Sản phẩm; `npm run build` OK, restart `reportnew` OK, health local/public OK.

### 2026-07-03 — Bot triển khai (Report Bot) — Layout Smart: Quản target content-first
- Đã `git pull origin main`, đọc `DIRECTIVE_LAYOUT_SMART.md`; không đụng app cũ `dona-report` port 3860.
- Quản target đổi sang bố cục content-first: bỏ period card/form dài riêng, kỳ target nằm compact trong toolbar; danh sách 21 NV/CTV lên ngay dưới thanh công cụ.
- Gom công cụ phụ thành 1 toolbar: `Template`, `Upload`, `Nhập theo Quý`, `AI đề xuất`, `Rollback`; các form nặng mở modal/drawer và giữ đủ chức năng cũ.
- Đoạn resolver dài chuyển thành icon `ⓘ` tooltip. Thêm CSS modal/drawer và toolbar tái dùng được cho các màn khác khi áp nguyên tắc content-first tiếp.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Screenshot trước/sau: `verification-screenshots/layout-smart/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive bố cục "smart app" (nội dung chính nổi bật)
### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.
- CEO: Quản target công cụ phụ chiếm >1/2 màn hình, đẩy danh sách chính xuống đáy. → [`DIRECTIVE_LAYOUT_SMART.md`](DIRECTIVE_LAYOUT_SMART.md).
- **Nguyên tắc toàn app:** nội dung chính ~70–80% màn hình + hiện ngay; công cụ phụ gom **1 thanh nút gọn**; form nặng mở **modal/drawer** khi bấm; chữ dài → **icon ⓘ tooltip**.
- **Áp ngay Quản target:** thanh nút [Template][Upload][Nhập Quý][AI][Rollback] → form bung modal; resolver-info thành ⓘ; danh sách 21 NV lên trên, chiếm phần lớn. Giữ đủ chức năng. Áp dần Upload/bộ lọc các trang.

### 2026-07-03 — Bot triển khai (Report Bot) — Directive Card V2: lọc ngày + thẻ QĐ màu + giá trúng thầu
- Đã pull `main`, đọc `DIRECTIVE_CARD_V2.md` và xác nhận độ chi tiết ngày trước khi lọc:
  - T01–T06 legacy/Lumos: dòng upload không có ngày chi tiết, chỉ có `dateFrom/dateTo` cấp kỳ → không phân bổ giả theo ngày.
  - T07 `CRM_MISA_PLUS_APP_WEB`: dòng active có `date` + `source_order`, `data_as_of=2026-07-03T10:30:21+07:00` → lọc ngày/tuần/tháng/quý theo ngày dòng.
- Backend: `slotRows()` giữ ngày dòng thật nếu có, gắn `date_granularity`, `source_date_from/to`, API `/periods` trả `canFilterByDay`; `applyFilters()` thêm `dateFrom/dateTo` và chỉ nhận kỳ không có ngày khi range phủ trọn kỳ.
- UI bộ lọc doanh thu/Sản phẩm/DT đầy đủ: hiển thị “Cập nhật đến HH:mm GMT+7”, thêm date range + quick `Ngày/Tuần/Tháng/Quý`, ghi chú rõ kỳ nào chỉ có số theo tháng.
- Card V2: QĐ139 nền vàng/cam + badge cam, QĐ141 nền xanh + badge xanh; thay ô “Gói thầu” bằng **Giá trúng thầu**; thêm ô **Ưu tiên**; QĐ139 hiện hoạt chất+hàm lượng, QĐ141 không hiện hoạt chất; nhà thầu dùng mã-tên khi nguồn có tên. Áp Sản phẩm, DT đầy đủ, CST flat card.
- Nghiệm thu: `node -c` server OK, `npm run build` OK, `pm2 restart reportnew && pm2 save` OK, health OK. Screenshot: `verification-screenshots/card-v2/`. Old app `dona-report` port 3860 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive Thẻ V2: mã màu QĐ + giá trúng thầu + ưu tiên + lọc ngày
- CEO 2 ảnh (H1 chỉnh thẻ/lọc, H2 mẫu bảng + mã màu). → [`DIRECTIVE_CARD_V2.md`](DIRECTIVE_CARD_V2.md).
- **H1:** giờ đồng bộ "…GMT+7"; lọc Từ ngày→Đến ngày + Ngày/Tuần/Tháng/Quý; bỏ ô "Gói thầu 139" → **Giá trúng thầu**; tên+hoạt chất/hàm lượng (QĐ141 không); nhà thầu **`01.AFP - CÔNG TY TNHH AFP PHARMA`** (1 mã nhiều tên); thêm ô **Ưu tiên** (H.A*/H.A/H.B).
- **H2:** nền thẻ theo QĐ — **QĐ139 vàng/cam, QĐ141 xanh** + badge góc; bố cục bảng gọn theo ảnh mẫu.
- **Lưu ý:** lọc theo ngày chỉ đúng khi kỳ có ngày chi tiết (T07+ App Sale có; 01–06 Lumos theo tháng — bot xác nhận, không bịa phân bổ ngày).

### 2026-07-03 — Bot triển khai (Report Bot) — Nav chung Quay lại/Breadcrumb/Tải lại
- Đã `git pull origin main`, đọc `DIRECTIVE_NAV_BACK_RELOAD.md` trước khi làm.
- Thêm component/hook chung `web/src/drillNav.jsx`: thanh `← Quay lại` + breadcrumb bấm nhảy cấp + `↻ Tải lại`; reload refetch dữ liệu nhưng giữ filter/cấp drill.
- App-level navigation đẩy `history.pushState` cho chuyển tab; luồng drill Doanh thu dùng stack chung + browser/phone Back lùi đúng 1 cấp.
- Áp thanh chung cho các tab chính: Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, Cơ số thầu, Target, Hỏi nhanh, Upload. Cơ số thầu/Target/Upload có breadcrumb theo subview/filter; Doanh thu có drill NV→ĐV→SP.
- Nghiệm thu live: Doanh thu → Nguyễn Trọng Hiếu (DN006) → 027.BV QUỐC TẾ HOÀN MỸ ĐN → browser Back quay về danh sách đơn vị; `↻ Tải lại` giữ breadcrumb/filter `Doanh thu › Nguyễn Trọng Hiếu (DN006)`. Build OK, `pm2 restart reportnew && pm2 save` OK, health OK. Artifact: `verification-screenshots/final-0703-nav-back-reload/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive điều hướng: Quay lại + Breadcrumb + Tải lại (toàn app)
- CEO: drill sâu (DN006 → ĐV/SP) không có nút lùi, không có nút tải lại. → [`DIRECTIVE_NAV_BACK_RELOAD.md`](DIRECTIVE_NAV_BACK_RELOAD.md).
- 1 thanh điều hướng chung: **← Quay lại** (lùi 1 cấp drill) + **breadcrumb** (bấm cấp nhảy về) + **↻ Tải lại** (re-fetch giữ bộ lọc) + hỗ trợ **nút Back trình duyệt/điện thoại** (đẩy history). Component/hook dùng chung, áp mọi tab drill (Doanh thu/DT đầy đủ/Sản phẩm/CST/Phân tích/Target/Tổng quan).
- Đã `git pull origin main`, đọc `DIRECTIVE_TARGET_TEMPLATE.md` phần **CĂN CỨ**.
- Dump/chốt baseline target T06/2026 từ nguồn legacy `V_TEM_TARGET_BONUS` đã import trong `server/data/targets_real.json` cho đúng 21 mã allowlist CEO; lưu `server/data/target_baseline_202606.json` và backup trong `backups/target_baseline/`. Tổng baseline: **30.062.862.426đ**.
- Template target thêm dropdown căn cứ: `Theo T06/2026 (Lumos)` mặc định, `Trống`, `Theo kỳ gần nhất đã giao`. Khi kỳ tương lai chưa giao target, file `.xlsx` điền sẵn target T06 làm căn cứ; nếu kỳ đã có target thì ưu tiên target hiện tại; căn cứ không tự thành target live cho đến khi CEO upload/commit.
- API `/api/admin/targets` trả metadata baseline; `/api/admin/targets/template.xlsx?ky=08.2026&basis=t06` xuất 21 dòng, nhãn `Căn cứ: target T06/2026 Lumos`.
- Nghiệm thu: `node -c server/src/targetAdmin.js`, `node -c server/src/routes.js`, `npm run build` OK; `pm2 restart reportnew && pm2 save` OK; health OK. Verify live đọc ngược XLSX 08.2026: 21 dòng, tổng **30.062.862.426đ**, mismatch `[]`. Artifact: `verification-screenshots/final-0703-target-template-basis/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target: căn cứ T06 Lumos điền sẵn template (dump trước khi cắt)
- CEO muốn dùng target **T06/2026 Lumos** (số cuối trước khi cắt) làm căn cứ điền sẵn template → sửa → upload. → `DIRECTIVE_TARGET_TEMPLATE.md`.
- **Bước A:** bot **dump `V_TEM_TARGET_BONUS` kỳ 06.2026** (21 NV) NGAY, lưu `data/target_baseline_202606.json` + backup (trước khi ngắt Lumos).
- **Bước B:** template kỳ tương lai chưa giao → điền sẵn số T06 làm mốc (nhãn "Căn cứ: T06/2026"); có dropdown chọn căn cứ (Trống / T06 Lumos / kỳ gần nhất). CEO sửa rồi upload (nguồn `upload`). **Không auto-áp** — chỉ là mốc để sửa; không phá "target chốt tại App Report".
- CEO gộp 2 yêu cầu (template điền mới + xuất để sửa) thành **1 nút xuất file**. → [`DIRECTIVE_TARGET_TEMPLATE.md`](DIRECTIVE_TARGET_TEMPLATE.md) (đã gộp) + file mẫu `templates/TARGET_TEMPLATE_MAU.csv`.
- Nút **"⬇ Xuất/Tải template target"**: xuất .xlsx kỳ đang chọn, 21 NV (tên từ DB), **Target điền sẵn giá trị hiện tại — chưa giao thì trống** (vừa là template vừa là bản sửa). Upload lại → preview/commit/rollback theo MÃ NV; ô trống = giữ nguyên. Sửa tay lẻ vẫn ăn.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target chốt tại App Report (bỏ Lumos từ 07) + KPI dễ hiểu + ô Tổng
- CEO: ô KPI target khó hiểu (272% do chia nhịp 3/31; mượn target Lumos T06 cho T07). → [`DIRECTIVE_TARGET_KPI.md`](DIRECTIVE_TARGET_KPI.md).
- **A) Từ 07/2026 target CHỐT TẠI APP REPORT**, KHÔNG đồng bộ Lumos/app khác: resolver kỳ ≥07 chỉ `manual>upload>ai` (bỏ legacy Lumos + appsale); kỳ ≤06 giữ Lumos lịch sử. Chưa giao → "Chưa giao target", không mượn số.
- **B) Thẻ NV dễ hiểu:** số chính = đạt / **target CẢ THÁNG** (%) + vượt/thiếu (số & %); vòng = % so target tháng; "nhịp N/D" thành dòng phụ có nhãn rõ (không để 272% trần).
- **C) Thêm ô KPI TỔNG** trang Target: Σ target · Σ đạt · vượt/thiếu tổng (số & %), theo scope.
- CEO nêu tầm nhìn: target/thưởng theo nhiều chiều (nhóm H.A*/H.A/H.B, hàng đặc biệt, tuyến CL/NCL/NT, mã ĐV, mã QLNB) + danh mục bán hàng tổng + phân công NV. → [`SPEC_TARGET_BONUS_ROADMAP.md`](SPEC_TARGET_BONUS_ROADMAP.md).
- **Làm NGAY (chừa chỗ):** thêm field `scope` (mặc định `all`) vào `target_entry` → tương lai thêm target theo chiều không phải đập mô hình; hành vi hiện tại không đổi.
- **Làm SAU:** target đa chiều + %đạt theo chiều (dữ liệu route/unit/iit/UT đã có) + lớp Thưởng tách riêng (bậc thang, duyệt mới gửi) + danh mục+phân công (chính là module Phân công/Điều chuyển đã hoãn). Cập nhật scope: "thưởng" từ CẮT → SAU.
- **Xác nhận:** roster Target giờ ĐÚNG 21 mã (allowlist config, bỏ heuristic). ĐẠT.
- **CEO yêu cầu:** Quản target cho **nhập target kỳ tương lai** (T08/T09.2026…) + **theo QUÝ**. → `DIRECTIVE_TARGET_ADMIN.md` mục 0-TER: period picker sinh tháng tới (+12); chế độ Quý nhập 1 số → **tách 3 tháng (chia đều mặc định, chỉnh tay được)**, lưu tầng tháng để resolver/%đạt/forecast dùng chung; upload file nhiều kỳ. Audit/rollback giữ nguyên.
- CEO: ô "Tất cả nhà thầu" cho hiện **mã + tên đầy đủ**; **1 mã nhà thầu có nhiều tên** (VD `07.trieu.g`). → khóa lọc theo **MÃ**, chọn mã gom hết mọi tên. Áp chung mọi bộ lọc mã↔tên (nhà thầu/ĐV/SP/NV/gói/tuyến): luôn hiện mã+tên, khóa theo mã (tên chỉ là nhãn). Ghi `SPEC_ANALYSIS_CST_UX.md` mục C2.
- CEO bực: Target admin VẪN hiện 35 NV/CTV (còn VP002/003/006 văn phòng) → PHẢI đúng 21 mã allowlist (mục 0-BIS), bỏ heuristic. Bot chưa áp allowlist vừa push.
- **Lấy target TỰ ĐỘNG:** cột Nguồn trống/0đ → CEO chưa thấy target tham khảo. Bot xác định nguồn (target cũ Lumos `V_TEM_TARGET_BONUS` 01–06 và/hoặc App Sale) → kéo về nguồn `appsale`/`legacy` hiện số thật + nhãn nguồn; AI đề xuất ở nguồn `ai`. Ghi `DIRECTIVE_TARGET_ADMIN.md`.
- **H1:** khối Đơn vị tăng/giảm (Phân tích) + mọi nơi hiện tên ĐV phải kèm **mã số đầy đủ** `001.BVĐK Đồng Nai`. Ghi `DIRECTIVE_MULTICOLUMN_LAYOUT.md`.
- Tab Target lọt cả NV văn phòng (heuristic role sai). **Chốt allowlist CHÍNH THỨC 21 mã:** DN001–012, DN016–019, DN021–024, VP004. Ngoài danh sách = KHÔNG target (văn phòng/telesale VP018/nghỉ DN013-015/DN020). Dùng cờ `has_target`/config, không suy role. Ghi `DIRECTIVE_TARGET_ADMIN.md` mục 0-BIS.
- Phân nhóm (đều có target): CTV đặc biệt DN021/022/023/VP004 (no_auto_notify); CTV gần fulltime DN002/DN004; còn lại fulltime. Nghiệm thu: Target hiện đúng 21 mã, không dư/thiếu.
- CEO: khối danh sách PC vẫn 1 cột full-width (phí chỗ), yêu cầu **2–3 cột, áp mọi tab, làm triệt để**. → [`DIRECTIVE_MULTICOLUMN_LAYOUT.md`](DIRECTIVE_MULTICOLUMN_LAYOUT.md).
- PC ≥1024px = 2–3 cột; tablet 2; mobile 1. Liệt kê rõ khối phải sửa: Phân tích (tăng/giảm ĐV+SP, SP cần đẩy/sắp hết CST), Tổng quan (top+cảnh báo), Doanh thu/DT đầy đủ (ranking+chi tiết), Sản phẩm/CST/Target. Dùng `.list-grid` chung. Bot rà từng tab báo lại.
- Ghi chú soi thêm: "Đơn vị tăng mạnh" hiện toàn số ÂM do so T07(2 ngày) với T06(cả tháng) → xử cùng đợt kỳ-đang-chạy (so cùng số ngày).
- CEO phản ánh thẻ mobile thiếu/thừa. → [`DIRECTIVE_CARD_LAYOUT.md`](DIRECTIVE_CARD_LAYOUT.md): thêm **Giá thầu**; **tên thuốc IN ĐẬM** + nhãn "SP" ở tên thuốc, **mã QLNB nhạt** (không đậm); **bỏ tên đơn vị lặp** (giữ `002.BVĐK…`); **nhà thầu mã + tên đầy đủ**; **trùng tên → thêm hàm lượng** (trừ QĐ141); bố cục **dạng bảng, mobile 2 cột field ngắn**. Áp thẻ Doanh thu/DT đầy đủ + đồng bộ CST.
- CEO: Tổng quan vẫn hiện "2,67 tỷ" làm số lớn → SAI ý. **Số headline/KPI/thẻ phải ĐẦY ĐỦ `2.668.987.096đ`** (đổi `short()`→`money()`); chỉ trục biểu đồ mới được viết tắt `2,67 tỷ`. Cập nhật `DIRECTIVE_NUMBER_FORMAT_VN.md`. Bot sửa + build + restart reportnew.
- **Resolver target (`targetAdmin.resolveTargets`)**: ĐÚNG — chọn theo `PRIORITY manual(4)>upload(3)>appsale(2)>ai(1)>legacy(0)`, hòa thì lấy `at` mới nhất; giới hạn theo `targetRosterCodes` (allowed set) → **VP018/telesale không có target dù có entry**. Roster = `isActiveSalesUser` (role sale, không Nghỉ việc, type sale/ctv), neo toàn đội active → hết sót NV.
- **Idempotency auto-refresh (`materialize_july_revenue.js`)**: ĐÚNG — trước khi push slot mới, `s.active=false` cho MỌI slot cùng `ky` → **chỉ 1 slot active/kỳ, không double-count, không drift**. PA-A loại `DT-260630-0115` (WEB=550.673.600); kỳ đã đóng giữ nguyên.
- **Kết luận: DUYỆT, không có bug ở 2 điểm rủi ro.** Ghi chú nhỏ (không chặn): `VP018` đang hardcode fallback trong `employeeType` — nên chuyển sang field `employee_type` trong danh bạ khi tiện.
- Đọc lại `CHANGELOG.md` + 5 directive theo thứ tự. Không đụng app cũ `dona-report` port 3860.
- `DIRECTIVE_MOBILE_UX.md`: giữ bản mobile đã dựng; test lại Chrome headless CEO + DN001 tại 375/390/414px, 8 tab chính → `48/48` pass, không overflow/header overlap; cập nhật screenshots trong `artifacts/mobile_ux_20260703/`.
- `DIRECTIVE_NUMBER_FORMAT_VN.md`: chuẩn helper `web/src/util.js`: tiền `1.000.000đ`, rút gọn dùng phẩy VN (`2,67 tỷ`), `%` dùng `90,6%`; tooltip chart dùng tiền đầy đủ; Telegram/smart bỏ khoảng trắng trước `đ` và đổi `%` sang dấu phẩy.
- `DIRECTIVE_TARGET_ADMIN.md`: thêm service `server/src/targetAdmin.js` với resolver `manual > upload > appsale > ai > legacy`; `/targets` và forecast lấy toàn bộ đội sale/CTV active, neo forecast theo T06, loại VP018/telesale khỏi Target/Dự báo/cảnh báo; có pro-rate target kỳ đang chạy; thêm admin APIs upload preview/commit/rollback, sửa tay, AI propose/apply, history; UI Target thêm tab “Quản target”. Runtime `users.json` đã tag `employee_type`, code có fallback `VP018=telesale`.
- `DIRECTIVE_AUTO_REFRESH.md`: chạy lại materializer idempotent, T07 vẫn `2.668.987.096đ` (MISA `2.118.313.496đ` + WEB `550.673.600đ`), T06 giữ `28.403.136.096đ`; không drift về `2.670.947.096đ`.
- `reportnew-tgbot`: CEO đã duyệt, đã `pm2 restart reportnew-tgbot && pm2 save`; process online, unstable restarts 0; NLQ local trả T06/T07 đúng và format `-6,6%`, `-90,6%`.
- Nghiệm thu: `node --check` các file server touched OK, `npm run build` OK; API local `/targets`, `/targets/forecast`, `/admin/targets` đều 35 NV/CTV, không có VP018, forecast `next_ky=07.2026` neo `06.2026`.
- Chưa restart live `reportnew` cho phần code frontend/backend mới trong commit này; cần CEO duyệt riêng nếu muốn nạp lên production ngay.

### 2026-07-03 — CEO DUYỆT restart `reportnew` nạp scheduler auto-refresh
- CEO gửi `approve_restart_reportnew_scheduler`; đã chạy `pm2 restart reportnew && pm2 save` chỉ với app mới `reportnew`.
- Verify sau restart: `reportnew` online, health `http://localhost:3873/api/health` OK; log có `[revenue-refresh] scheduler armed` với `enabled=true`, timezone `Asia/Bangkok`, 60 phút, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`.
- Kiểm số code-first sau restart: T06 `28.403.136.096đ`, T07 `2.668.987.096đ` — không drift.
- Old app `dona-report` port 3860 vẫn online, không restart/không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — CEO chốt: telesale KHÔNG giao target
- **VP018 (telesale) KHÔNG giao target.** Loại telesale khỏi danh sách Target/Dự báo, %đạt, cảnh báo "chưa đạt", ranking theo target. Vẫn giữ danh bạ (loại `telesale`, active); doanh thu vẫn tính tổng công ty. Cập nhật `DIRECTIVE_TARGET_ADMIN.md`. Chờ CEO: danh sách telesale khác + xác nhận đội NV sale.
- CEO nhấn: **2.668.987.096đ mới đúng** (khớp app cũ). Rủi ro: scheduler chạy lại materialize mỗi giờ, nếu không áp PA-A → cộng lại 1,96tr → nhảy về 2.670.947.096 sai.
- **Chốt:** script materialize của scheduler PHẢI áp đủ (gán kỳ + PA-A + loại đơn khe), **idempotent tuyệt đối** → mỗi lần refresh T07 luôn = 2.668.987.096đ. Bot verify sau ≥1 chu kỳ auto-refresh; lệch thì dừng báo Claude. Ghi `DIRECTIVE_AUTO_REFRESH.md`.
- CEO: hiển thị số theo chuẩn kế toán VN (`1.000đ` / `1.000.000đ` / `2.670.947.096đ`, dấu chấm hàng nghìn). → [`DIRECTIVE_NUMBER_FORMAT_VN.md`](DIRECTIVE_NUMBER_FORMAT_VN.md).
- Bỏ kiểu US `2.67 tỷ` (chấm thập phân); nếu rút gọn dùng `2,67 tỷ` (phẩy). %: `90,6%`. Áp KPI/thẻ/bảng/CST/Target/Excel/bản tin/tooltip; trục chart rút gọn chuẩn VN. Chuẩn hóa ở helper chung; phối MOBILE để số không cắt mép. Chỉ đổi hiển thị.
- CEO phản ánh Target Dự báo **sai/thiếu**; VP018 là telesale lẫn vào NV sale; nhắc Target admin (file+tự động) chưa làm. → [`DIRECTIVE_TARGET_ADMIN.md`](DIRECTIVE_TARGET_ADMIN.md) (ưu tiên).
- **Sửa ngay:** danh sách Target/Dự báo lấy TOÀN BỘ đội sale active (neo theo T06 đủ, không dựa T07 dở → hết sót NV); thêm **loại NV** (sale/telesale/ctv/khác), tách telesale (VP018) khỏi NV sale.
- **Xây Target admin** (SPEC_TARGET_MULTISOURCE): nhập file (preview/commit/rollback) + tự động App Sale (nếu có) + AI đề xuất→CEO áp dụng + sửa tay; resolver manual>upload>appsale>ai; pro-rate kỳ đang chạy.
- **Chờ CEO:** telesale có target riêng hay không tính; danh sách telesale; đội NV sale đúng gồm mã nào.

### 2026-07-03 — Bot triển khai (Report Bot) — Dựng lại mobile responsive 375–414px
- Đọc `DIRECTIVE_MOBILE_UX.md`; sửa responsive ở `web/src/styles.css` theo mobile-first ≤640px, không đổi số liệu/quyền.
- Chống tràn ngang toàn app: `body/#root` khóa overflow-x, card/grid/chart/donut/list/filter full-width, KPI mobile 1 cột, tên dài wrap/ellipsis, giá trị `.amt` giữ `flex:none` để số bên phải không bị cắt.
- Header sticky không đè nội dung: siết chiều cao/padding, tên NV ellipsis; bottom-nav giữ trong viewport, 390px trở xuống ưu tiên icon để không chen vỡ.
- Bảng chi tiết mobile đổi sang dạng card dọc bằng CSS (`.data-table` block cards), không còn scroll ngang trong “DT đầy đủ”.
- Test Chrome headless local: CEO + DN001, viewport 375/390/414, 8 tab chính; kết quả `48/48` pass, không horizontal overflow, không header overlap. Artifact: `artifacts/mobile_ux_20260703/mobile_check.json` + screenshots Tổng quan/Phân tích/CST.
- Build OK: `npm run build`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — DUYỆT quy tắc gán kỳ + lưu ý khe cắt Lumos
- **Duyệt** rule bot: MISA theo ngày xuất HĐ (`revenue_date`); WEB Partner theo **kỳ đơn đặt `orders.created_at` (giờ VN)** rồi xét giao đủ — replicate app cũ. Đơn đặt cuối tháng trước, giao tháng sau KHÔNG kéo sang kỳ sau.
- **Lưu ý 1 (một lần, tại ranh giới):** đơn WEB đặt 30/6 giao 1/7 (`DT-260630-0115`, 1,96tr) rơi vào khe — T06 đóng băng Lumos không có, T07 loại theo ngày đặt. Negligible; nếu CEO muốn đủ tuyệt đối → carryover adjustment có duyệt (chưa làm).
- **Lưu ý 2 (lâu dài):** cần định nghĩa "khi nào 1 tháng CHỐT CỨNG" — nên để tháng vừa qua còn refresh vài ngày để bắt đơn giao trễ (đơn đặt cuối tháng, giao đầu tháng sau) rồi mới đóng. Bot đã có hướng carryover/kỳ-còn-mở; chốt mốc đóng kỳ khi làm scheduler.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive dựng lại bản MOBILE (CEO phản ánh)
- CEO gửi ảnh mobile (tài khoản NV): **giá trị bên phải bị cắt, header đè nội dung, cơ cấu tràn ngang, cuộn ngang**. → [`DIRECTIVE_MOBILE_UX.md`](DIRECTIVE_MOBILE_UX.md), ưu tiên cao (NV dùng điện thoại).
- Yêu cầu: ≤414px không tràn ngang; dòng "tên—giá trị" giá trị luôn hiện + tên ellipsis/wrap; header không đè; KPI 1 cột; combobox/chart/bottom-nav vừa màn hình. Sửa ở khung/CSS dùng chung cho MỌI trang; không đổi số/quyền. Test 375/390/414px cả CEO + NV.

### 2026-07-03 — Bot triển khai (Report Bot) — Scheduler auto-refresh doanh thu theo khung giờ CEO chốt
- Đọc `DIRECTIVE_AUTO_REFRESH.md` và dựng backend scheduler `server/src/revenueRefresh.js`: mặc định mỗi 60 phút, timezone `Asia/Bangkok`, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`; cấu hình env `REVENUE_REFRESH_MINUTES`, `REVENUE_REFRESH_WEEKDAY`, `REVENUE_REFRESH_SAT`, `REVENUE_REFRESH_SUN`, `REVENUE_REFRESH_ENABLED`.
- Scheduler chạy đúng kỳ đang chạy, có single-flight/in-flight guard, chống chạy trùng slot, ngoài khung thì skip không gọi MISA; lỗi thì giữ số cũ.
- Bổ sung hook snapshot MISA tùy cấu hình: `APPSALE_MISA_SYNC_COMMAND` hoặc `APPSALE_MISA_SYNC_URL` + `APPSALE_MISA_SYNC_TOKEN`; nếu chưa cấu hình thì dùng snapshot MISA success mới nhất trong DB, không để trắng số.
- Refactor `server/scripts/materialize_july_revenue.js` thành materializer theo `REVENUE_REFRESH_KY`/kỳ hiện tại, vẫn giữ rule 2 nguồn và rule WEB Partner theo kỳ đơn đặt; ghi `data_as_of` vào active slot.
- Thêm API admin `/api/admin/revenue-refresh/status` và `/api/admin/revenue-refresh/run`; Overview hiển thị “Cập nhật đến HH:MM ngày dd/mm” và nút admin “↻ Làm mới”.
- Nghiệm thu local: `node --check` OK, `npm run build` OK; chạy materializer T07 giữ đúng `2.668.987.096đ` (MISA `2.118.313.496đ`, WEB `550.673.600đ`), T06 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Chốt khung giờ auto-refresh (tiết kiệm token)
- CEO chốt khung giờ chạy (giờ VN): **T2–T6 07:30–18:30**, **T7 07:30–13:00**, **CN nghỉ**. Vẫn mỗi 60'. Ngoài khung không gọi MISA (giảm ~60% lần gọi). Cấu hình env. Cập nhật `DIRECTIVE_AUTO_REFRESH.md`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive tự cập nhật doanh thu mỗi 1 giờ (CEO chốt B)
- CEO chốt nhịp **B = mỗi 1 giờ** cho auto-refresh doanh thu kỳ đang chạy. → [`DIRECTIVE_AUTO_REFRESH.md`](DIRECTIVE_AUTO_REFRESH.md).
- Scheduler 60' (env `REVENUE_REFRESH_MINUTES`, khung giờ tuỳ chọn): chụp snapshot MISA → materialize kỳ đang chạy (MISA xuất HĐ + WEB đã giao đủ) → ghi `data_as_of`. Chỉ kỳ đang chạy; kỳ đã đóng giữ nguyên. Idempotent, lỗi thì giữ số cũ.
- Frontend: nhãn "Cập nhật đến HH:MM" + nút "↻ Làm mới" (admin). **NV không thao tác gì — mở app thấy số mới nhất trong 1 giờ, theo scope của mình.** MISA chỉ gọi ~1 lần/giờ.

### 2026-07-03 — Bot triển khai (Report Bot) — Restart tgbot + chốt rule gán kỳ doanh thu
- CEO duyệt restart Telegram worker: đã chạy `pm2 restart reportnew-tgbot` + `pm2 save`; process `reportnew-tgbot` online, backend `http://localhost:3873`, log mới không có error sau restart.
- Trả lời 3 câu rule gán kỳ trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`: CRM MISA theo `revenue_date`/ngày xuất HĐ; APP WEB Partner replicate app cũ theo kỳ đơn đặt `orders.created_at` (Asia/Bangkok), sau đó xét giao đủ/đã thực hiện; không kéo đơn cuối tháng trước sang kỳ sau chỉ vì `responded_at` nằm tháng sau.
- Làm rõ `DT-260630-0115/WEB:2188`: không tính T07 để khớp app cũ; không tự cộng ngược T06 vì 01–06 đang đóng băng Lumos. Nếu cần full carryover thì phải mở adjustment riêng có duyệt.
- Cập nhật `SPEC_DATASOURCE_CUTOVER.md` + `DIRECTIVE_ENABLE_JULY_REVENUE.md`; không đổi runtime revenue, T07 vẫn `2.668.987.096đ`.

### 2026-07-03 — Bot triển khai (Report Bot) — UI polish + Analysis/CST UX + typeahead toàn app
- Đọc `SPEC_ANALYSIS_CST_UX.md`, `DIRECTIVE_UI_POLISH_20260702.md`, `DIRECTIVE_TELEGRAM_NLQ.md`; T07 PA-A và Telegram NLQ đã kiểm lại vẫn đúng.
- Thêm combobox typeahead dùng chung cho bộ lọc Đơn vị/Sản phẩm/NV: tìm theo mã ĐV/tên ĐV, tên SP/mã QLNB/hoạt chất; option sản phẩm hiển thị chuỗi phân biệt QĐ/hoạt chất/hàm lượng/ĐVT/nhà thầu/giá thầu, value vẫn là `iit_code`.
- Backend `/api/filters` trả product option giàu metadata từ CST+revenue, lọc theo scope; `/products`, `/revenue?dimension=product`, export products/CST có thêm QĐ/thuộc tính phân biệt. CST export bỏ cột Giá bán.
- Tab CST: bỏ “Giá bán” trên card, thêm QĐ + hoạt chất/hàm lượng cho QĐ139, sửa “Nguồn” thành “Cập nhật đến kỳ/baseline + bán đến…”, thêm gợi ý hành động từng dòng, tiến độ đã bán/còn lại, ưu tiên dòng cần làm, chế độ gom theo Đơn vị + header tóm tắt.
- Tab Phân tích: thêm block `SP cần đẩy mạnh` và `SP sắp hết CST`; xuất artifact parity `artifacts/analysis_parity_20260703.md`.
- Tổng quan: đo hiệu năng artifact `artifacts/overview_perf_20260703.json`; tối ưu `/trend` từ ~10.064ms xuống ~545ms local bằng lightweight trend + memo 60s, KPI/số không đổi.
- Nghiệm thu: T06 `28.403.136.096đ`, T07 `2.668.987.096đ`, `node --check` OK, `npm run build` OK.

### 2026-07-03 — CEO DUYỆT restart Telegram worker (bật NLQ)
- **CEO đã DUYỆT** thao tác live: bot server `pm2 restart reportnew-tgbot` để nạp code NLQ + `pm2 save`. An toàn (login bot đang chạy, chỉ nạp code mới).
- Verify sau restart: `/start`, đăng nhập RP, `/digest_test` vẫn OK; hỏi tự nhiên "doanh thu tháng 6?" → trả lời đúng scope; user chưa map → chỉ hướng dẫn đăng nhập.
- Nhắc bot trả lời 3 câu **quy tắc gán kỳ** (ngày đặt vs ngày giao) trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`.


### 2026-07-03 — Bot triển khai (Report Bot) — Telegram NLQ + fix PA-A T07 đã chạy
- Đọc `DIRECTIVE_TELEGRAM_NLQ.md` và nối fallback Telegram vào `smart.answerQuestion` code-first: mã RP/lệnh `/start`, `/digest_test`, `/tat`, `/bat` giữ nguyên; user chưa map chỉ nhận hướng dẫn đăng nhập; user đã map được hỏi tự nhiên theo đúng scope Telegram → `emp_code` → `auth.scopeOf`.
- Bổ sung nhận diện kỳ trong câu hỏi nhanh (`tháng 6`, `T06`, `06.2026`...) để nghiệm thu CEO hỏi “doanh thu tháng 6” trả đúng kỳ thay vì mặc định latest.
- Chạy fix PA-A T07: re-materialize slot `07.2026`; WEB Partner còn `550.673.600đ` (67 rows/32 orders), CRM MISA `2.118.313.496đ` → Overview T07 `2.668.987.096đ` đúng chỉ đạo; T06 giữ nguyên `28.403.136.096đ`.
- Trace chênh `1.960.000đ`: loại khỏi T07 dòng `DT-260630-0115` / `WEB:2188` / Goutcolcin / DN008 / `164.PKĐK QUỐC TẾ HẠNH PHÚC` vì đơn tạo 30/06, phản hồi/giao 01/07; artifact `artifacts/july_revenue_paa_trace_20260702.json`.
- Nghiệm thu local: `node --check` OK; `smart.answerQuestion("doanh thu tháng 6")` CEO → `28.403.136.096đ`; DN008 hỏi T07 chỉ thấy scope DN008; `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec: ô lọc typeahead + phân biệt thuốc trùng tên
- CEO: 2 ô "Tất cả đơn vị"/"Tất cả sản phẩm" cho gõ tìm tiên đoán; thuốc trùng tên (VD "Alusi") cần phân biệt. → `SPEC_ANALYSIS_CST_UX.md` mục C2.
- **Gốc:** định danh sản phẩm = `iit_code` (mã QLNB), không phải tên; 1 tên ↔ nhiều mã QLNB (khác gói/QĐ, nhà thầu, ĐVT ml-gam/gói, giá).
- **Giải:** (A) combobox typeahead tìm theo tên+mã QLNB+hoạt chất; (B) mỗi option/thẻ hiện `tên · hoạt chất/hàm lượng · ĐVT · nhà thầu · QĐ · mã QLNB`, value = iit_code duy nhất; toggle "Gộp theo tên" ↔ "Tách theo mã QLNB".

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Telegram NLQ + nhắc fix T07 chưa chạy
- **Login bot mới LIVE** (`@DonaLoginReport_bot`, bot riêng tách agent) — `/digest_test` ra số OK, hết xung đột "gửi mã".
- **‼ Fix PA-A CHƯA CHẠY:** Overview T07 vẫn `2.670.947.096đ` (chưa loại 1,96tr đơn giao dở). Bot cần **re-materialize T07** (loại phần đã-giao đơn dở) → về `2.668.987.096đ`. Đang chờ bot chạy.
- **CEO yêu cầu bot hiểu ngôn ngữ tự nhiên** → [`DIRECTIVE_TELEGRAM_NLQ.md`](DIRECTIVE_TELEGRAM_NLQ.md): nối `smart.answerQuestion`/`/api/ai/ask` vào fallback `telegram-bot.js`. **Bảo mật: chỉ user đã map, scope đúng người hỏi (NV chỉ thấy mình), không bịa số.** Q&A = pull nên CTV ngoài được hỏi phần mình (guardrail chỉ chặn push).

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt PA A: pro-rate target kỳ đang chạy
- Kỳ đang chạy (VD T07 mới 2 ngày) so lũy kế với target cả tháng → đỏ oan. **Chốt chia target theo ngày:** `target_prorated = target_full × daysElapsed/daysInMonth`; `% đạt(nhịp) = DT trước VAT / target_prorated`. Kỳ đã đóng giữ target đủ.
- Áp: Overview %/vòng target, Target card NV, `buildAlerts` nhóm target, digest. Gắn nhãn "Kỳ đang chạy · đến ngày X (d/D)"; hiện rõ đang so mốc-nhịp + target cả tháng. Không pro-rate doanh thu. Ghi `SPEC_TARGET_MULTISOURCE.md`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt CHÍNH SÁCH: đơn giao dở KHÔNG tính (khớp app cũ)
- **CEO chốt PHƯƠNG ÁN A:** đơn giao dở dang → xếp trọn vào "còn nợ chưa giao", KHÔNG tính phần đã giao; chỉ đơn giao ĐỦ mới vào "đã thực hiện". Áp mọi kỳ.
- Bot sửa: loại phần đã-giao của đơn dở khỏi partner → T07 = **2.668.987.096đ** khớp app cũ 100% tại cùng snapshot (đơn 1,96tr được đưa về "còn nợ"). Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`. Nghiệm thu đối chiếu số app cũ, không ép số.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — MISMATCH T07: WEB dư 1.960.000đ (phải truy)
- CEO đồng bộ lại app cũ 23:42 (snapshot #27 official) → WEB **vẫn 550.673.600đ** → **bác bỏ** giả thuyết "phát sinh sau snapshot" của bot. Chênh 1,96tr là THẬT.
- **App Report WEB = 552.633.600 dư 1.960.000đ** so app cũ (550.673.600). MISA khớp tuyệt đối.
- **Nghi:** App Report tính SL ĐẶT thay vì **SL GIAO THỰC** cho đơn giao một phần, hoặc gộp nhầm "còn nợ chưa giao" (24,59tr, 1 đơn) vào "đã giao". Định nghĩa cũ: "đối tác đã thực hiện = SL giao thực × đơn giá", loại hủy + loại còn-nợ.
- **Áp nguyên tắc mismatch:** bot DỪNG, truy đúng đơn, sửa khớp định nghĩa → T07 phải = **2.668.987.096đ** tại cùng snapshot. KHÔNG ép số. Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bật doanh thu 07.2026 từ 2 nguồn MISA + APP WEB
- Đọc `DIRECTIVE_ENABLE_JULY_REVENUE.md` và điều tra lại code App Sale API: doanh thu App Report T07 phải dùng **CRM MISA đã xuất HĐ + APP WEB đối tác đã giao thực**, không dùng WEB ordered và không chỉ soi App Web :3970.
- Xác nhận công thức nguồn cũ: MISA đọc `misa_revenue_snapshot_lines` latest success run, `revenue_bucket in (official,pending)`, amount `invoice_export_amount`; Partner đọc latest `partner_order_line_responses`, amount `delivered_qty * order_items.price`, loại HOLD_GOLIVE/test/chưa giao.
- Thêm script idempotent `server/scripts/materialize_july_revenue.js` để materialize kỳ `07.2026` thành upload slot runtime, chỉ đọc DB App Sale/MISA snapshot và chỉ ghi data App Report New; 01–06 không đổi.
- Kết quả materialize hiện tại: CRM_MISA `2.118.313.496đ` (226 rows/66 orders) + APP_WEB_PARTNER `552.633.600đ` (68 rows/33 orders) = T07 `2.670.947.096đ`. Số MISA khớp ảnh CEO; **partner cao hơn ảnh `1.960.000đ` — Claude review: giả thuyết "tăng sau snapshot" đã bị CEO bác bỏ (re-sync 23:42 vẫn 550.673.600), cần truy đơn (mục MISMATCH trên).**
- Nghiệm thu: `store.listPeriods()` có `07.2026`, `latestKy=07.2026`, T06 vẫn `28.403.136.096đ`, T07 `2.670.947.096đ`, không có mã NV rác; `node --check` OK; `npm run build` OK. Artifacts: `artifacts/july_revenue_2source_investigation_20260702.md`, `artifacts/july_revenue_2source_materialize_20260702.md/json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — ĐÍNH CHÍNH: doanh thu có 2 nguồn (CRM MISA + APP WEB)
- CEO gửi ảnh "CRM MISA — Đối chiếu doanh thu đa chiều" (app Đặt hàng cũ): T07 tính đến 20:29 02/07 = **tổng đặt 3.175.523.336đ, đã thực hiện 2.668.987.096đ, 125 đơn**.
- **Đính chính khảo sát trước:** bot báo "T07 chỉ 2 đơn" vì **chỉ soi APP WEB (:3970), SÓT nguồn CRM MISA** (phần lớn ~80%). Doanh thu App Report = **CRM MISA (xuất HĐ) + APP WEB (đã giao)**.
- **Định nghĩa "doanh thu thực" đã rõ:** `đã thực hiện = MISA xuất HĐ + WEB đã xuất/giao` (loại chưa xuất HĐ/chưa phản hồi/còn nợ/HOLD/hủy) → đáp án cho câu "trạng thái nào = đã bán".
- Cập nhật `DIRECTIVE_ENABLE_JULY_REVENUE.md` (gộp 2 nguồn, điều tra lại MISA snapshot) + `SPEC_DATASOURCE_CUTOVER.md` mục A. Bot điều tra lại 2 nguồn → adapter kỳ 07 gộp cả hai → đối chiếu khớp báo cáo cũ.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive polish UI (CEO feedback qua ảnh)
- [`DIRECTIVE_UI_POLISH_20260702.md`](DIRECTIVE_UI_POLISH_20260702.md): **H1** Tổng quan CHẬM → đo API, cache tổng hợp theo kỳ, lazy-load chart (ưu tiên). **H2** DT/SP: thêm số QĐ; QĐ139 thêm hoạt chất+hàm lượng (QĐ141 không). **H3** CST: bỏ "Giá bán" (trùng Giá thầu), thêm số QĐ, QĐ139 thêm hoạt chất+hàm lượng. **Nguồn**: đang hiển thị `01-MAY-26` gây hiểu nhầm → đổi thành kỳ dữ liệu thực (VD "đến 06.2026").
- Live PASS 2 (bot, commit e869bb0): remap `#N/A`→DN019, `83`(10 dòng)→DN021; 6 CTV status Cộng tác; 4 CTV ngoài `no_auto_notify`; tổng T06 = 28.403.136.096 giữ nguyên. **Duyệt.**

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review trace mã rác + chốt remap + PASS 2 danh bạ
- Review `emp_junk_trace_20260702.md`. **Chốt remap:** `83` (10 dòng CST Valesto/QĐ48 Cà Mau-Bạc Liêu, 1 dòng đã `DN021`) → **remap DN021** (chờ CEO xác nhận DN021 phụ trách Cà Mau-Bạc Liêu). `#N/A` (1 dòng 1.575.000đ tại 033 An Long Khánh) → bot dò chủ ĐV 033 rồi remap; vô chủ thì giữ "Chưa phân bổ". Tổng T06 giữ nguyên.
- **PASS 2 danh bạ (bot làm nốt):** sửa `DN021` status → **Cộng tác** (commit b701dec set nhầm "Đang làm"); thêm/đổi `DN002`(Hằng Nga)/`DN004`(Ngọc Quyên) + `DN022`/`DN023`; áp `no_auto_notify=true` cho DN021/022/023/VP004 (DN002/004 email nội bộ — không áp). 6 CTV đều role sale/active/**có target tính đầy đủ**.
- Duyệt cách xử mã rác của bot (cách ly `UNALLOCATED`/"Chưa phân bổ", không xóa, tổng T06 = 28.403.136.096 giữ nguyên).

### 2026-07-02 — Bot triển khai (Report Bot) — PASS 2 emp master: remap #N/A/83 + CTV guardrail
- Đã làm mục 3/4 trong `DIRECTIVE_FIX_EMP_MASTER.md` bản mới. Remap dữ liệu runtime có backup artifact trước/sau, không đụng app cũ 3860.
- Remap `83 → DN021`: 10 dòng CST Valesto/QĐ48 tỉnh Cà Mau-Bạc Liêu, giữ nguyên `bid_qty_initial=460.000`, `sold_qty=12.000`, `sold_amount=21.600.000`, chỉ đổi chủ sang DN021 và lưu `raw_emp_code=83`.
- Remap `#N/A → DN019`: dòng Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu active T06 `1.575.000đ`, SL `10`, giữ nguyên số; cũng remap slot 06 inactive cũ để rollback không tái phát mã rác.
- PASS 2 danh bạ: `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` status `Cộng tác`, role `sale`, active/tính đủ doanh thu-target-cảnh báo-ranking. Áp `no_auto_notify=true` cho 4 CTV ngoài `DN021/DN022/DN023/VP004`; DN002/DN004 không khóa gửi tự động.
- Guardrail digest: `telegram-bot.js` bỏ qua user `no_auto_notify` trong bản tin/nhắc target chủ động; vẫn cho đăng nhập/xem dữ liệu pull.
- Nghiệm thu: T06 vẫn `28.403.136.096đ`; không còn `#N/A`, `83`, hoặc `UNALLOCATED` trong runtime; `DN019` nhận `1.575.000đ`; DN021 có 10 dòng CST remap; `node --check` OK; `npm run build` OK. Artifact: `artifacts/emp_master_pass2_20260702.md/json`, `artifacts/emp_master_pass2_20260702_before.json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive: thêm DN021/VP004 + truy mã rác #N/A, 83
- CEO phát hiện qua ảnh: dropdown lọc NV có `#N/A` và `83`; card Target hiện mã trần `DN021`, `VP004`. → [`DIRECTIVE_FIX_EMP_MASTER.md`](DIRECTIVE_FIX_EMP_MASTER.md).
- **Thêm 2 NV vào danh bạ:** `DN021` Lê Anh Đức (0906107109, ducluatsu98@yahoo.com.vn) role sale; `VP004` Trần Hoàng Trung (0378970463). Cập nhật danh bạ runtime + auth OTP + crosswalk emp_code.
- **VP004 = CỘNG TÁC VIÊN** (CEO chốt: chuyển qua làm cộng tác): status "Cộng tác" (active, vẫn tính doanh thu), scope phần mình; target chỉ tính khi CEO giao. Chuẩn hóa 3 trạng thái NV: Đang làm / Cộng tác / Nghỉ việc.
- **Danh sách CTV sale (CEO chốt):** `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` → status Cộng tác. Bot đổi status mã đã có; mã thiếu (`DN022`/`DN023`) chờ CEO cấp tên+SĐT để thêm + OTP.
- **CTV CÓ giao target (CEO chốt):** CTV tính ĐẦY ĐỦ như sale chính thức (doanh thu + target + % đạt + cảnh báo chưa đạt + ranking); chỉ khác NHÃN "Cộng tác". Bỏ quy tắc "target tùy chọn/không hiện đỏ" nêu trước đó.
- **⛔ GUARDRAIL (CEO chốt, bắt buộc):** KHÓA gửi tự động (email/Zalo/Telegram digest) thông báo đạt/thiếu target + nhắc thông tin cho 4 CTV ngoài `DN021`/`DN022`/`DN023`/`VP004` (`no_auto_notify=true`). Chỉ gửi khi CEO yêu cầu + duyệt trước. Họ vẫn đăng nhập xem phần mình (pull OK, push KHÓA). Ghi trong `DIRECTIVE_FIX_EMP_MASTER.md`.
- **Truy mã rác `#N/A`/`83`:** giả thuyết lỗi Excel + `raw_nv` chưa map. Bot truy nguồn (slot/dòng/tiền/đơn vị/raw_nv) → **remap về đúng NV, GIỮ tổng T06 = 28.403.136.096**, không xóa lặng; vô chủ → gom "Chưa phân bổ". Bộ lọc NV chỉ nhận mã hợp lệ `DN###/VP###`. Xuất artifact trace → Claude review trước khi remap.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix danh bạ NV + chặn mã rác #N/A/83
- Thực hiện `DIRECTIVE_FIX_EMP_MASTER.md`: thêm `DN021 — Lê Anh Đức` và `VP004 — Trần Hoàng Trung` vào `server/data/users.json` để card hiện tên và OTP tra được theo SĐT. `DN021` status `Đang làm`; `VP004` status `Cộng tác` nhưng vẫn role `sale`/active, target chỉ tính khi có target thật.
- Backend bổ sung chuẩn hóa mã NV runtime: chỉ `DN###`/`VP###` là mã NV thật; mã rác như `#N/A`, `83` được giữ dòng nhưng chuyển nhãn thành `UNALLOCATED` / `Chưa phân bổ`, không còn lẫn vào dropdown/card như nhân viên thật. Tổng doanh thu không đổi.
- Trace read-only mã rác: `artifacts/emp_junk_trace_20260702.md/json`. Active upload có 1 dòng `#N/A` kỳ 06.2026, Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu `1.575.000đ`; CST có 10 dòng `83` Valesto/QĐ48 Cà Mau-Bạc Liêu, bid_qty `460.000`, sold `12.000`, sold_amount `21.600.000`; 1 dòng có `sales_emps=DN021` nhưng chưa remap file nguồn trước khi Claude/CEO duyệt.
- Cập nhật lại artifact mục G `crosswalk_emp_code`: App Sale employees `31`, App Report users `37`, match exact code `30`; App Sale-only còn `1` là `VP019` kế toán. `DN021`/`VP004` hết blocker phân quyền 07.
- Nghiệm thu: `node --check` các file backend OK; `npm run build` OK; T06 vẫn `28.403.136.096đ`; runtime không còn mã NV `#N/A`/`83`, có nhóm `Chưa phân bổ`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Spec: parity Phân tích + CST dễ hiểu + lọc theo mã ĐV
- CEO yêu cầu 3 việc → ghi [`SPEC_ANALYSIS_CST_UX.md`](SPEC_ANALYSIS_CST_UX.md):
- **A) Phân tích parity:** bot trích full feature tab `pt` cũ (`report-main-v23.js`/`report-extra.js`) → bảng đối chiếu → bù thiếu (dự kiến: SP cần đẩy mạnh, SP sắp hết CST, phân tích chuyên sâu, PDF). Xuất artifact parity trước khi code.
- **B) CST dễ hiểu cho NV:** giữ tính năng + 4 lớp (gợi ý hành động từng dòng, gom theo ĐV rollup, tiến độ rõ + hạn hợp đồng, ưu tiên dòng cần làm). Độc lập nguồn — làm ngay.
- **C) Lọc theo TỪNG mã ĐV** (CEO nhấn mạnh): ô chọn ĐV nổi bật + tìm nhanh → header tóm tắt ĐV → danh sách CHỈ mã QLNB của ĐV đó; scope-aware (NV chỉ thấy ĐV của mình); áp CST+DT+Phân tích. Chủ yếu nâng UX, tái dùng param `unit`.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục G adapter SHADOW CST + crosswalk emp_code
- Đã chạy mục G ở chế độ **read-only/shadow**: không ghi App Sale, không ghi Lumos, không thay nguồn runtime App Report, không restart/deploy.
- Artifact mới: `artifacts/cutover_g/crosswalk_emp_code.json`, `cst_shadow_adapter_20260702.json`, `g_shadow_summary.md`, `worklist_lumos_static.json`, `worklist_appsale_allocation_hold.json`, `report_sync_contract_proposal.md`.
- Crosswalk `emp_code`: App Sale `31` employees, App Report `35` users; match exact code `28`; App Sale thiếu trong App Report `3` (`DN021`, `VP004` inactive, `VP019` kế toán); App Report-only `7` (`CEO`, `VP017`, `VP003`, `VP010`, `VP013`, `VP015`, `VP016`). Đây là blocker cần review trước sync doanh thu/phân quyền 07.
- CST shadow App Sale CL từ `2026-07-01`: timeline `2` order_item, gom `2` CST keys, cả `2/2` match baseline; approved-like qty `0` vì status hiện `PARTNER_RESPONDED_FULL|pending` và `HOLD_GOLIVE|pending`; ordered-eligible qty `3.000`, amount `2.940.000`. Chưa có key không match baseline trong timeline 07.
- Xuất 2 worklist theo quyết định mục G: `10` Lumos-only giữ STATIC để tổ thầu xác nhận hiệu lực; `45` App-only HOLD chờ nhập allocation/cst_quota. Đã đề xuất contract `/api/report-sync/changes?updated_since=` + service token, có cursor/idempotent/event_id.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt F + bật đèn xanh adapter SHADOW (mục G)
- Review kết quả F của bot (match **99,64%**, crosswalk tường minh, tách `107`, gộp KHU C). **Duyệt.** Ghi mục G vào `SPEC_DATASOURCE_CUTOVER.md`.
- **55 dòng lệch — không chặn shadow:** 9 Lumos-only chưa rõ hiệu lực → **giữ STATIC** (an toàn vì không có trong App Sale, không có gì trừ vào); 45 App-only thiếu allocation → **HOLD** (doanh thu vẫn tính, CST chờ tổ thầu nhập cơ số). → 2 **worklist cho tổ thầu** rà master allocation App Sale (song song).
- **Việc tiếp bot (read-only, chưa cắt Lumos):** (1) adapter SHADOW CST đối chiếu vs baseline; (2) **crosswalk `emp_code`** (chốt chặn cho sync doanh thu 07 + phân quyền); (3) xuất 2 worklist; (4) đề xuất contract `/api/report-sync/changes` + service token.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt quyết định crosswalk CL (mục F)
- Review crosswalk bot (khớp 99,6%, 2731/2741). **Duyệt rule "gói từ QĐ trong QLNB, fallback goi_code"** (goi_code mù chỉ 82,1%). Ghi mục F vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Nguyên tắc:** crosswalk = **bảng ánh xạ tường minh** (`crosswalk_units/products/bidpkg.json`), KHÔNG dùng chuẩn hóa chuỗi 3-số làm khóa runtime (thứ gây bug T06 + đụng 107).
- **4 quyết định:** (1) `001 + KHU C` → **gộp chung, CỘNG cơ số** (cùng BV, đúng app cũ; CEO xác nhận); (2) prefix `107` đụng 2 ĐV → tách tay trong bảng ánh xạ, không map bằng 3 số; (3) 10 key Lumos-only → phân loại hết hạn (giữ tĩnh) / còn hiệu lực (map hoặc flag GAP cho CEO); (4) 44 key App-only → gói mới App Sale, đưa vào nếu có allocation hợp lệ.
- **Trạng thái:** bot dọn 4 nhóm → mục tiêu ≈100% → mới viết adapter SHADOW (chưa cắt Lumos). Báo lại tỉ lệ + danh sách lệch để Claude review.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục F datasource cutover: crosswalk tường minh
- Đã pull/đọc `SPEC_DATASOURCE_CUTOVER.md` mục F và dựng artifact crosswalk tường minh read-only, không ghi App Sale/Lumos, không bật adapter/cutover.
- Tạo các bảng nháp: `artifacts/cutover_f/crosswalk_units.json`, `crosswalk_products.json`, `crosswalk_bidpkg.json`, cùng kết quả `f_crosswalk_result.json/md`. Runtime tương lai phải dùng bảng này, không dùng chuẩn hóa 3 số trực tiếp.
- Áp rule đã chốt: gói thầu lấy `QĐ` từ mã QLNB trước, fallback `goi_code`; `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` map chung target `001`; prefix `107` tách explicit thành `107_DUC_HUE` và `107_TAN_THANH` để tránh gộp sai.
- Kết quả sau explicit crosswalk: App Sale CL `3.002` offering rows / `2.776` explicit keys; Lumos CST `2.741` keys; match `2.731` = `99,64%`; còn `10` Lumos-only, `45` App-only, `226` duplicate App keys do 001/KHU C cần cộng timeline chung.
- Phân loại App-only: `0` key có allocation hợp lệ trong `cst_quota`, `45` key phải HOLD vì thiếu `cst_ban_dau_import/cst_chinh/cst_con_lai_import`. Lumos-only: `1` dòng thiếu IIT giữ static; `9` dòng còn lại chưa phân loại hết hạn/còn hiệu lực vì `cst_real.json` không có `hd_den_ngay` — cần nguồn allocation gốc/hiệu lực trước khi shadow adapter.

### 2026-07-02 — Bot triển khai (Report Bot) — Crosswalk CL-scope App Sale ↔ Lumos
- Đã đọc `SPEC_DATASOURCE_CUTOVER.md` mục C/E và chạy bước 1 **crosswalk CL-scope** read-only, không ghi App Sale, không cắt Lumos.
- Nguồn App Sale: `unit_offerings.route='CL'` join `units/products/contractors`; nguồn Lumos/App Report: CST baseline `store.getCst()`.
- Kết quả chính sau rule **lấy gói từ QĐ trong mã QLNB trước, fallback `goi_code`**: App Sale CL `3.002` offering rows, `2.775` key; Lumos CST `2.741` key; match `2.731` key = `99,6%` theo Lumos. Nếu lấy mù `goi_code`, match chỉ `82,1%`, nên không dùng `goi_code` trực tiếp cho CST adapter.
- Chưa đạt 1:1 hoàn toàn: còn `10` Lumos-only key, `44` App-only key; `227` duplicate App normalized key, trong đó `226` do `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` collapse về `001`, và `1` do prefix `107` trùng 2 đơn vị khác nhau. Artifact: `artifacts/crosswalk_cl_20260702.md`, `artifacts/crosswalk_cl_20260702_summary.json`, `artifacts/crosswalk_cl_20260702_variant_bid_from_iit.json`.
- Kết luận: **chưa bật adapter/cutover**; cần Claude/CEO chốt rule `001-KHU C` và xử lý các key thiếu trước khi viết adapter shadow.

### 2026-07-02 — Bot triển khai (Report Bot) — Biểu đồ Recharts theo kỳ + scope
- Cài `recharts@3.9.1`; thêm `GET /trend` trả `[{ky, revenue, revenueBeforeVat, targetTotal, pctTarget}]` cho mọi kỳ theo `scopeOf`.
- Tổng quan: thêm line chart doanh thu theo kỳ + overlay target, highlight kỳ đang chọn; thêm vòng tiến độ target theo bộ lọc Tháng/Quý/Khoảng; thêm bar chart Top 10 Đơn vị/Sản phẩm.
- Phân tích: chuyển sang dùng PeriodFilter Tháng/Quý/Khoảng; thêm Top 10 Đơn vị/Sản phẩm và 3 donut Tuyến / Nhà thầu / Gói thầu, top 6 + gộp `Khác`; backend `/analysis` bổ sung `byBidPackage`.
- Target: thêm PeriodFilter và vòng nhỏ % đạt trên từng card NV, màu xanh ≥100%, vàng 80–99%, đỏ <80%.
- Nghiệm thu kỹ thuật: `npm run build` OK; API check admin/sale OK (`/trend`, `/overview?from=04.2026&to=06.2026`, `/analysis`, sale DN016 chỉ thấy DN016). Bundle đã tách chunk: `index` gzip ~18,59KB, `recharts` gzip ~167,29KB; Vite còn cảnh báo chunk recharts >500KB minified nhưng build thành công.

### 2026-07-02 — Bot triển khai (Report Bot) — Guard rủi ro biên CST upload merge
- **Xác minh rủi ro baseline trễ nhiều kỳ:** baseline CST hiện có `source_from_date=01-MAY-26`, suy ra `baselineCoveredKy=05.2026`; sau guard chỉ merge các upload slot active có `ky > baselineCoveredKy`, hiện chỉ `06.2026`. Nếu sau này re-dump baseline mới hơn, slot `<= baselineCoveredKy` sẽ không bị cộng lại để tránh double-count; nếu baseline trễ >1 kỳ thì sẽ cộng tất cả slot sau mốc baseline, không chỉ latest.
- **Xác minh rủi ro khóa đơn vị 3 số:** đếm baseline CST theo key `normIit + normUnit` cho 2.741 dòng, duplicate key = `0`; upload receiver bị cộng vào >1 dòng = `0`. Đã thêm guard: nếu tương lai key CST baseline trùng >1 dòng thì bỏ merge key đó và phải điều tra/phân bổ riêng, không cộng cùng upload vào nhiều dòng.
- **Recheck:** RELIPOREX vẫn bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO vẫn bán `3.180`, còn `24`, `0,7%`. Artifact: `artifacts/cst_merge_guard_check_20260702.json`. `npm run build` OK.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt sync doanh thu 01/07 + thiết kế Target đa nguồn
- **CEO duyệt:** bot triển khai **đồng bộ doanh thu từ 01/07/2026** từ App Sale (không chỉ shadow). Ghi 4 điều bắt buộc vào `SPEC_DATASOURCE_CUTOVER.md` mục A: (1) crosswalk `emp_code` sống còn cho phân quyền; (2) liên tục thực thể xuyên kỳ cắt; (3) xác nhận VAT trước/sau; (4) kênh (CL+NCL+NT?) + net theo trạng thái.
- **Thiết kế Target đa nguồn** [`SPEC_TARGET_MULTISOURCE.md`](SPEC_TARGET_MULTISOURCE.md): 3–4 nguồn (App Sale auto / AI đề xuất / Upload / sửa tay) → mô hình **nhiều ứng viên + resolver chọn active**; ưu tiên manual>upload>appsale>ai; **AI chỉ ra ứng viên, không tự chốt**; không đè ngầm ô CEO đã khóa; UI Target admin 4 cột đối chiếu + audit.
- **Cần xác nhận:** App Sale có quản lý **target theo NV/kỳ** không (khảo sát mới thấy đơn hàng+CST). Có → 3 nguồn; chưa → làm AI+Upload+sửa tay trước, chừa adapter App Sale.
- **Trạng thái:** spec sẵn sàng cho bot; chưa cắt Lumos, sync 07 chạy khi crosswalk emp/ĐV/SP xong.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review khảo sát API App Sale + chốt Model A
- **Bot khảo sát read-only API App Sale (:3970)** (artifact `appsale_api_cutover_survey_20260702.md`). Claude review → ghi mục E vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Chốt Model = A (neo baseline Lumos):** App Sale CHƯA có đủ lũy kế bán trước 07/2026 → giữ baseline Lumos, App Sale chỉ trừ dần từ 01/07 (đính chính: bot ghi "Model B" nhưng mô tả đúng Model A).
- **Blocker phải xử trước:** (1) mã chưa khớp (SP 371/318, ĐV 195/108) → dựng crosswalk **chỉ trong phạm vi kênh CL**; (2) định nghĩa "net" bằng TRẠNG THÁI (approved/delivered/invoiced, loại CANCELLED/rejected); (3) cần App Sale bổ sung endpoint incremental `/api/report-sync/changes?updated_since=` + service token.
- **Thuận lợi:** App Sale đã có cột `cst_ban_dau_import/cst_con_lai_import` (nghi baseline từ Lumos) → cần đối chiếu; bán/timeline đủ ID/timestamp/trạng thái/cờ kênh CL/nối gói thầu.
- **Trạng thái:** KHÔNG cắt Lumos. Việc tiếp bot: crosswalk CL + đối chiếu cst_con_lai_import + đề xuất contract API + adapter SHADOW đối chiếu.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Thiết kế cutover nguồn dữ liệu Lumos → App Sale New
- **CEO đề xuất:** từ 07/2026 ngắt Lumos, đồng bộ trực tiếp từ **App Sale New** (public `appsaletest.donapharm.asia` → API `:3970`); doanh thu 01–06/2026 (Lumos) đóng băng backup; CST chốt 1 snapshot baseline tại 01/07/2026.
- **Viết spec** [`SPEC_DATASOURCE_CUTOVER.md`](SPEC_DATASOURCE_CUTOVER.md): tách DOANH THU (đóng băng lịch sử + live tương lai, rủi ro thấp) vs **CST** (baseline + trừ dần, rủi ro cao).
- **6 rủi ro CST chí mạng** phải xử lý trước khi cắt: (1) khóa khớp 2 hệ `IIT+đơn vị+gói thầu`; (2) chiều gói thầu QĐ139/141; (3) chỉ kênh CL; (4) **nguồn allocation gói mới sau 01/07**; (5) bán ròng (net trả hàng); (6) chống đếm trùng (ID duy nhất + cursor idempotent).
- **4 câu hỏi bot phải khảo sát API App Sale trước khi cắt** (mã có khớp Lumos? cờ kênh? ID giao dịch + incremental? có quản lý allocation?).
- **Thứ tự an toàn:** khảo sát API → adapter chạy SONG SONG đối chiếu → đóng băng T06 final + snapshot CST 01/07 → delta=0 → mới cắt Lumos. Không đụng app cũ 3860; App Sale chỉ đọc.
- **Trạng thái:** thiết kế + checklist sẵn sàng; **chờ bot trả lời 4 câu khảo sát API** để chốt hợp đồng API chi tiết.
- **CẬP NHẬT (CEO chốt):** Q4 = **CÓ** — App Sale quản lý gói thầu/allocation → nguồn cấp cơ số mới nằm ở App Sale. Kéo kiểu **timeline theo trạng thái thực**. Phát sinh **1 câu kiến trúc mới**: App Sale có đủ dữ liệu gói CŨ (allocation + lũy kế bán trước 07) không → quyết **Model B** (đọc thẳng, bỏ baseline Lumos) hay **Model A** (neo baseline Lumos 01/07 + trừ dần). Đã mở rộng brief khảo sát API (7 mục) cho bot chạy TRƯỚC khi cắt.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt spec Telegram Digest V2 (chi tiết)
- **Duyệt đề xuất Digest V2** (CEO + bot đề xuất): nâng bản tin 1 dòng → báo cáo nhanh có **top 3–5 từng mục** (Doanh thu / Target NV / CST sắp cạn / Đơn vị giảm mạnh / Gợi ý xử lý).
- **Viết spec chi tiết** vào `SPEC_TELEGRAM_DIGEST.md` (PHẦN B2) để bot triển khai: map 1–1 từng mục vào `smart.buildAlerts()` (4 nhóm sẵn) + `overviewKpis()` → **KHÔNG tính lại trong bot, số khớp app 100%**.
- **5 điểm review bắt buộc:** (1) 2 khuôn theo scope — NV sale ra "của bạn", không lộ số người khác; (2) empty-state tích cực (✅) không để mục trống; (3) định dạng số kiểu VN (phẩy thập phân, `28,40 tỷ` / `650tr`); (4) top N + giới hạn <3500 ký tự; (5) gửi PLAIN TEXT (không `parse_mode`) tránh vỡ Markdown do tên đơn vị/SP.
- **Lệnh:** `/digest_test` (chi tiết, mọi user map ra digest của mình theo scope), `/digest_short` (bản 1 dòng cũ), `/digest_full` (top 5); định kỳ 07:30 VN dùng bản V2 top 3.
- **Trạng thái:** spec sẵn sàng, **chờ bot triển khai + build/restart `reportnew-tgbot`** rồi Claude review số liệu. Chưa đụng code app (đúng phân vai).

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 Telegram go-live
- **Nhận token BotFather riêng cho `@Reportdonapharm_bot` và cấu hình runtime an toàn:** ghi `TELEGRAM_BOT_TOKEN` vào `.env` local/server (không commit), giữ `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot`, `TELEGRAM_BOT_SECRET` 64 ký tự, `APP_PUBLIC_URL=https://reportnew.donapharm.asia`.
- **Verify bot thật:** Bot API `getMe` trả `username=Reportdonapharm_bot`, `id=8471035818`. PM2 worker `reportnew-tgbot` đã start online và `pm2 save`.
- **Map CEO Telegram:** map `telegram_id=1748199545` → `CEO`; restart `reportnew` + `reportnew-tgbot` để nạp mapping bền.
- **Nghiệm thu Login V2 backend:** `/api/auth/mode` trả `{live:true,demo:false,telegram:true}`; flow `telegram/start → telegram/confirm(secret_bot, telegram_id CEO) → telegram/status` trả token; `/api/me` bằng token Telegram trả `emp_code=CEO`, `role=admin`, `isAdmin=true`.
- **Nghiệm thu bot gửi tin:** gửi message qua Bot API tới CEO thành công. Sếp có thể gửi `/digest_test` vào `@Reportdonapharm_bot` để test đúng handler digest chủ động từ Telegram update.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_CHARTS** (Recharts, CEO duyệt): 4 biểu đồ — (1) đường DT theo kỳ + overlay target (Tổng quan, backend mới GET /trend), (2) cột top đơn vị/SP (tái dùng /revenue), (3) donut cơ cấu tuyến/nhà thầu/gói (tái dùng /analysis), (4) vòng tiến độ target (Tổng quan + Target). Tất cả theo bộ lọc kỳ + scope. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Fix CST trừ thiếu upload kỳ mới nhất
- **Điều tra không ép số:** trace 2 ca CEO nêu cho thấy `cst_real.json` là baseline đã trừ SALES_REPORT DB đến trước kỳ upload mới nhất, nhưng App Report New chưa cộng phần upload `06.2026` giống app cũ. Lỗi là thiếu bước merge upload hiện tại theo khóa `IIT_CODE + DONVI chuẩn hóa`, không phải sai `GIVEN_QUANTITY`.
- **Sửa công thức CST runtime:** `store.getCst()` nay lấy baseline `cst_real.json` rồi cộng slot upload active mới nhất (hiện `06.2026`) cho tuyến CL theo khóa `IIT_CODE + mã đơn vị chuẩn hóa`; chuẩn hóa đơn vị xử lý cả dạng `002` và `002.BVĐK...`, giữ merge `001.BVĐK Đồng Nai-KHU C → 001.BVĐK Đồng Nai`. Cập nhật `sold_qty`, `remain_qty`, `% còn`, `sold_amount`, `remain_amount`; không sửa/ép file nguồn.
- **Sửa trạng thái UI:** CST còn `<=1%` được hiển thị `Hết CST` như app cũ (còn lẻ do quy cách/đóng gói), ngoài trường hợp còn `0`.
- **Nghiệm thu:** RELIPOREX 4000 IU @ `002.BVĐK Thống Nhất ĐN` từ baseline bán `31.600` + upload 06 `1.800` = bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO @ `001.BVĐK Đồng Nai` từ baseline bán `1.560` + upload 06 `1.620` = bán `3.180`, còn `24`, `0,7%` và UI `Hết CST`. Thêm 5 mẫu đối chiếu diff `0` trong `artifacts/cst_verify_after_upload_merge_20260702.json`. `npm run build` OK.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix múi giờ Telegram digest
- **Sửa scheduler digest theo giờ VN:** `DIGEST_CRON` vẫn hiểu là giờ Việt Nam (`Asia/Bangkok/Ho_Chi_Minh`), nhưng khi so với `Date#getUTCHours()` nay đổi sang `targetUtcHour = (cron.hour - 7 + 24) % 24`. Vì vậy `30 7 * * *` bắn đúng **07:30 VN** (= 00:30 UTC), không lệch sang 14:30 VN.
- **Log rõ giờ:** worker in cả giờ VN và giờ UTC tương ứng để dễ kiểm tra vận hành.
- **Test:** mô phỏng cron mặc định + cron phút kế tiếp theo giờ VN OK; `node --check server/telegram-bot.js` OK; `npm run build` OK. Chưa nghiệm thu live vì vẫn chờ `TELEGRAM_BOT_TOKEN` thật.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — REVIEW
- **Duyệt Phần A (rolling session)**: an toàn (chặn phiên hết hạn; deviceId đã có thì không cho đổi máy). Hết lỗi bắt OTP lại khi dùng cùng máy.
- **⚠ Phần B (digest) LỖI MÚI GIỜ:** DIGEST_CRON "30 7" là 7:30 VN nhưng scheduler so getUTCHours()===7 → bắn 14:30 VN. Cần đổi VN(UTC+7)→UTC: targetUtcHour=(hour-7+24)%24. Logic còn lại (scope/loại NV nghỉ/opt-out/chống trùng) OK.
- **Ghi SCOPE điều chuyển:** đặt trong App Report (khu Quản trị), làm SAU, không hồi tố lịch sử.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_TELEGRAM_DIGEST
- **Phần A — sửa phiên đăng nhập:** đổi session từ TTL tuyệt đối 60 phút sang rolling idle TTL `SESSION_IDLE_DAYS` ngày (mặc định 7). Mỗi request có token hợp lệ gia hạn `expires_at = now + IDLE_TTL`; backend đọc `X-Device-Id` trong `requireAuth`, bind cho session cũ chưa có deviceId và touch đúng thiết bị, tránh cùng máy bị tính thiết bị thứ 4 oan. Upload preview cũng gửi `X-Device-Id`.
- **Giữ kiểm soát thiết bị:** vẫn tối đa 3 thiết bị/NV, evict thiết bị cũ nhất, purge session/device khi đổi SĐT/quyền/xóa NV, admin vẫn xem/xóa thiết bị.
- **Phần B — bản tin Telegram chủ động:** thêm scheduler trong `server/telegram-bot.js` theo `DIGEST_CRON` (mặc định `30 7 * * *`, giờ VN). Bản tin sáng dùng số theo scope: CEO/admin toàn công ty, sale theo mã NV; chỉ gửi Telegram đã map và user còn active/có doanh thu kỳ mới nhất; lưu opt-out bền bằng `/tat`, bật lại `/bat`, chống trùng theo ngày; admin có `/digest_test` gửi thử cho chính mình.
- **Trạng thái live:** phần B vẫn chờ `TELEGRAM_BOT_TOKEN` thật của `@Reportdonapharm_bot` để worker chạy và nghiệm thu thực tế.
- **Nghiệm thu kỹ thuật:** test rolling/device bằng `AUTH_DATA_DIR` tạm OK; `node --check server/telegram-bot.js` OK; `npm run build` OK.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Duyệt báo cáo parity + chốt SCOPE_DECISIONS** (CEO quyết): LÀM = biểu đồ Recharts (4 chart), PDF/print, Target admin (nhập/sửa + AI đề xuất), Tab Nhân viên BẢN GỌN (+cờ nghỉ việc, không PII nhạy cảm), Tab Đối chiếu read-only, hoạt chất/nhóm thuốc. CẮT = Điều chuyển NV, thưởng 3P/gửi Zalo-Email, sửa kho master. SAU = export mẫu cũ/page-size, upload loại khác, AI nối sâu. Bot theo SCOPE_DECISIONS.md.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_PERIOD_FILTER Tổng quan
- **Pull spec:** đã pull `a30e0b7` và triển khai `SPEC_PERIOD_FILTER.md` cho Dashboard Tổng quan.
- **Bộ lọc kỳ mới:** thay chip tháng phẳng bằng `PeriodFilter` 3 chế độ Tháng/Quý/Khoảng, mặc định tháng mới nhất, có nút ‹/› tháng và nhãn rõ `Tháng 06.2026`, `Quý 2/2026 (04–06)`, `01.2026 → 06.2026`.
- **Backend range:** thêm `store.getRowsRange`, `getTargetsRange`, `periodRange`, `previousKys`; các API tổng hợp chính nhận `ky` hoặc `from+to`; MoM so kỳ liền trước cùng độ dài; target cộng theo range.
- **CST:** giữ snapshot hiện tại, không đổi theo kỳ/range; KPI và alert ghi rõ “hiện tại”.
- **Layout:** KPI Tổng quan PC 6 cột đều, màn vừa 3×2, mobile 2 cột; 4 nhóm cảnh báo luôn hiển thị cân đối 2×2 hoặc 4 cột, không còn card lẻ.
- **Nghiệm thu:** Q2/2026 doanh thu `93.596.229.347` = cộng tay 04+05+06, MoM `+11,7%`, CST cạn `288`; khoảng 01→06 doanh thu `177.386.533.614` = cộng tay 6 tháng, CST vẫn `288`. DN009 Q2 đúng scope: doanh thu `8.446.239.852`, `empCount=1`, CST cạn `10`. Build OK, live browser kiểm PC 1440: KPI 6 cột + alert 2×2; PC 1920: alert 4 cột; mobile 390: KPI 2 cột.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_TELEGRAM_DIGEST** (CEO duyệt): (A) SỬA phiên đăng nhập — rolling session gia hạn theo hoạt động + thiết bị tin cậy hạn 7 ngày (env SESSION_IDLE_DAYS) + deviceId ổn định (hết bắt OTP lại khi dùng cùng máy); (B) Bản tin Telegram chủ động (sáng CEO + sáng NV theo scope, chỉ NV đã map & đang hoạt động, opt-out /tat, chống trùng, cron). Bot triển khai.


### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_PERIOD_FILTER** (bộ lọc kỳ: Tháng/Quý/Khoảng, mặc định tháng mới nhất, ‹›lùi/tới; backend nhận ky HOẶC from-to gộp nhiều tháng; MoM so kỳ liền trước cùng độ dài; CST là snapshot không đổi theo kỳ) + cân đối dashboard (6 KPI đều hàng, 4 nhóm cảnh báo 2×2/4 cột không lẻ). Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — List UI theo mẫu Phân tích
- **CSS dùng chung:** thêm `.list-grid` + `.rank-card` để các danh sách tự opt-in thành lưới card 2–3 cột trên PC, mobile 1 cột; không đụng `.page-desktop`.
- **Doanh thu:** danh sách ranking chuyển sang card trong `.list-grid`, vẫn giữ hạng/tên/meta/bar/số tiền và drill-down NV → ĐV → SP.
- **Sản phẩm:** mỗi sản phẩm là card gọn gồm tên, mã QLNB, doanh thu, SL, độ phủ ĐV/NV/gói và bar.
- **Target:** cả tab “Kỳ này” và “Dự báo” chuyển thành lưới card NV 2–3 cột.
- **Cơ số thầu:** thay bảng ngang bằng card CST trong `.list-grid`, giữ thông tin chính app cũ: mã, thuốc, hoạt chất/hàm lượng/ĐVT, nhóm/UT, gói thầu, đơn vị, NV, giá, SL/TT bán-còn, % còn lại, ngày nguồn, trạng thái.
- **Test live:** build OK; PC 1440px hiển thị 2 cột đều, PC 1920px hiển thị 3 cột đều, mobile 390px hiển thị 1 cột; Revenue drill-down vẫn hoạt động.

### 2026-07-02 — Bot triển khai (Report Bot) — Overview mở rộng 6 KPI
- **Backend `overviewKpis`:** thêm `empTarget:{achieved,total}` tính theo NV đang bán trong kỳ và có target thật, đạt >=100% target trước VAT; thêm `cstLowCount` theo scope (`remain_pct < 10`). Giữ nguyên các KPI cũ.
- **Frontend Overview:** hàng KPI đổi thành 6 ô theo thứ tự CEO chốt: Doanh thu sau VAT + MoM, Trước VAT, Đạt target %, NV đạt target, Cơ số thầu sắp cạn, Quy mô kỳ. Ô “Cơ số thầu sắp cạn” tone đỏ và bấm được để nhảy sang tab CST lọc `<10%`.
- **Test:** build OK. CEO kỳ 06.2026: doanh thu `28.403.136.096`, trước VAT `27.050.605.806`, target `90%`, NV đạt target `7/20`, CST cạn `288`, quy mô `126 ĐV · 241 SP · 22 NV`. DN009 scope: target `108%`, NV đạt `1/1`, CST cạn `10`, quy mô `12 ĐV · 65 SP · 1 NV`.

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 guard khi chưa có token Telegram
- **Chuẩn bị go-live Login V2:** đã set `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot` trong `.env`; `TELEGRAM_BOT_SECRET` 64 ký tự giữ nguyên.
- **Siết an toàn `telegramConfigured()`:** chỉ trả `true` khi đủ `TELEGRAM_BOT_SECRET + TELEGRAM_BOT_USERNAME + TELEGRAM_BOT_TOKEN`; hiện token BotFather chưa được cung cấp nên `/api/auth/mode` trả `telegram:false`, màn login chỉ hiện OTP để tránh nút Telegram hỏng.
- **Build/restart:** `npm run build` OK, `pm2 restart reportnew` OK. Chờ CEO gửi token thật của @Reportdonapharm_bot để chạy `getMe`, start worker `reportnew-tgbot`, map CEO và nghiệm thu Login V2.

### 2026-07-02 — Bot triển khai (Report Bot) — Dashboard “Cần chú ý” V2 phân nhóm
- **Theo `SPEC_DASHBOARD_V2.md`:** backend `buildAlerts` đổi từ list phẳng sang `{ ky, summary, groups[] }`, tách nhóm `target`, `unit_down`, `cst_low`, `cst_high`, mỗi nhóm `total` + top 8.
- **Fix cảnh báo target:** chỉ duyệt `empCodesWithData(ky)` (NV đang bán), bắt buộc có target thật `>0`, bắt buộc resolve được tên trong danh bạ; loại NV nghỉ/không hợp lệ nên **DN014 không còn hiện “0% target”**.
- **Frontend Overview:** thêm strip tóm tắt “NV chưa đạt · đơn vị giảm · CST sắp cạn/tồn nhiều”, hiển thị các khối cảnh báo theo nhóm icon/màu riêng, top 5–8 dòng, nút “Xem tất cả” nhảy sang tab Target/Doanh thu/CST kèm lọc ban đầu. PC dùng `alerts-grid` nhiều cột; mobile giữ 1 cột.
- **Test:** build OK. CEO alerts: target `9`, unit_down `25`, cst_low `288`, cst_high `1533`, DN014 không xuất hiện; DN009 scope alerts chỉ còn phạm vi DN009 (`unit_down=3`, `cst_low=10`, `cst_high=30`, target `0`).

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_DASHBOARD_V2** (dashboard "Cần chú ý" smart): phân NHÓM (NV target / đơn vị giảm / CST cạn / CST tồn) thay danh sách phẳng 1857 dòng; mỗi nhóm top 5–8 + đếm + "Xem tất cả" nhảy tab lọc sẵn; **chỉ cảnh báo NV đang hoạt động** (có doanh thu trong kỳ) → loại NV nghỉ như DN014; luôn hiển thị tên (không resolve được → loại). buildAlerts đổi sang cấu trúc groups. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Đóng Bước 3 mục CST 2.741
- **Đóng mục 1/CST trong Bước 3 đối chiếu:** xác minh lại `store.getCst` app mới có **2.741 dòng**, `blankIit=1`, có dòng `Bividia 25 · 108. BVĐK LONG AN · DN001` với CST còn `44.000`, TT còn lại `79.200.000`.
- **Tổng CST khớp app cũ diff 0:** CST ban đầu `182.837.992`, SL đã bán `62.993.027`, SL còn `120.068.002`, TT còn lại `399.841.752.609`; DN009 vẫn **85 dòng** đúng scope.
- **Tài liệu:** cập nhật `MIGRATION_MATRIX.md` để đánh dấu CST 2.741 đã đóng theo chuẩn app cũ; artifact chuẩn vẫn là `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Upload tách Import mới / Import cập nhật
- **Xác minh LIVE sau pull/build/restart:** đăng nhập CEO/admin trên `https://reportnew.donapharm.asia` thấy mục **“⬆️ Upload”** trong navigation; code tab vẫn `adminOnly` và lọc bằng `me.isAdmin` từ `/api/me`.
- **Tách rõ 2 luồng Upload:** `Import mới (kỳ mới)` chỉ cho kỳ chưa có, nếu kỳ tồn tại thì chặn/gợi ý chuyển cập nhật; `Import cập nhật (kỳ hiện có)` chọn kỳ đang active và hiển thị cảnh báo thay dữ liệu kỳ hiện có bằng file mới, slot cũ giữ lại để rollback. Giữ tab `Lịch sử & khôi phục`.
- **Backend an toàn ghi đè:** preview vẫn parse/validate bằng backend, bổ sung `duplicateCount`; commit nhận `mode=new|update`, audit phân biệt `commit_new`/`commit_update`, lưu `replacedSlotId`, không xoá slot cũ. Rollback vẫn kích hoạt lại slot cũ cùng kỳ.
- **Test:** `npm run build` OK; test bằng backup/restore runtime: import mới kỳ thử tạo slot mới + phát hiện 1 dòng nghi trùng; import mới vào kỳ đã có bị chặn; import cập nhật kỳ 06.2026 tạo slot thay thế có `replacedSlotId`, audit đủ; rollback trả active về slot cũ. Sau test đã restore runtime upload slots/uploads/audit, không để lại dữ liệu thử.

### 2026-07-02 — Bot triển khai (Report Bot) — CST mismatch đã xử lý theo chốt giữ dòng thiếu mã QLNB
- **Theo chốt Claude/CEO:** giữ dòng CST thật thiếu `iit_code` (`Bividia 25` · `108. BVĐK LONG AN` · `DN001` · còn `44.000` · TT còn `79.200.000`) để chuẩn đối chiếu khớp app cũ **2.741 dòng**.
- **Sửa importer CST:** không còn đòi `iit_code`; filter CST chỉ còn điều kiện có `unit_code` và có số lượng thầu (`bid_qty_initial > 0`). Nguyên tắc chung: không loại dòng thật chỉ vì thiếu field phụ (`iit_code`...).
- **Downstream/UI:** mã QLNB rỗng hiển thị `—`; key dòng fallback bằng `product_name + unit + emp` để không gộp/đè; filter product theo `iit_code` không nhân đôi dòng rỗng, tìm kiếm vẫn thấy theo tên sản phẩm/đơn vị/NV.
- **Re-import + đối chiếu:** app mới CST **2.741 dòng**, tổng CST ban đầu **182.837.992**, SL đã bán **62.993.027**, SL còn **120.068.002**, TT còn lại **399.841.752.609** — khớp app cũ diff 0. DN009 vẫn **85 dòng**, `badScope=0`; build OK. Artifact: `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 mở rộng tạm DỪNG vì lệch CST
- **Đã bắt đầu đối chiếu mở rộng theo từng tab 01→06/2026** sau khi P0 CST đã push: Overview/Doanh thu/DT đầy đủ/Sản phẩm/Target/Phân tích đều đang khớp tổng kỳ ở phần đã kiểm.
- **DỪNG đúng quy tắc vì phát hiện lệch CST app cũ ↔ app mới:** nguồn app cũ `artifacts/cst_full_from_old.json` có **2.741 dòng**, app mới `server/data/cst_real.json` có **2.740 dòng**. Lệch đúng 1 dòng: `Bividia 25`, đơn vị `108. BVĐK LONG AN`, NV `DN001`, `iit_code` rỗng, CST ban đầu/còn lại **44.000**, giá thầu **1.800**, `TT còn lại` **79.200.000**. Importer hiện loại dòng này vì thiếu `iit_code`; chưa tự sửa/chưa ép khớp.
- **Artifact kiểm tra:** `artifacts/reconcile_tabs_until_cst_mismatch_20260702.json`. Chờ CEO/Claude quyết định: giữ dòng thiếu mã QLNB trong CST hay loại có chủ đích khỏi cả hai bên.

### 2026-07-02 — Bot triển khai (Report Bot) — P0 CST hoàn tất bảng + cảnh báo giống app cũ
- **Hoàn tất P0 CST theo ưu tiên CEO:** đổi tab CST từ card rút gọn sang **bảng ngang đầy đủ cột** kiểu app cũ: mã QL nội bộ, tên thuốc, hoạt chất, hàm lượng, ĐVT, nhóm, UT, gói thầu, đơn vị, NV phụ trách, giá thầu/giá bán, tổng TT, CST còn lại, % còn lại, tổng/SL đã bán, SL còn, TT đã bán, TT còn lại, ngày nguồn, trạng thái.
- **Cảnh báo/trạng thái CST theo logic app cũ:** Hết CST, ⚠️ Chưa bán, 🔴 Chưa khai thác, 🟡 Còn nhiều, ✅ Đang bán; thêm chip lọc nhanh “Chưa bán” + thống kê cảnh báo Sắp cạn/Hết CST, Chưa bán, Chưa khai thác/tồn nhiều ngay trên trang.
- **Backend/export:** `/api/cst` và export `cst.xlsx` nhận thêm `status=empty`; tìm kiếm CST bao gồm `sales_emps`; Excel CST xuất đủ cột nghiệp vụ. `import_cst.js` giữ thêm `raw_nv` và `sales_emps` từ artifact app cũ; đã re-import `server/data/cst_real.json` từ `artifacts/cst_full_from_old.json`.
- **Test:** `npm run build` OK. Kiểm số liệu trực tiếp: CEO CST **2.740 dòng**; DN009 CST **85 dòng**, `badScope=0`; CST `<10%` **291 dòng**; CST “Chưa bán” **1.228 dòng**. Chưa đụng app cũ `dona-report` cổng 3860.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 đối chiếu app cũ ↔ app mới
- **Đối chiếu doanh thu 01→06/2026 app cũ ↔ app mới: KHỚP 100%.** Đã ghi bảng vào `MIGRATION_MATRIX.md`: từng kỳ khớp số dòng, tổng tiền, số NV và dòng mẫu; diff toàn bộ = 0. Nguồn 01→03 là ORDS artifact đã dump theo logic app cũ, 04→06 là file upload app cũ. Không làm tròn/không tự chỉnh số.

### 2026-07-02 — Bot triển khai (Report Bot) — Mobile CSS P0
- **Chốt phần `styles.css` dở:** bổ sung padding đáy mobile có `safe-area`; test viewport ~375px sau khi scroll cuối trang còn hở **28px** trên bottom-nav, nội dung không bị nav che. _Build OK._

### 2026-07-02 — Bot triển khai (Report Bot) — LOGIN V2 (theo SPEC_LOGIN_V2)
- **Triển khai đủ màn đăng nhập V2: Telegram (chính) + Zalo OTP (dự phòng) + phiên 60' lưu bền + thiết bị tin cậy.**
- **Backend:**
  - `persist.js` (mới): lưu bền bằng file JSON atomic ở `server/data/auth/` (không thêm dependency). Chứa phiên/thiết bị/mapping/audit; đã thêm `server/data/auth/` vào `.gitignore`.
  - `auth.js`: phiên chuyển từ Map RAM → **lưu bền, TTL 60'** (lưu hash token, không lưu token thô), gắn `deviceId`; **tối đa 3 thiết bị tin cậy/tài khoản** — thiết bị thứ 4 tự đá thiết bị **cũ nhất** (`first_seen` cũ nhất) + audit + hủy phiên của nó; **tự hủy phiên+thiết bị khi đổi quyền/SĐT/xoá khỏi danh bạ** (kiểm tại `requireAuth`). Telegram login lifecycle với **4 quy tắc chống device-code phishing**: (1) bot hỏi ✅ mới confirm; (2) mã TTL 120s **dùng 1 lần**; (3) trình duyệt poll bằng `poll_secret` (không phải mã hiển thị) nên biết mã cũng không rút được token; (4) rate-limit tạo mã ≤5/phút/IP, poll ≥2s, `confirm` sai `secret_bot` → 403 + log. Mapping `telegram_id↔emp_code` **admin duyệt** trước.
  - `routes.js`: thêm `/auth/telegram/start|status|confirm`; admin `/admin/telegram-map` (GET/POST/DELETE), `/admin/devices` (GET, DELETE/:id); các route đăng nhập nhận `deviceId` (header `X-Device-Id`) + IP (Cloudflare) + UA; `/auth/mode` báo thêm `telegram`.
- **Frontend:** `Login.jsx` bố cục mới — tiêu đề *“Đăng nhập App Report”* + nút **Telegram (chính)** hiện mã `RP-XXXXXX` + link mở bot + đếm ngược 120s + poll `poll_secret` + cảnh báo chống phishing; **OTP Zalo dạng dự phòng** bên dưới (giữ nguyên luồng); giữ QR Zalo OA + demo. `api.js`: sinh `deviceId` bền (localStorage) gửi kèm mọi request, thêm `telegramStart/Status` + API admin thiết bị/mapping.
- **Worker:** `server/telegram-bot.js` (mới) — long-poll Bot API, nhận mã (kể cả deep-link `/start RP-...`), gửi nút **“✅ Xác nhận đăng nhập App Report lúc HH:MM”** + cảnh báo *“Không gửi mã này theo yêu cầu của người khác”*, chỉ khi bấm ✅ mới gọi `/auth/telegram/confirm` kèm `secret_bot`. `.env.example` thêm `TELEGRAM_BOT_SECRET/TOKEN/USERNAME` + `APP_BASE_URL` (không commit `.env`).
- **Nghiệm thu (HTTP thật trên instance tạm cổng 3899, KHÔNG đụng production 3873):**
  1. **Phân quyền:** CEO `admin`, `/overview 06.2026` = **28.403.136.096đ**; DN009 `sale`, `/cst` = **85 dòng** đúng scope; DN009 gọi `/admin/devices` → **403**. ✓
  2. **Telegram end-to-end:** start trả code+poll_secret+bot_link; confirm sai secret → **403**; telegram chưa map → **404 (“chưa được cấp quyền”)**; confirm đúng → ok; dùng lại mã → **409**; status bằng poll_secret → **confirmed + token**, `/me` = DN009; poll_secret sai → **expired**. ✓
  3. **Session bền:** kill process (port DOWN) → khởi động lại → **token cũ vẫn đăng nhập được** + mapping còn nguyên. ✓
  4. **Thiết bị:** đăng nhập 4 deviceId → còn **3**, thiết bị cũ nhất bị đá; admin xem/xoá được. ✓
  5. Build web OK; `node --check` toàn bộ file OK.
- **⚠ CÒN CHỜ để go-live Telegram:** cần **token bot RIÊNG qua @BotFather** (không dùng chung token bot OpenClaw) đặt `TELEGRAM_BOT_TOKEN` trong `.env` để chạy worker + test nút ✅ thật trên Telegram. Chưa deploy lên production 3873 (chờ CEO/Claude review). Zalo OTP giữ live-test riêng để tránh gửi OTP thật ngoài ý muốn.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **CEO chốt chuẩn UI desktop = trang "Phân tích"** (KPI ngang + panel 2–3 cột). Ghi vào `CLAUDE.md`. Việc tiếp cho bot: nâng các trang còn 1 cột dọc (Doanh thu, Sản phẩm, Target, CST) theo mẫu này trên PC; mobile giữ 1 cột.
- **Đồng bộ layout PC mọi trang (CEO yêu cầu).** Bỏ lưới auto-fill "tự chia cột" trên `.page-desktop` (nguyên nhân khung trắng trống + mỗi trang bể một kiểu khi bot thêm trang mới). Nay: mọi trang chảy dọc **full-width trong khung 1600px giữa màn**; phần nhiều cột khai báo tường minh — `.kpi-grid` (KPI 4 cột) và `.alerts-grid` mới (cảnh báo Overview, bọc trong `Overview.jsx`). _Test preview 1920px: Tổng quan/Doanh thu/DT đầy đủ/Sản phẩm/Phân tích/CST/Target tất cả card = 1536px đồng nhất, hết khung trống; mobile 375px giữ bottom-nav, 1 cột, không tràn ngang. ⚠ Bot: commit phần styles.css đang sửa dở TRƯỚC khi pull để tránh conflict._
- **Chốt SPEC màn đăng nhập V2** (`SPEC_LOGIN_V2.md`): Telegram login (chính, có chống device-code phishing: bot hỏi ✅ xác nhận, mã TTL 120s dùng 1 lần, poll bằng poll_secret, mapping telegram_id↔emp_code admin duyệt) + Zalo OTP (dự phòng, giữ nguyên) + **session 60' lưu bền (file/SQLite)** + **tối đa 3 thiết bị tin cậy/tài khoản** (thứ 4 đá cũ nhất, admin xem/xoá, tự hủy phiên khi đổi SĐT/quyền). Kèm tiêu chí nghiệm thu. _Bot server triển khai theo spec; Claude review sau khi push._

### 2026-07-02 — Bot triển khai (Report Bot)
- **Fix nhỏ P0/CST: đồng bộ lọc `filters.emp` trong `analytics.cstTable` với `store.getCst`.** `store.getCst` đã chuẩn hoá `.trim().toUpperCase()` cả mã NV trong scope lẫn mã NV trên từng dòng (dòng CST có thể chứa nhiều mã NV cách nhau dấu phẩy), nhưng `cstTable` lọc `filters.emp` lại so sánh nguyên văn → lệch hoa/thường thì trả 0 dòng. Nay `cstTable` chuẩn hoá cùng cách. Lý do: tránh NV/CEO lọc CST theo mã NV bị mất dòng chỉ vì khác hoa/thường. _Test: real data, `filters.emp="dn009"` (thường) và `"DN009"` (hoa) đều trả **85 dòng**, 100% dòng thuộc đúng scope DN009; `node --check` OK._

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Tiếp tục Đợt 2/P0: bổ sung “Doanh thu đầy đủ” + “Sản phẩm” + “Phân tích”.** Backend thêm API `/api/revenue/full` để xem từng dòng bán hàng có phân trang, `/api/products` để tổng hợp theo mã QLNB/sản phẩm, `/api/analysis` để so kỳ trước theo đơn vị/sản phẩm/tuyến/nhà thầu/UT. Export Excel thêm `revenue_full` và `products`, vẫn chạy qua backend và tôn trọng scope quyền.
- **Frontend thêm 3 tab nghiệp vụ:** `DT đầy đủ` hiển thị bảng chi tiết NV/tuyến/đơn vị/mã QLNB/sản phẩm/nhà thầu/gói/SL/doanh thu; `Sản phẩm` hiển thị top mã QLNB kèm độ phủ đơn vị/NV/gói thầu; `Phân tích` hiển thị tăng/giảm so kỳ trước và cơ cấu tuyến/nhà thầu/UT. Bộ lọc dùng chung với Doanh thu và chạy backend: kỳ/NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói/tìm kiếm.
- **Test:** `npm run build` OK. API smoke local: CEO kỳ `06.2026` `/revenue/full` thấy **2.001 dòng / 28.403.136.096đ**; DN009 thấy **130 dòng / 3.058.543.979đ** và kiểm 130/130 dòng đều `emp_code=DN009`; `/products` CEO thấy 241 mã, DN009 thấy 65 mã; `/analysis` CEO rowCount 2.001, DN009 rowCount 130. Export `revenue_full.xlsx` trả HTTP 200.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Bắt đầu Đợt 2/P0: thêm bộ lọc backend cho Doanh thu + CST và lập ma trận chuyển app cũ.** Thêm `MIGRATION_MATRIX.md` để theo dõi từng tab app cũ → app mới. API mới `/api/filters` trả danh sách NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói thầu theo quyền; `/api/revenue`, `/api/cst` và export Excel nay nhận bộ lọc backend (`emp`, `unit`, `product`, `route`, `priority`, `contractor`, `bid`, `q`). UI Doanh thu có bộ lọc kỳ/NV/ĐV/SP/tuyến/UT/nhà thầu/gói/tìm kiếm; UI CST có bộ lọc gói thầu/NV/ĐV/SP/UT/tìm kiếm và hiển thị thêm NV, giá thầu, TT đã bán, TT còn lại. Test: build OK, PM2 `reportnew` restart OK; public `/api/auth/mode` vẫn `{live:true,demo:false}`; API lọc DN009 kỳ 06 doanh thu trả **3.058.543.979đ**; CST DN009 `<10%` trả 10 dòng, sale scope không lộ dòng ngoài DN009.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn tất Đợt 1 nền dữ liệu để chuẩn bị sang Đợt 2.** Vì app cũ chỉ có file upload 04/05/06 trong `webapp_donapharm/data`, đã dump thêm 01/02/03.2026 trực tiếp từ ORDS `SALES_REPORT` theo logic app cũ rồi import bằng `server/scripts/import_legacy.js`. Kết quả active slots: 01.2026 `2.094` dòng / `21` NV / **32.509.346.732đ**; 02.2026 `1.308` dòng / `21` NV / **17.507.218.993đ**; 03.2026 `2.175` dòng / `21` NV / **33.773.738.542đ**; 04/05/06 giữ nguồn upload CEO đã chốt.
- **Target thật đã đủ 01→06.2026 trên server runtime.** Import 01/02/03 từ `erp-support-widget/server/nv-targets.json` (19 NV/kỳ, tổng **29.562.862.426đ**/kỳ); 04/05/06 dùng `PHARMA_NEW.V_TEM_TARGET_BONUS` kỳ 04 làm fallback app cũ (21 NV/kỳ, tổng **30.062.862.426đ**/kỳ).
- **Thêm importer CST thật và chuyển store sang ưu tiên `cst_real.json`.** Thêm `server/scripts/import_cst.js`; `store.getCst()` đọc `server/data/cst_real.json` nếu có, đồng thời lọc quyền NV kể cả dòng có nhiều mã NV phân tách dấu phẩy. Đã dump CST thật từ `V_TEMP_PHARMA` (`FROM_DATE` mới nhất <= tháng hiện tại, `TUYEN='CL'`, `GIVEN_QUANTITY>0`) + `SALES_REPORT` từ `DATE '2025-03-01'`, import được **2.740** dòng, **60** đơn vị, **301** sản phẩm, **19** NV; nguồn `source_from_date=01-MAY-26`. Test API: CEO `/cst` thấy 2.740 dòng; DN009 thấy 85 dòng, không có dòng ngoài DN009.
- **Kiểm API sau import:** `/periods` có 01→06.2026; `/overview?ky=01.2026` trả doanh thu **32.509.346.732đ**, `2.094` dòng, `21` NV; `/overview?ky=06.2026` vẫn **28.403.136.096đ**, `2.001` dòng, `22` NV; OTP live/demo off.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Rà nguồn TARGET/CST app cũ và import target thật theo logic fallback.** App cũ `webapp_donapharm` proxy `/api/targets` sang backend OTP `localhost:3848`; backend lưu local tại `erp-support-widget/server/nv-targets.json` với các kỳ `01.2026`→`04.2026`. Frontend cũ fallback DB `PHARMA_NEW.V_TEM_TARGET_BONUS`: `SELECT TEM_NUMBER, SUM(TARGET) TGT, MAX(TARGET_BONUS) TBONUS ... WHERE KY='<ky>' ... GROUP BY TEM_NUMBER`; nếu kỳ yêu cầu không có target thì chọn kỳ gần nhất `<= requested`. ORDS hiện không có `05.2026/06.2026`, kỳ mới nhất là `04.2026` (21 NV, tổng target **30.062.862.426đ**). Đã dump hiệu lực 04/05/06 theo fallback cũ vào `artifacts/targets_effective_202604_202606.json` và chạy `node server/scripts/import_targets.js`; `server/data/targets_real.json` local hiện có 63 bản ghi (21/kỳ cho 04–06).
- **Nguồn CST app cũ đã xác định cho dev viết importer.** Tab CST không dùng file cache chính; query ORDS trực tiếp: nguồn CST gốc từ `V_TEMP_PHARMA` với `FROM_DATE=(SELECT MAX(FROM_DATE) FROM V_TEMP_PHARMA WHERE FROM_DATE <= TRUNC(SYSDATE,'MM'))`, `TUYEN='CL'`, `GIVEN_QUANTITY>0`; lượng đã bán từ `SALES_REPORT` từ `DATE '2025-03-01'` group theo `(IIT_CODE, DONVI đã chuẩn hoá)`. Frontend tính `SL_CON = GIVEN_QUANTITY - SUM(QUANTITY)`, `% còn`, `TT_THẦU`, `TT_ĐÃ BÁN`, `TT_CÒN LẠI`; map NV CST bằng `NV`/`TEM_ID` qua `CST_NV_TO_EMP`. Đã dump mẫu 8 bản ghi tại `artifacts/cst_sample_from_old.json` cho dev đối chiếu importer.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Xác nhận OTP CEO sau bản `cbea728` và mở public `reportnew.donapharm.asia`.** Đã pull `cbea728` (map `full -> admin`), build, restart PM2 `reportnew` với `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`. Verify OTP thật số CEO trả `{ emp_code:"CEO", role:"admin" }`; `/api/me` trả `isAdmin:true`; `/api/overview?ky=06.2026` trả doanh thu toàn công ty **28.403.136.096đ**, `2001` dòng, `22` NV. Re-test scope sale bằng DN009: chỉ thấy **3.058.543.979đ**, `130` dòng, `empCount=1`. Sau khi đạt, đã đổi tunnel ingress `reportnew.donapharm.asia` từ `http_status:403` về `http://localhost:3873`, restart `cloudflared-reportnew`; public root/API trả 200, `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, browser thấy màn đăng nhập SĐT/OTP không có nút demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Pull lên commit `170e3be` và nạp danh bạ nhân viên thật cho OTP.** Nguồn danh bạ lấy từ `REPORT_USERS` của app cũ `webapp_donapharm/public/kho-dulieu.html`, xuất tạm sang JSON rồi chạy `node server/scripts/import_employees.js`; kết quả: **35 NV**, phân bố vai trò `admin: 1`, `sale: 34`, **thiếu SĐT: 0**, mẫu kiểm tra 2 NV OK. File tạm đã xoá; không commit PII/secrets.
- **Xác định chính xác API OTP nội bộ đang chạy ở port 3848.** App cũ `webapp_donapharm/server.js` chỉ proxy `POST /api/otp/request` và `POST /api/otp/verify` sang `127.0.0.1:3848`; backend thật là `erp-support-widget/server/index.js`. Gửi OTP: `POST http://localhost:3848/api/otp/request`, body tối thiểu `{ "phone": "<sdt>" }`, có thể thêm `{ "page": "Report", "deviceId": "<id>" }`; response thành công `{ ok:true, message:"..." }`. Xác thực: `POST http://localhost:3848/api/otp/verify`, body `{ "phone":"<sdt>", "code":"<otp>" }`; response đúng trả `{ ok:true, token, phone:<masked>, name, code, role, accounts, requireAccountChoice, expiresIn:86400 }`.
- **Bật OTP thật + tắt demo-login cho PM2 `reportnew` nhưng vẫn khóa public 403.** `.env` local đặt `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`; do backend chưa tự đọc dotenv, đã restart PM2 với env tương ứng và `pm2 save`. Kiểm tra local: `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, `/api/auth/otp/request` qua app mới trả `{ok:true}` với số CEO. Public `https://reportnew.donapharm.asia/` và `/api/health` vẫn **403**. **Còn chờ mã OTP nhận được để test `/api/auth/otp/verify` và kiểm quyền dữ liệu sau đăng nhập.**

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Kiểm thử Cloudflare Access cho `reportnew.donapharm.asia` chưa đạt, đã khóa lại public 403.** Sau khi CEO báo đã tạo Access app/policy email công ty, đã đổi tunnel ingress từ `http_status:403` về `http://localhost:3873` và restart PM2 `cloudflared-reportnew`; tuy nhiên kiểm bằng `curl` và browser vẫn vào thẳng App Report (`HTTP 200`, thấy màn login app), không xuất hiện màn Cloudflare Access. Để tránh lộ dữ liệu thật, đã rollback ingress về `http_status:403`; public root và `/api/health` hiện đều `403`, local `http://localhost:3873/api/health` vẫn OK.
- **Cần kiểm lại Cloudflare Zero Trust config trước khi mở lại:** Access application phải active đúng hostname `reportnew.donapharm.asia` (Self-hosted), policy allow email domain công ty, và không bị đặt sai team/account/path. Chỉ mở lại tunnel về `localhost:3873` sau khi public request bị redirect/chặn bởi Cloudflare Access.

### 2026-07-01 — Dev (Claude Code)
- **Target lọc NV theo ĐÚNG KỲ đang xem (sửa tiếp theo phản hồi bot).** `empCodesWithData` nhận `ky`: Target kỳ 06 chỉ hiện NV có bán KỲ 06 (DN014 bán 04 nhưng không bán 06 → không còn hiện ô 0 ở kỳ 06). Forecast dùng NV hoạt động ở kỳ gần nhất. _Test: NV kỳ 06 chỉ DN003, NV kỳ 04 có DN014._
- **Sửa Target lấy đúng danh sách NV + không dùng target mẫu khi có dữ liệu thật.** Trước đây Target/Dự báo liệt kê cả danh bạ công ty (nhiều NV target 0 không thuộc App Report). Nay: `store.empCodesWithData()` lấy NV **thực sự có doanh thu**; `/targets` và `forecastTargets` dùng danh sách này. `getTargets` khi có slot thật → chỉ dùng target thật (`targets_real.json`), chưa import thì target cũ = 0 (trung thực), không lấy target mẫu. Thêm `scripts/import_targets.js` để nạp target thật khi có. _Test: NV lấy từ dữ liệu, getTargets real-mode rỗng._
- **Sửa map vai trò: OTP backend trả `full` cho CEO/toàn quyền → nay map thành `admin`.** Trước đó `full` rơi về `sale` khiến CEO bị lọc như NV thường (doanh thu = 0). `normRole` thêm `full|admin|quan tri|manager|all → admin`. _Test: full→admin, sale→sale, Giám đốc→ceo. ⚠ Bot pull + restart rồi verify lại số CEO._
- **🔒 Khớp adapter OTP với backend thật + SỬA lỗ hổng.** Backend `/api/otp/verify` trả `{ok, code, name, role, accounts, requireAccountChoice}`. `verifyOtp` giờ **BẮT BUỘC kiểm `data.ok`** (trước chỉ kiểm HTTP → mã sai vẫn lọt!), dùng identity backend trả về (code/role/name), chuẩn hoá vai trò → ceo/admin/sale. Thêm bước **chọn tài khoản** khi 1 SĐT nhiều mã NV: route `/auth/otp/select` + verifiedPhones (TTL 5') + UI chọn ở Login. _⚠ Bot phải PULL bản này trước khi verify mã thật._
- **Công cụ nạp danh bạ nhân viên thật + chuẩn hoá SĐT.** Thêm `server/scripts/import_employees.js` (map linh hoạt mã NV/tên/SĐT/email/vai trò, chuẩn hoá SĐT +84/84→0, tự suy vai trò, backup users cũ). `auth.verifyOtp` tra cứu theo SĐT đã chuẩn hoá. _Test: "+84 917 396 668"→"0917396668", "Giám đốc"→ceo. Cần bot chạy trên file danh bạ thật._
- **UI đăng nhập OTP bằng SĐT (frontend).** `Login.jsx` đọc `/auth/mode`: nếu `live` → luồng SĐT → gửi OTP → nhập mã → vào (mỗi NV thấy phạm vi của mình); nếu `demo` → nút chọn tài khoản mẫu. api.js thêm `mode/otpRequest/otpVerify`. _Test: chế độ demo hiển thị đúng. Luồng OTP thật cần bot nối OTP backend + nạp danh bạ NV thật (đang chờ spec)._
- **Importer nạp CẢ THƯ MỤC (1 lệnh cho mọi kỳ).** `import_legacy.js` giờ nhận file HOẶC thư mục: quét mọi `report_upload_data_*<ngày>.json` (bỏ qua lastUpload/slots), nạp hết, in **bảng tổng từng kỳ** + cảnh báo kỳ trùng file. _Dùng để lấy đủ dữ liệu từ 01/2026: `node server/scripts/import_legacy.js <thư-mục-data-app-cũ>`. Test batch 01+02 OK._
- **⚠ Cảnh báo bảo mật + công tắc tắt demo-login.** Dữ liệu đã THẬT nhưng site chưa bật Cloudflare Access và đăng nhập còn là nút demo → nguy cơ lộ. Thêm env `ALLOW_DEMO_LOGIN` (mặc định 1): đặt `=0` để KHOÁ demo-login (`mockLogin` trả null, `/auth/demo-users` rỗng, `/auth/mode` trả `demo:false`). _Khuyến nghị: bot bật Cloudflare Access NGAY; khi có OTP thì đặt ALLOW_DEMO_LOGIN=0._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Khóa tạm public access cho `reportnew.donapharm.asia` để bảo vệ dữ liệu thật.** Khi yêu cầu bật Cloudflare Access, dashboard Zero Trust bị Cloudflare security verification trong browser headless nên chưa thao tác UI được ngay. Để chặn truy cập công khai lập tức, đã backup `~/.cloudflared/reportnew.yml` và đổi ingress `reportnew.donapharm.asia` sang `http_status:403`, restart PM2 `cloudflared-reportnew`. Kiểm tra public root và `/api/health` đều trả `HTTP/2 403`; local `http://localhost:3873/api/health` vẫn OK, PM2 `reportnew` vẫn online.
- **Còn cần bật Cloudflare Access đúng chuẩn trong Zero Trust.** Sau khi tạo Access application/policy cho domain `reportnew.donapharm.asia` (allow email domain công ty), đổi lại tunnel service về `http://localhost:3873` và restart `cloudflared-reportnew`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật importer và import lại dữ liệu thật 04/05/06 cho `reportnew`.** Đã `git pull` lên commit `f49f91d`, `npm run build`, import đúng các file chuẩn theo `report_uploadSlots.json` app cũ: `report_upload_data_20260401_20260430.json`, `report_upload_data_20260501_20260529.json`, `report_upload_data_20260601_20260630.json`. Sau import đã restart PM2 `reportnew`; health local và HTTPS đều OK. App cũ `dona-report` cổng `3860` chỉ đọc file, không sửa/xoá.
- **Kết quả import active:** 04.2026 — 2.282 dòng, 21 NV, tổng doanh thu `34.794.142.431đ`, slot `legacy_042026_mr26j8be`; 05.2026 — 1.600 dòng, 21 NV, tổng `30.398.950.820đ`, slot `legacy_052026_mr26j8h9`; 06.2026 — 2.001 dòng, 22 NV, tổng `28.403.136.096đ`, slot `legacy_062026_mr26j8nb`.
- **Kiểm mẫu dữ liệu sau import:** cả 3 kỳ đã có đủ `unit_name`, `product_name`, `contractor_code`, `bid_package`. Ví dụ 04: `001.BVĐK Đồng Nai` / `Vixcar` / `02.AFP PHARMA` / `QĐ139`; 05: `171.PKĐK NAM VIỆT` / `Cerecaps` / `Công Ty Tnhh Dược Phẩm Donapharm` / `QĐ141`; 06: `019.TTYT H. Vĩnh Cửu` / `Nadecin 10mg` / `Công Ty Tnhh Dược Phẩm Và Trang Thiết Bị Y Tế Đại Trường Sơn` / `QĐ139`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật server `reportnew` lên bản mới nhất.** Đã `git pull` tới commit `4935eb1` (`Migrate dữ liệu app cũ: import_legacy.js + sửa đọc số kiểu VN`), chạy `npm run build`, restart PM2 `reportnew` trên cổng `3873`; health local và HTTPS đều trả `{"ok":true,"service":"app-report-new",...}`. Không đụng app cũ `dona-report` cổng `3860`.
- **Import thử dữ liệu thật kỳ 06.2026 từ app cũ.** Nguồn đọc-only: `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_20260601_20260630.json`; kết quả import: 2.001 dòng hợp lệ / 2.001, 22 NV, tổng doanh thu `28.403.136.096đ`, slot active `legacy_062026_mr266eqe`. Đã restart `reportnew` sau import thử.
- **Dừng chưa import tiếp 04/05 do thiếu map alias tên cột.** Mẫu sau import chỉ có `unit_code`, `emp_code`, `iit_code`, `quantity`, `revenue`; thiếu `unit_name`, `product_name`, `contractor_code` vì file cũ dùng các cột `DONVI`, `ITEM_NAME`/`IIT_NAME`/`NAME`, `NHA_THAU`/`VEN_NAME`. Cần dev bổ sung alias trong `server/scripts/import_legacy.js` trước khi import các kỳ còn lại để báo cáo không mất tên đơn vị/tên thuốc/nhà thầu.

### 2026-07-01 — Dev (Claude Code)
- **Importer tự suy kỳ chắc hơn.** Suy `ky/dateFrom/dateTo` theo thứ tự: tham số > tên file (nhận CẢ `YYYY-MM-DD` lẫn `YYYYMMDD`) > nội dung dòng (`KY/FROM_DATE`). _Bot chỉ cần `node import_legacy.js <file>` cho mọi kỳ. Test: tên file nén → suy đúng 06.2026._
- **Bổ sung map cột ERP app cũ (theo mẫu bot gửi).** import_legacy + upload nhận thêm: `ITEM_NAME/IIT_NAME/NAME`→tên SP, `NHA_THAU/VEN_NAME`→nhà thầu, `TUYEN`→tuyến; fallback `unit_name=unit_code` (DONVI gộp mã+tên), và **tự trích gói thầu `QĐ139/QĐ141` từ mã IIT**. _Test: dòng mẫu ERP → đủ route/đơn vị/tên SP/nhà thầu/gói thầu. Doanh thu T06 đã khớp 28.403.136.096đ._
- **Công cụ migrate dữ liệu app cũ.** Thêm `server/scripts/import_legacy.js`: chuyển file `report_upload_data_*.json` của app cũ → slot của app mới (map linh hoạt tên cột, tự suy kỳ từ tên file, đánh dấu active, ghi audit, in tóm tắt để kiểm tra). _Chạy trên server nơi có file thật._
- **Sửa lỗi đọc số kiểu VN.** "22.500.000" (chấm ngăn nghìn) trước bị đọc thành 0 → thêm `toNum()` xử lý đúng cho cả `import_legacy.js` và `upload.js`. _Test: tổng 67.5tr đúng._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Deploy demo `reportnew.donapharm.asia` thành công theo phương án không ảnh hưởng app cũ.** Vì các cổng `3860`/`3861`/`3863` đang được app hiện hữu sử dụng, App Report New chạy PM2 `reportnew` trên cổng trống `3873` với `USE_SAMPLE_DATA=1`; `curl http://localhost:3873/api/health` trả `{"ok":true,"service":"app-report-new",...}`. App cũ `dona-report` trên `3860` giữ nguyên.
- **Cloudflare Tunnel riêng cho Report New.** Đã login Cloudflare, tạo tunnel `reportnew` (`746c53e5-4098-43bd-848f-9b74e8a41f63`), route DNS `reportnew.donapharm.asia`, tạo config `~/.cloudflared/reportnew.yml` trỏ `http://localhost:3873`, chạy bằng PM2 `cloudflared-reportnew` để không restart tunnel chung. HTTPS `https://reportnew.donapharm.asia` trả `HTTP/2 200`.
- **Kiểm thử giao diện.** Mở `https://reportnew.donapharm.asia` thấy màn đăng nhập/logo DNPHARMA; bấm demo CEO đăng nhập được dashboard Tổng quan với dữ liệu mẫu. Lưu ý: chưa bật Cloudflare Access, OTP/SSO/ORDS/AI vẫn để trống theo yêu cầu demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Chuẩn bị deploy demo `reportnew.donapharm.asia` trên server.** Đã clone repo nhánh `main`, đọc đủ chỉ thị (`CHANGELOG.md`, `CLAUDE.md`, `HANDOFF.md`, `DEPLOY_CLOUDFLARE.md`, `DIRECTIVE_FOR_SERVER_BOT.md`, `.env.example`), chạy `npm run setup` và `npm run build` thành công. Đã tạo `.env` local an toàn: `PORT=3860`, `USE_SAMPLE_DATA=1`, `SESSION_SECRET` ngẫu nhiên, OTP/SSO/ORDS/AI để trống; không commit secret.
- **Blocker hạ tầng:** cổng `3860` hiện đang được PM2 process `dona-report` sử dụng (`/home/osboxes/.openclaw/workspace-main/webapp_donapharm/server.js`). Thử start PM2 `reportnew` bị lỗi `EADDRINUSE`; đã xoá process lỗi để tránh vòng restart. Vì không được ảnh hưởng webapp cũ đang chạy, chưa dừng/đổi `dona-report` và chưa trỏ Cloudflare Tunnel.
- **Cloudflare hiện trạng:** `cloudflared` đã cài (`2026.5.2`) nhưng chưa có origin cert/login trên user hiện tại; chưa có `cloudflared.service`; DNS `reportnew.donapharm.asia` chưa resolve. Cần CEO quyết phương án cổng/dịch vụ trước khi tiếp tục.

### 2026-07-01
- **Sửa layout PC lấp đầy màn rộng.** `.page-desktop` chuyển sang lưới `auto-fill minmax(440px)` + max-width 1900px → màn ~1920px hiện 3 cột cảnh báo, hết khoảng trắng thừa bên phải. _Test: preview ở 1920px._
- **Thêm `DIRECTIVE_FOR_SERVER_BOT.md`.** Chỉ thị cho bot server: vai trò/ranh giới (hạ tầng, không sửa code app), thứ tự đọc repo, nhiệm vụ deploy `reportnew.donapharm.asia`, nguyên tắc phối hợp với dev + ghi log. _Lý do: để bot server tiếp quản repo và phối hợp đúng vai với dev._
- **Lập CHANGELOG.md + quy trình ghi log.** Tạo file này làm nhật ký thay đổi/tiến trình chuẩn cho repo; đặt quy tắc dev ghi log mỗi thay đổi. _Lý do: để bot/người đọc repo nắm ngay tình hình._
- **Nối dữ liệu thật (một phần) + adapter hạ tầng.** `store.js` đọc slot upload `active` làm nguồn doanh thu (ưu tiên upload→ORDS→mẫu); upload 1 kỳ là báo cáo hiện ngay. Thêm `ords.js` (ORDS SQL API) và OTP/SSO trong `auth.js` + routes — đều **TẮT mặc định**, bật bằng env trên server. _Test: upload file → kỳ 07.2026 xuất hiện, doanh thu khớp file. ORDS/OTP/SSO chưa test live (cần mạng nội bộ)._
- **Hướng dẫn deploy `reportnew.donapharm.asia`.** Viết `DEPLOY_CLOUDFLARE.md` theo mô hình 1 server Node :3860 + Cloudflare Tunnel; cập nhật `_redirects`.
- **Gắn logo + QR Zalo OA THẬT của DNPHARMA.** Thêm `web/public/logo-dnpharma.png`, `logo-mark.png`, `zalo-oa-qr.png`; component logo dùng ảnh thật (fallback SVG). Thu nhỏ kích thước hiển thị cho cân đối (logo 96px, QR 76px ở màn login).
- **Nhận diện DNPHARMA (xanh–cam).** Đổi bộ màu thương hiệu; sửa tài liệu bàn giao `bot tender`→`bot report`; thêm `DIRECTIVE_FOR_BOT_REPORT.md`.
- **Dựng App Report New v2.0.** Kiến trúc React (Vite) + Express API tách riêng, **1 codebase responsive** (mobile bottom-nav / PC sidebar). 6 lõi báo cáo + Upload + AI + phân quyền backend + dữ liệu mẫu ẩn danh (`seed.js`). Kèm `README.md`, `CLAUDE.md`, `HANDOFF.md`. _Đã verify bằng preview trên cả mobile lẫn PC._

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn thiện tài liệu audit app cũ → app mới trong `MIGRATION_MATRIX.md`.** Đã rà các nguồn app cũ `report.html`, `report-main-v23.js`, `report-extra.js`, `kho-dulieu.html`, các bản `report-cst/report-force/report-new` và `chart.min.js`; cập nhật ma trận đầy đủ theo tab/nút/tính năng với trạng thái `done/partial/todo`.
- **Ghi rõ backlog chưa chuyển:** biểu đồ, tab Nhân viên, màn Đối chiếu, PDF/print, hoạt chất/nhóm thuốc ở Products, Kho dữ liệu master/rollback parity, Target admin editor, Target NV/thưởng 3P, Điều chuyển NV, export mẫu cũ và upload file lỗi.
- **Thêm kế hoạch biểu đồ — chưa code:** khuyến nghị Recharts thay vì Chart.js cho React/Vite; đề xuất 4 biểu đồ doanh thu theo kỳ, top ĐV/SP, donut cơ cấu tuyến/nhà thầu/gói thầu, target progress ring; nêu API/scope/period requirements, bundle-size impact và vị trí đặt ở Tổng quan/Phân tích/Target để CEO/Claude duyệt trước khi triển khai.
