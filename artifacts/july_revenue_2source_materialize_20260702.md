# July 2026 revenue — CRM MISA + APP WEB

Generated: 2026-07-02T17:22:35.653Z

MISA run: #27, finished_at=Thu Jul 02 2026 23:42:23 GMT+0700 (Indochina Time)

| Source | Rows | Orders | Revenue |
|---|---:|---:|---:|
| CRM_MISA | 226 | 66 | 2118313496 |
| APP_WEB_PARTNER | 67 | 32 | 550673600 |
| TOTAL | 293 | — | 2668987096 |

Rules:
- CRM MISA: latest successful `misa_revenue_snapshot_lines`, `revenue_bucket in (official,pending)`, July `revenue_date`, amount `invoice_export_amount`.
- APP WEB partner PA-A: latest `partner_order_line_responses` per order_item, July effective date, July order creation date, `delivered_qty * price`, non-test, exclude HOLD_GOLIVE.
- PA-A trace: excludes carried-over Partner order `DT-260630-0115` (`1.960.000đ`) so WEB = `550.673.600đ`, matching old app snapshot #27.
- 01–06 frozen; this script only creates/replaces active slot for `07.2026`.
