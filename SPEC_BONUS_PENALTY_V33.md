# SPEC — PHẠT (v3.3), đi kèm Thưởng v3.2

> **CEO chốt 2026-07-29.** Bản này thay thế bản nháp sáng cùng ngày (bậc âm nối tiếp P1) — CEO đã chốt cách tính **gọn hơn**: trừ thẳng vào **cột C45 "Lương tăng thêm"**.

| # | CEO chốt | Ghi chú |
|---|---|---|
| 1 | **≥90%** ⇒ **không phạt**, chạy công thức thưởng · **70–89%** ⇒ trừ **0,2%** tại C45 · **51–69%** ⇒ trừ **0,3%** · **≤50%** ⇒ **mất trắng C45** (không tính vào chi phí tháng) | thay cho bậc âm |
| 2 | Trần tiền phạt: **theo ý số 1** ⇒ trần chính là **số tiền C45** | không trừ quá thành âm |
| 3 | **TẤT CẢ nhân viên** được nhìn thấy **số tiền phạt + công thức tính** | **đảo ngược** chốt "chỉ báo CEO" lúc sáng |
| 4 | Thêm **đúng 4 ô KPI** trong mục "quyền quản trị tự xem chi phí", màu **đối nghịch** với ô hiện có | xem mục 5 |
| 5 | **T07.2026 CHỈ CẢNH BÁO** — công thức phạt **bắt đầu áp dụng 01/08/2026**. Cài sẵn trong cấu hình, **tự bật theo ngày**, không ai phải nhớ bấm | xem mục **2.0** |
| 6 | **Chưa đụng tin nhắn** đợt này — app chạy đúng 1 kỳ rồi mới đưa phạt vào tin | mục 7, phương án (a) |

Người triển khai: **bot server**. Claude: kiến trúc + review.
Ship xong nâng `FORMULA_VERSION` **v3.2 → v3.3** (mục 8).

---

## 0. Hiện trạng — đọc trước khi code

**a) C45 là gì.** `config/employee_cost_templates.json`: `"c45": "C45 Lương tăng thêm (%)"`. Là **1 trong 4 cột chi phí THÁNG** (`c36, c41, c43, c45`); `c44` "Lương cuối năm" nằm ngoài tổng tháng. Số thật đã nghiệm thu (T06 DN001): `c36 750.400 + c41 7.995.379 + c43 26.489.506 + c45 7.599.706 = 42.834.991đ`.

⇒ Ý CEO rất rõ: **không đạt target thì bị cắt vào phần "lương tăng thêm"**; đạt **bằng hoặc dưới 50%** thì **C45 không cộng vào tổng chi phí nhận nữa** (mất trắng phần đó).

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

### 2.0 ‼ LỊCH ÁP DỤNG — tự bật theo ngày, KHÔNG dùng nút bấm tay

> **CEO chốt 29/07:** *"Tháng 07.2026 chỉ đưa vào cảnh báo. Công thức tính phạt sẽ kích hoạt vào Tháng 08.2026, ngày bắt đầu áp dụng là 01/08/2026. Trong cài đặt em cũng cài đặt rõ luôn, kẻo hôm sau lại quên kích hoạt."*

**Đây là yêu cầu chống-quên, phải làm bằng NGÀY chứ không bằng cờ bật tay.** Một cái cờ `penaltyEnabled=false` chờ người vào bấm là **chắc chắn có ngày quên** — hoặc quên bật (phạt không chạy, NV tưởng thoát), hoặc bấm nhầm sớm (trừ tiền oan tháng 7).

```json
"penaltyEffectiveFrom": "2026-08-01",
"penaltyWarnFrom":      "2026-07-01",
"penaltyEnabled":       true
```

| Kỳ | Chế độ | Có tính số? | Có TRỪ tiền? | Có cảnh báo? |
|---|---|---|---|---|
| Trước T07.2026 | `off` | không | không | không |
| **T07.2026** | **`warn_only`** | **có** (để đối chiếu) | **KHÔNG** | **CÓ** |
| **Từ 01/08/2026** | **`enforced`** | có | **CÓ** | có |

