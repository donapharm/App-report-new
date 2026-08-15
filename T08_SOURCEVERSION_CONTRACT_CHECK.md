# T08 sourceVersion contract check — 2026-08-15

Phạm vi: probe read-only trực tiếp DataHub cho `2026-08`, hai mã đối chứng DN001 và DN002. Không ghi dữ liệu, không sync; credential và payload nghiệp vụ không được lưu.

## Kết quả

| Mã | HTTP | `contract` | kiểu | `sourceVersion` | kiểu |
|---|---:|---|---|---|---|
| DN001 | 200 | `app-report.employee-cost.v2` | string | `V31.4` | string |
| DN002 | 200 | `app-report.employee-cost.v2` | string | `V31.4` | string |

Hai trường `revision` và `revisionId` có mặt nhưng đều `null`; không có trường batch/generation khác có giá trị trong nhóm tên tương đương.

## Kết luận

DataHub đang phát mã đợt khai báo thật qua `sourceVersion`. Hàm `sourceGenerationOf` hiện yêu cầu đúng contract và kiểu chuỗi nên chấp nhận `V31.4` mà không suy đoán hoặc tự tạo mã.

## Nguyên nhân generation rỗng và khắc phục Gate 1

Danh sách khóa đã kiểm cho thấy `contract` và `sourceVersion` nằm đúng tầng ngoài cùng của phản hồi; lỗi không nằm ở parser. Runtime watcher trước đây gọi `fetchAuthoritativeEmployeeCost` nhưng adapter này lại đi qua `employeeCost.fetchEmployeeCost`, là đường hiển thị local-first. Khi kho local có dữ liệu, adapter có thể trả `sourceOutcome=ok` nhưng không có `sourceRange` hoặc `sourceGeneration` của DataHub.

Đường probe watcher và đường sync snapshot thật đều đã được buộc dùng chung adapter nguồn mạng thuần `fetchRawEmployeeCost`. Adapter này không đi qua bản ghim, snapshot tỷ lệ, fast-path hay background refresh và không ghi lại kho local. Ca kiểm khóa bệnh chứng minh:

- kho local có số nhưng mạng từ chối/lỗi: probe vẫn thất bại theo lỗi mạng, không trả số local;
- mạng trả đúng contract/range: probe nhận `sourceRange=2026-08..2026-08` và `sourceGeneration=V31.4`;
- test tĩnh cấm hai đường probe/sync gọi adapter hiển thị `fetchEmployeeCost`.

Kết luận đường ghim: `employeeCostSnapshotSync` dùng chính adapter nguồn mạng thuần nói trên, nên không còn đường local-first độc lập có thể đóng băng số cũ. Mọi thiếu range, thiếu generation, stale hoặc upstream rejection tiếp tục fail-closed.
