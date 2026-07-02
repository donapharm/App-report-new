# Điều tra doanh thu 07.2026 — 2 nguồn CRM MISA + APP WEB

Generated: 2026-07-02.

## Kết luận công thức từ App Sale API cũ
Đọc code báo cáo điều hành / export-summary trong App Sale API:

- **CRM MISA đã xuất hóa đơn**: bảng `misa_revenue_snapshot_lines`, snapshot run thành công mới nhất từ `misa_revenue_sync_runs`.
  - Lọc `revenue_bucket in ('official','pending')`.
  - Ngày doanh thu: `revenue_date` / invoice date.
  - Số tiền doanh thu thực: `invoice_export_amount` (fallback `official_amount` nếu cần).
  - Loại `is_test_suspected` và `excluded`.
- **APP WEB đối tác đã giao thực**: `partner_order_line_responses`, lấy response mới nhất theo `order_item_id`.
  - Số tiền: `delivered_qty * order_items.price`.
  - Ngày: `effective_date/responded_at/invoice_date` theo logic báo cáo cũ.
  - Loại `HOLD_GOLIVE`, test, chưa giao.
- **Không cộng WEB ordered** vào doanh thu thực vì đó là giá trị đặt nội bộ, chưa phải doanh thu kế toán.
- Công thức CEO KPI: `MISA đã xuất HĐ + Đối tác giao thực`.

## Đối chiếu DB tại thời điểm chạy
Latest MISA run: `#26`, finished `2026-07-02T13:29:48.033Z` = 20:29 VN.

| Nguồn | Rows materialized | Orders | Revenue |
|---|---:|---:|---:|
| CRM_MISA | 226 | 66 | 2.118.313.496 |
| APP_WEB_PARTNER | 68 | 33 | 552.633.600 |
| **TOTAL** | 294 | — | **2.670.947.096** |

So với ảnh CEO 20:29:
- MISA `2.118.313.496` **khớp đúng**.
- Partner ảnh `550.673.600`, DB hiện tại `552.633.600`, lệch +`1.960.000` do dữ liệu response sau snapshot ảnh đã tăng. Không ép số về ảnh.

## Materialize App Report
Script: `server/scripts/materialize_july_revenue.js`.

Output runtime:
- Slot active `07.2026`: `server/data/uploads/july_2src_072026_20260702163646.json`.
- `upload_slots.json` thêm kỳ `07.2026`, source `CRM_MISA_PLUS_APP_WEB`.

## Nghiệm thu
- 01–06 không đổi; T06 vẫn `28.403.136.096`.
- `store.listPeriods()` có `07.2026`.
- `store.latestKy()` = `07.2026`.
- T07 tổng = `2.670.947.096`.
- Không có mã NV rác ngoài `DN###/VP###/UNALLOCATED`.
