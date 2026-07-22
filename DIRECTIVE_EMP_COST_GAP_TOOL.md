# DIRECTIVE — Công cụ "Mặt hàng chưa có % chi phí" + Export Excel gap (CEO 2026-07-22)

> Claude Code giao Report Bot. Mục tiêu: biến các dòng `—` (doanh thu có nhưng catalog DataHub chưa có %) thành
> **1 công cụ quản trị gọn** (CEO điền/đối chiếu nhanh) + **1 chỗ NV nhìn là hiểu**. App Report **phát hiện gap**;
> DataHub **điền %** (SSOT). App Report KHÔNG bịa số.

## 1. Ý TƯỞNG THÔNG MINH (khác dump bảng thô)
1. **Gộp theo MÃ QLNB, không theo dòng.** 1 mã thiếu % thường ảnh hưởng nhiều đơn vị/NV → điền 1 lần ở catalog là
   khớp hàng loạt. Danh sách gọn theo mã, kèm "ảnh hưởng: N đơn vị · M NV · doanh thu W".
2. **Xếp theo mức ảnh hưởng** (doanh thu ảnh hưởng giảm dần) → điền mã tác động lớn trước, coverage tăng nhanh nhất.
3. **Phân loại lý do + GỢI Ý:**
   - **Lệch mã QĐ**: catalog có mã "gần trùng" (cùng phần định danh/đuôi, khác số QĐ) → App Report **gợi ý mã catalog
     ứng viên** → DataHub chỉ cần **ánh xạ** (nhanh).
   - **Thiếu hẳn**: không có mã gần trong catalog → DataHub **nhập % mới**.
4. **NV nhìn là hiểu** (không hoang mang khi thấy `—`).
5. **Excel = worklist điền nhanh**: có cột trống **"% cần điền"** để DataHub điền rồi import; kèm cột "mã catalog gợi ý"
   cho ca lệch mã.

## 2. BACKEND (App Report) — endpoint gap (self-scope)
- `GET /api/employee-cost/gaps` (session token): trả các cặp (đơn vị+mã) **có doanh thu nhưng KHÔNG khớp %** trong kỳ.
  - **NV** → chỉ gap **của chính mình** (ép scope như `/employee-cost`).
  - **CEO/ADMIN** → toàn bộ (tùy chọn `?emp=` hoặc toàn roster), **gộp theo mã QLNB**.
- Mỗi mục (theo mã QLNB) gồm: `mã_qlnb · tên_hàng · [đơn vị ảnh hưởng] · số_nv · doanh_thu_ảnh_hưởng ·
  lý_do(lệch_mã_QĐ|thiếu_hẳn) · mã_catalog_gợi_ý(nếu lệch)`.
- **Gợi ý mã catalog:** với mã doanh thu không khớp, dò catalog tìm mã **cùng phần định danh/đuôi khác số QĐ**;
  có ứng viên → `lý_do=lệch_mã_QĐ` + `mã_catalog_gợi_ý`; không có → `thiếu_hẳn`. **Chỉ gợi ý, KHÔNG tự ánh xạ** (nguyên tắc #3).
- **KHÔNG chứa số %/chi phí** (đây là danh sách THIẾU %, không lộ payout). Doanh thu thì NV vốn đã thấy. Audit truy cập.

## 3. FRONTEND
### 3a. NV — trong trang "Chi phí của tôi"
- Thêm **mục gọn**: banner/khung *"⚠ N mặt hàng chưa có % chi phí — đang chờ bổ sung (không phải lỗi)."* + nút mở
  danh sách (đơn vị · mã · tên hàng · doanh thu). Giúp NV hiểu vì sao vài dòng để `—`.
### 3b. CEO/ADMIN — tab/panel "Mặt hàng thiếu % chi phí"
- Bảng **gộp theo mã QLNB**, mặc định **xếp theo doanh thu ảnh hưởng giảm dần**.
- **Lọc/tìm** theo: mã QLNB, tên hàng, đơn vị, NV, lý do (lệch mã QĐ / thiếu hẳn).
- Cột: mã QLNB · tên hàng · #đơn vị · #NV · doanh thu ảnh hưởng · lý do · **mã catalog gợi ý** (nếu lệch).
- **Nút "Xuất Excel"** (đi qua backend + kiểm quyền): xuất đúng danh sách đang lọc.
- **Thanh tiến độ coverage**: "Đã khớp X% · còn Y mã chưa có %" (toàn bộ / theo NV) → thấy tiến tới 100%.

## 4. EXPORT EXCEL (backend, kiểm quyền)
- 2 sheet: **(1) Theo mã QLNB** (worklist chính): mã QLNB · tên hàng · [đơn vị] · #NV · doanh thu ảnh hưởng · lý do ·
  mã catalog gợi ý · **cột trống "% cần điền"**. **(2) Ánh xạ lệch mã** (chỉ ca lệch QĐ): mã doanh thu → mã catalog gợi ý → cột "xác nhận".
- Dòng chú thích đầu file: *"Điền cột '% cần điền' hoặc xác nhận ánh xạ → gửi DataHub cập nhật catalog. Xếp theo doanh
  thu ảnh hưởng: làm từ trên xuống để khớp nhanh nhất."*
- Admin: toàn roster; NV: chỉ của mình (nếu mở cho NV xuất).

## 5. GIỮ NGUYÊN / RANH GIỚI
- App Report **chỉ phát hiện + hiển thị + export gap**; **DataHub điền % / chuẩn hóa mã** (SSOT). Điền xong App Report
  tự khớp lại, coverage lên, KHÔNG sửa code.
- Self-scope NV, C32/C47 khóa, không bịa %, số từ backend, audit — giữ.

## 6. NGHIỆM THU
1. NV: thấy mục "N mặt hàng chưa có %" đúng số gap của mình; mở ra khớp các dòng `—` trong bảng.
2. CEO: tab gộp theo mã QLNB, lọc/tìm chạy; xếp theo doanh thu ảnh hưởng; lý do + gợi ý mã đúng; coverage progress đúng.
3. Xuất Excel: đúng danh sách lọc, 2 sheet, cột "% cần điền" trống, có ứng viên ánh xạ cho ca lệch QĐ.
4. DN001 T07: liệt kê đúng **13 cặp** (khớp 171/184); trong đó chỉ rõ cặp nào lệch mã QĐ (vd `QĐ139…` vs catalog `QĐ48…`).
5. Self-scope (NV không thấy gap người khác), không lộ %, audit. Test + build PASS. Push nhánh review; báo Claude; chưa deploy.

## 7. VIỆC DATAHUB (task riêng, cross-app)
- Nhận worklist Excel: **điền % cho mã thiếu hẳn** / **ánh xạ mã cho ca lệch QĐ** trong catalog. Báo App Report khi cập nhật.
