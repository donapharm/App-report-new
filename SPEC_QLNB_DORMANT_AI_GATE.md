# Đặc tả QLNB ngủ đông + AI canh cửa + Xu

Trạng thái: triển khai nội bộ, chờ CEO nghiệm thu trước khi deploy/gửi thật.

## 1. Nguồn và khóa

- Nguồn doanh thu: dữ liệu App Report đang active qua `store.getRowsRange()`.
- Nguồn khả năng bán: CST/C30 hiện tại qua `store.getCst()`.
- Khóa nghiệp vụ: `EMP_CODE + UNIT_CODE + IIT_CODE`.
- Backend luôn áp phạm vi nhân viên; frontend không quyết định quyền.

## 2. Quy tắc trạng thái

- `dormant`: từng có doanh thu hoặc số lượng dương; đủ 60 ngày không có đơn dương trở lại; CST vẫn còn khả năng bán hoặc chưa có bằng chứng chắc chắn là hết khả năng.
- `not_activated`: CST còn khả năng bán nhưng chưa từng có đơn dương; tách riêng, không trộn vào ngủ đông.
- `reactivated`: có đơn dương mới sau lần phát hiện; tự đóng cảnh báo và ghi audit.
- Đơn âm, trả hàng hoặc dòng 0 không làm mới ngày hoạt động.
- Dữ liệu tháng mà mọi dòng chỉ có ngày 01 được quy về cuối tháng để tránh cảnh báo sớm; tháng có nhiều ngày thật giữ độ chính xác ngày.
- Không còn cơ số và không có C30 khả dụng thì loại khỏi danh sách hành động.

## 3. AI canh cửa

Không gọi LLM để tính số. Rule engine chọn tối đa 5 mã theo điểm ưu tiên xác định từ:

- số ngày không có đơn dương;
- cơ số/giá trị còn lại và khả năng C30;
- doanh thu lịch sử;
- độ trễ so với chu kỳ mua lịch sử;
- tín hiệu mới ngủ đông.

Canh cửa xuất hiện:

- lần đầu nhân viên vào Doanh thu chi tiết/Phân tích trong tuần;
- có mã mới ngủ đông;
- đến hoặc quá ngày theo dõi lại.

Sau khi phản hồi đủ, không hỏi lại trong cùng tuần nếu chưa có mã mới/đến hạn.

## 4. Phản hồi bắt buộc

Mỗi mã phải có kết quả và ngày theo dõi lại sau ngày hiện tại:

- `contacted`: đã liên hệ;
- `scheduled`: đã lên lịch;
- `waiting_forecast`: chờ dự trù;
- `expected_order`: dự kiến có đơn;
- `blocked`: vướng thầu/cơ số/hàng hóa;
- `no_demand`: đơn vị ngưng nhu cầu;
- `inactive_assignment`: sai/không còn người phụ trách;
- `other`: lý do khác.

Các trạng thái `blocked`, `no_demand`, `inactive_assignment`, `other` bắt buộc ghi chú. Mọi thay đổi lưu người thực hiện, ngày, giá trị mới và lịch sử audit.

## 5. Leo thang

- 7 ngày từ lần phát hiện mà chưa xử lý xong: mức đỏ.
- 14 ngày: đưa dashboard quản lý/CEO.
- Dashboard CEO tổng hợp ngủ đông, chưa kích hoạt, đỏ 7 ngày, quản lý/CEO 14 ngày và tái kích hoạt.

## 6. Điểm/Xu và tiền cảnh báo

- Xu tuần thực tính từ thứ Hai đến ngày dữ liệu hiện tại; độc lập với trạng thái QLNB.
- Thiếu 1 Xu tương ứng điều chỉnh tạm tính 300.000đ; 2 Xu = 600.000đ.
- Cuối tháng hiển thị số tạm tính tháng.
- Cuối quý tính tổng quý và chỉ quyết toán phần chênh lệch sau khi có số Finance/Expense đã ghi nhận; không cộng lại khoản tháng.
- Câu nhắc chuẩn: chủ động hoàn tất chi tiêu và chứng từ hợp lệ, đúng mục đích, đúng thời hạn để tích lũy Xu; không chi tiêu không cần thiết chỉ để lấy Xu.
- App Report không tự ghi/sửa dữ liệu Finance/Expense.

## 7. API nội bộ

- `GET /api/dormant/gate`: payload canh cửa theo phiên nhân viên.
- `POST /api/dormant/actions`: xác nhận có cấu trúc; backend kiểm đủ khóa và đúng quyền.
- `GET /api/dormant/summary`: dashboard CEO hoặc phạm vi nhân viên.
- `GET /api/dormant/digest-preview`: preview Telegram/email cho CEO; `send_enabled=false`.

## 8. Lưu bền và chống trùng

- `dormant_qlnb_state.json`: vòng đời, hành động, ngày theo dõi, audit và tái kích hoạt.
- `dormant_qlnb_checkpoints.json`: xác nhận canh cửa theo nhân viên + tuần.
- Digest có fingerprint ổn định để lịch gửi tương lai chống trùng.
- Giai đoạn nội bộ không bật lịch gửi, không gửi Telegram/email và không deploy.
