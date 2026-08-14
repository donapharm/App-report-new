# Vì sao provenance ghi `:THIEU` hàng loạt

Thời điểm trace read-only: 14/08/2026 GMT+7.

## Kết luận

Nguyên nhân chính là **HTTP 404 từ contract reconciliation shadow v3: `Reconciliation version not found`**, không phải mất mạng, timeout hay thiếu cấu hình App Report.

`reconciliationShadow.loadScope()` bắt mọi lỗi HTTP/validation và trả `null`. Sau đó `applyReconciliationShadow()` biến mỗi scope v3 `null` thành tuple:

```text
<period>:<contractorCode>:THIEU
```

Vì catch hiện tại làm mất status/reason nên payload chỉ còn `THIEU`, khiến 404 nguồn bị nhìn giống timeout/mạng/config nếu không probe riêng.

## Cấu hình và đường gọi

- `APP_SALE_RECON_BASE_URL`: có cấu hình, trỏ loopback service port `3980`.
- `APP_SALE_RECON_KEY`: có cấu hình; không ghi giá trị vào hồ sơ.
- Timeout không override, dùng mặc định `1500 ms`.
- Shadow v3: `/api/integrations/app-report/reconciliation-shadow/v3/<period>/<contractor>?offset=0`.
- Allocation v4 chỉ được gọi khi v3 đã hợp lệ; request ghim `phien_ban`, `allocation_version=4`, `offset=0`.

Service loopback trả health 200. Các response shadow lỗi về trong khoảng 4–98 ms, nên loại trừ timeout và đứt mạng.

## Tại sao T07 có 16 và T08 có 13

Acceptance đã sử dụng đúng 16 contractor scopes của T07 và 13 contractor scopes của T08. Ở generation đó, tất cả scope tương ứng không có snapshot v3 hợp lệ, nên model ghi đúng 16/13 tuple `THIEU`.

T07:

```text
03.TUE.N, 04.NGUYEN.K, 04.NGUYEN.P, 05.A&B, 06.SONG.V,
07.TRIEU.G, 08.BIN.B, 09.HUY.C, 10.ĐAI.TS, 11.TU.Đ,
12.MINH.P, 14.ĐAI.P, 15.THAI.N, 20.HĐS, AFP, DONA
```

T08:

```text
03.TUE.N, 04.NGUYEN.K, 04.NGUYEN.P, 05.A&B, 06.SONG.V,
08.BIN.B, 10.ĐAI.TS, 11.TU.Đ, 12.MINH.P, 14.ĐAI.P,
15.THAI.N, AFP, DONA
```

## Probe module hiện tại

Trace tuần tự concurrency 1 qua đúng module App Report lúc 08:28 cho kết quả:

```text
shadow requested: 29
shadow accepted: 1  (2026-07 / 20.HĐS)
shadow HTTP 404: 28
allocation requested: 1
allocation accepted: 0
allocation HTTP 404: 1
```

Điểm khác với acceptance trước đó: v3 của T07/`20.HĐS` hiện đã xuất hiện và trả 200; đó là state nguồn thay đổi sau generation acceptance, không làm generation cũ tự nhiên có provenance. Request allocation hợp lệ tiếp theo:

```http
GET /api/integrations/app-report/reconciliation-allocation/v4/2026-07/20.H%C4%90S?phien_ban=1&allocation_version=4&offset=0
```

trả HTTP 404. Vắng allocation không tạo chữ `THIEU`; khi v3 có mà v4 vắng, tuple dùng `av=khong-co:ac=khong-co`. Chữ `THIEU` chỉ khẳng định v3 snapshot không được nhận.

## Kết quả lượt ghim T08 duy nhất được phép

Lượt controlled retry concurrency 1 kết thúc fail-closed ở `16/21`. Năm NV không đạt:

```text
DN021, DN022, DN023, DN024, VP004
sourceOutcome=ok_stale_rates
```

Không có dependency nào đổi giữa đầu/cuối lượt (`dependencyChanges=[]`); data/rates/formula/app fingerprints đều giữ nguyên. Vì vậy lỗi lượt này **không phải `EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT`** mà là năm nguồn fresh không đạt gate, phải rơi về local stale rates. Partial generation đã bị xóa, snapshot root được khôi phục về trạng thái absent và không được serve. Theo chỉ thị, không retry thêm.

## Bằng chứng

Evidence root trên host: `/home/osboxes/.openclaw/workspace-report-dev/`.

- `artifacts/provenance-readonly-20260814-0828/probes.tsv`
- `artifacts/provenance-readonly-20260814-0828/module-trace.tsv`
- `artifacts/snapshot-t08-controlled-retry-20260814-080537/logs/one-shot.log`
- `artifacts/snapshot-t08-controlled-retry-20260814-080537/RESULT.txt`
- `artifacts/snapshot-t08-controlled-retry-20260814-080537/DEPENDENCY_CHANGES.txt`
- `artifacts/t07-seal-gate-model-match-20260813.json`

## Khuyến nghị kỹ thuật

Giữ fail-closed. Bổ sung telemetry nội bộ có phân loại `http_404`, `http_4xx`, `timeout`, `network`, `invalid_envelope`, nhưng không đưa body/khóa vào payload người dùng. Chỉ khi v3/v4 đầy đủ và checksum/version khớp mới cho provenance sealable.
