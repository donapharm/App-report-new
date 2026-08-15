# SPEC — Pin employee cost trước khi DataHub khoá kỳ

## Mục tiêu

Không để lặp lại T07: kỳ đã khoá thì exact-range có thể bị DataHub trả 409 và không còn đủ bằng chứng để dựng snapshot nguồn tươi.

Tài liệu này chỉ là đề xuất để review. Chưa bật lịch, chưa tự động sync, chưa thay đổi serve.

## Mốc an toàn đề xuất

1. Watcher chỉ probe mỗi 30 phút trong suốt kỳ mở.
2. Từ 00:00 ngày 01 tháng kế tiếp, khi có đủ roster, exact range, một source generation chung và dependency ổn định, hệ thống phát `WATCHER_PROBE_READY_GATE2_REQUIRED` để xin duyệt pin.
3. Mốc vận hành mục tiêu: hoàn tất pin trước 23:00 GMT+7 ngày 03 tháng kế tiếp.
4. Nếu chưa pin được, cảnh báo đỏ từ 00:00 ngày 04; đây là hard escalation, còn hơn 24 giờ trước hết ngày 05.
5. Không chờ sát ngày 05. Sau 12:00 ngày 04, mọi lần probe thiếu/partial/drift phải nêu đích danh NV và nguồn thiếu cho CEO/DataHub xử lý.

Với kỳ cần chốt sớm hơn hoặc DataHub đã phát một generation hoàn chỉnh ổn định, CEO có thể duyệt pin ngay trong tháng như T08. Mốc trên là hạn cuối an toàn, không phải lý do trì hoãn.

## Điều kiện pin bất biến

- Roster lấy từ dữ liệu live, phải lớn hơn 0.
- Đủ 100% NV trong roster.
- Mỗi NV có `sourceRange` exact đúng kỳ.
- Tất cả NV có cùng một `sourceGeneration` thật từ DataHub.
- Không chấp nhận `ok_stale_rates`, local-first, pinned/local snapshot hay mã generation tự chế.
- Dependency identity ổn định đầu–cuối.
- Concurrency 1; không chồng cron, warm hoặc refresh.
- Partial/stale/drift: fail-closed, dọn target lỗi, không retry dồn.
- Probe tuyệt đối không ghi kho local. Pin dùng cùng adapter mạng thuần đã được khóa bằng test.

## Tự động hoá đề xuất

- Timer vẫn chỉ chạy `probe` và không có quyền tự pin.
- Khi ready, watcher ghi evidence bất biến và gửi đúng một thông báo xin Gate 2.
- Một lệnh pin one-shot chỉ được tạo sau Gate 2, kèm success key của probe; trước publish phải kiểm lại toàn bộ gate.
- Nếu source generation đổi giữa probe và pin, lệnh dừng với drift; không tự dùng generation mới.
- Sau publish, đối chứng model pinned với model màn live. Serve tiếp tục OFF cho đến Gate riêng.
- Lưu generation ID, source generation, manifest/model digest và thời gian GMT+7.

## Quan sát và cảnh báo

- Theo dõi 21/21, exact range, generation, dependency identity, unavailable reasons.
- Theo dõi RSS thật từ `/proc/<pid>/status`; PM2 chỉ đối chiếu.
- Ghi VmHWM 2,68 GiB đã thấy lúc bootstrap/page/catalog vào backlog tách catalog LKG theo kỳ; rollback chỉ xét RSS thật kéo dài theo runbook.
- Nếu DataHub mở lại exact-range T07, báo ngay và ưu tiên dựng snapshot T07 nguồn tươi đủ roster.

## Điều kiện chưa được phép

- Không bật lịch auto-sync/pin từ spec này.
- Không bật `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT`.
- Không coi snapshot có đủ 21 NV là cân bằng tài chính nếu `revenueRecon.balanced` vẫn false.
