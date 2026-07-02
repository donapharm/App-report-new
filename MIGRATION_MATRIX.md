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
| CST / Cơ số thầu | TenderQuota | partial (P0 dữ liệu/lọc done) | Dữ liệu thật đã import; lọc backend theo quyền đã fix chuẩn hoa/thường (`9c77f02`, Claude duyệt); còn cần giao diện/bảng giống app cũ và cảnh báo đầy đủ |
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

## Bước 3 — Đối chiếu doanh thu app cũ ↔ app mới đủ 01→06/2026

Kết luận 2026-07-02: **KHỚP 100%**, không có kỳ lệch số. Đối chiếu tính trực tiếp từ file nguồn, không làm tròn.

Nguồn đối chiếu:
- 01→03/2026: artifact ORDS đã dump theo logic app cũ tại `artifacts/revenue_ords_202601_202603/`.
- 04→06/2026: file upload app cũ tại `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_*.json`.
- App mới: `store.getRows({ ky, scope:{ empCode:null } })` sau import slot active.

| Kỳ | Nguồn app cũ | Dòng cũ | Tổng cũ | Dòng mới | Tổng mới | Chênh dòng | Chênh tiền | NV | Dòng mẫu đã khớp |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 01.2026 | ORDS artifact `report_upload_data_20260101_20260131.json` | 2.094 | 32.509.346.732 | 2.094 | 32.509.346.732 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Crexor 10 · SL 220.000 · 187.000.000 |
| 02.2026 | ORDS artifact `report_upload_data_20260201_20260228.json` | 1.308 | 17.507.218.993 | 1.308 | 17.507.218.993 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 19.980 · 17.382.600 |
| 03.2026 | ORDS artifact `report_upload_data_20260301_20260331.json` | 2.175 | 33.773.738.542 | 2.175 | 33.773.738.542 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 49.980 · 43.482.600 |
| 04.2026 | App cũ `report_upload_data_20260401_20260430.json` | 2.282 | 34.794.142.431 | 2.282 | 34.794.142.431 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 79.980 · 69.582.600 |
| 05.2026 | App cũ `report_upload_data_20260501_20260529.json` | 1.600 | 30.398.950.820 | 1.600 | 30.398.950.820 | 0 | 0 | 21 | DN001 · 171.PKĐK NAM VIỆT · Cerecaps · SL 4.980 · 13.246.800 |
| 06.2026 | App cũ `report_upload_data_20260601_20260630.json` | 2.001 | 28.403.136.096 | 2.001 | 28.403.136.096 | 0 | 0 | 22 | DN003 · 019.TTYT H. Vĩnh Cửu · Nadecin 10mg · SL 1.000 · 2.600.000 |

Ghi chú kiểm soát: nếu lần đối chiếu sau phát hiện kỳ nào lệch, phải **dừng**, ghi rõ chênh lệch + nguồn, chờ xử lý; không tự ý làm tròn/làm khớp.

## P1 sau P0
1. Đối chiếu giao diện/logic từng tab với app cũ bằng 04/05/06.2026.
2. Bổ sung PDF/print và mẫu export cũ.
3. Hoàn thiện cảnh báo CST/doanh thu và kho dữ liệu/rollback.
