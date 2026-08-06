# SPEC — CỘT % CHI PHÍ TRONG TAB "DANH MỤC QUẢN LÝ" (CEO yêu cầu 06/08/2026)

> CEO: *"khảo sát ở tab 'danh mục quản lý của tôi', đề xuất thêm các cột % chi phí
> (như C36/C41/C43/C44/C45) hay một số cột khác. Tùy vào cấu hình phân quyền tại
> DataHub hoặc thiết lập tại App Report — tư vấn để quản lý thật hiệu quả."*

## Quyết định kiến trúc (điểm CEO hỏi): SỐ ở DataHub · QUYỀN HIỂN THỊ ở App Report

1. **Tỷ lệ % lấy từ DataHub (SSOT), App Report CHỈ hiển thị — tuyệt đối không nhập/sửa
   % trong App Report.** Dùng đúng bảng tỷ lệ hiệu lực mà "Chi phí của tôi" đang dùng
   (`employeeCostRateSnapshot` + policy theo kỳ). Nhờ vậy % trong Danh mục QL và tiền
   trong Chi phí **không bao giờ lệch nhau** — cùng một nguồn. Nếu cho cấu hình % riêng
   tại App Report là tự tạo nguồn thứ hai ⇒ quay lại đúng bệnh "đi tìm số đồng nhất".
2. **Quyền XEM quyết ở backend App Report** — vì đây là chuyện "ai thấy gì trên màn
   App Report", đúng nguyên tắc số 1 của repo (`auth.scopeOf`). KHÔNG đưa quyền màn
   hình App Report sang DataHub cấu hình: hai app quản chéo quyền của nhau là hai chỗ
   để cấu hình sai. DataHub giữ quyền của nó: **ai được SỬA %** (kèm duyệt + audit bên đó).

## Phân quyền xem — MENU RIÊNG, CHỈ CEO điều khiển (CEO chốt 06/08/2026)

> CEO: *"chỉ CEO mới quản lý ai được xem cột nào, hiển thị cột nào, không ai khác.
> Muốn có một menu để phân quyền hiển thị theo từng NV: được thấy cột nào / được
> thấy đơn vị nào được hiển thị cột nào theo mình phụ trách."*

**Menu "Phân quyền cột % danh mục"** — nút chỉ hiện với `auth.isCeoActor`; route ghi
đều `requireCeo`. **Admin thường KHÔNG sửa được** (khác các quyền admin khác — đây là
lệnh đích danh của CEO). Mọi thay đổi ghi audit: ai bật, cho ai, cột gì, lúc nào.

Cấu hình theo từng NV (lưu backend, vd `catalog_cost_column_grants`):
- **Cột được thấy:** tick từng cột trong whitelist (C36 · C41 · C43 · C44 · C45 …).
- **Phạm vi đơn vị:** mặc định "mọi đơn vị mình phụ trách"; CEO có thể thu hẹp còn
  một số đơn vị cụ thể (chọn từ danh sách đơn vị NV đó phụ trách — không chọn được
  đơn vị của người khác).
- Có thao tác theo **nhóm** + "toàn phòng" như panel `employeeCostVisibility` để đỡ
  bấm 21 lần; theo sau là chỉnh lẻ từng người.

**Mặc định TẮT (fail-closed):** NV chưa được CEO bật thì KHÔNG thấy bất kỳ cột % nào —
các cột thầu sẵn có vẫn nguyên. Quyền thấy % = `employeeCostVisibility` bật **VÀ**
grant cột của menu này — thiếu một trong hai là không thấy.

| Vai | Thấy gì |
|---|---|
| NV sale | Cặp **mình phụ trách** ∩ đơn vị CEO cho phép ∩ cột CEO cho phép |
| CEO | Toàn bộ cặp + toàn bộ cột; và là người DUY NHẤT sửa được phân quyền |
| Admin thường | Xem như quyền CEO cấp cho họ; **không** sửa được phân quyền |

- **Con mắt ẩn số (V-B) phủ luôn các cột %** — mặc định che, họp chiếu màn hình không lộ.
- **Export** cột % đi qua backend + kiểm đúng grant như màn hình — không export được
  cột mình không được thấy.

## Cột hiển thị

- Đúng **whitelist hợp đồng chi phí hiện hành** (`isAllowedCostColumn`: C33–C46 trừ cột
  chặn) — nhãn cột lấy từ contract DataHub trả về, **không hardcode nhãn trong JSX**.
  Ưu tiên đợt đầu theo CEO nêu: **C36 · C41 · C43 · C44 · C45** (+ cột nào contract có).
- Mỗi ô là **tỷ lệ %** của cặp (đơn vị × mã hàng). KHÔNG hiện tiền ở tab này — tiền
  thuộc màn Chi phí (tránh hai nơi cùng tính tiền).
- C44 đeo nhãn sẵn có "chi T12 · không trong 3 lần" như bên Chi phí.

## Fail-closed (bắt buộc, như mọi màn)

- Cặp **chưa có %** ⇒ ô `—` kèm chú "thiếu % — xem tab Mặt hàng thiếu %". CẤM suy 0%.
- Nguồn tỷ lệ đang kẹt ⇒ hiện đúng cờ `rateStale` ("đang dùng bảng tỷ lệ gần nhất
  ngày …") — không im lặng.
- Bảng nặng thêm ⇒ cột % nằm sau nút bật **"Hiện % chi phí"** (mặc định tắt) để tab
  giữ tốc độ hiện tại; trạng thái nút không lưu localStorage.

## Không làm (cố ý)

- Không cho sửa % tại App Report (kể cả CEO) — sửa ở DataHub, nơi có duyệt + audit + version.
- ~~Không dựng bảng cấu hình chọn cột~~ → **bỏ, CEO chốt 06/08 yêu cầu menu phân quyền
  theo từng NV (mục trên)**. Giữ lại phần cốt lõi: menu chỉ chọn trong whitelist
  contract, không tự đặt thêm cột ngoài hợp đồng chi phí.

## Nghiệm thu

1. NV **chưa được cấp** ⇒ không thấy cột % nào (mặc định tắt); cột thầu vẫn nguyên.
2. CEO bật cho 1 NV cột C41 + giới hạn 2 đơn vị ⇒ NV đó thấy đúng C41, đúng 2 đơn vị,
   không hơn; audit ghi lại thao tác.
3. Đăng nhập **admin thường** ⇒ không thấy nút menu phân quyền; gọi thẳng API ghi
   grant phải bị 403 (`CEO_ONLY`).
4. Số % NV thấy khớp đúng số màn Chi phí cùng kỳ (một nguồn DataHub).
5. Cặp thiếu % ⇒ `—` + chú thích; tổng số cặp thiếu khớp tab "Mặt hàng thiếu %".
6. Bật con mắt che ⇒ cột % thành `•••••••`; mã đơn vị/mã hàng không che.
7. Export chỉ chứa cột được cấp; đổi % bên DataHub ⇒ App Report đổi theo sau đồng bộ.

## Xếp hàng

**CEO duyệt hướng + duyệt menu phân quyền: 06/08/2026.** Làm **ngay sau** khi đóng đợt
V-A→V-D đang deploy (đứng đầu hàng đợi kế). Ước lượng: vừa (backend nối rate theo
scope + store grant + route CEO-only + menu; nguồn số và khung quyền đều có sẵn).
