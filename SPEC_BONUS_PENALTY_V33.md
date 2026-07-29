# SPEC — PHẠT (v3.3), đi kèm Thưởng v3.2

> **CEO chốt 2026-07-29.** Bản này thay thế bản nháp sáng cùng ngày (bậc âm nối tiếp P1) — CEO đã chốt cách tính **gọn hơn**: trừ thẳng vào **cột C45 "Lương tăng thêm"**.

| # | CEO chốt | Ghi chú |
|---|---|---|
| 1 | Đạt **70–89%** target ⇒ trừ **0,2%** tại C45 · **51–69%** ⇒ trừ **0,3%** tại C45 · **<50%** ⇒ **C45 không tính vào chi phí tháng** | thay cho bậc âm |
| 2 | Trần tiền phạt: **theo ý số 1** ⇒ trần chính là **số tiền C45** | không trừ quá thành âm |
| 3 | **TẤT CẢ nhân viên** được nhìn thấy **số tiền phạt + công thức tính** | **đảo ngược** chốt "chỉ báo CEO" lúc sáng |
| 4 | Thêm **đúng 4 ô KPI** trong mục "quyền quản trị tự xem chi phí", màu **đối nghịch** với ô hiện có | xem mục 5 |

Người triển khai: **bot server**. Claude: kiến trúc + review.
Ship xong nâng `FORMULA_VERSION` **v3.2 → v3.3** (mục 8).

---

## 0. Hiện trạng — đọc trước khi code

**a) C45 là gì.** `config/employee_cost_templates.json`: `"c45": "C45 Lương tăng thêm (%)"`. Là **1 trong 4 cột chi phí THÁNG** (`c36, c41, c43, c45`); `c44` "Lương cuối năm" nằm ngoài tổng tháng. Số thật đã nghiệm thu (T06 DN001): `c36 750.400 + c41 7.995.379 + c43 26.489.506 + c45 7.599.706 = 42.834.991đ`.

⇒ Ý CEO rất rõ: **không đạt target thì bị cắt vào phần "lương tăng thêm"**, đạt dưới 50% thì **mất trắng phần đó**.

**b) Phạt thiếu Xu ĐÃ CÓ SẴN và chạy đúng** — `server/src/xuPolicy.js`: `PENALTY_PER_MISSING_XU = 300000`, tháng tạm tính / quý quyết toán, có `prior_booked` để **không phạt hai lần**. Hiện chỉ được gọi trong `dormantService.js`. Trang chi phí **đã có sẵn khối** "Cấn trừ do thiếu xu chi tiêu (quý) · dự kiến" (`EmployeeCost.jsx:563`) nhưng đang ở trạng thái *"đang đối soát"*. ⇒ **KHÔNG viết lại máy tính**, chỉ phơi ra thành ô KPI.

**c) Màu đã có sẵn.** `styles.css:2026` đã định nghĩa `.employee-cost-tone-penalty` (đỏ `#b91c1c → #dc2626`, chữ trắng) — **đối nghịch đúng** với `.employee-cost-tone-reward` (xanh lá `#047857 → #059669`). Class này **chưa dùng ở đâu**. Bot **dùng lại**, không chế màu mới.

---

## 1. Nguyên tắc bất di bất dịch

1. **P1/P2 KHÔNG SỬA.** Phạt là **trường riêng**, không trộn vào `amount`/`baseAmount`/`priorityAmount`.
2. **Fail-closed = KHÔNG PHẠT.** Thiếu dữ liệu / chưa giao target ⇒ **không phạt**, không phải "phạt 0đ". Trạng thái phải nói rõ *vì sao không phạt*.
3. **Chưa giao target thì tuyệt đối không phạt.** Không có target = không có căn cứ. Ai không có target (CTV, NV mới, ngoài roster 21 mã) tự động không bị phạt — không cần danh sách loại trừ riêng.
4. **KHÔNG ghi đè số DataHub.** C45 gốc giữ nguyên; phạt là **dòng trừ riêng**, tổng sau phạt là **số hiển thị**, không ghi ngược về DataHub.
5. **Chưa phải payroll.** Nhãn bắt buộc: **"Dự kiến/tham khảo — chưa trừ lương"**.
6. **Đổi cách tính phạt ⇒ nâng version** (`CLAUDE.md` mục 5). Phạt nằm trong vân tay `bonus_formula_lock.json`.

---

## 2. Phạt theo target — công thức

### 2.1 Bậc phạt

| % đạt target tháng | Xử lý | `penaltyTier` |
|---|---|---|
| **≥ 90%** | không phạt | `none` |
| **70% ≤ pct < 90%** | trừ **0,2%** vào C45 | `t70_90` |
| **50% ≤ pct < 70%** | trừ **0,3%** vào C45 | `t50_70` |
| **pct < 50%** | **loại toàn bộ C45** khỏi chi phí tháng | `drop_c45` |

