# SPEC — PHẠT (v3.3), đi kèm Thưởng v3.2

> **CEO chốt 2026-07-29:** "Đã có thưởng là phải có phạt."
> Bốn quyết định của CEO trong phiên chốt:
> 1. **Căn cứ phạt:** không đạt target tháng **+** thiếu Xu (loại thiếu Xu đã có sẵn máy tính).
> 2. **Cách tính khi không đạt target:** **bậc âm nối tiếp P1** — CEO tự nhập mốc và % trên màn hình.
> 3. **Tiền phạt:** trừ vào **tổng chi phí bán hàng NV nhận**.
> 4. **Thông báo:** **chỉ báo CEO, KHÔNG báo NV.**

Người triển khai: **bot server**. Claude: kiến trúc + review.
Ship xong phải nâng `FORMULA_VERSION` **v3.2 → v3.3** (xem mục 8).

---

## 0. Hiện trạng — đọc trước khi code

**Phạt thiếu Xu ĐÃ CÓ SẴN và đã chạy đúng**, ở `server/src/xuPolicy.js`:
- `PENALTY_PER_MISSING_XU = 300000` (2 Xu thiếu = 600.000đ).
- `buildCheckpoint()` tính đủ: thiếu Xu **tháng** (tạm tính) và **quý** (quyết toán), có `prior_booked` để **đối trừ số Finance đã hạch toán**, cờ `needs_finance_reconciliation`, cờ `final`.
- **Nhưng nó đang nằm im:** chỉ được gọi trong `dormantService.js` (luồng "AI canh cửa" khách ngủ đông). **Không có route, không lên màn hình nào, không có trong thông báo.**

⇒ Phần Xu **KHÔNG viết lại**. Chỉ **phơi ra** và **gộp** vào khối phạt. Viết lại = tự tạo nguồn thứ hai cho cùng một con số.

Phạt theo target thì **chưa có gì** — phải làm mới.

---

## 1. Nguyên tắc bất di bất dịch của phần phạt

1. **P1 KHÔNG ĐƯỢC SỬA.** `baseAmount` giữ nguyên ý nghĩa "tiền thưởng", **luôn ≥ 0**. Bậc âm KHÔNG được cộng vào `baseAmount`.
2. **Phạt là trường RIÊNG** (`penaltyAmount`), **không bao giờ trộn vào `amount`**. Đây là rào chắn kỹ thuật để phạt không thể rò sang màn hình/tin nhắn của NV — CEO đã chốt chỉ báo CEO. Trộn chung thì mọi chỗ đang hiển thị `amount` sẽ tự động lộ phạt.
3. **Fail-closed = KHÔNG PHẠT.** Thiếu dữ liệu, chưa giao target, nguồn hỏng ⇒ **không phạt**, không phải "phạt 0đ". Trạng thái phải nói rõ *vì sao không phạt*.
4. **KHÔNG ghi đè số DataHub.** Chi phí bán hàng là SSOT của DataHub. App Report hiển thị **3 dòng tách bạch**, không sửa số gốc (mục 6).
5. **Chưa phải payroll.** Nhãn bắt buộc trên mọi chỗ hiện số phạt: **"Dự kiến/tham khảo — chưa trừ lương"**.
6. **Đổi cách tính phạt ⇒ nâng version**, y như thưởng (`CLAUDE.md` mục 5). Phạt nằm trong vân tay của `bonus_formula_lock.json`.

---

## 2. Phạt theo target — bậc âm nối tiếp P1

### 2.1 Dùng chung bảng bậc, cho phép giá trị âm

CEO chốt "bậc âm nối tiếp P1" ⇒ **dùng đúng `baseTiers` đang có**, không dựng bảng thứ hai. CEO nhìn **một bảng duy nhất** trên màn hình: bậc dương = thưởng, bậc âm = phạt.

Ví dụ CEO có thể cấu hình (số minh hoạ, CEO tự chốt số thật):

| Từ % | Đến % | Rate % | Nghĩa |
|---|---|---|---|
| 0 | 80 | **−0,10** | phạt |
| 80 | 90 | **−0,05** | phạt |
| 90 | 100 | 0,10 | thưởng |
| 100 | 110 | 0,15 | thưởng |
| 110 | 130 | 0,18 | thưởng |
| 130 | ∞ | 0,25 | thưởng |