**Quy tắc quyết định — bot làm đúng thứ tự này:**
```js
if (penaltyEnabled !== true)             mode = 'off';        // công tắc TẮT KHẨN CẤP
else if (ngàyKỳ >= penaltyEffectiveFrom) mode = 'enforced';
else if (ngàyKỳ >= penaltyWarnFrom)      mode = 'warn_only';
else                                     mode = 'off';
```

**`penaltyEnabled` chỉ để TẮT KHẨN CẤP, không phải để bật.** Mặc định `true`. Deploy vào tháng 7 vẫn an toàn **tự động** vì lịch chặn, không phụ thuộc ai nhớ gì.

**Ở `warn_only` (tháng 7):**
- `penalty.total` vẫn tính ra số thật, nhưng **`appliedAmount = 0`** — tổng chi phí **không đổi một đồng**.
- Ô "Tổng chi phí sau phạt" hiện **đúng bằng** tổng gốc, kèm nhãn.
- Nhãn bắt buộc, hiện ở cả ô KPI lẫn hộp cách tính:
  > **T07.2026 CHỈ CẢNH BÁO — chưa trừ tiền. Từ 01/08/2026 mới áp dụng trừ thật.**
- Nói rõ số "nếu áp dụng thì sẽ mất bao nhiêu" để NV **có một tháng tập dượt**.

**Đây là điểm mạnh nhất của cách làm này:** NV có nguyên tháng 7 nhìn thấy mình *sẽ* mất bao nhiêu mà chưa mất đồng nào. Đến 01/08 không ai kêu bị đánh úp.

**Đổi 3 giá trị lịch trên = đổi cách tính thưởng/phạt ⇒ PHẢI nâng version** (mục 8). Chúng nằm trong vân tay `bonus_formula_lock.json`.

### 2.1 Bậc phạt

| % đạt target tháng | Xử lý | `penaltyTier` |
|---|---|---|
| **pct ≥ 90%** | **không phạt** — chạy đúng công thức thưởng v3.2 | `none` |
| **70% ≤ pct < 90%** | trừ **0,2%** vào C45 | `t70_90` |
| **50% < pct < 70%** | trừ **0,3%** vào C45 | `t50_70` |
| **pct ≤ 50%** | **mất trắng C45** — loại toàn bộ khỏi chi phí tháng | `drop_c45` |

> **Mốc đã CEO chốt lại 29/07 (chiều).** CEO nói nguyên văn: *"target từ đủ 90% trở lên là tính theo công thức thưởng rồi · phạt khi chỉ đủ 70–89 là 0,2% · phạt khi 51–69 là 0,3% · phạt khi chỉ bằng 50% trở xuống thì mất trắng"*.
> Bảng trên là bản **liền mạch, không còn khe hở** — mọi giá trị `pct` đều rơi đúng **một** bậc:
> - **Đúng 90,0%** ⇒ không phạt (CEO: "từ **đủ** 90% trở lên").
> - **Đúng 70,0%** ⇒ bậc 0,2%.
> - **Đúng 50,0%** ⇒ **mất trắng** (CEO: "chỉ bằng 50% **trở xuống**"). ‼ Khác bản sáng — bản sáng cho 50,0% vào bậc 0,3%, nay **đã sửa**.
> - `89,5%` ⇒ 0,2% · `69,5%` ⇒ 0,3% · `50,5%` ⇒ 0,3%.

> **"Mất trắng (0,5%)" nghĩa là gì — CEO đã chốt:** **mất trắng toàn bộ C45**, tức đúng số tiền C45 của người đó (ví dụ 7.599.706đ), mỗi người một khác vì `%C45` từng mặt hàng khác nhau. **Không phải** "trừ 0,5% doanh thu". Con số *0,5%* chỉ là cách CEO gọi tên bậc thứ 3 nối tiếp 0,2% – 0,3%.

