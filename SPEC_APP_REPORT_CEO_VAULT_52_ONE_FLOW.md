# SPEC — Kho snapshot 52 cột trung tâm cho App Report

> Trạng thái: **đề xuất kiến trúc để review, chưa triển khai**. Tài liệu này không cho phép merge, deploy hay cutover production.
>
> Quyết định nghiệp vụ của CEO ngày 17/08/2026: mọi luồng đọc danh mục trong App Report phải quy về một snapshot trung tâm nhận từ CEO Vault/DataHub. Tab CEO-only là màn điều khiển và kiểm tra; không phải nguồn dữ liệu chạy trong trình duyệt.

## 1. Mục tiêu và ranh giới

Luồng chuẩn duy nhất:

```text
CEO Vault / DataHub
        |
        v
App Report: immutable full snapshot C1-C52
        |
        +--> projection Danh mục QL an toàn cho nhân viên
        +--> projection Mã ĐV + QLNB + ĐVT -> Mã NV
        +--> projection chi phí theo quyền
        +--> projection data-quality / báo cáo / phân bổ
        |
        v
Tất cả tab App Report chỉ đọc projection của cùng một active snapshot
```

- CEO Vault/DataHub tiếp tục là **source of truth** và nơi duy nhất sửa dữ liệu gốc.
- App Report chỉ đồng bộ, xác thực, lưu snapshot, dựng projection và phục vụ đọc.
- Không thay đổi nguồn doanh số CRM/WEB trong dự án này.
- Không để tab giao diện gọi DataHub rồi cấp dữ liệu cho tab khác.
- Không dùng full C1-C52 chung payload/cache với API nhân viên.

## 2. Vai trò tab `CP Total 52 cột (CEO)`

Tab con nằm trong `Danh mục quản lý`, chỉ CEO được thấy và gọi API. Đây là control plane:

- xem version, kỳ, checksum, schema version, số dòng, thời điểm nhận và active snapshot;
- preview một lần đồng bộ trước khi kích hoạt;
- xem đủ C1-C52 theo phân trang/streaming, tìm kiếm/lọc/ghim cột; **đợt đầu chưa cho xuất full 52** cho tới khi có policy export riêng;
- xem kết quả validation và trạng thái từng projection;
- kích hoạt rollback về last-known-good.

Đóng trình duyệt hoặc lỗi tab không được ảnh hưởng dữ liệu các tab khác. Backend snapshot/projection mới là data plane.

Để tránh khóa cứng CEO, control plane phải có luồng enroll thiết bị rõ ràng: CEO đăng nhập session người, hoàn tất OTP reverify mới được server đánh dấu device `is_trusted` và lưu `last_otp_at/trusted_at`. Đăng nhập Telegram đơn thuần không tự tạo trust. Nếu OTP backend/enrollment chưa sẵn sàng, full-52 trả `503 control_plane_trust_unavailable` kèm diagnostics cho CEO và **không fail open**.

## 3. Mô hình lưu trữ

Mỗi bản nhận được ghi bất biến theo `period + sourceVersion + checksum`, không ghi đè file đang active.

Manifest tối thiểu:

```json
{
  "schemaVersion": 1,
  "period": "2026-08",
  "source": "ceo-vault",
  "sourceVersion": "V31.7",
  "sourceVersionNo": 9,
  "rowCount": 28006,
  "fullChecksum": "sha256:...",
  "receivedAt": "2026-08-17T11:00:00.000Z",
  "validatedAt": "2026-08-17T11:00:30.000Z",
  "activatedAt": null,
  "projections": {
    "catalogSafe": { "rowCount": 0, "checksum": "sha256:..." },
    "employeeMapping": { "rowCount": 0, "checksum": "sha256:..." },
    "costRestricted": { "rowCount": 0, "checksum": "sha256:..." }
  }
}
```

Yêu cầu:

- full snapshot và từng projection có checksum riêng;
- chỉ có **một active pointer** cho mỗi kỳ. Pointer chứa manifest ID/path bất biến và được đổi bằng đúng một atomic rename cuối cùng;
- reader phải đọc pointer một lần, ghim đúng manifest đó trong suốt request/job rồi giải mọi projection bằng immutable path/checksum trong manifest; không được đọc lại pointer giữa chừng;
- giữ tối thiểu active + last-known-good và retention hữu hạn theo kỳ/version. Snapshot đang được reader ghim không được xóa; retention dùng reference/grace period dài hơn request/job tối đa;
- không đưa full 52 cột vào `catalog_management_lkg.json` hiện hữu. Cache monolithic hiện đã từng khoảng 377 MB, parse/read lâu và RSS cao; thiết kế mới phải chia theo kỳ/version/projection, đọc streaming hoặc index phù hợp;
- ghi temp, `fsync` file và thư mục theo khả năng nền tảng, atomic rename từng artifact immutable; chỉ sau khi tất cả hoàn tất mới atomic rename active pointer;
- full C1-C52 được phục vụ streaming/phân trang; API không nạp toàn bộ snapshot vào process phục vụ request;
- projection được dựng ngoài request path, ưu tiên process/worker tách biệt với API để giới hạn RSS.

