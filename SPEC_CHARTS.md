# SPEC — Biểu đồ (Recharts)

> Claude Code chốt (CEO duyệt 2026-07-02). Bot triển khai; Claude review.
> Thư viện: **Recharts** (hợp React/Vite). Mọi chart THEO bộ lọc kỳ + scope quyền.
> Không đụng nguồn đã cách ly. Mobile: ResponsiveContainer, xếp 1 cột; PC theo mẫu Phân tích.

## Nguyên tắc chung
- Màu theo thương hiệu: xanh `--brand`, cam `--accent`, cảnh báo đỏ/vàng. Nhất quán palette.
- Số do backend/analytics tính (không để chart tự bịa). Chart chỉ vẽ dữ liệu API trả.
- Scope: CEO/admin = toàn công ty; NV sale = phần mình. Truyền ky HOẶC from+to như các API khác.
- `ResponsiveContainer` để tự co; có trạng thái loading (Spinner) + rỗng ("Chưa có dữ liệu").
- Bundle: Recharts ~100KB gzip — chấp nhận; import lẻ component để tree-shake nếu được.

## 1) Đường doanh thu theo kỳ — trang TỔNG QUAN (đầu, dưới KPI)
- LineChart/AreaChart: X = các kỳ (toàn bộ listPeriods, vd 01→06), Y = doanh thu (sau VAT).
- Overlay đường **target** (nếu có) để thấy DT vs target theo thời gian.
- Backend MỚI: `GET /trend` → `[{ ky, revenue, revenueBeforeVat, targetTotal, pctTarget }]`
  cho MỌI kỳ trong listPeriods, theo scope. (Nhẹ; tái dùng getRowsRange/getTargets từng kỳ.)
- Tooltip: kỳ · DT · % đạt target. Điểm kỳ đang chọn (bộ lọc) tô đậm.

## 2) Cột Top đơn vị / Top sản phẩm — TỔNG QUAN + PHÂN TÍCH
- BarChart ngang, Top 10 theo doanh thu của kỳ/range đang chọn.
- Dữ liệu: **tái dùng** `GET /revenue?dimension=unit` và `?dimension=product` (đã có) → lấy 10 dòng đầu.
- Có toggle nhỏ: Đơn vị | Sản phẩm. Nhãn rút gọn tên dài; giá trị dạng tỷ/tr.

## 3) Donut cơ cấu — trang PHÂN TÍCH
- 3 donut (PieChart): **cơ cấu Tuyến** · **Top nhà thầu** · **cơ cấu Gói thầu (QĐ139/141)**.
- Dữ liệu: **tái dùng** `GET /analysis` (đã trả cơ cấu tuyến/nhà thầu/UT) — bổ sung cơ cấu gói thầu nếu chưa có.
- Mỗi donut: top 6 + gộp "Khác"; % + giá trị khi hover. Theo kỳ/range + scope.

## 4) Vòng tiến độ target — TỔNG QUAN + TARGET
- RadialBarChart (gauge): 
  - Tổng quan: 1 vòng lớn = **% đạt target toàn công ty** (pctTarget) kỳ/range đang chọn.
  - Target "Kỳ này": mỗi card NV thêm **vòng nhỏ** thay/kèm thanh bar (đạt/target). Màu: ≥100% xanh, 80–99% vàng, <80% đỏ.
- Dữ liệu: đã có (overviewKpis.pctTarget; /targets items pct). Không cần API mới.

## Nghiệm thu
- Đổi kỳ Tháng/Quý/Khoảng → tất cả chart cập nhật đúng theo kỳ.
- CEO thấy toàn công ty; 1 NV sale → chart chỉ dữ liệu của mình (không lộ người khác).
- Số trên chart khớp số trên bảng/KPI cùng kỳ (đối chiếu vài điểm).
- Mobile 1 cột, không tràn; PC nhiều cột theo mẫu Phân tích.
- Build OK; kiểm bundle size tăng hợp lý.
