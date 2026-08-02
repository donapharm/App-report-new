# 📋 VIỆC CHO BOT — đọc file này mỗi lần pull main

> **Bot:** đây là hàng đợi việc DUY NHẤT. Mỗi đợt làm: `git pull origin main` → đọc file này → làm từ trên xuống → báo CEO từng việc xong.
> File luôn được Claude cập nhật. Việc xong thì Claude chuyển xuống mục "ĐÃ XONG".
> **CEO không phải chép tay gì nữa** — chỉ nhắn "pull main, đọc VIEC_CHO_BOT.md".

**Cập nhật lần cuối:** 02/08/2026 — sau khi bot dọn drift xong (`origin/main` = `026db87`)

---

## ✅ VIỆC 1 — XONG 02/08 (deploy `a1e17aa`)
T08 → `revenue 0, emptyPeriod:true` · T07 → `30.917.892.673đ` · cả 3 màn mặc định T08, không mượn số kỳ khác. **Không làm lại.**

<details><summary>(lưu vết — nội dung cũ)</summary>

### VIỆC 1 — Sửa lỗi "nhãn T08 nhưng số T07"

Bot đã tự phát hiện & báo trung thực: *"Phân tích: bộ chọn T08 nhưng thẻ doanh thu vẫn ghi 07.2026 do backend fallback"*.
**Đây KHÔNG phải ngoài phạm vi** — là nửa còn lại của cùng một lỗi. Claude đã sửa sẵn.

```
git fetch origin claude/fix-default-month-20260801
git cherry-pick 21867c4
```
- Chỉ sửa `server/src/routes.js` → hàm `periodCtx`.
- Bản chất: hỏi kỳ chưa có dữ liệu thì **trả rỗng của CHÍNH kỳ đó**, không âm thầm mượn số kỳ mới nhất. Thêm cờ `emptyPeriod` để màn hình nói rõ "chưa có dữ liệu".
- Dùng chung cho cả 3 màn (Tổng quan/Target/Phân tích).
- **BẮT BUỘC restart `app-report`** (có sửa backend).

**Claude đã kiểm bằng server thật:** `?ky=08.2026` → `ky=08.2026`, doanh thu **0** (trước đó trả số T07) · `?ky=06.2026` → `4.758.211.000đ` không đổi · server test **587/596** (9 lỗi nền cũ).

**Nghiệm thu — dán số thật:**
- `GET /api/overview?ky=08.2026` → `"ky":"08.2026"`, doanh thu **0**
- `GET /api/overview?ky=07.2026` → **30.917.892.673đ**
- Mở **Phân tích** chọn T08 → thẻ doanh thu ghi **08.2026 · 0đ**, KHÔNG còn ghi 07.2026

</details>

---

## 🔴 VIỆC 0B — ‼ VÊNH SỐ APP SALE ↔ APP REPORT (T08) — CHỨNG MINH TỚI TỪNG DÒNG

**CEO đối chiếu 02/08 21:44:**
- **App Report** kỳ 08.2026: **76.993.720đ** (trước VAT 73.327.352đ) · **7 dòng** · 4 ĐV · 6 SP · 2 NV · *"Dữ liệu tới 01/08/26 · 1/31 ngày"*
- **App Sale** (CRM MISA — Đối chiếu doanh thu), lọc **2026-08-01 → 2026-08-02**, snapshot 18:01 02/08:
  - TỔNG ĐẶT **183,43tr** · **ĐÃ THỰC HIỆN 23,44tr** (23.437.000đ) · CHƯA THỰC HIỆN 160tr
  - CRM tổng đặt 45,16tr · CRM đã xuất HĐ **23,44tr** · CRM chưa xuất HĐ 21,73tr
  - Đối tác tổng đặt (WEB) 138,27tr · **Đối tác ĐÃ XUẤT/GIAO 0đ (0 đơn)** · Đối tác chưa phản hồi 138,27tr

