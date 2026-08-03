# SPEC — "ỨNG LẦN 1" TỰ ĐỘNG THEO TỪNG THÁNG

> CEO chốt 04/08/2026: *"T07.2026 thì đang nhắn thủ công, nhưng từ T08.2026 trở đi thì phải là tự động. Phải có cơ chế sao để khi App Salary mà ban hành khoản ứng lần 1 thì App Report phải lấy qua ô KPI này cho đảm bảo theo từng tháng."*

## 0. Nguyên tắc bất di bất dịch

1. **KHÔNG BAO GIỜ phải nhắn tay.** Không có bước "ai đó nhớ bấm/nhắc" trong đường chạy bình thường.
2. **Mọi tháng dùng CHUNG một cơ chế.** T08, T09, T10… không có ngoại lệ, không có cờ bật tay theo tháng.
3. **App Salary là nguồn sự thật của số ứng.** App Report chỉ đọc và hiển thị; không tự tính, không suy ra từ tháng khác, không nhớ số cũ đè lên tháng mới.
4. **Chưa duyệt thì nói "chưa duyệt"** — không bịa 0, không hiện số tạm tính, và **không đưa vào KPI "Còn lại sau ứng lần 1"**.
5. Mọi mốc thời gian theo **GMT+7 (`Asia/Bangkok`)**.

## 1. Vì sao hiện đang phải nhắn tay (nguyên nhân gốc)

App Salary vừa thêm **bước duyệt kỳ**: kỳ chưa duyệt thì trả `amount = 0` kèm `status` mới (`approved` / `provisional`) — hai trạng thái này **không có trong hợp đồng** nên App Report từ chối cả gói.

Hệ quả: không ai biết kỳ đã duyệt hay chưa, phải hỏi nhau bằng tay.

## 2. Ba lớp — làm đủ ba thì hết nhắn tay vĩnh viễn

### Lớp 1 — CHỐT HỢP ĐỒNG TRẠNG THÁI *(bắt buộc, không có thì hai lớp sau vô nghĩa)*

App Salary trả lời bằng văn bản đúng hai câu:
- `provisional` nghĩa là gì? `amount = 0` lúc đó là *"chưa duyệt nên chưa có số"* hay *"đã duyệt và đúng bằng 0"*?
- `approved` có tương đương `locked` (đã chốt, không đổi nữa) không?

Có câu trả lời → App Report nhận thêm hai trạng thái này vào `validateProjection`, ánh xạ:

| `status` từ App Salary | App Report hiển thị | Vào KPI "Còn lại sau ứng lần 1"? |
|---|---|---|
| `approved` / `locked` | số tiền · **Đã chốt** | **CÓ** |
| `draft` | số tiền · Dự kiến, chưa chốt | CÓ |
| `provisional` (chưa duyệt) | **"Chưa duyệt kỳ MM/YYYY trên App Salary"** | **KHÔNG** — giữ `—` |
| trạng thái lạ khác | *"App Salary đổi hợp đồng"* | KHÔNG |

**‼ Chặn tiền:** kỳ chưa duyệt mà đưa `amount = 0` vào phép trừ thì "Còn lại sau ứng" sẽ bằng **nguyên tổng chi phí** — số sai mà trông như số thật. Cấm tuyệt đối.

Xong lớp 1 là **đã tự động**: App Report hỏi App Salary theo đúng kỳ đang xem ở **mỗi lần tải màn**, nên App Salary duyệt xong thì lần xem kế tiếp đã ra số — không ai phải nhắn ai.

### Lớp 2 — TỰ KIỂM THEO LỊCH + TỰ NHẮC *(App Report làm, không phụ thuộc bên kia)*

Để không ai phải *nhớ* đi duyệt:

- Chạy **08:00 GMT+7 mỗi ngày**, quét kỳ đang mở của toàn bộ NV trong roster.
- Kỳ **chưa duyệt** → nhắc Telegram cho CEO + người phụ trách App Salary:
  *"Kỳ MM/YYYY chưa duyệt ứng lần 1 trên App Salary — N nhân viên chưa có số. Hạn khoá sổ: 08/MM+1."*
- **Tăng mức khi tới hạn:** còn ≤ 2 ngày tới ngày khoá sổ (ngày 8) thì nhắc **đỏ**, ghi rõ hậu quả nếu không duyệt kịp.
- Kỳ **vừa chuyển sang đã duyệt** → nhắn một tin xác nhận rồi **thôi nhắc kỳ đó**. Không spam.
- Dùng lại `notifyChannels` sẵn có; **không dựng kênh mới**.

### Lớp 3 — WEBHOOK TỪ APP SALARY *(tuỳ chọn — chỉ để hiện TỨC THÌ)*

App Salary bắn `POST /api/integrations/app-salary/first-advance-approved` với `{ period, approved_at }` khi duyệt xong → App Report xoá cache kỳ đó, số hiện ngay không cần chờ lần tải sau.

- Xác thực bằng **service token riêng**, khác token App Report đang dùng để gọi họ.
- Webhook **chỉ là tối ưu tốc độ**. Mất webhook thì lớp 1 + lớp 2 vẫn chạy đúng — **cấm để hệ thống phụ thuộc webhook**.

## 3. Màn hình

- Ô **"Ứng lần 1 tháng này"** phải luôn nói rõ **một trong bốn**: có số (đã chốt) · có số (dự kiến) · **chưa duyệt kỳ này** · lỗi kỹ thuật (ghi đúng loại lỗi).
- Không bao giờ để lại câu chung chung *"tạm thời chưa lấy được"* khi đã biết nguyên nhân.

## 4. Nghiệm thu

1. Bên App Salary duyệt một kỳ → **không ai nhắn ai**, mở App Report lên đã thấy số đúng.
2. Kỳ chưa duyệt → ô ghi **"Chưa duyệt kỳ MM/YYYY"**, và **"Còn lại sau ứng lần 1" giữ `—`** (tuyệt đối không ra số).
3. Sang T09, T10 **không phải bật cờ, không phải sửa gì** — chạy y hệt T08.
4. Tắt webhook đi thì mọi thứ vẫn đúng, chỉ chậm hơn tối đa một lần tải màn.
5. Tin nhắc chạy 08:00 GMT+7, có leo thang trước ngày khoá sổ, và **tự dừng** khi kỳ đã duyệt.
