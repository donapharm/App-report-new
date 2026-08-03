# 📋 VIỆC CHO BOT — đọc file này mỗi lần pull main

> **Bot:** đây là hàng đợi việc DUY NHẤT. Mỗi đợt làm: `git pull origin main` → đọc file này → làm từ trên xuống → báo CEO từng việc xong.
> File luôn được Claude cập nhật. Việc xong thì Claude chuyển xuống mục "ĐÃ XONG".
> **CEO không phải chép tay gì nữa** — chỉ nhắn "pull main, đọc VIEC_CHO_BOT.md".

**Cập nhật lần cuối:** 03/08/2026 23:15 GMT+7 — **bảng thứ tự việc ngay bên dưới**, làm từ trên xuống. Sau đó: **VIỆC 3** (hạn 08/08) → **VIỆC 2B**.


---

# 📌 VIỆC CÒN LẠI — cập nhật 04/08/2026 00:05 GMT+7

> Làm từ trên xuống. Xong việc nào báo CEO việc đó rồi mới sang việc kế. Không mở việc mới giữa chừng.

| # | Việc | Hạn | Đang vướng ở đâu | Ai làm |
|---|---|---|---|---|
| **1** | **Deploy `bdf5a10`** (gồm cả `383692f`) — ô doanh thu ghi rõ *"chưa gồm N dòng đang cách ly"*. Nằm ngay trên `c1fb222`, fast-forward sạch. **Kèm: dán ra dòng cách ly T08** — đơn nào · mã hàng nào · vì sao chưa gán được NV · ai xử lý. Xử lý xong hai app khớp `0đ`.<br>**+ Sửa xong DN016/DN018:** KPI và badge "thiếu %" trước đây đọc policy theo hai cách khác nhau (KPI kế thừa T07 → khớp 20/20; badge chỉ đọc exact T08 → báo thiếu 20/20) nên màn phải fail-closed. Nay **mọi đường lấy chi phí đi qua một hàm duy nhất** (`fetchEmployeeCost` bọc `fetchRawEmployeeCost` + `applyEffectiveRates`), có test bất biến chặn đường vòng. **DN016/DN018 vốn sạch; 2 cặp thiếu thật thuộc DN003.** | ngay | code xong, đã test | bot |
| **2** | **"Ứng lần 1" TỰ ĐỘNG theo từng tháng** — CEO chốt 04/08: *"từ T08 trở đi phải là tự động"*. Đọc **`SPEC_SALARY_ADVANCE_AUTO.md`**: Lớp 1 chốt hợp đồng trạng thái (bắt buộc) → Lớp 2 tự kiểm 08:00 GMT+7 + tự nhắc, leo thang trước ngày khoá sổ → Lớp 3 webhook (tuỳ chọn, chỉ để hiện tức thì). **Cấm cơ chế nhắn tay theo tháng.** Chi tiết cũ — App Salary trả `status: approved/provisional` ngoài hợp đồng 10 khoá. **Cấm tự đoán nghĩa** (chi tiết mục dưới). Đang hiện đúng *"App Salary đổi hợp đồng"*, "Còn lại sau ứng" giữ `—`. | 04/08 (Lớp 1) | chờ App Salary trả lời bằng văn bản | bot + App Salary → Claude duyệt |
| **3** | **Nghiệm thu VP018 + DN022** trên PROD | **08/08** | code đã lên PROD, chưa nghiệm thu | bot |
| **4** | **Xác nhận 3.995.000đ MISA "Đề nghị ghi"** | **08/08** | chưa hỏi kế toán | kế toán |
| **5** | **Bật tin nhắn chi phí/thưởng** (`EMP_COST_NOTIFY`, `BONUS_NOTIFY`) | **09/08** | chờ xong #3 | bot |
| **6** | **Màn "Chưa đồng bộ"** — danh mục dòng lệch + lý do (`SPEC_REVENUE_SYNC_EXCEPTIONS.md`) | sau 08/08 | nợ từ 29/07, **chưa có màn nào** | bot |
| **7** | **So tháng trước + nhớ lựa chọn** (CEO duyệt 03/08) | sau 08/08 | chưa code | Claude |
| **8** | **Bản RAM `9986f0a`** + `vault-audit.lock` tự chữa. **‼ NÊN LÀM SỚM:** audit cho thấy lỗi nguồn `unavailable` luân phiên ở DN004/DN007/DN008/DN009/DN011/DN017/DN019/DN024 — snapshot DataHub không ổn định, đúng triệu chứng loop này. Cùng thủ phạm vụ 21 NV hiện 0đ hôm trước. **Cấm vá triệu chứng ở tầng hiển thị.** | sau 08/08 (đề nghị nâng sớm) | chưa deploy | bot |
| **9** | **Module "Thanh toán CP của tôi" GĐ1** | không gấp | có spec + PowerPoint, chưa code | bot |
| **10** | **Đổi `SALARY_SERVICE_TOKEN`** | không gấp | CEO chưa gật | bot, 5 phút |

**Không còn việc nào nằm ở CEO.**

