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

Các số trên là evidence thiết kế, phải được đo lại trên candidate trong transaction `REPEATABLE READ READ ONLY`, kèm thời điểm, snapshot/checksum và exact query/API receipt trước implementation/cutover.

## 3. Ngữ nghĩa KPI và VAT — điều kiện bắt buộc

App Report hiện hiển thị KPI `revenue` theo **sau VAT**. Vì vậy mapping chuẩn là:

| App Report canonical field | Debts field | Ngữ nghĩa |
|---|---|---|
| `revenue_after_vat` / KPI `revenue` | `Tổng TT` | tiền thanh toán sau VAT |
| `revenue_before_vat` | `Doanh số` | doanh số trước VAT, khi hợp lệ |
| `vat_amount` | `Thuế GTGT` | VAT thực tế, cho phép âm |
| `unit_price_before_vat` | `Đơn giá` | đơn giá trước VAT |

Adapter phải giữ song song raw và canonical:

| Nhóm | Field | Mục đích |
|---|---|---|
| Raw bất biến | `source_before_vat_raw`, `source_vat_raw`, `source_after_vat_raw` | receipt/đối chiếu đúng dữ liệu Debts nhận được |
| Canonical | `revenue_before_vat`, `vat_amount`, `revenue_after_vat` | phép tính App Report sau validation/reconstruction |

Invariant trên từng dòng và tổng nhóm:

```text
revenue_before_vat + vat_amount = revenue_after_vat
```

- Ba field `revenue_before_vat`, `vat_amount`, `revenue_after_vat` phải được **persist end-to-end** từ adapter, shadow store, canonical row, API, export tới UI/AI/deck; không được chỉ lưu `revenue_after_vat` rồi dựng lại các field còn lại.
- Không chia mặc định cho `1.05` khi nguồn có VAT thực tế.
- VAT có thể khác 5%, bằng 0 hoặc âm.
- Validation luôn kiểm `source_before_vat_raw + source_vat_raw = source_after_vat_raw`. Bất kỳ sai lệch nào, kể cả `Doanh số=0` nhưng VAT/Tổng TT khác 0, phải gắn `amount_inconsistent=true` và quarantine; không được coi 0 là hợp lệ chỉ vì field có mặt.
- Khi VAT và Tổng TT raw hợp lệ, shadow có thể tạo canonical `revenue_before_vat = source_after_vat_raw - source_vat_raw`, giữ nguyên canonical VAT/after, gắn `amount_reconstructed=true` và lưu delta/reason. Reconstruction chỉ phục vụ phân tích/receipt; dòng vẫn quarantine và không vào active cho tới khi policy/CEO duyệt hoặc Debts sửa nguồn.
- Invariant `revenue_before_vat + vat_amount = revenue_after_vat` áp dụng cho **canonical fields sau validation/reconstruction**. Receipt bảo toàn raw riêng, không ép raw before phải bằng canonical before.
- Dòng âm/return/adjustment được giữ dấu và loại nghiệp vụ; không loại bằng điều kiện `amount > 0`.
- Tổng phải đối chiếu trước VAT, VAT và sau VAT theo pháp nhân/ngày/hóa đơn/kỳ.

Ví dụ `00002319`: raw before `0`, raw VAT `-825.190`, raw after `-17.329.000` ⇒ `amount_inconsistent=true`, quarantine; canonical before tái dựng `-16.503.810`, canonical VAT/after giữ nguyên. Receipt hiển thị cả raw triple, canonical triple và delta `-16.503.810`, nên vừa không mất dòng/tiền raw vừa không phá invariant canonical.

### 3.1 Chuyển mọi consumer khỏi phép chia VAT cố định

Trước cutover phải kiểm kê và sửa tối thiểu các consumer hiện đang suy `before VAT = revenue / 1.05`:

- `server/src/analytics.js`: site chia trực tiếp tạo `revenueBeforeVat`, `pctTarget`, `empTarget.achieved` và mọi aggregate target;
- `server/src/routes.js`, `server/src/targetNotify.js`: consumer gián tiếp của số `analytics` cho route target/gap và thông báo NV;
- `server/src/revenueReportExport.js`, đặc biệt `server/src/filteredEmployeeReport.js` site kết hợp `/1.05` với `Math.round`;
- `web/src/pages/Overview.jsx`, `web/src/pages/DailySalesOrders.jsx`: nhãn/render phải nhận field theo source; không tự suy lại;
- mọi consumer mới tìm thấy bằng static scan/test mutation.

Các consumer target/bonus phải dùng cùng `revenue_before_vat` chính xác. Phép `/1.05` phải rẽ nhánh **theo source ở backend**: chỉ giữ cho nguồn lịch sử/WEB App Sale chưa có exact before-VAT, gắn provenance/`amount_reconstructed`; tuyệt đối không áp dụng cho dòng Debts có ba field exact. Việc thêm shadow không được tước fallback lịch sử của WEB và không thay byte/golden output WEB.

