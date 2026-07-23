# DIRECTIVE — ĐIỀU TRA App VAT: cách tính ĐIỂM doanh thu + XU chi tiêu tích lũy (để KHÔNG tái phát minh)

> Claude Code giao Report Bot (bot biết App VAT). **CEO chốt:** điểm/xu đã có sẵn ở **App VAT** → điều tra & lấy đúng
> công thức, KHÔNG tự chế. Đây là **bước tìm hiểu (read-only)** để thiết kế KPI điểm/xu/phạt cho App Report sau.

## 1. MỤC TIÊU — tìm & báo cáo chính xác 3 thứ từ App VAT
1. **Cách tính ĐIỂM DOANH THU:** công thức/tỷ lệ điểm ← doanh thu (vd 1 điểm / X đồng?), có hệ số theo nhóm hàng/kỳ
   không, làm tròn thế nào, theo kỳ nào (tháng/quý).
2. **Cách tính XU CHI TIÊU TÍCH LŨY:** "xu" là gì (ngân sách chi tiêu/marketing của NV? điểm quy đổi?), **tích lũy theo
   tháng/quý ra sao**, có **target/ngưỡng** không, reset đầu quý hay cộng dồn.
3. **Điểm tích hợp (QUAN TRỌNG):** App VAT có **API/endpoint expose điểm & xu THEO TỪNG NV** không? (để DataHub/App Report
   ĐỌC lại, không tự tính). Nếu có: đường dẫn · tham số · auth · shape dữ liệu · self-scope.

## 2. BÁO CÁO (đưa Claude + CEO để thiết kế)
- Công thức **điểm** (chính xác, kèm ví dụ số).
- Công thức **xu tích lũy** + target/ngưỡng quý.
- **Nguồn số là ai (SSOT):** App VAT tự tính & expose, hay chỉ có công thức (ai đó phải tính lại)?
- Có sẵn API per-NV không → quyết định luồng đọc.

## 3. RANH GIỚI KIẾN TRÚC (giữ chặt — để bước sau không sai tiền)
- **App Report KHÔNG dựng engine điểm/xu/phạt.** SSOT của điểm/xu = **App VAT** (nếu App VAT tính & expose) — DataHub/App
  Report **đọc lại**. Phần **PHẠT + cấn trừ vào chi phí** (mới) sẽ do **DataHub tính** (dựa trên xu từ App VAT), App Report
  **chỉ hiển thị + cảnh báo**. Không để 2 nơi tính ra 2 số khác nhau rồi trừ sai tiền NV.
- Chỉ **điều tra + báo cáo** đợt này — CHƯA code KPI, CHƯA đụng chi phí.

## 4. SAU KHI CÓ BÁO CÁO
- Claude soạn: (a) **task DataHub** (engine phạt + mở rộng contract employee-cost thêm điểm/xu/phạt/cấn-trừ, đọc xu từ App
  VAT) + (b) **task App Report** (3 KPI điểm/xu/phạt + dòng "cấn trừ do chưa đạt xu" + cảnh báo, 100% số từ backend).
