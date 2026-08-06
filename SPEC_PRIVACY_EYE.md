# SPEC — CON MẮT ẨN/HIỆN SỐ TIỀN (CEO đề xuất 06/08/2026)

> CEO: *"ngay mục Chi phí của tôi / Thanh toán CP, em có thể thiết kế con mắt dưới dạng
> đóng/mở để tự thao tác cho xem hoặc ẩn đi. Vì thực tế hai tab này khá nhạy cảm, nó
> liên quan đến tiền bạc."*

## ‼ NÓI THẲNG TRƯỚC: đây là RÈM CHE, KHÔNG PHẢI KHOÁ

Che số trên màn hình **không phải biện pháp bảo mật**. Số vẫn nằm trong bộ nhớ trình
duyệt và trong phản hồi mạng — ai mở công cụ nhà phát triển (F12) là thấy hết.

- **Chống được:** người đứng sau lưng · chiếu màn hình lúc họp · lỡ để máy mở khi rời bàn.
- **KHÔNG chống được:** người cầm được máy · ảnh chụp lúc đang hiện · người có tài khoản.

**Khoá thật đã có sẵn và không được lẫn:** `employeeCostVisibility` (backend, bật/tắt
chức năng chi phí theo từng NV, có audit) và `auth.scopeOf` (NV chỉ thấy số của mình).
Con mắt này **không thay thế**, cũng **không được nới lỏng** hai thứ đó.

Ghi rõ ngay trên giao diện: đặt tooltip *"Ẩn số trên màn hình — không phải khoá bảo mật"*.
Người dùng tin nhầm là nguy hiểm hơn không có tính năng.

## Thiết kế

### 1. Một công tắc cho CẢ APP, không phải từng trang
Đặt con mắt ở **thanh tiêu đề**, cạnh nút Làm mới. Bấm một lần là **mọi màn có tiền
đều che**: Chi phí của tôi · Thanh toán CP · các ô KPI · bảng toàn đội · Tổng quan.

Lý do: lúc chia sẻ màn hình trong cuộc họp, **không ai nhớ bật từng trang**. Bật từng
trang là thiết kế thua ngay từ đầu.

### 2. Mặc định **ẨN**
Mở app lên là đã che sẵn; muốn xem thì bấm mắt. Vì khoảnh khắc rủi ro nhất chính là
**lúc vừa mở trang trước mặt người khác**.

### 3. **KHÔNG nhớ trạng thái "đang hiện"**
F5 · mở tab mới · quay lại sau ⇒ **về ẩn**. Chỉ được nhớ theo phiên đang mở, không ghi
vào `localStorage`. Nhớ "đang hiện" là phá luôn ý nghĩa của mục 2.

### 4. Tự ẩn lại — chỗ làm nên chữ "thông minh"
- Sau **60 giây không thao tác** (không di chuột, không gõ, không bấm).
- Khi **cửa sổ mất tiêu điểm** hoặc **tab bị ẩn** — dùng đúng sự kiện `visibilitychange`
  mà chuông thông báo đang dùng, không dựng cơ chế thứ hai.
- Khi **khoá màn hình / máy ngủ** (cũng rơi vào `visibilitychange`).

Mỗi lần tự ẩn hiện một dòng nhỏ *"Đã tự ẩn số sau 60 giây"* để người dùng không tưởng
app hỏng.

### 5. Che **SỐ**, giữ **CẤU TRÚC**
`3.995.000đ` → `•••••••` (giữ nguyên độ rộng cột để bảng không nhảy). Nhãn, tên nhân
viên, ngày, trạng thái, nút bấm **giữ nguyên** — vẫn thao tác được, chỉ không đọc được số.

Che cả: tiền · phần trăm target · số Xu · số dòng có kèm tiền. **Không che:** mã đơn,
mã đơn vị, mã hàng, ngày — mấy thứ đó không phải tiền và cần để tra cứu.

### 6. ‼ ĐANG ẨN THÌ **KHOÁ NÚT GHI TIỀN**
Đây là phần đáng giá nhất, và nó biến tính năng trang trí thành **kiểm soát thật**:

> Khi đang ẩn số, các nút **Duyệt · Từ chối · Mở khoá · Ghi đã trả · Gỡ ghi nhận**
> phải **tắt**, kèm tooltip *"Bấm con mắt để xem số trước khi duyệt"*.

Lý do: **không ai được duyệt tiền khi đang không nhìn thấy số tiền.** Chặn đúng loại
tai nạn bấm nhầm. Backend **vẫn chặn độc lập** như cũ — ẩn nút không phải lớp bảo vệ.

### 7. Xuất Excel/PDF **không đổi**
Đang ẩn mà bấm xuất thì file vẫn có số thật. Đúng — file đi qua backend và có kiểm
quyền riêng. Nhưng nút xuất phải hiện cảnh báo một dòng: *"File xuất ra có số thật."*

## Test bắt buộc

1. Mặc định **ẩn**; F5 ⇒ vẫn ẩn (không đọc `localStorage`).
2. Bấm mắt ⇒ hiện; sau 60s không thao tác ⇒ **tự ẩn** + có dòng báo.
3. `visibilitychange` sang ẩn ⇒ **ẩn ngay**, không chờ 60s.
4. Đang ẩn ⇒ **mọi nút ghi tiền `disabled`**; hiện lại ⇒ bật lại.
5. Che đúng phạm vi: tiền/%/Xu bị che; **mã đơn · mã đơn vị · mã hàng · ngày KHÔNG bị che**.
6. Một công tắc ăn **mọi trang** — đổi ở Chi phí thì Thanh toán CP cũng đổi theo.
7. Quét mã: **không** có chuỗi nào ghi "bảo mật/an toàn" cho tính năng này; tooltip phải
   là *"không phải khoá bảo mật"*.

## Không làm (cố ý)

- **Không thêm mã PIN.** Với giới hạn ở đầu file, PIN chỉ tạo cảm giác an toàn giả mà
  thêm phiền. Muốn khoá thật thì dùng `employeeCostVisibility`.
- **Không che theo từng ô** (chọn ô nào che ô nấy) — phức tạp, dễ sót, và lúc cần thì
  không ai kịp bấm.
