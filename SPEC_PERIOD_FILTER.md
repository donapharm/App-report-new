# SPEC — Bộ lọc KỲ (tháng/quý/khoảng) + cân đối dashboard

> Claude Code chốt từ phản hồi CEO 2026-07-02. Bot triển khai; Claude review.
> Không đụng nguồn đã cách ly; mọi query qua scopeOf.

## 1. Bộ chọn kỳ dùng chung (thay dãy chip tháng phẳng)
Thanh chọn kỳ trên cùng, dùng cho: Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, Target.
- **Mặc định: tháng MỚI NHẤT có dữ liệu.** Có nút **‹ (lùi tháng)** và **(tới tháng) ›**.
- **3 chế độ (segmented):**
  1. **Tháng** — chọn 1 tháng (dropdown các kỳ có dữ liệu) + ‹ ›.
  2. **Quý** — chọn Q1(01–03)/Q2(04–06)/Q3(07–09)/Q4(10–12) + năm → gộp 3 tháng.
  3. **Khoảng** — Từ [tháng] → Đến [tháng] → gộp các tháng trong khoảng.
- Nhãn kỳ đang xem hiển thị rõ: "Tháng 06.2026" · "Quý 2/2026 (04–06)" · "01.2026 → 06.2026".
- Chỉ cho chọn trong phạm vi kỳ CÓ dữ liệu (không cho tới tháng tương lai trống).

## 2. Backend — nhận 1 tháng HOẶC khoảng nhiều tháng
- Các endpoint (`/overview`, `/revenue`, `/revenue/full`, `/products`, `/analysis`, `/targets`, `/filters`)
  nhận **`ky`** (1 tháng) **HOẶC** **`from`+`to`** (MM.YYYY). Nội bộ quy về danh sách kỳ `kys[]`.
- Thêm `store.getRowsRange({ kys, scope })` = gộp `getRows` mọi kỳ trong `kys` (giữ nguyên lọc quyền).
- Tổng hợp (doanh thu, top NV/ĐV/SP, DT đầy đủ, phân tích) chạy trên toàn bộ `kys`.
- **MoM "so kỳ trước":** Tháng → tháng liền trước; Quý/Khoảng → kỳ liền trước **cùng độ dài** (nếu đủ dữ liệu), không đủ thì ẩn %.
- **Target theo range:** cộng target các tháng trong `kys`.
- **Cơ số thầu (CST):** là ẢNH CHỤP hiện tại (không cộng theo tháng) → **KHÔNG đổi theo bộ lọc kỳ**; ghi nhãn "cơ số thầu hiện tại". Giữ nguyên bộ lọc riêng của tab CST.

## 3. Cân đối bố cục (polish)
- **6 ô KPI:** hàng đều nhau. PC: `grid-template-columns: repeat(6, 1fr)` (hoặc auto-fit nhưng ép tối thiểu để ra đúng 6 cột trên màn ≥1400px); màn vừa 3 cột×2 hàng; mobile 2 cột.
- **4 nhóm cảnh báo:** xếp **cân đối** — 4 cột đều trên màn rộng hoặc **2×2**, KHÔNG để 1 card lẻ 1 mình. (Đổi `.alerts-grid` cho nhóm alert: `repeat(auto-fit, minmax(330px,1fr))` để 4 nhóm vừa 1 hàng ở ~1536px, hoặc grid 2 cột cố định.)
- Ô KPI "Cơ số thầu sắp cạn" giữ bấm được → nhảy tab CST lọc <10%.

## 4. Nghiệm thu
- Mặc định vào = tháng mới nhất; ‹ › lùi/tới đúng; chọn Quý 2/2026 → tổng = 04+05+06; Khoảng 01→06 → tổng = cả 6 tháng (đối chiếu = tổng từng tháng cộng lại).
- KPI 6 ô đều hàng; 4 nhóm cảnh báo cân đối (không lẻ card).
- CST không đổi theo bộ lọc kỳ.
- CEO thấy toàn bộ; NV sale chỉ phạm vi mình; build OK.
