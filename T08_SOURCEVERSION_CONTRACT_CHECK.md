# T08 sourceVersion contract check — 2026-08-15

Phạm vi: probe read-only trực tiếp DataHub cho `2026-08`, hai mã đối chứng DN001 và DN002. Không ghi dữ liệu, không sync; credential và payload nghiệp vụ không được lưu.

## Kết quả

| Mã | HTTP | `contract` | kiểu | `sourceVersion` | kiểu |
|---|---:|---|---|---|---|
| DN001 | 200 | `app-report.employee-cost.v2` | string | `V31.4` | string |
| DN002 | 200 | `app-report.employee-cost.v2` | string | `V31.4` | string |

Hai trường `revision` và `revisionId` có mặt nhưng đều `null`; không có trường batch/generation khác có giá trị trong nhóm tên tương đương.

## Kết luận

DataHub đang phát mã đợt khai báo thật qua `sourceVersion`. Hàm `sourceGenerationOf` hiện yêu cầu đúng contract và kiểu chuỗi nên chấp nhận `V31.4` mà không suy đoán hoặc tự tạo mã. Việc watcher trước đó ghi generation rỗng không phải do contract T08 thiếu trường; cần đối chiếu chính request/credential/range của watcher nếu tái diễn.