### 2.2 Số tiền phạt

```
phạtTarget = min( rate × doanhThuTrướcVAT , tiềnC45 )      với rate = 0,2% hoặc 0,3%
```

Nếu `pct ≤ 50%`: `phạtTarget = tiềnC45` (loại trọn cột — **mất trắng**, không nhân tỷ lệ nào).

**Vì sao nhân với doanh thu chứ không nhân với C45:** C45 vốn được tính `doanh thu × %C45`. "Trừ 0,2% tại cột C45" = hạ tỷ lệ C45 đi 0,2 điểm ⇒ tiền giảm đúng bằng `0,2% × doanh thu`. **Hai cách đọc ra cùng một số.**

**Trần = tiền C45** (CEO chốt ý 2). Không bao giờ để C45 âm.

> **Chi tiết kỹ thuật cho bot:** kẹp ở **mức tổng**, không kẹp từng dòng. Hai cách chỉ lệch khi có dòng `%C45 < 0,2%`; kẹp tổng cho **một con số CEO đối chiếu được bằng tay**. Nếu sau này cần kẹp từng dòng thì phải nâng version.

### 2.3 Fail-closed

| Tình huống | Kết quả | `penaltyStatus` |
|---|---|---|
| `penaltyEnabled !== true` (tắt khẩn cấp) | không phạt | `disabled` |
| Kỳ **trước** `penaltyEffectiveFrom` (vd T07.2026) | tính số nhưng **KHÔNG trừ**, `appliedAmount = 0` | `warn_only` |
| Chưa giao target (`target <= 0` / `pct == null`) | **không phạt** | `missing_target` |
| Tiền C45 chưa tính được (coverage thấp ⇒ `null`) | **không phạt** | `c45_unavailable` |
| Chưa cấu hình bậc phạt | không phạt | `unconfigured` |
| Kỳ chưa kết thúc | có tính, **nhãn TẠM TÍNH** | `provisional` |
| Kỳ đã đóng | số chốt | `final` |

**`c45_unavailable` là bẫy quan trọng nhất.** Coverage thấp thì tổng chi phí bị khoá `null` (fail-closed đang có). `Number(null) === 0` ⇒ trần phạt thành 0 ⇒ *may là không phạt*, nhưng nếu code đi nhánh khác thì thành "phạt trọn 0đ" hoặc "còn lại = số âm". Đã dính bẫy này **2 lần trong tháng 7**. Bắt buộc kiểm `null` tường minh, không dùng `|| 0`.

### 2.4 Rủi ro kỹ thuật khi `pct ≤ 50%` — bot đọc kỹ

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
  "mode": "enforced",
  "effectiveFrom": "2026-08-01",
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
  "appliedAmount": 2400000,
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

## 5B. ‼ CẢNH BÁO SỚM — phần QUAN TRỌNG NHẤT của module này

> **CEO chốt 29/07:** *"chỉ vì con số 50,5 và con số 50,0 mà mất tiền triệu của nhân viên thì đau lắm. Spec nhấn mạnh là **bạn có thể mất trắng số tiền tại cột C45 là … nếu bạn không cố gắng thêm giá trị đơn hàng là … (trước VAT)**. Như vậy NV sẽ khâm phục và khẩu phục."*

Phạt mà không báo trước thì chỉ làm NV ức chế, không cải thiện được gì. Cảnh báo sớm biến ô phạt từ **hình phạt** thành **động lực**. Đây **không phải** tính năng phụ — làm phạt mà thiếu phần này là **làm thiếu**.

### 5B.1 Câu chữ chuẩn (backend sinh, không để frontend tự ghép)

