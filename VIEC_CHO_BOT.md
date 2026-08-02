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

## 🔴 VIỆC 0C — CEO RA LỆNH: APP REPORT PHẢI KHỚP APP SALE (làm ngay)

> CEO 02/08: *"App Sale mới xác định doanh thu chỉ có **23.437.000đ** cả VAT. Tại sao lại lôi vào cả các đơn **chưa cập nhật xác nhận giao hàng**? Tao muốn số bên App Sale phải **KHỚP** với bên App Report."*

**ĐÂY LÀ QUYẾT ĐỊNH CUỐI. Không hỏi lại, không phân tích thêm.**

### Mục tiêu (nghiệm thu bằng đúng 1 con số)
```
App Report T08.2026  =  23.437.000đ   (đúng bằng App Sale "ĐÃ THỰC HIỆN")
```
Loại 3 đơn `manual_zalo` chưa xác nhận giao: `DT-260729-0398`, `DT-260730-0404`, `DT-260730-0410` (53.556.720đ).

### Cách làm — TÁCH RÕ 2 TRỤC, đừng lẫn
**1. ĐIỀU KIỆN (đơn nào được tính) — SỬA, copy y hệt App Sale**
Chỉ tính đơn App Sale coi là **"đã thực hiện"**: CRM **đã xuất hoá đơn** + đối tác **đã xác nhận giao thật**.
**LOẠI** đơn nhập tay `manual_zalo` / nguồn không phải đối tác tự xác nhận / **chưa có số hoá đơn**.
→ **Không tự chế điều kiện.** Đọc đúng điều kiện App Sale dùng cho ô *"ĐỐI TÁC — THÀNH TIỀN ĐÃ XUẤT GIAO HÀNG"* rồi dùng lại y nguyên. Một định nghĩa, dùng chung, tháng nào cũng vậy.

**2. TRỤC NGÀY (tính vào tháng nào) — GIỮ NGUYÊN, KHÔNG ĐỘNG**
Vẫn quy kỳ theo **ngày hoá đơn → ngày xác nhận giao**. **TUYỆT ĐỐI KHÔNG** quay lại lọc theo `o.created_at` — đó là bản vá 29/07, đổi là mất 382,6 triệu lần nữa.

### ✅ GỠ MÂU THUẪN (Claude sửa lệnh của chính mình, 02/08 khuya)
Bot phát hiện đúng: *"một định nghĩa dùng chung mọi tháng"* + *"T07 không được đổi"* là **hai điều loại trừ nhau**, vì T07 có chứa `manual_zalo` (2.152.974.290đ). **Lỗi diễn đạt của Claude.**

**Cách giải — dùng đúng cơ chế app ĐÃ CÓ:** luật tính doanh thu có **NGÀY HIỆU LỰC**, y như `effectiveFrom` của công thức thưởng và `penaltyEffectiveFrom` của phạt. Kỳ cũ giữ luật cũ, kỳ mới theo luật mới. Đây là **chuẩn sẵn có của app**, KHÔNG phải ngoại lệ chắp vá.

```
REVENUE_RULE_EFFECTIVE_FROM = 08.2026
```
- **T07 và trước đó:** giữ nguyên luật cũ ⇒ **T07 = 30.917.892.673đ, KHÔNG ĐỔI**. Không materialize lại T07.
- **T08 trở đi:** luật mới (loại đơn nhập tay chưa xác nhận giao) ⇒ **T08 = 23.437.000đ**.
- "Một định nghĩa dùng chung" = **từ ngày hiệu lực trở đi**, không bới lại kỳ đã tính.
- Ngày hiệu lực nằm ở **CONFIG**, không ghi cứng trong code — sau này CEO đổi được.

### ‼ CỔNG CHẶN TIỀN — kiểm TRƯỚC khi ghi bất cứ gì
Chạy **mô phỏng** (không ghi slot) rồi dán 2 số:
1. **T08 mới** — phải ra **23.437.000đ**. Lệch ⇒ DỪNG, báo.
2. **T07** — phải vẫn là **30.917.892.673đ** (vì luật mới chỉ hiệu lực từ T08, **KHÔNG materialize lại T07**). Nếu T07 vẫn đổi ⇒ ngày hiệu lực chưa vào đúng chỗ ⇒ DỪNG, báo.
3. Kiểm thêm **T06 = số cũ không đổi** — chứng minh ngày hiệu lực chặn đúng mọi kỳ cũ.

