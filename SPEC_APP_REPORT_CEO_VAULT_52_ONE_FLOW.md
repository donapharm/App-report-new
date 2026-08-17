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
- xem đủ C1-C52, tìm kiếm/lọc/ghim cột/xuất Excel theo quyền CEO;
- xem kết quả validation và trạng thái từng projection;
- kích hoạt rollback về last-known-good.

Đóng trình duyệt hoặc lỗi tab không được ảnh hưởng dữ liệu các tab khác. Backend snapshot/projection mới là data plane.

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
- active pointer chỉ trỏ tới manifest đã hoàn tất toàn bộ validation;
- giữ tối thiểu active + last-known-good và retention hữu hạn theo kỳ/version;
- không đưa full 52 cột vào `catalog_management_lkg.json` hiện hữu. Cache monolithic hiện đã từng khoảng 377 MB, parse/read lâu và RSS cao; thiết kế mới phải chia theo kỳ/version/projection, đọc streaming hoặc index phù hợp;
- ghi temp, `fsync` theo khả năng nền tảng, atomic rename rồi mới đổi active pointer.

## 4. Pipeline đồng bộ và kích hoạt nguyên tử

Một nút `Đồng bộ toàn bộ từ CEO Vault` chỉ tạo candidate:

1. khóa đồng bộ theo kỳ, chống hai lượt chạy đồng thời;
2. lấy đúng một source version đầy đủ C1-C52 qua S2S auth;
3. kiểm schema, kỳ, row count, checksum và cột bắt buộc;
4. kiểm unique identity theo contract nguồn và phát hiện duplicate/conflict;
5. kiểm mapping canonical `C7 + C5 -> C6`; ĐVT dùng làm validation/khóa phụ theo projection cần thiết;
6. dựng **tất cả** projection từ cùng candidate;
7. đối chiếu tổng dòng, khóa, conflict và checksum giữa full snapshot với projection;
8. ghi audit receipt, sau đó đổi active pointer một lần;
9. invalidation cache theo manifest mới. Không tab nào được đọc hỗn hợp hai version.

Nếu bước 2–8 lỗi: candidate bị đánh dấu failed/quarantine, active snapshot cũ không đổi.

## 5. Projection và hợp đồng đọc

### 5.1 `catalogSafe`

Phục vụ `Danh mục QL` và API nhân viên. Chỉ serialize allowlist trường vận hành đã duyệt. Không nhận full row rồi xóa cột ở frontend.

### 5.2 `employeeMapping`

Phục vụ phép tìm nhân viên theo Mã ĐV + QLNB, có ĐVT để xác thực khi nguồn nghiệp vụ cung cấp. Phải báo riêng:

- thiếu đơn vị;
- thiếu nhân viên;
- nhiều nhân viên trên cùng canonical key;
- ĐVT không khớp.

Không dùng bảng `products` làm điều kiện chặn mapping canonical nếu contract production vẫn là `C7 + C5 -> C6`.

### 5.3 `costRestricted`

Chỉ chứa phần cần cho phép tính chi phí và chỉ được đọc qua endpoint có quyền server-side tương ứng. Không được tái sử dụng endpoint/catalog cache của nhân viên.

### 5.4 Các projection khác

Data quality, báo cáo và phân bổ phải ghi rõ input columns, key, row grain và source manifest. Không projection nào được tự gọi DataHub.

## 6. Bảo mật dữ liệu C32-C47

- Full C1-C52: chỉ CEO + trusted device/session; kiểm quyền tại server cho mọi request.
- Admin/NV gọi full endpoint phải trả `403`, kể cả biết URL hoặc sửa frontend.
- C32-C47 phải **vắng mặt vật lý** trong file/payload `catalogSafe`, không chỉ bị ẩn cột UI.
- C32/C47 và các trường nhạy cảm không được xuất hiện trong log, error body, metrics label, browser cache, service worker hay export của NV.
- Export full 52 cột cần audit actor, thời điểm, version/checksum và phạm vi; chưa triển khai export cho đến khi policy được duyệt.
- Encryption at rest/secrets/backup retention phải theo hạ tầng hiện hữu; tài liệu triển khai phải chứng minh quyền file và vị trí backup.

Ma trận tối thiểu:

| Vai trò | Full C1-C52 | catalogSafe | employeeMapping | costRestricted |
|---|---:|---:|---:|---:|
| CEO trusted | đọc | đọc | đọc | đọc |
| Admin | cấm mặc định | đọc theo quyền | đọc diagnostics đã làm sạch | cấm mặc định |
| Nhân viên | cấm | chỉ phạm vi bản thân | không đọc raw | cấm |
| Service nội bộ | least privilege | theo consumer | theo consumer | riêng token/purpose |

## 7. Chuyển đổi an toàn

1. Dựng kho snapshot/projection ở chế độ shadow; tab hiện tại chưa đổi nguồn.
2. Chạy cùng kỳ và so sánh full keyset, số dòng, mapping, checksum, thống kê và quyền với luồng hiện tại.
3. Chuyển `Danh mục QL` qua feature flag đầu tiên.
4. Chuyển từng consumer còn lại, mỗi consumer có test, metric và rollback riêng.
5. Khi mọi consumer đạt và CEO duyệt, khóa đường **đọc** DataHub cũ trong App Report. Đường **ghi** nghiệp vụ vẫn đi về CEO Vault/DataHub.

Không cutover hàng loạt và không xóa adapter cũ trước khi qua ít nhất một chu kỳ ổn định đã định nghĩa.

## 8. Rollback và vận hành lỗi

- Rollback chỉ đổi active pointer về manifest last-known-good đã xác thực.
- DataHub lỗi: tiếp tục đọc LKG và gắn `stale`; không tự tạo dữ liệu rỗng/0.
- Projection lỗi: giữ toàn bộ active version cũ, không kích hoạt từng phần.
- Schema/version lạ hoặc checksum sai: fail closed, báo diagnostics cho CEO.
- Mọi lần preview/activate/rollback có audit trail; không có thao tác xóa snapshot vật lý trong UI đợt đầu.

## 9. Tiêu chí nghiệm thu trước cutover

- Một kỳ chỉ có một active manifest; mọi tab trả cùng sourceVersion/checksum.
- 100% candidate rows được phân loại; duplicate/conflict/quarantine có danh sách rõ.
- `catalogSafe` và response NV không chứa bất kỳ C32-C47/alias nhạy cảm nào, kiểm cả serialize đệ quy.
- Cross-role test chứng minh endpoint full trả 403 và không lộ field trong error/cache/export.
- Mapping canonical đạt threshold production, conflict = 0; denominator dùng đúng row grain, không so distinct pairs với raw rows một cách sai nghĩa.
- Kill process tại từng bước ghi/kích hoạt không làm mất active snapshot.
- Test chạy đồng thời chỉ một candidate được activate.
- Đặt và đo ngân sách RSS, thời gian ingest, thời gian projection, p95 API và dung lượng retention trên 28.006 dòng × 52 cột; không chấp nhận số ước đoán.
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
