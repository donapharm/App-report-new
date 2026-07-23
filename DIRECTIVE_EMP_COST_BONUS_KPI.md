# DIRECTIVE — Ô KPI "Thưởng dự kiến" theo mức đạt target (khung trước, tầng nấc điền sau) — CEO 2026-07-23

> Claude Code giao Report Bot. **CEO chốt:** xây **ô KPI thưởng** trước; **bảng tầng nấc mức thưởng CEO coach/điền sau**.
> Target đã có sẵn trong App Report → thưởng dự kiến = mở rộng của target forecast. **App Report tính DỰ KIẾN + hiển thị.**

## 1. BẢN CHẤT (giữ đúng ranh giới)
- Ô này là **"Thưởng DỰ KIẾN"** (tham khảo/động lực), tính từ **% đạt target** (dữ liệu App Report sẵn có) × **bảng tầng nấc
  cấu hình**. **KHÔNG phải lệnh chi thưởng** (App Report không gửi thưởng — đã cắt). Ghi rõ nhãn **"dự kiến"**.
- Nếu tiền thưởng thực trả đi qua payroll/DataHub → số chính thức ở đó; ô này chỉ tham khảo (chú thích rõ để không nhầm là tiền đã chốt).

## 2. XÂY NGAY — ô KPI + khung config (tầng nấc để trống)
- **Ô KPI "Thưởng dự kiến (theo mức đạt target)"** trong hàng KPI "Chi phí của tôi" (và/hoặc trang Target).
- **Công thức:** `thưởng = bậc(% đạt target hiện tại)`. `% đạt target` lấy từ **analytics target sẵn có** (đừng tính lại kiểu khác).
- **Bảng tầng nấc = FILE CẤU HÌNH** `server/config/employee_bonus_tiers.json`, **cấu hình được** (CEO đổi không sửa code):
  ```json
  { "currency": "VND",
    "tiers": [ { "fromPct": 0, "toPct": 0, "bonus": 0 } ],   // ‼ ĐỂ TRỐNG/placeholder — CEO điền sau
    "note": "Mỗi bậc: đạt % target trong [fromPct, toPct) → thưởng 'bonus' đồng. CEO điền tầng nấc." }
  ```
- **Chưa cấu hình (tiers rỗng/placeholder) → ô hiện "Chưa cấu hình mức thưởng"** (KHÔNG bịa số). Điền xong → tự tính bậc.
- **Bậc thang rõ ràng:** chọn đúng 1 bậc theo % đạt; ranh giới bậc xác định (tránh chồng lấn). Hiển thị kèm "đạt X% · bậc Y".

## 3. HIỂN THỊ
- Nhãn ô: **"Thưởng dự kiến"** + phụ đề "theo mức đạt target · tham khảo". Tooltip: công thức bậc đang áp + % đạt.
- **Self-scope:** NV thấy thưởng dự kiến **của mình**; CEO/ADMIN xem NV bất kỳ / tất cả (như các KPI khác).
- (Tùy chọn) khi "Tất cả NV": tổng/tổng phụ thưởng dự kiến theo NV.

## 4. GIỮ NGUYÊN / RANH GIỚI
- Số target từ **analytics sẵn có** (không dựng cách tính target thứ 2). Không gửi thưởng, không ghi payroll. Self-scope, C32/C47 không lộ.
- Ô điểm/xu/phạt (payout DataHub/App VAT) là việc KHÁC — chờ điều tra App VAT (#158). Ô thưởng này App Report tự tính dự kiến, độc lập.

## 5. NGHIỆM THU
1. Ô "Thưởng dự kiến" hiện; **tiers rỗng → "Chưa cấu hình mức thưởng"** (không số bịa).
2. Điền thử vài bậc vào `employee_bonus_tiers.json` → ô tính đúng bậc theo % đạt target; đổi bậc không cần sửa code.
3. Self-scope (NV của mình); nhãn "dự kiến" rõ. Test + build PASS. Push nhánh review; báo Claude; chưa deploy.
