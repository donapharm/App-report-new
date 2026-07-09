# SPEC — Báo cáo ĐIỂM DOANH THU & XU TÍCH LŨY (tuần/tháng/quý)

> Trạng thái: ĐANG THU THẬP YÊU CẦU (chưa build). Nguồn gốc: file App VAT
> `Bao_cao_diem_doanh_thu_va_xu_tich_luy_T07_Q3_2026_den_20260709.xlsx` (CEO gửi 2026-07-09).
> **Bắt buộc gửi BẢN MẪU cho CEO duyệt trước khi bật gửi thật.**

## 1. Mục tiêu
Cuối tuần gửi báo cáo **điểm doanh thu + xu tích lũy** (tháng + quý):
- **Riêng cho từng NV** (điểm/xu của chính họ, thiếu/dư, tỷ lệ, cảnh báo).
- **Tổng hợp cho CEO** (toàn đội).
- Kênh: **Telegram + Email** (tài khoản đã cấu hình: telegram_map + nv_emails.json).

## 2. Nguồn dữ liệu (đã xác định trong file — sheet Nguon_KiemTra)
- **Doanh thu → điểm:** LẤY TỪ APP MÌNH — slot `server/data/uploads/rev_2src_*.json` (App Report-New).
  KHÔNG đi lấy doanh thu ở app khác (App VAT trước đây lấy DT từ App Report cũ; giờ mình đã có).
- **Xu:** LẤY TỪ APP VAT — **SQLite** `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db`
  (bảng hóa đơn VAT: mã NV, ngày, số tiền tính xu, trạng thái `co_hd_vat`, loại `vat_invoice`).
  → Chỉ vào VAT để lấy XU; điểm doanh thu tự tính từ slot app mình.

## 3. Công thức (sheet NguyenTac_Q3 — áp dụng từ T05/2026)
- **Điểm dòng = doanh thu dòng × hệ số / 100.000.000**
  - Hệ số **2**: tuyến **CL**, **NT**, và **NCL ngoại lệ** (mã đơn vị 025/026/027/028).
  - Hệ số **1**: **NCL thường**.
- **Xu dòng = số tiền tính xu / 500.000 × 1,3** (hóa đơn hợp lệ).
- **Tổng xu quý** = xu T07+T08+T09 + xu dư quý trước (carry, nếu có số chốt).
- **Thiếu/Dư = Tổng xu − Điểm doanh thu** (dương=dư, âm=thiếu). **Tỷ lệ = Xu / Điểm.**
- **Cảnh báo/phạt:** tỷ lệ quý < 90% → cảnh báo cá nhân; mỗi **2 điểm thiếu = truy thu 600.000đ**.
  (CEO xét toàn công ty thì dùng tổng toàn công ty, không nhầm với thiếu/dư từng người.)

## 4. ‼ DANH SÁCH LOẠI TRỪ (CEO chốt 2026-07-09) — TUYỆT ĐỐI GHI NHỚ
Các NV sau **KHÔNG** đưa vào tính điểm, **KHÔNG** tính xu, **KHÔNG** hiện trong báo cáo điểm/xu:
- **DN021, DN022, DN023, VP004, VP018**

(Lưu ý phân biệt: danh sách "không nhận thông báo target" trước đây là DN021/DN023/VP004 — khác mục đích.
Riêng báo cáo điểm/xu này loại đủ 5 mã trên.)

## 4b. Lịch gửi (CEO chốt 2026-07-09) — giờ VN
- **Báo cáo TUẦN:** **Thứ 7, 13h00** (Telegram + email).
- **Báo cáo THÁNG:** **ngày cuối cùng của tháng, 18h30** (Telegram + email).
- **NV:** gửi bản riêng của từng NV (tuần + tháng).
- **CEO:** gửi bản tập trung tổng hợp, có **phân tích gọn theo từng NV**.
- (Kỹ thuật: monthly chạy daily 18h30, nếu là ngày cuối tháng thì gửi.)

## 4c. Bố cục báo cáo (dự kiến — chờ bản mẫu cũ của CEO để bám format)
- **NV (email HTML + Telegram):** điểm DT (tuần/tháng/quý) · xu (tuần/tháng/quý) · thiếu/dư · tỷ lệ%
  · cảnh báo nếu tỷ lệ quý <90% (kèm ước tính truy thu) · gợi ý "cần thêm ~X xu để cân điểm".
- **CEO:** tổng công ty (điểm/xu/thiếu-dư/tỷ lệ) + bảng per-NV (sắp theo tỷ lệ tăng dần, người thiếu
  lên đầu) + phân tích gọn: số NV cảnh báo, tổng truy thu ước tính, ai cần nhắc.

## 5. Việc còn chờ
- [ ] Bot điều tra `vat.db`: tên bảng hóa đơn xu, cột (emp_code/ngày/số tiền tính xu/xu), cách lọc hợp lệ.
- [ ] CEO chốt lịch gửi cuối tuần (Chủ nhật/Thứ 7, giờ).
- [ ] Dựng BẢN MẪU (email HTML + Telegram) cho 1 NV + bản CEO → CEO duyệt.
- [ ] Lịch tự động cuối tuần sau khi duyệt.