### ✅ Đã xong 03/08 (không làm lại)
Doanh thu khớp App Sale `0đ` (`bf7a7a0`) · tỷ lệ % **tự có hiệu lực sang mọi tháng sau** (`d1fdfdf`) · T08 "Tất cả NV" lên số `118.066.246đ` · ô "Ứng lần 1" nói đúng lý do (`4e759bd`) · nút chọn tháng + bộ lọc nâng cao + doanh thu trước/sau VAT (`c1fb222`) · **CEO đã giao target T08 đủ 21/21 NV**.
Ghim tiền: **T06 `28.403.136.096đ`** · **T07 `30.917.892.673đ`** · **T08 `2.151.774.772đ`** · T07/DN007 `68.726.986đ`. Lệch là DỪNG.

### ‼ Chi tiết việc 2 — cấm tự đoán nghĩa trạng thái
App Salary vừa thêm **bước duyệt kỳ**: chưa duyệt thì trả `amount = 0` kèm `status` mới (`approved` / `provisional`) — không có trong hợp đồng nên App Report chặn, đúng thiết kế.
1. **Dán nguyên JSON thật** của `first-advance` (kỳ 07/2026, DN007 và DN009) cho CEO.
2. **Hỏi App Salary bằng văn bản**: `provisional` và `approved` nghĩa chính xác là gì; `provisional` + `amount = 0` là *"chưa duyệt nên chưa có số"* hay *"đã duyệt và bằng 0"*. **Khác nhau ở đây là khác nhau về TIỀN.**
3. Có câu trả lời rồi mới sửa hợp đồng + `validateProjection` + hiển thị.
4. **‼ Chặn tiền:** `provisional` (chưa duyệt) **KHÔNG được** đưa vào KPI "Còn lại sau ứng lần 1" — nếu tính, "còn lại" sẽ bằng nguyên tổng chi phí, số sai mà trông như số thật. Đang giữ `—`, phải giữ nguyên tới khi chốt xong.
5. Claude duyệt trước khi deploy.

---

# 🔴🔴🔴 CHỈ CÒN MỘT VIỆC: DEPLOY `4e759bd`

**KHÔNG deploy `b8602fb`** (nhánh cũ, lùi PROD). **Deploy đúng `c1fb222`** (đầu nhánh, gồm cả `4e759bd`).
Nhánh `claude/fix-advance-reason-20260803` cắt thẳng từ `d1fdfdf` đang chạy — fast-forward sạch, không xoá dòng nào của PROD.
Diff `d1fdfdf → c1fb222` đúng **7 file**: `salaryAdvance.js` · `salaryAdvance.test.js` · `employeeCostModel.js` · `EmployeeCost.jsx` · `styles.css` · `EmployeeCost.model.test.mjs` · `CHANGELOG.md`. **Không đụng** `employeeCost.js`, không đụng doanh thu.

**Gồm 2 phần:**
- **(a) Ứng lần 1** — như mô tả bên dưới.
- **(b) Giao diện CEO yêu cầu 22:39:** nút **chọn tháng nhanh** (4 tháng gần nhất, bám lịch GMT+7, bấm là xem ngay) · gom Vùng/Tỉnh · Nhóm mã · Tuyến · Ngày · Từ/Đến tháng vào **"Bộ lọc nâng cao"** đóng sẵn, còn bật lọc thì nút hiện số · ô **"Doanh thu chưa VAT"** thêm dòng nhỏ **"Đã gồm VAT: …"** ngay dưới (số backend, frontend không tự nhân chia).

Claude đã chạy: web **110/110** · server **666/672** (6 lỗi PDF do máy build thiếu `pdfinfo`; trên server bot phải là 672/672) · build sạch.

## DEPLOY TIẾP NGAY — Ô "ỨNG LẦN 1" (CEO 22:26, chưa xong)

> CEO: *"vẫn chưa nối lại để ô KPI ứng lần 1 của tháng lên số nhé"* — ảnh DN009/T07 vẫn hiện câu chung *"Tạm thời chưa lấy được từ App Salary"*.

**Đã xác minh:** `d1fdfdf` đang chạy PROD **KHÔNG gồm** phần này (`server/src/salaryAdvance.js` vẫn là bản cũ đếm đúng 10 khoá).

Claude đã ghép riêng **lên đúng nền PROD `d1fdfdf`**, không đụng `employeeCost.js`, không conflict:

```
git fetch origin claude/fix-advance-reason-20260803
git merge --ff-only origin/claude/fix-advance-reason-20260803
```
Đầu nhánh **`4e759bd`** — diff so với `d1fdfdf` đúng **4 file**: `salaryAdvance.js` · `salaryAdvance.test.js` · `EmployeeCost.jsx` · `CHANGELOG.md`.

### Nội dung
1. **Hết vỡ khi App Salary thêm nhãn mới.** `validateProjection()` bỏ ràng buộc "đếm đúng 10 khoá" → chỉ bắt buộc **có đủ** 10 khoá hợp đồng; khoá lạ bị **loại bỏ**. Mọi phép kiểm giá trị giữ nguyên 100%.
2. **Số lương vẫn không lọt sang App Report** — chỉ 10 khoá đi tiếp; server `console.warn` **tên** khoá lạ (không ghi giá trị) để vẫn phát hiện bên kia trả field ngoài hợp đồng.
3. **Ô KPI nói đúng lý do**: *"App Salary đổi hợp đồng"* / *"Sai khoá kết nối App Salary"* / *"App Salary phản hồi chậm"*, thay câu chung chung.