## 4. Pipeline đồng bộ và kích hoạt nguyên tử

Một nút `Đồng bộ toàn bộ từ CEO Vault` chỉ tạo candidate:

1. lấy **một write lock crash-safe, cross-process** theo kỳ, có owner PID/host/boot/token, TTL, heartbeat và tự thu hồi. Cùng lock này phải serialize `activate`, `rollback` và `retention-delete`, không chỉ hai lượt sync;
2. lấy đúng một source version đầy đủ C1-C52 qua S2S auth;
3. kiểm schema, kỳ, row count và cột bắt buộc. Checksum do CEO Vault công bố là bắt buộc; verify trên canonical bytes/stream nhận được. Thiếu hoặc sai checksum phải fail closed; checksum App Report tự sinh chỉ dùng định danh nội bộ, không thay thế bằng chứng toàn vẹn nguồn;
4. kiểm unique identity theo contract nguồn và phát hiện duplicate/conflict;
5. kiểm mapping canonical do Vault cung cấp `C7 + C5 -> C6`; App Report không tự chọn first-win. ĐVT là khóa hay validation phải do contract Vault công bố, không suy diễn tại runtime;
6. worker tách process dựng **tất cả** projection từ cùng candidate và xuất artifact immutable;
7. đối chiếu tổng dòng, khóa, conflict và checksum giữa full snapshot với projection;
8. ghi audit receipt và fsync toàn bộ artifact/manifest, sau đó đổi active pointer đúng một lần bằng atomic rename;
9. invalidation cache theo manifest mới. Không tab nào được đọc hỗn hợp hai version.

Nếu bước 2–8 lỗi: candidate bị đánh dấu failed/quarantine, active snapshot cũ không đổi. Retention không được chạy ngoài write lock và không được xóa manifest/file còn active, LKG hoặc đang được reader ghim.

## 5. Projection và hợp đồng đọc

### 5.1 `catalogSafe`

Phục vụ `Danh mục QL` và API nhân viên. Chỉ serialize allowlist trường vận hành đã duyệt. Không nhận full row rồi xóa cột ở frontend.

### 5.2 `employeeMapping`

Phục vụ phép tìm nhân viên theo Mã ĐV + QLNB, có ĐVT để xác thực khi nguồn nghiệp vụ cung cấp. C6 và quy tắc ĐVT phải lấy trực tiếp từ contract/snapshot Vault. Projection phải giữ tập mọi candidate C6 theo key, không được first-win. Phải báo riêng:

- thiếu đơn vị;
- thiếu nhân viên;
- nhiều nhân viên trên cùng canonical key;
- ĐVT không khớp.

Không dùng bảng `products` làm điều kiện chặn mapping canonical nếu contract production vẫn là `C7 + C5 -> C6`.

### 5.3 `costRestricted`

Chỉ chứa phần cần cho phép tính chi phí và chỉ được đọc qua endpoint có quyền server-side tương ứng. Không được tái sử dụng endpoint/catalog cache của nhân viên.

### 5.4 Các projection khác

Data quality, báo cáo và phân bổ phải ghi rõ input columns, key, row grain và source manifest. Không projection nào được tự gọi DataHub.

Trước implementation phải khóa bảng contract tối thiểu:

| Projection | Input bắt buộc | Key/grain bắt buộc |
|---|---|---|
| `catalogSafe` | allowlist trường vận hành được CEO duyệt | identity nguồn của từng dòng |
| `employeeMapping` | C7, C5, C6 và trường ĐVT theo contract Vault | canonical key Vault, giữ mọi C6 để phát hiện conflict |
| `costRestricted` | danh sách C-column nhạy cảm được duyệt riêng | row identity + kỳ + pháp nhân nếu có |
| data-quality/báo cáo khác | khai báo tường minh trong spec consumer | không được tự suy diễn grain |

## 6. Bảo mật dữ liệu C32-C47

