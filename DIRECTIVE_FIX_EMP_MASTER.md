# DIRECTIVE — Sửa danh bạ NV + truy mã rác "#N/A" / "83"

> Claude Code giao (CEO phát hiện qua ảnh 2026-07-02). Bot triển khai TRÊN SERVER (danh bạ thật + data). Không đụng app cũ 3860. Giữ tổng doanh thu đã khớp (T06 = 28.403.136.096) — không làm lệch số.

## 1) THÊM 2 NV vào danh bạ (user master + auth để đăng nhập OTP)
| emp_code | Họ tên | SĐT | Email |
|---|---|---|---|
| `DN021` | Lê Anh Đức | 0906107109 | ducluatsu98@yahoo.com.vn |
| `VP004` | Trần Hoàng Trung | 0378970463 | *(chưa có)* |
- Cập nhật cả **danh bạ runtime trên server** (để card hiện tên thay vì mã trần, và cho phép đăng nhập OTP theo SĐT) và seed/`users.json` nếu phù hợp.
- **Role/scope:**
  - `DN021` = NV sale đang làm (CEO xác nhận) → role `sale`, status **Đang làm**, scope = emp_code của mình.
  - `VP004` = **CỘNG TÁC VIÊN** (CEO chốt 2026-07-02: chuyển qua làm cộng tác) → status **Cộng tác** (vẫn active, VẪN tính doanh thu như thường), scope = phần của mình (như sale). "Cộng tác" là active nên vẫn vào báo cáo/digest (regex active đã nhận `cong tac`).
  - **Target cho CTV:** chỉ tính % đạt / cảnh báo "chưa đạt target" khi CEO CÓ giao target cho VP004; nếu coi CTV không áp target cứng thì bỏ khỏi cảnh báo target (đừng để CTV hiện đỏ oan). Xác nhận với CEO nếu cần.
- 3 trạng thái NV chuẩn hóa: **Đang làm** (chính thức) · **Cộng tác** (CTV, active) · **Nghỉ việc** (loại khỏi target/forecast/cảnh báo/ranking). Dùng nhất quán ở tab Nhân viên + digest + smart.
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
