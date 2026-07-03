# DIRECTIVE — Thẻ V2: mã màu theo QĐ + giá trúng thầu + ưu tiên + lọc theo ngày + giờ đồng bộ

> Claude Code giao (CEO 2 ảnh 2026-07-03). Bot triển khai; Claude review. Áp thẻ Doanh thu/DT đầy đủ/Sản phẩm + đồng bộ CST. Không đụng app cũ 3860.

## H1 — Chỉnh trên thẻ + bộ lọc (DT đầy đủ và tương tự)
1. **Giờ đồng bộ thực + múi giờ:** hiện rõ **"Cập nhật đến 8h30 GMT+7"** (kèm GMT+7), theo `data_as_of`.
2. **Lọc theo NGÀY + preset:** thêm **chọn Từ ngày → Đến ngày** để lọc doanh thu theo ngày; kèm nút nhanh **Ngày · Tuần · Tháng · Quý**. (Xem "LƯU Ý DỮ LIỆU" bên dưới.)
3. **Bỏ ô "Gói thầu 139"** (trùng badge QĐ139 ở trên) → **thay bằng "Giá trúng thầu"** (= `bid_price`/giá thầu). Mã gói thầu đầy đủ vẫn dùng cho bộ lọc, không cần ô riêng gây trùng.
4. **Tên thuốc kèm hoạt chất + hàm lượng** (QĐ139 hiện; **QĐ141 KHÔNG hiện hoạt chất**).
5. **Nhà thầu = MÃ + TÊN ĐẦY ĐỦ**, định dạng **`01.AFP - CÔNG TY TNHH AFP PHARMA`**. 1 mã có nhiều tên (VD `07.TRIEU.G`) → lọc theo MÃ gom hết tên; hiển thị tên đầy đủ.
6. **Thêm ô "Ưu tiên" (UT):** hiện nhóm ưu tiên `H.A* / H.A / H.B / …` trên thẻ (và cho lọc).

## H2 — MÃ MÀU thẻ theo QĐ + bố cục bảng (theo ảnh mẫu)
- **Nền thẻ theo loại QĐ (như ảnh CEO khoanh):**
  - **QĐ139 (Generic) → nền VÀNG/CAM nhạt** + badge góc `QĐ139` cam.
  - **QĐ141 (Đông Y) → nền XANH nhạt** + badge góc `QĐ141` xanh.
- **Bố cục dạng BẢNG gọn** như ảnh: tiêu đề = tên thuốc (đậm) + hoạt chất/hàm lượng (QĐ139); lưới ô: **Mã QLNB · ĐVT · Đơn giá/Giá thầu · CST · SL còn · % còn** (tùy trang); hàng tag: TT20/nhóm/UT; box "Lưu ý/cảnh báo" nếu có.
- Áp nhất quán: Sản phẩm, DT đầy đủ, CST (CST đã có nền theo trạng thái — phối để không xung đột: ưu tiên badge QĐ + nền QĐ, cảnh báo vẫn nổi bật).

## ‼ LƯU Ý DỮ LIỆU — lọc theo NGÀY (Claude cần Anh biết)
Lọc theo ngày **chỉ chính xác khi dữ liệu có ngày chi tiết**:
- **T07/2026+ (App Sale):** đơn có `created_at`/ngày → **lọc theo ngày/tuần OK**.
- **01–06/2026 (Lumos đóng băng):** là **số tổng theo THÁNG**, có thể **không có chi tiết từng ngày** → lọc theo ngày ở các kỳ này có thể không tách được.
- **Xử:** bot xác nhận độ chi tiết ngày của từng nguồn; kỳ nào có ngày → cho lọc ngày/tuần; kỳ chỉ có tháng → nút Ngày/Tuần báo "kỳ này chỉ có số theo tháng". Không bịa phân bổ ngày.

## BỔ SUNG (Claude review 2026-07-03): nhà thầu — DÙNG LẠI map mã→tên đã có
Bot báo AFP/DONA "chỉ có mã" → nhưng **tên đầy đủ ĐÃ có trong app**: trang Phân tích + ô lọc nhà thầu (`/api/filters` label `MÃ · TÊN`) đang hiện tên đầy đủ. Vậy **thẻ phải DÙNG LẠI đúng map mã→tên đó** (không phải bịa):
- Xây/tái dùng **1 lookup `mã nhà thầu → tên đầy đủ`** từ nguồn đã có (dòng doanh thu/CST có `contractor_name`, hoặc bảng map filter) → gắn vào thẻ dạng `01.AFP - CÔNG TY TNHH AFP PHARMA`.
- **1 mã nhiều tên** (VD `07.TRIEU.G`): hiện tên đại diện đầy đủ nhất (+ "…" nếu còn tên khác).
- **Chỉ khi mã KHÔNG có tên ở BẤT KỲ nguồn nào** → mới hiện mã trần (đúng "không bịa"). Đối chiếu: tên đã hiện ở Phân tích thì thẻ cũng phải có.

## ‼‼ FIX — LÀM ĐỦ & ĐỒNG BỘ 3 TAB (CEO bực 2026-07-03: vẫn thiếu sót)
Ảnh DT đầy đủ cho thấy thẻ **thiếu**: hoạt chất/hàm lượng, **Giá trúng thầu**, tên nhà thầu, Ưu tiên đang trống "—". Bot mới áp tab Sản phẩm, **chưa đồng bộ DT đầy đủ/Doanh thu**.
**BẮT BUỘC: MỖI thẻ ở CẢ 3 tab (Sản phẩm · DT đầy đủ · Doanh thu) phải có ĐỦ các field sau — kiểm từng cái:**
1. **Tên thuốc (đậm)** + (QĐ139) **hoạt chất · hàm lượng** ngay dưới tên. QĐ141: chỉ tên (không hoạt chất).
2. Badge **QĐ139/QĐ141** + **nền màu** (139 vàng/cam, 141 xanh).
3. Mã QLNB (nhạt).
4. Đơn vị (mã.tên) · NV (mã · tên) · Tuyến.
5. Số lượng · Doanh thu.
6. **Giá trúng thầu** (bid_price) — PHẢI có, không được thiếu.
7. **Nhà thầu = mã - TÊN ĐẦY ĐỦ** (dùng map mã→tên; `AFP` → `AFP - Công Ty TNHH AFP Pharma`).
8. **Ưu tiên = H.A*/H.A/H.B…** — **PHẢI có giá trị**, không để trống "—" (dữ liệu UT đã có ở bộ lọc "Tất cả UT" + thẻ CST; kéo vào thẻ này).
**Trước khi báo XONG:** bot mở TỪNG tab (Sản phẩm, DT đầy đủ, Doanh thu), chụp 1 thẻ mỗi tab, **đối chiếu ĐỦ 8 mục trên**; field nào thiếu dữ liệu nguồn thì ghi rõ field + lý do (không lặng lẽ bỏ). Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện.

## Nghiệm thu
- Thẻ QĐ139 nền vàng/cam, QĐ141 nền xanh; badge góc đúng.
- Bỏ ô gói-139, có "Giá trúng thầu"; có ô "Ưu tiên"; nhà thầu `mã - tên đầy đủ`.
- Giờ đồng bộ hiện "…GMT+7". Lọc Từ ngày→Đến ngày + Ngày/Tuần/Tháng/Quý chạy (theo giới hạn dữ liệu).
- Số kế toán VN đầy đủ; mobile không tràn; build OK.
