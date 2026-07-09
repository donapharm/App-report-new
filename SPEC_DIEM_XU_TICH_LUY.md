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
         SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0)) tien_tinh_xu,
         SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0))/500000.0*1.3 xu
  FROM vat_bills
  WHERE date(ngay) BETWEEN date(:from) AND date(:to)
    AND IFNULL(hidden_at,'')=''
  GROUP BY emp_code, emp_name;
  ```
- **‼ CHƯA khoá `trang_thai_hd`** cho tới khi Finance xác nhận — hiện chỉ lọc `hidden_at` rỗng (đã áp
  trong `diemXu.js`). Khi Finance chốt trạng thái hợp lệ thì thêm điều kiện `trang_thai_hd=...`.
- Nhớ LOẠI 5 NV ở mục 4 khỏi kết quả. → Đã hiện thực trong `server/src/diemXu.js#readVatXu`.

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

## 4g. PHÂN TÍCH THÔNG MINH & ĐỊNH HƯỚNG (CEO yêu cầu 2026-07-09) — mục mới trong báo cáo NV
Mục tiêu: giúp NV "định hướng bán hàng thông minh nhất để tăng doanh số". Mỗi báo cáo NV có block
**"Phân tích thông minh & Định hướng"** tự sinh từ dữ liệu:
- **A. Xu hướng bản thân:** tháng này vs **tháng liền trước** (%); vs **trung bình tháng của QUÝ TRƯỚC**
  (%) → kết luận "đang tăng tốc / chững lại / dưới mặt bằng quý trước".
- **B. Vị thế trong đội:** thứ hạng doanh thu + %target (không lộ số của NV khác).
- **C. Cơ cấu tuyến & cơ hội điểm:** tỷ trọng CL/NCL/NT; nếu lệch NCL thường → gợi ý đẩy **CL/NT (điểm ×2)**
  để vừa tăng doanh thu vừa tăng điểm.
- **D. Khách hàng (đơn vị):** đơn vị "ngủ" (mua quý trước, tháng này = 0 → đánh thức); đơn vị tụt mạnh;
  rủi ro tập trung (1 ĐV > 30% doanh thu).
- **E. Sản phẩm:** SP chủ lực đang giảm; **cơ hội cross-sell** = SP đội bán mạnh nhưng NV này chưa/ít.
- **F. Điểm/xu:** tỷ lệ quý, cần thêm bao nhiêu xu, nhắc nộp hóa đơn.
- **G. Định hướng hành động (3–5 gạch đầu dòng CỤ THỂ):** tổng hợp A–F thành việc ưu tiên tuần/tháng tới.
- **H. DỰ BÁO cuối tháng theo nhịp hiện tại (CEO 2026-07-09):** `dự báo = doanh thu tới nay / (ngày đã trôi /
  ngày trong tháng)` (dùng `A.targetPacingMeta`). So target → "theo nhịp này cuối tháng đạt ~X, đủ/thiếu Y".
- **I. KHUYẾN NGHỊ KHAI THÁC để đạt target (CEO 2026-07-09):**
  - **Mã QLNB còn dư cơ số thầu** (từ CST) tại đơn vị NV phụ trách → liệt kê mã còn khai thác được (ưu tiên
    còn nhiều).
  - **Đơn vị khối CL** (điểm ×2, có cơ số thầu) còn quota → đẩy để vừa doanh thu vừa điểm cao.
  - **⭐ Khối NCL — DƯ ĐỊA KHÔNG GIỚI HẠN** vì **không phụ thuộc cơ số thầu** → nhấn mạnh mở rộng NCL để
    tăng doanh số tự do (đơn vị/SP NCL tiềm năng, đơn vị NCL đang bỏ trống).
Các số so sánh: **tháng liền trước** + **trung bình quý trước** (mốc do CEO chốt).

## 4a-bis. ‼ VAI TRÒ NGƯỜI NHẬN (CEO nhắc 2026-07-09 — GHI NHỚ)
- **CEO = tài khoản QUẢN TRỊ** (role `ceo`/`admin` — xem `auth.normRole`). Nhận **bản CEO tổng hợp toàn đội**.
  Email CEO `trungdangxuan@gmail.com` map vào **tài khoản quản trị**, **KHÔNG phải DN001**.
