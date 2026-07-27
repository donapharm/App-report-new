# SPEC — Tự lành nguồn chi phí NV (self-heal), không kẹt 6h (DN001 incident 2026-07-26)

> Người làm: **bot Report** (code warm-path server). Claude: kiến trúc/review — KHÔNG tự sửa app code.
> **Không đụng `web/src/pages/EmployeeCost.jsx`** (Claude đang giữ cho đợt release UX). Chỉ đụng server.
> Phạm vi: App Report. **Không đụng DataHub.** Giữ mọi bất biến fail-closed.

## 0. Vấn đề (đã truy tận cache)
- `warmEmployeeCostAllCache` (`server/src/routes.js`) chạy mỗi `EMPLOYEE_COST_ALL_WARM_INTERVAL_MS` (mặc định **10 phút**).
- Nhưng nó lấy dữ liệu qua `memoGet(base, EMPLOYEE_COST_ALL_BASE_TTL_MS = 6h)`. Trong 6h, `memoGet` **trả bản cache cũ, KHÔNG rebuild** (đã kiểm: `memoGet` chỉ build lại khi hết TTL/mất key).
- Hệ quả khi 1 NV (vd DN001) fail nguồn thoáng qua lúc cold-warm:
  1. Bản merged "DN001 chưa lấy được / tạm tính" bị **ghim cứng 6h**.
  2. Warm kế tiếp **không hề re-fetch DN001** → UI kẹt "tạm tính" tới 6h.
  3. `employeeCostSourceAlert.checkAndNotify` chỉ phát **recovery** khi thấy `unavailableEmployees` rỗng — mà nó luôn đọc payload cache cũ → **Telegram "đã hoàn thành lỗi" trễ tới 6h**.
- Nguồn đã hồi (DN001 = HTTP 200) mà hệ thống vẫn báo đỏ = đúng cái CEO ghét. Cần **tự lành trong 1 nhịp warm (phút), không phải 6h**.

## 1. Mục tiêu
Mỗi nhịp warm: nếu lần trước có NV fail nguồn, **re-probe RIÊNG mấy NV đó bằng nguồn tươi (bỏ qua cache ALL)**; NV nào hồi thì **vô hiệu cache ALL của kỳ đó** để rebuild sạch ngay, và recovery Telegram bắn kịp. NV còn fail thì **giữ tạm tính (fail-closed)**, remind theo nhịp cũ.

## 2. Thiết kế (bám đúng code hiện có)
Trong `warmEmployeeCostAllCache(ky, reason)`:
1. Build/lấy merged như hiện tại → rút tập **U = `match.unavailableEmployees`** (đã có sẵn từ `mergeEmployeeReports`; gộp qua các period).
2. **Nếu U rỗng:** giữ nguyên luồng cũ (0 chi phí thêm — happy-path không phát sinh probe).
3. **Nếu U không rỗng — re-probe tươi từng NV trong U** bằng `employeeCost.fetchEmployeeCost(emp, { timeoutMs: WARM_TIMEOUT_MS, backoffMs: WARM_BACKOFF })`:
   - Đây là fetch **đơn-NV, đi thẳng nguồn**, KHÔNG qua `memoGet` ALL → thấy trạng thái thật.
   - Gom `R = { emp ∈ U : outcome === 'ok' }` (chỉ coi là hồi khi nguồn trả **ok + đúng scope**; `scope_mismatch`/`upstream_*`/timeout ⇒ **vẫn fail**, KHÔNG suy diễn).
4. **Nếu R không rỗng (có NV hồi):**
   - Gọi helper mới **`invalidateEmployeeCostAll(ky)`** — xoá mọi memo key `employee-cost-all:base:*` và `:view:*` thuộc kỳ `ky` (range tháng tương ứng).
   - **Rebuild merged tươi** (force, qua `buildMerged`/`employeeCostAllPayload` sau khi đã xoá key) → U mới phản ánh đúng hiện tại.
5. `checkAndNotify(payloadMớiNhất, ky)` **một lần, cuối cùng** với payload sau bước 4 → recovery bắn đúng lúc nguồn về; còn fail thì remind theo `REMIND_MS` cũ.

### Helper `invalidateEmployeeCostAll(ky)`
- Chỉ xoá đúng các key ALL của kỳ đó trong `memo` (set nhỏ). **Không** đụng TTL toàn cục, **không** hạ 6h cho mọi người (tránh nện nguồn). Chỉ re-probe MẤY NV fail + xoá key khi thật sự hồi.

## 3. Tuỳ chọn giảm báo động giả (khuyến nghị kèm)
- `WARM_TIMEOUT_MS = APP_REPORT_COST_WARM_TIMEOUT_MS` (mặc định ~15000ms) và `WARM_BACKOFF` (vd `[2000,4000,8000]`) **CHỈ dùng ở đường warm/re-probe**, không đổi timeout request tương tác (user không phải chờ lâu). Payload DN001 lớn lúc cold-start sẽ không bị tuyên "unavailable" oan.

## 4. Bất biến BẮT BUỘC (không phá)
1. **Fail-closed:** re-probe chỉ lật fail→ok khi nguồn trả **ok + đúng scope**. Mọi lỗi/timeout ⇒ giữ tạm tính. **Cấm** auto-fill/suy số cho NV còn fail.
2. **Không nuốt lỗi warm:** re-probe/ invalidate bọc try/catch — lỗi thì log + giữ trạng thái cũ, KHÔNG làm chết vòng warm.
3. **Không đẻ số mới, không lộ cost total/%/PII:** re-probe dùng đúng `fetchEmployeeCost` đã sanitize; alert giữ nguyên `buildMessage` (chỉ mã NV + số cặp, không tiền).
4. **Chi phí thấp:** happy-path (U rỗng) = 0 probe thêm. Chỉ probe đúng số NV đã fail, không probe lại toàn đội mỗi nhịp.
5. **Không đụng DataHub, không đụng UI file** Claude đang giữ.

## 5. Nghiệm thu (hữu hạn — đủ là Claude GO)
Bám harness sẵn có `server/test/employeeCostWarmLoop.test.js` + `employeeCostSourceAlert.test.js`:
- **T1** DN001 fail lúc warm → `unavailableEmployees=[DN001]`, alert **đỏ** gửi, base cache = tạm tính.
- **T2** nhịp warm kế, nguồn DN001 = ok → re-probe thấy hồi → `invalidateEmployeeCostAll` → rebuild → `unavailableEmployees` rỗng → **recovery Telegram gửi**; **tự lành trong ≤ 1 interval**, KHÔNG chờ 6h. (assert thời điểm hồi < TTL 6h.)
- **T3** DN001 vẫn fail ở nhịp kế → **không** recovery giả; remind theo `REMIND_MS`; tạm tính giữ nguyên (fail-closed).
- **T4** re-probe timeout/exception → warm không chết; trạng thái không đổi; vẫn tạm tính.
- **T5** không NV nào fail → **0 probe thêm, 0 invalidate** (happy-path sạch).
- **T6** cost total/%/PII **không** xuất hiện ở đường re-probe lẫn nội dung alert.

## 6. Trình tự
1. Bot làm trên server code (routes.js + helper + có thể chạm alert module để lấy đúng payload mới), kèm **log/diff 6 ca nghiệm thu**.
2. Claude review độc lập → đủ bằng chứng mới GO.
3. Đợt này **độc lập với** release UX (`ea6e43a`) và với track deploy-safety; không gộp.
