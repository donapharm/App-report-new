# Danh mục quản lý — Đợt 1

## Phạm vi

- Chỉ triển khai trên **App Report New** (`reportnew`), không sửa App Report cũ.
- Tạo menu/trang độc lập **Danh mục quản lý**, không gộp vào Target.
- Chưa cutover quyền production: `/catalog/sales`, `/assignments/mine` và cơ chế lọc báo cáo hiện tại vẫn hoạt động như trước.
- **Data Hub là nguồn chuẩn duy nhất.** Không dùng 1.808 assignment local cũ làm danh mục hiển thị. Khi Data Hub chưa cấu hình/lỗi, chỉ được dùng last-known-good đã xác thực ở chế độ read-only; chưa có LKG thì trả `503`.

## Contract Data Hub dự kiến

Base: `${DATA_HUB_BASE_URL}/api/integrations/app-report`; auth mọi request bằng header `x-assignment-key: ${DATA_HUB_ASSIGNMENT_KEY}`.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/assignments/catalog-management?ky=YYYY-MM` | Snapshot atomic timeline + catalog + metadata |
| GET | `/assignments/history` | Audit điều chuyển, App Report chỉ mở cho CEO/admin |
| POST | `/assignments/transfer` | Tạo điều chuyển theo tháng |

Response GET có thể bọc trong `data`. Danh sách assignment nhận các tên `rows`, `assignments` hoặc `items`; metadata hỗ trợ `version`, `checksum`, `updatedAt` ở root hoặc `meta`.

Payload S2S sau khi App Report chuyển đổi:

```json
{
  "effective_from": "2026-08",
  "to_emp": "DN016",
  "items": [{ "scope": "unit_qlnb", "code": "001.BVDK\u001fG1.GE.QD139.001" }],
  "reason": "ghi chú nội bộ"
}
```

Mã nhân viên cũ không được gửi trong payload; Data Hub tự xác định từ timeline nội bộ.

Data Hub cần trả HTTP 2xx + JSON khi tiếp nhận; lỗi phải trả `{ "error": "..." }`. App Report New không tự retry POST để tránh tạo lệnh trùng.

## Biến môi trường

```dotenv
DATA_HUB_BASE_URL=
DATA_HUB_ASSIGNMENT_KEY=
DATA_HUB_TIMEOUT_MS=6500
```

Chỉ coi là configured khi có cả URL và key.

## Fail-safe và cache

1. GET Data Hub có timeout (mặc định 6,5 giây).
2. Timeline và catalog phải đến từ cùng một combined snapshot/version/checksum mới tạo snapshot tốt.
3. Snapshot được ghi atomic `temp + rename` vào `server/data/catalog_management_lkg.json`, mode `0600`.
4. Snapshot lưu `source`, `version`, `checksum`, `updatedAt`, `lastSyncAt`.
5. Khi lỗi mạng: dùng last-known-good (`source=data-hub-lkg`, stale/read-only).
6. Nếu chưa có LKG: trả `503`, không lấy 1.808 assignment local cũ thay cho danh mục chuẩn. Không có nhánh nào ghi local hoặc thay đổi quyền production khi Data Hub lỗi.

File cache là runtime state, giữ tối đa 18 snapshot theo `YYYY-MM`, chỉ xuất hiện sau lần sync Data Hub thành công và không dùng nhầm cache của kỳ khác; không cần tạo sẵn để deploy Đợt 1.

## API App Report New

- `GET /api/catalog-management?period=YYYY-MM`
  - CEO/admin: timeline cặp đơn vị–QLNB, `catalog_total`, history và metadata. Full catalog chỉ giữ server-side trong combined snapshot/LKG để giảm payload trình duyệt.
  - NV: chỉ chính `req.session.emp_code`, chia `current`, `ending`, `starting`.
- `GET /api/admin/catalog-management/history?period=YYYY-MM`
- `GET /api/admin/catalog-management/diagnostics`
- `POST /api/admin/catalog-management/transfers`

Tất cả dùng session auth hiện hữu; ba API `/admin/*` bắt buộc `requireAdmin`.
Form admin luôn preview trước/sau và cảnh báo trước khi hiện đúng 3 lựa chọn `✅ Duyệt`, `❌ Không duyệt`, `📝 Ý kiến khác`; chỉ `✅ Duyệt` mới gọi POST Data Hub.

Giao diện CEO có bộ lọc bắt buộc `Tất cả | CL | NCL | NT`, hiển thị số cặp đơn vị–QLNB hiệu lực theo kỳ và phân trang 200 dòng.

## Privacy defense-in-depth

Response NV được dựng bằng whitelist, chỉ gồm `id`, `type`, `value`, `label`, `effective_from`, `effective_to`, `status`. Không serialize nguyên row Data Hub.

Trước khi trả response, `assertEmployeeSafe` duyệt đệ quy và chặn:

- old/new/from/to employee, counterpart;
- actor, batch/transfer_batch_id;
- note/internal/audit/history;
- cụm từ mô tả đối tác điều chuyển trong thông báo NV.

CEO/admin vẫn nhận các trường audit cần thiết trong rows/history.

## Quy tắc kỳ

- UI: `MM.YYYY` (ví dụ `08.2026`).
- API Data Hub và API trang mới: `YYYY-MM` (ví dụ `2026-08`).
- Conversion nằm ở cả UI boundary và backend validation; backend cũng chấp nhận `MM.YYYY` để tương thích nhưng luôn gọi Data Hub bằng `YYYY-MM`.

## Kiểm tra

```bash
cd server && npm run test:catalog-management
node --check src/catalogManagement.js
node --check src/routes.js
cd ../web && npm run build
```

Test bao phủ conversion kỳ, whitelist response NV, chặn field/cụm từ cấm và giữ audit cho CEO.
