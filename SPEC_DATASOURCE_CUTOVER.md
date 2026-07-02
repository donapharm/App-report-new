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
> **‼ ĐÍNH CHÍNH 2026-07-02 (CEO kèm ảnh):** doanh thu App Report có **2 NGUỒN = CRM MISA (chính, đã xuất HĐ) + APP WEB nội bộ (đối tác, đã xuất/giao)**, KHÔNG chỉ App Sale WEB (:3970). Khảo sát trước sót MISA nên tưởng "T07 chỉ 2 đơn"; thực tế 125 đơn, ~2,67 tỷ đã thực hiện tính đến 02/07. **"Doanh thu thực (đã thực hiện) = MISA xuất HĐ + WEB đã giao"** (loại chưa xuất HĐ/chưa phản hồi/còn nợ/HOLD/hủy). Chi tiết + việc điều tra lại: `DIRECTIVE_ENABLE_JULY_REVENUE.md`.
> **CEO DUYỆT TRIỂN KHAI 2026-07-02:** bot làm **đồng bộ doanh thu từ 01/07/2026** (GỘP 2 nguồn, không chỉ shadow). 4 điều BẮT BUỘC đúng:
> 1. **Crosswalk `emp_code` là SỐNG CÒN** — phân quyền NV sale lọc theo `emp_code`; App Sale mã NV khác → NV thấy sai/trống dữ liệu mình. Map người bán App Sale ↔ `emp_code` App Report trước.
> 2. **Liên tục xuyên kỳ cắt** — cùng BV/SP ở T06 (Lumos) và T07 (App Sale) phải về cùng thực thể (dùng chung crosswalk CST), nếu không biểu đồ/drill-down tách đôi.
> 3. **VAT** — App Report tính `revenueBeforeVat = revenue / VAT_DIVISOR`. Xác nhận field doanh thu App Sale **trước hay sau VAT** (sai → lệch cả loạt 8–10%).
> 4. **Kênh + net** — doanh thu báo cáo = tổng kênh (CL+NCL+NT) hay chỉ CL? tính theo **net trạng thái** (đã duyệt/giao/xuất HĐ, loại hủy) như rule CST.
> Kỳ 07/2026+ materialize như slot (per-ky) trong `store.js`; 01–06 Lumos vẫn đóng băng.

1. **01–06/2026:** số Lumos đã chốt → import ra JSON tĩnh, **ĐÓNG BĂNG**, backup. Không cho nguồn live ghi đè các kỳ này.
   - **Điều kiện chốt T06:** chỉ đóng băng **SAU KHI** Lumos lên số T06 **chính thức** (thay bản Excel tạm) rồi mới backup. Không đóng băng lúc T06 còn tạm.
2. **Từ 07/2026:** kéo từ **2 nguồn App Sale ecosystem** theo từng kỳ: CRM MISA snapshot/read-model (`misa_revenue_snapshot_lines`, đã xuất HĐ) + APP WEB đối tác đã giao thực (`partner_order_line_responses`). Materialize mỗi tháng đã đóng thành JSON (như slot) để nhẹ + ổn định; tháng hiện tại refresh định kỳ. Không dùng WEB ordered làm doanh thu thực. **PA-A WEB Partner:** chỉ tính đơn/dòng đối tác thuộc kỳ đơn đặt + đã giao trong kỳ; đơn chuyển kỳ/còn nợ theo app cũ không cộng vào doanh thu kỳ sau (trace T07 loại `DT-260630-0115`, `1.960.000đ`).
3. **Ranh giới cứng:** cơ chế chọn nguồn theo kỳ đã có trong `store.js` (slot ghi đè kỳ tương ứng). Thêm nhãn nguồn mỗi kỳ (`lumos_frozen` | `misa_plus_appweb_live`) để audit; kỳ `lumos_frozen` **read-only**.

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

## E) KẾT QUẢ KHẢO SÁT API (bot 2026-07-02) + QUYẾT ĐỊNH KIẾN TRÚC
> Nguồn: `artifacts/appsale_api_cutover_survey_20260702.md`. Khảo sát read-only, không ghi, không cắt Lumos.

### Chốt Model = **A** (neo baseline Lumos) — *đính chính tên gọi*
Bot ghi "Model B" nhưng mô tả ("chưa thay được Lumos lịch sử; không thấy lũy kế bán đầy đủ trước 07/2026") = đúng **Model A** theo định nghĩa spec này. **Kết luận: App Sale CHƯA thay được Lumos cho lịch sử → GIỮ baseline Lumos, App Sale chỉ trừ dần từ 01/07.** (Không phải đọc thẳng bỏ Lumos.)

