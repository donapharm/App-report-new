# SPEC — Module "Thanh toán CP của tôi" (CEO chốt 2026-07-31)

Mở rộng ô "Còn lại sau ứng lần 1" thành **sổ theo dõi 3 lần thanh toán + C44**. NV theo dõi tiền của mình, CEO quản lý toàn đội. **KHÔNG build vội** — chờ App Salary xác nhận xuất được dữ liệu các lần (mục "Chặn nguồn").

Bản mẫu giao diện CEO đã duyệt: mockup "Thanh toán CP của tôi" (3 lần + C44 + sổ còn nợ + màn CEO).

## 1. Money flow (ví dụ DN001 · T07/2026)
- **Tổng chi phí kỳ** = số DataHub sau phạt (vd 200tr). C44 **tách riêng**, không nằm trong 200.
- **Lần 1 · Ứng:** số App Salary đã chi (vd 50tr, ngày 31/07).
- **Lần 2 · Ứng:** mặc định **60%** phần còn lại `(Tổng − Lần 1)` → 90tr. **Sửa được.**
- **Lần 3 · Tất toán:** **phần còn lại** = `Tổng − Lần 1 − Lần 2` → 60tr (tự tính, không nhập tay).
- **C44:** sổ riêng, **cộng dồn qua các tháng, chi trả T12**.

## 2. Bất biến (fail-closed — lệch là DỪNG, báo)
- `Lần 1 + Lần 2 + Lần 3 == Tổng kỳ`.
- `Đã nhận (lũy kế) + Sổ còn nợ == Tổng kỳ`.
- C44 KHÔNG trộn vào 3 lần, KHÔNG cộng vào tổng kỳ.
- Lệch bất kỳ → hiển thị cảnh báo, KHÔNG show số chỏi nhau (theo tinh thần SPEC_REVENUE_SYNC_EXCEPTIONS).

## 3. SSOT — ai nắm số nào (CEO đính chính 31/07)
- **Tổng chi phí kỳ:** DataHub (SSOT).
- **Lần 1 · Ứng:** App Salary (SSOT) — App Salary **CHỈ xuất DUY NHẤT 1 lần ứng cho mỗi tháng** (T07 → ứng lần 1 của T07; T08 → ứng lần 1 của T08). Read-only, App Report không sửa.
- **Lần 2 + Lần 3: SỐ TẠI APP REPORT.** App Salary KHÔNG có 2 số này. App Report tự tính từ `(Tổng − Lần 1)`, chia 60/40 (sửa được), và **tự ghi nhận đã trả** (xem mục 8).
- **C44:** cột DataHub (Lương cuối năm), sổ riêng, cộng dồn tới T12.
- App Report **KHÔNG bịa số**: lần 2/3 là phép tính **minh bạch** từ số thật (Tổng, Lần 1) + quy tắc 60/40 CEO chốt; còn "đã trả" **phải do người có quyền GHI NHẬN**, không tự đánh dấu.

## 4. Trạng thái từng lần + "cộng dồn"
- Trạng thái mỗi lần: **✓ đã trả · ◷ sắp/đang tới hạn · ○ chưa tới hạn · 🔴 quá hạn**.
- **Trạng thái tĩnh hiển thị ĐỦ tổng** — NV luôn thấy tổng được nhận.
- **Cộng dồn:** lần nào chưa nhận thì gộp hết vào **"Sổ còn nợ"**; **Lần 3 tất toán quét sạch phần còn lại** (kể cả lần 2 chưa lấy). NV không mất tiền vì chưa nhận đúng ngày.

## 5. Lịch & thời hạn (mốc tính từ ngày Lần 1)
- Lần 1: cuối tháng kỳ.
- Lần 2: **+45 ngày, cửa sổ ±15 (30–60 ngày)**. **NV chủ động nhận** — không tự chi.
- Lần 3 (tất toán): **+60 ngày**.
- C44: T12.
- Lưu ý chồng lấn: nếu Lần 2 trôi tới ~ngày 60 thì gộp với Lần 3 tất toán (một lần quét).

## 6. Thông báo Telegram (dùng lại hạ tầng notify, KHÔNG viết mới)
- **Mở cửa sổ Lần 2:** nhắn NV + CEO — "Lần 2 (…đ) đã có thể nhận, hạn tới …".
- **Quá hạn** Lần 2/Lần 3 chưa nhận → **cảnh báo đỏ** NV + CEO ("quá N ngày").
- Người nhận: NV có khoản + CEO. (Không lọc optout với cảnh báo vận hành, như sync/high-value.)

## 7. Phạm vi quyền
- **NV:** self-scoped, chỉ thấy sổ của chính mình (backend khóa quyền `scopeOf`).
- **CEO/admin (ALL):** bảng toàn đội — tổng kỳ · đã nhận · còn nợ · lần kế + hạn · trạng thái; đánh dấu **ai quá hạn**. NV thiếu/nghi tách riêng, không thành 0 (khuôn aggregate hiện có).

## 8. Ghi nhận thanh toán Lần 2 / Lần 3 — App Report là SỔ GHI NHẬN
App Salary KHÔNG có lần 2/3 ⇒ App Report là nơi ghi nhận. Vì đây là số tiền thật, phải khoá chặt:
- **Số lần 2/3:** tự tính 60/40; cho **người có quyền (CEO/admin)** sửa số **Lần 2** → **Lần 3 tự tính lại** = `Tổng − Lần 1 − Lần 2` (giữ bất biến mục 2). NV không sửa.
- **Đánh dấu "đã trả":** chỉ **người có quyền** ghi (ngày + số tiền thật đã chuyển). **KHÔNG tự đánh dấu, không auto-assume.** NV chỉ XEM (tuỳ chọn: nút "xác nhận đã nhận").
- **BẮT BUỘC AUDIT:** mỗi lần sửa số / ghi nhận đã trả lưu **ai · khi nào · số cũ → mới**; không ghi đè lặng, có lịch sử (theo chuẩn version như cấu hình phạt).
- **Fail-closed:** chưa ai ghi nhận ⇒ trạng thái là "kế hoạch/chưa trả", TUYỆT ĐỐI không hiện như đã trả.

## 9. Lộ trình (KHÔNG còn chặn nguồn — build được ngay)
App Salary chỉ cần lần 1 (đã có) ⇒ không phải chờ ai.
- **GĐ1:** khung màn + sổ; **Lần 1 = số App Salary**; **Lần 2/3 = App Report tính 60/40** (trạng thái "kế hoạch"); C44 cộng dồn; màn CEO + self-scope NV.
- **GĐ2:** thêm **ghi nhận đã trả lần 2/3** (admin, audit) + **Telegram** nhắc mở cửa sổ / quá hạn + **đối chiếu bất biến**.

## 10. Nghiệm thu (khi build)
- DN001 T07: Tổng 200tr · Đã nhận 50tr · Còn nợ (cộng dồn) 150tr · Lần 2 90tr / Lần 3 60tr · C44 sổ riêng.
- Sửa Lần 2 → Lần 3 tự đổi, tổng vẫn 200tr.
- 1 NV thiếu nguồn → "—", không thành 0. Bất biến lệch → cảnh báo, không show số chỏi.
- Self-scope: NV khác không thấy sổ của nhau.
