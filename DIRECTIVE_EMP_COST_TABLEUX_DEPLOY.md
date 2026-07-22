# DIRECTIVE — DEPLOY bảng UX trọn gói (#139 + filters + tỉnh + pager/ngày) — review PASS

> Claude Code giao Report Bot. Nguồn: `review/employee-cost-table-ux-20260722` @ **`d0c6b56`** — Claude review **PASS toàn bộ**.
> UI/UX thuần, **không đổi số/tiền**, self-scope + C32/C47 giữ → rủi ro thấp.

## 1. NỘI DUNG (đã review PASS)
- **#139:** STT · "Tất cả NV" (CEO/ADMIN, khóa 3 lớp) · tìm kiếm bỏ dấu · sort · sticky · cột % hẹp · tổng phụ theo NV.
- **#144:** lọc **Nhóm mã đơn vị** (config) · **Tuyến** · all-fix.
- **#146:** **Vùng/Tỉnh** chỉ từ nguồn chính thức (`row.province`/`unit_province.json`), thiếu → "Chưa gán tỉnh" — **bỏ đoán tên**.
- **#145:** phân trang **pill 20 dòng/trang** + cỡ trang 20/50/100 + **pager trên & dưới (sticky)** · **chọn ngày** xem doanh
  thu (chạy cả Tất cả NV). Export phản ánh lọc/tìm/sort/STT/ngày/trang.

## 2. CÁC BƯỚC
1. Merge `d0c6b56` → `main`.
2. `npm run build` web. **Deploy FE + RESTART BE đồng bộ** (route emp=ALL + filters + date). **Không lệch phiên bản.**
3. Health check + nghiệm thu §3. Ghi CHANGELOG. Báo Claude.

## 3. NGHIỆM THU SAU DEPLOY (dán cho Claude)
1. "Tất cả NV" liệt kê đủ (template "TẤT CẢ NHÂN VIÊN"); NV gọi `?emp=ALL` → 403.
2. Lọc Nhóm mã ĐV / Tuyến / **Vùng-Tỉnh** (chỉ nguồn chính thức; đơn vị chưa map → "Chưa gán tỉnh") / **Ngày** — kết hợp + tìm kiếm; STT/đếm/export phản ánh.
3. Phân trang **20 dòng**, nút pill, pager **trên + dưới** (trên sticky), đổi cỡ trang 20/50/100.
4. **Số không đổi:** tổng tháng, C44, coverage đúng như trước. C32/C47 không lộ; self-scope giữ.
5. Trang khác không đổi. BE restart (PID/restart mới).

## 4. RỦI RO & ROLLBACK
- UI thuần → rủi ro thấp. Bất thường → rollback về main trước deploy (backup). Tab mở tải lại 1 lần.

## 5. SAU DEPLOY
- **Điền `unit_province.json`** (map mã ĐV → tỉnh) để Vùng/Tỉnh chính xác 100% — bot xuất danh sách ĐV "Chưa gán tỉnh" cho CEO điền.
- Report Bot: **Trung tâm tự bắt lỗi đợt 1** (#141). DataHub: điền %/alias → coverage 100%.
