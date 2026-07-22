# DIRECTIVE — DEPLOY (B) gap tool #137 + export VN #138 (CEO chốt B, 2026-07-22)

> Claude Code giao Report Bot. **CEO chốt phương án B: deploy #137 + #138 NGAY**, #139 (bảng UX) làm sau (deploy lần 2).
> Nguồn: nhánh `review/employee-cost-gap-tool-20260722` @ **`50e0c62`** — Claude đã review **#137 + #138 PASS**.

## 1. DEPLOY CÁI GÌ (chỉ #137 + #138 — KHÔNG kèm #139)
- **#137 Gap tool:** endpoint `/employee-cost/gaps` (+export xlsx/pdf), NV panel "mặt hàng chưa có %", CEO tab gộp theo
  mã QLNB (lọc/tìm/coverage), gợi ý mã lệch QĐ. Self-scope, không lộ %.
- **#138 Export VN:** `/employee-cost/export.xlsx|pdf` — số kế toán VN, "Bằng chữ", **A4 landscape**, font Unicode
  fail-closed, NV tự xuất phần mình (self-scope 2 lớp).
- **‼ KHÔNG deploy #139** (STT/tất cả NV/cột % hẹp/tìm kiếm) — chưa implement/chưa review. **Deploy đúng commit `50e0c62`**;
  nếu đã lỡ thêm commit #139 lên nhánh này thì deploy từ `50e0c62`, hoặc tách #139 sang nhánh khác trước khi deploy.

## 2. CÁC BƯỚC
1. Merge/deploy **`50e0c62`** (#137+#138 đã PASS) → `main`.
2. `npm run build` web. **Deploy FE + RESTART BE đồng bộ** (BE có route gaps/export mới). Không lệch phiên bản.
3. Health check + nghiệm thu §3. Ghi CHANGELOG. Báo Claude.

## 3. NGHIỆM THU SAU DEPLOY (dán cho Claude)
1. **Gap tool:** CEO tab "Mặt hàng thiếu %" gộp theo mã QLNB, lọc/tìm/coverage chạy; DN001 T07 ra **13 cặp**, roster
   **34 mã / 96,5%**. NV thấy panel gap của mình; **NV không thấy gap người khác** (self-scope).
2. **Export:** NV tải Excel/PDF **của chính mình** (thử `?emp=` khác → vẫn của mình). Số kế toán VN đúng, **A4 ngang**,
   **PDF không lỗi dấu tiếng Việt**. Gap export 2 sheet, cột "% cần điền"/"Xác nhận" trống.
3. **Bảo mật:** C32/C47 không lộ, không lộ % trong gap, audit mỗi lượt xem/xuất, `private,no-store`.
4. **Chi phí (đã live trước đó) không đổi:** tổng tháng 41.144.556đ, C44 1.210.470đ vẫn đúng.
5. Trang khác không đổi. BE restart (PID/restart mới).

## 4. RỦI RO & ROLLBACK
- Chủ yếu **thêm tính năng** (gaps/export), không đổi công thức chi phí → rủi ro thấp. Bất thường → rollback về main
  trước deploy (backup bundle). Tab đang mở tải lại 1 lần.

## 5. SAU DEPLOY — #139 (đợt 2)
- Bot làm nốt **#139** (`DIRECTIVE_EMP_COST_TABLE_UX.md`) trên **nhánh mới off main mới nhất**: cột STT · "Tất cả NV"
  (CEO/ADMIN only) · thu hẹp cột % · ô tìm kiếm bỏ-dấu/hoa-thường · sticky/sort/chip. Push → Claude review → deploy lần 2.
- Song song (DataHub Bot): điền % "thiếu hẳn" + alias "lệch mã QĐ" → coverage tiến 100% (App Report tự khớp, không deploy).
