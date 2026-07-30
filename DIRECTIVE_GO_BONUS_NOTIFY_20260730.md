# DIRECTIVE — BẬT 2 CỜ TIN THƯỞNG (CEO duyệt 2026-07-30 tối)

CEO: *"Cho bot bật — với điều kiện đọc DN008 2 lần ra y hệt + soi thêm 1–2 NV thấy hợp lý. Chỉ restart app-report-tgbot. Đồng ý."*

Chuẩn đã chốt: thưởng tính **TRƯỚC VAT**, mốc DN008 đúng ~**124,21%** (KHÔNG phải 130,26% — số đó sau VAT, đã bỏ). Xem `DIRECTIVE_FINISH_20260730_TOI.md` VIỆC 2.

Ràng buộc chung giữ nguyên: không build trong cây production · không đụng `employee_bonus_tiers.json`/`bonus_formula_lock.json` · không ghi đè `server/data/*.json` · backup `.env` trước khi sửa · **chỉ restart `app-report-tgbot`**, KHÔNG restart `app-report`.

---

## CỔNG TRƯỚC KHI BẬT (bắt buộc đủ 3, thiếu 1 ⇒ DỪNG)

1. **DN008 đứng yên:** `GET /api/employee-cost?emp=DN008&from=2026-07&to=2026-07` **2 lần** (cách nhau ≥1 phút). `bonus.month.pct` + doanh thu trước VAT + target phải **y hệt** cả 2 lần. Lệch ⇒ slot còn động ⇒ DỪNG.
2. **Soi 1–2 NV khác:** đọc thêm 1–2 mã (vd DN001, DN005) — `pct` hợp lý, doanh thu là **trước VAT**, không có NaN/null/âm bất thường. Vô lý ⇒ DỪNG, báo mã.
3. **Cơ sở đúng:** xác nhận số là **before-VAT** (khớp `BASE='revenue_before_vat'`). Nếu thấy dấu hiệu cộng VAT (pct cao hơn ~5%) ⇒ DỪNG.

Đủ 3 ⇒ bật. Thiếu ⇒ giữ `=0`, báo rõ nghẽn ở đâu.

---

## BẬT

Backup `.env` → `EMP_COST_NOTIFY=1`, `BONUS_NOTIFY=1` → **chỉ restart `app-report-tgbot`**.

## NGHIỆM THU (dán số thật)

- PID `app-report-tgbot` **ĐỔI** · PID `app-report` **KHÔNG đổi**.
- Log in đủ 4 mốc: `20:00 ngày cuối tháng (dự kiến)` · `20:00 ngày 9 (sau khoá sổ) (số chốt)` · `20:10 ngày cuối tháng (dự kiến)` · `20:10 ngày 9 (sau khoá sổ) (số chốt)`.
- **Danh sách người sẽ nhận** (chỉ mã + kênh, KHÔNG số tiền) — **KHÔNG có** DN021/DN023/VP004/VP018.
- Xác nhận tin 31/07 gắn nhãn **"dự kiến"** (vì chưa khoá sổ 08/08), không phải "số chốt".

## NẾU DỪNG
Nói rõ: nghẽn ở cổng nào (1/2/3), số đọc được, cần gì để đi tiếp. Giữ 2 cờ `=0`. **Không "sửa ngược" pct lên 130,26%.**
