# EVIDENCE 409 — DN024 / VP004

- Thời điểm trace: **2026-08-13T15:10:25+07:00** (GMT+7)
- Contract path: `/api/integrations/app-report/employee-cost`; host **redacted**.
- Header shape: đúng hai credential headers của contract; giá trị không được ghi/in.
- Config: base URL configured + format-valid = **true**; assignment key configured + format-valid = **true**; mapping 21 NV parse-valid, distinct = **true**; DN001/DN024/VP004 mapped = **true**.
- Chế độ: READ-ONLY direct trace, `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT=0/absent`; không publish snapshot, không ghi production data.

| NV | Timestamp GMT+7 | HTTP | raw fetch outcome | snapshot refresh reason | request-id | safe error code | body length / SHA-256 |
|---|---|---:|---|---|---|---|---|
| DN024 | 2026-08-13T15:10:23+07:00 | 409 | upstream_rejected | upstream_rejected | — | EMPLOYEE_COST_C32_SIDECAR_REQUIRED | 281 / `620e152aae541b99fac74a117c36fb391d9defa7a0b0a4ceb77ce6692cd1eddd` |
| VP004 | 2026-08-13T15:10:23+07:00 | 409 | upstream_rejected | upstream_rejected | — | EMPLOYEE_COST_C32_SIDECAR_REQUIRED | 281 / `a1a16bcde8be6fcbe2c198b1c175d4eab3c9760e809c1aee6a2986ffbf8866e6` |
| DN001 | 2026-08-13T15:10:23+07:00 | 409 | upstream_rejected | upstream_rejected | — | EMPLOYEE_COST_C32_SIDECAR_REQUIRED | 281 / `a33a84051f75be3ff3eb7435aeb5f6f90d85cc0dbf68376aa9ee1d8374d641f5` |

## Body lỗi đã sanitize

DN024 và VP004 cùng chỉ giữ schema field names, allowlisted error code, body length và SHA-256; **không giữ message/details values**. Field names: `code, details, details.employeeStatus, details.employeeStatus.emp, details.employeeStatus.reason, details.employeeStatus.reasonCode, details.employeeStatus.retryable, details.employeeStatus.status, error`.

## Đối chứng DN001 và blocker

DN001 T07 không thành công: probe đầu **HTTP 409 / upstream_rejected**; hai retry read-only cách 2 giây: attempt 1=HTTP 409/upstream_rejected; attempt 2=HTTP 409/upstream_rejected. Cả ba body có safe code `EMPLOYEE_COST_C32_SIDECAR_REQUIRED`.

**BLOCKER THẬT TẠI T07:** đối chứng DN001 thành công trong cùng kỳ T07 không đạt. T07 hiện bị upstream từ chối đồng nhất trên cả DN001, DN024 và VP004 với HTTP 409; không thể dùng DN001 làm đối chứng thành công cho riêng T07. Không retry dồn tải thêm vì 409 là deterministic rejection, không phải transient 5xx/deadline.


## Đối chứng thành công DN001

- Tại **T08**, DN001 dùng cùng contract path và credential-header shape đã trả **HTTP 200 / raw outcome `ok`** lúc **2026-08-13T15:10:24+07:00**; body chỉ lưu length **2,986,443 bytes**, SHA-256 `1561d52f3b32e335dd2911305c791a6df3da4ab140a444824f43fbc5b06ffcb4`, và schema field names đã sanitize.
- Đối chứng này chứng minh đường kết nối/xác thực hoạt động; sự khác biệt T07/T08 phù hợp với DataHub từ chối cấu hình dữ liệu của kỳ T07, **không phải lỗi mạng**.
- Không đánh tráo bằng chứng: DN001 **không** phải đối chứng thành công ở T07; ba lần T07 đều 409 như ghi trên.

## Provenance và an toàn

- Direct trace được chạy read-only bằng harness tại `e1094dba3f124a7cc52759fbac9f03301e667342`. Bốn module phân loại nguồn/snapshot liên quan (`employeeCost.js`, `employeeCostTable.js`, `employeeCostSnapshotSync.js`, `employeeCostSnapshotStore.js`) đã được đối chiếu và **không có diff** với candidate `39f007be8d6cb6e08f991395dc699fb129190779`.
- Request ID không được upstream trả về trong các probe trên.
- Không publish/serve snapshot; không ghi production data, runtime, config hoặc DB.
- Evidence gốc redacted, checksum và secret-scan nằm ngoài repository trong gói audit của đợt review.
