# EVIDENCE — T08 pinned complete trên shadow cô lập

Thời điểm: **2026-08-13 20:36–20:37 GMT+7**. Kết luận chỉ áp dụng cho shadow store cô lập; **không có deploy/restart/reload, không ghi store PROD, không bật snapshot serving**.

## Kết luận

**PASS** — exact candidate `90146448895cd4d6b845e24925f40e603d8569fb` (tree `80ffc6937fb5ecb9389df7a9e0aefebbdeeebbfd`) đã publish một generation T08 duy nhất thỏa contract:

- generation: `bfb883ef577275eba9f0b32d4d9c8596f43b5668a87b9732bca85dd7d75442c4`;
- nguồn exact-range accepted: **21/21**;
- pinned employee records: **21**;
- `availableCount=21`, `unavailableReasons={}`;
- status `ready`, `complete=true`, `locked=false`;
- manifest/roster/model cùng roster 21 mã;
- dependency ổn định xuyên suốt lượt thành công;
- reread current generation PASS;
- kiểm tra checksum envelope độc lập: **23/23 PASS**.

T08 chưa khóa sổ nên `locked=false` là đúng policy hiện tại.

## Cách chạy cô lập

- Runtime source được xuất từ exact commit `9014644`; data runtime được copy vào custody shadow, mode `0700`.
- Snapshot root thành công:
  `/home/osboxes/.openclaw/workspace-report-dev/artifacts/t08-shadow-9014644-20260813-202126/snapshot-store-authoritative-retry2`
- `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT=0`.
- Loop sync, warm, refresh, scheduler và các cờ notify/send đều tắt.
- Hai kho tỷ lệ local được thay bằng adapter rỗng **chỉ trong bộ nhớ của process shadow**. Mỗi mã NV vì vậy phải lấy exact-range từ nguồn thẩm quyền; adapter chết cùng process và không ghi cache PROD.
- Concurrency được hạ còn 1 để tránh fan-out làm nhiễu nguồn và giữ dependency generation ổn định.

Yêu cầu nghiệp vụ `dongBoKy('08.2026')` được ánh xạ sang contract nội bộ canonical `dongBoKy('2026-08')`. Exact implementation chỉ nhận `YYYY-MM`; raw `08.2026` đã được thử fail-closed với `EMPLOYEE_COST_SNAPSHOT_INVALID_PERIOD`, không sửa code để nới validator.

## Nghiệm thu generation thành công

| Gate | Kết quả |
|---|---:|
| Source calls đúng range `2026-08..2026-08` | 21 |
| Outcome `ok` + evidence exact-range accepted | 21/21 |
| Rejected / unavailable | 0 |
| Manifest employee records | 21 |
| Status available / roster | 21 / 21 |
| Manifest complete | PASS |
| Current pointer = manifest generation | PASS |
| Reread store | PASS |
| Roster set = employee set = model roster | PASS |
| Revenue reconciliation balanced | PASS |
| Model unavailable / stale | 0 / 0 |
| Dependency stable across whole run | PASS |
| Envelope checksum independent | 23/23 PASS |

Model trong generation có **1.089 dòng**, một period, `allEmployees=true`. Build có warning DQ hiện hữu cho DN021 (`revenue match below threshold`, 0/3), nhưng model cuối ghi `revenueBalanced=true`, không unavailable và không làm sai contract pinned completeness. Warning này phải tiếp tục được quan sát tại bước acceptance PROD.

## Digest và checksum

- Model canonical digest/checksum: `ca51159b707751a0ef42acfbf6c427dcab29ad0554a4581102d123725d7898ea`.
- Manifest canonical digest: `6cb6d82a61383730a1899cdb953d66e17fd8ffa99bc06d16fa60249ca2159214`.
- Roster identity: `812aaf49fcf9cba16cd8bba4b611a35c962212a9b454a6b1b83f12cffa1dfd41`.
- Result JSON SHA-256: `95c4bd96d0e9e2c093a6d92e9764485d02fadcc87cdc9c7cdc1088376d2142fc`.
- Source trace SHA-256: `d40c2e060810533dd1ba616ef87e5152e5610a523b325562f579748cc4ade7a0`.
- Independent integrity JSON SHA-256: `33f74680d706550c7726ca64961c8cb9223020bce058525235d7dee78612a4a0`.
- Publication checksum list SHA-256: `5e87664ffa539f7d6cc7e761347bb2831e6dec06192ece1bf34094602fcde881`.

## Các lượt fail-closed trước lượt PASS

Không bỏ qua bằng chứng xấu:

1. Raw `08.2026` bị từ chối đúng validator kỳ.
2. Lượt dùng data clone còn local cache trả 21 `ok` nhưng **0 evidence accepted**; candidate publish partial 0/21, chứng minh local fallback không được thăng cấp thành source snapshot.
3. Lượt network đầu có 19/21 accepted nhưng DN005/DN021 unavailable, rồi dependency drift; không publish generation.
4. Một lượt serial khác chỉ đạt 3/21; generation partial đó không được dùng.
5. Lượt authoritative 21/21 đầu tiên bị dependency drift trước publish; không publish generation.
6. Lượt authoritative retry cuối mới đạt toàn bộ gate và là generation duy nhất được chấp nhận trong tài liệu này.

Điều này cho thấy DataHub T08 có dao động ngắn hạn. Khi triển khai thật, một lần shadow PASS **không cho phép bỏ acceptance gate**: sync PROD phải tiếp tục fail-closed nếu không đủ 21/21 trong cùng generation.

## Evidence custody

Thư mục evidence:
`/home/osboxes/.openclaw/workspace-report-dev/artifacts/t08-shadow-9014644-20260813-202126`

Tệp chính:

- `result-authoritative-retry2.json`
- `source-trace-authoritative-retry2.json`
- `integrity-independent.json`
- `SHA256SUMS-publication.txt`
- `run-t08-shadow.js`
- `logs/run-authoritative-retry2.stdout`
- `logs/run-authoritative-retry2.stderr`

## Phạm vi không thay đổi

- PROD vẫn `3a3a47d8ac2634ffd0bdecfb46f71db24667a823`.
- Không restart/reload PM2; không đổi symlink.
- Không đổi config/DB/cache PROD.
- Không publish/serve shadow snapshot.
- `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` vẫn tắt.
