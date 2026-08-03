# SPEC — MỘT LUẬT DOANH THU DUY NHẤT

> CEO chốt: App Sale là nguồn sự thật; App Report chỉ mirror, không tự định nghĩa eligibility/công thức.

## 1. Luật duy nhất

```
Doanh thu App Report = ô “ĐÃ THỰC HIỆN” của App Sale
                     = CRM xuất HĐ + Đối tác đã xuất/giao
```

App Report mirror exact implementation đang chạy trong App Sale PROD:

| Nguồn | Trục ngày / điều kiện | Tiền |
|---|---|---|
| CRM | `misa_revenue_snapshot_lines.sale_order_date`, latest successful monthly run, `revenue_bucket <> 'excluded'` | `SUM(invoice_export_amount)` |
| Partner | `orders.created_at`, `APP_SALE`, `PARTNER`, non-test, non-`DRAFT`, gồm `HOLD_GOLIVE`, loại trạng thái hủy/cancel | delivered response quantity × giá C31; fallback C31 ĐV×QLNB rồi `order_items.price` |

Provenance khóa tại VIỆC 0D:
- App Sale OCI revision: `0e820022814ef8a7f24d47c082446f3e40b17ebe`.
- `/app/apps/api/src/index.ts` SHA-256: `3b065456ed1e25b553c0554b97900a0ea2d89a17e9b487bfc5663fad14c220e0`.
- Mirror: `APP_SALE_REVENUE_KPI_SQL_0E820022`.

Nếu App Sale đổi implementation thì App Report phải audit source live mới, cập nhật provenance/SQL hash, đối soát `0đ`, nâng khóa luật rồi mới deploy.

## 2. Điều cấm

1. Cấm thêm `manual_zalo`, token, invoice hoặc bất kỳ eligibility riêng nào App Sale KPI không có.
2. Cấm dùng ngày phản hồi/effective date thay cho `orders.created_at` khi App Sale live chưa đổi theo.
3. Cấm dùng `order_items.price` trực tiếp mà bỏ thứ tự giá C31 của App Sale.
4. Cấm ghi cứng kỳ; kỳ lấy từ `REVENUE_REFRESH_KY` → `MATERIALIZE_KY` → tháng lịch `Asia/Bangkok`.
5. Cấm deploy local-only: commit phải có trên `origin/main` trước cutover.

## 3. Bất biến runtime

- CRM KPI và projection phải bằng nhau.
- Partner KPI và projection phải bằng nhau; partition delta phải bằng 0.
- Tổng candidate phải bằng CRM + Partner.
- Read trong một transaction `REPEATABLE READ READ ONLY`; source-run drift thì fail-closed.
- T06/T07 giữ exact frozen pins và payload bytes.
- Transition VIỆC 0D là one-shot, claim mode `0600`, bind payload bytes/semantic hash/provenance/SQL/projection digests.

## 4. Khóa chống sửa lén

`server/test/revenueRuleLock.test.js` fingerprint:
- SQL mirror trong `server/src/appSaleRevenueMirror.js`;
- projection quyết định dòng/tiền trong `server/scripts/materialize_july_revenue.js`.

Đổi luật phải đồng thời:
1. audit App Sale source live;
2. nâng `server/config/revenue_rule_lock.json` version + hash + provenance;
3. ghi `CHANGELOG.md`;
4. test full + read-only reconciliation `0đ`;
5. push/merge `origin/main` trước deploy.

## 5. Khi hai app lệch

1. Đồng nhất kỳ/từ ngày/đến ngày/múi giờ/trục ngày trước.
2. Chụp hai màn cách nhau dưới 2 phút.
3. Đối chiếu riêng CRM và Partner.
4. Không vá số; còn lệch thì dừng deploy và chỉ rõ dòng/nhóm lệch.
