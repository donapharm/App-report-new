# DIRECTIVE — DEPLOY bản "Chi phí của tôi" cột mới + VAT-trước + visibility (CEO chốt (A) 2026-07-22)

> Claude Code giao Report Bot. **CEO đã chốt DEPLOY NGAY (phương án A).** Nguồn: nhánh review
> `review/employee-cost-templates-20260722` @ `d236496` — đã Claude review **PASS toàn bộ**
> (fix lookup 92,9% + 2 mẫu cột mới + VAT-trước + visibility hardening).

## 1. NỘI DUNG DEPLOY (gộp 1 release)
- Fix lookup `(đơn vị + mã hàng)` — DN001 **171/184 = 92,9%** (210/223 order-line).
- 2 mẫu cột: **full-time 19 cột** (C36/C41/C43/C44/C45) · **CTV {DN021,DN022,DN023} 15 cột** (chỉ C36).
- **‼ Đổi gốc tính sang VAT-TRƯỚC** — chi phí % nhân **thành tiền xuất bán trước VAT**. **TỔNG CHI PHÍ THÁNG SẼ ĐỔI**
  so với production cũ (đang tính có-VAT). Đây là **thay đổi số CÓ CHỦ Ý** CEO đã duyệt — KHÔNG phải lỗi.
- Route + panel **visibility** (công tắc bật/tắt quyền tự xem) + hardening `loadConfig`/GET.

## 2. CÁC BƯỚC
1. Merge `d236496` (nhánh review) → `main` (giữ lịch sử; KHÔNG bỏ commit review).
2. `npm run build` web → **FE mới** (bundle CÓ gọi `/employee-cost/visibility`).
3. **Deploy đồng bộ FE + BE**: phục vụ `web/dist` mới **VÀ restart backend** để nạp route visibility + code template mới.
   **‼ Không để lệch phiên bản** (FE mới / BE cũ) như sự cố 404 vừa rồi — restart BE là bắt buộc lần này.
4. Health check + smoke test theo §3. Ghi `CHANGELOG.md`. Báo Claude nghiệm thu.

## 3. NGHIỆM THU SAU DEPLOY (bắt buộc, dán số thật cho Claude)
1. **Không còn "Lỗi máy chủ"**; panel "Quản trị quyền tự xem chi phí" load; picker có NV.
2. **NV full-time (DN001):** bảng 19 cột đầy đủ, khớp **171/184 (≥90%)** → tổng tháng hiển thị. **Dán tổng chi phí
   tháng MỚI (VAT-trước)** + đối chiếu tay 1 dòng (doanh thu trước VAT × % ÷ 100). c44 tách cuối năm.
3. **CTV (DN021):** mẫu 15 cột chỉ C36; hiện **`—` do lệch mã QĐ** (fail-closed — ĐÚNG, chờ task DataHub đối chiếu).
4. **Ghi chú = `—`** (C48 chưa có — chờ task sidecar DataHub). KHÔNG chặn.
5. **Bảo mật giữ nguyên:** self-scope NV (thử `?emp=` mã khác → vẫn của mình); **C32/C47 không lộ**; token/key không ra FE;
   audit mỗi lượt gọi. `private, no-store`.
6. Số các trang khác (Doanh thu/Target/CST) **không đổi** ngoài module chi phí.

## 4. RỦI RO & ROLLBACK
- Rủi ro chính = **đổi số VAT-trước** (đã chủ ý). Nếu nghiệm thu lệch bất thường (không phải do VAT-trước) → **rollback**
  về `main` trước deploy (đã có backup bundle `backups/frontend-review-dist-20260722_145601/dist`).
- Sau deploy, tab CEO/NV đang mở cần **tải lại 1 lần**.

## 5. CÒN TREO (đắp sau, KHÔNG chặn deploy)
- **DN021 lệch mã QĐ** → task DataHub đối chiếu (`QĐ48…549` vs `QĐ139…549`).
- **C48 ghi chú** → task DataHub sidecar bất biến (điều kiện cứng: **C48 thiếu ≠ kỳ thiếu**).