Mốc **mất trắng** — nặng nhất, ưu tiên hiện:
```
⚠ Bạn có thể MẤT TRẮNG 7.599.706đ ở cột C45 (Lương tăng thêm)
   nếu không tăng thêm 31.000.000đ giá trị đơn hàng (trước VAT) trong tháng này.
   Hiện đạt 48,2% target — cần vượt mốc 50%.
```

Mốc **giảm bậc phạt**:
```
⚠ Đang bị trừ 0,3% (2.850.000đ) ở cột C45.
   Thêm 96.000.000đ giá trị đơn hàng (trước VAT) là xuống còn 0,2% — đỡ 950.000đ.
   Hiện đạt 62,1% target — cần đạt mốc 70%.
```

Mốc **thoát phạt hoàn toàn**:
```
✅ Thêm 142.000.000đ giá trị đơn hàng (trước VAT) là HẾT PHẠT và bắt đầu được thưởng.
   Hiện đạt 81,5% target — cần đạt mốc 90%.
```

Ba thành phần **bắt buộc có đủ**, thiếu cái nào là chưa đạt yêu cầu CEO:
1. **Số tiền đang bị đe doạ** (mất trắng bao nhiêu / đang bị trừ bao nhiêu).
2. **Số tiền doanh thu cần thêm**, ghi rõ **(trước VAT)**.
3. **Mốc % phải chạm** và **% hiện tại**.

### 5B.2 Cách tính khoảng cách — 2 cái bẫy

```
gapTớiMốc = target × mốc% − doanhThuHiệnTại (trước VAT)
```

**‼ Bẫy 1 — mốc 50% phải VƯỢT, hai mốc kia chỉ cần CHẠM.**
Luật là `pct ≤ 50%` mất trắng, nên đạt **đúng** 50,0% **vẫn mất trắng**. Ba mốc **không đối xứng**:

| Mốc | Điều kiện thoát | Cách tính gap |
|---|---|---|
| **50%** | phải **> 50%** | `ceil1k(target × 0,5 − achieved)` **+ 1.000đ đệm** |
| **70%** | chỉ cần **≥ 70%** | `ceil1k(target × 0,7 − achieved)` |
| **90%** | chỉ cần **≥ 90%** | `ceil1k(target × 0,9 − achieved)` |

Đây **đúng** chỗ CEO lo (50,0 và 50,5). Bảo NV "thêm 30.000.000đ là thoát" mà chạy xong đúng 50,0% vẫn mất trắng thì **hỏng hết niềm tin**. Đệm 1.000đ là rẻ, mất trắng 7,6 triệu là đắt.

**‼ Bẫy 2 — LUÔN làm tròn LÊN, tuyệt đối không làm tròn xuống.**
`ceil1k` = làm tròn **lên** đến nghìn. Làm tròn xuống ⇒ NV chạy đúng con số app bảo mà **vẫn thiếu vài trăm đồng** ⇒ vẫn mất tiền. Làm tròn lên thì cùng lắm NV vượt dư một chút — không ai thiệt.

### 5B.3 Chọn mốc nào để hiện

Hiện **mốc kế tiếp gần nhất** theo % hiện tại, không phải luôn hiện mốc 90%:

| Đang ở | Mốc hiện chính | Có thể hiện thêm |
|---|---|---|
| `pct ≤ 50%` | **50%** (thoát mất trắng) | 70%, 90% |
| `50% < pct < 70%` | **70%** (0,3% → 0,2%) | 90% |
| `70% ≤ pct < 90%` | **90%** (hết phạt) | — |
| `pct ≥ 90%` | **không hiện cảnh báo phạt** | *(tuỳ chọn: thêm bao nhiêu để lên bậc thưởng cao hơn)* |

Mốc gần nhất là mốc NV **với tới được**. Bảo người đang ở 45% rằng "thêm 500 triệu là hết phạt" thì họ bỏ cuộc luôn — phải cho họ thấy **mốc gần nhất cứu được nhiều tiền nhất trước**.

