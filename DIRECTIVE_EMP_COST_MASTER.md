# DIRECTIVE TỔNG — Module "Chi phí của tôi" (App Report) — bản gộp cho bot đọc 1 lần

> Claude Code giao bot. Gộp toàn bộ yêu cầu module "Chi phí của tôi" (CEO chốt 2026-07-20) vào 1 file. Module lõi đã
> ship (`6781517`, review ĐẠT); đây là **bản tổng hợp + phần bổ sung** (Thành tiền, %, C44, bộ lọc kỳ, xem ngày,
> cách lấy đúng cột). Chi tiết rời vẫn còn ở: `SPEC_REPORT_EMP_COST_SELFVIEW.md`,
> `DIRECTIVE_EMP_COST_THANHTIEN.md`, `DIRECTIVE_EMP_COST_MONTH_FILTER.md`, `DIRECTIVE_EMP_COST_ACCESS_DAYVIEW.md`.

## 0. Mục tiêu
DataHub là CEO-only, NV không vào được → App Report mở trang **"Chi phí của tôi"** để **mỗi NV tự xem chi phí/hoa
hồng CỦA CHÍNH MÌNH** (self-scoped). Số **do DataHub quản (SSOT)**; App Report hiển thị + tính Thành tiền theo công
thức xác định (không bịa).

## 1. NGUYÊN TẮC BẤT DI DỊCH (không được phá)
1. **Khóa quyền ở backend:** NV sale chỉ thấy **của chính mình** (`auth.scopeOf` ép `emp` = mã phiên); CEO/ADMIN mới
   chọn NV. FE không tự lọc quyền.
2. **Không lộ số người khác / tổng payout / rule người khác.** Không đưa chi phí vào LLM/NLQ public. Audit mọi lượt.
3. **Token `x-assignment-key` chỉ ở backend/`.env`** — không bao giờ ra FE, không log token/response body.
4. **Số grounded** — không bịa; dòng không đủ dữ liệu → hiển thị `—`.
5. **Không hardcode PII/số/token** trong bundle FE.

## 2. LẤY DỮ LIỆU + CÁCH LẤY ĐÚNG CỘT (DataHub khóa C32–C47)
- Nguồn: endpoint dịch vụ **`GET /api/integrations/app-report/employee-cost?emp=<mã>&from=<YYYY-MM>&to=<YYYY-MM>`**,
  header `x-assignment-key: <token>`. Backend App Report gọi server-to-server; FE gọi `/api/employee-cost` bằng
  session token của user.
- **‼ DataHub khóa C32–C47.** KHÔNG phá khóa, KHÔNG đọc cột khóa trực tiếp. **Endpoint dịch vụ là cửa hợp lệ DUY
  NHẤT:** DataHub **whitelist đúng các cột CEO chỉ định (trong C33–C46)**, self-scoped theo NV, **khóa cứng
  `C32`(tổng) + `C47`(đầu ra)**. Bot **chỉ lấy qua endpoint**, không lách, không dò cột.
- Bot cần **DataHub xác nhận danh sách cột endpoint trả** (key + nhãn) để App Report render đúng.
- **Phòng vệ 2 lớp:** backend + FE vẫn tự loại `c32/c47`, chỉ nhận `c33–c46`, strip field lạ, kiểm `empCode` (đã có).
- **Xử lý lỗi:** 401 (sai key) → báo rỗng chung, không lộ token; 400 (thiếu emp) → không xảy ra vì ép emp; 502/timeout
  → retry backoff rồi rỗng; mọi lỗi → `{columns:[],rows:[],note:"chưa có dữ liệu chi phí kỳ này"}`.

## 3. RESPONSE + RENDER ĐỘNG
- Response: `{ empCode, columns:[{key,label,...}], rows:[{c5,c7,c16,c25, c36,c41,...}] }`.
- **Render bảng ĐỘNG theo `columns[]`** — KHÔNG hardcode key. `columns[]` chỉ là các cột **% động**; cột chiều
  `c5(Quản lý)/c7(Đơn vị)/c16(Sản phẩm)/c25(ĐVT)` nằm trong `row` → App Report **tự đưa 4 cột chiều lên trước**,
  tránh trùng.
- **Hiển thị cột %:** hiện **đúng số, BỎ ký hiệu `%`**: `8,0%`→`8.0` · `0,3%`→`0.3` · `10,0%`→`10.0`.

## 4. THÀNH TIỀN (App Report TỰ TÍNH — DataHub không mở thêm cột)
- **‼ PHÂN VAI (CEO làm rõ 2026-07-21):** **DataHub CHỈ cung cấp `% chi phí`, KHÔNG cung cấp doanh thu.** **Doanh
  thu do App Report tự lấy** (dữ liệu App Report). ⇒ "lấy số T07 thật" nghĩa là App Report cần **mức % của T07 từ
  DataHub**, còn doanh thu T07 App Report đã có sẵn. DataHub không đụng doanh thu.
- **‼ RULE mức % theo tháng:** mỗi NV/sản phẩm có **1 mức % cho mỗi THÁNG**; biến động trong tháng → áp **từ ngày
  đầu tháng** (cả tháng dùng 1 mức, KHÔNG chia lẻ giữa tháng). ⇒ Thành tiền theo ngày = `doanh thu ngày × %(tháng)`
  — App Report đã tính đúng vậy, **không đổi**.