> **‼ Claude đã bịt lỗ hổng mốc — CEO xác nhận lại giúp.** CEO nói "70 đến 89", "51 đến 69", "<50". Đọc nguyên văn thì **89–90%, 69–70%, 50–51% và đúng 50%** bị **hở** — NV rơi vào đó thì máy không biết xử sao. Bảng trên dùng **mốc liền mạch**, giữ đúng ranh giới CEO nêu và giữ nguyên "**dưới 50%** mới mất trắng". Đúng 50,0% ⇒ vào bậc 0,3%, **không** mất trắng.

### 2.2 Số tiền phạt

```
phạtTarget = min( rate × doanhThuTrướcVAT , tiềnC45 )      với rate = 0,2% hoặc 0,3%
```

Nếu `pct < 50%`: `phạtTarget = tiềnC45` (loại trọn cột).

**Vì sao nhân với doanh thu chứ không nhân với C45:** C45 vốn được tính `doanh thu × %C45`. "Trừ 0,2% tại cột C45" = hạ tỷ lệ C45 đi 0,2 điểm ⇒ tiền giảm đúng bằng `0,2% × doanh thu`. **Hai cách đọc ra cùng một số.**

**Trần = tiền C45** (CEO chốt ý 2). Không bao giờ để C45 âm.

> **Chi tiết kỹ thuật cho bot:** kẹp ở **mức tổng**, không kẹp từng dòng. Hai cách chỉ lệch khi có dòng `%C45 < 0,2%`; kẹp tổng cho **một con số CEO đối chiếu được bằng tay**. Nếu sau này cần kẹp từng dòng thì phải nâng version.

### 2.3 Fail-closed

| Tình huống | Kết quả | `penaltyStatus` |
|---|---|---|
| `penaltyEnabled !== true` | không phạt | `disabled` |
| Chưa giao target (`target <= 0` / `pct == null`) | **không phạt** | `missing_target` |
| Tiền C45 chưa tính được (coverage thấp ⇒ `null`) | **không phạt** | `c45_unavailable` |
| Chưa cấu hình bậc phạt | không phạt | `unconfigured` |
| Kỳ chưa kết thúc | có tính, **nhãn TẠM TÍNH** | `provisional` |
| Kỳ đã đóng | số chốt | `final` |

**`c45_unavailable` là bẫy quan trọng nhất.** Coverage thấp thì tổng chi phí bị khoá `null` (fail-closed đang có). `Number(null) === 0` ⇒ trần phạt thành 0 ⇒ *may là không phạt*, nhưng nếu code đi nhánh khác thì thành "phạt trọn 0đ" hoặc "còn lại = số âm". Đã dính bẫy này **2 lần trong tháng 7**. Bắt buộc kiểm `null` tường minh, không dùng `|| 0`.

### 2.4 Rủi ro kỹ thuật khi `pct < 50%` — bot đọc kỹ

Loại C45 khỏi tổng tháng **theo từng NV, từng kỳ** (không phải loại cứng như `c44`). Phải giữ được các bất biến đang có:
- **Σ theo ngày = tổng tháng** (phần lẻ dồn ngày cuối).
- Logic **residual/làm tròn** đang đối chiếu trên tổng tiền cột gốc.
- **Tỷ lệ khớp / coverage** không được đổi vì việc loại cột này.
- Cột C45 vẫn **hiện trong bảng** (để NV thấy mình mất cái gì), chỉ **không cộng vào tổng**, có nhãn rõ — làm giống cách `c44` đang được làm mờ + tách dòng.

---

## 3. Phạt thiếu Xu — phơi cái đã có

1. Gọi lại `xuPolicy.buildCheckpoint()`, **không tính lại**.
2. Giữ **tháng = tạm tính, quý = quyết toán**, giữ `prior_booked` để **không phạt hai lần**.
3. `perMissingXu` đưa vào `config/employee_bonus_tiers.json` (`xuPenalty.perMissingXu`, mặc định `300000`) để CEO chỉnh qua đúng luồng preview→save. Đổi số này = **đổi công thức** ⇒ nâng version.
4. `xuPenalty.enabled` mặc định **false**.
5. Nguồn điểm/xu hỏng ⇒ `xu_source_unavailable`, **không phạt**.

---

## 4. Gộp số & payload

