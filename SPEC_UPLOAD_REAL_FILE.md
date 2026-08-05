# SPEC — ĐỌC ĐƯỢC FILE EXCEL THẬT CỦA KẾ TOÁN (CEO chốt 05/08/2026 tối)

> CEO: *"TÔI TRẢ LỜI LÀ CÓ. Đối với cột mã nhân viên thì hệ thống phải TỰ MAPPING,
> hoặc tại App Sale đã có cột nhân viên đó."*
>
> Bot server triển khai. File mẫu thật CEO gửi: `01.DONA_T07.2026.xlsx` · sheet `7,2026`
> · 796 dòng · **0 ô gộp** · 791 dòng dữ liệu · tổng **10.564.572.484đ** (khớp đúng ô
> `SUBTOTAL` trong file).

## Hiện trạng: parser đọc được 0 dòng, và sửa dòng tiêu đề KHÔNG đủ

Chạy thật `upload.parseWorkbook` trên file này ⇒ 2 lỗi, **0 dòng**. Hai nguyên nhân
chồng nhau, phải sửa cả hai:

**① Dòng tiêu đề không ở dòng 1.** File thật: dòng 1 tên nhà thầu · dòng 2 địa chỉ ·
dòng 3 "Tháng 07.2026" · dòng 4 dòng `SUBTOTAL` · **dòng 5 tiêu đề** · dòng 6+ dữ liệu.

**② Bí danh cột không khớp — chỉ 1/16 cột nhận ra được.** Đối chiếu `HEADER_MAP` hiện
tại với 16 cột thật: **chỉ `Mã đơn vị` khớp**. 15 cột còn lại rơi hết.

## ‼ Lỗi kèm theo: `noAccent` xử lý chữ Đ không nhất quán

```js
const noAccent = (s) => String(s||'')...replace(/đ/g,'d').toLowerCase().trim();
```
Thay `đ` **trước** `toLowerCase` ⇒ `đvt` → `dvt`, nhưng `ĐVT` → **`đvt`**. Cùng một tên
cột, hoa/thường ra hai kết quả khác nhau. Sửa: `toLowerCase()` **trước**, rồi mới thay `đ`.
Không sửa thì mọi bí danh có chữ Đ đều hên xui theo cách kế toán gõ hoa hay thường.

## Việc 1 — tự dò dòng tiêu đề

Quét **20 dòng đầu**, chấm điểm mỗi dòng bằng số cột khớp `HEADER_MAP`; lấy dòng điểm
cao nhất, **bắt buộc khớp tối thiểu 4 cột** trong đó có `unit_code` và `revenue`. Dữ
liệu bắt đầu từ dòng kế tiếp.

Không dòng nào đạt ⇒ **giữ nguyên hành vi hiện tại**: báo lỗi + trả về `headerDetected`,
đọc 0 dòng. **Không được đoán bừa** — thà từ chối còn hơn nhập sai.

## Việc 2 — bổ sung bí danh cho 16 cột thật

| Cột trong file | Trường |
|---|---|
| Mã đơn vị | `unit_code` *(đã khớp)* |
| Mã quản lý nội bộ | `iit_code` |
| Tên hàng hóa | `product_name` |
| Tên khách hàng | `unit_name` |
| Tổng số lượng bán | `quantity` |
| **Tổng thanh toán** | **`revenue`** |
| Đơn giá | `unit_price` |
| Phân tuyến | `route` |
| Tên nhà thầu | `contractor_code` |
| Ngày hóa đơn | `date` |
| Số hóa đơn | `invoice_no` |
| ĐVT | `uom` |
| Số TT · Ghi chú | bỏ qua |

**‼ `% CP` và `Tổng thành tiền CP`: CẤM đọc vào `revenue`, CẤM dùng làm chi phí.**
Chi phí là số của DataHub (SSOT) — `CLAUDE.md` đã chốt: App Report **không** dựng engine
chi phí riêng. Hai cột này chỉ được bỏ qua, hoặc đọc vào trường tên khác **không** nối
vào bất kỳ phép tính chi phí nào. Đọc nhầm là app có hai nguồn chi phí đá nhau.

## Việc 3 — TỰ MAPPING NHÂN VIÊN (lệnh CEO)

File thật **không có cột nhân viên**. Suy ra người phụ trách từ **cặp
(`unit_code` × `iit_code`)** — đúng khoá của bảng `unit_product_employees`.