**Claude đã soi `materialize_july_revenue.js` — App Report cộng:**
1. CRM MISA: `revenue_bucket IN ('official','pending')`, amount `invoice_export_amount` → **CÓ CẢ `pending`**
2. WEB đối tác: `delivered_qty > 0`, `delivered_qty × price`, **đếm cả dòng `HOLD_GOLIVE`** (code ghi: *"HOLD_GOLIVE là cờ kỹ thuật soft-launch/quota audit"*)

**Mâu thuẫn nặng nhất:** App Sale nói đối tác giao **0 đơn / 0đ**; CRM cả 2 ngày mới đặt 45,16tr — **vẫn nhỏ hơn** 76,99tr mà App Report báo cho **1 ngày**. ⇒ nghi App Report **báo cao hơn thực giao** (ảnh hưởng target + thưởng).

### VIỆC PHẢI LÀM — dán bằng chứng, không giải thích suông
1. **Dán CẢ 7 DÒNG** trong slot T08 của App Report. Mỗi dòng: `source` (MISA/WEB) · `revenue_bucket` · `revenue_status` · mã đơn / `order_item_id` · `revenue_date` · số tiền · `emp_code` · đơn vị.
2. **Cộng nhóm:** tổng theo MISA-official / MISA-pending / WEB-delivered / WEB-HOLD_GOLIVE. Bốn số này cộng lại phải = **76.993.720đ**.
3. **Đối chiếu từng nhóm với App Sale:**
   - MISA-official có khớp **23,44tr** (CRM đã xuất HĐ) không?
   - MISA-pending có nằm trong **21,73tr** (CRM chưa xuất HĐ) không?
   - WEB-delivered: App Sale ghi **0 đơn / 0đ** — vậy App Report lấy đơn nào? Dán mã đơn + `delivered_qty` + `responded_at`.
4. **Chốt câu hỏi nghiệp vụ cho CEO quyết:** doanh thu App Report **nên** tính theo *"đã thực hiện"* (chỉ đã xuất HĐ + đã giao) hay *"đặt hàng"* (gồm pending/chưa giao)? Nêu rõ **hiện đang** theo cách nào và **lệch bao nhiêu tiền**.
5. **Kiểm kỳ:** App Report ghi *"dữ liệu tới 01/08"* trong khi App Sale lọc tới 02/08 — 02/08 có đơn không, vì sao chưa vào App Report?

**Ràng buộc:** chỉ ĐỌC App Sale. **KHÔNG tự đổi định nghĩa doanh thu** — báo số, chờ CEO chốt. Nếu phát hiện App Report đang cộng nhầm thì nêu rõ **sai bao nhiêu tiền** trước khi sửa.

---

## 🔴 VIỆC 0 — ‼ GẤP NHẤT: vì sao T08 chưa kéo doanh thu từ App Sale?

**CEO hỏi 02/08:** T08 hiện 0đ, trong khi T07 đã kéo được từ App Sale (CRM_MISA 20,26 tỷ + APP_WEB_PARTNER 10,65 tỷ = 30,92 tỷ).

**Đã biết:** `server/scripts/materialize_july_revenue.js` kéo từ **2 nguồn App Sale**, **KHÔNG khoá cứng tháng 7** — kỳ lấy theo `REVENUE_REFRESH_KY` → `MATERIALIZE_KY` → `defaultKy()` (tự ra tháng lịch VN = **08.2026**). Vậy đường nối CÓ sẵn, chỉ là chưa chạy cho T08.

**Trả lời 3 câu, dán bằng chứng:**
1. **Lịch tự chạy có bật không?** Báo cáo deploy hôm nay ghi *"Scheduler/refresh/send đều tắt"* — materialize doanh thu có nằm trong nhóm bị tắt không? Trước đây T07 được refresh bằng cách nào (cron? tay? mốc giờ nào)?
2. **Chạy thử cho T08** (chế độ an toàn, đọc App Sale read-only): `REVENUE_REFRESH_KY=08.2026 node server/scripts/materialize_july_revenue.js`. Kết quả ra sao — có đơn nào không, hay App Sale cũng đang rỗng vì 01/08 là thứ Bảy và 02/08 là Chủ nhật?
3. **Cần gì để T08 tự cập nhật hằng ngày như T07?** Nếu chỉ là bật lại lịch thì nêu rõ tên job + mốc giờ, xin CEO duyệt bật.