Claude đã chạy trên nền PROD: server **666/672** (6 lỗi PDF do máy build thiếu `pdfinfo` — trên server của bot phải là **672/672**) · web **108/108** · build sạch.

### Deploy
Build web → reload **CHỈ** `app-report`. Không restart Telegram bot, không bật cờ thông báo, không đụng doanh thu.

### Nghiệm thu — dán cho CEO
- Ô **"Ứng lần 1"** kỳ 07/2026 (DN007 và DN009): **ra số**, hoặc hiện **đúng lý do cụ thể**. Không còn câu *"Tạm thời chưa lấy được"*.
- Hàng **nút tháng** hiện đúng 4 tháng gần nhất theo lịch VN, bấm là đổi kỳ ngay; **bộ lọc nâng cao đóng sẵn**; ô doanh thu có **dòng "Đã gồm VAT"** ngay dưới.
- Nếu hiện *"App Salary đổi hợp đồng"* ⇒ dán luôn **JSON thật** từ App Salary (`curl` ở Việc 0A) và chỉ ra khoá/giá trị nào lệch. Đó là việc của bên App Salary, báo CEO rõ.
- **T07/DN009 không đổi một đồng:** tổng `336.334.260đ` · C41 `19.813.217đ` · C43 `303.661.009đ` · C44 `15.176.446đ` · C45 `12.860.034đ` · khớp `99,0%`.
- **T07/DN007 không đổi một đồng:** tổng `68.726.986đ` · khớp `100,0%`.
- Doanh thu T08 `2.151.774.772đ`, T06/T07 frozen.

---

# 🔴 VIỆC 3A-2 — "TẤT CẢ NV" T08 VẪN CHƯA LÊN SỐ (DN016/DN018)

Bot báo: *"ALL T08 gặp snapshot DataHub chỏi DN016/DN018, fail-closed: ẩn badge số, hiện ⚠ chưa đồng nhất."*
**CEO luôn mở ở chế độ "Tất cả nhân viên"** — cả 5 ảnh tối nay đều vậy. Nên với CEO, màn hình **vẫn chưa lên số**.

Phải trả lời trước khi sửa:
1. **DN016 và DN018 chỏi cái gì?** Trường nào · hai giá trị là gì · snapshot nào chỏi snapshot nào. Dán ra.
2. **Ai sửa được** — DataHub hay App Report? Bao lâu?
3. **19 NV còn lại có sạch không?**

Nếu 19 NV sạch: **đề xuất hiện số của 19 người + ghi rõ "chưa gồm DN016, DN018 — dữ liệu chỏi"**, thay vì giấu cả đội. Giấu sạch vì 2 người là **phạt nhầm 19 người còn lại** — mất thông tin chứ không phải fail-closed. **Chưa phải lệnh** — cần biết bản chất chỏi trước khi quyết. Trả lời 3 câu trên rồi Claude chốt.

---

# 🔴🔴 VIỆC 3A — CEO ĐANG BỊ CHẶN, LÀM TRƯỚC MỌI THỨ

> CEO 03/08 19:44 (ảnh màn "Chi phí của tôi", T08.2026): *"đề nghị mày lấy lại giống như T07.2026 tao đã làm kỹ rồi. Giờ mày thay đổi tùm lum, tao rối quá là rối. Bây giờ các ô KPI này cũng không lấy được số là sao vậy."*

### Claude đã soi code — KHÔNG phải do việc doanh thu (VIỆC 0D)
`git log` từ 28/07: **không commit nào của VIỆC 0D đụng** `employeeCost.js` / `employeeCostTable.js` / `EmployeeCost.jsx`. Projection vẫn giữ nguyên `unit_code` + `iit_code` (`qlnb_code`) — đúng 2 trường dùng để tra %. **Không được đổi luật doanh thu để "chữa" màn này.**

### Nguyên nhân thật
~~Tra % theo khoá `đơn vị × mã hàng × THÁNG`; T08 chưa có bảng nên rỗng.~~ **SAI — Claude đã tự sửa, đọc "Việc 0" bên dưới.** Hợp đồng DataHub KHÔNG có trường kỳ: tỷ lệ % là **chính sách đứng yên**, phải tự có hiệu lực sang tháng sau. Đã sửa xong và ĐANG CHẠY PROD trong `d1fdfdf`. **CẤM deploy `b8602fb`** — nhánh cũ, lùi PROD, mất safety fix.
Ba ô còn lại KHÔNG phải lỗi: *Target tổng đội* = **T08 chưa giao target**; *Ứng lần 1* / *Còn lại sau ứng lần 1* = **đúng thiết kế đã duyệt 01/08** (App Salary chỉ self-scope, phải chọn 1 NV, cấm tổng hợp toàn đội).

### Việc 1 — XÁC MINH (làm đầu tiên, 5 phút, đừng sửa gì trước khi có kết quả)
1. Mở đúng màn đó, đổi bộ lọc sang **Tháng Bảy 2026** → dán lại **Khớp doanh thu %** và **Tổng chi phí tháng**.
   - **T07 vẫn đầy số** ⇒ code không hỏng, chỉ thiếu dữ liệu T08 → làm tiếp việc 2.
   - **T07 cũng về 0%** ⇒ **DỪNG NGAY, báo CEO**, đây là hồi quy thật, không được vá giao diện đè lên.