Các bậc rời nhau nên **không bao giờ vừa thưởng vừa phạt** — tự động loại trừ.

### 2.2 Sửa `validateConfig` (`server/src/employeeBonus.js:56-59`)

Hiện đang chặn cứng `bonusPct < 0`. Đổi thành:

```js
const MAX_PENALTY_RATE_PCT = 0.25;   // đối xứng MAX_BASE_RATE_PCT
// hợp lệ khi: -MAX_PENALTY_RATE_PCT <= bonusPct <= MAX_BASE_RATE_PCT
```

- Vẫn chặn `fromPct < 0`, vẫn chặn bậc chồng lấn/hở như hiện tại.
- **Bậc âm chỉ được nằm dưới bậc dương đầu tiên.** Nếu cấu hình có bậc âm nằm TRÊN một bậc dương (vd 0%→+0,1 rồi 90%→−0,05) thì **từ chối**, mã lỗi `PENALTY_TIER_ORDER_INVALID`. Ngăn nhập nhầm dấu.
- Rate âm mà `penaltyEnabled !== true` ⇒ **từ chối lưu**, mã lỗi `PENALTY_DISABLED`. Không cho bật phạt bằng đường vòng.

### 2.3 Tính trong `periodBonus()` (`employeeBonus.js:320`)

Chèn ngay sau khi tìm được `tier`, **trước** khi tính `baseAmount`:

```js
const rate = tier?.bonusPct || 0;
if (rate < 0) {
  // Bậc âm: KHÔNG cộng vào thưởng. Ra một trường riêng, số DƯƠNG = tiền bị trừ.
  penaltyAmount += Math.round(revenue * Math.abs(rate) / 100);
} else {
  baseAmount += Math.round(revenue * rate / 100);
}
```

Áp dụng cho **cả hai nhánh** (nhánh có `configResolver && segments.length` và nhánh thường) — nhánh thường dùng `achieved` thay `revenue`.

**Cơ số phạt = `achieved` (doanh thu trước VAT)** — đúng `BASE` đang dùng cho thưởng. Một công thức, một cơ số.

### 2.4 Kẹp trần tiền phạt

Thêm `penaltyCapAmount` (số tiền tuyệt đối, `null` = không kẹp) vào config. Sau khi tính:

```js
if (penaltyCapAmount != null) penaltyAmount = Math.min(penaltyAmount, penaltyCapAmount);
```

**Vì sao bắt buộc có:** rate âm nhân doanh thu ⇒ NV doanh thu lớn mà hụt target sẽ ra số phạt rất lớn. Trần là phanh tay, phải có trước khi bật.

### 2.5 Fail-closed — các trường hợp KHÔNG phạt

| Tình huống | Kết quả | `penaltyStatus` |
|---|---|---|
| `penaltyEnabled !== true` | không phạt | `disabled` |
| Chưa giao target (`target <= 0` hoặc `pct == null`) | **không phạt** | `missing_target` |
| Config chưa cấu hình | không phạt | `unconfigured` |
| Không có bậc âm nào khớp | không phạt | `no_penalty_tier` |
| Kỳ chưa kết thúc | có tính, **gắn nhãn TẠM TÍNH** | `provisional` |
| Kỳ đã đóng | số chốt | `final` |

**Chưa giao target thì tuyệt đối không phạt.** Không có target = không có căn cứ. Phạt NV vì CEO chưa giao target là lỗi nặng nhất mà module này có thể gây ra.

Ai không có target (CTV, NV mới, người ngoài roster 21 mã) ⇒ tự động không bị phạt, không cần danh sách loại trừ riêng.

---

## 3. Phạt thiếu Xu — phơi cái đã có