- **‼ % là TIMELINE, danh sách dòng do App Report dẫn dắt (CEO xác nhận 2026-07-21 — xem `DIRECTIVE_EMP_COST_TIMELINE_REDESIGN.md`):**
  % chi phí là cấu hình **thường trực dạng timeline** theo mã hàng (hiệu lực từ ngày-đầu-tháng, carry qua tháng tới
  khi đổi) — **KHÔNG** sinh từ `sales_facts`. **Danh sách dòng lấy từ doanh thu App Report** (mã hàng NV bán trong
  tháng), rồi **tra % từ DataHub timeline**. ⇒ **T07 hiện được dù DataHub chưa nạp sales_facts T07.** (Sửa lại cách
  hiểu cũ "lấy dòng theo sales_facts → T07=0".)
- **`Thành tiền(dòng, cột%) = doanh thu dòng × % ÷ 100`.** Ví dụ doanh thu 10.000.000đ: `8.0`→800.000đ · `0.3`→
  30.000đ · `10.0`→1.000.000đ.
- **"Doanh thu dòng"** = doanh thu đúng dòng (NV × đơn vị × sản phẩm × kỳ), App Report **tự lấy từ dữ liệu doanh thu
  sẵn có** (`report_rows`/analytics), ghép theo **đơn vị `c7` + sản phẩm `c16`** (tên→mã qua `catalog`, khớp theo MÃ).
  Không khớp → Thành tiền dòng = `—` (không đoán). Tỉ lệ khớp < 90% → **báo Claude/CEO**, không hiển thị số sai.
- Mỗi cột % → **1 cột Thành tiền** (tiền VN `đ`, phân cách nghìn). **% KHÔNG cộng dồn; Thành tiền ĐƯỢC tổng** (trừ
  cột cuối năm §5).
- **Tổng chi phí tháng** = Σ Thành tiền các cột, **TRỪ cột cuối năm**.

## 5. CỘT "CUỐI NĂM" (mặc định `c44`)
- `c44` thanh toán **CUỐI NĂM (T12)**, **KHÔNG** tính vào chi phí **hàng tháng**.
- Vẫn hiện Thành tiền theo dòng nhưng **LÀM MỜ** (opacity ~0.5, in nghiêng) + **badge "cuối năm ⏳"** ở header.
- **KHÔNG cộng vào "Tổng chi phí tháng"** (nhãn tổng ghi "chưa gồm khoản cuối năm"). Thêm **1 dòng riêng**: "Khoản
  cuối năm (tạm tính · chi trả T12): [Σ c44] đ" + **chú thích chân bảng**.
- Tập cột cuối năm **cấu hình được** (mặc định `{c44}`), không rải hardcode.

## 6. BỘ LỌC KỲ (Từ tháng → Đến tháng) — CEO chốt (C)
- FE: ô **"Từ tháng" / "Đến tháng"** (`MM/YYYY`, mặc định tháng hiện tại). Chọn 1 tháng hoặc khoảng.
- Backend truyền `from`/`to` (`YYYY-MM`) xuống DataHub. **DataHub cần nhận thêm tham số kỳ** (thêm THAM SỐ LỌC,
  không phải thêm cột) — bot phối hợp phiên DataHub; App Report build sẵn phần lọc.
- **Nhiều tháng = (C):** **tách từng tháng** (mỗi tháng 1 khối + "Tổng chi phí tháng" riêng) **+ 1 dòng "Tổng cả
  kỳ"** cuối trang. `c44` **không** vào tổng tháng lẫn tổng kỳ (luôn tách).
- **1 tháng** → hiển thị bình thường.

## 7. XEM THEO NGÀY (NV bấm để xổ)
- Trong 1 tháng, NV bấm → **chi tiết theo ngày**: `Thành tiền ngày = doanh thu ngày × %(của tháng) ÷ 100`.
- `%` là tỉ lệ THÁNG (không đổi theo ngày); dùng **doanh thu theo ngày** (`report_rows.date`). **Σ ngày = Thành tiền
  tháng** (phải khớp). Ngày không khớp doanh thu → `—`. `c44` theo ngày vẫn mờ + không vào tổng tháng.

## 8. LẤY THỬ THỰC TẾ T07/2026 (bot chạy trên server — Claude KHÔNG có quyền dữ liệu thật)
- Bot gọi endpoint **thật** cho **T07/2026**, vài NV mẫu, tính Thành tiền, dựng bảng.
- **Dán kết quả** (ẩn danh nếu cần): vài dòng (đơn vị · SP · % dạng `8.0` · doanh thu dòng · Thành tiền) · **Tổng
  chi phí tháng T07** (đã trừ c44) · cột c44 mờ + dòng "khoản cuối năm" · **tỉ lệ dòng khớp doanh thu**.

## 9. NGHIỆM THU (trước khi push main)
1. NV chỉ thấy của mình (thử `?emp=` khác → vẫn của mình); CEO/ADMIN chọn được NV.
2. Chỉ hiện cột endpoint công bố; **C32/C47 không bao giờ xuất hiện**.
3. Cột % hiện `8.0`/`0.3`/`10.0` (không `%`). Thành tiền = doanh thu dòng × %÷100 (đối chiếu tay 1 dòng).
4. Tổng chi phí tháng KHÔNG gồm `c44`; `c44` mờ + badge + dòng "khoản cuối năm" + chú thích.
5. Nhiều tháng: tách từng tháng + **"Tổng cả kỳ"**. Bấm 1 tháng → xổ theo ngày; **Σ ngày = tháng**.
6. Dòng không khớp doanh thu → `—`; tỉ lệ khớp < 90% → báo, không hiển thị số sai.
7. Sai/tắt token → "chưa có dữ liệu", không lộ lỗi/token. `grep` bundle FE: không token, không số chi phí tĩnh.
8. Desktop bám mẫu Phân tích; mobile bảng cuộn ngang. Test cũ vẫn PASS + test mới (lọc kỳ / ngày / thành tiền / c44).
9. **Lấy thử THẬT T07 dán kết quả.** Ghi CHANGELOG; commit + push main; báo Claude review.
