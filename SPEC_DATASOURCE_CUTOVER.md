# SPEC — Chuyển nguồn dữ liệu: Lumos → App Sale New (cutover 01/07/2026)

> Claude Code chốt thiết kế (CEO đề xuất 2026-07-02). Bot xác minh API App Sale + triển khai; Claude review.
> **Chỗ quan trọng nhất của hệ** — làm chặt theo đúng đây, không tắt bước đối chiếu.

## Bối cảnh
- App Report CŨ lấy doanh thu từ **Lumos** (01→05/2026 thật; 06/2026 tạm = Excel import, chờ Lumos final rồi thay + backup).
- CST (cơ số thầu còn lại) cũ lấy **trực tiếp từ Lumos** (V_TEMP_PHARMA allocation − SALES_REPORT).
- **Quyết định:** từ **07/2026**, App Report NEW **ngắt Lumos**, đồng bộ trực tiếp từ **App Sale New**.
  - Public: `https://appsaletest.donapharm.asia/` → proxy `127.0.0.1:3870` → Web `:5174` · **API `:3970`** (đang live, HTTP/2 200).

## Nguyên tắc tổng
- **Tách 2 bài toán:** DOANH THU (per-kỳ, đơn giản) vs CST (cộng dồn, phức tạp) — không gộp logic.
- **Đóng băng lịch sử = bất biến.** Kỳ đã chốt không bao giờ bị sync tương lai ghi đè.
- **Đối chiếu bắt buộc tại ngày cắt:** delta = 0 (giống cách nghiệm thu bug CST T06 = diff 0). Giữ song song 2 số vài kỳ (Tab Đối chiếu).

---

## A) DOANH THU — mô hình "đóng băng lịch sử + live tương lai"
1. **01–06/2026:** số Lumos đã chốt → import ra JSON tĩnh, **ĐÓNG BĂNG**, backup. Không cho nguồn live ghi đè các kỳ này.
   - **Điều kiện chốt T06:** chỉ đóng băng **SAU KHI** Lumos lên số T06 **chính thức** (thay bản Excel tạm) rồi mới backup. Không đóng băng lúc T06 còn tạm.
2. **Từ 07/2026:** kéo từ **App Sale API `:3970`** theo từng kỳ. Materialize mỗi tháng đã đóng thành JSON (như slot) để nhẹ + ổn định; tháng hiện tại query/refresh định kỳ.
3. **Ranh giới cứng:** cơ chế chọn nguồn theo kỳ đã có trong `store.js` (slot ghi đè kỳ tương ứng). Thêm nhãn nguồn mỗi kỳ (`lumos_frozen` | `appsale_live`) để audit; kỳ `lumos_frozen` **read-only**.

Rủi ro: thấp. Điểm cần chốt: định nghĩa **biên kỳ** (tháng dương lịch, giờ VN UTC+7) và cơ chế "khóa tháng khi đã chốt".

---

## B) CST (cơ số thầu còn lại) — baseline + trừ dần
CST = **allocation (cơ số trúng thầu) − lũy kế đã bán kênh đấu thầu (CL)**. Cộng dồn theo thời gian.
Mô hình: **snapshot baseline tại 01/07/2026** (chốt từ Lumos khi T06 đã final) + **trừ dần số bán từ App Sale từ 01/07 trở đi**. Tái dùng cơ chế `mergeLatestUploadIntoCst` (baseline + subtract) đã có.

### Snapshot baseline (chốt 1 lần, sau khi T06 Lumos final)
Mỗi dòng lưu tối thiểu: `iit_code`, `unit_code` (chuẩn hóa), `bid_package` (gói thầu/QĐ), `bid_qty_initial` (cơ số gốc), `sold_qty_to_2026-06-30` (lũy kế đã bán đến hết T06), `remain_qty_baseline = bid_qty_initial − sold_to_date`, `bid_price`, ngày chốt. → file `cst_baseline_2026-07-01.json`, backup, bất biến.

### Trừ dần từ App Sale (01/07 → nay)
`remain_qty(t) = remain_qty_baseline − Σ(net sold CL từ App Sale, khóa `iit+unit+gói`, 01/07 → t)`.

### 6 RỦI RO CHÍ MẠNG — phải xử lý hết trước khi cắt
1. **Khóa khớp 2 hệ (nguy hiểm nhất).** Baseline (Lumos) và số bán (App Sale) phải khớp `IIT_CODE + đơn vị (chuẩn hóa) + GÓI THẦU`. Đã dính lỗi format T06 ("002" vs "002.BVĐK…"). Nguồn khác hệ → rủi ro nhân đôi. **Bắt buộc bảng ánh xạ mã nếu 2 hệ đặt mã khác.**
2. **Chiều GÓI THẦU (QĐ139/141).** CST theo **từng gói**, không chỉ SP×đơn vị. Baseline giữ chiều gói; số bán App Sale phải biết trừ vào **gói nào**. App Sale không ghi gói → không trừ đúng cơ số.
3. **Chỉ kênh CL.** Chỉ bán đấu thầu mới rút cơ số. App Sale feed phải có **cờ kênh** để lọc (`route === 'CL'`).
4. **Nguồn ALLOCATION MỚI sau 01/07 (dễ sót).** Baseline chỉ giữ phần còn lại của gói đang có. **Gói trúng mới sau 01/07 / gói điều chỉnh** cần nguồn cấp allocation mới. Không có → CST chỉ giảm, không thêm gói mới. Phương án: App Sale quản lý gói thầu, **hoặc** admin upload allocation bổ sung định kỳ (tần suất thấp).
5. **Net (trả hàng/điều chỉnh).** Feed phải là **bán ròng** (trừ hàng trả/hủy), không phải bán gộp, nếu không CST tính hụt.
6. **Chống đếm trùng.** Mỗi giao dịch có **ID duy nhất ổn định**; App Report giữ **cursor "đã sync đến đâu"**; chạy lại **idempotent**, không cộng 2 lần.

