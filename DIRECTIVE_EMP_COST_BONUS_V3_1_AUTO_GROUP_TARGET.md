# DIRECTIVE — Thưởng v3.1: TỰ SUY target nhóm C10 (P2 lên luôn) + target quý = TRUNG BÌNH quý (CEO chốt 2026-07-25)

> CEO: khỏi nhập tay target nhóm — **tự suy để P2 chạy ngay**; vẫn cho CEO **tự chỉnh đè** trong bảng Cấu hình Thưởng.
> Target quý **lấy TRUNG BÌNH chung của quý** (T7/T8/T9, các quý sau tương tự). Nền: `DIRECTIVE_EMP_COST_BONUS_V3_P2_EXCESS.md`.
> Vẫn "dự kiến/tham khảo", **không payroll**. Claude = kiến trúc/review; Report Bot triển khai. Hiệu lực **T07.2026**.

## 1. TỰ SUY TARGET NHÓM (mặc định BẬT — để P2 lên luôn, khỏi nhập 105 số)
Khi CEO **chưa nhập tay** target nhóm g → **tự suy** (không còn fail-closed P2=0):
```
target_nhóm_g (tháng) = target_NV (tháng) × ( doanh thu_nhóm_g / tổng doanh thu_NV )   (theo C10, trước VAT)
```
- Tức chia target NV cho các nhóm **theo tỷ trọng doanh thu nhóm** trong kỳ. Nhóm không có doanh thu → target nhóm = 0.
- Hệ quả: `P2_g = max(0, doanh thu_nhóm_g − target_nhóm_g) × rate_g` = **phần vượt của nhóm × rate** (đúng tinh thần v3, nhưng target nhóm **tự có** — P2 chạy ngay khi NV vượt tổng target).
- **CEO tự chỉnh đè:** ô target nhóm trong bảng Cấu hình Thưởng vẫn cho nhập; **nhập tay → dùng số tay** (đè giá trị tự suy) theo tầng (mặc định→tuyến→đơn vị→NV). versioned + audit + preview.
- **Đánh dấu nguồn** mỗi nhóm: `auto` (tự suy) vs `manual` (CEO nhập) để minh bạch trong preview/drill-down.

## 2. TARGET QUÝ = TRUNG BÌNH CHUNG CỦA QUÝ
- **Target quý (NV) = trung bình các tháng ĐÃ GIAO trong quý** (không phải tổng): `avg = Σ target tháng đã giao / số tháng đã giao`.
  Ví dụ quý 3 mới giao T07 = 2,5 tỷ → target quý = **2,5 tỷ** (trung bình 1 tháng đã giao); khi giao thêm T08/T09 → trung bình 3 tháng.
- **% đạt quý** và **target nhóm quý** dùng con số trung bình này (nhất quán tháng/quý). Áp cho **mọi quý sau**.
- Ghi rõ ở UI/drill-down: *"Target quý = trung bình các tháng đã giao (T7/T8/T9)"* để không hiểu nhầm là tổng.

## 3. P2 (giữ công thức v3, chỉ đổi NGUỒN target nhóm)
- Gate: NV đạt **TỔNG ≥ 101%** target (giữ). Với mỗi nhóm C10: `vượt_g = max(0, DT nhóm_g − target_nhóm_g)`; `P2_g = vượt_g × rate_g`; `P2 = ΣP2_g`.
- Rate giữ (H.A*1·H.A0.8·H.B0.5·H.C0.1·H.D0.1, chỉnh được). Tổng = P1 + P2. Kỳ đóng (<T07.2026) giữ công thức cũ.
- **Nhóm chỉ từ C10 (DataHub)**; C10 thiếu cho mã nào → mã đó không vào nhóm (không bịa). C32/C47 khóa.

## 4. NGHIỆM THU
1. **P2 LÊN NGAY** cho NV vượt tổng target (không còn 0 do "chưa giao target nhóm") — vd NV đạt >101% có P2 > 0; NV <101% P2 = 0.
2. Đối chiếu tay 1 NV (vd DN006, vượt 729.579.687đ): target nhóm auto = target × tỷ trọng; P2 = Σ(vượt nhóm × rate) — khớp.
3. Target quý = trung bình đúng (T07 → =T07; đủ 3 tháng → trung bình 3). CEO nhập tay 1 nhóm → đè đúng, đánh dấu `manual`.
4. Dự kiến/tham khảo, không payroll; self-scope; test PASS; ghi CHANGELOG. Deploy xin CEO duyệt.

## 5. GHI CHÚ
- Đây là số **tham khảo** (không trừ tiền) nên cho tự suy để dùng ngay là an toàn; CEO chỉnh đè bất cứ lúc nào. Nếu sau này
  CEO muốn quay lại "chỉ nhận target nhóm nhập tay" → tắt cờ tự suy (giữ tùy chọn config).
