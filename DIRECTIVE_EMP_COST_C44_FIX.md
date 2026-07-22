# DIRECTIVE — SỬA GẤP công thức C44: gốc = TIỀN cột C43, KHÔNG phải doanh thu (CEO 2026-07-22)

> Claude Code giao Report Bot. **Lỗi tiền nghiêm trọng đang LIVE production** (`050b9c2`). CEO phát hiện: cột C44
> ("Lương cuối năm") đang tính SAI gốc → số phình cao (C44 = 35.157.098đ).

## 1. SAI Ở ĐÂU (production hiện tại)
`server/src/employeeCost.js` dòng ~590 áp CHUNG cho mọi cột:
```js
const amount = percent == null ? null : calculateAmount(line.revenueBeforeVat, percent);
```
⇒ C44 cũng lấy `revenueBeforeVat × C44%` → gốc là **doanh thu** → phình.

## 2. ĐÚNG (CEO chốt)
**C44 là % của TIỀN cột C43**, không phải % của doanh thu:
```
tiền_C43(dòng) = revenueBeforeVat(dòng) × %C43 ÷ 100          (như hiện tại, giữ nguyên)
tiền_C44(dòng) = tiền_C43(dòng)        × %C44 ÷ 100           ← SỬA: gốc là tiền_C43, KHÔNG phải revenueBeforeVat
```
**Đối chiếu tay 1 dòng** (revenueBeforeVat 12.616.000; %C43=12; %C44=5):
- tiền_C43 = 12.616.000 × 12% = **1.513.920**
- tiền_C44 = 1.513.920 × 5% = **75.696đ**  ✅ (hiện đang sai = 630.800đ = 12.616.000 × 5%)

`%C44` = **đúng giá trị cột C44 của dòng đó** (timeline, vd 5.0) — KHÔNG cố định 5, KHÔNG đổi phần hiển thị % (vẫn hiện 5.0).

## 3. CÁCH LÀM (cấu hình được, KHÔNG hardcode "c44"/"c43")
- Thêm cấu hình **cột phái sinh**: mỗi cột "cuối năm" phái sinh từ 1 cột gốc. Mặc định `c44 ← c43`. Đọc từ env/config
  (vd `EMPLOYEE_COST_DERIVED_BASE="c44:c43"`), CEO đổi được không sửa code. Cột không có map → giữ gốc `revenueBeforeVat` như cũ.
- Gắn `derivesFrom` vào định nghĩa cột (như đang có `annual`). Khi tính tiền:
  ```js
  const base = column.derivesFrom ? amounts[column.derivesFrom] : line.revenueBeforeVat;
  const amount = (percent == null || base == null) ? null : calculateAmount(base, percent);
  ```
- **Thứ tự tính:** cột gốc (C43) phải tính TRƯỚC cột phái sinh (C44). Template hiện xếp C43 trước C44 nên OK, nhưng
  **thêm phòng vệ**: nếu `amounts[derivesFrom]` chưa có/`null` → `amount = null` (không lấy nhầm doanh thu).
- **‼ Khối residual/làm tròn** (dòng ~642 `calculateAmount(group.reduce(...revenueBeforeVat...), percent)`): với cột
  phái sinh phải đối chiếu trên **tổng tiền cột gốc** của nhóm, KHÔNG phải tổng revenueBeforeVat. Tức
  `target = calculateAmount(Σ row.amounts[derivesFrom] trong nhóm, %C44)`. Nếu khó, tính residual C44 từ base C43 đã phân bổ.

## 4. GIỮ NGUYÊN (không đổi)
- C44 vẫn **"cuối năm"**: loại khỏi tổng tháng, làm mờ + badge, tách dòng "Khoản cuối năm (tạm tính · T12)".
- Các cột khác (C36/C41/C43/C45) vẫn gốc `revenueBeforeVat × %`. VAT-trước, self-scope, C32/C47 khóa, grain order-line,
  công tắc, khớp 92,9%, hiển thị % (5.0), 2 mẫu — tất cả giữ.
- **Tổng chi phí THÁNG (41.144.556đ) KHÔNG đổi** — vì C44 vốn đã loại khỏi tháng. Chỉ **"Khoản cuối năm" giảm mạnh**
  (từ 35.157.098đ xuống ~tiền_C43 × %C44). Đây là con số cuối năm (chi T12), không phải payout tháng.

## 5. NGHIỆM THU (dán số cho Claude)
1. **C44 dòng mẫu = 75.696đ** (không còn 630.800đ). Đối chiếu tay 1 dòng khớp.
2. **Khoản cuối năm (Σ C44) mới** dán lại — phải ≈ (Σ tiền_C43) × %C44, thấp hơn hẳn 35.157.098đ cũ.
3. Tổng tháng vẫn **41.144.556đ** (không đổi). C36/C41/C43/C45 không đổi. Σ ngày = tháng vẫn đúng.
4. Cột phái sinh cấu hình được (đổi map `c44:c43` không sửa code). Test cũ + **test mới cho C44 phái sinh** PASS.
5. Push nhánh review; báo Claude review; **chưa deploy** cho tới khi Claude duyệt (lỗi tiền — soát kỹ).
