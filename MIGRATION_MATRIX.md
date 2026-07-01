# MIGRATION_MATRIX — App Report cũ → App Report New

Cập nhật: 2026-07-02

Trạng thái: `done` = đã có dữ liệu + UI/API cơ bản + test quyền; `partial` = có nền nhưng thiếu UI/logic app cũ; `todo` = chưa chuyển.

| App cũ | App mới | Trạng thái | Việc còn lại |
|---|---|---:|---|
| Đăng nhập OTP | Login SĐT/OTP | done | Session bền hơn nếu nhiều instance |
| Tổng quan | Overview | partial | Bổ sung biểu đồ/tuyến/nhà thầu giống app cũ |
| Doanh thu | Revenue | partial | Đã thêm bộ lọc backend: kỳ/NV/ĐV/SP/tuyến/UT/nhà thầu/gói/tìm kiếm; cần đối chiếu UI 1:1 app cũ |
| Doanh thu đầy đủ | DT đầy đủ | done | Đã có bảng chi tiết từng dòng, pagination, export Excel, test scope CEO/DN009; còn PDF/mẫu cũ nếu CEO cần |
| Sản phẩm | Sản phẩm | partial | Đã có tab top SP/mã QLNB + độ phủ đơn vị/NV/gói thầu; cần bổ sung hoạt chất/nhóm thuốc nếu app cũ còn dùng |
| CST / Cơ số thầu | TenderQuota | partial→P0 đang làm | Dữ liệu thật đã import; đã thêm lọc; còn cần giao diện/bảng giống app cũ và cảnh báo đầy đủ |
| Phân tích | Phân tích | partial | Đã có so kỳ trước, tăng/giảm đơn vị & sản phẩm, cơ cấu tuyến/nhà thầu/UT; cần bổ sung biểu đồ/mẫu cũ nếu CEO cần |
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
4. Doanh thu đầy đủ đã có bảng dòng chi tiết + export Excel.
5. Sản phẩm/Phân tích đã có tab cơ bản để CEO/NV xem theo quyền.

## P1 sau P0
1. Đối chiếu giao diện/logic từng tab với app cũ bằng 04/05/06.2026.
2. Bổ sung PDF/print và mẫu export cũ.
3. Hoàn thiện cảnh báo CST/doanh thu và kho dữ liệu/rollback.
