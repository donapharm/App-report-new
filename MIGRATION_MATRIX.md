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
| CST / Cơ số thầu | TenderQuota | done | Bảng đủ cột + cảnh báo/trạng thái giống app cũ; đối chiếu CST đã khớp app cũ **2.741 dòng** |
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

## P0 CST — hoàn tất 2026-07-02

- UI CST đã chuyển sang bảng ngang đầy đủ cột nghiệp vụ giống app cũ: mã QL nội bộ, tên thuốc, hoạt chất, hàm lượng, ĐVT, nhóm, UT, gói thầu, đơn vị, NV phụ trách, giá thầu/giá bán, tổng TT, CST còn lại, % còn lại, tổng/SL đã bán, SL còn, TT đã bán, TT còn lại, ngày nguồn, trạng thái.
- Cảnh báo/trạng thái theo logic app cũ: Hết CST, ⚠️ Chưa bán, 🔴 Chưa khai thác, 🟡 Còn nhiều, ✅ Đang bán; có chip lọc “Chưa bán” và thống kê cảnh báo trên trang.
- Kiểm quyền/số sau chốt giữ dòng thiếu mã QLNB: CEO 2.741 dòng; DN009 85 dòng và không có dòng ngoài DN009; `<10%` 291 dòng; “Chưa bán” 1.229 dòng. Build OK.

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

## Bước 3 mở rộng theo từng tab — CST đã KHỚP sau chốt giữ dòng thiếu mã QLNB (2026-07-02)

Artifacts kiểm tra:
- Mismatch ban đầu: `artifacts/reconcile_tabs_until_cst_mismatch_20260702.json`.
- Sau xử lý: `artifacts/reconcile_cst_resolved_20260702.json`.

Chốt nghiệp vụ của Claude/CEO: **giữ dòng dữ liệu thật thiếu mã QLNB** (`Bividia 25` · `108. BVĐK LONG AN` · `DN001` · còn `44.000` · TT còn `79.200.000`). Nguyên tắc importer: không loại dòng thật chỉ vì thiếu field phụ (`iit_code`...); với CST, filter chỉ còn `unit_code` và `bid_qty_initial > 0`.

Kết quả đối chiếu CST sau re-import:

| Nguồn | Dòng | Tổng CST ban đầu | Tổng SL đã bán | Tổng SL còn | Tổng TT còn lại | Chênh |
|---|---:|---:|---:|---:|---:|---:|
| App cũ `artifacts/cst_full_from_old.json` | 2.741 | 182.837.992 | 62.993.027 | 120.068.002 | 399.841.752.609 | — |
| App mới `server/data/cst_real.json` | 2.741 | 182.837.992 | 62.993.027 | 120.068.002 | 399.841.752.609 | 0 |

Dòng thiếu mã QLNB đã được giữ trong app mới:

| Trường | Giá trị |
|---|---|
| `source_from_date` | `01-MAY-26` |
| `unit_code_name` | `108. BVĐK LONG AN` |
| `product_name` | `Bividia 25` |
| `iit_code` | *(rỗng; UI hiển thị `—`)* |
| `emp_code` | `DN001` |
| `cst_ban_dau` / `sl_con_lai` | `44.000` / `44.000` |
| `gia_thau` / `tt_con_lai` | `1.800` / `79.200.000` |
| `raw_nv` | `284` |

Kiểm downstream sau sửa:
- `store.getCst({scope:null})`: 2.741 dòng; `blankIit=1`.
- `store.getCst({scope:{empCode:'DN009'}})`: 85 dòng, `badScope=0`.
- Cảnh báo vẫn tính đúng từ số lượng: `<10%` = 291 dòng; “Chưa bán” = 1.229 dòng.
- UI mã QLNB rỗng hiển thị `—`; định danh dòng fallback bằng `product_name + unit + emp` để không gộp/đè dòng thiếu mã.

## P1 sau P0
1. Đối chiếu giao diện/logic từng tab với app cũ bằng 04/05/06.2026.
2. Bổ sung PDF/print và mẫu export cũ.
3. Hoàn thiện cảnh báo CST/doanh thu và kho dữ liệu/rollback.