### Nghiệm thu CST cutover
- Tại 01/07: CST theo baseline **khớp** số Lumos cuối (delta = 0), đối chiếu vài điểm.
- Sau vài kỳ: giữ song song baseline-derived ↔ (nếu còn) tham chiếu, diff trong ngưỡng.
- NV sale chỉ thấy CST của mình; không lộ đơn vị khác.

---

## C) KHẢO SÁT API App Sale (:3970) — brief cho bot chạy TRƯỚC KHI CẮT

### Đã chốt (CEO 2026-07-02)
- **Q4 = CÓ:** App Sale **quản lý gói thầu/allocation** → nguồn cấp cơ số mới sau 01/07 nằm ở App Sale. Không cần upload allocation thủ công.
- **Kiểu kéo = TIMELINE theo trạng thái thực:** App Report tiêu thụ **dòng sự kiện/timeline** (tạo/duyệt/xuất/trả/hủy…) có mốc thời gian + trạng thái, cập nhật theo trạng thái thật (không chỉ snapshot cuối ngày).

### Câu KIẾN TRÚC MỚI (quan trọng — quyết mô hình baseline)
**App Sale có nắm ĐỦ dữ liệu của gói thầu ĐANG CÓ (allocation gốc + lũy kế đã bán TRƯỚC 07/2026) không, hay chỉ có từ lúc App Sale go-live?**
- **Model B (App Sale sở hữu trọn):** nếu App Sale có allocation + toàn bộ lũy kế đã bán của cả gói cũ → CST = `allocation − sold` **đọc thẳng từ App Sale**, **KHÔNG cần baseline Lumos**. Gọn nhất.
- **Model A (neo baseline Lumos):** nếu App Sale chỉ có số **từ khi go-live** → giữ **snapshot Lumos 01/07 làm mốc còn-lại**, rồi **chỉ trừ số bán App Sale từ 01/07 trở đi** (cẩn thận **không trừ trùng** phần App Sale đã ghi trước 01/07).
→ Bot xác định App Sale thuộc Model nào; đây là yếu tố quyết định có cần baseline Lumos hay không.

### Checklist bot khảo sát trên API :3970 (chỉ ĐỌC, không ghi)
1. **Danh mục & khóa:** endpoint gói thầu/allocation; field mã **SP (iit_code) / đơn vị / gói thầu** — có **khớp Lumos** không? Nếu khác → dựng **bảng ánh xạ**.
2. **Allocation:** mỗi gói có `bid_qty_initial` (cơ số gốc), giá thầu, hiệu lực từ/đến; có **gói mới trúng** thêm được không? Có **lũy kế đã bán từ trước** (để xác định Model A/B) không?
3. **Bán / timeline:** endpoint dòng bán/sự kiện; mỗi bản ghi có **ID duy nhất ổn định**, **timestamp**, **trạng thái** (bán/trả/hủy), **cờ kênh (CL vs khác)**, và **thuộc gói thầu nào**.
4. **Incremental:** API lấy được **"thay đổi từ mốc X (thời gian/ID) đến nay"** (cursor/updated_since) để sync timeline, **idempotent** (chạy lại không cộng trùng).
5. **Net:** trả hàng/hủy thể hiện thế nào (bản ghi âm? đổi trạng thái?) để tính **bán ròng**.
6. **Kỳ/biên thời gian:** chốt tháng theo lịch dương + giờ VN; xác định cách "đóng" một kỳ.
7. **Auth nội bộ + tải:** cách xác thực gọi API server-to-server; phân trang; giới hạn tải khi kéo lịch sử lớn.

Bot trả kết quả (kèm mẫu JSON vài bản ghi mỗi loại) → Claude review, chốt **hợp đồng API** + Model A/B + thiết kế adapter.

## D) Thứ tự triển khai an toàn
1. Bot xác nhận 4 câu mục C (không code, chỉ khảo sát API).
2. Chốt hợp đồng API + bảng ánh xạ mã (nếu cần) → Claude review.
3. Viết adapter App Sale (env-gated, giống adapter ORDS) — **chưa cắt Lumos**, chạy SONG SONG để đối chiếu.
4. Chốt T06 Lumos final → đóng băng doanh thu 01–06 + snapshot CST baseline 01/07.
5. Đối chiếu delta=0 → **cắt Lumos**, bật App Sale làm nguồn chính từ 07/2026.
6. Giữ Tab Đối chiếu song song vài kỳ. Không đụng app cũ (dona-report 3860) & App Sale không bị ghi (chỉ đọc).
