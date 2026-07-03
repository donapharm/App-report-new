# DIRECTIVE — Target: cắm chốt tại App Report (bỏ Lumos từ 07) + KPI dễ hiểu + ô Tổng

> Claude Code giao (CEO 2026-07-03). Bot triển khai; Claude review. Không đụng app cũ 3860.

## A) TỪ 07/2026: TARGET CHỐT TẠI APP REPORT — KHÔNG đồng bộ Lumos/app khác (CEO chốt)
- **Kỳ ≥ 07.2026:** target CHỈ từ nguồn tạo trong App Report: `manual > upload > ai`. **BỎ `legacy`(Lumos) và `appsale`** khỏi resolver cho kỳ ≥ 07.
- **Kỳ ≤ 06.2026:** GIỮ `legacy`(Lumos) làm target lịch sử thật (để %đạt quá khứ đúng).
- **Bỏ nhãn "tham khảo tự động Lumos kỳ 06.2026"** trên thẻ kỳ 07+. KHÔNG mượn target tháng 6 cho tháng 7.
- Kỳ ≥ 07 **chưa giao target** → thẻ hiện **"Chưa giao target"** (không hiện số mượn, không tính %đạt sai). CEO nhập tay/file/AI thì mới có.

## B) Ô KPI TỪNG NV — bố cục DỄ HIỂU (bỏ % nhịp trần gây rối)
Thay "272,2% / target đã chia nhịp" bằng:
```
<Họ tên> · <mã · loại>
Target tháng:   <target cả tháng đầy đủ>         ← số chính
Đã đạt:         <đạt> ( <% so target CẢ THÁNG> ) ← trực giác
Vượt/Thiếu:     <± số> ( <±%> )                  ← so target cả tháng
────
Nhịp đến ngày N/D:  mốc cần <prorated>đ · đã đạt <đạt>đ → <ĐANG VƯỢT/ĐÚNG/CHẬM> NHỊP
```
- **Vòng tròn = % so target CẢ THÁNG** (VD 26%), KHÔNG phải % nhịp. Màu: ≥100% xanh, 80–99% vàng, <80% đỏ (theo target tháng).
- **"Nhịp"** chỉ là **dòng phụ có nhãn rõ** cho kỳ đang chạy (đầu tháng đạt thấp là bình thường; nhịp cho biết đang nhanh/chậm). Không để số nhịp thành % chính.
- Kỳ đã đóng (≤06): không có "nhịp", chỉ đạt/target/vượt-thiếu.

## C) Ô KPI TỔNG (đầu trang Target) — CEO muốn thấy tổng
Thêm dải KPI trên cùng trang Target (theo scope: CEO toàn đội; NV = của mình):
- **Tổng target kỳ:** Σ target (cả tháng) của các NV trong danh sách.
- **Tổng đã đạt:** Σ đạt.
- **Vượt/Thiếu tổng:** ± số ( ±% so tổng target ).
- (Kỳ đang chạy có thể thêm dòng nhỏ "nhịp đến ngày N/D".)
- **‼ Ô KPI Tổng phải SỐNG (CEO nhấn 2026-07-03):** khi CEO **sửa tay / upload / áp AI** target 1 NV → ô Tổng (Σ target, Σ đạt, vượt/thiếu số&%) **cập nhật NGAY**. Tổng luôn **tính lại từ danh sách target hiện hành đã resolve** (không cache số cũ): sau khi lưu 1 thay đổi → re-fetch hoặc tính lại phía client trên dữ liệu mới → Tổng nhảy theo tức thì. Kiểm: sửa target 1 NV +X đồng → Σ target tăng đúng +X ngay.

## Nghiệm thu
- Kỳ 07+: không còn số target Lumos; chưa giao → "Chưa giao target"; nhập tay/file/AI thì hiện đúng.
- Thẻ NV: số chính = đạt / target CẢ THÁNG + vượt/thiếu (số & %); nhịp là dòng phụ rõ nghĩa; NV đọc hiểu ngay.
- Có ô KPI Tổng (target/đạt/vượt-thiếu số&%). Scope đúng. Số kế toán VN đầy đủ. Build OK.
