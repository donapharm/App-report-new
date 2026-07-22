# DIRECTIVE — DEPLOY gói UI chi phí: C44 + thu gọn panel + KPI cards + nhãn (CEO chốt A, 2026-07-22)

> Claude Code giao Report Bot. **Claude review PASS toàn bộ.** Nguồn: nhánh
> `review/employee-cost-c44-derived-20260722` @ `a5ef765`. Deploy 1 lượt (plan A).

## 1. NỘI DUNG (4 việc, đã review PASS)
1. **C44 = tiền_C43 × %C44** (cột phái sinh cấu hình được `c44:c43`) — sửa lỗi tiền. C44 tháng 1.210.470đ (từ 35.157.098đ).
2. **Thu gọn panel công tắc** — mặc định gập, nhớ trạng thái theo admin, draft không mất.
3. **KPI cards** — `summary.columnTotals` (gate <90%); FE render động: Doanh thu chưa VAT + C36/C41/C43/C44/C45,
   **ô C44 nổi bật + badge cuối năm**.
4. **Nhãn** — "Số dòng đơn hàng" + "…/… mã (đơn vị×mặt hàng)" (chỉ đổi chữ, số/coverage giữ nguyên).

## 2. CÁC BƯỚC
1. Merge `a5ef765` → `main` (giữ lịch sử).
2. `npm run build` web (FE mới có KPI + thu gọn + nhãn).
3. **Deploy FE + RESTART BE đồng bộ** (BE cần code `columnTotals` + C44 mới). **‼ Không để lệch phiên bản.**
4. Health check + nghiệm thu §3. Ghi CHANGELOG (bot). Báo Claude nghiệm thu.

## 3. NGHIỆM THU SAU DEPLOY (dán số cho Claude)
1. **C44:** dòng mẫu 75.696đ; **C44 tháng 1.210.470đ**; **tổng tháng vẫn 41.144.556đ** (không đổi).
2. **KPI:** full-time hiện Doanh thu chưa VAT + C36/C41/C43/C44/C45; **C44 nổi bật + badge cuối năm**;
   **Σ(C36+C41+C43+C45) = tổng chi phí tháng** (đối chiếu khớp). CTV chỉ hiện ô C36 (+doanh thu). Match <90% → ô CP "—".
3. **Nhãn:** "Số dòng đơn hàng" + "…/… mã (đơn vị×mặt hàng)" ở KPI và meta panel tháng. Số 123/100/101/99,0% không đổi.
4. **Thu gọn:** panel công tắc gập sẵn khi vào; mở/gập + reload giữ trạng thái; draft không mất.
5. **Bảo mật giữ:** self-scope, C32/C47 không lộ, VAT-trước, `private,no-store`, audit. BE restart (PID/restart mới).
6. Trang khác (Doanh thu/Target/CST) không đổi.

## 4. RỦI RO & ROLLBACK
- Đổi số duy nhất = **C44 giảm** (đã chủ ý; tổng tháng không đổi). Bất thường ngoài C44 → rollback về main trước deploy
  (backup bundle sẵn). Tab đang mở tải lại 1 lần.
- Còn treo (không chặn, chờ DataHub Bot): DN021 lệch mã QĐ; C48 ghi chú sidecar.