2. Hỏi DataHub: kỳ **08/2026** đã có bảng tỷ lệ % chi phí theo mã hàng chưa? Dán câu trả lời (có/không + ngày dự kiến có).
3. Nếu DataHub bảo **đã có** mà app vẫn 0 khớp ⇒ dán 3 cặp `unit_code` + `iit_code` phía doanh thu và 3 cặp phía bảng %, so từng ký tự để chỉ ra lệch ở đâu.

### Việc 2 — LẤY BẢN VÁ HIỂN THỊ (Claude đã làm sẵn)
```
git fetch origin claude/fix-cost-nomatch-display-20260803
git cherry-pick dc07a18
```
- Chỉ đụng **lớp hiển thị web**: 0 dòng khớp ⇒ ô tiền hiện **"—"** kèm câu *"Kỳ này CHƯA CÓ bảng % chi phí — N/N cặp thiếu %…"*, thay cho **0đ · tạm tính** đang làm CEO tưởng app hỏng.
- **KHÔNG đổi công thức, KHÔNG đụng backend, KHÔNG đổi một đồng nào.** Coverage thấp mà vẫn có dòng khớp thì giữ nguyên số tạm tính như cũ (đã có test chặn).
- Claude đã chạy: web **104/104 pass** (thêm 2 test hồi quy) · `npm run build` sạch.
- Deploy: build web, reload **chỉ** `app-report`. Không restart bot Telegram.

### ‼ Việc 0A — "Ứng lần 1" mất số vì APP SALARY ĐỔI HỢP ĐỒNG (ảnh CEO 20:56)

Ô **"Ứng lần 1 tháng này"** hiện *"Tạm thời chưa lấy được từ App Salary"* ở kỳ **07/2026** (DN007) — trong khi mọi ô chi phí khác của T07 đều đúng.

**Nguyên nhân gần như chắc chắn:** phía App Salary vừa deploy bản đổi hợp đồng (`d557bd6`, gác duyệt `63b6da2`) — họ trả `amount = 0` khi chưa duyệt **kèm nhãn mới `provisional` / `not_approved`**. `server/src/salaryAdvance.js` → `validateProjection()` là **allowlist khoá cứng đúng 10 khoá**:
```
['amount','applicable','available','currency','emp_code','locked','ok','period','reason','status']
```
- Thừa **một** khoá lạ ⇒ `keys.length` lệch ⇒ ném `SALARY_ADVANCE_INVALID_PAYLOAD` ⇒ App Report bỏ cả gói.
- `status` chỉ nhận `draft` / `locked` / `unavailable`. **`not_approved` không nằm trong đó ⇒ chặn.**
- Riêng `amount = 0` thì KHÔNG chặn — nên vấn đề là **khoá/trạng thái mới**, không phải số 0.

Đây là fail-closed đúng thiết kế CEO duyệt 31/07 (cấm nhận field ngoài hợp đồng), **không phải App Report tự chặn**. Nhưng bên kia đổi mà không báo, nên phải xử lý.

#### Làm đúng thứ tự
1. **Lấy payload thật** (chạy trên server, có sẵn token, KHÔNG dán token vào báo cáo):
```
curl -s -H "Authorization: Bearer $SALARY_SERVICE_TOKEN" \
  "$SALARY_SERVICE_BASE/api/integrations/app-report/first-advance?period=2026-07&emp_code=DN007"
```
Dán **nguyên JSON** cho CEO. Đó là bằng chứng, không đoán.
2. So với allowlist 10 khoá ở trên → chỉ ra **đúng khoá/giá trị nào làm lệch**.
3. **Chốt hợp đồng với bên App Salary trước khi sửa code.** Nới allowlist là nới một cửa bảo mật — phải ghi rõ khoá mới nghĩa gì, rồi mới sửa `validateProjection` + `docs/`.
4. Đồng thời sửa chỗ **giấu nguyên nhân**: `safeGetFirstAdvance()` nuốt mọi lỗi thành `upstream_unavailable`, nên CEO không phân biệt được *mạng lỗi* / *sai key* / *lệch hợp đồng*. Phải đưa mã lỗi thật ra ô KPI (vd *"App Salary trả field ngoài hợp đồng"*). **Không đổi số, chỉ đổi câu giải thích.**

#### Nghiệm thu
- Ô "Ứng lần 1" T07 của DN007 **ra số**, hoặc nói **đúng lý do** nếu App Salary cố tình trả 0 vì chưa duyệt.
- Các ô chi phí T07 **không đổi một đồng** (`68.726.986đ`, C43 `60.824.695đ`, C41 `5.198.524đ`, C45 `2.703.767đ`, C44 `3.041.235đ`, khớp doanh thu `100,0%`).

---

### ‼ Việc 0 — CLAUDE ĐÃ CHẨN SAI, ĐỌC LẠI TRƯỚC KHI LÀM (20:40)

