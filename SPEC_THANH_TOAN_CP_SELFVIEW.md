# SPEC — Module "Thanh toán CP của tôi" (CEO chốt 2026-07-31)

Mở rộng ô "Còn lại sau ứng lần 1" thành **sổ theo dõi 3 lần thanh toán + C44**. NV theo dõi tiền của mình, CEO quản lý toàn đội.

> ## ✅ 04/08/2026 — GỠ CHẶN, ĐƯỢC PHÉP BUILD
> Câu *"KHÔNG build vội — chờ App Salary xác nhận xuất được dữ liệu các lần"* viết ngày 31/07, khi đấu nối chưa chạy. **Nay đã lỗi thời** (CEO nhắc 04/08: *"lần 1 đã có trên App Report rồi nhé"* — CEO đúng).
>
> Đã kiểm đủ 3 lớp, đường lấy **Lần 1** tồn tại và đã chạy ra số thật:
> - `server/src/salaryAdvance.js` — client gọi App Salary, khoá self-scope, đã nghiệm thu trên PROD từ 31/07 (`e5a7df1`).
> - `server/src/routes.js:790` — `safeGetFirstAdvance` + `withAfterPenaltyGuard`, trả field `salaryAdvance` trong `/api/employee-cost`.
> - `server/src/remainingAfterAdvance.js` — đã tính `Tổng sau phạt − Lần 1`, có cờ `locked` theo khoá sổ kỳ.
> - `web/src/pages/EmployeeCost.jsx` → `SalaryAdvanceKpi` — đã hiển thị, đã ra số thật cho NV.
>
> **Lần 2 và Lần 3 vốn KHÔNG phụ thuộc App Salary** (mục 3: *"số tại App Report"*), nên cũng không có gì chặn.
>
> Việc App Salary đang trả `status` ngoài hợp đồng (04/08) chỉ là **sự cố tạm thời của một nguồn**, không phải thiếu năng lực nguồn. Sổ phải **fail-closed đúng lần đó** (Lần 1 hiện "chưa lấy được", sổ không chốt được tổng) chứ **không phải lý do hoãn cả module**.

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

## 3b. Số lần linh động theo tổng (CEO chốt 31/07)
- **Tổng ≥ 60tr → 3 lần:** Lần 1 (ứng) + Lần 2 (60%) + Lần 3 (tất toán 40%).
- **Tổng < 60tr → 2 lần:** Lần 1 (ứng) + Lần 2 (**tất toán** phần còn lại). **BỎ lần 3.**
- **Ngưỡng 60tr nằm ở CONFIG** (không ghi cứng trong code) để CEO chỉnh sau — theo chuẩn ngưỡng cấu hình như `high_value_order_alert`.
- Mặc định nhóm <60tr là 2 lần; admin vẫn có thể chọn 3 lần nếu cần. **Bất biến giữ nguyên:** tổng các lần (2 HOẶC 3) = Tổng kỳ.
- Lịch 2-lần: Lần 2 tất toán dùng mốc tất toán (+60 ngày) như lần 3; NV vẫn chủ động nhận, có nhắc Telegram.

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
- **Ghi RÕ khoảng cách cho NV hiểu (bắt buộc hiển thị):** Lần 1 → Lần 2 ≈ **45 ngày (±15)**; Lần 2 → Lần 3 ≈ **15 ngày**; tổng Lần 1 → tất toán = **60 ngày**. Màn NV + mỗi lần đều hiển thị "còn … ngày tới lần sau" / "ngày N" để NV không phải tự nhẩm.

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


---

## 11. CHỐT SỐ "ỨNG LẦN 1" — KHÔNG GỌI APP SALARY MỖI LẦN MỞ MÀN (CEO chốt 04/08/2026)

> CEO: *"Cứ lấy số ứng lần 1 tại ô KPI thì rất bất tiện — mỗi khi NV truy cập menu Thanh toán CP của tôi là API lại kéo số về, rất tốn tài nguyên. Khi có số rồi thì lấy số về luôn, chỉ khi thay đổi số ứng lần 1 mới đổi số."*

**CEO đúng.** Trước đó chỉ có cache RAM **25 giây** ⇒ NV mở màn 10 lần/ngày là 10 lượt gọi App Salary, restart app là mất sạch. Với 21 NV × nhiều màn thì đây đúng là lãng phí, và còn kéo theo rủi ro: nguồn chậm/lỗi là màn trắng.

### ‼ ĐÍNH CHÍNH 04/08 — CEO: sửa số là sửa BÊN APP SALARY, số phải TỰ về
> CEO: *"Khi sửa số ứng lần 1 cho một NV nào đó thì sẽ sửa vào App Salary, và như vậy sẽ được cập nhật vào ô KPI thôi, không có gì khác."*

Bản đầu của Claude coi kỳ đã chốt là **"không bao giờ hỏi lại"** ⇒ Sếp sửa số bên App Salary mà App Report **không bao giờ thấy**. **Sai, đã bỏ.**

Thay bằng **trả ngay + làm tươi ngầm** (`server/src/salaryAdvanceSnapshot.js`):

| Trạng thái kỳ | Màn hình | Làm tươi ngầm phía sau |
|---|---|---|
| **Đã chốt** (`locked`/`approved`) | trả số trong kho **tức thì** | sau **1 giờ** |
| **Đang mở** (`draft`) | trả số trong kho **tức thì** | sau **10 phút** |
| **Chưa có số / lỗi nguồn** | không lưu — không đóng băng cái rỗng | như cũ |

- **Màn hình KHÔNG BAO GIỜ phải chờ mạng** khi kho đã có số ⇒ hết cảnh mỗi lần mở menu là một lượt gọi (đúng mối lo của CEO).
- **Chỉnh sửa bên App Salary vẫn tự về**, không ai phải bấm gì — chậm nhất 10 phút (kỳ mở) / 1 giờ (kỳ chốt), và **tức thì** nếu bấm "Làm mới" hoặc có webhook.
- Số lượt gọi giảm khoảng **95%** so với cache 25 giây, nhưng **không đánh đổi bằng việc nuốt mất chỉnh sửa**.
- Đồng hồ đóng dấu và đồng hồ tính hạn phải là **một** — lệch nhau thì "quá hạn chưa" tính sai hoàn toàn (đã có test).

### Bắt buộc kèm theo
1. **Luôn hiện `fetchedAt`** — *"số tại lúc HH:MM ngày DD/MM"*. Số cũ mà không nói rõ là số lúc nào thì người xem tưởng số đang sống.
2. **Nút "Làm mới"** cho NV/CEO ép lấy lại ngay (`force`).
3. **Webhook App Salary duyệt** (`SPEC_SALARY_ADVANCE_AUTO.md` Lớp 3) gọi `invalidate()` ⇒ số mới hiện tức thì, không phải chờ hết 6 giờ.
4. **Chỉ lưu 10 khoá hợp đồng.** Dữ liệu lương (`net`…) không được vào kho.
5. **Kho hỏng/bị sửa tay không được trả nhầm** — đọc ra phải khớp đúng mã NV và đúng kỳ, lệch là bỏ.
6. Kho **có trần** (600 bản ghi), không phình vô hạn.

### Rủi ro đã cân nhắc
Chỉnh sửa bên App Salary về **chậm nhất 10 phút / 1 giờ** chứ không tức thì. Chấp nhận được vì đây là số chi trả theo tháng, không phải số theo giây; và vẫn có **2 đường về ngay**: nút "Làm mới" + webhook khi App Salary duyệt.

**Đã code + test:** `server/test/salaryAdvanceSnapshot.test.js` 7/7.
