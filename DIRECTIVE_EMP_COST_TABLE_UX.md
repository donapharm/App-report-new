# DIRECTIVE — Bảng "Chi phí của tôi": STT · Xem tất cả NV · thu hẹp cột % · tìm kiếm thông minh (CEO 2026-07-22)

> Claude Code giao Report Bot. 4 cải tiến UX bảng chi phí + vài ý thông minh. Làm **cùng nhánh review gap tool + export**
> (deploy 1 lượt). Giữ: self-scope, số backend, C32/C47 khóa.

## 1. CỘT STT (số thứ tự) — cột ĐẦU TIÊN
- Thêm cột **"STT"** đầu bảng, **tự nhảy số 1..N** theo **các dòng đang hiển thị** (sau lọc/tìm/sắp xếp).
- Lọc DN001 ra 100 dòng → STT 1..100. Xem tất cả NV → **1..tổng số dòng**.
- STT **cập nhật lại** mỗi khi đổi bộ lọc/từ khóa tìm. Có mặt cả trong **Excel/PDF** (cột 1).

## 2. XEM "TẤT CẢ NHÂN VIÊN" (chỉ CEO/ADMIN)
- Ô lọc NV hiện chỉ chọn **1 NV**. Thêm lựa chọn **"Tất cả nhân viên"** (đầu danh sách) — gộp dòng của **mọi NV**.
- **‼ Chỉ CEO/ADMIN** (backend khóa). **NV thường KHÔNG có** lựa chọn này (chỉ thấy của mình).
- Khi xem tất cả: **thêm cột "Nhân viên" (mã · tên)** để biết dòng của ai; **tổng phụ theo NV** (subtotal mỗi NV) +
  tổng chung; có thể **gộp/mở theo NV**. KPI = tổng hợp toàn bộ (CEO-only).
- **Hiệu năng:** dữ liệu lớn (21 NV × ~200 dòng) → **phân trang / cuộn ảo (virtualize)**; STT + tìm kiếm vẫn chạy trên
  toàn tập, không chỉ trang hiện tại.

## 3. THU HẸP CỘT % (nhìn gọn đẹp)
- Các cột % (C36/C41/C43/C44/C45) đặt **độ rộng cố định hẹp**, vừa đủ con số (vd `12,0`), **căn phải · tabular-nums**.
- **Tiêu đề cột % rút ngắn**: chỉ hiện **mã ngắn** (vd `C36`) + **tooltip/di chuột hiện tên đầy đủ** ("CP ctv/khác (%)")
  → giữ cột hẹp mà vẫn tra được nghĩa. (Cột Thành tiền giữ đủ rộng cho tiền.)

## 4. Ô TÌM KIẾM THÔNG MINH (toàn bảng)
- Thêm **1 ô tìm kiếm** trên bảng, lọc **mọi cột** (ngày, mã đơn, tuyến, đơn vị, nhà thầu, mã QLNB, tên hàng, hàm lượng,
  ĐVT, và cột NV khi xem tất cả).
- **‼ Thông minh — BỎ DẤU + không phân biệt hoa/thường:** gõ `cerecaps` ra `Cerecaps`; gõ **không dấu** `dviet` vẫn ra
  `Đức Việt`/`đơn vị`… (normalize bỏ dấu tiếng Việt cả từ khóa lẫn dữ liệu). Đây là điểm tiện nhất cho người Việt.
- **Lọc trực tiếp khi gõ (live)**; **đếm "hiện X/Y dòng"**; **tô sáng (highlight) phần khớp**.
- Tìm kiếm **kết hợp** với bộ lọc NV + kỳ hiện tại (tìm trong phạm vi đang xem). STT đánh lại theo kết quả tìm.
- (Tùy chọn) hỗ trợ **nhiều từ khóa** (cách nhau khoảng trắng = AND). Dữ liệu 1 NV lọc ở client (nhanh); "tất cả NV"
  lớn thì lọc server hoặc tải rồi lọc client tùy khối lượng.

## 5. Ý THÔNG MINH THÊM (Claude tư vấn)
- **Sticky:** giữ **header** + cột **STT/Tên hàng** khi cuộn ngang bảng rộng → luôn biết đang đọc dòng/cột nào.
- **Sắp xếp cột:** cho click tiêu đề để **sort** (doanh thu, thành tiền, ngày…) — STT đánh lại theo thứ tự mới.
- **Chip trạng thái:** hiện chip "Đang lọc: DN001 · từ khóa 'atisyrup' · 12/224 dòng" + nút xóa nhanh.
- Search/lọc/sort/STT **phản ánh vào Export** (xuất đúng cái đang thấy).

## 6. GIỮ NGUYÊN / RANH GIỚI
- **Self-scope:** "Tất cả NV" + xem NV khác = **CEO/ADMIN only** (backend ép). NV thường chỉ của mình.
- Số từ backend (không bịa), C32/C47 không lộ, VAT-trước, C44 cuối năm tách, audit — giữ.

## 7. NGHIỆM THU
1. STT nhảy đúng 1..N theo dòng hiển thị; đổi lọc/tìm → đánh lại; có trong Excel/PDF.
2. CEO chọn "Tất cả nhân viên" → thấy mọi NV + cột Nhân viên + tổng phụ; **NV thường không có lựa chọn này** (thử → chặn).
3. Cột % hẹp gọn, tiêu đề ngắn + tooltip; bảng nhìn cân đối.
4. Ô tìm: gõ **không dấu/hoa-thường** vẫn ra; live + đếm X/Y + highlight; kết hợp lọc NV/kỳ; STT theo kết quả.
5. Sticky header/cột khi cuộn; sort cột; export phản ánh lọc/tìm/sort/STT. Self-scope + C32/C47 giữ.
6. Test + build PASS. Push cùng nhánh review; báo Claude; chưa deploy.