```json
"penalty": {
  "enabled": true,
  "targetPct": 78.4,
  "tier": "t70_90",
  "ratePct": 0.2,
  "c45Amount": 7599706,
  "targetAmount": 2400000,
  "targetStatus": "provisional",
  "c45Dropped": false,
  "xuAmount": null,
  "xuStatus": "quarter_pending",
  "xuMissing": 2,
  "total": 2400000,
  "cappedByC45": false,
  "provisional": true,
  "formulaText": "Đạt 78,4% → bậc 70–90% → trừ 0,2% × doanh thu 1.200.000.000đ = 2.400.000đ (tối đa bằng C45 7.599.706đ)",
  "label": "TẠM TÍNH — dự kiến/tham khảo, chưa trừ lương"
}
```

`formulaText` do **backend sinh** — CEO chốt "cho NV nhìn thấy công thức tính", nên câu chữ phải đi cùng số, không để frontend tự ghép kẻo lệch.

---

## 5. Bốn ô KPI mới (CEO chốt ý 4)

Đặt trong `kpi-grid employee-cost-kpis` (`EmployeeCost.jsx:1295`), **đúng vị trí CEO chỉ định**:

| # | Ô | Đặt cạnh | tone | Khi không có số |
|---|---|---|---|---|
| 1 | **Phạt dự kiến** | ô *Thưởng dự kiến* | `employee-cost-tone-penalty` (đỏ — đã có sẵn) | `"Không bị phạt"` + lý do (đạt ≥90% / chưa giao target) |
| 2 | **Tổng chi phí tháng sau phạt** | ô *Tổng chi phí tháng (chi phí gốc)* | nghịch với `tone-base` (nền đậm, chữ sáng) | tổng gốc `null` ⇒ **ẩn hẳn ô**, không hiện `—` |
| 3 | **Phạt thiếu Xu cuối quý** | ô *Phạt dự kiến* | `tone-penalty` nhạt hơn | tháng không phải cuối quý ⇒ `"Chốt vào cuối quý (T9)"` |
| 4 | **Ứng lần 1 tháng này** | ô *Tổng chi phí sau phạt* | trung tính | **`"Chưa đấu nối app lương"`** |

### Ba chỗ bắt buộc làm đúng

**Ô 4 — tuyệt đối KHÔNG hiện `0đ`.** Chưa có API app lương thì phải hiện **"Chưa đấu nối app lương"**. Hiện `0đ` là nói với NV *"tháng này anh không được ứng đồng nào"* — sai sự thật và đúng cái bẫy "không có tiền ≠ số 0" đã dính 2 lần. Khi nào đấu nối: đọc qua **service endpoint**, App Report **không tự tính số ứng**.

**Ô 2 — tổng gốc `null` thì ẩn ô.** Không được lấy `null` làm 0 rồi hiện *"sau phạt = −2.400.000đ"*.

**Ô 3 — không để trống 2/3 số tháng.** Tháng 7, 8 hiện *"Chốt vào cuối quý (T9)"*; tháng 9 mới ra số.

### Màu — dùng lại, đừng chế mới
`.employee-cost-tone-penalty` đã có trong `styles.css:2026`, đỏ, chữ trắng, **đối nghịch đúng** với ô thưởng xanh lá. Chỉ cần thêm 1–2 biến thể nhạt cho ô 3 và ô 2.

**Không được chỉ dùng màu để phân biệt.** Người mù màu / in đen trắng vẫn phải đọc được: số phạt luôn có **dấu −** và nhãn chữ **"Phạt"**.

---

## 6. Quyền — CEO chốt: TẤT CẢ NV được xem

Đảo ngược chốt "chỉ báo CEO" lúc sáng. Nay:

1. NV xem được **phạt của chính mình** + **công thức** trong self-view chi phí. Vẫn **self-scoped**: `auth.scopeOf(session)` giữ nguyên, NV **không** thấy phạt của người khác, không thấy tổng phạt toàn công ty.
2. Ô KPI + `formulaText` trả cho cả session NV.
3. Màn "Tất cả NV" (CEO) hiện thêm cột phạt — **chỉ admin**, giữ nguyên khoá 3 lớp `EMPLOYEE_COST_ALL_FORBIDDEN` đang có.
4. Export: bản NV có phạt **của chính mình**; bản CEO có cột phạt toàn đội.

---

## 7. Thông báo — ‼ CẦN CEO CHỐT THÊM

**Mâu thuẫn cần giải:** NV nhìn thấy phạt trên app, nhưng tin nhắn chi phí (**12:30 thứ 7** và **17:30 ngày cuối tháng**) đang báo **tổng chi phí gốc**. Hai nơi ra hai số khác nhau ⇒ NV sẽ hỏi *"số nào đúng?"*.

Ba lựa chọn:
- **(a) — Claude khuyến nghị:** đợt này **không đụng tin nhắn**. App hiện phạt trước, chạy 1 kỳ cho chắc số, rồi mới đưa vào tin.
- (b) Thêm **1 dòng** "Trừ phạt dự kiến … · Còn lại …" vào tin cuối tháng.
- (c) Đổi hẳn số trong tin thành số sau phạt — **không nên**, mất số gốc để đối chiếu.

