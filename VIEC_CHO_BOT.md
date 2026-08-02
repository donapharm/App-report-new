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

## ✅ VIỆC 0B — ĐÓNG. APP REPORT ĐANG ĐÚNG, KHÔNG SỬA GÌ (CEO chốt 02/08)

> CEO: *"tôi không quan tâm ngày nào tạo đơn, tôi chỉ yêu cầu ghi nhận doanh thu **đúng ngày giao hàng có xác nhận với web và xác nhận xuất hoá đơn**. Cứ làm y chang T07.2026."*

**Luật CEO = đúng thứ tự máy đang chạy:**
```
ngày quy kỳ = ngày HOÁ ĐƠN → ngày XÁC NHẬN trên web → (dự phòng)
```
Ngày **tạo đơn** không tham gia — đúng ý CEO, và đúng bản vá 29/07.

**3 đơn WEB** (tạo 29–30/07, **xác nhận web 01/08**) → ghi vào **T08**. **ĐÚNG.** Không phải lỗi.
App Sale hiện T08 = 0 vì **màn hình bên App Sale lọc theo ngày TẠO đơn** — hai màn trả lời hai câu khác nhau. Muốn khớp thì sửa **màn App Sale**, KHÔNG sửa App Report.

### ⛔ KẾT LUẬN — CẤM ĐỘNG VÀO
- **KHÔNG** sửa `materialize_july_revenue.js`. **KHÔNG** đổi quy kỳ. **KHÔNG** chỉnh số T07/T08.
- **KHÔNG** mở lại điều tra 0B. Việc này ĐÓNG.
- T08 sẽ tự lên số khi đơn được **xác nhận trên web / xuất hoá đơn** — cứ để chạy.
- (Tuỳ chọn, không chặn gì: nếu sau này App Sale thêm ô "Ngày thực giao" cho đối tác khai lùi ngày, số sẽ chính xác tuyệt đối thay vì lấy ngày xác nhận. Không có cũng không sao.)

---

## 🔴 VIỆC 3 — LÀM NGAY: deploy + nghiệm thu VP018 + DN022 (mốc chết 08/08)

> ### ✅ CEO ĐÃ DUYỆT DEPLOY — không cần hỏi lại
> CEO duyệt 2 chính sách này từ **31/07** (`APP_REPORT_VP018_POLICY_PUSH_CLAUDE_APPROVE`, `APP_REPORT_DN022_SEPARATE_FORMULA_APPROVE`), Claude review **PASS** (`REVIEW_VP018_DN022_20260801.md`), CEO chốt lịch **"phải xong trước 08/08"**. **Deploy nằm trong phạm vi đã duyệt.** Cứ deploy từ `origin/main`.
> **Nhưng phải DỪNG và báo CEO nếu:** `formulaVersion` không ra **v3.7** · doanh thu toàn công ty T07 **đổi khỏi 30.917.892.673đ** · bất kỳ NV nào ngoài DN022/VP018 bị đổi số tiền. Ba cái đó là cổng chặn tiền, sai một cái là dừng.
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

## 🟠 VIỆC 4 — Deploy bản RAM `9986f0a` (sau VIỆC 3)

> ### ✅ CEO ĐÃ DUYỆT DEPLOY — không cần hỏi lại
> Đây là bản chống tái diễn sự cố mất số chi phí 01/08, CEO đã duyệt trong lịch việc. Không đụng công thức tiền. Cứ deploy sau khi VIỆC 3 xong và đã đo tốc độ.

Candidate đã xong local, 3 điểm review đã sửa (đồng thời 2 · TTL lỗi ≤2 phút · admission 576 + dự phòng 192 MiB).
**Trước khi deploy phải đo lại:** hạ đồng thời 3→2 làm màn "Tất cả NV" chậm hơn ~1,5×. Số cũ: ổn định 4,9s · **cold 22,4s** ⇒ cold mới có thể **~33s**. **Đo cold thật + kiểm không vượt timeout frontend.** Vá RAM mà đẻ ra "tải mãi không xong" là đổi bệnh này lấy bệnh khác.
Deploy từ `origin/main`, dán 2 SHA trùng.

<details><summary>(bối cảnh vì sao cần)</summary>

Sự cố 01/08 đã chữa nhưng **vòng lặp chưa cắt**:
```
Mở "Tất cả NV" → RAM DataHub vọt → PM2 restart theo guard
→ nếu đang giữ vault-audit.lock → khóa mồ côi → mọi request kẹt ~10s → mất số
```
**Việc quan trọng nhất:** `vault-audit.lock` phải **TỰ LÀNH** — ghi **PID chủ + TTL**, ai vào sau thấy chủ đã chết hoặc quá TTL thì **tự phá khóa** + ghi audit. Tiến trình chết khi đang giữ khóa là điều **phải chịu được**.
Kèm: cổng RAM riêng (**không nâng guard để che**), xem lại thiết kế "Tất cả NV", **rút ngắn cache kết quả LỖI**.
</details>

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
