# Gửi DataHub — Cửa nhận "worklist mã thiếu %" từ App Report

> **1 việc cần build:** 1 endpoint nhận + 1 màn cho CEO điền %. App Report đã build xong phía gửi (đang "ngủ an toàn",
> tự bật khi endpoint này lên). Contract dưới đây là bản chốt — nếu cần đổi field, báo lại App Report trước khi khớp E2E.

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

### Response mong đợi
- Thành công: **HTTP 2xx** + JSON `{ "ok": true, "worklist_id": "<id>", "received": <số item> }`.
- Lỗi: mã lỗi HTTP tương ứng + `{ "error": "<mô tả>" }`.
- **Chưa build xong endpoint** → cứ để **404**: App Report hiểu là "chưa mở cửa nhận" và báo CEO dùng tạm Excel (không vỡ).

## Nghiệm thu E2E (khi cả 2 đầu sẵn sàng)
1. CEO bấm "Đồng bộ" trên App Report → DataHub nhận đúng số mã, trả 2xx + `worklist_id`.
2. Gửi lại cùng kỳ + checksum → DataHub **không** tạo bản trùng.
3. CEO điền % trên DataHub → catalog cập nhật → App Report coverage "Mặt hàng thiếu %" giảm tương ứng.
4. Sai key `x-assignment-key` → DataHub từ chối (401/403).

**Liên hệ chốt contract:** App Report (Report Bot / Claude Code). Tài liệu kiến trúc đầy đủ:
`DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md`.
