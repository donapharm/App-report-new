# SPEC — Nguồn hóa đơn Debts cho CRM App Report (shadow trước cutover)

> Trạng thái: **đề xuất kiến trúc để review, chưa triển khai**. Không thay nguồn CRM production theo tài liệu này.
>
> Quyết định nghiệp vụ: nguồn WEB của bảng đối chiếu tiếp tục lấy từ App Sale. Chỉ nhánh CRM được nghiên cứu chuyển từ App Sale/MISA snapshot sang chi tiết hóa đơn thật tại Debts.

## 1. Mục tiêu và ranh giới

```text
App Sale WEB  ---------------------------> WEB revenue (giữ nguyên)

Debts invoice lines -> read-only S2S API -> DEBTS_INVOICE shadow
                                              |
CEO Vault snapshot -> unit/product mapping ---+
                                              v
                              App Report revenue materializer
                              (so sánh với CRM hiện tại trước cutover)
```

- Không thay nguồn WEB.
- Không đọc thẳng database/file/volume của Debts; dùng API S2S read-only có snapshot receipt.
- Không cutover trực tiếp. Nguồn mới chạy shadow ít nhất một kỳ đầy đủ, sau đó Claude review và CEO duyệt riêng.
- Dự án này độc lập với dự án snapshot C1-C52, dù sử dụng projection mapping đã được duyệt của dự án đó.

## 2. Hiện trạng đã quan sát ngày 17/08/2026

- Debts T07: 1.428 dòng / 374 hóa đơn.
- Debts T08: 947 dòng / 210 hóa đơn.
- 947/947 dòng T08 có mã QLNB, ĐVT, đơn giá, doanh số, VAT và tổng thanh toán.
- Dữ liệu hiện là Excel nhập vào Debts; chưa có S2S snapshot contract hoàn chỉnh.
- Dòng bán chưa lưu Mã ĐV chuẩn DataHub. Mã ĐV trên màn hình hiện là dữ liệu suy ra.
- Ghép thử bằng Mã KH/MST chỉ đạt: 803 dòng duy nhất; 52 dòng nhiều đơn vị nhưng cùng NV; 69 dòng mơ hồ khác NV; 23 dòng không ghép. Thêm ĐVT: 782 duy nhất; 47 cùng NV; 67 mơ hồ; 51 không ghép.
- CEO Vault V31.7/version 9 có 28.006 canonical keys, conflict nhân viên = 0 cho `Mã ĐV + QLNB`; thêm ĐVT cũng conflict = 0. Blocker nằm ở Debts thiếu Mã ĐV thật.
- Có dòng điều chỉnh âm T08, hóa đơn `00002319`: Doanh số = 0; VAT = -825.190; Tổng TT = -17.329.000. Không được bỏ hoặc ép về 0.
- Debts hiện làm tròn một số trường tiền khi lưu; cần contract precision trước khi gọi là số hóa đơn chính xác 100%.

Các số trên là evidence thiết kế, phải được đo lại read-only trên candidate trước implementation/cutover.

## 3. Ngữ nghĩa KPI và VAT — điều kiện bắt buộc

App Report hiện hiển thị KPI `revenue` theo **sau VAT**. Vì vậy mapping chuẩn là:

| App Report canonical field | Debts field | Ngữ nghĩa |
|---|---|---|
| `revenue_after_vat` / KPI `revenue` | `Tổng TT` | tiền thanh toán sau VAT |
| `revenue_before_vat` | `Doanh số` | doanh số trước VAT, khi hợp lệ |
| `vat_amount` | `Thuế GTGT` | VAT thực tế, cho phép âm |
| `unit_price_before_vat` | `Đơn giá` | đơn giá trước VAT |

Invariant trên từng dòng và tổng nhóm:

```text
revenue_before_vat + vat_amount = revenue_after_vat
```

