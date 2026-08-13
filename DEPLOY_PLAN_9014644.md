# DEPLOY PLAN — candidate 9014644

**Trạng thái: KẾ HOẠCH CHƯA THI HÀNH.** Cần Claude duyệt kế hoạch và CEO duyệt riêng Gate 2 + thời điểm. Tài liệu này không cho phép deploy, restart/reload, đổi config hay ghi snapshot PROD trong phiên hiện tại.

## 0. Định danh và ranh giới

- Candidate code: `90146448895cd4d6b845e24925f40e603d8569fb`.
- Candidate tree: `80ffc6937fb5ecb9389df7a9e0aefebbdeeebbfd`.
- Branch tài liệu: `bot/candidate-fb616d1-on-1c7d6f5`.
- PROD trước cutover: `3a3a47d8ac2634ffd0bdecfb46f71db24667a823`.
- Release trước cutover: `release-app-report-3a3a47d-20260813-085826`.
- PID baseline: `784273`.
- `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` phải giữ **OFF** toàn bộ kế hoạch.
- Không publish/serve custody T07; không dùng `employee_cost_rate_snapshot.json` thay closed seal.
- Snapshot T08 chỉ được tạo sau cutover bằng code `9014644`, vào snapshot root thật và chỉ được coi đạt khi cùng generation đủ 21/21.

## 1. Điều kiện vào Gate 2

Chỉ bắt đầu khi tất cả PASS:

1. CEO duyệt đúng release/artifact/manifest và thời điểm deploy; không tái dùng approval cũ.
2. PROD vẫn đúng release/hash/PID baseline hoặc mọi drift đã được dừng để CEO xem lại.
3. Worktree build sạch, exact code delta `server web` so với `9014644` bằng 0.
4. Guard RSS/PID còn chạy; RSS dưới ngưỡng cấm cutover; không có PID drift/restart bất thường.
5. DataHub T07 monitor gần nhất được ghi. Nếu T07 hết 409, **dừng kế hoạch này** và ưu tiên seal/snapshot T07 từ nguồn tươi.
6. `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` xác minh OFF trong env hiệu lực của release candidate.
7. Có đủ dung lượng cho release, backup restore-verified và snapshot generation T08.

**Điểm quay lui:** bất kỳ điều kiện nào fail thì dừng trước build/cutover; PROD không đổi, không restart.

## 2. Build release bất biến từ exact candidate

1. Tạo clean detached build worktree từ exact `9014644`, không build từ documentation tip.
2. Cài/verify dependency theo lockfile hiện hữu; không nâng version ngoài candidate.
3. Chạy gate tối thiểu đã xác nhận cho candidate:
   - focused snapshot/seal tests;
   - full web tests + web build;
   - full server tests, ghi rõ baseline VP018 duy nhất nếu vẫn đúng cùng lỗi đã biết;
   - syntax/integrity/security gate của release.
4. Đóng artifact/release immutable; sinh manifest SHA-256 và embedded `/version.json` cùng nhận diện exact `9014644`.
5. So manifest với source; verify lại artifact sau đóng gói.

**Thành công:** mọi gate mới PASS, chỉ baseline VP018 đã biết được phép tồn tại; artifact manifest-bound, exact commit/tree đúng, worktree sạch.

**Điểm quay lui:** test/build/manifest fail ⇒ xóa/niêm phong artifact lỗi khỏi luồng deploy, không động symlink/PM2/PROD.

## 3. Pre-cutover backup và freeze

1. Ghi lại symlink, release/hash/version, PM2 pid/restart count/RSS, health local/public và cờ snapshot.
2. Tạo backup dữ liệu trước khi chạm service; verify archive và thử đọc/restore vào thư mục cô lập.
3. Ghi rollback target pre-cutover chính xác là release `3a3a47d...`; giữ nguyên rollback khẩn cấp theo chỉ đạo CEO tại mục 8.
4. Verify manifest candidate lần cuối ngay sát cutover; nếu có file drift thì dừng.