- Full C1-C52: chỉ **CEO là người thật + trusted device/session**; kiểm quyền tại server cho mọi request bằng một gate chuẩn `requireCeoTrustedHuman`.
- Gate này bắt buộc đồng thời: session người từ `requireAuth`; `role=ceo`; device ID đang `is_trusted`; `last_otp_at/trusted_at` còn trong cửa sổ reverify tối đa 12 giờ; không có `session.service`; không có `method=service-token`/QA. Gate phải đọc trust live từ device store ở mỗi request, không tin cờ nhúng sẵn trong token. Full endpoint **cấm** dùng middleware chấp nhận DataHub service token như `requireTargetAuth`/`requireDataHubService`, dù service session đang mang `role=ceo`.
- Admin/NV gọi full endpoint phải trả `403`, kể cả biết URL hoặc sửa frontend.
- C32-C47 phải **vắng mặt vật lý** trong file/payload `catalogSafe`, không chỉ bị ẩn cột UI.
- C32-C47 và alias/giá trị mẫu nhạy cảm không được xuất hiện trong log, error body, diagnostics, health response, metrics label, browser cache, service worker hay export của NV.
- Đợt đầu **không triển khai export full 52**. Khi có phiếu riêng, export phải audit actor, thời điểm, trusted device, version/checksum và phạm vi.
- Encryption at rest/secrets/backup retention phải theo hạ tầng hiện hữu; tài liệu triển khai phải chứng minh quyền file và vị trí backup.

Chính sách này **supersede** Phase-1 đối với `catalogSafe`: C33-C46 cũng không được mở bằng allowlist vào projection nhân viên/admin chung. Nếu CEO duyệt dùng một cột C33-C46 cho phép tính nội bộ, cột đó chỉ được nằm trong projection purpose-bound như `costRestricted`, không bao giờ đi vào `catalogSafe`.

Checksum được tách hai loại, cấm nhập nhằng:

- `sourceIntegrityChecksum`: verify đúng canonical representation/bytes theo contract CEO Vault công bố; App Report không tự re-serialize rồi gọi đó là checksum nguồn.
- `internalIdentityHash`: App Report có thể tạo bằng canonical order-stable serializer để định danh artifact nội bộ; không thay thế integrity checksum.

Ma trận tối thiểu:

| Vai trò | Full C1-C52 | catalogSafe | employeeMapping | costRestricted |
|---|---:|---:|---:|---:|
| CEO trusted | đọc | đọc | đọc | đọc |
| Admin | cấm mặc định | đọc theo quyền | đọc diagnostics đã làm sạch | cấm mặc định |
| Nhân viên | cấm | chỉ phạm vi bản thân | không đọc raw | cấm |
| Service nội bộ | **cấm tuyệt đối** | theo purpose/consumer | theo purpose/consumer | token/purpose riêng nếu được duyệt |

## 7. Chuyển đổi an toàn

1. Dựng kho snapshot/projection ở chế độ shadow; tab hiện tại chưa đổi nguồn.
2. Chạy cùng kỳ và **ghim cùng source version/checksum** để so sánh full keyset, số dòng, mapping, checksum, thống kê và quyền với luồng hiện tại.
3. Chuyển `Danh mục QL` qua feature flag đầu tiên.
4. Chuyển từng consumer còn lại, mỗi consumer có test, metric và rollback riêng.
5. Khi mọi consumer đạt và CEO duyệt, khóa đường **đọc** DataHub cũ trong App Report. Đường **ghi** nghiệp vụ vẫn đi về CEO Vault/DataHub.

Không cutover hàng loạt và không xóa adapter cũ trước khi qua ít nhất một kỳ đầy đủ, đạt SLO/đối chiếu liên tục theo kế hoạch nghiệm thu. Mỗi response trả `sourceVersion`, checksum, `stale`, tuổi snapshot và active manifest ID; client phát hiện đổi manifest giữa các tab phải reload/đồng bộ lại thay vì trộn version trong cùng thao tác nghiệp vụ.

## 8. Rollback và vận hành lỗi

- Rollback lấy cùng write lock rồi chỉ đổi active pointer về manifest last-known-good đã xác thực; kết quả deterministic khi cạnh tranh với sync/retention.
- DataHub lỗi: tiếp tục đọc LKG và gắn `stale`, `staleAgeSeconds`, version/checksum; không tự tạo dữ liệu rỗng/0. Mặc định cảnh báo ngay khi stale và fail health/SLO nếu quá 24 giờ; ngưỡng cuối cùng phải được CEO duyệt trước implementation.
- Projection lỗi: giữ toàn bộ active version cũ, không kích hoạt từng phần.
- Schema/version lạ hoặc checksum sai: fail closed, báo diagnostics cho CEO.
- Mọi lần preview/activate/rollback có audit trail; không có thao tác xóa snapshot vật lý trong UI đợt đầu.