1. Thêm hàm trong `xuPolicy.js` (hoặc module mỏng `penalty.js`) trả về khối chuẩn cho 1 NV / 1 kỳ, **gọi lại `buildCheckpoint()`**, không tính lại.
2. Giữ đúng **tháng = tạm tính, quý = quyết toán**, và giữ `prior_booked` để **không phạt hai lần**.
3. `perMissingXu` đưa vào `config/employee_bonus_tiers.json` (`xuPenalty.perMissingXu`, mặc định `300000`) để CEO chỉnh được qua đúng luồng preview→save đã có. Đổi số này = **đổi công thức** ⇒ nâng version.
4. `xuPenalty.enabled` mặc định **false**, bật có chủ đích.
5. Thiếu dữ liệu điểm/xu ⇒ `penaltyStatus: 'xu_source_unavailable'`, **không phạt**.

---

## 4. Gộp số

```
penaltyTotal = penaltyTarget + penaltyXu
```

Trả về kèm **tách dòng**, không chỉ tổng — CEO phải nhìn ra tiền phạt đến từ đâu:

```json
"penalty": {
  "enabled": true,
  "targetAmount": 0,
  "targetStatus": "missing_target",
  "xuAmount": 600000,
  "xuStatus": "provisional",
  "xuMissing": 2,
  "total": 600000,
  "capped": false,
  "provisional": true,
  "label": "TẠM TÍNH — dự kiến/tham khảo, chưa trừ lương"
}
```

---

## 5. Quyền — CEO-ONLY, khoá ở backend

CEO chốt **chỉ báo CEO**. Khoá ở **backend**, không phải ở giao diện:

1. Khối `penalty` **chỉ được đính vào response khi `auth.isAdmin(session.role)`**. Với session NV, backend **không được trả trường `penalty`** — không phải trả về rồi ẩn trên web.
2. Route self-view chi phí NV (`SPEC_REPORT_EMP_COST_SELFVIEW.md`) **giữ nguyên**, không thêm dòng phạt.
3. `employeeCostSummaryForNotify` / `employeeBonusSummaryForNotify` (dùng cho Telegram/email NV) **không được chứa số phạt**. Hai hàm này chạy dưới session NV nên điều 1 đã chặn sẵn — **viết test khoá lại**.
4. Export Excel/PDF: cột phạt **chỉ có ở bản CEO tải**. Bản NV không có.

---

## 6. Hiển thị — 3 dòng, không ghi đè DataHub

Trên màn hình CEO (trang Chi phí, phần tổng của từng NV):

```
Chi phí bán hàng (DataHub)      46.878.505đ
Trừ phạt (dự kiến)                 −600.000đ
─────────────────────────────────────────────
Còn lại (tham khảo)             46.278.505đ
```

- Dòng 1 lấy **nguyên số DataHub**, không sửa một đồng.
- Dòng 2 là số App Report tính, **luôn có nhãn "dự kiến"**.
- Dòng 3 là phép trừ hiển thị, **không ghi vào đâu cả**, không xuất sang DataHub.
- Chi phí DataHub fail-closed (`null` vì coverage thấp) ⇒ **không hiện dòng 3**. Không được lấy `null` làm 0 rồi ra "còn lại = −600.000đ". Đây đúng cái bẫy `Number(null) === 0` đã dính 2 lần trong tháng 7.

**Khi nào trừ thật:** sau 1–2 kỳ chạy đúng, việc trừ chuyển sang **DataHub** thực hiện; App Report quay về chỉ đọc. Không bao giờ để hai bên cùng trừ.

---

## 7. Thông báo

- **NV: KHÔNG nhận bất kỳ tin nào về phạt.** Không thêm slot, không thêm dòng vào tin 07:30 / 12:30 T7 / 17:30 / 17:40.
- **CEO:** thêm mục "Phạt dự kiến" vào **digest CEO** đã có. Chỉ liệt kê NV có phạt > 0. **Không có ai bị phạt thì không in mục này** — đúng chốt "không có tin gì thì không gửi".
- Cờ riêng `PENALTY_NOTIFY`, mặc định **tắt**, fail-closed như 3 luồng kia.

---

## 8. Version — bắt buộc

Ship phạt = **đổi cách tính thưởng** ⇒ làm đủ 4 bước (`CLAUDE.md` mục 5):

1. `server/src/employeeBonus.js`: `FORMULA_VERSION` **`v3.2` → `v3.3`**.
2. `server/config/employee_bonus_tiers.json`: `version` → `bonus-v3.3-penalty-...`, viết lại `note` cho có phần phạt.
3. `server/config/bonus_formula_lock.json`: ghi `version: "v3.3"` + `sourceHash` mới.
4. Ghi 1 mục `CHANGELOG.md`.

