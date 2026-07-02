# July 2026 revenue — CRM MISA + APP WEB

Generated: 2026-07-02T16:36:47.003Z

MISA run: #26, finished_at=Thu Jul 02 2026 20:29:48 GMT+0700 (Indochina Time)

| Source | Rows | Orders | Revenue |
|---|---:|---:|---:|
| CRM_MISA | 226 | 66 | 2118313496 |
| APP_WEB_PARTNER | 68 | 33 | 552633600 |
| TOTAL | 294 | — | 2670947096 |

Rules:
- CRM MISA: latest successful `misa_revenue_snapshot_lines`, `revenue_bucket in (official,pending)`, July `revenue_date`, amount `invoice_export_amount`.
- APP WEB partner: latest `partner_order_line_responses` per order_item, July effective date, `delivered_qty * price`, non-test, exclude HOLD_GOLIVE.
- 01–06 frozen; this script only creates/replaces active slot for `07.2026`.
