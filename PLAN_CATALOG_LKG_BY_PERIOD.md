# Kế hoạch tách Catalog LKG theo kỳ — để review, chưa thi hành

## Hiện trạng và mục tiêu

- `catalog_management_lkg.json` hiện là một file JSON `377.813.964` byte (~361 MiB trên đĩa).
- Một lần parse toàn file có thể làm RSS/VmHWM tăng mạnh; PROD đã ghi nhận VmHWM thật khoảng 2,68 GiB trong luồng bootstrap/page/catalog.
- Mục tiêu: request một kỳ chỉ đọc/parse dữ liệu của kỳ đó; giữ nguyên tính LKG, checksum, policy field và khả năng rollback.
- Không đổi contract API, không mất kỳ cũ, không tự refresh DataHub trong migration.

## Giai đoạn 0 — đo và khóa hành vi

- Thêm benchmark fixture/PROD-like: cold read, hot read, peak RSS, số byte parse, thời gian một kỳ và nhiều kỳ.
- Khóa test parity giữa monolith và projected period snapshot: `rows`, `catalog`, `history`, metadata version/checksum, DQ projection.
- Khóa crash/partial-write, checksum drift, retention và quyền file.
- Rollback: không có runtime change; bỏ test/telemetry candidate.

## Giai đoạn 1 — period sidecar chỉ đọc, dual-read

- Sinh cấu trúc versioned, ví dụ `catalog_lkg/v1/YYYY-MM.json` + `index.json` từ monolith bằng tool offline.
- Mỗi period file có schema version, period, content checksum và source metadata; `index.json` có checksum từng file.
- Reader ưu tiên sidecar khi index + file verify PASS; nếu thiếu/corrupt thì fallback monolith hiện tại và ghi metric, không gọi DataHub chỉ vì migration lỗi.
- Chưa thay writer; chưa xoá monolith.
- Rollback: tắt feature flag, reader quay ngay về monolith.

## Giai đoạn 2 — dual-write có đối chứng

- Writer hiện tại tiếp tục atomic-write monolith, sau đó atomic-write period file/index bằng temp + fsync + rename.
- Chỉ công bố index mới sau khi tất cả period targets verify.
- Sau mỗi refresh, so digest semantic monolith ↔ period files; lệch thì sidecar không được activate.
- DQ cache/index retention phải cùng cửa sổ với period LKG.
- Rollback: tắt period writer/reader; monolith vẫn là nguồn rollback đầy đủ.

## Giai đoạn 3 — period-first theo cohort

- Bật period-first cho route Catalog read-only trước; sau đó employee-cost build; cuối cùng các consumer còn lại.
- Mỗi cohort có gate: parity 100%, health/auth, peak RSS, latency, no unexpected DataHub call, no stale generation.
- Giữ monolith shadow-read theo sampling để phát hiện divergence nhưng không parse trên mọi request.
- Rollback từng cohort bằng feature flag, không đổi dữ liệu.

## Giai đoạn 4 — period-native writer, monolith làm backup

- Writer cập nhật đúng period file và index, không dựng lại toàn bộ object 377 MB trong RAM.
- Tạo monolith backup bất đồng bộ/offline trong một cửa sổ chuyển tiếp; không nằm trên request path.
- Chỉ sau nhiều kỳ acceptance mới ngừng monolith live-write.
- Rollback: phục hồi monolith backup đã verify và tắt period-native flag.

## Giai đoạn 5 — dọn có kiểm soát

- Sau retention window và restore drill PASS, archive monolith; không xóa ngay.
- Cập nhật runbook backup/restore, manifest release exclusions và formula/data identity để period file đúng là input theo kỳ.
- Rollback: restore archive + bật monolith reader.

## Gate bắt buộc mỗi giai đoạn

- Không deploy từ dirty/current; candidate exact commit + manifest.
- Test semantic parity, checksum/auth envelope, concurrent reader/writer, crash recovery, file/dir fsync.
- Đo `/proc/<pid>/status`: VmRSS/VmHWM; PM2 chỉ đối chiếu.
- Browser/API smoke Catalog và Employee Cost, local/public health, `/api/me` auth boundary.
- Không sửa DataHub, không tự refresh nguồn, không bật serve snapshot.
- Gate 1 riêng cho code; Gate 2 riêng cho từng cohort deploy.

## Tiêu chí thành công dự kiến

- Request một kỳ không parse monolith 377 MB.
- Peak RSS của cold period read nằm dưới budget được duyệt bằng benchmark, không dùng con số suy đoán trước khi đo.
- Output semantic/digest của từng kỳ khớp monolith hiện hành.
- Corrupt/missing period file fail-safe về monolith trong giai đoạn chuyển tiếp; không trả số sai hoặc gọi nguồn ngoài ý muốn.
