# SPEC — Parity Phân tích + CST dễ hiểu cho NV + Lọc theo từng mã đơn vị

> Claude Code chốt (CEO yêu cầu 2026-07-02). Bot triển khai; Claude review. Mọi số qua backend + scope; không bịa số; không đụng nguồn đã cách ly 3860.

## A) TAB PHÂN TÍCH — rà parity đầy đủ với nguồn đã cách ly
Hiện `web/src/pages/Analysis.jsx` đã có: so kỳ trước (KPI delta), tăng/giảm ĐV + SP, 3 donut (tuyến/nhà thầu/gói), top 10 ĐV/SP, PeriodFilter, bộ lọc đầy đủ.
**Bot làm (chỉ bot đọc được source cũ):**
1. Trích **từng KPI / block / nút** của tab `pt` nguồn đã cách ly từ `report-main-v23.js` + `report-extra.js` (+ `report.html`).
2. Lập **bảng đối chiếu**: mục nguồn đã cách ly ↔ App Report ↔ trạng thái (đã có / thiếu / khác).
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

## C2) Ô lọc TÌM KIẾM TIÊN ĐOÁN + PHÂN BIỆT thuốc trùng tên (CEO yêu cầu 2026-07-03)
### Typeahead cho "Tất cả đơn vị" + "Tất cả sản phẩm"
- Đổi 2 select này thành **combobox có ô gõ**: gõ `cefi` → lọc danh sách ngay. Tìm theo **tên + mã QLNB (iit_code) + hoạt chất** (đơn vị: tên + mã ĐV). Áp cả trang Sản phẩm/DT/Phân tích/CST cho nhất quán.

### Phân biệt thuốc TRÙNG TÊN (gốc: 1 tên ↔ nhiều mã QLNB)
- **Định danh sản phẩm = `iit_code` (mã QLNB), KHÔNG phải tên.** Dropdown hiện trùng "Alusi" vì có ≥2 mã QLNB cùng tên.
- **Sửa:** mỗi option (và thẻ) hiện **tên + chuỗi phân biệt**: `Tên · [hoạt chất/hàm lượng] · [ĐVT] · [nhà thầu] · [QĐ139/141] · [mã QLNB]`. **Value của option = `iit_code`** (duy nhất) → không nhầm.
- 4 trường hợp trùng tên đều phân biệt bằng bộ thuộc tính trên:
  - 2 mã QLNB → hiện mã QLNB.
  - 2 nhà thầu → hiện tên nhà thầu.
  - 2 ĐVT (ml/gói vs gam/gói) → hiện ĐVT (UOM).
  - nhiều giá/nhiều mã → hiện mã QLNB + giá thầu.
- **Tùy chọn:** toggle **"Gộp theo tên"** (tổng mọi biến thể cùng tên) ↔ **"Tách theo mã QLNB"** (mặc định, chi tiết). Khi gộp → gộp doanh thu/SL các mã cùng tên; khi tách → mỗi mã 1 dòng.
- Backend: filter sản phẩm nhận `iit_code` (đã có) thay vì tên; `/api/filters` trả option sản phẩm kèm thuộc tính phân biệt (name, iit_code, hoat_chat, ham_luong, uom, contractor, qd). Không đổi mô hình quyền.

### NHÀ THẦU + mọi bộ lọc: hiện MÃ + TÊN; 1 mã ↔ nhiều tên (CEO 2026-07-03)
- **Nhà thầu:** 1 **mã** nhà thầu có thể có **nhiều TÊN** (VD `07.trieu.g` → mấy tên). Ô lọc "Tất cả nhà thầu" phải hiện **`mã · tên đầy đủ`**; **khóa lọc = MÃ nhà thầu** → chọn 1 mã là **gom HẾT mọi tên biến thể** của mã đó. Nếu 1 mã nhiều tên → gộp về mã, nhãn hiện tên đại diện (+ "…" hoặc "(nhiều tên)").
- **Áp CHUNG cho mọi bộ lọc/hiển thị có mã↔tên:** nhà thầu, đơn vị, sản phẩm, NV, gói thầu, tuyến. Luôn hiện **mã + tên**, khóa lọc theo **mã** (định danh ổn định), không theo tên.
  - Thuốc: 1 **tên** → nhiều **mã QLNB** (đã xử ở trên) — phân biệt bằng mã.
  - Nhà thầu: 1 **mã** → nhiều **tên** — gom theo mã.
  - Nguyên tắc gốc: **tên chỉ là nhãn, MÃ là định danh** — lọc/gộp luôn theo mã.
- Typeahead nhà thầu: tìm được theo **mã + tên**.

### ‼ PHẠM VI: ÁP DỤNG TOÀN APP (CEO nhấn 2026-07-03)
Typeahead + phân biệt-theo-mã-QLNB + lọc-theo-mã-đơn-vị phải **nhất quán ở MỌI nơi có bộ lọc/danh sách đơn vị-sản phẩm**, không chỉ trang Sản phẩm:
- **Doanh thu** (NV/ĐV/SP + drill-down), **DT đầy đủ**, **Sản phẩm**, **Phân tích**, **Cơ số thầu**, **Tổng quan** (Top 10 ĐV/SP), **Hỏi nhanh** (khi tham chiếu SP), **Target** (ô ĐV nếu có).
- **Ô lọc dùng chung 1 component** (combobox typeahead + option có thuộc tính phân biệt, value=iit_code / mã ĐV) để đồng bộ; sửa 1 nơi, mọi trang được.
- **Export Excel** cũng mang **mã QLNB + thuộc tính phân biệt** (không chỉ tên) để file xuất không nhầm biến thể.
- Nguyên tắc chung toàn app: **định danh sản phẩm = iit_code, định danh đơn vị = mã ĐV** — tên chỉ là nhãn hiển thị.

## Nghiệm thu
- Lọc typeahead: gõ vài ký tự (tên/mã QLNB/hoạt chất) ra đúng gợi ý; chọn được cả khi danh sách dài.
- Trùng tên: 2 dòng "Alusi" hiện rõ khác nhau (mã QLNB/ĐVT/nhà thầu/QĐ/giá); lọc theo mã QLNB không nhầm; toggle gộp/tách chạy đúng, số khớp tổng.
- Phân tích: bảng parity xuất ra; các block thiếu được bù, số khớp KPI/bảng cùng kỳ; scope đúng.
- CST: NV đọc hiểu ngay "nên làm gì"; xem gom theo ĐV + chi tiết mã QLNB; tiến độ rõ.
- Lọc ĐV: chọn 001 → chỉ mã QLNB của 001 + header tóm tắt; NV sale chỉ thấy ĐV của mình; CEO thấy tất cả. Áp dụng nhất quán CST/DT/Phân tích.
- Mobile 1 cột, PC nhiều cột theo mẫu Phân tích. Build OK.
