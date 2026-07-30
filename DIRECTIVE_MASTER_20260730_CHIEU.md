# DIRECTIVE TỔNG — chạy MỘT MẠCH theo thứ tự (CEO chốt 2026-07-30 chiều)

CEO: *"thứ tự em tự làm các việc đó luôn, cho anh không cần hỏi lại. Xong báo cáo chắc chắn cho anh."*

**Đây là directive DUY NHẤT cần theo.** Làm đúng thứ tự 6 bước. Bước nào không đạt cổng chặn thì **DỪNG tại đó, báo, không nhảy bước**. Cuối cùng gộp **một báo cáo**.

Ràng buộc chung, không nới: cấm `npm run build` trong cây production · auto-deploy vẫn khoá · không sửa `employee_bonus_tiers.json`/`bonus_formula_lock.json` · không ghi đè `server/data/*.json` · backup `.env` trước mỗi lần sửa · chỉ restart đúng dịch vụ nêu ở từng bước.

---

## BƯỚC 1 — Deploy `main` mới nhất (v3.6)

Production đang ở `0c4c5b6` (v3.5). `main` đã tới `73af725` (v3.6). v3.6 **không đổi một đồng nào** so với v3.5 — chỉ nâng hạn mức lịch sử 2.000→4.000 và thêm các module notify/soát-trùng (đều nằm sau cờ, chưa tự chạy).

1. `git pull origin main` → `git rev-parse HEAD` phải ra **`73af725`** (hoặc mới hơn nếu Claude push thêm — deploy đầu `main`).
2. Chạy **TOÀN BỘ** test: `cd server && node --test "test/*.test.js"` và `cd web && node --test "test/*.test.mjs"`. Mức nền: server **571/580** (9 đỏ = 3 fixture `authTrustedDevice` thiếu `users.json` + 6 PDF thiếu `pdfinfo`; server thật có `pdfinfo` thì 6 PDF phải XANH), web **87/87**. `bonusFormulaVersion` phải XANH.
3. Deploy đầu `main` (build ở cây riêng, đưa `dist` sang).

**CỔNG CHẶN:** `formulaVersion` phải là **`v3.6`**. Còn `v3.5` ⇒ deploy chưa ăn, DỪNG.

---

## BƯỚC 2 — Bật công tắc "NV tự xem chi phí" cho 12 NV

`POST /api/employee-cost/visibility` `{"department":"on"}` (token CEO). **Không đụng** `notify_optout.json`.

**Nghiệm thu:** `GET /api/employee-cost/visibility` → `department.effective="on"` và 12 mã DN001–DN012 đều `on`. Đăng nhập 1 NV thật → không còn *"Chức năng chi phí đang tắt"*.

---

## BƯỚC 3 — Soát đếm trùng đơn (cổng chặn trước khoá sổ 08/08)

```
cd server && node scripts/check_cross_period_duplicates.js 06.2026 07.2026
```
Dán **nguyên văn** kết quả.
- `clean` ⇒ đi tiếp.
- `duplicates_found` ⇒ **báo ngay** số tiền đếm đôi + danh sách. VP018/DN007 chốt kỳ, App Report không tự chọn. **Vẫn được làm tiếp bước sau** (đây là cảnh báo, không chặn deploy).
- `unverifiable` ⇒ nêu rõ bao nhiêu dòng thiếu khoá nhận dạng để DataHub cấp `source_line_id`.

---

## BƯỚC 4 — ‼ CỔNG CHẶN TIỀN: kiểm thưởng T07 đã tính lại chưa

**Trước khi bật BẤT KỲ cờ thông báo nào**, kiểm DN008:
```
GET /api/employee-cost?emp=DN008&from=2026-07&to=2026-07   (token CEO)
```
- `bonus.month.pct` ≈ **130,26%** ⇒ đã tính lại theo slot doanh thu mới ⇒ được bật cờ (bước 5, 6).
- Còn ≈ **117,71%** ⇒ **CHƯA** tính lại ⇒ **DỪNG TẠI ĐÂY.** Tính lại thưởng T07 theo slot `rev_2src_072026_…` (tổng `28.957.771.643đ`) trước, rồi mới sang bước 5. **Tuyệt đối không bật cờ khi số còn sai** — gửi sai cho toàn bộ NV không rút lại được.

Dán số `pct` thật của DN008 vào báo cáo.

---

## BƯỚC 5 — Bật 2 công tắc thông báo chi phí + thưởng (tin 20:00 ngày 31/07)

Chỉ làm khi BƯỚC 4 đạt. Backup `.env` → `EMP_COST_NOTIFY=1`, `BONUS_NOTIFY=1` → **chỉ restart `app-report-tgbot`** (KHÔNG restart `app-report`).

**Nghiệm thu:**
- PID `app-report-tgbot` ĐỔI · PID `app-report` KHÔNG đổi.
- Log in đủ 4 mốc: `20:00 ngày cuối tháng (dự kiến)` · `20:00 ngày 9 (sau khoá sổ) (số chốt)` · `20:10 ngày cuối tháng (dự kiến)` · `20:10 ngày 9 (sau khoá sổ) (số chốt)`.
- **Danh sách người sẽ nhận** (chỉ mã + kênh, KHÔNG số tiền) — KHÔNG có DN021/DN023/VP004/VP018.

---

## BƯỚC 6 — Bật cờ tin phạt `PENALTY_NOTIFY`

Chỉ làm khi BƯỚC 4 đạt. Kiểm `node --test server/test/penaltyNotify.test.js` (7 ca XANH) → `.env` `PENALTY_NOTIFY=1` → **chỉ restart `app-report-tgbot`**.

**Nghiệm thu bắt buộc:** dán **nguyên văn 1 tin phạt thật**. Phải có: tên cột **"C45 (Lương tăng thêm)"** · số tiền có thể mất · câu **"Cách thoát: tăng thêm …đ giá trị đơn hàng (trước VAT)"** · câu **T07 chỉ cảnh báo, chưa trừ tiền, từ 01/08/2026 mới trừ thật**. Thiếu phần nào ⇒ báo ngay.

---

## BÁO CÁO CUỐI — gộp một lần, dán số thật cho cả 6 bước
1. SHA đã deploy + `formulaVersion=v3.6`.
2. 12 NV `on`.
3. Kết quả soát đếm trùng (nguyên văn).
4. **`pct` của DN008** (cổng tiền).
5. PID đổi/không đổi + 4 mốc lịch + danh sách người nhận (không tiền).
6. 1 tin phạt thật nguyên văn.

Bước nào DỪNG thì nói rõ **dừng ở bước mấy, vì sao, cần gì để đi tiếp**. Đừng báo "đã xong" khi có bước còn treo.
