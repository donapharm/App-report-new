# Evidence Giai đoạn 1 — period sidecar dual-read, cờ mặc định tắt

## Phạm vi

- Reader sidecar chỉ đọc, ưu tiên đúng kỳ khi `CATALOG_PERIOD_LKG_READ_ENABLED=true`.
- Cờ mặc định tắt. Writer runtime và DataHub refresh không đổi.
- Tool dựng sidecar là CLI offline; tách parse main/DQ thành hai child process cô lập, công bố `index.json` sau cùng.
- Index ghi checksum SHA-256 của từng file; reader kiểm index, tên file, checksum và envelope/period trước khi dùng.
- Thiếu/hỏng sidecar trả về đường monolith hiện hữu và chỉ tăng diagnostics; không có callback hay import nào gọi DataHub vì lỗi migration.

## Ba ràng buộc cứng

1. Một kỳ đọc đúng một fragment; test đếm fragment và fail nếu nhiều hơn một.
2. Range helper đọc tuần tự, trần mặc định/tối đa được duyệt là 6 kỳ; range 7 kỳ bị chặn `CATALOG_PERIOD_RANGE_LIMIT`.
3. Materialize chỉ qua `server/scripts/build_catalog_period_lkg.js`; runtime không gọi script và cờ vẫn OFF.

## Đo range thực trên sidecar sinh từ LKG live

Đo trong tiến trình Node độc lập, `--expose-gc`, consume tuần tự chỉ lấy số dòng/catalog rồi bỏ tham chiếu:

| Dải | Fragment | Byte trên đĩa | Thời gian tuần tự | Peak RSS thật |
|---|---:|---:|---:|---:|
| T06–T08 | 3 | 123.397.515 | 3.594,17 ms | 480.571.392 byte |
| T03–T08 | 6 | 246.407.472 | 6.455,82 ms | 520.794.112 byte |

Peak tăng nhẹ từ 3 lên 6 kỳ (`~40,2 MB`), không tỷ lệ tuyến tính theo tổng byte vì mỗi payload được consume và thả trước khi đọc kỳ tiếp theo. Đây là gate bắt buộc; không có API load-all và test chặn range trên 6 kỳ.

Đối chứng Giai đoạn 0: load đồng thời 9 shard đã đạt peak `3.192.729.600` byte và bị coi là ca ĐỎ. Giai đoạn 1 không cung cấp đường đó.

## Trạng thái

- Focused Catalog/sidecar/persistence gate: `33/33` PASS.
- Full server: `1393/1394`; duy nhất `strictAccessPolicy` VP018 baseline đã biết, ngoài diff.
- Full web: `490/490` PASS; Vite build `661 modules` PASS; syntax và `git diff --check` PASS.
- Chưa deploy, chưa dựng sidecar trong kho live, chưa bật cờ.
- PROD vẫn dùng monolith. Bật cờ cần Gate 2 riêng sau review và acceptance parity.
