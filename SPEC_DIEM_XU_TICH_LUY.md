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
- **Mốc tính (CEO chốt 2026-07-09):** TUẦN = tính vào **Thứ 7 hàng tuần** (lũy kế đến hết Thứ 7 đó);
  THÁNG = tính vào **ngày cuối cùng của tháng** (lũy kế đến hết ngày đó). Điểm/xu là LŨY KẾ theo
  tháng/quý — báo cáo tuần là ảnh chụp tiến độ tính đến Thứ 7.

## 4c. Bố cục báo cáo (dự kiến — chờ bản mẫu cũ của CEO để bám format)
- **NV (email HTML + Telegram):** điểm DT (tuần/tháng/quý) · xu (tuần/tháng/quý) · thiếu/dư · tỷ lệ%
  · cảnh báo nếu tỷ lệ quý <90% (kèm ước tính truy thu) · gợi ý "cần thêm ~X xu để cân điểm".
- **CEO:** tổng công ty (điểm/xu/thiếu-dư/tỷ lệ) + bảng per-NV (sắp theo tỷ lệ tăng dần, người thiếu
  lên đầu) + phân tích gọn: số NV cảnh báo, tổng truy thu ước tính, ai cần nhắc.

## 4d. Nguồn XU — `vat.db` (bot xác nhận 2026-07-09)
- Máy KHÔNG có `sqlite3` CLI → đọc bằng Python/thư viện SQLite (app Node cần lib đọc SQLite).
- Bảng: **`vat_bills`**. Cột: `emp_code, emp_name, ngay, so_tien, tong_tien, trang_thai_hd, bill_kind, hidden_at`.
- **Query xu chuẩn:**
  ```sql
  SELECT emp_code, emp_name, COUNT(*) so_hd,
         SUM(COALESCE(NULLIF(tong_tien,0), so_tien)) tien_tinh_xu,
         SUM(COALESCE(NULLIF(tong_tien,0), so_tien))/500000.0*1.3 xu
  FROM vat_bills
  WHERE ngay BETWEEN :from AND :to
    AND trang_thai_hd='co_hd_vat' AND IFNULL(hidden_at,'')=''
  GROUP BY emp_code, emp_name;
  ```
- Nhớ LOẠI 5 NV ở mục 4 khỏi kết quả.

## 4e. KHUNG BÁO CÁO EMAIL (theo 2 mẫu CEO gửi — DN001 Tuần 26 & Tháng 06 V10)
Thiết kế: **theme DONAPHARM xanh lá** (#00493f header, #087565 nhấn), **logo cid:logo_dona** trái,
**QR cid:qr_zalo** phải, responsive; footer chữ ký CEO + hotline 0886.396.668. Lọc riêng theo emp_code.

**Báo cáo TUẦN (per NV) — các mục:**
1. Tổng quan kết quả (KPI card: Doanh thu +%, chênh lệch, số dòng, đơn vị, mặt hàng, nhà thầu — kèm so kỳ trước).
2. Điểm doanh thu & xu (bảng: Kỳ · DT · Điểm DT · Xu kỳ · Xu quý · Xu dư quý trước · Xu tổng quý · Thiếu · Dư · Hoàn thành quý %).
3. Phân tích tuyến CL/NCL/NT (bar % + bảng so cùng kỳ).
4. Biểu đồ doanh thu **theo ngày**.
5. Top đơn vị & Top mặt hàng (top ~8, kèm % tỷ trọng).
6. So sánh tăng/giảm so cùng kỳ (đơn vị tăng mạnh / đơn vị giảm; mặt hàng).
7. Tồn tại cần xử lý (bullet).
8. Kiến nghị hành động tuần tới (bảng: nhóm việc · khuyến nghị · thời hạn).

**Báo cáo THÁNG (per NV) — tương tự, nhấn:** Dashboard KPI (tỷ + đồng), cơ cấu tuyến, Top ĐV, ĐV giảm mạnh,
Mặt hàng giảm sâu, Top mặt hàng, **Điểm & xu** (Điểm tháng/quý, trạng thái DƯ/THIẾU pill, truy thu cá nhân,
analysis lũy kế quý), Nhận xét nhanh & hành động tháng sau.

**So sánh:** Tuần/Tháng đều so **CÙNG KỲ THÁNG TRƯỚC** (như mẫu: tuần T06 so T05, tháng T06 so T05).

**Nguồn dữ liệu (đã có trong App Report-New — chỉ scope theo emp_code):**
- Doanh thu/tuyến/top/so-sánh/theo-ngày: `analytics.js` (revenueBreakdown, comparePeriods, daily) + slot.
- Điểm: tự tính từ slot (hệ số 1/2). Xu: `vat.db` (mục 4d). → chỉ điểm/xu là mới, phần còn lại tái dùng.

**Báo cáo CEO:** bản tổng hợp toàn đội + phân tích gọn theo từng NV (KHÔNG phải bản chi tiết từng NV).

## 4f. Bàn giao code từ bot (nhánh `bot/diemxu-report-code`, commit 1f4dcfd)
- `handoff/diemxu-report-code/` — 3 script Python sinh email (tuần/tháng/CEO) + 2 template HTML DN001 +
  `docs/DATA_MAPPING_AND_FORMULAS.md` + `scripts/vat_xu_reader_better_sqlite3.js` (Node reader).
- Node server **v22.22.0** → App Report-New dùng **`node:sqlite` built-in** (khỏi cài native).
- Ảnh: `webapp_donapharm/public/logo_dona.png` + `qr_zalo_oa_dona.png` (hoặc dùng logo/QR sẵn của app mình).
- **ĐÃ BUILD:** `server/src/diemXu.js` — tính điểm (từ slot) + xu (vat.db), loại 5 NV. Công thức điểm ĐÃ
  kiểm chứng khớp file CEO (CL 109.242.000→2.1848; NCL→0.0230; ngoại lệ 025→×2).
- **2 điểm chờ CEO chốt:**
  1. **Carry xu quý trước:** KHÔNG có trong vat.db (trước lấy từ Excel). Tạm để **0**. Cần nguồn/bảng chốt
     số dư cuối quý nếu muốn cộng carry.
  2. **Loại trừ VP004:** danh sách cũ của bot (V10) có VP004 trong nhóm gửi; nhưng CEO chốt loại VP004.
     → Theo lệnh CEO: **loại**. (Ghi để CEO xác nhận nếu khác ý.)

## 5. Việc còn chờ
- [ ] Bot điều tra `vat.db`: tên bảng hóa đơn xu, cột (emp_code/ngày/số tiền tính xu/xu), cách lọc hợp lệ.
- [ ] CEO chốt lịch gửi cuối tuần (Chủ nhật/Thứ 7, giờ).
- [ ] Dựng BẢN MẪU (email HTML + Telegram) cho 1 NV + bản CEO → CEO duyệt.
- [ ] Lịch tự động cuối tuần sau khi duyệt.
