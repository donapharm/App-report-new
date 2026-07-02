# DIRECTIVE — Sửa danh bạ NV + truy mã rác "#N/A" / "83"

> Claude Code giao (CEO phát hiện qua ảnh 2026-07-02). Bot triển khai TRÊN SERVER (danh bạ thật + data). Không đụng app cũ 3860. Giữ tổng doanh thu đã khớp (T06 = 28.403.136.096) — không làm lệch số.

## ⛔ QUY TẮC BẢO MẬT — KHÓA GỬI RA cho 4 CTV ngoài (CEO chốt 2026-07-02, BẮT BUỘC)
**Tuyệt đối KHÔNG tự động gửi RA** (email / Zalo / Telegram digest / bất kỳ thông báo chủ động nào) về **đạt/thiếu target** hay **nhắc thông tin liên quan** cho 4 CTV: **`DN021`, `DN022`, `DN023`, `VP004`**.
- Mặc định các mã này có cờ **`no_auto_notify = true`** → **scheduler digest BỎ QUA**, mọi luồng gửi khen thưởng/nhắc target **BỎ QUA**.
- **Chỉ gửi khi CEO YÊU CẦU cụ thể + có DUYỆT trước** (không có lệnh CEO thì không gửi, kể cả bản tin sáng).
- Họ **VẪN đăng nhập xem dữ liệu của mình** (pull) bình thường — chỉ chặn **đẩy ra chủ động** (push). Phân biệt: kéo/xem = OK; tự gửi ra = KHÓA.
- Áp dụng ở: `telegram-bot.js` (digest), mọi tính năng gửi Zalo/Email tương lai. Đây là guardrail cứng, không được nới nếu không có lệnh CEO.

## 0) DANH SÁCH CỘNG TÁC VIÊN (CTV) SALE — CEO chốt 2026-07-02
6 mã sau = **CTV sale**: `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004`.
- Status = **Cộng tác** (active), role `sale`, scope = phần của mình.
- **CTV tính ĐẦY ĐỦ như sale chính thức** (CEO chốt 2026-07-02: CTV CÓ giao target): VẪN tính doanh thu, **target, % đạt, cảnh báo "chưa đạt", ranking** — giống "Đang làm". Khác duy nhất là **nhãn trạng thái "Cộng tác"** (phân loại nhân sự). KHÔNG loại CTV khỏi bất kỳ báo cáo/cảnh báo nào.
- Bot **kiểm mã nào đã có trong danh bạ** → chỉ đổi status sang "Cộng tác"; **mã nào thiếu** → thêm mới (cần tên + SĐT để đăng nhập OTP).
- Đã có thông tin: `DN021` (Lê Anh Đức), `VP004` (Trần Hoàng Trung) — mục 1.
- **CẦN CEO cấp thông tin nếu chưa có trong danh bạ:** `DN022`, `DN023` (tên + SĐT + email); xác nhận `DN002`, `DN004` đã có tên đúng.

## 1) THÊM/ĐỐI CHIẾU NV trong danh bạ (user master + auth để đăng nhập OTP)
| emp_code | Họ tên | SĐT | Email | Ghi chú |
|---|---|---|---|---|
| `DN002` | Nguyễn Thị Hằng Nga | 0933739452 | nga.dn002@donapharm.vn | đã có trong data; cập nhật SĐT/email + status Cộng tác |
| `DN004` | Bùi Hoàng Ngọc Quyên | 0906516094 | quyen.dn004@donapharm.vn | đã có; **SĐT gốc CEO ghi `906516094` (9 số) → dùng `0906516094`**; status Cộng tác |
| `DN021` | Lê Anh Đức | 0906107109 | ducluatsu98@yahoo.com.vn | thêm mới; ⛔ no_auto_notify |
| `DN022` | *(chờ CEO/lấy từ data)* | 0908858073 | toandv202@gmail.com | thêm mới; ⛔ no_auto_notify |
| `DN023` | *(chờ CEO/lấy từ data)* | 0977790789 | ctyhiepphat1819@gmail.com | thêm mới; ⛔ no_auto_notify |
| `VP004` | Trần Hoàng Trung | 0378970463 | *(chưa có)* | thêm mới; ⛔ no_auto_notify |
> - `DN002`/`DN004`: email nội bộ `@donapharm.vn` → **KHÔNG dính khóa gửi tự động** (guardrail chỉ áp 4 CTV ngoài DN021/022/023/VP004). Nhận bản tin/thông báo bình thường.
> - `DN004`: SĐT CEO ghi thiếu số 0 đầu → chuẩn hóa `0906516094` (kiểm lại trước khi bật OTP).
> - `DN022`/`DN023`: SĐT+email đã có; **tên chưa có** — bot thử lấy từ danh bạ/dữ liệu gốc (raw_nv), không có thì để tạm mã, chờ CEO cấp tên. Vẫn thêm để đăng nhập OTP theo SĐT.
- Cập nhật cả **danh bạ runtime trên server** (để card hiện tên thay vì mã trần, và cho phép đăng nhập OTP theo SĐT) và seed/`users.json` nếu phù hợp.
- **Role/scope:**
  - `DN021` = NV sale đang làm (CEO xác nhận) → role `sale`, status **Đang làm**, scope = emp_code của mình.
  - `VP004` = **CỘNG TÁC VIÊN** (CEO chốt: chuyển qua làm cộng tác) → status **Cộng tác**, tính đầy đủ như sale (doanh thu + target + cảnh báo), scope phần mình.
