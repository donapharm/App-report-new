# Revenue — CRM MISA + APP WEB

Generated: 2026-07-03T02:30:35.530Z

MISA run: #28, finished_at=Fri Jul 03 2026 08:44:41 GMT+0700 (Indochina Time)

| Source | Rows | Orders | Revenue |
|---|---:|---:|---:|
| CRM_MISA | 229 | 68 | 2214559796 |
| APP_WEB_PARTNER | 67 | 32 | 550673600 |
| TOTAL | 296 | — | 2765233396 |

Rules:
- CRM MISA: latest successful `misa_revenue_snapshot_lines`, `revenue_bucket in (official,pending)`, period `revenue_date`, amount `invoice_export_amount`.
- APP WEB partner PA-A: latest `partner_order_line_responses` per order_item, period effective date, period order creation date, `delivered_qty * price`, non-test, exclude HOLD_GOLIVE.
- PA-A trace: excludes carried-over Partner order `DT-260630-0115` (`1.960.000đ`) so WEB = `550.673.600đ`, matching old app snapshot #27.
- Closed periods stay frozen; this script only creates/replaces active slot for the requested/current period.
