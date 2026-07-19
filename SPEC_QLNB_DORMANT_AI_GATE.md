# Đặc tả QLNB ngủ đông + AI canh cửa + Xu

Trạng thái: App Report production đã có nền QLNB; bản mở rộng theo đơn vị, chu kỳ 14 ngày và chuông CEO đang được nghiệm thu trước khi deploy.

## 1. Nguồn và khóa

- Nguồn doanh thu: dữ liệu App Report đang active qua `store.getRowsRange()`.
- Nguồn khả năng bán: CST/C30 hiện tại qua `store.getCst()`.
- Khóa nghiệp vụ: `EMP_CODE + UNIT_CODE + IIT_CODE`.
- Mỗi cặp mã đơn vị + mã QLNB là một việc riêng; cùng QLNB ở hai đơn vị hoặc nhiều QLNB trong một đơn vị không được gộp.
- Backend luôn áp phạm vi nhân viên; frontend không quyết định quyền.

## 2. Quy tắc trạng thái

- `dormant`: từng có doanh thu hoặc số lượng dương; đủ 60 ngày không có đơn dương trở lại; CST vẫn còn khả năng bán hoặc chưa có bằng chứng chắc chắn là hết khả năng.
- `not_activated`: CST còn khả năng bán nhưng chưa từng có đơn dương; tách riêng, không trộn vào ngủ đông.
- `reactivated`: có đơn dương mới sau lần phát hiện; tự đóng cảnh báo, ghi audit và tạo thông báo thành công cho CEO.
- Đơn âm, trả hàng hoặc dòng 0 không làm mới ngày hoạt động.
- Dữ liệu tháng mà mọi dòng chỉ có ngày 01 được quy về cuối tháng; tháng có nhiều ngày thật giữ độ chính xác ngày.
- Không còn cơ số và không có C30 khả dụng thì loại khỏi danh sách hành động.

## 3. AI canh cửa theo từng đơn vị

Không gọi LLM để tính số. Rule engine chọn một đơn vị ưu tiên theo thứ tự:

1. đơn vị có QLNB đến/quá hạn review;
2. đơn vị có QLNB chưa lập kế hoạch;
3. trong cùng tầng mới so điểm từ số ngày ngủ đông, cơ số/C30, doanh thu lịch sử và chu kỳ mua.

Trong đơn vị đã chọn:

- mỗi lô hiển thị tối đa 5 QLNB;
- nhân viên phản hồi đủ lô hiện tại thì App hiển thị ngay lô kế tiếp của cùng đơn vị;
- tiếp tục đến khi mọi QLNB cần xử lý tại đơn vị đó có kế hoạch;
- khi hết đơn vị, đóng canh cửa và cho vào báo cáo; không tự nhảy sang đơn vị khác trong cùng lần làm việc;
- tuần/lần nhắc sau mới chọn đơn vị khác, trừ mã mới hoặc kế hoạch đã đến hạn review.

Payload phải nêu rõ đơn vị ưu tiên, số lô, tổng QLNB của đơn vị và số còn lại sau lô hiện tại.

## 4. Chu kỳ hành động 14 ngày

Mỗi QLNB phải có kết quả và ngày review lại sau ngày hiện tại, tối đa 14 ngày:

- `contacted`: đã liên hệ;
- `scheduled`: đã lên lịch;
- `waiting_forecast`: chờ dự trù;
- `expected_order`: dự kiến có đơn;
- `blocked`: vướng thầu/cơ số/hàng hóa;
- `no_demand`: đơn vị ngưng nhu cầu;
- `inactive_assignment`: sai/không còn người phụ trách;
- `other`: lý do khác.

Các trạng thái nhạy cảm bắt buộc ghi chú. Mọi lần cập nhật tăng `action_cycle` để CEO nhìn thấy lần 1/lần 2/lần 3, không gia hạn vô hình.

- Trước hạn: `in_progress`; còn tối đa 3 ngày: `upcoming`.
- Đúng ngày: `due`, AI yêu cầu review.
- Quá ngày mà chưa cập nhật: `overdue`, hiện đỏ và đưa vào chuông CEO.
- Có đơn dương trong thời gian triển khai: tự chuyển `reactivated` và đóng.

## 5. Chuông thông báo CEO

- Nút `🔔` xuất hiện ở header desktop/mobile, chỉ CEO/admin thấy.
- Badge hiển thị số chưa đọc; dữ liệu tự làm mới mỗi phút khi CEO đang mở App.
- Feed gồm: nhân viên vừa lập lô kế hoạch, sắp đến hạn, đến hạn, quá hạn và có đơn dương trở lại.
- Mỗi sự kiện hiển thị nhân viên, mã đơn vị, số QLNB, chu kỳ và thời điểm; có chức năng đánh dấu đã đọc.
- Sự kiện/read-state lưu bền và chống trùng qua `dormant_qlnb_notifications.json`.
- Chưa bật gửi Telegram/email thật; các kênh ngoài App cần phê duyệt riêng.

## 6. Dashboard CEO

Dashboard tổng hợp: đang ngủ đông, chưa kích hoạt, chưa có kế hoạch, đang triển khai trong 14 ngày, đến hạn/quá hạn và có đơn trở lại. Danh sách ưu tiên hiển thị nhân viên + mã đơn vị + QLNB + chu kỳ.

## 7. Điểm/Xu và tiền cảnh báo

- Xu tuần thực tính từ thứ Hai đến ngày dữ liệu hiện tại; độc lập với trạng thái QLNB.
- Thiếu 1 Xu tương ứng điều chỉnh tạm tính 300.000đ; 2 Xu = 600.000đ.
- Cuối tháng hiển thị số tạm tính tháng; cuối quý chỉ quyết toán chênh lệch, không tính hai lần.
- App Report không tự ghi/sửa dữ liệu Finance/Expense.

## 8. API nội bộ

- `GET /api/dormant/gate`: canh cửa theo phiên nhân viên và đơn vị ưu tiên.
- `POST /api/dormant/actions`: xác nhận một lô tối đa 5 QLNB.
- `GET /api/dormant/summary`: dashboard CEO hoặc phạm vi nhân viên.
- `GET /api/dormant/notifications`: feed chuông CEO.
- `POST /api/dormant/notifications/read`: đánh dấu đã đọc.
- `GET /api/dormant/digest-preview`: preview ngoài App; `send_enabled=false`.

## 9. Lưu bền

- `dormant_qlnb_state.json`: vòng đời, action cycle, audit và tái kích hoạt.
- `dormant_qlnb_checkpoints.json`: đơn vị đang xử lý, lô đã hoàn thành và checkpoint tuần.
- `dormant_qlnb_notifications.json`: sự kiện CEO và trạng thái đã đọc.