### Điểm chặn (blocker) phải xử lý trước
1. **Mã CHƯA khớp — bắt buộc crosswalk.** SP 371(AppSale)/318(Lumos), ĐV 195/108, gói thầu lẫn format (`QĐ139`,`139`,`03`,`QĐ799`). → **Chỉ dựng crosswalk trong PHẠM VI KÊNH CL** (App Sale gồm cả NCL/NT nên nhiều hơn); lọc route=CL rồi kiểm bộ CL có ánh xạ 1:1 về 108 ĐV / 318 SP Lumos. Chuẩn hóa mã gói (`QĐ139`≡`139`).
2. **Định nghĩa "net" bằng TRẠNG THÁI** (chưa có return âm rõ). Chốt: chỉ tính đơn/dòng ở trạng thái **đã duyệt/đã giao/đã xuất hóa đơn** (approved/delivered/invoiced); loại `CANCELLED` + `approval_status=rejected`.
   - **Trả hàng sau giao (CEO xác nhận 2026-07-02: CÓ nhưng ~0,01%):** KHÔNG xây cơ chế hoàn cơ số phức tạp bây giờ. Xử 3 lớp: (a) net theo trạng thái như trên; (b) **RE-ANCHOR mỗi kỳ đóng sổ** — CST lấy lại theo snapshot chuẩn (`cst_con_lai_import` App Sale hoặc Lumos) thay vì trừ dồn vô hạn → sai số 0,01% tự triệt tiêu, không tích lũy; (c) để sẵn **hook**: nếu App Sale sau này ghi dòng trả hàng → map thành hoàn cơ số dương, không phải sửa kiến trúc. Đây là lý do Model A (baseline + re-anchor) an toàn hơn trừ-dồn thuần.
3. **Chưa có API incremental chính thức.** Cần App Sale bổ sung endpoint read-only **`/api/report-sync/changes?updated_since=<ts|id>`** (idempotent, phân trang) + **service token server-to-server riêng**. Hiện `/orders/manage` max 50, `/products` max 100 → kéo lịch sử theo page, không ồ ạt.

### Điểm THUẬN LỢI phát hiện thêm
- App Sale đã có sẵn cột CST: `cst_chinh, cst_30, cst_ban_dau_import, cst_con_lai_import, da_giao, dang_cho_giao`. **`cst_ban_dau_import`/`cst_con_lai_import` nghi là baseline import từ Lumos.** → **Việc cần làm:** đối chiếu `cst_con_lai_import` (App Sale) ↔ CST còn lại (Lumos/App Report). Nếu KHỚP → App Sale có thể **tự host baseline**, App Report đọc baseline + timeline từ một nguồn App Sale (gọn hơn, vẫn là Model A về bản chất).
- Bán/timeline đủ chất: ID duy nhất (`orders.id/code`, `order_items.id`), timestamp (`created_at/updated_at`, `order_status_events`), trạng thái, **cờ kênh `route=CL/NCL/NT`**, nối gói qua `unit_offerings.goi_code`. → Đủ dựng adapter incremental theo `updated_at`.

### Việc tiếp cho bot (không cắt Lumos)
1. Dựng **crosswalk CL-scope** (SP/ĐV/gói) + báo tỉ lệ khớp; liệt kê phần lệch để xử tay.
2. Đối chiếu **`cst_con_lai_import` App Sale ↔ CST Lumos** vài chục dòng → xác định có host baseline ở App Sale được không.
3. Đề xuất **contract `/api/report-sync/changes`** (field trả về, phân trang, filter route=CL, updated_since) + service token → Claude review trước khi App Sale code.
4. Viết **adapter read-only chạy SHADOW** (song song, chỉ đối chiếu, chưa thay nguồn).

## F) QUYẾT ĐỊNH CROSSWALK CL (Claude chốt 2026-07-02) — bot làm theo
> Sau bước 1 (bot): khớp **99,6%** (2731/2741) với rule "gói từ QĐ trong mã QLNB trước, fallback goi_code". **Duyệt rule này** (goi_code mù chỉ 82,1% → KHÔNG dùng trực tiếp).
> Nguyên tắc chung: **crosswalk là BẢNG ÁNH XẠ TƯỜNG MINH** (`crosswalk_units.json`, `crosswalk_products.json`, `crosswalk_bidpkg.json`: AppSale key ↔ Lumos key), KHÔNG dựa chuẩn hóa chuỗi 3-số lúc chạy (chính thứ gây bug T06 + đụng `107`). Chuẩn hóa chuỗi chỉ dùng để DỰNG bảng, không dùng làm khóa runtime.