Đạt cả 2 cổng ⇒ áp thật cho T08, giữ nguyên T07, báo CEO.
Không đạt ⇒ dừng, báo, chờ CEO.

### Sau khi xong
- Đối chiếu lại: App Sale và App Report cùng ra **23.437.000đ** cho T08.
- Ghi vào `CHANGELOG.md`: từ nay App Report **bám định nghĩa "đã thực hiện" của App Sale**, không tự nới.
- Nếu sau này đối tác xác nhận giao thật/xuất hoá đơn cho 3 đơn kia → chúng **tự vào lại** theo ngày xác nhận. Không xoá dữ liệu, chỉ không tính khi chưa đủ điều kiện.

---

## 🔴 VIỆC 2B — MÀN "CHƯA ĐỒNG BỘ": danh mục dòng LỆCH + lý do (CEO đòi lại 02/08)

> CEO 02/08: *"để không phải tìm vòng vo số không khớp thì nên có **một danh mục những dòng không khớp và nguyên nhân không khớp**. Nhìn vào là thấy ngay khỏi đi tìm."*
> **CEO đã yêu cầu việc này từ 29/07** (`SPEC_REVENUE_SYNC_EXCEPTIONS.md`) — **chưa ai build**. Hiện chỉ có `syncAlert.js` (bắn Telegram), **KHÔNG có màn hình nào**. Đây là **món nợ**, làm ngay sau VIỆC 0C.

**Vì sao đáng làm nhất lúc này:** tối 02/08 CEO mất cả buổi truy 53.556.720đ lệch giữa 2 app. Có màn này thì **nhìn phát ra ngay**, không phải nhờ bot đào DB.

### Nội dung — theo `SPEC_REVENUE_SYNC_EXCEPTIONS.md`
- **Bất biến:** `Σ(đưa vào) + Σ(loại ra) == Σ(nguồn)`. Lệch một đồng ⇒ **DỪNG, báo đỏ**, không hiển thị số chỏi.
- **Mỗi dòng bị loại phải ghi đủ 3 thứ:** **nghĩa là gì · ai xử lý · phải làm gì**. Cấm mã lý do trống nghĩa.
- **KHÔNG dòng nào được biến mất lặng lẽ.**

### Mã lý do phải có (lấy từ chính các ca đã gặp)
| Mã | Nghĩa | Ai xử lý | Làm gì |
|---|---|---|---|
| `MANUAL_ZALO_CHUA_XAC_NHAN` | Đối tác báo qua Zalo, NV nhập tay, chưa có xác nhận/hoá đơn | VP018 + đối tác | Đối tác xác nhận trên web hoặc xuất HĐ |
| `CHUA_XUAT_HOA_DON` | Đã giao nhưng chưa có số hoá đơn | Kế toán | Xuất HĐ, điền số |
| `DE_NGHI_GHI` | MISA còn ở trạng thái "Đề nghị ghi" | Kế toán | Chốt thành "Đã ghi" |
| `LECH_KY` | Ngày đặt và ngày giao khác tháng | VP018 | Xác nhận ngày giao thật |
| `THIEU_KHOA_NHAN_DANG` | Không có `source_line_id`/`order_item_id` | DataHub | Cấp khoá nhận dạng |
| `NON_SALES_ROLE` | Mã không thuộc vai trò Sale (vd VP018) | — | Đúng thiết kế, chỉ hiển thị |

### Màn hình
- Vào từ **Doanh thu** (và Tổng quan khi có dòng lệch): nút/thẻ **"⚠ N dòng chưa đồng bộ · X đ"**.
- Bảng: mã đơn · sản phẩm · tiền · **mã lý do + câu giải thích** · ai xử lý · NV · đơn vị · ngày.
- **Lọc theo kỳ + theo mã lý do.** Xuất Excel.
- Trên cùng ghi **phép cộng kiểm tra**: `nguồn = đưa vào + loại ra` — cho CEO tự soi.
- Quyền: **CEO/admin xem tất cả**; NV chỉ thấy dòng của mình (self-scope backend).

### Cách giao
Branch review → Claude soi → merge → deploy từ `origin/main`. **Không đụng công thức tiền**, chỉ hiển thị phần đã bị loại.

---

## ✅ VIỆC 2C — XONG (Claude tự làm, commit `95ba820`)