> CEO: *"các ô chi phí % đã có sẵn trong DataHub, vậy tự động lấy sang, chứ chả nhẽ cứ mỗi tháng tao phải đi làm như thế này nữa hả. Nếu có chỉnh chính sách % thì tao chỉnh bên DataHub. Tao đề nghị làm giống T07.2026 và các tháng sau T09/T10… cũng như vậy."*

**CEO đúng, Claude sai.** Claude nói "bảng % lưu theo từng tháng, T07 không chảy sang T08" — **sai**. Mở `docs/APP_REPORT_EMPLOYEE_COST_CONTRACT.md` mục 3: dòng trả về là `{c5, c7, c16, c25, c36, c41, c43, c44, c45, c48}` — **KHÔNG có trường kỳ/tháng nào cả**. Đây là **bảng chính sách đứng yên**, khoá theo `mã QLNB × đơn vị`, đúng như CEO nói. Sửa % là sửa chính sách, không phải nạp lại mỗi tháng.

**Luật từ nay (CEO chốt 03/08):** tỷ lệ % **tự động có hiệu lực sang mọi tháng sau** cho tới khi CEO đổi bên DataHub. T08, T09, T10… không ai phải làm gì thêm.

### Nghi phạm số 1 — App Report tự vứt payload (đọc kỹ chỗ này)
`server/src/employeeCost.js` → `adaptPeriodPayload()`:
- Nhánh cuối (payload **không có kỳ**) → **chấp nhận**, gán vào tháng đang hỏi. Màn CEO hỏi đúng 1 tháng (T08→T08) nên nhánh này lẽ ra phải chạy được.
- **NHƯNG** nếu DataHub trả `periods`/`months` mà kỳ trong đó **không nằm trong kỳ đang hỏi** (vd trả `2026-07` khi App Report hỏi `2026-08`), thì `put()` false ⇒ **`return null` ⇒ vứt SẠCH cả gói** ⇒ `outcome: 'invalid_period_payload'` ⇒ **màn hình trắng đúng như ảnh CEO**.
- Đây là kiểu "dữ liệu biến mất lặng lẽ" mà CEO đã cấm: DataHub có số, App Report vứt đi, không nói một câu.

### Cách xác định trong 2 phút — ĐỪNG ĐOÁN
Mở nhật ký `employee_cost_audit` (persist store), lọc bản ghi mới nhất kỳ 2026-08, đọc trường `outcome`:

| `outcome` | Nghĩa | Ai sửa |
|---|---|---|
| `invalid_period_payload` | **DataHub CÓ số, App Report vứt** | **App Report — lỗi của mình** |
| `ok` + `rows` rỗng | DataHub thật sự không trả dòng nào | DataHub |
| `upstream_*` / `not_configured` | Lỗi kết nối/thiếu key | App Report + hạ tầng |

**Dán nguyên `outcome` + `matchedRows/totalRows` cho CEO trước khi sửa bất cứ dòng code nào.**

### Sửa theo đúng luật CEO vừa chốt
1. **Cấm vứt cả gói vì một kỳ lạ.** `adaptPeriodPayload` phải **giữ lại phần dùng được**, chỉ bỏ đúng khối sai, và **ghi rõ lý do ra màn hình** — không được im lặng trả rỗng.
2. **Tỷ lệ đang hiệu lực:** tháng đang hỏi không có bảng riêng ⇒ **dùng bảng công bố gần nhất**, hiển thị nhãn *"tỷ lệ hiệu lực từ MM/YYYY"*. Đây là **hành vi vĩnh viễn**, áp cho T08/T09/T10… không phải vá một lần.
3. Nếu hoá ra DataHub mới đổi sang trả theo kỳ ⇒ **thống nhất lại hợp đồng**, cập nhật `docs/APP_REPORT_EMPLOYEE_COST_CONTRACT.md`, rồi mới code.
4. **Không đụng công thức tiền.** Chỉ sửa đường lấy tỷ lệ + nhãn nguồn.

### Nghiệm thu
- T08 lên **đủ 6 ô tiền**, có nhãn ghi rõ tỷ lệ hiệu lực từ tháng nào.
- T07 **không đổi một đồng**.
- Bịa một payload DataHub chứa kỳ lạ ⇒ App Report **vẫn hiện phần dùng được** + báo rõ, KHÔNG trắng màn.

---

### Việc 3 — ‼ HAI SỐ TRÊN CÙNG MỘT MÀN KHÔNG KHỚP (ảnh CEO 20:01)
*(cập nhật 20:33: chip đã hiện `99 mã · 301 cặp` khớp đúng 301 cặp ở KPI — lệch 281/301 lúc trước là do màn đang tải dở. Vẫn kiểm lại nhưng hạ ưu tiên.)*
Ô KPI ghi **`301 cặp thiếu %`**, nhưng chip tab ghi **`98 mã · 281 cặp`**. **Lệch 20 cặp.** Đúng loại "dòng biến mất lặng lẽ" mà CEO đã cấm — CEO không tin được số nào cả.
- **Nghi ngờ (phải kiểm, đừng tin lời Claude):** `server/src/employeeCostGaps.js` → `aggregatePairs()` có `if (!key) continue;` — cặp nào **rỗng mã sản phẩm** bị bỏ khỏi danh mục mà không đếm vào đâu cả.
- Yêu cầu: dán ra **20 cặp đó là cặp nào** (đơn vị + mã + NV). Nếu đúng do rỗng mã ⇒ phải **hiện thành một dòng riêng** ("thiếu mã sản phẩm — DataHub cấp mã"), KHÔNG được bỏ im.
- Bất biến bắt buộc: **số cặp ở KPI == tổng số cặp trong tab**. Lệch là báo đỏ, không hiển thị số chỏi.