**Thành công:** backup restore-verified, manifest không drift, baseline runtime đầy đủ.

**Điểm quay lui:** backup/verify/drift fail ⇒ dừng khi service vẫn ở `3a3a47d`, không reload/restart.

## 4. Atomic cutover (chỉ sau Gate 2)

1. Chuyển symlink atomically sang release exact `9014644`.
2. Nạp duy nhất process `app-report` theo lệnh đã duyệt; không chạm `app-report-tgbot` nếu manifest không yêu cầu.
3. Không bật `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT`.
4. Không chạy migration/DB/config ngoài manifest duyệt.

**Thành công:** PM2 online, PID mới hợp lệ, restart count chỉ tăng đúng một cutover dự kiến, symlink/version đều nhận exact `9014644`.

**Điểm quay lui:** nếu cutover tạo OOM/restart bất thường hoặc số liệu lệch đối chứng thì áp rollback khẩn cấp mục 8. Nếu chỉ có lỗi kỹ thuật cutover khác, fail-closed và xin CEO quyết định trước thao tác runtime tiếp theo; không tự ý restart vòng lặp.

## 5. Health và acceptance trước khi ghi snapshot T08

Theo thứ tự:

1. Local health HTTP 200.
2. Public health HTTP 200; `/version.json` và bundle cùng exact release.
3. Auth boundary: unauth/không-admin bị chặn đúng; CEO/admin đọc được.
4. PM2: online, không restart loop, log không có uncaught/OOM/secret.
5. Browser E2E CEO: dashboard và employee-cost T07/T08 tải được; console sạch.
6. T07 read-only đối chứng với kết quả trước deploy: số dòng/NV/doanh thu và fail-closed labels không được sai lệch ngoài degradation đã đo.
7. Xác minh snapshot serving vẫn OFF.

**Thành công:** toàn bộ gate PASS và RSS không đi vào cửa rollback.

**Điểm quay lui:** chỉ thực hiện rollback runtime theo đúng ba tiêu chí mục 8; ngoài ra dừng trước snapshot sync và báo CEO, không tự reload/restart.

## 6. Sync T08 ngay vào snapshot store thật, serve vẫn OFF

Chỉ chạy sau khi mục 5 PASS:

1. Xác định snapshot root thật, owner/mode/dung lượng; backup riêng root nếu đã có dữ liệu.
2. Thực hiện one-shot sync canonical kỳ `2026-08` bằng exact code `9014644`. Business notation `08.2026` phải được normalize ở lớp gọi; hàm store chỉ nhận `YYYY-MM`.
3. Cờ serving giữ OFF trước, trong và sau sync. Không dùng generation shadow làm PROD generation; PROD phải tự lấy nguồn và publish generation mới của chính nó.
4. Nghiệm thu cùng một generation:
   - 21/21 exact-range evidence accepted;
   - 21 pinned employee records;
   - `availableCount=21`, unavailable 0;
   - manifest/roster/model khớp;
   - `complete=true`, state ready;
   - current pointer trỏ đúng generation;
   - envelope checksum/integrity + model/manifest digest PASS;
   - T08 model revenue reconciliation balanced, DQ warnings được ghi đầy đủ.
5. Nếu nguồn dao động làm partial/dependency drift, giữ fail-closed, không retry dồn dập và tuyệt đối không serve generation partial.

**Thành công:** generation PROD T08 mới đạt toàn bộ contract; evidence/checksum được custody. Snapshot vẫn chưa phục vụ GET.

**Điểm quay lui:** sync fail trước publish ⇒ giữ generation cũ/current cũ; sync partial ⇒ không serve, không gọi là thành công. Nếu current pointer bị thay bởi generation không đạt, khôi phục pointer từ backup snapshot root sau khi CEO duyệt thao tác ghi; không restart service nếu chưa rơi vào tiêu chí mục 8.

## 7. Hậu kiểm và kết thúc deploy