- Không chia mặc định cho `1.05` khi nguồn có VAT thực tế.
- VAT có thể khác 5%, bằng 0 hoặc âm.
- Nếu `Doanh số` trống/không hợp lệ nhưng `Tổng TT` và VAT hợp lệ, adapter chỉ được tính `before = after - VAT` khi policy cho phép và phải gắn cờ `amount_reconstructed=true`; mặc định quarantine để đối chiếu.
- Dòng âm/return/adjustment được giữ dấu và loại nghiệp vụ; không loại bằng điều kiện `amount > 0`.
- Tổng phải đối chiếu trước VAT, VAT và sau VAT theo pháp nhân/ngày/hóa đơn/kỳ.

## 4. Contract API Debts read-only

Endpoint đề xuất:

```http
GET /api/integrations/app-report/sales-ledger?period=YYYY-MM&cursor=...&limit=...
Authorization: Bearer <purpose-bound service token>
```

Envelope tối thiểu:

```json
{
  "snapshot": {
    "snapshotId": "...",
    "period": "2026-08",
    "sourceRevision": "...",
    "schemaVersion": 1,
    "rowCount": 947,
    "invoiceCount": 210,
    "checksum": "sha256:...",
    "totals": {
      "beforeVat": "0.00",
      "vat": "0.00",
      "afterVat": "0.00"
    },
    "createdAt": "..."
  },
  "rows": [],
  "nextCursor": null
}
```

Mỗi row cần ít nhất:

- legal entity, invoice date/number, stable source line ID;
- customer code, tax code, unit code chuẩn nếu đã có;
- QLNB/product code, product name, UOM;
- sold quantity, unit price before VAT;
- before-VAT amount, actual VAT, after-VAT total;
- lot, expiry, order reference;
- row type/status cho sale/return/adjustment/cancel;
- source updated timestamp và row checksum.

Yêu cầu:

- pagination ổn định trong cùng snapshot; không trộn dữ liệu thay đổi giữa các page;
- tiền truyền decimal string theo precision gốc, không float và không làm tròn số nguyên;
- checksum canonical có định nghĩa ordering/normalization công khai;
- token chỉ đọc, giới hạn đúng endpoint/purpose, timeout/retry có idempotency;
- snapshot receipt đủ để App Report chứng minh số dòng, hóa đơn và ba tổng tiền.

## 5. Khóa dòng và chống trùng

Ưu tiên source-provided immutable `invoice_line_id`. Canonical identity phải chứa pháp nhân vì số hóa đơn có thể trùng giữa pháp nhân.

Nếu Debts chưa có line ID ổn định, blocker cần sửa tại nguồn; không dùng hash mơ hồ làm khóa lâu dài. Hash tạm cho shadow phải gồm tối thiểu:

```text
legal_entity + invoice_no + invoice_date + source_row_ordinal/source_line_id
```

Mã hàng, ĐVT, số lượng và tiền có thể thay đổi khi điều chỉnh nên chỉ thuộc row checksum/version, không nên tự động làm identity duy nhất. Re-import cùng snapshot phải idempotent; revision mới phải biểu diễn update/tombstone rõ, không nuốt các dòng hóa đơn giống nhau hợp lệ.

## 6. Gán đơn vị và nhân viên

Runtime mapping không được đoán bằng tên, MST hay chuẩn hóa chuỗi mơ hồ.

1. Debts phải lưu/tra được Mã ĐV chuẩn DataHub trên từng dòng hoặc qua crosswalk customer-to-unit có hiệu lực theo thời gian, version và audit.
2. App Report lấy canonical mapping từ projection cùng version CEO Vault:

```text
Mã ĐV + Mã QLNB -> Mã NV
ĐVT = validation bổ sung; mismatch phải quarantine/diagnostic
```

3. Mỗi dòng phải có kết quả `mapped`, `unmapped`, `ambiguous` hoặc `uom_mismatch`.
4. `ambiguous` không được tự chọn nhân viên dù các candidate có cùng tên/đơn vị gần giống.
5. Cutover chỉ khi 100% dòng được map xác định hoặc nằm trong danh sách quarantine được CEO duyệt rõ.

