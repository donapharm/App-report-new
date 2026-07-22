# DIRECTIVE — "Chi phí của tôi": 2 MẪU cột (Full-time / CTV) + cột mới + VAT + ghi chú C48

> Claude Code giao Report Bot (+1 việc DataHub). **CEO chốt 2026-07-22.** Đợt cột mới: 2 layout theo nhóm, thêm
> cột, đổi gốc tính sang **trước VAT**, ghi chú từ **DataHub C48**. Mẫu gốc CEO:
> `docs/report-samples/CHIPHI_TEMPLATE_FULLTIME.xlsx` + `CHIPHI_TEMPLATE_PARTTIME.xlsx`.

## 1. HAI MẪU theo nhóm "tính tiền chi phí"
- **Mẫu FULL-TIME (NV công ty):** đủ **5 cột %** `C36 · C41 · C43 · C44 · C45`.
- **Mẫu PART-TIME (CTV):** **CHỈ 1 cột %** `C36` (bỏ C41/C43/C44/C45).
- **‼ Nhóm CTV cho TÍNH TIỀN = `DN021 / DN022 / DN023`** (CEO định vị lại theo **ngữ cảnh tính tiền**, LUỒNG KHÁC).
  - **KHÁC** nhóm của công tắc hiển thị (`employee_cost_groups.json`: CTV=DN002/DN004/DN022, đặc biệt=DN021/DN023/VP004).
  - ⇒ Tạo **config RIÊNG cho mẫu chi phí** (vd `employee_cost_templates.json`): `parttime = [DN021,DN022,DN023]`, còn lại
    full-time. **Không trộn** với config nhóm hiển thị. Cấu hình được (CEO đổi không sửa code).

## 2. THỨ TỰ CỘT (đúng file CEO)
**FULL-TIME (19 cột):**
`Ngày · Mã đơn hàng · Tuyến · Đơn vị · Nhà thầu · Mã hàng (QLNB) · Tên hàng · Hàm lượng · ĐVT · Giá trúng thầu ·
Số lượng · Thành tiền xuất bán (trước VAT) · C36 · C41 · C43 · C44 · C45 · Thành tiền tháng · Ghi chú`

**PART-TIME (15 cột):** như trên nhưng **chỉ C36** (bỏ C41/C43/C44/C45):
`… Thành tiền xuất bán (trước VAT) · C36 · Thành tiền tháng · Ghi chú`

## 3. CỘT MỚI + NGUỒN
| Cột | Nguồn | Ghi chú |
|---|---|---|
| **Tuyến** | App Sale `route` | |
| **Nhà thầu** | App Sale `contractor_code` → resolve **tên** | |
| **Hàm lượng** | App Sale/catalog `ham_luong` | **‼ QĐ141 rất dài → hiển thị 1 DÒNG**, rút gọn `…`, di chuột/bấm xem đầy đủ (tooltip). KHÔNG xuống dòng/nở hàng. |
| **Giá trúng thầu** | App Sale `bid_price` | **CEO DUYỆT hiển thị** (ngoại lệ có kiểm soát, self-scoped). |
| **Thành tiền xuất bán (trước VAT)** | App Report tính | = **doanh thu TRƯỚC VAT** (= doanh thu ÷ `VAT_DIVISOR`). Thay cho cột "Doanh thu" cũ. |
| **Ghi chú** | **DataHub cột `C48`** | Text; **cần DataHub bổ sung C48 vào payload** (xem §6). App Report đọc C48 làm ghi chú (KHÔNG phải cột %). Sanitize text. |

## 4. ‼ VAT — ĐỔI GỐC TÍNH (khác production hiện tại)
- **Thành tiền xuất bán = TRƯỚC VAT.** **Chi phí % nhân với số TRƯỚC VAT:**
  `Thành tiền(dòng, cột%) = (doanh thu trước VAT) × % ÷ 100`.
- Doanh thu trước VAT = doanh thu(App Sale) ÷ `VAT_DIVISOR` (đã có trong `analytics.js`).
- **Lưu ý:** production hiện đang tính trên **có-VAT** → đợt này **sửa base sang trước-VAT**. Tổng chi phí tháng
  sẽ đổi tương ứng. Giữ: c44 tách cuối năm, `%` dạng `8.0`, self-scope, grain order-line, công tắc.

## 5. GIỮ NGUYÊN
- Grain order-line (mỗi đơn/mặt hàng 1 dòng), % theo timeline (catalog V30.10), ghép theo mã, thiếu %→`—`,
  <90% ẩn tổng, self-scope NV, C32/C47 khóa, công tắc bật/tắt, xem theo ngày.

## 6. VIỆC DATAHUB (giao DataHub Bot — cross-app)
- **Thêm cột `C48` (Ghi chú)** vào payload `employee-cost` (text). C48 **ngoài** dải % C33–C46 nên phải whitelist
  riêng cho trường ghi chú; **vẫn khóa C32/C47**. Self-scoped theo NV. Báo lại App Report khi có.

## 7. NGHIỆM THU
1. NV full-time → mẫu 19 cột đủ 5 %; NV thuộc {DN021,DN022,DN023} → mẫu 15 cột chỉ C36.
2. Thành tiền = **doanh thu TRƯỚC VAT × %** (đối chiếu tay 1 dòng).
3. Cột mới hiện đúng nguồn; **Hàm lượng QĐ141 = 1 dòng** + tooltip đầy đủ; Giá trúng thầu hiện; Ghi chú = C48.
4. Thứ tự cột khớp file mẫu CEO. Giữ c44/scope/grain/công tắc; test cũ + test mẫu mới PASS.
5. Push nhánh review lên `donapharm/app-report-new`; dán mẫu 2 loại NV; báo Claude review. Chưa deploy.
