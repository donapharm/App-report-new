# SỔ NỢ APP REPORT — rà soát 06/08/2026 (Claude quét toàn repo, không nhớ theo trí nhớ)

> CEO yêu cầu: *"rà soát còn những việc gì còn đang nợ chưa làm xong / đang làm dở mà bị quên lãng… cho làm luôn cho hoàn thành app report này chứ kéo dài quá rồi."*
>
> Cách quét: `TODO(LIVE)` · người gọi của từng module · route ↔ nơi ghi dữ liệu · các `SPEC_*` chưa hiện thực · mục "chưa làm" trong `CHANGELOG.md`. **Mỗi mục dưới đây đều đã kiểm bằng lệnh, không suy đoán.**

---

## 🔴 NHÓM 1 — ĐÃ LÀM GẦN XONG NHƯNG **CHƯA NỐI DÂY** (lãng phí nhất, rẻ nhất để đóng)

### 1.1 Màn "Chưa đồng bộ" — có màn, có API, **không ai ghi dữ liệu vào**
- **Đã có:** `syncExceptionClassifier.js` (luật 14 mã lý do) · `syncExceptionCatalog.js` · `syncExceptionStore.js` · `syncExceptionReport.js` · route `GET /revenue/sync-exceptions` (`routes.js:2424`) · `api.syncExceptions()` bên web · 14 test.
- **Thiếu:** **không dòng code nào gọi `classifySyncExceptions()` rồi `syncExceptionStore.write()`** trong luồng chạy thật (đã grep toàn `server/src` + `server/scripts`: chỉ thấy trong chính file định nghĩa và trong ví dụ ở comment).
- **Hệ quả:** màn hình mở ra **luôn rỗng**. Cả `SPEC_REVENUE_SYNC_EXCEPTIONS.md` — thứ sinh ra để "không dòng nào biến mất lặng lẽ" — **chưa chạy ngày nào**.
- **Việc:** cắm vào materializer sau khi dựng xong kỳ: `classifySyncExceptions({ period, sourceRows, includedLineIds })` → `syncExceptionStore.write(...)`; `balanced === false` thì **DỪNG**, không ghi đè.
- **Ước lượng:** nhỏ — luật và test đã xong, chỉ nối.

### 1.2 Lịch chạy tự động của App Report — **không ai gọi**
- **Đã có:** `scheduledJobs.js` với `runDueJobs()`, `dueJobs()`, `markRan()`, state file, múi giờ VN.
- **Thiếu:** **không có ai gọi `runDueJobs()`** — grep `server/src` (kể cả `index.js`) và `server/scripts`: **0 nơi gọi**. Không `setInterval`, không cron.
- **Hệ quả:** mọi việc theo lịch của App Report **chưa từng chạy**, gồm `target_proposal`.
- **Lưu ý phân biệt:** lịch gửi tin chi phí/thưởng (12:30 T7, cuối tháng 20:00, ngày 9) do **`app-report-tgbot` chạy riêng** — cái đó **đang hoạt động**. Hai bộ lịch khác nhau, đừng nhầm.
- **Việc:** bot cắm `runDueJobs()` chạy mỗi ~5 phút; **chạy `dryRun` trước**.

### 1.3 Handler "AI đề xuất target tháng mới"
- **Đã có:** job `target_proposal` khai trong `scheduledJobs.js` (08:00 ngày 01, tính lại ngày 09).
- **Thiếu:** handler thực thi. Và kể cả có handler thì §1.2 chưa cắm nên vẫn không chạy.
- **Luật CEO đã chốt:** **cấm tự áp target** — chỉ đề xuất.

---

## 🟡 NHÓM 2 — CEO ĐÃ CHỐT, CÓ SPEC, CHƯA LÀM

### 2.1 Đọc được file Excel thật của kế toán — `SPEC_UPLOAD_REAL_FILE.md`
CEO trả lời **CÓ** (file dùng để nạp vào app) và chốt **NV phải tự mapping**. Năm việc trong spec:
1. Tự dò dòng tiêu đề (file thật để tiêu đề ở **dòng 5**, không phải dòng 1).
2. Bổ sung bí danh cột — hiện **chỉ 1/16 cột** khớp. **Cấm** `% CP`/`Tổng thành tiền CP` rơi vào `revenue`.
3. Tự mapping NV theo cặp (đơn vị × mã hàng), dùng lại logic `nv_catalog`; tra không ra ⇒ `UNALLOCATED` + mã lý do, **không bỏ dòng, không gán bừa**.
4. Đếm và báo số dòng không phải dữ liệu (796 ⇒ 791 dữ liệu, 5 bỏ).
5. Đối soát `Σ revenue` với ô `SUBTOTAL` — **lệch là chặn**; bỏ trần `warnings.slice(0, 50)` đang cắt mất cảnh báo.
- **Nghiệm thu có sẵn số đối chiếu:** phải ra **791 dòng · 10.564.572.484đ**.
- **Lỗi phụ đã bắt được:** `noAccent` thay `đ`→`d` **trước** `toLowerCase()` ⇒ `ĐVT` và `đvt` ra hai kết quả khác nhau.

