# DIRECTIVE — Bật đồng bộ DOANH THU tháng 07/2026 (2 NGUỒN: CRM MISA + APP WEB)

> Claude Code giao (CEO đính chính 2026-07-02 kèm ảnh "Đối chiếu doanh thu đa chiều"). Bot triển khai; Claude review.
> Nguyên tắc: 01–06/2026 Lumos ĐÓNG BĂNG; chỉ THÊM kỳ 07.2026. Không cắt Lumos, không sửa số cũ.

## ‼ ĐÍNH CHÍNH QUAN TRỌNG — doanh thu có 2 NGUỒN, khảo sát trước SÓT 1
Bot báo "T07 chỉ 2 đơn" vì **chỉ soi APP WEB (:3970)** và đếm đơn đã duyệt (~0). **SAI — thiếu nguồn CRM MISA.**
Ảnh CEO (báo cáo "CRM MISA — Đối chiếu doanh thu" trong app Đặt hàng cũ, snapshot 20:29 02/07/2026):

| Nguồn | Tổng đặt | Đã thực hiện |
|---|---:|---:|
| **CRM MISA** (xuất HĐ) | 2.600.259.136 | **2.118.313.496** |
| **Đối tác/APP WEB nội bộ** (đã xuất/giao) | 575.264.200 | **550.673.600** |
| **TỔNG** | **3.175.523.336** | **2.668.987.096** |

- **Doanh thu App Report = TỔNG 2 nguồn: CRM MISA + APP WEB.** Không được chỉ lấy WEB.
- 125 đơn CRM+WEB (không phải 2). MISA là phần lớn (~80%).

## ĐỊNH NGHĨA "doanh thu thực" (net) — ĐÃ RÕ từ báo cáo cũ
**Đã thực hiện = CRM MISA đã XUẤT HÓA ĐƠN + APP WEB đã XUẤT/GIAO HÀNG.**
- KHÔNG tính: CRM chưa xuất HĐ, đối tác chưa phản hồi, còn nợ chưa giao, đơn HOLD/hủy/pending.
- Đây là con số doanh thu App Report nên phản ánh cho kỳ 07 (≈ 2.668.987.096đ tính đến 20:29 02/07 — dùng để đối chiếu khi bật).

## Bước 1 — ĐIỀU TRA LẠI 2 NGUỒN (read-only) → báo Claude
1. **CRM MISA:** cơ chế "Chụp snapshot MISA → DB" trong app Đặt hàng cũ lấy dữ liệu ở đâu, bảng/endpoint nào, field doanh thu (đã xuất HĐ), mã NV/đơn vị/SP, kỳ. Đọc code báo cáo "CRM MISA — Đối chiếu doanh thu đa chiều" của app cũ để nắm ĐÚNG công thức (tổng đặt vs đã thực hiện vs chưa thực hiện).
2. **APP WEB (:3970):** phần "Đối tác — đã xuất/giao hàng" (không chỉ đơn approved-like như lần trước).
3. **VAT:** cả 2 nguồn — số trước hay sau VAT? Khớp định nghĩa App Report (`revenueBeforeVat = revenue / VAT_DIVISOR`).
4. **Nhất quán 01–06:** xác nhận định nghĩa "doanh thu" của kỳ 07 (đã thực hiện = MISA xuất HĐ + WEB giao) **trùng khớp cách 01–06 đã tính** (Lumos) để đường xu hướng liền mạch, không gãy định nghĩa giữa T06 và T07.

## Bước 2 — Adapter doanh thu LIVE kỳ 07.2026 (gộp 2 nguồn)
- Kéo **CRM MISA (đã xuất HĐ) + APP WEB (đã xuất/giao)** từ `2026-07-01`, áp crosswalk (emp_code/đơn vị/SP) → tổng hợp kỳ `07.2026`, materialize như slot trong `store.js`.
- Thêm `07.2026` vào `listPeriods` (bộ lọc + biểu đồ xu hướng có mốc T07).
- Dedup/idempotent: đơn có thể có ở cả CRM và WEB → theo logic báo cáo cũ để KHÔNG cộng trùng.
- Mã lạ → "Chưa phân bổ", không bịa.