Đây là thay đổi luật kế toán/KPI: tỷ lệ đạt target và thông báo target có thể đổi khi VAT thực tế khác 5%. Cutover phải nâng revenue rule lock/fingerprint và được CEO duyệt riêng.

### 3.2 Dòng âm và filter dương

Trước cutover phải kiểm kê toàn bộ filter `> 0`, `amount > 0` hoặc tương đương. Tối thiểu gồm:

- `web/src/pages/Overview.jsx`, `web/src/charts.jsx`, `web/src/pages/Analysis.jsx`;
- `server/src/smart.js`, `server/src/routes.js` phần trend;
- `server/src/report/deckData.js`;
- export, AI/top-N, chart/deck và consumer mới tìm thấy bằng static scan.

Mặc định mọi tổng kế toán phải gồm sale/return/adjustment có dấu. Nếu một view cố ý chỉ hiển thị dương, nhãn và denominator phải nói rõ, đồng thời không được dùng tổng đó thay headline net. Acceptance bắt buộc chứng minh tổng net của từng view/consumer cộng ngược đúng canonical headline.

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
- tiền truyền decimal string theo precision gốc, không float và không làm tròn số nguyên. Adapter/store dùng decimal/fixed-point đã định nghĩa; cấm tái dùng đường `Math.round` hiện hữu;
- checksum canonical có định nghĩa ordering/normalization công khai;
- token chỉ đọc, giới hạn đúng endpoint/purpose, timeout/retry có idempotency;
- token lưu server-side secret store, có rotation/revoke/audit; endpoint/token không được xuất hiện trong frontend bundle; egress chỉ allowlist host Debts;
- snapshot receipt đủ để App Report chứng minh số dòng, hóa đơn và ba tổng tiền.

Tolerance mặc định cho đối chiếu tiền là `0` khi hai nguồn cùng decimal scale. Nếu nguồn bắt buộc khác scale, tolerance phải được chốt theo từng field/scale trước code, không dùng một epsilon float chung.

## 5. Khóa dòng và chống trùng

Debts phải cấp immutable `invoice_line_id`, gắn UUID/ID bền vững ngay lần import đầu và lưu lại qua mọi lần xuất/sắp xếp/re-import. Canonical identity phải chứa pháp nhân vì số hóa đơn có thể trùng giữa pháp nhân.

`source_row_ordinal` không ổn định khi Excel chèn/sắp xếp dòng nên **không được dùng làm identity**, kể cả lâu dài. Nếu Debts chưa cấp line ID ổn định, shadow chỉ được chứng minh idempotent cho snapshot byte-identical và **không đủ điều kiện cutover**.

Mã hàng, ĐVT, số lượng và tiền có thể thay đổi khi điều chỉnh nên chỉ thuộc row checksum/version, không làm identity duy nhất. Mỗi source revision phải biểu diễn rõ một trong các mô hình được khóa trước code:

- append/update/tombstone theo immutable line ID; hoặc
- full-period replacement, trong đó revision mới thay toàn bộ revision cũ bằng atomic pointer và nêu rõ tombstone cho line ID biến mất.

Hai dòng hóa đơn giống toàn bộ giá trị nghiệp vụ vẫn phải tồn tại nếu có hai immutable line IDs khác nhau.

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

Debts lưu Mã ĐV chuẩn trên từng line là điều kiện ưu tiên và là gate cutover. Crosswalk versioned chỉ là phương án shadow tạm. Quarantine/diagnostics có thông tin KH/MST và candidate NV chỉ CEO/admin được đọc; NV chỉ thấy dòng `mapped` xác định thuộc chính mình.

Phải xác nhận `legal_entity`/contractor của Debts ánh xạ đúng DONA/AFP; không tái dùng alias `companyGroupOf` của App Sale nếu chưa có contract và test tương đương.

## 7. Materializer shadow

Thêm source label `DEBTS_INVOICE_SHADOW`; đây là label add-only cho nhánh CRM, không bao giờ được chọn cho WEB/Partner và không ghi đè slot CRM hiện tại.

1. Dùng lock `debts_invoice_shadow_<period>.lock` và store `server/data/revenue-shadow/debts/<period>/<snapshotId>/` riêng; không dùng `revenue_materialize.lock` và không có quyền ghi slot/frozen period production.
2. Đọc toàn bộ một Debts snapshot.
3. Xác minh manifest, pagination, checksum, row/invoice counts và totals.
4. Normalize amount/date/status mà không mất precision.
5. Join mapping từ đúng active CEO Vault snapshot/version đã ghim cho run.
6. Quarantine dòng thiếu/mơ hồ/mismatch; không bỏ lặng.
7. Materialize bảng shadow theo canonical grain.
8. Đối chiếu với Debts raw và CRM hiện tại; lưu receipt.
9. Kết thúc shadow không đổi source selector production.

