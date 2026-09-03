# Cơ số thầu và doanh thu Group-Dona từ T09

## Hai nguồn, hai mốc nghiệp vụ

### Cơ số thầu

- App Sale là hệ thống trừ cơ số thầu theo **đơn hàng**.
- App Report không tự tính và không tự trừ cơ số thầu.
- App Report chỉ đọc các giá trị `c30`, `c30 đã dùng`, `c30 còn lại` từ nguồn App Sale qua `fetchTenderQuota`, sau đó hiển thị kết quả.
- Việc ghép C30 chỉ áp dụng cho Tuyến `CL`, theo đúng mã đơn vị, mã QLNB và kỳ/quyết định thầu. Dòng không có Tuyến không đủ điều kiện ghép.

### Doanh thu Group-Dona

- Từ T09, doanh thu Group-Dona chỉ được ghi nhận theo **hóa đơn đã hiện diện trong App Công nợ**.
- CRM chỉ là nguồn đối soát/cảnh báo; CRM không được fallback, cộng thêm hoặc thay thế doanh thu App Công nợ.
- App Report không được tính trước doanh thu cho đơn mới dừng ở trạng thái đề nghị ghi hoặc chưa có hóa đơn trong App Công nợ.

## Quan hệ giữa hai số

Cơ số thầu và doanh thu sử dụng hai mốc nghiệp vụ khác nhau:

1. App Sale trừ cơ số khi đơn hàng đạt điều kiện của luồng đơn hàng.
2. Doanh thu Group-Dona chỉ phát sinh khi hóa đơn tương ứng đã có trong App Công nợ.

Vì vậy hai số lệch nhau trong khoảng thời gian từ lúc đơn hàng đã trừ cơ số đến lúc hóa đơn xuất hiện là **đúng theo thiết kế**. Phần lệch chính là các đơn đã trừ cơ số nhưng chưa xuất hóa đơn.

Tuyệt đối không ép hai số bằng nhau. Làm như vậy có thể:

- ghi nhận doanh thu trước khi có hóa đơn, tức thổi doanh thu; hoặc
- trừ cơ số thêm lần nữa, tức trừ trùng.

## Hợp đồng Tuyến

- Tuyến phải được mang xuyên suốt từ danh mục nguồn qua mapping, dòng hóa đơn Debts và projection doanh thu App Report.
- Với Cơ số thầu, chỉ `route === 'CL'` được ghép.
- Dòng thiếu Tuyến hoặc có nhiều Tuyến mâu thuẫn phải fail-closed, không tự đoán và không ghép C30.
- Kiểm thử/cutover T09 phải báo riêng số dòng có Tuyến, rỗng Tuyến và `route_conflict` trước khi activate.

## Điều cấm

- Không dùng doanh thu để tự suy lại C30 đã dùng/còn lại.
- Không dùng C30 để tự suy doanh thu đã thực hiện.
- Không dùng CRM bù phần hóa đơn App Công nợ chưa có.
- Không bỏ điều kiện Tuyến `CL` để tăng tỷ lệ ghép.
