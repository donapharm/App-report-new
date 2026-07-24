# Thưởng v2 #166 — xác minh nguồn nhóm ưu tiên C10

- Thời điểm: 24/07/2026 08:19 GMT+7
- Phạm vi: đọc-only DataHub catalog-management production, LKG App Report và schema/dữ liệu phân loại sản phẩm App Sale production.
- Không đọc/in token, không ghi DB, không sửa DataHub/App Sale.

## Kết luận

**BLOCKED DEPENDENCY:** DataHub production chưa expose `C10/c10` trong catalog snapshot App Report. Vì §2 directive chốt C10 CEO vault/DataHub là SSOT, App Report không được dùng App Sale làm fallback và không được tự phân loại.

Pha engine vẫn có thể xây/test với contract `c10` strict và phải fail-closed: snapshot không có C10 hoặc mã có C10 rỗng/ngoài allowlist thì phần thưởng nhóm của mã đó bằng 0, kèm coverage/note; tuyệt đối không bịa nhóm.

## Bằng chứng DataHub/App Report

### DataHub production contract

- Endpoint đọc-only: `/api/integrations/app-report/assignments/catalog-management?ky=2026-07`.
- HTTP 200, version `3.9`.
- `catalog`: **27.719 dòng**; `assignments`: **27.719 dòng**.
- Keys catalog đang expose: `c3,c4,c5,c6,c7,c15,c16,c17,c25,c31`.
- `c10/C10`: **0 dòng / không có key**.
- `c32/c47`: không có.

### App Report LKG

- File: `server/data/catalog_management_lkg.json`.
- Version `3.9`, checksum `b9e52828726636f69ac1bb6f10bf70735de036c58dbd46653c7b9fb9b09938af`.
- Không có key `c10` hoặc `C10`; projection hiện tại cũng chưa whitelist/project C10.

## Bằng chứng App Sale production

- API image revision: `8b42c07ebedc46aec6e6340b6d3d39a3c8279060`.
- Bảng `products` có `qlnb_code`, `tech_rank`, `tech_group`.
- **371/371 sản phẩm** có `tech_rank`; **371 QLNB duy nhất**, không thiếu QLNB, không có QLNB mang nhiều rank xung đột.
- Phân bố `tech_rank`:
  - `H.A*`: **136**
  - `H.A`: **102**
  - `H.B`: **62**
  - `H.C`: **46**
  - `H.D`: **17**
  - Ngoài directive: `H.E`: **4**, `H.F`: **4**
- `tech_group`: N1–N5; đây là trường khác nhóm thưởng ưu tiên.

App Sale chứng minh dữ liệu phân loại đang tồn tại, nhưng directive #167 đã chốt nguồn chính thức là **C10 CEO vault/DataHub**. Do đó `products.tech_rank` chỉ là bằng chứng đối chiếu, **không phải nguồn runtime cho App Report**.

## Việc DataHub cần làm

Task được directive tham chiếu: `TASK_DATAHUB_EXPOSE_C10_PRIORITY.md` (chưa thấy file task trong các workspace hiện có).

Contract đề nghị:

1. Whitelist `c10` vào catalog snapshot `/assignments/catalog-management`, tương tự cột tùy chọn đã duyệt nhưng vẫn khóa `c32/c47`.
2. Chuẩn hóa giá trị allowlist: `H.A*`, `H.A`, `H.B`, `H.C`, `H.D`; giá trị rỗng được phép và nghĩa là không cộng phần 2.
3. Giá trị khác allowlist (hiện App Sale còn `H.E/H.F`) phải được App Report coi là **unclassified/fail-closed**, không tự map.
4. Giữ `c5` là khóa QLNB; kiểm một QLNB không có nhiều C10 xung đột trong cùng snapshot/version.
5. Bổ sung version/checksum sau khi expose để App Report audit đúng kỳ.

## Quyết định triển khai App Report

- Pha 1 engine: tiếp tục trên nhánh review với input C10 strict, fixture/test đủ các nhóm và fail-closed khi thiếu nguồn.
- Pha 2 menu/config: có thể xây config bậc/rate/giai đoạn/đè-tầng/preview; không cho menu sửa mapping C10.
- Chưa deploy Thưởng v2 cho đến khi DataHub expose C10 và parity/acceptance nguồn hoàn tất.
