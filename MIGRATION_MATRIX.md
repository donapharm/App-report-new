# MIGRATION_MATRIX — App Report cũ → App Report New

Cập nhật: 2026-07-02

Trạng thái: `done` = đã có dữ liệu + UI/API cơ bản + test quyền; `partial` = có nền nhưng thiếu UI/logic app cũ; `todo` = chưa chuyển.

| App cũ | App mới | Trạng thái | Việc còn lại |
|---|---|---:|---|
| Đăng nhập OTP | Login SĐT/OTP | done | Session bền hơn nếu nhiều instance |
| Tổng quan | Overview | partial | Bổ sung biểu đồ/tuyến/nhà thầu giống app cũ |
| Doanh thu | Revenue | partial→P0 đang làm | Đã thêm bộ lọc backend: kỳ/NV/ĐV/SP/tuyến/UT/nhà thầu/gói/tìm kiếm; còn cần bảng chi tiết dòng |
| Doanh thu đầy đủ | Chưa tách tab | todo | Tạo tab/bảng chi tiết đầy đủ, pagination/export |
| Sản phẩm | Revenue dimension product | partial | Cần tab Sản phẩm riêng với top SP, hoạt chất, đơn vị bán, gói thầu |
| CST / Cơ số thầu | TenderQuota | partial→P0 đang làm | Dữ liệu thật đã import; đã thêm lọc; còn cần giao diện/bảng giống app cũ và cảnh báo đầy đủ |
| Phân tích | Chưa có tab riêng | todo | Chuyển phân tích tuyến/NV/nhà thầu/tăng giảm |
| Nhân viên | Chưa có tab riêng | todo | Chuyển bảng NV/quyền/phạm vi nếu CEO còn dùng |
| Target | Target | partial | Dữ liệu thật 01→06; cần UI đối chiếu giống app cũ hơn nếu cần |
| My Target | Target theo quyền sale | partial | Sale đã tự scope; cần màn riêng nếu cần |
| Đối chiếu | Chưa có | todo | Xác định phần CEO còn dùng rồi chuyển |
| Upload/Kho dữ liệu | Upload | partial | Có upload slot; cần kho/lịch sử/rollback giống app cũ hơn |
| Export Excel/PDF | Excel cơ bản | partial | Excel có lọc; PDF/chủng loại mẫu cũ chưa chuyển |
| AI hỏi nhanh | AiChat | partial | Cần nối sâu CST/Target/Revenue chi tiết và test câu hỏi thực tế |

## P0 Đợt 2 đang triển khai
1. Bộ lọc chung Doanh thu/CST chạy backend theo quyền.
2. CST thật hiển thị nhiều trường hơn: NV, giá thầu, tiền đã bán, tiền còn lại, UT.
3. Export Excel tôn trọng bộ lọc đang chọn.

## P1 sau P0
1. Tab Doanh thu đầy đủ dạng bảng chi tiết có phân trang.
2. Tab Sản phẩm riêng.
3. Tab Phân tích/tuyến/nhà thầu/tăng giảm.
