# DIRECTIVE — SỬA GẤP: doanh thu gán SAI nhân viên phụ trách (nguồn App Sale cũ/sai)

> Claude Code giao Report Bot. **CEO báo lỗi tiền/định danh nghiêm trọng:** doanh thu đang gán **KHÔNG đúng nhân viên
> phụ trách**. Ảnh hưởng "Chi phí của tôi" (NV thấy dòng của người khác / mất dòng của mình) + mọi báo cáo per-NV.

## 1. CƠ CHẾ (đã xác định trong code)
- `store.js`: mỗi dòng doanh thu mang sẵn **`emp_code`** (từ `raw_emp_code`/`raw_nv` trong dữ liệu nguồn). `getRows({scope:{empCode}})`
  chỉ **lọc `r.emp_code === empCode`**. **App Report KHÔNG tự gán lại phụ trách** (điều chuyển NV đã cắt khỏi App Report).
- ⇒ "NV phụ trách" = **đúng field `emp_code` trong bản doanh thu App Sale**. Sai attribution = **nguồn doanh thu đang đọc bị cũ/sai**.

## 2. VIỆC BOT — KIỂM TRA NGUỒN ĐANG CHẠY
1. **Xác định nguồn doanh thu active** App Report đang đọc: **slot upload nào** (id/tên file/ngày tải) hay **fallback ORDS
   `SALES_REPORT`**? In ra: nguồn · ngày/version · số dòng · kỳ.
2. **So khớp phụ trách:** với vài đơn vị CEO chỉ ra (xem §5), kiểm `emp_code`/`raw_emp_code` của dòng doanh thu **so với
   phụ trách HIỆN TẠI** đúng chưa. Thống kê: bao nhiêu đơn vị/dòng đang gán NV **khác** roster/phụ trách hiện hành;
   bao nhiêu rơi vào `UNALLOCATED_EMP` (emp_code không hợp lệ).
3. **Nguồn có mới hơn không:** có bản App Sale mới (đúng phụ trách) mà App Report **chưa nạp** không? (slot cũ chưa thay/
   ORDS chưa refresh).

## 3. SỬA
- **Nạp bản doanh thu App Sale MỚI NHẤT** (đúng emp_code phụ trách) làm slot active, HOẶC refresh ORDS `SALES_REPORT`
  đúng nguồn đã chốt. Sau khi nạp: App Report tự lọc đúng NV (không sửa code attribution — code đúng, chỉ nguồn sai).
- Nếu emp_code trong nguồn vẫn sai (App Sale đẩy sai) → **đây là lỗi ở App Sale**, báo để App Sale sửa export; App Report
  KHÔNG tự đoán/gán lại phụ trách (giữ nguyên tắc: không bịa, không remap).
- Dòng emp_code không hợp lệ → giữ `UNALLOCATED_EMP` (đã có), **liệt kê ra** để CEO xử (đừng gán bừa vào NV nào).

## 4. NGHIỆM THU
1. In nguồn active (slot/ORDS + ngày). Sau khi nạp bản đúng: đơn vị CEO chỉ ra **về đúng NV phụ trách**.
2. Đối chiếu vài NV: tổng doanh thu/số đơn vị khớp phụ trách hiện tại; số `UNALLOCATED` giảm/được liệt kê.
3. **Số công thức chi phí không đổi** (chỉ đổi dòng nào thuộc NV nào) — coverage/C44 tính lại theo phụ trách đúng.
4. Báo Claude: nguồn cũ là gì, bản mới ngày nào, danh sách đơn vị đổi phụ trách. Push/deploy theo quy trình đã duyệt.

## 5. CẦN CEO CUNG CẤP (để đối chiếu chính xác)
- **1–2 ví dụ cụ thể:** đơn vị nào / NV nào đang bị gán sai (đang hiện NV nào, đúng phải là NV nào). Có ví dụ, bot truy
  đúng nguồn sai ngay, khỏi mò.
- (Nếu có) **bản App Sale mới nhất** cần nạp, hoặc xác nhận ORDS `SALES_REPORT` là nguồn chuẩn.