Crosswalk Mã KH/MST → Mã ĐV, nếu cần, phải là bảng tường minh có `legal_entity`, hiệu lực từ/đến, nguồn phê duyệt và conflict test.

## 7. Materializer shadow

Thêm source label `DEBTS_INVOICE_SHADOW`; không ghi đè slot CRM hiện tại.

1. Khóa materialize theo kỳ/source.
2. Đọc toàn bộ một Debts snapshot.
3. Xác minh manifest, pagination, checksum, row/invoice counts và totals.
4. Normalize amount/date/status mà không mất precision.
5. Join mapping từ đúng active CEO Vault snapshot/version đã ghim cho run.
6. Quarantine dòng thiếu/mơ hồ/mismatch; không bỏ lặng.
7. Materialize bảng shadow theo canonical grain.
8. Đối chiếu với Debts raw và CRM hiện tại; lưu receipt.
9. Kết thúc shadow không đổi source selector production.

Run phải ghi `debtsSnapshotId/checksum`, `catalogVersion/checksum`, code revision, counts theo trạng thái mapping và ba tổng tiền.

## 8. Đối chiếu và tiêu chí cutover

### Với Debts

- row count, distinct stable line IDs và invoice count khớp;
- tổng trước VAT, VAT, sau VAT khớp toàn kỳ và theo pháp nhân/ngày/hóa đơn;
- không duplicate/lost line; import lại idempotent;
- negative/return/adjustment khớp dấu và số tiền;
- decimal precision giữ nguyên.

### Với App Report

- WEB source/data/totals không thay đổi byte-for-byte về contract hoặc bằng golden fixtures;
- CRM shadow hiển thị KPI sau VAT từ `Tổng TT`;
- mọi màn dùng cùng canonical field, không màn tự chia `1.05` khi exact before-VAT có sẵn;
- phân quyền nhân viên dựa mapping canonical, không lộ dòng người khác;
- drilldown cộng ngược đúng totals.

### Gate

- chạy song song ít nhất một kỳ đầy đủ;
- mapping deterministic hoặc quarantine được CEO duyệt = 100%; ambiguous = 0 trong phần active;
- tất cả delta Debts raw ↔ shadow = 0 theo tolerance decimal đã định nghĩa;
- Claude GO trên exact candidate SHA;
- CEO duyệt cutover riêng sau khi xem báo cáo đối chiếu.

## 9. Cutover và rollback tương lai

Cutover tương lai chỉ đổi source selector CRM bằng feature flag/versioned config; không xóa CRM cũ. Rollback trả selector về nguồn CRM hiện tại, giữ nguyên WEB. Snapshot shadow và receipts là bất biến để audit.

Không cho phép fallback âm thầm giữa Debts và CRM cũ trong cùng một kỳ. Nguồn lỗi phải trả stale/error rõ, không tự trộn hai nguồn rồi báo tổng hợp.

## 10. Câu hỏi bắt buộc cho Claude review

1. Mapping KPI sau VAT và xử lý amount reconstruction/negative đã đủ chặt chưa?
2. Identity/revision/tombstone contract nào phù hợp nhất với cách Debts import Excel hiện tại?
3. Có nên buộc Debts lưu Mã ĐV trên từng line trước shadow, hay versioned customer-unit crosswalk đủ an toàn?
4. Grain đối chiếu nào còn thiếu để bắt split/merge invoice lines và duplicate hợp lệ?
5. Làm sao chứng minh WEB source không đổi trong cả code path, cache và UI aggregation?
6. Tolerance decimal, locking, snapshot isolation và rollback test nào cần bổ sung?

## 11. Điều kiện quản trị thay đổi

- Nhánh này chỉ chứa tài liệu thiết kế.
- Claude review độc lập trên exact commit SHA; findings được sửa và review lại.
- Implementation là phiếu/nhánh riêng sau khi Claude GO và CEO phê duyệt.
- Merge, deploy, tạo API Debts hoặc đổi source production đều cần cổng duyệt riêng.
