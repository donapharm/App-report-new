# DIRECTIVE — Target admin (nhập file + tự động + AI + tay) + sửa danh sách NV + tách telesale

> Claude Code giao (CEO phản ánh Target sai/thiếu 2026-07-03). **Ưu tiên cao** — CEO đã yêu cầu từ trước nhưng chưa triển khai. Bot làm; Claude review. Theo `SPEC_TARGET_MULTISOURCE.md`. Không đụng app cũ 3860.

## 1) SỬA "SAI/THIẾU" NGAY (không chờ Target admin)
- **Thiếu NV:** danh sách Target/Dự báo hiện lấy NV có bán trong kỳ mới nhất (T07 đang chạy dở → sót). **Sửa: lấy TOÀN BỘ đội sale đang hoạt động** (NV sale + CTV sale, status active), và **neo "target cũ"/xu hướng theo THÁNG ĐỦ GẦN NHẤT (T06)**, không dựa tháng đang chạy dở.
- **Tách TELESALE khỏi NV sale thị trường:** `VP018` (và telesale khác) là **telesale**, không phải NV sale thị trường. Thêm **loại NV** trong danh bạ: `sale` (thị trường) · `telesale` · `ctv` · `văn phòng`/khác. Danh sách target NV sale **chỉ gồm sale + ctv sale**; telesale tách nhóm riêng (xem câu hỏi CEO bên dưới).
- Kết quả: Dự báo hiện **đủ đội sale thật**, không lẫn telesale.

## 2) XÂY TARGET ADMIN (theo SPEC_TARGET_MULTISOURCE.md) — CEO chờ lâu
Cho CEO/admin quản target theo kỳ, **3 đường nhập**:
1. **Nhập bằng FILE (upload):** mẫu Excel `{emp_code, ky, target}`; preview + validate (mã NV hợp lệ, số hợp lệ) + commit + rollback (như `upload.js`). → nguồn `upload`.
2. **Tự động từ App Sale** (nếu App Sale có bảng target/KPI theo NV/kỳ — bot xác nhận; chưa có thì để hook, làm 2 đường kia trước). → nguồn `appsale`.
3. **AI đề xuất → CEO ÁP DỤNG:** forecast đã có; CEO bấm "Áp dụng" mới thành target thật (AI không tự chốt). → nguồn `ai`.
4. **Sửa tay:** CEO nhập/sửa từng ô. → nguồn `manual`, khóa không bị sync đè.
- Resolver chọn target active theo ưu tiên `manual > upload > appsale > ai` (SPEC_TARGET_MULTISOURCE). `store.getTargets` trả target active đã resolve → %đạt/cảnh báo/dự báo dùng đúng.
- Pro-rate target kỳ đang chạy theo ngày (đã chốt PA A) áp luôn.

## 3) TELESALE — CEO CHỐT 2026-07-03: KHÔNG giao target
- **Telesale (VP018…) KHÔNG có target.** → **Loại telesale khỏi:** danh sách Target/Dự báo, chấm % đạt, cảnh báo "chưa đạt", xếp hạng theo target. Không hiện đỏ, không tính vào "NV chưa đạt".
- Telesale vẫn **giữ trong danh bạ** (loại `telesale`, active); doanh thu của họ (nếu có) **vẫn tính vào tổng công ty** như thường — chỉ **không đánh giá target**.
- Tag `VP018 = telesale` ngay. **Còn chờ CEO:** danh sách telesale khác (ngoài VP018) để tag đủ; và xác nhận đội NV sale thị trường (hoặc bot suy từ status active + loại `sale`, CEO liếc lại).

## Nghiệm thu
- Dự báo/Target hiện **đủ đội sale thật**, không lẫn telesale; số NV khớp danh sách CEO xác nhận.
- CEO nhập target bằng file → lên app; AI đề xuất → bấm áp dụng → thành target; sửa tay được; có audit.
- %đạt/cảnh báo dùng target thật; kỳ đang chạy pro-rate theo ngày. Scope đúng; NV chỉ thấy mình.
