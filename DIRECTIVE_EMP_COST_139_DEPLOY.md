# DIRECTIVE — DEPLOY đợt 2: #139 bảng UX (STT · tất cả NV · tìm kiếm · cột % hẹp) — review PASS

> Claude Code giao Report Bot. Nguồn: `review/employee-cost-table-ux-20260722` @ **`a3b4fd6`** — Claude review **PASS**.
> UI/UX thuần, **không đổi số/tiền**, self-scope giữ chắc → rủi ro thấp.

## 1. NỘI DUNG
- **Cột STT** tự nhảy theo dòng hiển thị (lọc/tìm/sort → đánh lại); có trong Excel/PDF.
- **"Tất cả nhân viên" (CEO/ADMIN only)** — cột NV + tổng phụ theo NV + phân trang. **Khóa 3 lớp**: NV gọi `emp=ALL` → 403.
- **Tìm kiếm bỏ dấu + hoa/thường** (NFD + đ→d), đa từ khóa, highlight, đếm X/Y; **sort** cột; **sticky**; **cột % hẹp**.
- Export Excel/PDF **phản ánh bộ lọc/tìm/sort/STT**.

## 2. CÁC BƯỚC
1. Merge `a3b4fd6` → `main`.
2. `npm run build` web. **Deploy FE + RESTART BE đồng bộ** (route `emp=ALL` + all-payload mới). Không lệch phiên bản.
3. Health check + nghiệm thu §3. Ghi CHANGELOG. Báo Claude.

## 3. NGHIỆM THU SAU DEPLOY (dán cho Claude)
1. **STT** 1..N đúng theo dòng hiển thị; đổi lọc/tìm/sort → đánh lại; có trong Excel/PDF.
2. **CEO** chọn "Tất cả nhân viên" → thấy mọi NV + cột NV + tổng phụ + phân trang. **NV thường: KHÔNG có lựa chọn này;
   gọi `?emp=ALL` trả 403** (thử để xác nhận). NV vẫn chỉ xem/xuất của mình.
3. **Tìm kiếm:** gõ **không dấu** (vd `dviet`) ra `Đức Việt`; hoa/thường; highlight; đếm X/Y. Sort cột; sticky khi cuộn.
4. Cột % hẹp gọn; export phản ánh lọc/tìm/sort/STT.
5. **Không đổi số:** tổng tháng 41.144.556đ, C44 1.210.470đ, coverage vẫn đúng. C32/C47 không lộ; self-scope giữ.

## 4. RỦI RO & ROLLBACK
- UI thuần, không đổi công thức → rủi ro thấp. Bất thường → rollback về main trước deploy (backup). Tab mở tải lại 1 lần.

## 5. SAU #139
- Report Bot làm tiếp **Trung tâm tự bắt lỗi đợt 1** (`DIRECTIVE_EMP_COST_DQ_CENTER.md` #141) trên nhánh mới.
- DataHub Bot: điền % + alias mã → coverage tiến 100% (App Report tự khớp, không deploy).
