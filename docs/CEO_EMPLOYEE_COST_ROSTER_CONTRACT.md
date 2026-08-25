# Contract roster Employee Cost của CEO

Hiệu lực theo xác nhận của CEO ngày 26/08/2026.

1. Roster tổng hợp Employee Cost của CEO là roster Sale đầy đủ 21 người, gồm
   `DN021` và `DN023`. Mọi phép cân doanh thu/tiền và completeness generation
   phải dùng đủ tập này.
2. Khóa đăng nhập là một access policy độc lập. `DN021` và `DN023` không được
   đăng nhập App Report, nhưng việc khóa đăng nhập không được loại dữ liệu của họ
   khỏi báo cáo CEO.
3. Chính sách target-only/không thưởng-phạt của `DN021` và `DN023` giữ nguyên;
   chính sách đó không được làm rơi doanh thu hoặc dòng tổng hợp cần thiết.
4. Telegram, Zalo, email và mọi kênh gửi ngoài cho `DN021`/`DN023` phải tiếp tục
   bị chặn nếu chưa có phê duyệt riêng của CEO. Reporting scope không cấp quyền
   gửi ngoài.
5. Không được tái sử dụng `accessPolicy.isLoginBlocked()` hoặc denylist đăng nhập
   để lọc reporting roster. Mỗi policy phải có test độc lập.
