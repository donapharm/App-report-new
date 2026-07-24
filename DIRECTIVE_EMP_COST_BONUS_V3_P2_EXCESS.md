# DIRECTIVE — Thưởng v3: P2 tính trên phần VƯỢT TARGET RIÊNG TỪNG NHÓM (CEO chốt 2026-07-24)

> Sửa lỗi P2 "chưa hợp lý": trước đây P2 = **toàn bộ** doanh thu nhóm × rate → phình to. CEO chốt **phương án B**:
> P2 chỉ tính phần **vượt target riêng của từng nhóm**. Áp dụng **từ kỳ T07.2026**. Vẫn "dự kiến/tham khảo", không payroll.
> Claude = kiến trúc/review; Report Bot triển khai. Nền: `DIRECTIVE_EMP_COST_BONUS_V2.md` (P1 + tầng cấu hình + preview).

## 1. P1 — CƠ BẢN (GIỮ NGUYÊN)
- `P1 = doanh thu trước VAT × bậc%` theo **% đạt TỔNG target**: <90→0 · 90–100→0,10 · 100–110→0,15 · 110–130→0,18 · **≥130→0,25** (mở, >130 vẫn 0,25%).

## 2. P2 — NHÓM ƯU TIÊN C10 (SỬA: chỉ phần VƯỢT target riêng từng nhóm)
- **Điều kiện bật:** NV đạt **TỔNG ≥ 101%** target (giữ `priorityThresholdPct=101`).
- **Với mỗi nhóm** g ∈ {H.A*, H.A, H.B, H.C, H.D}:
  ```
  vượt_nhóm_g = max(0, doanh_thu_nhóm_g_trướcVAT − target_nhóm_g)
  P2_g        = vượt_nhóm_g × rate_g
  ```
  - `doanh_thu_nhóm_g` = doanh thu (trước VAT) các mã thuộc nhóm g theo **C10 (DataHub)** — đã có ở `buildPriorityRevenue.groupRevenue`.
  - `target_nhóm_g` = **target RIÊNG của nhóm g cho NV đó, theo kỳ** (DỮ LIỆU MỚI — xem §3).
  - rate mặc định: H.A*→1,0 · H.A→0,8 · H.B→0,5 · H.C→0,1 · H.D→0,1 (đã có, chỉnh được qua menu).
- **P2 = Σ P2_g.** **Tổng thưởng = P1 + P2.**
- **Tháng/Quý:** tính riêng — tháng dùng doanh thu+target nhóm của tháng; **quý** dùng doanh thu nhóm cả quý và **target nhóm quý = Σ 3 tháng** (nhất quán cách cộng target tổng hiện tại).

## 3. ‼ DỮ LIỆU MỚI — TARGET THEO NHÓM (điều kiện để P2 chạy)
- Cần **target theo nhóm C10, theo NV, theo kỳ**. Hiện chưa có → **fail-closed**:
  - Nhóm nào **chưa giao target** → `target_nhóm_g` coi như thiếu → **P2_g = 0** (KHÔNG bịa; KHÔNG dùng 0 để lấy trọn doanh thu nhóm làm vượt). Ghi rõ "chưa giao target nhóm g".
- **Nơi nhập (CEO chốt 2026-07-24: GIAO TAY, tự căn chỉnh trong bảng cấu hình):** mở **các ô target nhóm** (H.A*/H.A/H.B/H.C/H.D) ngay trong menu "Cấu hình Thưởng dự kiến" để CEO **tự nhập/điều chỉnh** theo **tầng đè** (Mặc định → tuyến → đơn vị → NV) — đỡ phải gõ 105 số: đặt Mặc định/đơn vị rồi đè riêng vài NV. Versioned + audit + **preview trước khi lưu**.
- Khuyến nghị nhất quán: Σ target các nhóm ≤ target tổng NV (cảnh báo mềm nếu vượt, CEO vẫn quyết). Không đụng kỳ đã đóng.

## 4. HIỆU LỰC
- **effective_from = 2026-07** (áp từ T07.2026). T07 là kỳ ĐANG MỞ → số thưởng T07 sẽ **tính lại** (P2 giảm mạnh so với bản cũ). Không đụng kỳ đã đóng. Versioned (giai đoạn) như v2.

## 5. UI (kèm)
- Ô chọn NV ở menu cấu hình: thêm lựa chọn **"Toàn bộ NV (mức chung)"** (= tầng Mặc định) song song chọn từng NV (tầng NV đè).
- Preview P2 phải hiện: từng nhóm · doanh thu nhóm · target nhóm · vượt nhóm · rate · P2_g · tổng P2 (để CEO đối chiếu).

## 6. RÀNG BUỘC (giữ)
- Số "dự kiến/tham khảo", **KHÔNG payroll/không gửi thưởng/không sửa DataHub**. Self-scope. Nhóm chỉ từ **C10 chính thức** (không App Sale tech_rank). C32/C47 khóa.
- P2 KHÔNG được tính trên toàn bộ doanh thu nhóm (lỗi cũ) — **chỉ phần vượt target nhóm**.

## 7. NGHIỆM THU
1. Ví dụ DN006 (target tổng 2.693.559.151đ · doanh thu 3.423.138.838đ · vượt 729.579.687đ): P2 mới **nhỏ hơn hẳn** bản cũ; đối chiếu tay từng nhóm khớp.
2. Nhóm chưa giao target → P2_g = 0 (không lấy trọn doanh thu nhóm). C10 thiếu → nhóm đó 0.
3. Preview hiện đủ chi tiết từng nhóm. Số kỳ đã đóng không đổi. Test PASS. Ghi CHANGELOG.
