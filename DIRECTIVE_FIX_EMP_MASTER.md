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
| emp_code | Họ tên | SĐT | Email |
|---|---|---|---|
| `DN021` | Lê Anh Đức | 0906107109 | ducluatsu98@yahoo.com.vn |
| `DN022` | *(chờ CEO/lấy từ data)* | 0908858073 | toandv202@gmail.com |
| `DN023` | *(chờ CEO/lấy từ data)* | 0977790789 | ctyhiepphat1819@gmail.com |
| `VP004` | Trần Hoàng Trung | 0378970463 | *(chưa có)* |
> `DN022`/`DN023`: SĐT+email đã có; **tên chưa có** — bot thử lấy từ danh bạ/dữ liệu gốc (raw_nv), nếu không có thì để tạm mã, chờ CEO cấp tên. Vẫn thêm để đăng nhập OTP theo SĐT được.
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

## Nghiệm thu
- Card Target hiện **tên** DN021 (Lê Anh Đức) + VP004 (Trần Hoàng Trung), không còn mã trần.
- 2 NV đăng nhập OTP được theo SĐT; scope đúng phần mình.
- `#N/A`/`83` không còn trong dropdown NV; doanh thu các dòng đó được remap đúng chủ hoặc gom "Chưa phân bổ"; **tổng kỳ không đổi**.