## Bước 3 — Nghiệm thu trước khi bật
- **01–06 KHÔNG đổi** (T06 = 28.403.136.096).
- Kỳ 07 "đã thực hiện" **khớp báo cáo đối chiếu cũ** (≈ 2.668.987.096đ tại mốc 02/07 20:29; số tăng theo ngày). Đối chiếu vài đơn từng nguồn.
- Scope đúng; đầu tháng số lớn dần là bình thường.
- Chạy SHADOW đối chiếu rồi mới hiển thị chính thức. CHANGELOG + báo Claude.

## ‼ MISMATCH cần TRUY NGAY — WEB dư 1.960.000đ (CEO test 2026-07-02 23:42)
CEO đồng bộ lại app cũ lúc **23:42** (snapshot #27, official) → WEB **vẫn 550.673.600đ** (không đổi so 20:29). **Bác bỏ** giả thuyết "phát sinh sau snapshot". Vậy chênh là THẬT:
- App cũ WEB "đã xuất giao" = **550.673.600đ** (32 đơn, **SL giao THỰC × đơn giá**); loại "còn nợ chưa giao" = 24.590.600đ (1 đơn, còn thiếu sau phản hồi) sang "chưa thực hiện".
- App Report WEB = **552.633.600đ** → **DƯ 1.960.000đ**.
**Bot làm (đúng nguyên tắc mismatch — dừng, truy, không ép số):**
1. **Truy đúng đơn/dòng** tạo ra 1.960.000đ chênh trong phần WEB (đối chiếu từng đơn App Report ↔ app cũ).
2. **Kiểm định nghĩa:** Bot đã dùng `delivered_qty × price` (SL giao thực) — đúng. NHƯNG bot có **33 đơn** partner còn app cũ "đã giao" chỉ **32 đơn** → chênh đúng **1 đơn = 1,96tr**, khả năng cao là **đơn giao MỘT PHẦN** mà app cũ xếp trọn vào **"còn nợ chưa giao" (24,59tr)**. Truy đúng đơn đó (mã đơn, delivered_qty, còn nợ).
   - **CHÍNH SÁCH ghi nhận — CEO CHỐT 2026-07-02: PHƯƠNG ÁN A (khớp app cũ 100%).** Đơn giao DỞ DANG → **KHÔNG tính phần đã giao**, xếp trọn đơn vào "còn nợ chưa giao" như app cũ. Chỉ đơn giao **ĐỦ** mới vào "đã thực hiện". → Bot loại phần đã-giao của (các) đơn dở khỏi partner "đã giao" → T07 = **2.668.987.096đ** tại cùng snapshot. Áp cho MỌI kỳ sau, không chỉ T07.
3. **Sửa cho khớp định nghĩa app cũ:** "đối tác đã thực hiện = SL giao thực × đơn giá", loại hủy/cancel + loại còn-nợ-chưa-giao.
4. **Nghiệm thu:** tại CÙNG snapshot, App Report T07 phải = **2.668.987.096đ** (WEB = 550.673.600, MISA = 2.118.313.496). Nếu vẫn lệch → báo rõ đơn nào + lý do, KHÔNG ép số.
5. Ghi artifact trace + CHANGELOG → Claude review.

## ❓ CẦN BOT LÀM RÕ (Claude review 2026-07-03) — quy tắc gán KỲ
Bot fix T07 khớp app cũ (2.668.987.096) bằng cách **loại đơn `DT-260630-0115/WEB:2188` vì "tạo 30/06, giao 01/07"**. Nhưng lý do này giống **quy tắc theo NGÀY ĐẶT** (đơn đặt 30/6 → thuộc T06), KHÁC với PA-A (đơn giao dở). Số khớp nhưng **quy tắc phải rõ vì áp mọi kỳ**:
1. **Quy tắc gán kỳ CHÍNH XÁC là gì?** Doanh thu 1 đơn thuộc kỳ theo **ngày ĐẶT** hay **ngày GIAO/xuất HĐ**? App cũ dùng cái nào? (Phải replicate ĐÚNG app cũ.)
2. **Đơn `DT-260630-0115` có bị MẤT không?** Nếu gán theo ngày đặt → nó thuộc T06; nhưng T06 = Lumos đóng băng (không có đơn WEB này) → đơn có bị rơi vào khe không tính cả T06 lẫn T07 không? Nếu có → phải xử (ghi nhận đúng kỳ).
3. Ghi **quy tắc gán kỳ** thành spec rõ (order-date vs delivery-date) để tháng 8+ không lệch.
→ Bot trả lời + đối chiếu 2–3 đơn giáp ranh cuối/đầu tháng. Không ép số.

## ✅ BOT TRẢ LỜI 2026-07-03 — quy tắc gán kỳ đã chốt để App Report New replicate app cũ
1. **Quy tắc gán kỳ chính xác:**
   - **CRM MISA:** gán kỳ theo `revenue_date`/ngày xuất hóa đơn trong snapshot MISA; chỉ tính bucket đã xuất/đã thực hiện (`official`, `pending` theo read-model đã xác nhận).
   - **APP WEB Partner:** replicate app cũ theo **kỳ đơn đặt (`orders.created_at`, giờ VN)**, sau đó mới xét trạng thái thực hiện: chỉ dòng/đơn đã phản hồi giao đủ trong cùng phạm vi báo cáo mới vào “đã thực hiện”; đơn còn nợ/chưa giao/HOLD/hủy không cộng vào doanh thu đã thực hiện.
   - Vì vậy, đơn đặt cuối tháng trước nhưng phản hồi/giao sang tháng sau **không được kéo sang kỳ sau** chỉ vì `responded_at` nằm tháng sau.
2. **Đơn `DT-260630-0115/WEB:2188` có bị mất không?**
   - Trong App Sale DB: **không mất**; trace còn nguyên (`created_at=2026-06-30`, `responded_at=2026-07-01`, `delivered_value=1.960.000đ`).
   - Trong **App Report New T07**: cố ý **không tính**, để khớp app cũ WEB T07 `550.673.600đ` / 32 đơn.
   - Với doanh thu lịch sử **T06 App Report New đang đóng băng từ Lumos** theo directive “01–06 không sửa”, dòng chuyển kỳ này không được tự ý cộng ngược vào T06. Nếu CEO muốn báo cáo “full App Sale WEB từ trước 07”, phải mở một **transition/carryover adjustment** riêng và được duyệt, không cộng lặng vào T07.
3. **Spec cho tháng 08+ / sau này:**
   - Từ T07 trở đi, materializer Partner dùng **month(order.created_at Asia/Bangkok) = kỳ báo cáo** + trạng thái giao đủ/đã thực hiện; không dùng riêng `responded_at` để kéo doanh thu sang kỳ sau.
   - Các dòng phản hồi sau kỳ nhưng đơn thuộc kỳ cũ phải nằm trong audit/carryover hoặc refresh kỳ đặt hàng nếu kỳ đó còn mở; kỳ đã khóa thì chỉ điều chỉnh bằng adjustment có duyệt.
   - Không ép số: nếu app cũ có ngoại lệ khác, phải trace order/dòng + nguồn trước khi đổi rule.

## Lưu ý
- **Đây là bài học:** nguồn doanh thu App Report GỒM CRM MISA (chính) + APP WEB (đối tác). Mọi thiết kế cutover phải tính CẢ HAI (cập nhật lại `SPEC_DATASOURCE_CUTOVER` nếu cần).
- **Độ tươi 2 nguồn khác nhau:** MISA = snapshot (cần chụp lại), WEB = live → App Report nên hiện "cập nhật đến HH:MM" và cân nhắc tự chụp MISA định kỳ. Nhưng ĐỊNH NGHĨA phải khớp app cũ trước đã.
- CST tháng 07 theo nhánh riêng. Không đụng app cũ 3860; chỉ ĐỌC.