Cờ `PENALTY_NOTIFY` mặc định **tắt**, fail-closed như 3 luồng kia.

---

## 8. Version — bắt buộc

1. `employeeBonus.js`: `FORMULA_VERSION` **`v3.2` → `v3.3`**.
2. `config/employee_bonus_tiers.json`: `version` → `bonus-v3.3-penalty-c45-...`, `note` viết lại có phần phạt.
3. `config/bonus_formula_lock.json`: `version: "v3.3"` + `sourceHash` mới.
4. Ghi 1 mục `CHANGELOG.md`.

Tách file phạt mới (vd `src/penalty.js`) thì **phải thêm vào `FORMULA_SOURCES`** trong `bonusFormulaVersion.test.js`, nếu không sửa công thức phạt sẽ **lọt khoá**.

---

## 9. Test bắt buộc

**Tính đúng**
1. Đạt 78%, doanh thu 1,2 tỷ, C45 = 7.599.706đ ⇒ phạt **2.400.000đ**.
2. Đạt 60% ⇒ rate 0,3%; đạt 95% ⇒ phạt **0**.
3. Phạt vượt C45 ⇒ **kẹp đúng bằng C45**, `cappedByC45: true`.
4. Đạt 45% ⇒ `c45Dropped: true`, tổng tháng **giảm đúng bằng C45**, **Σ theo ngày vẫn = tổng tháng**.
5. Thưởng P1/P2 **không đổi một đồng** so với v3.2 ở mọi ca trên.
6. Xu: thiếu 2 Xu ⇒ 600.000đ; đã hạch toán 600.000đ ⇒ quý cộng thêm **0đ**.

**Mốc — bịt lỗ hổng**
7. Đúng **90,0%** ⇒ không phạt. Đúng **70,0%** ⇒ 0,2%. Đúng **50,0%** ⇒ 0,3% (**không** mất trắng). **49,99%** ⇒ mất trắng.
8. `89,5%` / `69,5%` / `50,5%` đều rơi đúng một bậc, **không ca nào không khớp bậc nào**.

**Fail-closed**
9. Chưa giao target ⇒ **không phạt**, `missing_target`.
10. `penaltyEnabled=false` ⇒ không phạt kể cả khi cấu hình có bậc.
11. Tiền C45 `null` ⇒ **không phạt** (`c45_unavailable`), **không** ra số âm.
12. Tổng chi phí `null` ⇒ ô "sau phạt" **ẩn**, không render.
13. Chưa đấu nối app lương ⇒ ô ứng hiện **"Chưa đấu nối"**, `assert.doesNotMatch(value, /^0/)`.

**Quyền**
14. NV chỉ thấy phạt **của mình**; ép `emp_code` người khác ⇒ **403**.
15. Màn "Tất cả NV" với session NV ⇒ vẫn **403** `EMPLOYEE_COST_ALL_FORBIDDEN`.

**Version**
16. Đổi bậc phạt / `perMissingXu` mà không nâng version ⇒ `bonusFormulaVersion.test.js` **đỏ**.

---

## 10. Thứ tự làm

| Đợt | Việc | Vì sao |
|---|---|---|
| **1** | Máy tính phạt target + phạt Xu (backend), **cờ TẮT** | có số để đối chiếu, chưa ai thấy |
| **2** | 4 ô KPI + `formulaText` + cột phạt | Sếp soi số thật trước khi công bố |
| **3** | Bật `penaltyEnabled`, công bố cho NV | sau khi Sếp gật |
| **4** | Đấu API app lương cho ô ứng lần 1 | phụ thuộc bên app lương |

**KHÔNG deploy trước 31/07** — ngày chốt tháng đang chạy tin chi phí + thưởng thật.
**KHÔNG bật cờ trong đợt deploy đầu.**

---

## 11. CEO còn phải chốt

1. **Xác nhận mốc liền mạch ở 2.1** (≥90 / 70–90 / 50–70 / <50), đặc biệt **đúng 50% thì trừ 0,3%, chưa mất trắng**.
2. **Tin nhắn** xử lý theo (a), (b) hay (c) ở mục 7.
3. **Mức 300.000đ/Xu** giữ hay đổi.
4. **Vách đá 50%:** ở 50,1% chỉ mất ~0,3% doanh thu; xuống 49,9% **mất trắng C45** (ví dụ 7,6 triệu). Chênh nhau rất lớn chỉ vì 0,2% target. Claude đề nghị **giữ đúng ý Sếp** nhưng app phải **cảnh báo sớm**: *"Còn thiếu … đồng nữa là mất trắng C45"* — để NV còn kịp chạy, chứ không phải cuối tháng mới biết.
