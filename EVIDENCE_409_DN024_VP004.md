# EVIDENCE 409 — DN024 / VP004

- Trace read-only: **2026-08-13T15:10:25+07:00** (GMT+7).
- Contract path: `/api/integrations/app-report/employee-cost`; host được che.
- Cấu hình: base URL và assignment key **có cấu hình, khớp định dạng**; mapping employee-cost có **21 mã hợp lệ, riêng biệt**, không trùng assignment key; DN001, DN024 và VP004 đều có mapping.
- Không ghi giá trị credential, token, host, raw URL, message/details của upstream hoặc dữ liệu dòng.
- `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT=0/absent`; không publish/serve snapshot và không ghi production data.

| NV | Kỳ | Timestamp GMT+7 | HTTP | outcome an toàn | request-id | safe error code | body length / SHA-256 |
|---|---|---|---:|---|---|---|---|
| DN024 | 2026-07 | 2026-08-13T15:10:23+07:00 | 409 | `upstream_rejected` | không được upstream trả | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | 281 / `620e152aae541b99fac74a117c36fb391d9defa7a0b0a4ceb77ce6692cd1eddd` |
| VP004 | 2026-07 | 2026-08-13T15:10:23+07:00 | 409 | `upstream_rejected` | không được upstream trả | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | 281 / `a1a16bcde8be6fcbe2c198b1c175d4eab3c9760e809c1aee6a2986ffbf8866e6` |
| DN001 | 2026-07 | 2026-08-13T15:10:23+07:00 | 409 | `upstream_rejected` | không được upstream trả | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | 281 / `a33a84051f75be3ff3eb7435aeb5f6f90d85cc0dbf68376aa9ee1d8374d641f5` |

## Body evidence đã sanitize

Chỉ giữ schema field names, allowlisted error code, body length và SHA-256. Không giữ giá trị `message`, `details` hay trường có thể chứa credential. Các field name quan sát được: `code`, `details`, `details.employeeStatus`, `details.employeeStatus.emp`, `details.employeeStatus.reason`, `details.employeeStatus.reasonCode`, `details.employeeStatus.retryable`, `details.employeeStatus.status`, `error`.

## Đối chứng thành công và blocker

- DN001 T07 không thành công: probe đầu và hai retry read-only cách 2 giây đều **HTTP 409 / `upstream_rejected`**, cùng safe code trên. Không retry dồn tải vì 409 là deterministic rejection, không phải 5xx/deadline tạm thời.
- **Đối chứng thành công:** cùng contract path, credential-header shape và mapping hợp lệ, DN001 kỳ **2026-08** trả **HTTP 200 / `ok`** lúc **2026-08-13T15:10:24+07:00**. Toàn roster T08 đạt 21/21 HTTP 200 trong lượt trace đó.
- Kết luận hẹp: kết nối/xác thực contract hoạt động ở T08; T07 đang bị DataHub từ chối theo dữ liệu/cấu hình kỳ. Không được trình bày DN001 T07 như một ca thành công.

## Provenance và ranh giới

- Direct trace dùng candidate `e1094dba3f124a7cc52759fbac9f03301e667342` ở chế độ read-only.
- Gói evidence ngoài repo đã qua JSON parse, SHA-256 verify và secret scan: PASS.
- File này không phải duyệt bật snapshot. `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` phải giữ **OFF** cho đến khi CEO duyệt riêng.