### 5B.3b Câu chữ tháng 7 (`warn_only`) — phải nói rõ CHƯA TRỪ

Tháng 7 số phạt tính ra nhưng **chưa trừ đồng nào**. Cảnh báo phải nói đúng điều đó, nếu không NV tưởng đã mất tiền rồi:

```
ℹ T07.2026 — THÁNG CHẠY THỬ, CHƯA TRỪ TIỀN.
   Nếu áp dụng, bạn sẽ MẤT TRẮNG 7.599.706đ ở cột C45.
   Từ 01/08/2026 mới trừ thật.
   Muốn thoát: tăng thêm 31.000.000đ giá trị đơn hàng (trước VAT). Hiện đạt 48,2%.
```

**Cấm** dùng câu ở 5B.1 (thể đe doạ "bạn có thể mất trắng…") cho kỳ `warn_only` mà không kèm chữ **"chưa trừ tiền"** — sẽ có NV tưởng tháng 7 đã bị trừ.

### 5B.4 Fail-closed của cảnh báo

| Tình huống | Xử lý |
|---|---|
| Chưa giao target | **không hiện cảnh báo** — không có mốc để so |
| Tiền C45 `null` (coverage thấp) | hiện **mốc doanh thu**, **KHÔNG** nói số tiền mất (chưa biết thì không được bịa) |
| `penaltyEnabled = false` | không hiện |
| Kỳ `warn_only` (T07.2026) | **vẫn hiện**, dùng câu chữ ở **5B.3b** — đây chính là mục đích của tháng chạy thử |
| **Kỳ đã đóng** (tháng đã hết) | **đổi câu chữ** sang thể đã rồi: *"Tháng này đạt 48,2% — C45 7.599.706đ không được tính vào chi phí tháng."* **Cấm** dùng *"nếu không cố gắng…"* khi tháng đã hết — vô nghĩa và phản cảm. |

### 5B.5 Hiện ở đâu

1. Dòng `sub` của **ô KPI "Phạt dự kiến"** — rút gọn 1 dòng.
2. **Đầy đủ** trong hộp bấm-bung "cách tính phạt" (song song hộp cách tính thưởng đã có).
3. Trường riêng trong payload:
```json
"warning": {
  "kind": "drop_c45",
  "nextThresholdPct": 50,
  "mustExceed": true,
  "revenueGap": 31000000,
  "moneyAtRisk": 7599706,
  "text": "Bạn có thể MẤT TRẮNG 7.599.706đ ở cột C45 (Lương tăng thêm) nếu không tăng thêm 31.000.000đ giá trị đơn hàng (trước VAT) trong tháng này. Hiện đạt 48,2% target — cần vượt mốc 50%."
}
```
4. **Tin nhắn Telegram: CHƯA** (mục 7 đang chờ CEO chốt). Khi mở, đây là nội dung **đáng gửi nhất** trong cả module phạt.

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

**CEO chốt 29/07: theo phương án (a) — ĐỢT NÀY KHÔNG ĐỤNG TIN NHẮN.**

- Tin **07:30 hằng ngày**, **12:30 thứ 7**, **17:30 / 17:40 ngày cuối tháng**: **giữ nguyên 100%**, không thêm chữ nào về phạt.
- Phạt chỉ hiện **trên app**. Chạy đúng 1 kỳ, đối chiếu xong, CEO gật thì mới bàn đưa vào tin.
- Cờ `PENALTY_NOTIFY` **tạo sẵn, mặc định TẮT**, fail-closed như 3 luồng kia. Có cờ để sau này khỏi sửa code, **không phải để bật bây giờ**.

*(Đã cân nhắc và loại: (b) thêm 1 dòng vào tin cuối tháng — sớm quá, tháng 7 còn chưa áp dụng; (c) đổi hẳn số trong tin thành số sau phạt — mất số gốc để đối chiếu.)*

