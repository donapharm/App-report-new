# MIGRATION_PLAN — Chuyển App Report cũ sang App Report New

Cập nhật: 2026-07-01

## Nguyên tắc
- App cũ `dona-report`/`webapp_donapharm` vẫn giữ nguyên, chỉ đọc dữ liệu/source để đối chiếu.
- App mới không chỉ nạp dữ liệu; phải chuyển đủ **nghiệp vụ, màn hình, bộ lọc, export, phân quyền** theo từng phần.
- Mỗi phần chuyển xong phải test 2 quyền: CEO/admin thấy toàn bộ; NV sale chỉ thấy phạm vi của mình.
- Không mở/sửa dữ liệu nhạy cảm nếu chưa có kiểm quyền.

## Hiện trạng đã chuyển
- Public `https://reportnew.donapharm.asia` chạy bằng OTP thật, demo login đã tắt.
- Danh bạ NV thật đã nạp.
- **Đợt 1 nền dữ liệu đã hoàn tất trên server runtime:** doanh thu thật 01→06.2026; target thật 01→06.2026; CST thật từ `V_TEMP_PHARMA` + `SALES_REPORT`.
- Doanh thu 04/05/06 giữ theo file upload CEO đã chốt; 01/02/03 lấy từ ORDS `SALES_REPORT`.
- CST thật đã import 2.740 dòng, 60 đơn vị, 301 sản phẩm; CEO thấy toàn bộ, NV sale chỉ thấy phạm vi của mình.
- Target kỳ 06 đã lọc đúng NV có doanh thu trong kỳ.

## Những phần còn thiếu lớn so với app cũ

### P0 — Chuyển cho đủ lõi báo cáo đang dùng hằng ngày
1. **CST thật**
   - Nguồn: `V_TEMP_PHARMA` + `SALES_REPORT` từ 2025-03-01.
   - Cần dev viết importer/API trong app mới.
   - Cột cần có: mã QLNB, tên thuốc, hoạt chất/nồng độ, ĐVT, đơn vị, NV phụ trách, CST ban đầu, đã bán, còn lại, % còn, giá thầu, giá bán, TT thầu/đã bán/còn lại, gói thầu.

2. **Doanh thu đầy đủ từ 01/2026**
   - Importer thư mục đã có.
   - Cần chạy lại toàn bộ file upload chuẩn trong app cũ từ 01/2026 đến hiện tại, đối chiếu tổng từng kỳ.

3. **Các tab doanh thu chi tiết của app cũ**
   - App cũ có các nhóm: Tổng quan, Doanh thu, Doanh thu đầy đủ, Sản phẩm, CST, Phân tích, Nhân viên, Upload/Kho dữ liệu, Target/My Target, Đối chiếu.
   - App mới mới có phần lõi tương đương, chưa đủ UI/logic như app cũ.

### P1 — Chuyển tính năng quản trị/điều hành
4. **Bộ lọc đầy đủ như app cũ**
   - Kỳ từ/đến, tuyến, ưu tiên, nhà thầu, gói thầu, đơn vị, NV, sản phẩm.
   - Phải dùng chung cho Doanh thu/CST/Sản phẩm/Phân tích.

5. **Export/Print/PDF giống app cũ**
   - Hiện app mới có Excel cơ bản.
   - Cần chuyển các mẫu export CST/cảnh báo/doanh thu đang dùng ở app cũ.

6. **Upload/Kho dữ liệu**
   - App mới đã có upload slot doanh thu.
   - Cần đối chiếu đủ các nghiệp vụ kho dữ liệu app cũ: slot, lastUpload, lịch sử, rollback, file kỳ.

### P2 — Hoàn thiện báo cáo thông minh
7. **Cảnh báo CST/cảnh báo doanh thu**
   - Chuyển logic cảnh báo từ app cũ: còn lại thấp/cao, mã QLNB quan trọng, cơ hội bán, giảm doanh thu.

8. **AI hỏi nhanh theo dữ liệu thật**
   - App mới có code-first fallback.
   - Cần nối đủ dữ liệu CST/target/doanh thu và test câu hỏi CEO/NV.

9. **Đối chiếu/nhân viên/phân quyền mở rộng**
   - Chuyển các màn đặc thù nếu CEO xác nhận còn dùng.

## Kế hoạch thực hiện đề xuất

### Đợt 1 — 1 đến 2 ngày: khóa nền dữ liệu
- Import đủ doanh thu từ 01/2026.
- Dev viết CST importer/API từ mẫu đã dump.
- Bot chạy importer CST, kiểm tổng/số dòng/mẫu với app cũ.
- Test quyền CEO + 1 NV sale.

### Đợt 2 — 2 đến 4 ngày: chuyển màn hình nghiệp vụ chính
- Làm UI CST thật giống nhu cầu app cũ.
- Bổ sung bộ lọc đầy đủ.
- Bổ sung tab doanh thu/sản phẩm/phân tích còn thiếu.
- Test trên mobile + PC.

### Đợt 3 — 2 đến 3 ngày: export, cảnh báo, kho dữ liệu
- Chuyển các export Excel/PDF quan trọng.
- Chuyển cảnh báo CST/doanh thu.
- Hoàn thiện Upload/Kho dữ liệu, rollback/audit.

### Đợt 4 — nghiệm thu song song
- Chạy app cũ và app mới song song.
- Mỗi tab chọn 3 kỳ: 04/05/06.2026, đối chiếu số tổng và 5 dòng mẫu.
- CEO duyệt tab nào đạt thì đánh dấu chuyển xong.
- Chỉ khi đủ các tab CEO cần mới tính ngưng dùng app cũ.

## Cách theo dõi
Tạo bảng checklist `MIGRATION_MATRIX.md` gồm từng tab/chức năng app cũ:
- Trạng thái: chưa làm / đang làm / đã import dữ liệu / đã có UI / đã test quyền / CEO duyệt.
- Nguồn dữ liệu.
- Endpoint/file app cũ.
- Endpoint app mới.
- Kết quả đối chiếu.