1. Recheck local/public health/version/auth/browser.
2. Recheck PM2 PID/restart/RSS trong cửa theo dõi tối thiểu 10 phút.
3. Recheck T07 read-only; đối chứng canonical khi còn dữ liệu.
4. Recheck T08 status và checksum từ disk; serving flag vẫn OFF.
5. Ghi release, backup, generation T08, manifest, test, log và rollback evidence.
6. Chỉ báo hoàn tất khi mọi gate PASS; việc bật serving cần quyết định/approval riêng sau này.

## 8. Rollback khẩn cấp đứng một mình

Chỉ kích hoạt khi có đúng một trong ba điều kiện CEO đã chốt:

1. OOM hoặc restart bất thường;
2. RSS `>1,8 GiB` liên tục hơn 10 phút;
3. số liệu lệch đối chứng.

Hành động đã chỉ định: checkout exact `7870f10e0d60b9b635bfe28d57b7a9f8ef63f5d4` vào **clean rollback release/worktree** (không checkout/reset trực tiếp dirty `current`), atomically trỏ `current` sang release đó và restart PM2; sau đó health/version/auth/data smoke. Đây là thao tác runtime phá vỡ trạng thái hiện tại nên chỉ được thi hành khi tiêu chí thực sự xảy ra và phải lưu evidence trước/sau. Ngoài ba trường hợp: không restart, không rollback tự động.

## 9. Mất gì ở T07 khi restart

Kết quả ba mẫu GET admin cách nhau 10 phút sẽ được đóng tại đây trước khi commit cuối:

Ba mẫu authenticated admin GET read-only:

| GMT+7 | HTTP | Dòng / NV base | Unavailable / stale | Serving class | Ô tổng kỳ | Ô tổng sau phạt |
|---|---:|---:|---:|---|---|---|
| 20:24:18 | 200 | 2.091 / 21 | 0 / 0 | `healthy_cached` | có, không null | **bị chặn/null**, 18/21 NV có số phạt |
| 20:34:09 | 200 | 2.091 / 21 | 0 / 0 | `healthy_cached` | có, không null | **bị chặn/null**, 18/21 NV có số phạt |
| 20:44:21 | 200 | 2.091 / 21 | 0 / 0 | `healthy_cached` | có, không null | **bị chặn/null**, 18/21 NV có số phạt |

Nhãn giữ nguyên cả ba lượt:

- `Hiện 2.091/2.091 dòng`;
- `Chưa đủ dữ liệu chi phí`;
- `Tổng toàn đội chưa đủ nguồn (18/21 NV có số phạt) — không suy số sau phạt`;
- `Tạm tính 18/21 NV · backend cộng từ kết quả từng người · không đổi theo bộ lọc bảng`.

Evidence local: `/home/osboxes/.openclaw/workspace-report-dev/artifacts/t07-prod-readonly-3x10m-20260813.json`.

Diễn giải dùng để quyết định giờ deploy:

- Nếu cả ba mẫu còn `healthy_cached` 2.091 dòng/21 NV, restart có thể làm mất **toàn bộ lớp cache RAM khỏe này**, vì DataHub T07 vẫn 0/21 HTTP 409 và không có closed seal/generation đầy đủ để dựng lại.
- Việc ô “sau phạt” đang bị chặn 18/21 là fail-closed riêng của dữ liệu phạt; không đồng nghĩa base T07 đã trống.
- Vì vậy câu “màn đã trống thì restart không còn gì để mất” chỉ đúng nếu mẫu thực tế cho thấy base đã rơi hết. Nếu cache vẫn khỏe, deploy hiện tại vẫn có rủi ro hiển thị T07 rất lớn và CEO phải chọn thời điểm có chủ đích.

## 10. DataHub T07 ưu tiên vượt kế hoạch

Nếu monitor cho thấy hết 409 ở bất kỳ thời điểm nào: dừng build/cutover/sync T08 nếu còn an toàn để dừng, báo CEO ngay và chuyển sang dựng closed seal/snapshot T07 từ nguồn tươi đủ 21/21 exact range. Không dùng rate snapshot hoặc reconstruction thay seal.
