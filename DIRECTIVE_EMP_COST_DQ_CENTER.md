# DIRECTIVE — "Trung tâm Kiểm soát Dữ liệu Chi phí" (auto bắt lỗi + nguyên nhân + chuông cảnh báo) — CEO 2026-07-22

> Claude Code giao Report Bot. **Mở rộng gap tool (#137)** từ 1 loại lỗi (thiếu %) thành **bộ kiểm nhiều loại lỗi** khi
> lấy dữ liệu App Sale → tính chi phí: tự phát hiện, **tự giải thích nguyên nhân**, gộp vào **mục riêng**, **rung chuông**
> cho CEO — CEO không phải điều tra thủ công. App Report **phát hiện + cảnh báo**; sửa ở **nguồn** (App Sale/DataHub);
> **không tự sửa số, không bịa**.

## 1. CÁC LOẠI LỖI TỰ BẮT (rule engine backend, cấu hình được)
Chia **2 nhóm theo mức độ** (điểm thông minh: cho CEO biết cái nào **ảnh hưởng tiền** vs chỉ **xấu hiển thị**):

**A. NHÓM SAI/NGHI NGỜ TIỀN (đỏ — ưu tiên):**
| Mã lỗi | Bắt khi | Nguồn sửa |
|---|---|---|
| `PRODUCT_MISSING` | mã QLNB có doanh thu nhưng **catalog chưa có %** | DataHub (nhập %) |
| `PRODUCT_MISMATCH` | mã QLNB **lệch (khác số QĐ)**, có ứng viên gần trùng | DataHub (alias) |
| `UOM_MISMATCH` | **ĐVT** sale ≠ catalog (nghi ghép nhầm mặt hàng/sai quy đổi) | App Sale / catalog |
| `BID_PRICE_INVALID` | **giá trúng thầu** thiếu/`0`/âm/bất thường | App Sale |
| `REVENUE_ANOMALY` | doanh thu `≤0`/outlier bất thường | App Sale |
| `DUPLICATE_LINE` | dòng đơn×mặt hàng **trùng lặp** | App Sale |

**B. NHÓM THIẾU HIỂN THỊ (vàng — không sai tiền):**
| Mã lỗi | Bắt khi | Nguồn sửa |
|---|---|---|
| `UNIT_UNKNOWN` | **mã đơn vị** không có trong danh mục / không ra tên | App Sale / danh mục đơn vị |
| `ROUTE_MISSING` | thiếu **tuyến** | App Sale |
| `CONTRACTOR_UNRESOLVED` | **nhà thầu** không resolve ra tên | App Sale / danh mục |
| `HAMLUONG_MISSING` | thiếu **hàm lượng** | catalog |

→ Bộ rule **cấu hình được** (bật/tắt từng loại, đặt ngưỡng), CEO chỉnh không sửa code.

## 2. MỖI EXCEPTION GỒM (tự giải thích — không bắt CEO đoán)
`loại · mức (đỏ/vàng) · trường lỗi · giá trị lỗi · mã QLNB/tên · đơn vị · tuyến · NV · kỳ · doanh thu ảnh hưởng ·`
**`nguyên nhân (câu giải thích tự sinh)`** · **`hành động đề xuất`** (vd "DataHub nhập %", "xác nhận alias mã",
"bổ sung mã đơn vị vào danh mục", "kiểm tra giá thầu tại App Sale") · **`nguồn cần sửa`** · **`trạng thái xử lý`**.

## 3. GỘP THÔNG MINH + DASHBOARD (CEO/ADMIN)
- **Gộp theo nguyên nhân gốc** (1 mã lỗi → nhiều dòng): hiện "sửa 1 chỗ khớp N dòng · doanh thu W". **Xếp theo doanh thu
  ảnh hưởng** giảm dần → ưu tiên.
- **Tab "Kiểm soát dữ liệu"**: thẻ tổng quan (số lỗi theo loại/mức, doanh thu ảnh hưởng), **lọc/tìm** (loại · mức · NV ·
  đơn vị · tuyến · mã · nguồn sửa), **bỏ dấu/hoa-thường**. **Xuất Excel/PDF** (dùng chuẩn export VN #138).
- **Trạng thái xử lý** mỗi exception: `mới / đang xử lý / đã xử lý / bỏ qua (kèm lý do)` + người xử lý + thời gian → **theo
  dõi, không điều tra lặp**. Kỳ sau tự so sánh (lỗi mới / đã hết).
- **Deep-link:** bấm exception → nhảy tới đúng dòng/mã trong bảng chi phí.

## 4. ‼ CHUÔNG CẢNH BÁO (CEO)
- **Badge số trên chuông 🔔** = số exception **đỏ chưa xử lý** (dùng chuông sẵn có trên header).
- **Ngưỡng cấu hình:** số lỗi đỏ hoặc doanh thu ảnh hưởng vượt ngưỡng → chuông **đỏ** + panel "cần xem lại".
- (Mở rộng tùy chọn) tóm tắt định kỳ gửi CEO (email/Telegram) — làm sau, không bắt buộc đợt này.
- Chuông/panel này **CEO/ADMIN**; NV chỉ thấy lỗi **dòng của mình** (self-scope), không thấy toàn cục.

## 5. RANH GIỚI / BẢO MẬT
- App Report **chỉ phát hiện + cảnh báo + chỉ nguồn sửa**; **không tự sửa** dữ liệu App Sale/catalog, **không bịa số**.
- **Self-scope:** NV chỉ lỗi của mình; **CEO/ADMIN** thấy toàn bộ (backend khóa). Không lộ % / C32 / C47 / dữ liệu NV khác.
- Số/lỗi từ backend; audit mỗi lượt xem/xuất/đổi trạng thái. Reuse gap tool (#137) + export VN (#138) — không dựng trùng.

## 6. NGHIỆM THU
1. Chèn dữ liệu lỗi mẫu mỗi loại → xuất hiện đúng loại/mức/nguyên nhân/hành động/nguồn; gộp theo mã, xếp theo doanh thu.
2. Chuông hiện đúng số lỗi đỏ chưa xử lý; vượt ngưỡng → đỏ. Đổi trạng thái "đã xử lý" → badge giảm.
3. NV chỉ thấy lỗi của mình; CEO thấy toàn bộ; không lộ %/C32/C47. Export VN chạy.
4. `PRODUCT_MISSING/MISMATCH` khớp kết quả gap tool hiện có (không đếm trùng). Test + build PASS. Push nhánh review; báo Claude; chưa deploy.

## 7. GỢI Ý TRIỂN KHAI TỪNG BƯỚC (để không ôm quá to)
- **Đợt 1:** rule engine + 4–5 loại lõi (PRODUCT_MISSING/MISMATCH, UOM_MISMATCH, BID_PRICE_INVALID, UNIT_UNKNOWN) +
  tab dashboard + chuông badge. **Đợt 2:** các loại còn lại + trạng thái xử lý + gửi định kỳ. (Bot đề xuất mốc, CEO chốt.)
