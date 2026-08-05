# SPEC — HỘP "XIN NHẬN SỚM": CẢNH BÁO LƯỢT ƯU TIÊN + CHẶN KHI KHÔNG THỂ THÀNH CÔNG

> CEO chốt 05/08/2026 20:18: *"Vẫn thiếu hiện cảnh báo: mỗi quý bạn chỉ được ứng
> trước hạn một lần, và lần sau nếu bạn vẫn chọn phương thức ứng trước thì hệ thống
> sẽ chặn thao tác. Bạn cần cân nhắc để dành lần ưu tiên cho kỳ nào có số tiền nhiều…"*
>
> Bot server triển khai. Luật quota đã có sẵn ở `server/src/earlyAdvancePolicy.js` —
> **KHÔNG viết lại luật**, chỉ đem trạng thái lên màn hình.

## ‼ Lỗi nặng hơn, phát hiện khi soi ảnh CEO gửi

Ảnh chụp DN002 · kỳ **07/2026**, hai nút "Xin nhận sớm" đang bấm được. Nhưng chạy
`earlyAdvancePolicy.checkEarlyRequest({ period:'2026-07', today:'2026-08-05' })`:

```
EARLY_TOO_SOON — Sớm nhất là 31/08/2026 (còn 26 ngày)
```

⇒ NV chọn lý do, bấm gửi, rồi **chắc chắn ăn lỗi**. Hộp thoại đang mời người ta làm
một việc không thể thành công. Sửa cùng đợt này, ưu tiên ngang cảnh báo.

Ngày sớm nhất của quý 3 (để đối chiếu khi test): T07 → **31/08** · T08 → **01/10**
(khớp đúng mốc CEO chốt 04/08) · T09 → **31/10**.

## Một lần gọi, ba trạng thái

Khi NV bấm "Xin nhận sớm", frontend gọi backend **một lần** lấy nguyên kết quả
`checkEarlyRequest` cho kỳ + lần đó (kèm số tiền của lần đó). Frontend **chỉ render**,
không tự tính ngày, không tự đếm lượt.

### A. `EARLY_TOO_SOON` — chưa tới ngày
Hộp thoại **không hiện danh sách lý do**, chỉ một câu:

> **Chưa tới lúc xin nhận sớm.** Kỳ 07/2026 sớm nhất là **31/08/2026** (còn 26 ngày) —
> phải qua đủ 30 ngày kể từ khi hết tháng bán hàng.

Nút gửi **tắt**. Tốt hơn nữa: nút "Xin nhận sớm" ở bảng đeo sẵn nhãn ngày
(`Xin nhận sớm · từ 31/08`) để NV khỏi bấm vào mới biết.

### B. `EARLY_QUOTA_USED` — hết lượt quý
Cũng **không hiện lý do**, chỉ một câu (lấy nguyên `message` của backend, đã có sẵn
tên kỳ đã tiêu lượt):

> **Bạn đã hết lượt ưu tiên ứng sớm của quý 2026-Q3** — đã dùng cho kỳ 07/2026.
> Kỳ này chờ đúng hạn **14/09/2026**.

Nút gửi **tắt**. Đây là "chặn thao tác" đúng như CEO yêu cầu.

### C. `OK` — còn lượt: HIỆN CẢNH BÁO rồi mới cho chọn lý do

Khối cảnh báo đặt **trên** danh sách lý do, nền vàng, không thu gọn được:

> ⚠ **Dùng lượt ưu tiên của quý 2026-Q3 — mỗi quý chỉ có 1 lượt.**
> Kỳ này Lần 2 là **67.0xx.xxxđ**. Dùng cho kỳ này thì **hết lượt cả quý**: các kỳ
> còn lại trong quý sẽ **bị chặn**, phải chờ đúng hạn. Cân nhắc để dành cho kỳ có số
> tiền lớn hơn.
> ✅ **Sếp từ chối thì KHÔNG mất lượt** — lượt chỉ trừ khi Sếp đồng ý mở khoá.

Ba điều bắt buộc trong khối này:
1. **Số tiền của chính lần đang xin** — CEO bảo "để dành cho kỳ nhiều tiền" thì phải
   cho người ta thấy tiền, không nói suông.
2. **Tên quý** lấy từ `quarterOf(period)` — quý của **KỲ BÁN HÀNG**, không phải quý
   của ngày bấm (luật đã có, đừng đổi).
3. **Câu "từ chối thì không mất lượt"** — sự thật kỹ thuật: `earlyAdvanceQuota.consume`
   chỉ chạy ở nhánh `grantUnlock`. Thiếu câu này NV sẽ sợ không dám xin, hỏng cả cơ chế.

Nút gửi đổi chữ thành **“Dùng lượt ưu tiên · gửi xin nhận sớm”** để không ai bấm nhầm
tưởng là đề nghị thường.

## Giai đoạn 2 (làm sau, nếu CEO muốn)

Bảng so sánh nhỏ trong hộp thoại: các kỳ **cùng quý** kèm số tiền Lần 2/Lần 3 và ngày
sớm nhất — để NV chọn có cơ sở thay vì đoán. Ví dụ tại 01/10 thì cả T07 lẫn T08 đều
xin được, người ta cần nhìn hai số cạnh nhau mới quyết được.

## Test bắt buộc

1. `EARLY_TOO_SOON` (T07 tại 05/08): hộp thoại **không** render radio lý do; nút gửi
   `disabled`; có chuỗi `31/08/2026`.
2. `EARLY_QUOTA_USED`: không render lý do; nút gửi `disabled`; câu báo có **tên kỳ đã
   tiêu lượt**.
3. `OK`: có khối cảnh báo **trước** danh sách lý do; có **số tiền** của lần đang xin;
   có tên quý; có câu "từ chối thì không mất lượt".
4. Frontend **không tự tính**: quét mã, cấm phép trừ ngày / đếm lượt trong JSX; mọi
   chuỗi ngày và số lượt phải đến từ payload backend.
5. Backend là lớp chặn thật: gọi thẳng route với kỳ chưa tới hạn / hết lượt vẫn phải
   403/422 kể cả khi frontend bị chỉnh — **ẩn nút không phải là bảo vệ**.