## 9. Tiêu chí nghiệm thu trước cutover

- Một kỳ chỉ có một active manifest; mọi tab trả cùng sourceVersion/checksum.
- 100% candidate rows được phân loại; duplicate/conflict/quarantine có danh sách rõ.
- `catalogSafe` và response NV không chứa bất kỳ C32-C47/alias nhạy cảm nào, kiểm cả serialize đệ quy.
- Cross-role test chứng minh admin/NV, service token mang `role=ceo`, QA session và CEO trên device chưa trusted đều nhận 403 từ full endpoint.
- CEO session chỉ qua Telegram nhưng chưa OTP-enroll nhận diagnostics rõ và không truy cập full-52; OTP-enroll thành công mới đọc được.
- Device trust bị revoke/evict hoặc quá 12 giờ từ `last_otp_at/trusted_at` thì request kế tiếp trả 403; gate đọc device store live.
- Kiểm trực tiếp artifact `catalogSafe` trên đĩa, response, log, diagnostics, health, error và metrics: không chứa C32-C47, alias hoặc giá trị canary nhạy cảm.
- Mapping canonical đạt threshold production, conflict = 0; denominator dùng đúng row grain, không so distinct pairs với raw rows một cách sai nghĩa.
- Payload thiếu/sai checksum Vault fail closed và không activate; cấm self-hash fallback. Canonical hash phải ổn định trước thứ tự object keys.
- Test phân biệt source integrity checksum với internal identity hash; đổi thứ tự key theo canonical contract không tạo pass/fail giả.
- Kill process tại từng bước ghi/kích hoạt không làm mất active snapshot; reader luôn giải được trọn một manifest.
- Chạy hai process cạnh tranh sync/rollback/retention: chỉ một writer thắng theo lock, kết quả deterministic và lock chủ chết được thu hồi an toàn.
- Reader chậm đang ghim manifest không bị retention xóa file; sau grace/ref release mới được thu hồi.
- Mapping có nhiều C6 trên một key phải xuất conflict đầy đủ, không first-win; denominator đúng row grain.
- Đặt, đo và biến thành regression guard ngân sách RSS, thời gian ingest, thời gian projection, p95 API và dung lượng retention trên 28.006 dòng × 52 cột; không chấp nhận số ước đoán.
- Full endpoint chứng minh streaming/pagination và worker projection không làm phình RSS process API.
- Client phát hiện active manifest đổi giữa hai tab và không dùng hai version trong cùng thao tác nghiệp vụ.
- Static/grep guard fail nếu route full-52 tham chiếu `requireTargetAuth`, `requireDataHubService` hoặc middleware service-session tương đương.
- Policy test dùng cùng fixtures cho Phase-1 và one-flow: `catalogSafe` không chứa C32-C47; cột C33-C46 được duyệt nội bộ chỉ xuất hiện trong projection purpose-bound.
- Rollback drill trả lại đúng version/checksum và tất cả consumer đọc đồng nhất.

## 10. Câu hỏi bắt buộc cho Claude review

1. Ranh giới full snapshot/projection đã đủ ngăn C32-C47 rò qua cache, error, export và consumer nội bộ chưa?
2. Atomic activation có còn cửa đọc mixed-version hoặc race giữa sync/rollback không?
3. Nên dùng object files + manifest hay database tables/partition cho tải 28k × 52 và retention nhiều kỳ?
4. Identity/key nào cần được lấy trực tiếp từ CEO Vault thay vì App Report tự suy diễn?
5. Kế hoạch feature-flag/cutover consumer nào có nguy cơ tạo hai nguồn thật hoặc stale LKG âm thầm?
6. Test bảo mật, hiệu năng và disaster recovery nào còn thiếu trước khi cho phép code?

## 11. Điều kiện quản trị thay đổi

- Nhánh này chỉ chứa tài liệu thiết kế.
- Claude review độc lập trên exact commit SHA.
- Finding phải được sửa và review lại trên cùng nhánh.
- Chỉ sau Claude GO và CEO duyệt lần cuối mới được mở phiếu implementation riêng.
- Merge/deploy production luôn là cổng duyệt khác; không được suy ra từ việc duyệt spec.
