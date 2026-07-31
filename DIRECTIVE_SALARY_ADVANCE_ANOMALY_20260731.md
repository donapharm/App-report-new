# DIRECTIVE KHẨN — Ứng lần 1 BẤT THƯỜNG (DN006) + chặn ship "còn lại" (CEO phát hiện 2026-07-31)

CEO xem DN006: **Ứng lần 1 = 598.978.982đ** nhưng **Tổng chi phí tháng sau phạt = 459.441.306đ**. Ứng **lớn hơn** tổng nhận ~139,5 triệu ⇒ sai logic (ứng không thể vượt số kiếm được). So sánh: DN009 ứng ≈18% tổng (hợp lý) · DN006 ứng ≈130% tổng (bất thường).

## VIỆC A — TRUY NGUỒN số ứng DN006 (làm trước, chặn VIỆC 2)

Gọi thẳng App Salary `first-advance?period=2026-07&emp_code=DN006` và trả lời **3 câu**:
1. **598.978.982 là gì?** Ứng của **đúng 1 lần (lần 1)** trong **đúng kỳ 07/2026** cho **đúng DN006**? Hay là **cộng dồn nhiều lần / lũy kế quý-năm / nhầm mã**?
2. **Ứng lần 1 được tính/khấu trừ trên CƠ SỞ nào?** — chi phí THÁNG, hay quý/năm, hay doanh thu? (Quyết định xem "còn lại = tháng − ứng" có đúng phép không.)
3. Đối chiếu vài NV (DN006 vs DN009 vs 1–2 mã nữa): tỷ lệ ứng/tổng có nhất quán không? DN006 lệch hẳn là do đâu?

Dán nguyên văn payload App Salary trả cho DN006 vào báo cáo.

## VIỆC B — THÊM CHỐT CHẶN cảnh báo (connector còn thiếu)

Connector hiện chỉ kiểm `Number.isSafeInteger(amount) && amount >= 0` — KHÔNG cảnh báo khi ứng > tổng. Bổ sung:
- Khi **ứng > tổng chi phí sau phạt** ⇒ đánh cờ **anomaly** trong payload (vd `salaryAdvance.suspect = true` + lý do). Frontend hiện **cảnh báo đỏ**: *"Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu"*, KHÔNG hiện im lặng như số đúng.
- Đây là fail-closed đúng tinh thần: số vô lý thì phải kêu, không được nuốt.

## VIỆC C — CHẶN ship ô "Còn lại sau ứng lần 1"

**KHÔNG deploy ô "còn lại" cho tới khi VIỆC A trả lời rõ câu 2** (ứng trừ trên cơ sở nào). Lý do: nếu ứng KHÔNG cùng gốc với chi phí tháng thì phép "tháng − ứng" sai bản chất, ship ra là số âm sai cho toàn đội (vd DN006 sẽ ra −139,5 triệu).
- Nếu câu 2 xác nhận ứng **trừ trên chi phí tháng** ⇒ ship ô "còn lại" như spec `DIRECTIVE_KPI_CON_LAI_SAU_UNG_20260731.md`, KÈM cờ anomaly VIỆC B (ứng vượt thì "còn lại" hiện cảnh báo thay vì số âm trần trụi).
- Nếu ứng trừ trên **quý/năm/khác** ⇒ DỪNG, báo lại để CEO + Claude chốt lại cách hiển thị (không tự chế công thức).

## BÁO CÁO
1. Payload App Salary nguyên văn cho DN006 + trả lời 3 câu VIỆC A.
2. Đã thêm cờ anomaly (ứng > tổng) chưa — dán chỗ code + ảnh cảnh báo đỏ.
3. Ô "còn lại": ship hay DỪNG, vì sao.