Đã sửa nốt chỗ lệch múi giờ trong `employeePenaltyPolicy.js` bằng **nâng version v3.7 → v3.8**, theo đúng tiền lệ v3.6 (nâng version cho thay đổi KHÔNG dính tiền, ghi chú rõ).

- `vnDateOf()` dùng `Asia/Bangkok` — không tiêm `now` lệch giờ vì `now` còn dùng cho dấu thời gian nhật ký.
- `FORMULA_VERSION` v3.8 · `employee_bonus_tiers.json` version+note · `bonus_formula_lock.json` version+sourceHash `25c06edc…` · `Target.jsx` nhãn dự phòng v3.8.
- **KHÔNG đổi một đồng nào:** giữ nguyên P1/P2, bậc phạt, mốc %, tỷ lệ, quy tắc khoá sổ ngày 8.
- Test: server **618/624** (6 lỗi PDF thiếu `pdfinfo`, đúng mức nền) · web **102/102**.

**‼ Bot lưu ý khi deploy:** `formulaVersion` production giờ phải ra **v3.8** (không còn v3.7). Cổng nghiệm thu ở VIỆC 3 đổi theo: **v3.8**.

---



## 🔴 VIỆC 3 — LÀM NGAY: deploy + nghiệm thu VP018 + DN022 (mốc chết 08/08)

> ### ✅ CEO ĐÃ DUYỆT DEPLOY — không cần hỏi lại
> CEO duyệt 2 chính sách này từ **31/07** (`APP_REPORT_VP018_POLICY_PUSH_CLAUDE_APPROVE`, `APP_REPORT_DN022_SEPARATE_FORMULA_APPROVE`), Claude review **PASS** (`REVIEW_VP018_DN022_20260801.md`), CEO chốt lịch **"phải xong trước 08/08"**. **Deploy nằm trong phạm vi đã duyệt.** Cứ deploy từ `origin/main`.
> **Nhưng phải DỪNG và báo CEO nếu:** `formulaVersion` không ra **v3.8** · doanh thu toàn công ty T07 **đổi khỏi 30.917.892.673đ** · bất kỳ NV nào ngoài DN022/VP018 bị đổi số tiền. Ba cái đó là cổng chặn tiền, sai một cái là dừng.
Đã có trên `origin/main`: `employeeIncentivePolicy.js` + `revenueAttributionGuard.js`; `formulaVersion` = **v3.7**, lock **v3.7** khớp. Test nền: **618 pass / 6 fail** (6 lỗi PDF do thiếu `pdfinfo`, không phải lỗi code).
**Còn phải làm:** deploy từ `origin/main` rồi dán nghiệm thu bên dưới. Chưa nghiệm thu xong thì **chưa được bật cờ tin thưởng 09/08**.

<details><summary>(chi tiết)</summary>

Branch `fix/dn022-separate-formula-20260731` — CEO đã duyệt từ 31/07, **Claude đã review PASS** (`REVIEW_VP018_DN022_20260801.md`). **Cổng review ĐÃ MỞ, không phải chờ Claude nữa.**

**Làm sau VIỆC 2** (cần main sạch để rebase):
1. Rebase lên `origin/main` — conflict **chỉ ở `CHANGELOG.md`** (hai bên cùng thêm mục đầu file), giải bằng cách **giữ cả hai**, không có conflict code.
2. Kiểm `formulaVersion` = **v3.8**, khớp `bonus_formula_lock.json` (`sourceHash 25c06edc…530e`).
3. Full test → merge → deploy từ `origin/main`.

**Vì sao gấp:** ngày **09/08** bật 2 cờ tin thưởng. Chưa merge kịp thì **VP018** (telesaler, không phải Sale) và **DN022** (chờ công thức riêng) sẽ nhận **TIN TIỀN SAI** — gửi rồi không rút lại được.
**Nếu tới 08/08 chưa xong ⇒ KHÔNG được bật `EMP_COST_NOTIFY`/`BONUS_NOTIFY`.**

</details>

**Nghiệm thu bắt buộc trên production:** DN022 không có thưởng P1/P2 & không phạt target/C45 nhưng **vẫn có Điểm/Xu** · VP018 không được phân bổ doanh thu, **doanh thu toàn công ty KHÔNG đổi** · API trả `formulaVersion` = **v3.8** · VP018 **vẫn nhận** cảnh báo vận hành (đồng bộ, đơn >50tr).

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
