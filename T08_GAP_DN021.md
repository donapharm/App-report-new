# T08 — truy 4 dòng DN021 và gap 1.795.600đ

Thời điểm kiểm: 15/08/2026 GMT+7. Phạm vi chỉ đọc; không sửa App Report, DataHub hay dữ liệu nguồn.

## Kết luận ngắn

Hai hiện tượng **không cùng một dòng và không cùng nguyên nhân**:

1. DN021 có 4 dòng doanh thu, tổng `39.528.000đ`, đều không khớp tỷ lệ vì mã QLNB của doanh thu là `G1.GE.QĐ139.2963.N4.549`, còn DataHub phát tỷ lệ DN021 theo mã `G1.GE.QĐ48.549.N4.549`. Tên hàng cùng là Valesto nhưng App Report cố ý không fuzzy-join theo tên.
2. Gap `1.795.600đ` là đúng một dòng khác, `MISA:341964`, đang bị quarantine thành `UNALLOCATED` vì mã nhân viên gốc `VP018` thuộc vai trò không bán hàng. Dòng này giải thích chính xác chênh 1.163 dòng nguồn so với 1.162 dòng trên bảng.

Vì vậy không được kết luận “4 dòng DN021 cộng thành 1.795.600đ”.

## 1. Bốn dòng DN021

| Source line | Đơn | Ngày | Đơn vị | Mã hàng doanh thu | SL | Doanh thu |
|---|---|---|---|---|---:|---:|
| `MISA:354021` | `DH479816260` | 05/08/2026 | `189.BVĐK CÁI NƯỚC` | `G1.GE.QĐ139.2963.N4.549` | 12.000 | 21.600.000đ |
| `MISA:423878` | `DH479816348` | 10/08/2026 | `199.PKĐK HỒNG ĐỨC CÀ MAU` | `G1.GE.QĐ139.2963.N4.549` | 4.980 | 8.964.000đ |
| `MISA:423877` | `DH479816349` | 10/08/2026 | `193.BVĐK TRẦN VĂN THỜI` | `G1.GE.QĐ139.2963.N4.549` | 4.980 | 8.964.000đ |
| `MISA:436144` | `DH479816420` | 15/08/2026 | `197.BV QUÂN DÂN Y BẠC LIÊU` | `G1.GE.QĐ139.2963.N4.549` | 0 | 0đ |
| **Tổng** |  |  |  |  |  | **39.528.000đ** |

Nguồn doanh thu ghi `mapping_status=mapped`, sản phẩm Valesto. DataHub trả HTTP 200, `sourceVersion=V31.5`, 15 dòng tỷ lệ DN021 với đủ các cột phần trăm; nhưng tại các đơn vị trên, mã sản phẩm phía tỷ lệ là `G1.GE.QĐ48.549.N4.549`. Catalog LKG cũng lưu assignment DN021 theo mã cũ này.

App Report join bằng khóa exact `(unitCode, productCode)`. Khác mã sản phẩm nên cả 4 khóa doanh thu không có tỷ lệ tương ứng: `matchedRows=0/4`. Đây không phải sai kỳ giao, thiếu cột tỷ lệ hay lỗi mạng.

### Ai sửa được

- **Chủ nguồn DataHub/catalog assignment:** cập nhật assignment/tỷ lệ DN021 sang mã QLNB canonical đang dùng trong doanh thu, hoặc phát crosswalk chính thức giữa hai mã. Đây là nơi sửa gốc.
- **Chủ nguồn App Sale/doanh thu:** chỉ cần sửa nếu xác nhận `G1.GE.QĐ139.2963.N4.549` trong doanh thu là mapping sai. Theo dữ liệu hiện tại nó là mã canonical đang xuất hiện rộng trong catalog, nên chưa có bằng chứng để App Report tự đổi.
- **App Report:** không được tự ghép vì cùng tên “Valesto”; fuzzy join có thể gắn nhầm tỷ lệ tài chính. Sau khi nguồn/crosswalk chính thức sửa, App Report chỉ đọc lại và pin generation mới theo Gate 2.

## 2. Dòng tạo gap 1.795.600đ

| Source line | Đơn | Ngày | Đơn vị | Mã hàng | SL | Doanh thu | Trạng thái |
|---|---|---|---|---|---:|---:|---|
| `MISA:341964` | `DH479816174` | 03/08/2026 | `120.HTNT-PHARMACITY` | `G1.GE.QĐ139.1104.N2.162` | 40 | 1.795.600đ | `UNALLOCATED` |

Chi tiết nguồn: `raw_emp_code=VP018`, `attribution_status=NON_SALES_ROLE_QUARANTINED`, `mapping_status=mapped`. App Report không gán doanh thu bán hàng cho vai trò không bán hàng nên quarantine dòng này. Tổng nguồn `16.362.122.775đ`; tổng hiện trên bảng `16.360.327.175đ`; hiệu đúng `1.795.600đ`.

### Ai sửa được

- **Chủ nguồn phân công doanh thu/App Sale hoặc người quản trị mapping:** xác định nhân viên bán hàng hợp lệ cho đơn `DH479816174` và sửa attribution tại nguồn.
- **App Report:** classifier quarantine đang làm đúng. Tuy nhiên đường bảng ALL hiện bỏ pseudo-employee `UNALLOCATED` nên số dòng giảm 1; App Report cần một Gate 1 riêng nếu muốn hiển thị dòng chưa phân bổ ngay trên bảng thay vì chỉ cảnh báo ở `revenueRecon`. Không được tự đoán người nhận doanh thu.

## 3. Vì sao 1.162 khác 1.163

- Kho doanh thu có 1.163 transaction rows.
- Model ALL chỉ có 1.162 rows vì `MISA:341964` không thuộc roster sales hợp lệ và không được merge vào sổ của NV nào.
- Bất biến tiền vẫn phát hiện đúng: `revenueRecon.gap=1.795.600`, `balanced=false`.
- Đây là một dòng “chưa phân bổ”, không phải một trong 4 dòng DN021 thiếu tỷ lệ.

## Điều kiện đóng hồ sơ

1. DataHub/catalog phát tỷ lệ DN021 theo mã canonical/crosswalk chính thức; 4/4 khóa exact khớp.
2. Dòng `MISA:341964` được gán cho sales employee hợp lệ tại nguồn, hoặc App Report có thay đổi đã duyệt để hiển thị `UNALLOCATED` mà vẫn giữ rõ trạng thái.
3. Chạy một Gate 2 pin T08 mới, cùng một source generation, rồi chứng minh `balanced=true` trước khi bàn bật serve.
