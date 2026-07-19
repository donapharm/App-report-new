# DIRECTIVE — Polish UI: Tổng quan chậm + hiển thị QĐ/hoạt chất + CST bỏ giá bán + sửa "Nguồn"

> Claude Code giao (CEO feedback qua ảnh 2026-07-02). Bot triển khai; Claude review. Không đụng nguồn đã cách ly 3860. Số do backend tính, giữ đúng tổng.

## H1 — TỔNG QUAN trả kết quả RẤT CHẬM (ưu tiên)
Biểu đồ "Doanh thu theo kỳ" + "Top 10" quay spinner lâu.
**Bot làm:**
1. **Đo thời gian** từng API trên Tổng quan (`/trend`, `/overview`, `/revenue` top, `/analysis`, alerts) → tìm call chậm nhất.
2. Tối ưu call chậm: **cache/memoize kết quả tổng hợp theo kỳ** (mỗi kỳ tính 1 lần), giảm quét `allRows()` lặp; nếu `/trend` quét mọi kỳ → precompute/cache.
3. **Lazy-load / tải song song biểu đồ**: hiện KPI ngay, chart tải sau; không để cả trang chờ 1 request.
4. Mục tiêu: Tổng quan mở nhanh, không quay spinner kéo dài. Ghi thời gian trước/sau vào CHANGELOG.

## H2 — DOANH THU (tab Sản phẩm) + Sản phẩm: thêm QĐ + hoạt chất/hàm lượng
1. **Thêm số QĐ (139/141…)** vào thông tin mỗi dòng SP (đọc từ mã QLNB/gói, VD `...QĐ139...`).
2. **Với SP thuộc QĐ139: hiện thêm hoạt chất + hàm lượng** (generic — cần định danh). **QĐ141: KHÔNG hiện** (giữ tên biệt dược).
3. Nguồn hoạt chất/hàm lượng: product master / dòng CST đã có `active_ingredient`, `ham_luong` — nối vào breakdown SP. Nếu thiếu nguồn cho SP nào → để trống, không bịa.

## H3 — CƠ SỐ THẦU (card)
1. **BỎ "Giá bán"** khỏi card (trùng "Giá thầu" — như ảnh cả hai đều 1.690). Giữ **Giá thầu**.
2. **Thêm số QĐ (139/141)** rõ ràng thành 1 nhãn riêng (hiện đang lẫn trong mã QLNB/gói).
3. **Với QĐ139: thêm hoạt chất + hàm lượng**; QĐ141: không (nhất quán H2). CST hiện đã có `active_ingredient`/`ham_luong` → hiển thị có điều kiện theo QĐ.

## "NGUỒN" — sửa, đang hiển thị SAI/khó hiểu
Card CST hiện "Nguồn `01-MAY-26`" trong khi dữ liệu đã gồm bán đến **06.2026** → gây hiểu nhầm (đó là ngày dump baseline cũ, không phải kỳ dữ liệu thực).
**Bot làm:**
1. Xác định lại **semantics đúng** của "Nguồn": phải phản ánh **kỳ/thời điểm dữ liệu thực tế đang thể hiện** (baseline + đã merge upload đến kỳ nào), KHÔNG phải ngày dump baseline trần.
2. Đổi hiển thị: VD **"Cập nhật đến kỳ 06.2026"** (kỳ merge mới nhất) hoặc as-of đúng; nếu cần giữ cả gốc baseline thì ghi rõ "baseline 05.2026 + bán đến 06.2026". Miễn NV đọc hiểu đúng dữ liệu tới đâu.
3. Sau cutover App Sale, "Nguồn" chuyển sang phản ánh timeline App Sale (mục SPEC_DATASOURCE_CUTOVER).

## Nghiệm thu
- Tổng quan mở nhanh, KPI hiện ngay, chart không treo spinner lâu; số không đổi.
- SP/DT: dòng QĐ139 hiện hoạt chất+hàm lượng+số QĐ; QĐ141 chỉ tên+số QĐ.
- CST: hết "Giá bán"; có số QĐ; QĐ139 có hoạt chất+hàm lượng.
- "Nguồn" hiển thị đúng kỳ dữ liệu thực (không còn 01-MAY-26 gây hiểu nhầm).
- Mobile 1 cột/PC nhiều cột; build OK; scope giữ nguyên.
