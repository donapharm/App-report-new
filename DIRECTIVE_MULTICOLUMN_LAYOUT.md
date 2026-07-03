# DIRECTIVE — Bố cục ĐA CỘT (2–3 cột) cho MỌI khối danh sách trên PC — làm TRIỆT ĐỂ

> Claude Code giao (CEO phản ánh LẦN 2, 2026-07-03 — lần trước làm chưa triệt để). Bot triển khai; Claude review. **Yêu cầu: áp cho TẤT CẢ tab, không sót.**

## Vấn đề
Trên PC, các khối danh sách/ranking đang render **1 cột full-width** → số bị đẩy sang mép phải, khoảng giữa trống trơn, phí không gian ngang. CEO đã yêu cầu **2–3 cột** từ trước nhưng chưa làm hết.

## Yêu cầu (BẮT BUỘC, TOÀN APP)
- **PC (≥1024px): mọi khối danh sách/ranking xếp LƯỚI 2–3 CỘT** (không 1 cột full-width). Ưu tiên 3 cột nếu thẻ gọn, 2 cột nếu thẻ rộng.
- **Tablet (~768px): 2 cột.** **Mobile (≤640px): 1 cột** (hoặc 2 cột field ngắn theo `DIRECTIVE_CARD_LAYOUT.md`).
- Mỗi mục thành **thẻ gọn** (tên + dòng phụ + số) để 2–3 thẻ vừa 1 hàng; **số nằm sát nội dung**, không đẩy ra mép xa.
- Dùng **1 class lưới dùng chung** (VD `.list-grid` đã có ở Doanh thu/CST) → áp đồng bộ, sửa 1 nơi ăn mọi trang.

## LIỆT KÊ CÁC KHỐI PHẢI ĐA CỘT (không sót)
- **Phân tích:** `Đơn vị tăng mạnh`, `Đơn vị giảm mạnh`, `SP tăng mạnh`, `SP giảm mạnh`, `SP cần đẩy mạnh`, `SP sắp hết CST` → 2–3 cột.
- **Tổng quan:** Top 10 NV/ĐV/SP, các nhóm cảnh báo "Cần chú ý".
- **Doanh thu / DT đầy đủ:** ranking NV/ĐV/SP, danh sách chi tiết → grid thẻ 2–3 cột (thẻ theo `DIRECTIVE_CARD_LAYOUT.md`).
- **Sản phẩm, Cơ số thầu, Target:** danh sách card → 2–3 cột (nhiều trang đã có `.list-grid`, rà cho đủ; chỗ nào còn 1 cột thì sửa).
- Bất kỳ danh sách nào khác còn 1 cột trên PC → chuyển đa cột.

## H1 (CEO 2026-07-03): TÊN ĐƠN VỊ phải kèm MÃ SỐ đầy đủ
- Khối "Đơn vị tăng/giảm mạnh" (và mọi nơi hiện tên đơn vị) phải hiện **`mã.tên`** đầy đủ: VD **`001.BVĐK Đồng Nai`**, không phải "BVĐK Đồng Nai" trần. Nhất quán nguyên tắc *định danh đơn vị = mã ĐV*.

## Nghiệm thu (đối chiếu từng tab)
- Mở PC 1440/1920px: **không còn khối danh sách 1 cột full-width**; tất cả 2–3 cột, lấp đầy chiều ngang gọn đẹp.
- Tablet 2 cột, mobile 1 cột, không tràn/cắt.
- Rà **từng tab** (Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, CST, Target) và xác nhận đã đa cột — báo lại danh sách tab đã kiểm.

## Ghi chú (Claude soi thêm — không thuộc layout)
- Ảnh cho thấy **"Đơn vị tăng mạnh" đang hiện toàn số ÂM** (giảm) vì đang so **T07 (mới 2 ngày) với T06 (cả tháng)** → mọi ĐV đều "giảm". Đây là hệ quả kỳ-đang-chạy. Sẽ xử bằng: khối tăng/giảm của kỳ đang chạy nên so **cùng số ngày của kỳ trước** (T07 tới ngày N ↔ T06 tới ngày N), hoặc chỉ tính khi kỳ đã đủ. Ghi để bot xử cùng đợt kỳ-đang-chạy (không thuộc directive layout này nhưng liên quan).
