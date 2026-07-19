# App Sale New :3970 datasource cutover survey — read-only

- Date: 2026-07-02 GMT+7
- Scope: read-only survey. No App Sale writes, no Lumos cutover.
- SPEC_DATASOURCE_CUTOVER.md was not present in App-report after git pull; survey follows CEO item C prompts.
- API process: pm2 `appsale-test-api`, port 3970, source `workspace-main/projects/appsale-donapharm-claude/source/appsale-donapharm/apps/api`.
- Auth: catalog/order/report endpoints require Bearer session; no server-to-server/cursor endpoint found in source.

## Summary evidence
- products: 371; units: 195; contractors: 18; unit_offerings: 27,565; cst_quota: 17; orders: 787; order_items: 1,851; order_status_events: 2,169; order_execution_lines: 0.
- orders date range: 2026-06-15 → 2026-07-02; orders before 2026-07-01: 736; July+: 51.
- cst_quota import: 17 rows; has initial: 12; has remaining: 12; import timestamps 2026-06-30.
- product code compare vs App Report/Lumos-derived rows: App Sale 371 vs App Report/Lumos set 318; mismatches exist both ways.
- unit compare by 3-digit prefix: App Sale 195 vs App Report/Lumos set 108; mismatches exist both ways.
- bid/goi compare: App Sale has mixed codes (`QĐ139`, `139`, `03`, `QĐ799`, ...); App Report/Lumos has `QĐ139`, `QĐ141`, `QĐ1572`, `QĐ110`, `QĐ48`, `QĐ99`, `QĐ750`, `QĐ1801`, `QĐ3231`, `QĐ1074`.

## Samples

### product
```json
{
  "id": "169",
  "qlnb_code": "G1.GE.QĐ139.2779.N4.583",
  "name": "Rosuvastatin Cap DWP 20 mg",
  "active_ingredient": "Rosuvastatin",
  "strength": "20mg",
  "uom": "Viên",
  "price": "2550.00",
  "goi_thau": "03",
  "tt_code": "TT20",
  "tt_stt": "583",
  "updated_at": "2026-06-23T00:27:07.966Z"
}
```

### unit
```json
{
  "id": "143",
  "code": "075.PKĐK VẠN PHÚC AN",
  "name": "PKĐK VẠN PHÚC AN",
  "route": "NCL",
  "province": "ĐỒNG NAI",
  "facility_type": "PKDK",
  "updated_at": "2026-07-01T09:18:45.534Z"
}
```

### contractor
```json
{
  "id": "4",
  "code": "03.TUE.N",
  "name": "Công Ty Trách Nhiệm Hữu Hạn Dược Tuệ Nam",
  "legal_entity_id": "4",
  "is_partner": true,
  "updated_at": "2026-06-15T10:28:19.718Z"
}
```

### unit_offering / goi
```json
{
  "unit_id": "1",
  "product_id": "1",
  "contractor_id": "1",
  "route": "CL",
  "goi_code": "QĐ139"
}
```

### cst_quota
```json
{
  "id": "22",
  "ma_qlnb": "G1.GE.QĐ139.862.N2.1005",
  "ma_dv": "007.BVĐK KV Định Quán",
  "ky_thau": "2025-2026",
  "hd_tu_ngay": null,
  "hd_den_ngay": null,
  "cst_chinh": "30000.000",
  "da_giao": "0.000",
  "dang_cho_giao": "10000.000",
  "cst_ban_dau_import": "30000.000",
  "cst_con_lai_import": "14000.000",
  "cst_import_source": "excel_chi_ngoc",
  "cst_imported_at": "2026-06-30T04:11:48.480Z"
}
```

### order header
```json
{
  "id": "1109",
  "code": "DT-260702-0052",
  "unit_id": "97",
  "contractor_id": "4",
  "order_channel": "internal",
  "route": "NCL",
  "status": "PARTNER_RESPONDED_FULL",
  "approval_mode": "auto_pass",
  "total_amount": "1360000.00",
  "entity_group": "PARTNER",
  "source_system": "APP_SALE",
  "created_at": "2026-07-02T07:35:23.805Z",
  "updated_at": "2026-07-02T10:15:25.982Z"
}
```

### order line joined
```json
{
  "order_item_id": "2285",
  "order_id": "1109",
  "order_code": "DT-260702-0052",
  "order_status": "PARTNER_RESPONDED_FULL",
  "order_channel": "internal",
  "route": "NCL",
  "entity_group": "PARTNER",
  "approval_status": "pending",
  "qty": "400.00",
  "approved_qty": null,
  "delivered_qty": "0.00",
  "invoiced_qty": "0.00",
  "qlnb_code": "G1.GE.QĐ139.2941.N4.743",
  "product_name": "Dedarich 200",
  "unit_code": "034.PKĐK Y ĐỨC TRẢNG DÀI",
  "contractor_code": "03.TUE.N",
  "goi_code": "QĐ139",
  "price": "3400.00",
  "line_amount": "1360000.0000"
}
```

### status event
```json
{
  "id": "2594",
  "order_id": "1109",
  "from_status": "PARTNER_WAITING_RESPONSE",
  "to_status": "PARTNER_RESPONDED_FULL",
  "actor_id": null,
  "note": "Đối tác phản hồi qua magic token lần 1: 1/1 dòng đủ, 0 thiếu, 0 nợ...",
  "created_at": "2026-07-02T10:15:25.982Z"
}
```
