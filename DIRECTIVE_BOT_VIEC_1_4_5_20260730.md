# DIRECTIVE — VIỆC CHO BOT (CEO chốt 6 việc, 2026-07-30 trưa)

**Đọc SAU khi `git pull origin main`.** Ba việc dưới đây theo đúng thứ tự. Việc nào chưa đủ điều kiện thì DỪNG ở đó và báo lại, **không nhảy sang việc sau**.

Nhắc lại ràng buộc chung, không được nới: **cấm `npm run build` trong cây production** · **auto-deploy vẫn khoá** · **không sửa** `employee_bonus_tiers.json` / `bonus_formula_lock.json` · **không ghi đè** `server/data/*.json` (dữ liệu thật) · backup `.env` trước mọi lần sửa.

---

## VIỆC A — Bật công tắc "NV tự xem chi phí" cho **toàn bộ 12 NV** (CEO đồng ý)

Đang tắt toàn phòng (`department: off`) nên NV mở app là thấy *"Chức năng chi phí đang tắt cho bạn"* — trong khi từ 31/07 họ **nhận được tin nhắn** về chi phí/thưởng. Nhận tin mà mở app không xem được là ngược.

**Cách làm:** đăng nhập tài khoản CEO/admin → màn **Chi phí** → khối **"Quản trị quyền tự xem chi phí"** → **"Mở quản trị"** → bật **toàn phòng** → **"Lưu công tắc"**.
Hoặc gọi API: `POST /api/employee-cost/visibility` với `{"department":"on"}` (token CEO/admin).

**Nghiệm thu — 3 bằng chứng, dán số thật:**
1. `GET /api/employee-cost/visibility` (token CEO) → `department.effective = "on"`, và **cả 12 mã DN001–DN012** đều `effective: "on"`.
2. Đăng nhập **một tài khoản NV thật** (vd DN001) rồi gọi `GET /api/employee-cost?from=2026-07&to=2026-07` → **KHÔNG còn** câu `"Chức năng chi phí đang tắt cho bạn"`, và payload có `penalty.c45Label = "C45 (Lương tăng thêm)"` + `penalty.tiers` đủ 4 bậc.
3. Ảnh màn hình NV đó: thấy đủ **4 ô KPI** (Tổng chi phí tháng sau phạt · Ứng lần 1 · Phạt dự kiến · Phạt thiếu Xu) và ô "Tổng chi phí tháng" có nhãn **· dự kiến**.

**Không đụng:** 4 mã trong `config/notify_optout.json` (DN021, DN023, VP004, VP018) — đó là danh sách **chặn thông báo**, **không liên quan** tới công tắc xem chi phí. Đừng lấy danh sách này để loại ai khỏi quyền xem.

---

## VIỆC B — Bật `PENALTY_NOTIFY` (CEO đã duyệt gửi tin phạt cho NV)

### ‼ CHƯA LÀM ĐƯỢC NGAY — phải chờ đủ điều kiện

`PENALTY_NOTIFY` hiện chỉ là **cái cờ trống**: `src/penaltyNotifyPolicy.js` có hàm `enabled()` nhưng **chưa có nội dung tin phạt nào được viết**. Bật cờ bây giờ thì **không tin nào đi**, và tệ hơn là mọi người tưởng đã bật xong.

**✅ CẬP NHẬT 30/07 trưa: ĐIỀU KIỆN ĐÃ ĐỦ.** `server/src/penaltyNotify.js` + `server/test/penaltyNotify.test.js` (7 ca) đã có trên `main`. Vẫn phải tự chạy test để chứng minh, đừng tin văn bản này.

**Kiểm điều kiện trước khi bật:**
```
ls server/src/penaltyNotify.js && node --test server/test/penaltyNotify.test.js
```
- Chưa có file ⇒ **DỪNG**, báo *"chưa có builder tin phạt, chờ Claude push"*.
- Có và test XANH ⇒ làm tiếp.