**Lưu ý cho bot:** T07.2026 đang ở `warn_only`, số trên app **bằng đúng** số trong tin (chưa trừ gì) ⇒ **tháng 7 không hề có mâu thuẫn**. Mâu thuẫn chỉ phát sinh từ 01/08 — đó là lúc phải quay lại quyết định mục này.

---

## 8. Version — bắt buộc

1. `employeeBonus.js`: `FORMULA_VERSION` **`v3.2` → `v3.3`**.
2. `config/employee_bonus_tiers.json`: `version` → `bonus-v3.3-penalty-c45-...`, `note` viết lại có phần phạt.
3. `config/bonus_formula_lock.json`: `version: "v3.3"` + `sourceHash` mới.
4. Ghi 1 mục `CHANGELOG.md`.

Tách file phạt mới (vd `src/penalty.js`) thì **phải thêm vào `FORMULA_SOURCES`** trong `bonusFormulaVersion.test.js`, nếu không sửa công thức phạt sẽ **lọt khoá**.

**Bổ sung `FORMULA_CONFIG_KEYS`** trong `bonusFormulaVersion.test.js` — nếu không, sửa bậc phạt hoặc **đổi ngày áp dụng** sẽ không làm test đỏ:
```js
'penaltyTiers', 'penaltyEffectiveFrom', 'penaltyWarnFrom', 'penaltyEnabled', 'xuPenalty'
```
**Ngày áp dụng nằm trong khoá version là có chủ ý:** dời ngày phạt = đổi thời điểm NV bị trừ tiền — đó là thay đổi công thức, phải để lại dấu vết version + CHANGELOG, không được sửa lén.

---

## 9. Test bắt buộc

**Tính đúng**
1. Đạt 78%, doanh thu 1,2 tỷ, C45 = 7.599.706đ ⇒ phạt **2.400.000đ**.
2. Đạt 60% ⇒ rate 0,3%; đạt 95% ⇒ phạt **0**.
3. Phạt vượt C45 ⇒ **kẹp đúng bằng C45**, `cappedByC45: true`.
4. Đạt 45% ⇒ `c45Dropped: true`, tổng tháng **giảm đúng bằng C45**, **Σ theo ngày vẫn = tổng tháng**.
5. Thưởng P1/P2 **không đổi một đồng** so với v3.2 ở mọi ca trên.
6. Xu: thiếu 2 Xu ⇒ 600.000đ; đã hạch toán 600.000đ ⇒ quý cộng thêm **0đ**.

**Mốc — không còn khe hở**
7. Đúng **90,0%** ⇒ **không phạt** (chạy công thức thưởng). Đúng **70,0%** ⇒ 0,2%. Đúng **50,0%** ⇒ **mất trắng C45**. **50,01%** ⇒ 0,3%.
8. `89,5%` / `69,5%` / `50,5%` đều rơi đúng một bậc; quét `pct` từ 0 đến 150 bước 0,1 ⇒ **không giá trị nào không khớp bậc nào**.
9. `pct ≤ 50%` ⇒ **tổng chi phí nhận KHÔNG còn C45**: `tổngSauPhạt = tổngGốc − tiềnC45`, và `c45Dropped: true`.

