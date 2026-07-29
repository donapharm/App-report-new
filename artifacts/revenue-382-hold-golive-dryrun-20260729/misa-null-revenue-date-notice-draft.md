# Nháp báo kế toán/MISA — thiếu revenue_date

Đề nghị kế toán/MISA kiểm tra và nhập bổ sung `revenue_date` tại nguồn cho đơn sau:

- Mã đơn: `DH479815711`
- Số tiền: `2.399.520đ`
- Nhân viên: `DN010 - Trần Quốc Cường`
- Đơn vị: `015.TTYT H. Cẩm Mỹ - TRUNG TÂM Y TẾ KHU VỰC CẨM MỸ`
- Trạng thái MISA: `official`, revenue_status `Đã ghi`
- Lỗi dữ liệu: đã ghi doanh thu, có số tiền, nhưng `revenue_date` đang NULL.

Ghi chú nghiệp vụ: App Report không tự lấy ngày đặt/ngày tạo đơn thay cho ngày doanh thu. Dòng thiếu `revenue_date` sẽ không được tính vào kỳ cho đến khi sửa đúng tại nguồn, để tránh doanh thu nhảy sai tháng hàng loạt.
