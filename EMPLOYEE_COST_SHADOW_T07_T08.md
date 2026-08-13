# Employee Cost shadow — bảng T07/T08 và cổng publish

Thời điểm evidence: **2026-08-13**, GMT+7. Tất cả thao tác là read-only hoặc shadow store cô lập. Production snapshot serving/sync vẫn **OFF**.

## 1. T08 partial — ba lớp trạng thái cần phân biệt

Generation shadow T08 cũ có `state=partial`, roster 21 nhưng manifest `employees=[]`, `availableCount=0`: vì vậy **thiếu record đã pin của cả 21/21 mã**. Model fallback vẫn dựng được 1.088 dòng cho 20 NV; trong lớp model này mã duy nhất không có dòng là **VP004**. Model có số không đồng nghĩa snapshot đã pin đủ nguồn.

Lượt direct read-only mới hơn lúc **2026-08-13T15:10:24–15:10:25+07:00** kiểm lại nguồn T08: cả 21/21 trả HTTP 200, raw `sourceOutcome=ok`. Bảng dưới giữ đồng thời trạng thái generation cũ và outcome nguồn mới để không đánh tráo hai thời điểm.

| NV | Thiếu pinned record trong partial | Có trong model 20 NV | Refresh reason của partial cũ | Direct T08 HTTP / sourceOutcome mới | Phân nhóm mới |
|---|---|---|---|---|---|
| DN001 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN002 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN003 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN004 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN005 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN006 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN007 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN008 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN009 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN010 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN011 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN012 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN016 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN017 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN018 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN019 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN021 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN022 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN023 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| DN024 | Có | Có | `upstream_unavailable` | 200 / `ok` | ok |
| VP004 | Có | **Không** | `upstream_unavailable` | 200 / `ok` | ok |

### Phân nhóm direct T08 mới

- **409 / `upstream_rejected`: 0** — không có.
- **deadline: 0** — không có.
- **khác: 0** — không có lỗi khác.
- **ok: 21** — DN001, DN002, DN003, DN004, DN005, DN006, DN007, DN008, DN009, DN010, DN011, DN012, DN016, DN017, DN018, DN019, DN021, DN022, DN023, DN024, VP004.

### Điều kiện cần trước khi coi T08 publishable

Phải chạy lại một shadow generation cô lập bằng code candidate và chứng minh trong **cùng generation**: 21/21 kết quả accepted, 21 pinned employee records, `availableCount=21`, không unavailable reason, roster/model/manifest khớp và integrity/digest PASS. Direct trace 21/21 `ok` hiện tại là tín hiệu nguồn đã hồi phục, nhưng **chưa tự nó sửa generation partial cũ**.

## 2. T07 — thiếu bằng chứng exact-range gì

Lượt shadow T07 lúc **2026-08-13T13:38:38+07:00** có đủ 21/21 fetch `sourceOutcome=ok` và có payload, nhưng cả 21 đều:

- `sourceRangePresent=false`;
- không có `sourceRange.from=2026-07` và `sourceRange.to=2026-07` để ràng buộc payload với đúng kỳ yêu cầu;
- do đó `verified=false` và không được tính là successful exact-range evidence.

T07 là kỳ đóng nên cổng publish đúng khi fail-closed bằng `EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE`; không được hạ điều kiện để ép publish. Lượt probe muộn hơn còn cho thấy DN001, DN024 và VP004 T07 bị HTTP 409 với safe code `EMPLOYEE_COST_C32_SIDECAR_REQUIRED`.

### Cần làm gì để publish T07

1. DataHub xử lý rejection/sidecar T07 để full roster 21 mã đọc được trong cùng một lượt tươi.
2. Response mỗi NV phải tự chứng minh đúng phạm vi: `sourceRange.from=2026-07`, `sourceRange.to=2026-07`; mã NV trong payload khớp request; periods/rows/columns thuộc đúng range.
3. Chạy full-roster shadow sync cô lập: `successful=21`, không unavailable, không scope/range mismatch, generation complete/locked theo policy kỳ đóng.
4. Verify manifest có đủ 21 pinned records, checksum/integrity PASS và model đối chứng đúng 2.091 dòng / 21 NV / doanh thu canonical 30.982.248.913đ, zero unavailable.
5. Trình bảng/evidence generation mới để CEO duyệt riêng trước khi bật serving.

## 3. Quyết định an toàn

Hai blocker hiện tại là độc lập:

- T08: generation cũ partial chưa pin employee record, dù direct source mới đã 21/21 `ok`.
- T07: chưa có full-roster exact-range evidence, đồng thời ba mã probe hiện bị 409.

Vì vậy `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` tiếp tục **TẮT**. Không bật bằng commit này; mọi thay đổi runtime/deploy cần cổng duyệt riêng.