### Nghiệm thu
- T08 → ô tổng chi phí hiện **"—" · nhãn "chưa có bảng %"**, KHÔNG còn `0đ`.
- Số cặp ở KPI **bằng đúng** tổng cặp trong tab "Mặt hàng thiếu %".
- T07 → số **không đổi một đồng** so với trước khi cherry-pick.
- Dán cho CEO: kỳ 08/2026 thiếu **đúng cái gì** và **ai** phải nạp (DataHub hay App Sale), kèm ngày có.

---

# 🔴🔴 LÀM NGAY — THỨ TỰ CHỈ CÓ MỘT

Doanh thu đã khớp `0đ` trên PROD `bf7a7a0`. **Đừng đụng lại phần doanh thu nữa.**
Làm đúng thứ tự dưới đây, xong việc nào báo CEO việc đó:

| Thứ tự | Việc | Vì sao trước |
|---|---|---|
| **0** | **VIỆC 3A** (ngay phía trên) — màn "Chi phí của tôi" T08 không ra số | **CEO đang bị chặn ngay lúc này** |
| **1** | **VIỆC 3** — nghiệm thu VP018 + DN022 trên app thật | **có mốc chết 08/08** |
| **2** | **VIỆC 2B** — màn "Chưa đồng bộ" (danh mục dòng lệch + lý do) | CEO đòi từ 29/07, đã bị bỏ quên 1 lần |
| 3 | VIỆC 4 — deploy bản RAM `9986f0a` | hết loop hụt dữ liệu |
| 4 | VIỆC 5 — module "Thanh toán CP của tôi" GĐ1 | không gấp |

### ‼ CẤM tuyệt đối
- **CẤM deploy lại `e9f8d33`** — đã thử, đã rollback, làm App Report vống lên `2.205.331.492đ` (thừa `53.556.720đ / 3 đơn`). Bản đó dùng response/effective date + `order_items.price`; App Sale PROD dùng `orders.created_at` + delivered quantity + giá C31. **Bot đã đúng khi từ chối lệnh cũ của Claude — giữ nguyên cách xử lý đó.**
- **CẤM sửa luật doanh thu** khi làm 4 việc trên. Đụng vào `appSaleRevenueMirror.js` hay projection của `materialize_july_revenue.js` là `revenueRuleLock.test.js` đỏ — đúng như thiết kế. Muốn đổi thì audit App Sale live trước, nâng version, rồi mới sửa.
- Ghim tiền: **T06 = `28.403.136.096đ`**, **T07 = `30.917.892.673đ`**, **T08 = App Sale, chênh `0đ`**. Lệch là DỪNG, báo CEO ngay.

---

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

## ✅ VIỆC 0D — XONG 03/08 (PROD `bf7a7a0`) — KHÔNG LÀM LẠI

```
App Sale “ĐÃ THỰC HIỆN”  2.151.774.772đ
App Report T08.2026      2.151.774.772đ   → chênh 0đ
   CRM      1.340.385.772đ
   Đối tác    811.389.000đ (45 đơn)
```
Run 339 · 304 dòng · đối soát cách nhau 0,784 giây · T06/T07 nguyên vẹn · chỉ reload `app-report`.

**Claude đã kiểm lại độc lập trên đúng commit đang chạy:**
- `revenueRuleLock.test.js` **6/6 pass**.
- `appSaleRevenueMirror.js` phần đối tác chỉ có **MỘT** bộ lọc ngày (`o.created_at`) — **không còn lọc kép**, tức lỗi từng làm bốc hơi 382,6 triệu không tái diễn được.
- Kỳ tự nhảy theo tháng lịch `Asia/Bangkok`, không ghi cứng tháng; test chặn luôn việc ghi cứng.

**Hệ quả kiến trúc đã báo CEO:** quy kỳ doanh thu nay theo **ngày tạo đơn** của App Sale, **thay thế** quyết định "ngày thực giao" ngày 29/07. `SPEC_REVENUE_DELIVERY_PERIOD.md` đã gắn nhãn SUPERSEDED (`4fe6944`); đọc `SPEC_REVENUE_SSOT.md` thay cho nó. Muốn quay lại ngày giao ⇒ **App Sale sửa trước**, App Report theo sau.

<details><summary>(lưu vết — hồ sơ VIỆC 0D)</summary>

> CEO duyệt 03/08: `APPROVE_INTEGRATE_VIEC0D_CDA551A_TO_ORIGIN_MAIN_20260803`.

### Kết quả kiểm tra lại exact `origin/main e9f8d33`
Deploy thẳng bị dừng đúng cổng tiền: CRM khớp nhưng partner cao hơn App Sale **53.556.720đ / 3 đơn**.
Nguyên nhân: code cũ dùng ngày phản hồi/effective date + `order_items.price`; App Sale PROD hiện dùng `orders.created_at` + response delivered quantity + giá C31 và loại trạng thái hủy/cancel.