1. **`001.BVĐK Đồng Nai` + `...KHU C` → GỘP CHUNG vào `001` (CEO CHỐT 2026-07-02: cùng 1 bệnh viện, khác khu, CST thầu TRỪ CHUNG).** Xử lý 226 "trùng": **CỘNG** `bid_qty_initial` + `sold_qty` của 2 dòng thành 1 baseline key (KHÔNG "bỏ qua vì trùng"), tính lại `remain_qty`/`remain_pct`/`remain_amount` trên số gộp. Kiểm 3–5 mẫu số gộp khớp app cũ (nghiệm thu). Adapter App Sale cũng cộng chung offering của cả 2 khu vào key `001`.
2. **Prefix `107` đụng 2 đơn vị KHÁC nhau → KHÔNG map bằng 3 số.** Trong bảng ánh xạ đơn vị tường minh, tách 2 đơn vị này về đúng 2 Lumos key riêng (xử tay, ghi rõ trong `crosswalk_units.json`). Rà thêm mọi prefix khác có nguy cơ đụng tương tự.
3. **10 key Lumos-only:** bot **phân loại theo hiệu lực** (`hd_den_ngay`/nguồn): (a) **hết hạn** → giữ baseline tĩnh, không cần App Sale trừ, OK; (b) **còn hiệu lực** → phải map hoặc đánh dấu GAP + liệt kê cho CEO (nếu không map, các gói này sẽ "đóng băng" không trừ được). Không bỏ lặng.
4. **44 key App-only:** đây là **gói mới App Sale quản lý** (đúng mô hình App Sale sở hữu allocation). Đưa vào làm **dòng CST mới** NẾU có `cst_ban_dau_import`/allocation hợp lệ; thiếu allocation → giữ lại, không tạo dòng rỗng.

**Sau 4 bước:** mục tiêu match ≈ 100% (2741 Lumos + 44 gói mới App Sale) → mới viết **adapter SHADOW** (đối chiếu, chưa cắt Lumos). Bot báo lại tỉ lệ sau khi dọn + danh sách còn lệch (nếu có) để Claude review.

## G) SAU MỤC F — Claude review 2026-07-02: BẬT ĐÈN XANH ADAPTER SHADOW
> Bot xong F: crosswalk tường minh (`artifacts/cutover_f/crosswalk_units|products|bidpkg.json`), match **99,64%** (2731/2741), tách `107` → `107_DUC_HUE`/`107_TAN_THANH`, KHU C gộp `001`. **Duyệt.**

**Quyết định 55 dòng lệch (KHÔNG chặn shadow):**
1. **9 Lumos-only chưa rõ hiệu lực** (cst_real.json thiếu `hd_den_ngay`): **giữ STATIC**. An toàn tuyệt đối vì các dòng này KHÔNG có trong App Sale → không có giao dịch trừ vào → đứng yên. → đưa vào **worklist tổ thầu** xác nhận còn hiệu lực (rảnh làm). 1 dòng thiếu IIT: giữ static.
2. **45 App-only thiếu allocation**: **HOLD** (không tạo CST rỗng). Doanh thu các SP này VẪN tính khi bán; CST chỉ hiện sau khi tổ thầu nhập allocation vào App Sale. → **worklist tổ thầu** nhập cơ số.
3. Gộp lại: 2 nhóm trên = **1 việc của tổ thầu — rà master gói thầu/allocation App Sale cho đủ** (song song, không cản shadow). Cutover ĐẦY ĐỦ chỉ sau khi worklist sạch + shadow delta đạt.

**Việc tiếp — bot làm (vẫn read-only, chưa cắt Lumos):**
1. **Adapter SHADOW CST:** đọc App Sale CL timeline (net theo trạng thái) → áp crosswalk tường minh → cộng chung KHU C về `001` → tính remain → **đối chiếu vs baseline hiện tại**, báo bảng delta (kỳ 06 phải ≈ khớp; mô phỏng 07 nếu có dữ liệu). CHƯA thay nguồn.
2. **Crosswalk `emp_code`** (chưa làm, cần cho DOANH THU + phân quyền): map người bán App Sale ↔ `emp_code` App Report. Đây là chốt chặn cho sync doanh thu 07 (mục A điểm 1).
3. Xuất **2 worklist** cho tổ thầu (9 Lumos-only + 45 App-only) kèm tên SP/đơn vị/gói để CEO chuyển tổ thầu rà.
4. Đề xuất **contract `/api/report-sync/changes?updated_since=`** + service token → Claude review trước khi App Sale code.

## D) Thứ tự triển khai an toàn
1. Bot xác nhận 4 câu mục C (không code, chỉ khảo sát API).
2. Chốt hợp đồng API + bảng ánh xạ mã (nếu cần) → Claude review.
3. Viết adapter App Sale (env-gated, giống adapter ORDS) — **chưa cắt Lumos**, chạy SONG SONG để đối chiếu.
4. Chốt T06 Lumos final → đóng băng doanh thu 01–06 + snapshot CST baseline 01/07.
5. Đối chiếu delta=0 → **cắt Lumos**, bật App Sale làm nguồn chính từ 07/2026.
6. Giữ Tab Đối chiếu song song vài kỳ. Không đụng app cũ (dona-report 3860) & App Sale không bị ghi (chỉ đọc).