**Ràng buộc:** script chỉ ĐỌC App Sale, chỉ GHI slot của App Report — không đụng dữ liệu App Sale.

### ‼ CEO ĐÃ KIỂM TRỰC TIẾP APP SALE (02/08) — CẤM TRẢ LỜI "CHƯA CÓ ĐƠN"
> CEO: *"tao đã xem bên App Sale rồi, thứ 7 ngày hôm qua **đã có phát sinh đơn hàng và đã có phát sinh số tiền** rồi nhé."*

⇒ **Dữ liệu T08 CÓ THẬT bên App Sale.** App Report hiện **0đ là SAI — là MẤT SỐ**, không phải "tháng mới chưa bán".
Cùng loại sự cố với vụ mất số chi phí 01/08: **nguồn có số, App Report không lấy được.**

- Câu trả lời "App Sale cũng rỗng" **KHÔNG được chấp nhận**, trừ khi dán truy vấn thẳng App Sale cho ngày **01/08/2026** chứng minh 0 đơn (mà CEO đã thấy là CÓ).
- Phải chỉ rõ **đứt ở khâu nào**: chưa chạy materializer? lịch tắt? chạy mà lỗi? guard chặn? ghi slot hỏng?
- Chạy `REVENUE_REFRESH_KY=08.2026 node server/scripts/materialize_july_revenue.js` → **dán nguyên văn log**, kể cả log lỗi.
- Nếu đọc được đơn 01/08 mà slot không lên app ⇒ soi `revenueMaterializeGuard.js` / `revenuePayloadIdentity.js` xem có bị chặn.

**Nghiệm thu:** app kỳ **08.2026** phải ra **đúng doanh thu các ngày đã bán của tháng 8** (khớp App Sale), KHÔNG phải 0. Nếu T08 thật sự chưa có đơn thì **báo đúng là chưa có**, KHÔNG tự chế số.

---

## ✅ VIỆC 2 — XONG 02/08: drift đã dọn
`origin/main` = `026db87` đã gộp đủ commit production (`640685c`,`6e17949`,`7b3418a`,`8824e83`,`a1e17aa`) + fix tháng của Claude. Docs/spec còn nguyên. **Từ nay CHỈ deploy từ `origin/main`.**

<details><summary>(lưu vết)</summary>

> Bot hỏi *"reconcile các commit production vẫn cần phê duyệt riêng"* — **CEO duyệt rồi, đây là phê duyệt đó.** Cứ làm.

**5 commit đang chạy production nhưng CHƯA lên `origin/main`:**
`97b87d6` · `5873806` · `640685c` · `6e17949` · `8824e83` · `7b3418a` · `a1e17aa`
⇒ Máy bot hỏng là **mất trắng** phần code đang chạy thật. Git không khôi phục được.

**Làm:** gộp hết lên `origin/main`, **giữ nguyên** toàn bộ `SPEC_*.md` / `DIRECTIVE_*.md` / `REVIEW_*.md` của Claude (không được rớt).
**Cổng chặn:** báo **2 SHA trùng** — `git rev-parse origin/main` == SHA đang chạy production. Kèm: test nền XANH, `formulaVersion` không đổi.
**Từ đây trở đi: CHỈ deploy từ `origin/main`**, không deploy bản local nữa.
</details>

---

## 🟠 VIỆC 3 — VP018 + DN022: ĐÃ MERGE, còn NGHIỆM THU trên production
Đã có trên `origin/main`: `employeeIncentivePolicy.js` + `revenueAttributionGuard.js`; `formulaVersion` = **v3.7**, lock **v3.7** khớp. Test nền: **618 pass / 6 fail** (6 lỗi PDF do thiếu `pdfinfo`, không phải lỗi code).
**Còn phải làm:** deploy từ `origin/main` rồi dán nghiệm thu bên dưới. Chưa nghiệm thu xong thì **chưa được bật cờ tin thưởng 09/08**.

