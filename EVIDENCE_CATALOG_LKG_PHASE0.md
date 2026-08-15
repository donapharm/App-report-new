# Evidence Giai đoạn 0 — Catalog LKG theo kỳ

Thời điểm đo: `2026-08-15T07:53:36.876Z` (14:53 giờ Việt Nam).

## Phạm vi và bất biến

- Đây là code đo offline và test thuần; runtime Catalog/Employee Cost/route không import module Giai đoạn 0.
- Benchmark chỉ đọc hai LKG live, ghi projection vào thư mục tạm rồi tự xoá; không refresh DataHub, không sửa dữ liệu, không đổi release/PM2/cờ serve.
- Mỗi phép đo parse chạy trong tiến trình Node độc lập với `--expose-gc`. `maxRssBytes` lấy từ `process.resourceUsage().maxRSS`, không lấy PM2.
- File nguồn: Catalog LKG `377.813.964` byte; DQ LKG `105.483.096` byte; có 9 kỳ chung từ `2026-01` đến `2026-09`.

## Kết quả benchmark

| Lát cắt | Byte JSON parse | Cold read + parse | Hot trung bình | RSS sau parse | Peak RSS thật |
|---|---:|---:|---:|---:|---:|
| Monolith | 377.813.964 | 7.812,21 ms | 6.179,49 ms | 2.465.783.808 | 2.838.695.936 |
| Một kỳ `2026-08` | 41.390.877 | 850,00 ms | 739,43 ms | 798.130.176 | 839.401.472 |
| 9 kỳ projection cùng lúc | 369.417.439 | 8.543,90 ms | 6.979,68 ms | 2.832.470.016 | 3.192.729.600 |

Thời gian dựng đủ 9 projection offline: `52.841,53 ms`.

So với monolith, riêng T08 chỉ parse `10,96%` số byte, cold nhanh hơn khoảng `9,19×`, hot nhanh hơn khoảng `8,36×`, peak RSS giảm `70,43%` (`2,839 GiB → 0,839 GiB`). Ngược lại, nạp cả 9 period projection có peak RSS `3,193 GiB`, cao hơn monolith. Vì vậy Giai đoạn 1 bắt buộc reader chọn đúng một kỳ; không được gom shard rồi parse toàn bộ trên request path. Dựng projection cũng không được nằm trên request path.

## Test khóa hành vi

- Parity exact: `rows`, `catalog`, `history`, metadata version/checksum và DQ projection.
- Checksum drift, thay kỳ, thiếu main period hoặc DQ period đều fail-closed.
- Atomic write: temp riêng, mode `0600`, fsync file, rename, fsync directory.
- Crash giả lập trước rename giữ nguyên generation cũ và dọn temp.
- Retention xác định, unique, chỉ giữ các kỳ mới nhất.
- Static guard xác nhận runtime Catalog/Employee Cost/routes chưa import helper Giai đoạn 0.

## Kết luận Gate

Giai đoạn 0 chứng minh hướng tách theo kỳ có lợi lớn khi và chỉ khi consumer đọc đúng kỳ. Chưa có runtime change, chưa đủ quyền sang Giai đoạn 1. Giai đoạn 1 phải được Claude duyệt riêng, giữ fallback monolith và có gate ngăn mọi đường `load all periods`.