### Cách sửa đã duyệt
1. Tích hợp candidate exact App Sale SQL mirror lên `origin/main`.
2. Khóa provenance App Sale revision/source SHA và fingerprint SQL/projection.
3. Chỉ deploy exact commit đã push lên `origin/main`; không deploy local-only.
4. Materialize one-shot T08, reload **chỉ** `app-report`; không restart bot Telegram, không bật thông báo.

### Cổng nghiệm thu
- Cùng scope và GMT+7, App Report = CRM App Sale + Partner App Sale, delta từng nhóm và tổng **0đ**.
- Ảnh hai màn cách nhau dưới 2 phút.
- **T07 = 30.917.892.673đ**, **T06 = 28.403.136.096đ**; đổi là DỪNG.
- Source run, active slot, claim, payload, frozen fingerprints hoặc manifest drift là DỪNG.

### Kỷ luật
**Push/merge `origin/main` trước, fetch exact remote commit rồi mới deploy. Không ngoại lệ.**

</details>

---

<details><summary>(lưu vết — phân tích 0D ban đầu)</summary>

### BỎ BỘ LỌC TỰ CHẾ, LẤY ĐÚNG "ĐÃ THỰC HIỆN" CỦA APP SALE

> CEO 03/08 15:18: *"tại sao làm hoài hai con số của App Sale và App Report vẫn không khớp nhau vậy. Tao đã yêu cầu phải khớp cả hai số ở hai bên rồi mà sao vẫn vậy."*

### Số thực đo (CEO chụp cùng thời điểm, 15:15–15:18 GMT+7, kỳ 01→03/08)
| | Số |
|---|---|
| **App Sale — ĐÃ THỰC HIỆN** | **1.735.284.772đ** = CRM xuất HĐ `1.340.385.772` + Đối tác đã xuất/giao `394.899.000` (23 đơn) |
| **App Report** | **1.558.525.772đ** (201 dòng) |
| **CHÊNH** | **176.759.000đ** — App Report **THẤP HƠN** |

### ‼ NGUYÊN NHÂN — LỖI CỦA CHÍNH VIỆC 0C
App Sale **CÓ tính** đơn đối tác (kể cả nhập tay/Zalo) vào *"ĐỐI TÁC — THÀNH TIỀN ĐÃ XUẤT GIAO HÀNG"* = **394,9 triệu / 23 đơn**.
VIỆC 0C lại bắt App Report **LOẠI** những đơn đó ⇒ App Report hụt đi.

Tối 02/08 App Sale hiện *"đối tác 0đ / 0 đơn"* — đó **chỉ là do bộ lọc NGÀY chưa quét tới**, KHÔNG phải App Sale không công nhận. Claude và bot đã suy luận sai từ đó, rồi **tự chế thêm một bộ lọc mà App Sale không có**.

### VIỆC PHẢI LÀM
1. **GỠ BỎ** điều kiện loại `manual_zalo` / "chưa xác nhận giao" mà VIỆC 0C thêm vào. **KHÔNG có bộ lọc tự chế nào nữa.**
2. **Lấy ĐÚNG định nghĩa "ĐÃ THỰC HIỆN" của App Sale**, không thêm không bớt:
   ```
   Doanh thu = CRM đã xuất hoá đơn  +  Đối tác đã xuất/giao
   ```
   Đọc **đúng điều kiện SQL** App Sale dùng cho 2 ô đó rồi **dùng lại y nguyên**. Nếu App Sale tính đơn nhập tay thì App Report **cũng tính**.
3. **Trục ngày giữ nguyên** (ngày hoá đơn → ngày xác nhận giao). KHÔNG quay lại `o.created_at`.

### ‼ CỔNG NGHIỆM THU — SO CÙNG THỜI ĐIỂM
Chụp **cùng lúc** (chênh < 2 phút), cùng kỳ, App Sale mốc **"Ngày phản hồi/giao"**:
- **App Report == App Sale "ĐÃ THỰC HIỆN"**, chênh **0đ**. Còn lệch ⇒ dán bảng đối chiếu từng nhóm (CRM xuất HĐ / Đối tác đã giao) chỉ rõ dòng nào thừa-thiếu.
- **T07 = 30.917.892.673đ** và **T06 = 28.403.136.096đ** — vẫn ghim, đổi là DỪNG.
- Tổng nguồn = đưa vào + loại ra.

</details>

### GHI NHỚ ĐỂ KHÔNG LẶP LẠI
**App Report KHÔNG được tự định nghĩa doanh thu.** App Sale là nguồn sự thật; App Report **soi chiếu**, không diễn giải lại. Muốn đổi cách tính ⇒ đổi ở **App Sale trước**, App Report theo sau.
Khi thấy hai app lệch: **kiểm bộ lọc NGÀY của màn App Sale trước tiên** — lệch do bộ lọc ngày trông y hệt lệch do sai công thức, và đã lừa được cả Claude lẫn bot một lần.

---

<details><summary>(lưu vết — VIỆC 0C, hướng đã SAI, giữ để không lặp lại)</summary>

## 🔴 VIỆC 0C — CEO RA LỆNH: APP REPORT PHẢI KHỚP APP SALE (làm ngay)

