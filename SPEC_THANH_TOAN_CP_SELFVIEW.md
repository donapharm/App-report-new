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

## 3. SSOT — ai nắm số nào
- **Số tiền & ngày ĐÃ CHI mỗi lần: App Salary (SSOT).** App Report chỉ hiển thị & theo dõi, **KHÔNG tự đánh dấu "đã trả", KHÔNG tự tính tiền chi**.
- **Kế hoạch chia (60/40, số sửa tay):** nên nằm ở **App Salary**. Nếu để trên App Report thì chỉ là **"kế hoạch dự kiến"** (admin/CEO), **cấm ghi đè** số thật App Salary. Sửa 1 lần → tự tính lại lần 3, giữ bất biến mục 2.
- App Report **KHÔNG dựng engine chi trả riêng** (giống nguyên tắc chi phí self-view hiện có).

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

## 8. ‼ CHẶN NGUỒN — điều kiện tiên quyết trước khi build phần "số thật"
App Salary hiện mới xuất **Lần 1** (`first-advance`). Module cần endpoint trả **cả 3 lần + ngày thật + C44** theo từng NV/kỳ (self-scoped, allowlist, khớp kỳ/mã/VND — như connector lần 1). **Chưa có ⇒ chưa build phần số thật lần 2/3.**

## 9. Lộ trình 2 giai đoạn
- **GĐ1 (làm được ngay):** khung màn + sổ; **Lần 1 = số thật** (đã có); **Lần 2/3 = kế hoạch** (số 60/40 + ngày dự kiến từ Lần 1); C44 cộng dồn. Phần "đã trả" lần 2/3 ghi "chờ App Salary".
- **GĐ2 (sau khi App Salary cấp endpoint 3 lần):** điền **số/ngày thật** lần 2/3 → bật **đối chiếu bất biến** + **cảnh báo Telegram** quá hạn.

## 10. Nghiệm thu (khi build)
- DN001 T07: Tổng 200tr · Đã nhận 50tr · Còn nợ (cộng dồn) 150tr · Lần 2 90tr / Lần 3 60tr · C44 sổ riêng.
- Sửa Lần 2 → Lần 3 tự đổi, tổng vẫn 200tr.
- 1 NV thiếu nguồn → "—", không thành 0. Bất biến lệch → cảnh báo, không show số chỏi.
- Self-scope: NV khác không thấy sổ của nhau.