**Cách bật:** backup `.env` → `PENALTY_NOTIFY=1` → **chỉ restart `app-report-tgbot`**.

**Nghiệm thu:**
1. Nội dung `.env` + tên file backup.
2. **PID `app-report-tgbot` ĐỔI** · **PID `app-report` KHÔNG đổi**.
3. Log khởi động in mốc lịch tin phạt.
4. **Dán nguyên văn 1 tin phạt thật** đã gửi. Tin phải có: **tên cột "C45 (Lương tăng thêm)"** · **số tiền có thể mất** · **cần thêm bao nhiêu doanh thu trước VAT để thoát bậc** · câu **T07.2026 chỉ cảnh báo, chưa trừ tiền, từ 01/08/2026 mới trừ thật**.
5. Nếu tin thiếu bất kỳ phần nào ở trên ⇒ **báo ngay, đừng chờ hết đợt**.

---

## VIỆC C — Quy tắc ĐƠN BÙ: tách thành đơn bù riêng (CEO chốt 5.1)

> CEO: *"đơn hàng đặt ngày 25/06 nhưng 05/07 mới có hàng và được VP018 + bù đơn thì phải auto chuyển ngày đặt đơn thành ngày +bù nợ, không được để là ngày 25/06 nữa."* → CEO chốt cách làm: **tách thành đơn bù riêng**, KHÔNG sửa đè ngày đơn gốc.

**Việc này ở App Sale + script materialize, KHÔNG phải ở App Report.** App Report chỉ đọc lại.

**Yêu cầu với App Sale:**
1. Khi VP018 bù đơn ⇒ sinh **dòng/đơn BÙ RIÊNG**, có:
   - `parent_order_code` = mã đơn gốc (giữ dấu vết, tra lại được),
   - ngày = **ngày bù thật**, không phải ngày đặt gốc,
   - cờ nhận dạng là đơn bù (vd `is_backfill = true`).
2. **Đơn gốc giữ nguyên ngày 25/06** — tuyệt đối không sửa đè. Sửa đè là mất dấu vết, sau này không ai giải thích được vì sao số kỳ cũ đổi.
3. Đơn bù quy vào kỳ theo **ngày bù**, đơn gốc quy theo ngày của nó.

**Yêu cầu với script materialize:** đơn bù phải vào **đúng kỳ của ngày bù**, và **không được tính hai lần** cùng đơn gốc — xem việc chặn đếm trùng ở `SPEC_REVENUE_DELIVERY_PERIOD.md`.

**Trước khi triển khai, bot báo lại 2 số trên dữ liệu thật:**
- Hiện có bao nhiêu đơn đã bị **sửa đè ngày đặt** (nếu có cách truy) — để biết dấu vết đã mất bao nhiêu.
- Hiện có bao nhiêu đơn thuộc diện bù trong T06 và T07, tổng tiền bao nhiêu.

**Chưa có 2 số đó thì chưa đổi gì** — CEO cần biết quy mô trước.

---

## VIỆC D — Ghi nhận 2 quyết định của CEO (không cần code)

- **5.2** Mọi đơn đều áp quy tắc; **đơn trên 50 triệu** thì **chủ động nhắn Telegram** cho **NV có đơn đó · VP018 · CEO**. (Claude đang viết phần dựng tin; bot sẽ nối nguồn đơn từ App Sale ở lượt sau.)
- **5.3** **GỘP, KHÔNG TÁCH** "doanh thu tài chính" và "doanh thu đánh giá NV" — dùng **một con số duy nhất**. Không dựng thêm luồng số thứ hai.

---

## Thứ tự làm và cách báo
1. **VIỆC A** — làm được ngay, báo 3 bằng chứng.
2. **VIỆC C** — báo 2 số quy mô, chưa đổi gì.
3. **VIỆC B** — chỉ khi đã có `penaltyNotify.js` trên `main`.

Mỗi việc báo riêng, **dán số thật**. Việc nào dừng thì nói rõ **dừng ở bước nào và vì sao**.
