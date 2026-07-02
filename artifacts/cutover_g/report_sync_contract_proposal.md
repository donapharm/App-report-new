# Proposed App Sale → App Report report-sync contract

Read-only endpoint to be added in App Sale New before production adapter.

`GET /api/report-sync/changes?updated_since=<ISO|cursor>&limit=500&cursor=<opaque>&route=CL&from=2026-07-01T00:00:00+07:00`

Headers:
- `Authorization: Bearer <REPORT_SYNC_SERVICE_TOKEN>`
- Token is server-to-server, read-only, scoped to report sync.

Response:
```json
{
  "items": [
    {
      "event_id": "order_item:2285:updated:2026-07-02T10:15:25.982Z",
      "order_id": "1109",
      "order_code": "DT-260702-0052",
      "order_item_id": "2285",
      "updated_at": "2026-07-02T10:15:25.982Z",
      "created_at": "2026-07-02T07:35:23.805Z",
      "route": "CL",
      "status": "APPROVED",
      "approval_status": "approved",
      "net_qty": 400,
      "qty_ordered": 400,
      "approved_qty": 400,
      "delivered_qty": 0,
      "invoiced_qty": 0,
      "unit": { "id": "1", "code": "001.BVĐK Đồng Nai", "name": "BVĐK Đồng Nai" },
      "product": { "id": "35", "qlnb_code": "G1.GE.QĐ139.1.N1.777", "name": "Bluecose", "uom": "Viên" },
      "bid": { "source_goi_code": "QĐ139", "inferred_qd": "QĐ139" },
      "contractor": { "id": "6", "code": "01.DONA", "name": "Công Ty TNHH Dược Phẩm Donapharm" },
      "employee": { "id": "5", "code": "DN001", "name": "Đặng Xuân Trung" },
      "price": 4690,
      "amount": 1876000,
      "is_cancelled": false,
      "is_rejected": false
    }
  ],
  "next_cursor": "opaque-string",
  "has_more": false,
  "watermark": "2026-07-02T10:15:25.982Z"
}
```

Requirements:
- Stable unique `event_id` and stable `order_item_id`; idempotent replays.
- Sort by `updated_at, order_item_id`; support cursor pagination.
- Include all changes to status/qty/product/unit/employee relevant to net revenue/CST.
- Return both status fields and normalized `net_qty` so App Report can compare policy but not guess.
- Never expose cost/margin fields.
