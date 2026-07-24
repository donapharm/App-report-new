# DIRECTIVE — DEPLOY KPI reward: Thưởng dự kiến + Điểm/Xu/Phạt (App VAT) — review PASS + parity 0 sai số

> Claude Code giao Report Bot. **Claude duyệt deploy.** Gồm 2 nhánh đã review PASS:
> - Ô **Thưởng dự kiến** `467eb2e` (App Report tự tính từ target, cap 0.5%).
> - Đọc **Điểm/Xu/Phạt** `0c1da00` từ App VAT SSOT (`/api/khoan/dashboard`) — **LIVE parity PASS 4/4 NV, sai số = 0**.

## 1. TIỀN ĐỀ
- App VAT SSOT ổn định (`365b0c5`) + token-logging đã gỡ (`473de59`, chỉ còn `sid` băm). `.env` App Report có `VAT_BASE` +
  `VAT_SERVICE_TOKEN` đúng. Parity production khớp tuyệt đối.

## 2. CÁC BƯỚC
1. Merge nhánh review (Thưởng + điểm/xu/phạt) → `main` nếu chưa (một số đã ở main; đảm bảo đủ cả 2).
2. `npm run build` web. **Deploy FE + RESTART BE đồng bộ** (route đọc App VAT + KPI mới). Không lệch phiên bản.
3. **`.env` production:** `VAT_BASE`, `VAT_SERVICE_TOKEN` (backend-only). Kiểm `curl` nội bộ `/employee-cost` có điểm/xu/phạt.
4. Health + nghiệm thu §3. Ghi CHANGELOG. Báo Claude.

## 3. NGHIỆM THU SAU DEPLOY (dán cho Claude)
1. **Điểm/Xu/Phạt** hiện đúng của NV; đối chiếu 1–2 NV = App VAT dashboard (sai số 0). NV `?emp=` khác → vẫn của mình (self-scope 2 lớp).
2. **Dòng "cấn trừ do thiếu xu"** tách khỏi chi phí gốc (DataHub); "chi phí gốc − cấn trừ = còn lại" đúng; **cảnh báo** khi pct<90%.
3. **Ô Thưởng dự kiến:** tiers rỗng → "Chưa cấu hình mức thưởng"; điền `employee_bonus_tiers.json` → tính đúng bậc (cap 0.5%).
4. **Bảo mật:** `VAT_SERVICE_TOKEN` không ra FE/không log (chỉ sid); C32/C47 không lộ; số chi phí DataHub không đổi; audit.
5. Trang khác không đổi. BE restart (PID/restart mới).

## 4. RỦI RO & ROLLBACK
- Điểm/xu/phạt là **đọc-hiển thị** (không tính/không payroll); Thưởng là dự kiến → rủi ro thấp. Bất thường → rollback về main
  trước deploy (backup). Tab mở tải lại 1 lần.

## 5. SAU DEPLOY
- **CEO điền `employee_bonus_tiers.json`** (bậc 0.2–0.5%) → ô Thưởng có số. (Xác nhận mốc %/base với Claude trước nếu chưa.)
- (Tùy chọn) rotate `VAT_SERVICE_TOKEN` cho chắc.
