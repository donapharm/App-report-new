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
5. Phải có hai hàm tách việc: `ceoAggregateRosterRows()` giữ 21 và
   `actionableRosterRows()` giữ 19. Mặc định mọi call site dùng tập 19; chỉ đường
   tổng hợp CEO/generation được ghi rõ mới dùng tập 21.
6. Đổi hàm dùng chung bắt buộc rà toàn bộ nơi gọi. Không được kiểm vài module gửi
   tin rồi kết luận an toàn khi route ghi sổ/quyền/picker còn dùng cùng hàm.

## Phân loại call site trong `server/src/routes.js`

Số dòng dưới đây là căn cứ review của candidate; tên hàm mới là contract bền vững.

| Dòng | Hàm/đường dùng | Roster | Lý do |
|---:|---|---:|---|
| 1012 | `employeeCostLockedSnapshotProvider` | 21 | Dấu đóng của báo cáo CEO phải bind đủ đội hình. |
| 1027 | hậu kiểm roster của locked snapshot | 21 | Không được xác thực generation 21 bằng identity 19. |
| 1049 | `employeeCostSnapshotStatus` mặc định | 21 | Trạng thái completeness là trạng thái báo cáo CEO. |
| 1170 | `employeeCostSnapshotSync.rosterProvider` | 21 | Generation bắt buộc đủ 21/21. |
| 1233 | `readEmployeeCostSnapshotModel` | 21 | Đọc model tổng hợp CEO theo đúng identity 21. |
| 1275 | `/me` — visibility Employee Cost | 19 | Quyền tự xem là phạm vi hành động/tài khoản. |
| 1282 | `/me` — visibility Thành tiền | 19 | Không cấp menu theo reporting scope. |
| 1300 | `employeeCostPayload` mặc định | 19 | Báo cáo một người và quyền tự xem mặc định fail-closed. |
| 1741 | `employeeCostAllPayload` | 21 | Đây là tổng hợp ALL của CEO. |
| 2551 | `scheduleEmployeeCostSnapshotSync` | 21 | Kiểm current generation theo identity 21. |
| 2605 | snapshot watcher `rosterProvider` | 21 | Watcher bảo vệ completeness của generation 21. |
| 2607 | snapshot watcher `probeEmployee` | 21 | Probe cùng đúng tập đầu vào generation. |
| 2672 | `/snapshot/resync` current lookup | 21 | Nút generation CEO kiểm đúng tập 21. |
| 2732 | `/salary-advance` visibility | 19 | Quyền xem số ứng theo người, không phải tổng hợp CEO. |
| 2743 | `employeeVatKhoanPayload` mặc định | 19 | Xu/phạt là hành động cá nhân; DN021/DN023 target-only. |
| 2876 | `employeePointXuPayload` mặc định | 19 | Không tính điểm/xu cho target-only. |
| 2887 | `/diem-xu` | 19 | Picker/ALL điểm-xu chỉ gồm người actionable. |
| 2936 | preview thông báo điểm | 19 | Có khả năng dẫn tới gửi ngoài nên bắt buộc 19. |
| 2974 | DataHub quarter penalty | 19 | Không xuất phạt cho target-only. |
| 3006 | `employeeCostExportReports` picker đơn | 19 | Chọn/xuất theo người là phạm vi actionable; nhánh ALL gọi tổng hợp 21 riêng. |
| 3073 | province worklist export | 21 | Báo cáo read-only của CEO, cần giữ đủ doanh thu toàn đội. |
| 3098 | `employeeCostGapPayload` | 19 | Đường theo người/quyền; chưa có contract mở rộng nên mặc định an toàn. |
| 3358 | DQ self-visibility | 19 | Quyền tự xem, không phải roster tổng hợp DQ toàn công ty. |
| 3442 | `/employee-cost/employees` | 19 | Picker thao tác theo người giữ 19. |
| 3449 | visibility panel | 19 | Bảng cấp quyền chỉ chứa tài khoản actionable. |
| 3511 | `paymentTarget` | 19 | Cổng ghi sổ tiền thật; DN021/DN023 phải bị từ chối. |
| 3523 | `employeeNameOf` | 19 | Tên dùng trong luồng thanh toán/thông báo. |
| 3535 | `resolveFlowRecipient` | 19 | Cổng người nhận tin, không dựa vào may mắn chưa map Telegram. |
| 3559 | `flowNotifyReach` | 19 | Khả năng nhận tin phải dùng cùng cổng 19. |
| 3610 | `selfPaymentTarget` | 19 | Đề nghị thanh toán là hành động tiền. |
| 3806 | save visibility | 19 | Không được cấp quyền cho mã login-blocked. |
| 4589 | `costAmountsGate` | 19 | Quyền menu Thành tiền là access policy. |
| 4832 | cost-amounts visibility panel | 19 | Picker cấp quyền giữ 19. |
| 4836 | cost-amounts visibility save | 19 | Ghi quyền chỉ cho actionable roster. |
| 6426 | penalty policy impact preview | 19 | DN021/DN023 target-only, không thưởng/phạt. |
