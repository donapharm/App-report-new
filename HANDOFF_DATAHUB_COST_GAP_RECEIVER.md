# Gửi DataHub — Cửa nhận "worklist mã thiếu %" từ App Report

> **Trạng thái 2026-07-26:** receiver DataHub đã deploy production tại commit
> `cd821a46689ce8f124600d5295584479b5444f19`. App Report phía gửi vẫn giữ dormant cho tới khi CEO duyệt triển khai riêng.
> Contract dưới đây là bản chốt — nếu cần đổi field/status, phải báo lại App Report trước khi khớp E2E.

## Bối cảnh (1 đoạn)
CEO đang phải *xuất Excel mã thiếu % → mở DataHub → nhập tay*. App Report thêm nút **"Đồng bộ sang DataHub"**: CEO bấm →
App Report **đẩy danh sách mã QLNB chưa có % chi phí** sang DataHub. Việc của DataHub: **nhận danh sách đó** và cho CEO
**điền % / ánh xạ mã** ngay trên danh sách nhận (thay bước nhập tay). **% vẫn do DataHub là nguồn chuẩn (SSOT)** — App
Report không giữ %, không tự ánh xạ.

## Việc cần build
1. **Endpoint nhận** worklist (spec §API).
2. **Màn/luồng cho CEO** điền % + xác nhận ánh xạ mã trên worklist đã nhận. Điền xong → cập nhật catalog như hiện tại;
   App Report tự thấy coverage lên, **không cần báo ngược**.

## API (App Report → DataHub)
```
POST {DATA_HUB_BASE_URL}/api/integrations/app-report/cost-gap-worklist
Headers:
  x-assignment-key: <DATA_HUB_ASSIGNMENT_KEY>     # đúng key S2S đang dùng cho /assignments/*
  x-app-report-actor: <mã CEO/tên người bấm>
  content-type: application/json
```
**Idempotent:** dedupe theo `worklist_checksum` — gửi lại cùng kỳ + cùng checksum thì **cập nhật, không nhân đôi**
(App Report **không** tự retry POST).

### Body nhận
```json
{
  "from": "2026-06",
  "to": "2026-07",
  "actor": "CEO",
  "worklist_checksum": "<sha256 của mảng items đã chuẩn hoá>",
  "coverage": { "matched_pairs": 171, "total_pairs": 184 },
  "items": [
    {
      "ma_qlnb": "QĐ123.ABC",
      "ten_hang": "Valgesic ...",
      "don_vi_anh_huong": ["Vũng Tàu", "Đồng Nai"],
      "so_don_vi": 2,
      "so_nv": 1,
      "doanh_thu_anh_huong": 12345678,
      "ly_do": "qd_mismatch",           // hoặc "missing"
      "ma_catalog_goi_y": "QĐ123.ABC.X" // gợi ý để đối chiếu, có thể null; DataHub quyết định ánh xạ cuối
    }
  ]
}
```
- `ly_do`: `qd_mismatch` = có mã catalog gần giống (lệch QĐ/QLNB) · `missing` = thiếu hẳn.
- `ma_catalog_goi_y`: **chỉ gợi ý**, App Report không tự ánh xạ — DataHub chốt.
- **Payload cố ý KHÔNG chứa** `%`/cost/margin/payout/`C32`–`C47`/PII. Chỉ có mã + thống kê ảnh hưởng + doanh thu. Đây là
  danh sách **thiếu %**, không phải số chi phí.

### Response bắt buộc (fail-closed)
- Lần nhận mới: **HTTP 201** + JSON `{ "ok": true, "worklist_id": "<id-không-rỗng>", "received": <đúng số item>, "deduped": false }`.
- Gửi trùng checksum/kỳ: **HTTP 200** + JSON `{ "ok": true, "worklist_id": "<id-không-rỗng>", "received": <đúng số item>, "deduped": true }`.
- `received` phải là số nguyên và bằng chính xác số item App Report đã gửi; `deduped` phải là boolean.
- Mọi response khác — gồm `{}`, mọi 2xx khác, thiếu/sai type field, `200 + deduped:false`, `201 + deduped:true` — đều bị App Report từ chối bằng `GAP_SYNC_BAD_RESPONSE`.
- Lỗi nghiệp vụ/auth: mã lỗi HTTP tương ứng + `{ "error": "<mô tả>" }`.

## Phạm vi cột % được phép GHI (CEO chốt 2026-07-25) — KHÓA TRƯỚC KHI MỞ LUỒNG CẬP NHẬT
Màn DataHub điền % chỉ được ghi vào **đúng allowlist `C33–C46` mà CEO đang bật** (chính danh sách cột động đang
dùng cho bên đọc "Chi phí của tôi" — `SPEC_REPORT_EMP_COST_SELFVIEW.md §"C33–C46 allowlist"`):
- **Ghi ĐỘNG theo allowlist, KHÔNG hardcode key/số cột.** CEO đổi allowlist bất cứ lúc nào → áp dụng ngay (đọc↔ghi
  dùng chung 1 allowlist, nhất quán).
- **`C32` (tổng) + `C47` (đầu ra): CẤM GHI/CẤM SUY RA tuyệt đối, vĩnh viễn** — hard-block ở DataHub, không được điền,
  không tự dựng lại "tổng"/"đầu ra".
- Giá trị là **tỷ lệ % theo từng dòng** (mã QLNB × đơn vị), không cộng dồn.
- **App Report không tham gia phạm vi này:** worklist chỉ nêu *mã nào cần chú ý* (write-agnostic), KHÔNG mang theo và
  KHÔNG chỉ định cột nào nhận %. Toàn bộ việc chọn cột nằm ở allowlist DataHub (SSOT).

## Bộ E2E khớp đã sẵn (App Report chuẩn bị trước)
App Report đã có script E2E tự chứa — kèm **1 mock receiver mẫu** đúng contract này (idempotent theo checksum, chặn
cột cấm, kiểm `x-assignment-key`). DataHub có thể soi mock trong `server/scripts/test_gap_sync_e2e.js` như bản tham
chiếu một receiver đạt chuẩn.
- **Chạy ngay (mock + route):** `cd server && npm run test:gap-sync` → **25/25**; gồm strict receipt contract, whitelist/actor/idempotency/canonical checksum, malformed 2xx, chặn cột cấm, gate confirm, giới hạn, auth và route thật.
- Route test khóa cứng: **CEO không-confirm** và **📝 Ý kiến khác** đều tạo **0 request** tới receiver; NV bị 403.
- Trong preflight production **không chạy `REAL_DATAHUB` với key/payload hợp lệ**. Chỉ kiểm boundary không-key/không-write. Worklist production đầu tiên chỉ được gửi khi CEO trực tiếp bấm **✅ Duyệt** trong App Report sau triển khai được duyệt.

## Nghiệm thu E2E (khi cả 2 đầu sẵn sàng)
1. CEO bấm **✅ Duyệt** trên App Report → DataHub nhận đúng số mã, trả `201 + deduped:false` cùng đủ receipt field.
2. Gửi lại cùng kỳ + checksum → DataHub **không** tạo bản trùng và trả `200 + deduped:true` cùng `worklist_id` cũ.
3. CEO điền % trên DataHub → catalog cập nhật → App Report coverage "Mặt hàng thiếu %" giảm tương ứng.
4. Sai key `x-assignment-key` → DataHub từ chối (401/403).

**Liên hệ chốt contract:** App Report (Report Bot / Claude Code). Tài liệu kiến trúc đầy đủ:
`DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md`.