**‼ Cảnh báo sớm (mục 5B) — CEO nhấn mạnh, test kỹ nhất**
10. **Chạy đúng số app bảo thì phải THOÁT.** Với mọi `pct` từ 0 đến 89,9 bước 0,1: lấy `revenueGap` app trả, cộng vào `achieved`, tính lại bậc ⇒ **phải sang bậc tốt hơn**. Đây là ca chống "bảo thêm 30 triệu là thoát, chạy xong vẫn mất trắng".
11. **Mốc 50% phải VƯỢT:** `target = 1 tỷ`, `achieved = 480tr` ⇒ `revenueGap` cộng vào phải cho `pct > 50`, **không** phải `= 50`. Kiểm bằng `assert.ok(newPct > 50)`, không phải `>=`.
12. **Làm tròn LÊN:** gap thô `30.000.001đ` ⇒ hiện `30.001.000đ`, **không** phải `30.000.000đ`. `assert.ok(gap >= gapThô)` cho 200 giá trị ngẫu nhiên có seed cố định.
13. **Chọn đúng mốc gần nhất:** `pct=45` ⇒ mốc chính **50**; `pct=62` ⇒ **70**; `pct=81` ⇒ **90**; `pct=95` ⇒ **không có cảnh báo phạt**.
14. **Câu chữ đủ 3 phần bắt buộc:** `text` phải chứa số tiền C45, số doanh thu cần thêm, chữ **"(trước VAT)"**, mốc % và % hiện tại. `assert.match(text, /trước VAT/)`.
15. Chưa giao target ⇒ **không có** `warning`.
16. C45 `null` ⇒ `warning` có mốc doanh thu nhưng `moneyAtRisk == null` và `text` **không chứa số tiền mất**.
17. **Kỳ đã đóng** ⇒ `text` **không** chứa "nếu không" / "cố gắng"; phải là thể đã rồi. `assert.doesNotMatch(text, /nếu không|cố gắng/)`.

**‼ Lịch áp dụng (mục 2.0) — khoá chống-quên**
18. **Kỳ T07.2026** ⇒ `mode: 'warn_only'`, `appliedAmount === 0`, **tổng chi phí bằng ĐÚNG tổng gốc** (`assert.equal(tổngSauPhạt, tổngGốc)`), nhưng `warning` **vẫn có**.
19. **Kỳ T08.2026** ⇒ `mode: 'enforced'`, `appliedAmount === total`, tổng chi phí **giảm đúng bằng** số phạt.
20. **Biên ngày:** `2026-07-31` ⇒ `warn_only`; `2026-08-01` ⇒ `enforced`. Không lệch một ngày.
21. **Không phụ thuộc ngày chạy máy:** chạy test với giờ hệ thống giả lập là 05/07, 31/07, 01/08, 20/09 ⇒ kết quả cho **kỳ T08** luôn là `enforced`. Chế độ tính theo **kỳ dữ liệu**, không theo ngày bấm nút.
22. `penaltyEnabled=false` ⇒ `mode: 'off'` **kể cả sau 01/08** (công tắc tắt khẩn cấp thắng lịch).
23. Nhãn `warn_only` phải chứa **"chưa trừ tiền"** và **"01/08/2026"**: `assert.match(label, /chưa trừ tiền/)`.

**Tin nhắn — khoá phương án (a)**
24. Không tin nào cho NV chứa chữ về phạt: đọc mã `telegram-bot.js` + `salesReport.js` ⇒ `assert.doesNotMatch(SRC, /phạt|penalty/i)` trong các hàm dựng tin NV.
25. `PENALTY_NOTIFY` mặc định **tắt**, fail-closed giống 3 luồng kia.

**Fail-closed**
26. Chưa giao target ⇒ **không phạt**, `missing_target`.
27. Tiền C45 `null` ⇒ **không phạt** (`c45_unavailable`), **không** ra số âm.
28. Tổng chi phí `null` ⇒ ô "sau phạt" **ẩn**, không render.
29. Chưa đấu nối app lương ⇒ ô ứng hiện **"Chưa đấu nối"**, `assert.doesNotMatch(value, /^0/)`.

**Quyền**
30. NV chỉ thấy phạt **của mình**; ép `emp_code` người khác ⇒ **403**.
31. Màn "Tất cả NV" với session NV ⇒ vẫn **403** `EMPLOYEE_COST_ALL_FORBIDDEN`.

**Version**
32. Đổi bậc phạt / `perMissingXu` / **3 giá trị lịch ở 2.0** mà không nâng version ⇒ `bonusFormulaVersion.test.js` **đỏ**.

---

## 10. Thứ tự làm