**Dùng LẠI đúng logic `nv_catalog` trong `appSaleRevenueMirror.CRM_ROWS_SQL`, không
viết bản thứ hai.** Thứ tự ưu tiên giữ **y hệt** bên đó:

1. Cặp có **đúng 1 NV** trong bảng phân công ⇒ lấy NV đó.
2. Không thì mới lấy cột nhân viên trong file (nếu file App Sale có cột đó).
3. Vẫn không ra ⇒ **`emp_code = 'UNALLOCATED'`**, kèm mã lý do lấy từ
   `syncExceptionCatalog` sẵn có: cặp thiếu trong danh mục ⇒ `DON_VI_THIEU_DANH_MUC`;
   cặp gán >1 NV hoặc mã NV ngoài roster ⇒ `NV_XUNG_DOT_ROSTER`.

‼ **Dòng không tra ra người thì KHÔNG được bỏ đi, cũng không được gán bừa.** Nó phải
vào bảng với `UNALLOCATED` + lý do, để nổi lên đúng ô KPI **"Doanh thu chưa phân bổ"**
vừa làm. Đây là vòng khép kín: ô KPI đó chính là cái chuông báo file upload thiếu phân
công — giống hệt cách nó đang bắt `DH479816174`.

Giữ nguyên chặn `VP018` (`employeeRevenuePolicy`): tra ra VP018 vẫn phải cách ly.

## Việc 4 — dòng nào là dữ liệu, dòng nào không

Dòng **thiếu `iit_code`** (mã quản lý nội bộ) ⇒ không phải dòng dữ liệu (dòng tiêu đề
phụ, `SUBTOTAL`, "Tổng cộng" cuối bảng). Bỏ qua **nhưng phải ĐẾM và báo số lượng** —
không im lặng. Với file mẫu: 796 dòng sheet ⇒ **791 dòng dữ liệu**, 5 dòng bỏ.

## Việc 5 — đối soát tổng, và bỏ trần cảnh báo

- File có dòng `SUBTOTAL` ⇒ so `Σ revenue` đọc được với số đó. **Lệch ⇒ chặn**, không
  cho lưu, in rõ lệch bao nhiêu. Với file mẫu phải ra **lệch 0đ** (Claude đã cộng tay
  đối chiếu: 10.564.572.484đ = đúng số trong file).
- `warnings.slice(0, 50)` đang **cắt mất cảnh báo** khi file lỗi nhiều ⇒ người duyệt
  upload không thấy hết. Đổi thành: **gộp theo mã lý do + số dòng của từng loại**, kèm
  vài dòng ví dụ. Tổng số cảnh báo phải luôn hiện đúng.

## Test bắt buộc

1. Dò tiêu đề: file có tiêu đề ở dòng 5 ⇒ tìm đúng dòng 5; file tiêu đề dòng 1 ⇒ vẫn
   chạy như cũ; file rác ⇒ báo lỗi, **0 dòng**, có `headerDetected`.
2. `noAccent('ĐVT') === noAccent('đvt')` — hiện đang **sai**, phải bằng nhau.
3. 16 cột thật: khớp đúng bảng ở Việc 2; `% CP` và `Tổng thành tiền CP` **không** rơi
   vào `revenue`.
4. Tự mapping: cặp 1 NV ⇒ ra NV đó; cặp thiếu ⇒ `UNALLOCATED` + `DON_VI_THIEU_DANH_MUC`;
   cặp 2 NV ⇒ `UNALLOCATED` + `NV_XUNG_DOT_ROSTER`; tra ra VP018 ⇒ vẫn cách ly.
5. Dòng không dữ liệu: 796 dòng ⇒ 791 dòng dữ liệu, 5 dòng bỏ, **có báo số**.
6. Đối soát: `Σ revenue` khớp `SUBTOTAL` ⇒ cho qua; sửa 1 ô lệch 1đ ⇒ **chặn**.
7. Cảnh báo: file 200 dòng lỗi ⇒ **không mất cảnh báo nào**, gộp theo loại, tổng đúng.

## Nghiệm thu

Chạy chính file `01.DONA_T07.2026.xlsx` qua parser, dán: số dòng đọc được (**phải 791**)
· tổng doanh thu (**phải 10.564.572.484đ**) · số dòng `UNALLOCATED` kèm lý do · số dòng
bỏ. Lệch bất kỳ số nào ⇒ dừng, báo, không lưu slot.
