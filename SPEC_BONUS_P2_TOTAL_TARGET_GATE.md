# SPEC — Thưởng P2 v3.2: CỔNG TỔNG TARGET + gán phần vượt theo ưu tiên

> CEO chốt 2026-07-27. Đây là **chính sách TIỀN** → App Report (dự kiến) và engine chi THẬT phải
> cài Y HỆT công thức này, cùng ra một số. KHÔNG bên nào tự chế biến.

## 0. Vì sao đổi
Công thức hiện tại `bonus-v3.1-auto-group-target` **chia nhỏ target ra từng nhóm C10** (auto tự suy) rồi
tính vượt PER-NHÓM → nhóm nào vượt phần-của-nó là được thưởng, **kể cả khi TỔNG chưa đạt target**. CEO
bác: phải **đạt TỔNG target trước**, rồi mới tính phần vượt theo ưu tiên.

## 1. Công thức mới `v3.2-total-target-gate`
Ký hiệu:
- `R` = **TỔNG doanh thu C10** = Σ `groupRevenue[g]` (trước VAT).
- `T` = **TỔNG target** đã giao cho NV kỳ đó (MỘT số, KHÔNG chia nhỏ). *(Xác nhận: T = target tổng NV, áp lên doanh thu C10.)*
- `rate[g]` = rate P2 của nhóm `g` (đọc từ config SSOT — cấu hình tay được).
- Thứ tự ưu tiên: **H.A\* > H.A > H.B > H.C > H.D**.

Các bước (fail-closed mọi nhánh):
1. **Nguồn thiếu** (`sourceAvailable=false`) → P2 = chờ (`source_unavailable`), KHÔNG suy số. *(giữ nguyên)*
2. **(Xác nhận) Cổng ngưỡng %**: nếu còn giữ `priorityThresholdPct` và `pct < threshold` → P2 = 0. *(Đề xuất: cổng TỔNG bên dưới đã bao trùm, có thể BỎ ngưỡng % riêng — CEO chốt.)*
3. **‼ CỔNG TỔNG TARGET (MỚI):** nếu `R < T` → **P2 = 0** (`total_below_target`), bất kể nhóm nào vượt.
4. **Phần vượt** `E = max(0, R − T)`.
5. **Gán E theo ưu tiên CAO trước, cap bởi doanh thu từng nhóm:**
   ```
   remaining = E
   for g in [H.A*, H.A, H.B, H.C, H.D]:      # cao → thấp
       take       = min(remaining, groupRevenue[g])
       amount[g]  = round(take * rate[g] / 100)
       remaining -= take
       if remaining <= 0: break
   P2 = Σ amount[g]
   ```
   → phần vượt "nằm trên" được thưởng theo **hàng ưu tiên cao nhất trước** (đúng ý CEO).

## 2. Ví dụ DN006 · 07/2026 (để 2 bên đối chiếu RA CÙNG SỐ)
- `R` ≈ 3.398 tỷ (Σ groupRevenue) · `T` ≈ 2.694 tỷ (target giao).
- `E` = R − T ≈ **704 triệu**.
- Gán: revenue H.A\* ≈ 1.534 tỷ ≥ 704tr → lấy trọn 704tr ở rate H.A\* (1%) = **≈ 7,04 triệu**.
- **P2 ≈ 7,04 triệu** (v3.1 cũ ra 5,63 triệu — khác, đúng như dự đoán).
> Số minh hoạ; số chính xác do backend tính. Cả 2 engine phải khớp ví dụ này.

## 3. Cấu hình rate + AUDIT (thuộc SSOT/CEO-vault — KHÔNG phải App Report)
- `priorityRates[g]` ĐÃ nằm trong config SSOT; App Report **chỉ đọc** qua `configResolver` (không tự lưu).
- Yêu cầu CEO (#3): CEO chỉnh rate **bằng tay ở CEO-vault/DataHub**; mỗi lần chỉnh **GHI AUDIT** (ai · khi nào · cũ→mới) + **bump `version`** + đặt `effectiveFrom`. App Report đọc `version`/`effectiveFrom`/`nguồn` và HIỂN THỊ (modal đã có sẵn dòng này).
- App Report **KHÔNG** dựng store rate riêng (giữ nguyên tắc SSOT: App Report chỉ hiển thị).

## 4. Điểm 2 — chống "báo một đằng, chi một nẻo" (CEO nhấn mạnh)
- Công thức v3.2 phải cài Y HỆT ở **CẢ (a) App Report `employeeBonus.js` (dự kiến)** VÀ **(b) engine chi THẬT**.
- **CHỈ deploy App Report v3.2 KHI (b) đã dùng v3.2.** Nếu App Report báo v3.2 mà chi theo v3.1 → loạn. **Deploy đồng bộ 2 bên.**

## 5. Phân vai
- **App Report (Claude):** thay đoạn per-group-excess trong `employeeBonus.js` bằng **cổng tổng + priority-fill**; đọc rate từ config; **bump nhãn version** hiển thị; test kỹ. KHÔNG deploy tới khi (b) sẵn sàng.
- **SSOT/DataHub (bot):** rate config chỉnh-tay + audit + version bump; engine chi THẬT dùng v3.2.

## 6. Nghiệm thu (test — cả 2 bên)
1. `R < T` → P2 = 0 (`total_below_target`), dù có nhóm vượt.
2. `R ≥ T`, `E ≤ revenue[H.A*]` → toàn bộ E ăn rate H.A\*.
3. `E > revenue[H.A*]` → tràn xuống H.A, H.B… đúng cap từng nhóm; tổng đúng.
4. Đổi `rate[g]` trong config → P2 đổi theo; `version` phản ánh; audit ghi cũ→mới.
5. `pct < threshold` (nếu giữ cổng ngưỡng) → P2 = 0.
6. `source_unavailable` → fail-closed, P2 chờ, KHÔNG suy số.
7. App Report forecast == số engine chi thật cho cùng input (khớp Điểm 2).

## 7. Cần CEO chốt nốt 2 điểm nhỏ để code chính xác
- (a) `T` = **tổng target NV** áp lên doanh thu C10 — đúng chứ? (hay là một "target C10 riêng"?)
- (b) Còn giữ **cổng ngưỡng %** (`priorityThresholdPct`) song song cổng tổng, hay **bỏ** vì cổng tổng đã chặt hơn?
