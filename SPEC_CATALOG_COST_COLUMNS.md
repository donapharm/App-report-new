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

## Phân quyền xem (tái dùng máy móc sẵn có, không chế mới)

| Vai | Thấy gì |
|---|---|
| NV sale | Chỉ các cặp **mình phụ trách** + % của chính các cặp đó (self-scoped như Chi phí của tôi) |
| CEO / admin | Toàn bộ cặp + % |
| NV bị tắt trong `employeeCostVisibility` | Không thấy cột % (khoá sẵn có, có audit — cột % đi theo đúng khoá chi phí) |

- **Con mắt ẩn số (V-B) phủ luôn các cột %** — mặc định che, họp chiếu màn hình không lộ.
- **Export** cột % đi qua backend + kiểm quyền như mọi export khác.

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
- Không dựng bảng cấu hình "chọn cột theo vai" riêng — whitelist contract là đủ;
  thêm một tầng cấu hình là thêm một chỗ sai.

## Nghiệm thu

1. Sale đăng nhập: chỉ thấy cặp của mình, có cột %; số % khớp đúng số màn Chi phí cùng kỳ.
2. CEO: thấy toàn bộ; bật con mắt che ⇒ cột % thành `•••••••`, mã đơn vị/mã hàng không che.
3. Cặp thiếu % ⇒ `—` + chú thích; tổng số cặp thiếu khớp tab "Mặt hàng thiếu %".
4. NV bị tắt `employeeCostVisibility` ⇒ không thấy cột %, các cột thầu vẫn nguyên.
5. Đổi % bên DataHub ⇒ App Report đổi theo sau đồng bộ, không cần deploy.

## Xếp hàng

Làm **sau** khi đóng đợt V-A→V-D đang deploy. Ước lượng: nhỏ–vừa (backend nối rate
vào snapshot danh mục theo scope + frontend thêm cột; nguồn số và quyền đều có sẵn).