<details><summary>(chi tiết)</summary>

Branch `fix/dn022-separate-formula-20260731` — CEO đã duyệt từ 31/07, **Claude đã review PASS** (`REVIEW_VP018_DN022_20260801.md`). **Cổng review ĐÃ MỞ, không phải chờ Claude nữa.**

**Làm sau VIỆC 2** (cần main sạch để rebase):
1. Rebase lên `origin/main` — conflict **chỉ ở `CHANGELOG.md`** (hai bên cùng thêm mục đầu file), giải bằng cách **giữ cả hai**, không có conflict code.
2. Kiểm `formulaVersion` **v3.6 → v3.7**, khớp `bonus_formula_lock.json` (`sourceHash c86117…fb03`).
3. Full test → merge → deploy từ `origin/main`.

**Vì sao gấp:** ngày **09/08** bật 2 cờ tin thưởng. Chưa merge kịp thì **VP018** (telesaler, không phải Sale) và **DN022** (chờ công thức riêng) sẽ nhận **TIN TIỀN SAI** — gửi rồi không rút lại được.
**Nếu tới 08/08 chưa xong ⇒ KHÔNG được bật `EMP_COST_NOTIFY`/`BONUS_NOTIFY`.**

</details>

**Nghiệm thu bắt buộc trên production:** DN022 không có thưởng P1/P2 & không phạt target/C45 nhưng **vẫn có Điểm/Xu** · VP018 không được phân bổ doanh thu, **doanh thu toàn công ty KHÔNG đổi** · API trả `formulaVersion` = **v3.7** · VP018 **vẫn nhận** cảnh báo vận hành (đồng bộ, đơn >50tr).

---

## 🟡 VIỆC 4 — Chống tái diễn sự cố mất số chi phí (sau VIỆC 3)

Sự cố 01/08 đã chữa nhưng **vòng lặp chưa cắt**:
```
Mở "Tất cả NV" → RAM DataHub vọt → PM2 restart theo guard
→ nếu đang giữ vault-audit.lock → khóa mồ côi → mọi request kẹt ~10s → mất số
```
**Việc quan trọng nhất:** `vault-audit.lock` phải **TỰ LÀNH** — ghi **PID chủ + TTL**, ai vào sau thấy chủ đã chết hoặc quá TTL thì **tự phá khóa** + ghi audit. Tiến trình chết khi đang giữ khóa là điều **phải chịu được**.
Kèm: cổng RAM riêng (**không nâng guard để che**), xem lại thiết kế "Tất cả NV" (cold 22,4s là chậm), **rút ngắn cache kết quả LỖI** (6h là quá lâu — hỏng phải biết sớm).

---

## 🟢 VIỆC 5 — Module "Thanh toán CP của tôi" GĐ1 (không gấp)

Spec: `SPEC_THANH_TOAN_CP_SELFVIEW.md`. **CODE** được phép bắt đầu ngay sau VIỆC 2 (branch riêng); **DEPLOY** sau 09/08.
Nếu tới **06/08** mà VIỆC 3 chưa xong ⇒ **dừng module**, dồn sức cho việc tiền.

---

## ✅ ĐÃ XONG (không làm lại)
- **P0 mất số chi phí 01/08** — timeout 6500→15000, dọn lock mồ côi, restart. DN006 về 459.441.306đ.
- **App nhảy T08** — `/api/periods` trả `08.2026` + `currentKy`; cả 3 màn mặc định T08. (Còn nốt VIỆC 1.)
- **Data Hub trusted-device Cổng 1** — 841 test PASS. Cổng 2 chờ duyệt deploy riêng.
- **AF DN006** — App Salary đã sửa, ứng đúng 65.978.975đ.