### 2.2 Khối cảnh báo bộ lọc bị ẩn khi thu gọn (`#2` của audit 06/08)
- Khối `overview-filter-note` **vẫn nằm trong** `<div id="overview-filter-panel" hidden={!expanded}>` ⇒ thu gọn là mất câu *"Target không phân bổ theo lát cắt này…"*.
- **Việc:** đưa khối đó **ra ngoài** panel, giữ `activeCount > 0`. Thêm **1 assert** kiểm cấu trúc — phải FAIL được với code hiện tại.
- Bot đã ghi backlog. Ước lượng: rất nhỏ.

---

## 🟢 NHÓM 3 — THEO DÕI / CHỜ NGƯỜI

| # | Việc | Chờ ai |
|---|---|---|
| 3.1 | **DN012 (Đặng Thị Hồng Hạnh)** mở Telegram bấm **Start** rồi map ID. **Cấm đoán ID.** | CEO nhắc |
| 3.2 | 3 NV còn stale trong bảng tổng ALL: **DN023 · DN024 · VP004** (đọc riêng thì `ok`) | bot, khi có exec |
| 3.3 | Nghiệm thu đóng V1/V2: ô "Chưa phân bổ" về **0đ** · `misa_pending_detail.js` không còn `DH479816093` · `verify_frozen_periods.js` exit 0 | bot, khi có exec |
| 3.4 | 4 người chưa map Telegram: DN004 · DN021 · DN023 · VP004 | CEO quyết có map hay không |

---

## ⚪ NHÓM 4 — "DÂY CẮM LIVE" CÒN LẠI (`TODO(LIVE)`, có chủ đích)

Đây là các điểm **cố ý để ngỏ** từ đầu dự án, không phải quên:

| Nơi | Nội dung | Còn cần không? |
|---|---|---|
| `routes.js:633` | Login demo → thay bằng **OTP/SSO** | **CÓ** — vẫn đang là login demo |
| `store.js:613` | Fallback ORDS `V_TEM_TARGET_BONUS` khi kỳ chưa nhập target | tuỳ nhu cầu |
| `upload.js:9` | `store.getRows` đọc slot `active` để báo cáo dùng đúng dữ liệu vừa upload | **CÓ** — đi kèm §2.1 |
| `llm.js:122` | `ANTHROPIC_API_KEY` để bật AI diễn giải | tuỳ CEO |

---

## Thứ tự đề xuất (rẻ → đắt, và ưu tiên thứ đã trả tiền rồi mà chưa dùng được)

1. **§2.2** khối cảnh báo bộ lọc — vài dòng, đóng ngay.
2. **§1.1** cắm classifier vào materializer — bật sống màn "Chưa đồng bộ" đã xây xong.
3. **§1.2** cắm `runDueJobs()` vào cron — bật sống lịch của App Report.
4. **§2.1** đọc file Excel thật — việc lớn nhất trong danh sách, có spec đầy đủ và số nghiệm thu sẵn.
5. **§1.3** handler AI đề xuất target — làm sau §1.2, vì không có §1.2 thì không chạy.
6. **§4** login OTP/SSO — việc riêng, cần bàn với CEO về hạ tầng.

---

## Đã ĐÓNG trong hai ngày 05–06/08 (ghi ra để khỏi ai lôi lại)

Cổng quyền CEO theo danh tính · chuông có trần retry · lý do chọn sẵn cho Xin nhận sớm/Từ chối · cảnh báo lượt ưu tiên · 3 ô KPI hàng cuối (kèm sàn dự báo 5 ngày làm việc) · bộ lọc thu gọn · rủi ro DataHub (khoá tự nhả) · bật nhắc tin `EMP_COST_NOTIFY`/`BONUS_NOTIFY` · **V1** đơn 1.795.600đ · **V2** đơn 3.995.000đ.