Run phải ghi `debtsSnapshotId/checksum`, `catalogVersion/checksum`, code revision, counts theo trạng thái mapping và ba tổng tiền.

Shadow provenance phải có Debts endpoint contract version/SHA, snapshot revision/checksum và revenue rule candidate version/hash. T06/T07 đã ghim phải byte-identical trước/sau mọi shadow run.

## 8. Đối chiếu và tiêu chí cutover

### Với Debts

- row count, distinct stable line IDs và invoice count khớp;
- tổng trước VAT, VAT, sau VAT khớp toàn kỳ và theo pháp nhân/ngày/hóa đơn/nhân viên đã map;
- line count khớp theo hóa đơn và `hóa đơn × QLNB`; tổng số lượng khớp để bắt split/merge bù trừ tiền;
- không duplicate/lost line; import lại idempotent;
- negative/return/adjustment khớp dấu và số tiền;
- decimal precision giữ nguyên; từng dòng và từng group đạt `before + VAT = after` theo tolerance đã khóa;
- bất biến cân quarantine: `count(mapped) + count(quarantined) = count(source)`.
- Receipt có hai hệ tổng không trộn: raw mapped + raw quarantined = raw source cho cả ba raw fields; canonical mapped + canonical quarantined = canonical total cho cả ba canonical fields. Chênh raw-before ↔ canonical-before do reconstruction được báo thành `reconstructionDelta`, không bị che hoặc dùng để tuyên bố raw delta = 0.

### Với App Report

- WEB source/data/totals không thay đổi byte-for-byte về contract hoặc bằng golden fixtures;
- CRM shadow hiển thị KPI sau VAT từ `Tổng TT`;
- mọi màn dùng cùng canonical field, không màn tự chia `1.05` khi exact before-VAT có sẵn;
- KPI target, target notification và bonus dùng cùng exact `revenue_before_vat` cho Debts;
- phân quyền nhân viên dựa mapping canonical, không lộ dòng người khác;
- drilldown, cơ cấu đơn vị, chart, AI top-N, trend, export và deck cộng ngược đúng net totals gồm dòng âm;
- WEB/Partner payload, cache và UI aggregation byte-identical/golden-equal trước và sau khi thêm shadow, dùng guards `revenuePayloadIdentity`/`revenueCrossPeriodWebGuard` hoặc tương đương.

### Gate

- chạy song song ít nhất một kỳ đầy đủ;
- mapping deterministic hoặc quarantine được CEO duyệt = 100%; ambiguous = 0 trong phần active;
- raw receipt copy phải có delta Debts raw ↔ shadow raw = 0 cho từng raw field; canonical totals phải tự cân invariant. `reconstructionDelta` là chênh được công khai giữa raw-before và canonical-before, không bị tính nhầm thành lỗi truyền dữ liệu; ambiguous = 0 trong phần active;
- static scan/mutation test chứng minh không consumer Debts dùng `/1.05`, `Math.round` hoặc bỏ dòng âm ngoài policy đã khai báo;
- golden source-branch test chứng minh cùng consumer: WEB/lịch sử vẫn dùng fallback có provenance và output không đổi; Debts dùng exact before/VAT/after, không `/1.05`/`Math.round`;
- golden `00002319` chứng minh raw triple được bảo toàn, dòng bị quarantine vì amount inconsistency, canonical reconstruction đúng, receipt có reconstruction delta và dòng luôn xuất hiện trong shadow reconciliation; chưa được đưa vào active views cho tới khi policy/CEO duyệt;
- Claude GO trên exact candidate SHA;
- CEO duyệt cutover riêng sau khi xem báo cáo đối chiếu.

## 9. Cutover và rollback tương lai

Cutover tương lai chỉ đổi source selector CRM bằng feature flag/versioned config; không xóa CRM cũ. Rollback trả selector về nguồn CRM hiện tại, giữ nguyên WEB. Snapshot shadow và receipts là bất biến để audit.

Trước cutover phải nâng version/hash/provenance trong `server/config/revenue_rule_lock.json` và cập nhật `revenueRuleLock.test.js`/fingerprint mirror theo quy trình luật doanh thu bất biến. T06/T07 frozen pins không được thay đổi. Đổi cách tính target từ `/1.05` sang before-VAT exact là thay đổi được nêu rõ trong preview CEO, không được giấu trong refactor.

Không cho phép fallback âm thầm giữa Debts và CRM cũ trong cùng một kỳ. Nguồn lỗi phải trả stale/error rõ, không tự trộn hai nguồn rồi báo tổng hợp.

Acceptance rollback/no-blend phải gây lỗi Debts giữa run và chứng minh: selector không lật, không có tổng trộn, WEB không đổi, CRM cũ vẫn nguyên và shadow failed có receipt.

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
