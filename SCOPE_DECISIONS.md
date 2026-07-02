# SCOPE DECISIONS — App Report New (CEO chốt 2026-07-02)

> Quyết định phạm vi cuối cùng cho các mục "todo/partial" trong MIGRATION_MATRIX.
> Bot theo đúng đây; KHÔNG tự làm mục đã CẮT. Claude review.

## ✅ LÀM (thuộc phạm vi báo cáo)
- **Biểu đồ (Recharts):** 4 chart — đường DT theo kỳ · cột top ĐV/SP · donut cơ cấu tuyến/nhà thầu/gói thầu · vòng tiến độ target. Theo bộ lọc kỳ + scope. Đặt: Tổng quan + Phân tích + Target.
- **PDF/print + export mẫu** cho các trang chính (Excel đã có → thêm PDF).
- **Target admin:** CEO nhập/sửa/xoá target từng NV theo kỳ + nút **AI đề xuất** (dựa kỳ trước + mùa vụ). Chỉ admin. Lưu vào nguồn target thật (targets_real), có audit ai sửa.
- **Tab Nhân viên — BẢN GỌN:** danh bạ mã NV/tên/SĐT/email/bộ phận/chức vụ/**tình trạng (đang làm/nghỉ)**. **KHÔNG** đưa CCCD/ngày sinh/PII nhạy cảm. Chỉ admin. Kèm cờ nghỉ việc → NV nghỉ tự loại khỏi target/forecast/cảnh báo/ranking.
- **Tab Đối chiếu (read-only):** CEO xem so số app cũ ↔ app mới theo kỳ/tab (tổng, dòng, diff, sample). Chỉ hiển thị, không sửa.
- **Sản phẩm:** bổ sung hoạt chất/nhóm thuốc nếu dữ liệu có (nhẹ).

## ❌ CẮT (không đưa vào App Report — giữ đúng "gọn")
- **Điều chuyển NV** → thuộc Sale App/Bot. Report chỉ đọc nếu cần báo cáo.
- **Thưởng 3P + gửi Zalo/Email khen thưởng tự động** → workflow riêng. Report chỉ *xem* target/% đạt.
- **Kho master data — SỬA/GỘP/UPLOAD** NV+đơn vị → DataHub/Admin module. Report chỉ đọc danh mục.

## 🧭 Danh mục phân công + Điều chuyển bán hàng (CEO chốt 2026-07-02)
- **Vị trí:** khi làm → đặt **TRONG App Report** (khu "Quản trị / Phân công" riêng, chỉ admin) — tận dụng master NV/đơn vị/SP + nối scope/target/CST, không nhân đôi dữ liệu.
- **Thời điểm:** **CHƯA làm — ghi để SAU** (sau hàng đợi: Login V2, biểu đồ, Target admin, tab NV/Đối chiếu).
- **Nguyên tắc bắt buộc khi làm:** điều chuyển chỉ áp cho **tương lai** (từ ngày/kỳ hiệu lực); **KHÔNG hồi tố doanh thu lịch sử**; lưu **lịch sử điều chuyển + hiệu lực** đầy đủ (audit). Model gợi ý: bảng phân công `{emp_code, unit_code, iit_code|"all", hiệu lực_từ/đến, trạng thái}`; điều chuyển theo lô (nhiều hàng × nhiều đơn vị) từ A→B. Tận dụng logic "điều chuyển theo cơ số thầu còn lại" (QĐ139/141) của app cũ.

## ⏳ SAU (khi thật cần)
- Export "page/all theo đúng mẫu cũ", chọn page-size kiểu cũ (Excel-theo-lọc hiện đủ dùng).
- Upload thêm loại "Đặt hàng/Khác" (hiện chỉ doanh thu là đủ).
- AI hỏi nhanh nối sâu CST/Target + LLM diễn giải.

## Ưu tiên triển khai
1. Sửa OTP (rolling + thiết bị 7 ngày) — SPEC_TELEGRAM_DIGEST phần A.
2. Login V2 go-live (chờ token) + Bản tin Telegram (phần B).
3. Biểu đồ (Recharts) + PDF.
4. Target admin · Tab Nhân viên gọn (+ cờ nghỉ) · Tab Đối chiếu.
Mỗi đợt: push + CHANGELOG + báo CEO để Claude review. Không đụng app cũ (dona-report 3860).