- 3 trạng thái NV chuẩn hóa: **Đang làm** (chính thức) · **Cộng tác** (CTV — active, tính ĐẦY ĐỦ như sale gồm target/cảnh báo/ranking) · **Nghỉ việc** (loại khỏi target/forecast/cảnh báo/ranking). Cộng tác chỉ khác Đang làm ở NHÃN; Nghỉ việc mới bị loại. Dùng nhất quán ở tab Nhân viên + digest + smart.
- `DN021`/`VP004` trước đó là "App Sale-only / inactive" trong crosswalk emp_code — cập nhật lại crosswalk cho khớp (hết blocker phân quyền 07 cho 2 mã này).

## 2) TRUY mã rác "#N/A" và "83" trong bộ lọc/dữ liệu NV
Xuất hiện ở dropdown lọc NV + card Target (`#N/A`: Đạt 2tr/target 0; `83`: cần xác minh).
**Các bước (read-only trước, báo cáo, rồi mới sửa):**
1. **Truy nguồn:** `#N/A` và `83` nằm ở slot/kỳ nào, bao nhiêu dòng, tổng tiền/SL, kèm đơn vị + sản phẩm + `raw_nv` gốc của các dòng đó. (Giả thuyết: `#N/A` = lỗi Excel dò mã NV; `83` = mã thô `raw_nv` chưa map sang mã DN.)
2. **Tìm chủ đúng:** dựa đơn vị/khách hàng + `raw_nv` để suy ra NV phụ trách thật → **remap** về đúng `emp_code`.
3. **Giữ tổng nguyên:** remap KHÔNG được đổi tổng doanh thu kỳ (T06 vẫn 28.403.136.096). Nếu 1 dòng thật sự vô chủ → gộp vào nhóm **"Chưa phân bổ"** hiển thị rõ, KHÔNG xóa lặng, KHÔNG làm tròn.
4. **Chặn tái diễn:** bộ lọc NV chỉ liệt kê `emp_code` hợp lệ (mẫu `DN###`/`VP###`); mã không hợp lệ (`#N/A`, số trần như `83`) đưa vào "Chưa phân bổ" để CEO thấy, không lẫn vào danh sách NV thật.
5. Xuất `artifacts/emp_junk_trace_<date>.md` (nguồn + dòng + đề xuất remap) → Claude review trước khi remap chính thức.

## 3) REVIEW REMAP mã rác (Claude chốt 2026-07-02 sau khi đọc `emp_junk_trace_20260702.md`)
- **`83` → remap `DN021`** (10 dòng CST): đều Valesto, cùng gói **QĐ48/2026 SYT Cà Mau**, vùng Cà Mau-Bạc Liêu (ĐV 188–197); 1 dòng đã `sales_emps=DN021`. Kết luận: cả gói vùng này của DN021. **Chờ CEO xác nhận DN021 phụ trách Cà Mau-Bạc Liêu** rồi remap toàn bộ 10 dòng. Giữ nguyên bid_qty/sold/amount, chỉ đổi chủ.
- **`#N/A` → tìm chủ ĐV `033.NT-PKĐK AN LONG KHÁNH`**: bot dò NV nào có doanh thu KHÁC tại ĐV 033 → remap dòng 1.575.000đ về NV đó. Nếu 033 không NV nào phụ trách rõ → giữ "Chưa phân bổ", CEO gán tay. (Chỉ 1 dòng nhỏ, không gấp.)
- Sau remap: **tổng T06 vẫn 28.403.136.096**; nhóm "Chưa phân bổ" chỉ còn dòng thật sự vô chủ (lý tưởng = rỗng).

## 4) VIỆC CÒN LẠI — bot làm PASS 2 (directive đã cập nhật sau commit b701dec)
Commit `b701dec` mới thêm DN021/VP004 theo bản directive CŨ. Cần làm nốt theo bản MỚI:
- ⚠ **Sửa status `DN021` → "Cộng tác"** (không phải "Đang làm") — DN021 nằm trong danh sách 6 CTV (mục 0).
- **Thêm/đổi status 4 mã còn lại:** `DN002`, `DN004` (đổi status Cộng tác + cập nhật SĐT/email mục 1), `DN022`, `DN023` (thêm mới, SĐT/email mục 1, tên chờ).
- **Áp cờ `no_auto_notify=true`** cho **DN021/DN022/DN023/VP004** (guardrail đầu file). DN002/DN004 KHÔNG áp (email nội bộ).
- Xác nhận cả 6 CTV: role `sale`, active, **có target → tính đầy đủ** (target/%đạt/cảnh báo/ranking).

## Nghiệm thu
- Card Target hiện **tên** DN021 (Lê Anh Đức) + VP004 (Trần Hoàng Trung), không còn mã trần.
- 2 NV đăng nhập OTP được theo SĐT; scope đúng phần mình.
- `#N/A`/`83` không còn trong dropdown NV; doanh thu các dòng đó được remap đúng chủ hoặc gom "Chưa phân bổ"; **tổng kỳ không đổi**.