- **DN001…DN0xx / VP0xx = NV THƯỜNG.** Mỗi NV nhận **bản riêng của mình**. (DN001 chỉ được dùng làm **mẫu test**.)
- Suy ra: `nv_emails.json` cần map email theo từng NV; email CEO gắn với mã tài khoản quản trị (không nhét vào DN001).

## 4h. ✅ CEO ĐÃ DUYỆT 2 BẢN MẪU (2026-07-09) — CHỐT LAYOUT
CEO duyệt **cả bản TUẦN và bản THÁNG** của DN001 (bản "thông minh" có mục 9). Hai điểm sửa cuối
đã áp dụng và **khoá lại**:
1. **BỎ câu "toàn công ty đang dư xu"** (câu cũ: *"Toàn công ty Q2 đang dư 944,87 xu, không kết luận
   phạt theo tổng từ thiếu/dư cá nhân."*). Lý do CEO: tránh NV ỷ lại, tưởng công ty không cần chi tiêu xu.
   → Báo cáo CHỈ nói trạng thái xu của **riêng từng NV**, không đưa số dư/thiếu toàn công ty vào bản NV.
2. **Bản TUẦN cũng có mục 9 "Phân tích thông minh"** (giống bản tháng, chỉnh cho nhịp tuần: A xu hướng
   tuần, H dự báo cuối tháng, C cơ cấu tuyến, I khai thác NCL/CL/QLNB, D–E khách hàng & mặt hàng, G việc tuần tới).
3. Thêm dòng nhắc **"Xu chỉ tính theo QUÝ — sang quý mới tự reset về 0, không chuyển tiếp"** ở phần Nguồn dữ liệu.

**Template chuẩn đã duyệt (bot render dữ liệu live vào):**
- `reference/diemxu_templates/APPROVED_tuan_DN001.html` — layout TUẦN (giữ `cid:logo_dona`/`cid:qr_zalo`).
- `reference/diemxu_templates/APPROVED_thang_DN001.html` — layout THÁNG (đã bỏ câu dư xu).
→ Đây là **bố cục CHUẨN**; bot chỉ thay số/bảng bằng dữ liệu thật per emp_code, giữ nguyên cấu trúc & theme.

## 5. Việc còn chờ / TRIỂN KHAI (bot) — sau khi CEO duyệt 2026-07-09
- [x] Bot điều tra `vat.db` (bảng `vat_bills`, cột — xong, xem 4d).
- [x] CEO chốt lịch gửi (Thứ 7 13h00 tuần · ngày cuối tháng 18h30 tháng — xem 4b).
- [x] Dựng BẢN MẪU (tuần + tháng) DN001 → **CEO ĐÃ DUYỆT** (xem 4h).
- [ ] **BOT DỰNG `server/src/salesReport.js`**: sinh email HTML tuần/tháng per NV theo 2 template ở 4h,
      render dữ liệu live từ `analytics.js` (doanh thu/tuyến/top/so-cùng-kỳ/theo-ngày) + `diemXu.js`
      (điểm/xu) + mục 9 phân tích thông minh (A–I, mục 4g). Lọc riêng theo emp_code, **loại 5 NV** (mục 4).
- [ ] **Bản CEO tổng hợp**: toàn đội + phân tích gọn per-NV (mục 4c). Có thể tái dùng `ceoDigestHtml`.
- [ ] **Lịch tự động**: worker gắn cron — Thứ 7 13h00 (tuần), daily 18h30 chỉ gửi nếu là ngày cuối tháng.
      Gửi qua **Telegram + email** (dùng `notifyChannels.deliver`), CID logo/QR như email target.
- [ ] Chạy **bản mẫu thật DN001 trên server** (số live) → CEO duyệt lần cuối trước khi bật gửi cả đội.
- Xem `DIRECTIVE_SALES_REPORT.md` để biết chi tiết đầu việc bot.