Quên bước nào thì `server/test/bonusFormulaVersion.test.js` **đỏ** và in sẵn hướng dẫn.

Nếu tách phạt Xu ra file mới (vd `src/penalty.js`) thì **thêm file đó vào `FORMULA_SOURCES`** trong test — nếu không, sửa công thức phạt sẽ lọt khoá.

---

## 9. Test bắt buộc — bot phải viết đủ

**Tính đúng**
1. Đạt 85%, doanh thu 1 tỷ, bậc −0,05% ⇒ phạt **500.000đ**, `baseAmount = 0`.
2. Đạt 120% ⇒ phạt **0**, thưởng vẫn đúng như v3.2 (**không đổi một đồng**).
3. Bậc âm **không bao giờ** cộng vào `baseAmount` / `amount`.
4. `penaltyCapAmount` kẹp đúng.
5. Phạt Xu: thiếu 2 Xu ⇒ 600.000đ; đã hạch toán 600.000đ ⇒ **quý cộng thêm 0đ** (không phạt hai lần).

**Fail-closed**
6. Chưa giao target ⇒ **không phạt**, `penaltyStatus: 'missing_target'`.
7. `penaltyEnabled = false` ⇒ phạt luôn `0`/`null`, kể cả khi config có bậc âm.
8. Nguồn điểm/xu hỏng ⇒ không phạt, có trạng thái nói rõ.
9. Chi phí DataHub `null` ⇒ **không** render dòng "Còn lại".

**Quyền — quan trọng nhất**
10. Session **NV** gọi route chi phí ⇒ response **không có trường `penalty`** (kiểm bằng `assert.ok(!('penalty' in body))`, không phải kiểm bằng giá trị 0).
11. `employeeCostSummaryForNotify` / `employeeBonusSummaryForNotify` trả về **không chứa** chuỗi "phạt" và không có trường phạt.
12. Không có slot thông báo mới nào bắn cho NV — khoá bằng test đọc mã như `notifySchedule.test.js` đang làm.

**Cấu hình**
13. Rate âm mà `penaltyEnabled=false` ⇒ lưu bị **từ chối** (`PENALTY_DISABLED`).
14. Bậc âm nằm trên bậc dương ⇒ **từ chối** (`PENALTY_TIER_ORDER_INVALID`).
15. Đổi `xuPenalty.perMissingXu` mà không nâng version ⇒ `bonusFormulaVersion.test.js` **đỏ**.

---

## 10. Thứ tự làm — đề nghị

| Đợt | Việc | Vì sao trước |
|---|---|---|
| **1** | Phơi **phạt Xu** ra màn hình CEO (mục 3, 5, 6) | Máy tính đã đúng sẵn, rủi ro thấp nhất, Sếp có số thật để soi ngay |
| **2** | **Phạt theo target** + bảng bậc âm (mục 2) | Cần Sếp nhập mốc/% thật rồi mới bật |
| **3** | Mục "Phạt dự kiến" trong digest CEO (mục 7) | Chỉ bật khi 2 đợt trên đã đối chiếu đúng |

**KHÔNG bật `penaltyEnabled` trong cùng đợt deploy đầu tiên.** Deploy code trước, chạy đối chiếu, Sếp gật rồi mới bật cờ.

**KHÔNG deploy phần này trước 31/07** — ngày chốt tháng đang có tin chi phí + thưởng chạy thật, hỏng là mất tin của cả công ty.

---

## 11. Việc CEO còn phải chốt

1. **Mốc và % phạt thật** (bảng ở 2.1 chỉ là ví dụ). Cần: phạt từ dưới bao nhiêu %, mỗi bậc bao nhiêu %.
2. **Trần tiền phạt** một NV một tháng tối đa bao nhiêu (`penaltyCapAmount`).
3. Phạt Xu đang là **300.000đ/Xu** — giữ hay đổi.
4. Sau này có cho NV nhìn thấy phạt của chính mình không, hay vĩnh viễn chỉ CEO.
