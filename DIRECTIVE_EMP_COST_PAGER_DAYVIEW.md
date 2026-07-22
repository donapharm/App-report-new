# DIRECTIVE — Phân trang kiểu "viên thuốc" 20 dòng + pager lên đầu + xem theo NGÀY doanh thu (CEO 2026-07-22)

> Claude Code giao Report Bot. 3 việc UX bảng "Chi phí của tôi" (tiếp #139). Ghi nhận: "Tất cả NV" đã chạy (1.550 dòng,
> coverage 96,5%), lọc Nhóm mã đơn vị + Tuyến đã có. **Không đổi số/công thức; self-scope + C32/C47 giữ.**

## 1. PHÂN TRANG — nút "viên thuốc" (pill) + 20 dòng/trang + số trang bấm được
- **pageSize = 20** dòng/trang (hiện đang 100). Áp cho bảng chi phí (cả 1-NV lẫn tất cả NV) + tab "Mặt hàng thiếu %".
- **Kiểu nút bo tròn (pill/"viên thuốc")** đồng bộ như tab gap (Trước/Sau bo tròn) — dùng chung style.
- **Thêm số trang bấm được** (pill số 1·2·3…·N) để nhảy nhanh; nhiều trang thì rút gọn `1 … 7 8 [9] 10 … 25` + nút Trước/Sau.
- (Nên có) ô **"tới trang…"** khi >10 trang. Hiện rõ **"Trang X/Y · N dòng"**.

## 2. PAGER LÊN ĐẦU BẢNG (trên + dưới)
- Đặt **thanh phân trang cả ở ĐẦU bảng** (ngay trên hàng tiêu đề / cạnh "Tổng phụ theo nhân viên"), **giữ nguyên bản dưới**.
- Pager đầu **dính (sticky)** khi cuộn để luôn bấm được. 2 pager đồng bộ (đổi trang ở trên/dưới đều cập nhật).

## 3. XEM THEO NGÀY DOANH THU (nút chọn ngày hoạt động)
- Thêm **bộ chọn NGÀY**: dropdown các **ngày CÓ doanh thu** trong kỳ (+ tùy chọn "Tất cả ngày"). Chọn 1 ngày → **bảng lọc
  đúng dòng của ngày đó** (doanh thu + chi phí ngày đó); STT đánh lại; đếm X/Y; export phản ánh.
- **‼ Hoạt động cả chế độ "Tất cả NV"** (hiện daily đang tắt ở chế độ merge). Cài như **1 bộ lọc ngày ở backend** (lọc rows
  theo trường ngày) — kết hợp với NV/nhóm mã/tuyến/tìm kiếm/phân trang. Không cần đối chiếu "Σ ngày = tháng" cho chế độ này
  (chỉ là lọc xem theo ngày).
- Chỉ hiện ngày **có thật** trong dữ liệu; ngày không hợp lệ/thiếu → không đưa vào dropdown (không bịa).

## 4. GỢI Ý THÔNG MINH (Claude tư vấn thêm)
- **Chọn cỡ trang** 20/50/100 (mặc định **20**) — người xem đổi nhanh.
- Pager + ngày + các lọc + tìm kiếm **kết hợp** nhau; **STT + đếm + export** luôn phản ánh đúng cái đang xem.
- Giữ **sticky header** + cột STT/tên hàng khi cuộn (đã có) — pager đầu cũng sticky để đồng bộ.
- Đổi trang **không mất** bộ lọc/tìm/ngày đang chọn.

## 5. GIỮ NGUYÊN / RANH GIỚI
- Self-scope: "Tất cả NV" + lọc toàn roster = CEO/ADMIN only (backend khóa). NV chỉ của mình.
- Số từ backend, không đổi công thức/tiền; C32/C47 không lộ; audit. Lọc/phân trang chế độ tất cả NV chạy **backend** (dữ liệu lớn).

## 6. NGHIỆM THU
1. Bảng 20 dòng/trang, nút phân trang **bo tròn (pill)** + số trang bấm được; đầu + cuối bảng đều có pager, pager đầu sticky, 2 cái đồng bộ.
2. Chọn 1 ngày → chỉ hiện dòng ngày đó (kể cả "Tất cả NV"); "Tất cả ngày" → về đủ; kết hợp với nhóm mã/tuyến/tìm kiếm.
3. STT/đếm/export phản ánh trang + lọc + ngày. Không đổi tổng số (chỉ đổi cách xem). Self-scope + C32/C47 giữ.
4. Test + build PASS. Push nhánh review; báo Claude; chưa deploy.
