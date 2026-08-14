# T07: vì sao App trả đủ 21/21 nhưng DataHub exact-range trả 409

Thời điểm điều tra: 14/08/2026 GMT+7

PROD được khảo sát: `90146448895cd4d6b845e24925f40e603d8569fb`

Phạm vi: chỉ đọc; mọi khóa trong bằng chứng thô đều được che.

## Kết luận dứt khoát: (B) — BÁO ĐỘNG ĐỎ

`21/21`, `unavailable=0` trên đường xem T07 **không chứng minh DataHub vừa trả đủ dữ liệu**. Với T07 đã khóa và local rate store có đủ kỳ/NV, `fetchEmployeeCost()` gọi `pinnedClosedPayload()` trước đường mạng, trả ngay:

```text
outcome=ok
attempts=0
pinned=true
rateSource=local_pinned
```

Vì vậy lượt xem thật không gửi request chi phí nào tới DataHub. Số T07 trên màn là bản local đã ghim từ lần đồng bộ trước, không phải snapshot DataHub tươi được xác minh ở lượt xem. Việc gọi nó là “DataHub đủ 21/21” hoặc dùng `unavailable=0` để chứng minh độ tươi là sai. Cho tới khi exact-range trả tươi 21/21 và đối chứng khớp, không được chứng nhận số đang hiển thị là số nguồn hiện tại.

## Hai đường yêu cầu thực tế

### 1. Đường xem App Report

Trình duyệt gọi backend App Report:

```http
GET /api/employee-cost?emp=<NV|ALL>&from=2026-07&to=2026-07
```

Backend dựng doanh thu/catalog, sau đó gọi `employeeCost.getForSession()` → `fetchEmployeeCost()`. Tại đây:

1. `pinnedClosedPayload(emp, {from, to})` đọc local rate store;
2. nếu đủ T07 thì trả `local_pinned`, `attempts=0`;
3. `fetchRawEmployeeCost()` không chạy;
4. do đó **không có request outbound tới DataHub** để so với monitor.

Nếu local store không phủ đủ thì đường fallback mới dùng contract DataHub exact-range giống bên dưới.

### 2. Monitor và snapshot-sync

Hai đường này buộc phải chứng minh đúng kỳ/NV từ nguồn, nên gọi trực tiếp:

```http
GET http://<DATAHUB>/api/integrations/app-report/employee-cost?emp=<NV>&from=2026-07&to=2026-07
x-assignment-key: <REDACTED>
x-employee-cost-key: <REDACTED>
```

DataHub trả HTTP `409 Conflict` cho cả 21 NV. Nội dung đã che khóa:

```json
{
  "error": "Thiếu sidecar C32 bất biến cho kỳ 2026-07"
}
```

Monitor từ 23:20 ngày 13/08 tới ít nhất 08:20 ngày 14/08 đều ghi `ok=0`, `missing=21`, `upstream_409=21`.

## Bằng chứng mã nguồn

- `server/src/routes.js`: `GET /employee-cost` chuyển `from/to` vào `employeeCost.getForSession()`.
- `server/src/employeeCost.js`: `fetchEmployeeCost()` gọi `pinnedClosedPayload()` trước `fetchRawEmployeeCost()` và trả `{ outcome: 'ok', attempts: 0, pinned: true }` khi local store đủ.
- Cùng file: `fetchRawEmployeeCost()` mới tạo URL DataHub `/api/integrations/app-report/employee-cost?emp=...&from=...&to=...` và hai header độc lập.

## Bằng chứng thô đã che khóa

Evidence root trên host: `/home/osboxes/.openclaw/workspace-report-dev/`.

- `artifacts/t07-prod-monitor-readonly-postrollback-20260813/monitor.tsv`
- `artifacts/t07-prod-monitor-readonly-postrollback-20260813/raw/20260814T005042Z.log`
- Raw response đã lưu chỉ giữ status/body nghiệp vụ; không giữ giá trị header khóa.

## Hệ quả vận hành

- Giữ `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` OFF như hiện tại.
- Không dựng seal/snapshot T07 từ bản local rồi gọi là nguồn tươi.
- Monitor exact-range tiếp tục chạy. Khi 409 hết, chỉ nhận T07 nếu cùng một generation đạt đúng 21/21, số liệu đối chứng khớp và provenance đầy đủ; khi đó ưu tiên dựng seal + snapshot tươi.
