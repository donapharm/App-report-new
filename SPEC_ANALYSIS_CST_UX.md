# SPEC — Parity Phân tích + CST dễ hiểu cho NV + Lọc theo từng mã đơn vị

> Claude Code chốt (CEO yêu cầu 2026-07-02). Bot triển khai; Claude review. Mọi số qua backend + scope; không bịa số; không đụng app cũ 3860.

## A) TAB PHÂN TÍCH — rà parity đầy đủ với app cũ
Hiện `web/src/pages/Analysis.jsx` đã có: so kỳ trước (KPI delta), tăng/giảm ĐV + SP, 3 donut (tuyến/nhà thầu/gói), top 10 ĐV/SP, PeriodFilter, bộ lọc đầy đủ.
**Bot làm (chỉ bot đọc được source cũ):**
1. Trích **từng KPI / block / nút** của tab `pt` app cũ từ `report-main-v23.js` + `report-extra.js` (+ `report.html`).
2. Lập **bảng đối chiếu**: mục app cũ ↔ app mới ↔ trạng thái (đã có / thiếu / khác).
3. Bù các mục **thiếu** (theo ma trận, dự kiến): **"SP cần đẩy mạnh"**, **"SP sắp hết CST"**, **"phân tích chuyên sâu"**, **PDF**. Xác nhận danh sách đầy đủ từ source, không chỉ dựa ma trận.
4. Mỗi block mới: số do `analytics.js`/`smart.js` tính, tôn trọng period + scope; NV sale không lộ dữ liệu người khác.
→ Xuất `artifacts/analysis_parity_<date>.md` (bảng đối chiếu) trước khi code, Claude review.

## B) TAB CƠ SỐ THẦU — giữ tính năng + LÀM DỄ HIỂU cho NV
Giữ toàn bộ tính năng `TenderQuota.jsx` hiện có (lọc, KPI, cảnh báo, trạng thái Hết CST/Chưa bán/…, Excel). **Thêm 4 lớp dễ hiểu:**
1. **Gợi ý hành động từng dòng** (kèm trạng thái): sắp hết (<10%) → "sắp hết, đẩy đơn bổ sung cơ số"; chưa bán → "cần tiếp cận đơn vị"; tồn nhiều (>80%) → "còn dư địa, đẩy mạnh"; hết CST → "đã khai thác hết". Câu ngắn, tiếng Việt đời thường.
2. **Gom theo ĐƠN VỊ (rollup)**: chế độ xem nhóm — mỗi ĐV 1 thẻ tóm tắt (số mã QLNB · số dòng sắp hết · số dòng chưa bán · tổng CST còn), bung ra xem chi tiết mã QLNB. Giữ chế độ danh sách phẳng hiện tại như một tuỳ chọn.
3. **Tiến độ rõ**: đã bán X% / còn Y% + thanh màu (đỏ <10, vàng <30 hoặc >80, xanh giữa). Nếu nguồn có hạn hợp đồng (`hd_den_ngay`) → thêm "còn N ngày".
4. **Ưu tiên hành động**: mặc định đẩy dòng cần làm (sắp hết + chưa bán) lên đầu; có toggle sắp xếp.
Lưu ý dữ liệu: sau cutover CST lấy App Sale (mục khác), nhưng **UX này độc lập nguồn** — làm được ngay trên dữ liệu hiện tại.

## C) LỌC THEO TỪNG MÃ ĐƠN VỊ (ưu tiên — CEO nhấn mạnh)
**Vấn đề:** 1 NV phụ trách nhiều ĐV (VD DN001: 001.BVĐK Đồng Nai, 002.BVĐK Thống Nhất…). Hiện lọc theo kiểu "cả tài khoản NV". CEO muốn **lọc theo TỪNG mã ĐV**: chọn `001.BVĐK Đồng Nai` → chỉ hiện **các mã QLNB tại đúng ĐV đó**.

**Thiết kế:**
1. **Ô chọn đơn vị nổi bật + tìm nhanh** (searchable select) làm kính lọc chính (vì danh sách ĐV dài). Đặt ở CST + Doanh thu + Phân tích cho nhất quán.
2. Chọn 1 ĐV → **header tóm tắt ĐV**: tên/mã ĐV · số mã QLNB · tổng CST còn · số dòng sắp hết · chưa bán → rồi **danh sách CHỈ mã QLNB của ĐV đó** (gọn).
3. **Theo quyền (backend quyết):** NV sale → danh sách ĐV chỉ gồm ĐV NV đó phụ trách; CEO/admin → tất cả, hoặc chọn NV trước rồi ĐV. `/api/filters` phải trả `units` **đã lọc theo scope + theo NV đang chọn** (không trả toàn bộ ĐV công ty cho NV sale).
4. Giữ tương thích: các bộ lọc khác (SP, gói, UT, tuyến, search) vẫn chồng được lên khi đã chọn ĐV.
5. Kỹ thuật: tái dùng param `unit` đã có ở `/api/cst`, `/api/revenue`, `/api/analysis`; chủ yếu là **nâng UX** (ô chọn nổi bật + header tóm tắt ĐV + danh sách gọn), không đổi mô hình quyền.

## Nghiệm thu
- Phân tích: bảng parity xuất ra; các block thiếu được bù, số khớp KPI/bảng cùng kỳ; scope đúng.
- CST: NV đọc hiểu ngay "nên làm gì"; xem gom theo ĐV + chi tiết mã QLNB; tiến độ rõ.
- Lọc ĐV: chọn 001 → chỉ mã QLNB của 001 + header tóm tắt; NV sale chỉ thấy ĐV của mình; CEO thấy tất cả. Áp dụng nhất quán CST/DT/Phân tích.
- Mobile 1 cột, PC nhiều cột theo mẫu Phân tích. Build OK.