| Đợt | Việc | Khi nào |
|---|---|---|
| **1** | Máy tính phạt target + phạt Xu + **lịch áp dụng (2.0)** | ngay, deploy **sau 31/07** |
| **2** | 4 ô KPI + `formulaText` + **cảnh báo sớm (5B)** + cột phạt | cùng đợt 1 hoặc ngay sau. **Không tách 5B ra sau** — công bố phạt mà chưa có cảnh báo là NV chỉ thấy bị phạt |
| **3** | *(không có bước "bật cờ")* — **tự chuyển sang trừ thật lúc 00:00 ngày 01/08/2026** | tự động |
| **4** | Đấu API app lương cho ô ứng lần 1 | khi app lương sẵn sàng |

**KHÔNG deploy trước 31/07** — ngày chốt tháng đang chạy tin chi phí + thưởng thật.

**Không còn bước "nhớ bật cờ".** Lịch ở mục 2.0 lo việc đó. Deploy ngày 01/08 hay 15/08 đều ra kết quả **giống hệt** cho kỳ T08 — không phụ thuộc ai bấm gì lúc nào.

---

## 11. Trạng thái chốt — ‼ ĐÃ ĐỦ, BOT LÀM ĐƯỢC NGAY

1. ~~Xác nhận mốc~~ — **XONG 29/07 chiều.** Mốc ở 2.1 là bản CEO chốt: ≥90% không phạt · 70–90% 0,2% · 50–70% 0,3% · **≤50% mất trắng C45**. "Mất trắng (0,5%)" = **loại trọn C45**, không phải trừ 0,5% doanh thu.
2. ~~Tin nhắn~~ — **XONG 29/07.** CEO chốt **phương án (a)**: đợt này không đụng tin nhắn, app chạy đúng 1 kỳ rồi mới bàn.
3. ~~Mức 300.000đ/Xu~~ — **XONG 29/07. CEO chốt GIỮ NGUYÊN 300.000đ/Xu.** Không đổi `PENALTY_PER_MISSING_XU`; đưa vào `xuPenalty.perMissingXu = 300000` để sau này chỉnh được qua đúng luồng preview→save, nhưng **giá trị hiện tại giữ y nguyên**.
4. ~~Vách đá 50%~~ — **XONG 29/07.** CEO chốt giữ nguyên luật, **bắt buộc có cảnh báo sớm** (mục **5B**): *"bạn có thể mất trắng số tiền tại cột C45 là … nếu bạn không cố gắng thêm giá trị đơn hàng là … (trước VAT)"*. Đã viết thành spec đầy đủ kèm 8 ca test.

---

## 12. Chốt cuối — không còn gì chờ CEO

**Cả 4 điểm treo đã đóng ngày 29/07.** Bot **không cần hỏi thêm gì**, làm theo spec này là đủ:

| # | Việc | Chốt |
|---|---|---|
| 1 | Mốc bậc phạt | ≥90% không phạt · 70–90% 0,2% · 50–70% 0,3% · **≤50% mất trắng C45** |
| 2 | Tin nhắn | **KHÔNG đụng** — giữ nguyên 4 khung giờ đang chạy |
| 3 | Phạt thiếu Xu | **GIỮ NGUYÊN 300.000đ/Xu** |
| 4 | Vách đá 50% | Giữ luật, **bắt buộc có cảnh báo sớm** (mục 5B) |

**Ba thứ tuyệt đối không được làm sai:**
1. **Mốc 50% phải VƯỢT mới thoát** — gap có đệm 1.000đ, làm tròn LÊN (5B.2).
2. **T07.2026 không trừ một đồng nào** — `warn_only`, tự chuyển `enforced` lúc 01/08/2026 (2.0).
3. **P1/P2 không sửa một dòng** — phạt là trường riêng.

Ship = nâng `FORMULA_VERSION` **v3.2 → v3.3** + cập nhật `bonus_formula_lock.json`, nếu không `bonusFormulaVersion.test.js` đỏ.