> CEO 02/08: *"App Sale mới xác định doanh thu chỉ có **23.437.000đ** cả VAT. Tại sao lại lôi vào cả các đơn **chưa cập nhật xác nhận giao hàng**? Tao muốn số bên App Sale phải **KHỚP** với bên App Report."*

**ĐÂY LÀ QUYẾT ĐỊNH CUỐI. Không hỏi lại, không phân tích thêm.**

### ✅ CLAUDE ĐÃ DUYỆT SẴN — ĐỪNG CHỜ CLAUDE NỮA

CEO hỏi 03/08: *"Vậy là sao? Lý do sao chưa cho lên nào"*. **Claude duyệt trước phần của mình:**
- Phần làm chắc (frozen payload, chống sửa trộm, claim bind): **ĐẠT, không cần Claude soi lại.**
- Đạt 3 cổng tiền bên dưới ⇒ **CỨ ÁP THẬT, CỨ DEPLOY.** Không phải chờ Claude duyệt vòng nữa.
- **Chỉ còn 1 cửa duy nhất: nút duyệt của CEO.** Kiểm xong ⇒ **trình nút cho CEO NGAY**, kèm 3 số (T08 mới · T07 · T06) + danh sách dòng bị loại. Đừng để CEO phải hỏi "sao chưa lên".

### ⏱ CHỐT PHẠM VI 03/08 — ĐỦ RỒI, ĐỪNG THÊM VIỆC NỮA

Phần làm chắc (frozen payload `O_NOFOLLOW`, chống sửa trộm byte+hash, claim bind byte/semantic hash, ghim T06/T07) — **Claude duyệt, đủ dùng.** Đặc biệt tốt: đổi byte rồi đổi luôn hash mong đợi vẫn bị chặn nhờ đối chiếu tổng dòng/tổng tiền đã parse.

**TỪ ĐÂY: KHÔNG thêm hạng mục an toàn mới.** Chạy thẳng Gate 1 → Gate 2 → deploy → báo số. CEO đã chờ 2 ngày cho con số này.
Phát hiện rủi ro mới mà **không dính tiền T06/T07** ⇒ ghi lại thành việc sau, **đừng chặn deploy**. Chỉ dừng khi: T06/T07 lệch · tổng nguồn ≠ (đưa vào + loại ra) · test nền đỏ thêm.

### ‼ CẬP NHẬT 03/08 — CEO CHỌN PHƯƠNG ÁN 1: CHỤP LẠI SNAPSHOT MỚI

Bot dừng đúng ở Gate 2: **con số 23.437.000đ là ảnh chụp tối 02/08, đã cũ.** Sáng 03/08 có đơn mới:
- Active T08 hiện: 201.264.540đ (run 327)
- Run 328 — luật cũ: **329.253.640đ** · **luật VIỆC 0C: 211.551.920đ** · loại: 117.701.720đ/11 dòng

**CEO chốt: làm theo phương án 1** — khoá snapshot live mới, dựng lại transition theo doanh thu hợp lệ **hiện tại**, xin lại Gate 1/Gate 2.

**KHÔNG ép về 23.437.000đ.** Ép vậy là **xoá doanh thu thật đã bán sáng nay** ⇒ App Report thành **thấp hơn** App Sale, sai đúng thứ đang muốn sửa.

**Điều CEO yêu cầu là LUẬT, không phải con số:** *chỉ tính đơn đã xuất hoá đơn + đã xác nhận giao*. Áp luật đó lên dữ liệu hiện tại ⇒ **211.551.920đ** (số này cũng sẽ đổi tiếp khi có đơn mới — đúng bản chất).

**Nghiệm thu đổi thành:**
1. T08 = kết quả áp luật mới lên snapshot **vừa khoá** (hiện ~211.551.920đ). Dán số + mã snapshot.
2. **T07 vẫn phải = 30.917.892.673đ** (ngày hiệu lực từ T08) — đổi là DỪNG.
3. **T06 không đổi.**
4. Dán **danh sách dòng bị loại** (hiện 11 dòng / 117.701.720đ): mã đơn · lý do · tiền — để CEO đối chiếu App Sale.

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

</details>

---

## 🔴 VIỆC 2B — MÀN "CHƯA ĐỒNG BỘ": danh mục dòng LỆCH + lý do (CEO đòi lại 02/08)

> CEO 02/08: *"để không phải tìm vòng vo số không khớp thì nên có **một danh mục những dòng không khớp và nguyên nhân không khớp**. Nhìn vào là thấy ngay khỏi đi tìm."*
> **CEO đã yêu cầu việc này từ 29/07** (`SPEC_REVENUE_SYNC_EXCEPTIONS.md`) — **chưa ai build**. Hiện chỉ có `syncAlert.js` (bắn Telegram), **KHÔNG có màn hình nào**. Đây là **món nợ**, làm ngay sau VIỆC 3.

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

**Làm ĐẦU TIÊN** (VIỆC 0D đã xong, `origin/main` sạch để rebase):
1. Rebase lên `origin/main` (`bf7a7a0` trở lên) — conflict **chỉ ở `CHANGELOG.md`** (hai bên cùng thêm mục đầu file), giải bằng cách **giữ cả hai**, không có conflict code.
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
