# DIRECTIVE — Màn hình KHÔNG BAO GIỜ chờ (CEO chốt 13/08/2026, 09:23)

> CEO: *"tao không thấy cái app nào/web nào mà khi truy cập vào nó lại tải liên tục,
> càng F5 càng tải liên tục và không ra trang… nguyên tắc dữ liệu nó phải luôn ở dạng
> lưu đệm chứ, chỉ làm tươi dữ liệu khi F5 lại hoặc nó sẽ tự cập nhật chứ."*

Đây là nguyên tắc chuẩn (stale-while-revalidate). CEO nói đúng, và từ nay nó là **luật
cho MỌI màn của App Report**, không riêng màn nào.

## Chẩn đoán vì sao Tổng quan quay vô hạn (ảnh 09:23, PROD `7870f10`)

`/overview` bản thân **nhẹ và có đệm** (`analytics.js:147` — `overviewCache`). Nó quay
không phải vì nó chậm, mà vì **cả tiến trình bị nghẹt**:

1. Node một luồng. Một request khác (màn Chi phí, cron nền…) đang bắt CPU **nhai file
   catalog 377 MB** ⇒ mọi request xếp hàng sau — kể cả request chỉ cần đọc đệm 1 ms.
   Cả app đứng vì một cái bếp tắc: ly nước lọc cũng phải chờ nồi hầm.
2. **F5 không huỷ việc cũ.** Server không bắt `req.on('close')` (đã kiểm 13/08 — không
   có chỗ nào). Trình duyệt bỏ đi nhưng server vẫn tính tiếp bản không ai nhận, còn F5
   thì nộp thêm một bản mới ⇒ **càng F5 hàng càng dài** — đúng chữ CEO dùng.
3. Tiến trình còn tự chết vì hết bộ nhớ (log OOM 11/08) rồi khởi động lại nguội — lại
   nhai file từ đầu.

## Bốn luật — áp cho mọi màn, mọi endpoint

1. **Phục vụ bản đệm TRƯỚC, làm tươi Ở NỀN.** Mở màn/F5 ⇒ trả ngay bản gần nhất đang
   có (kèm nhãn *"số lúc HH:MM"*); việc lấy bản mới chạy nền, xong thì cập nhật. Màn
   hình trắng + vòng xoay chỉ được phép ở **lần đầu tiên trong đời** chưa từng có dữ
   liệu.
2. **Không việc nặng nào được chạy trên luồng phục vụ.** Phân tích file lớn, fan-out
   mạng, tổng hợp nặng ⇒ chạy nền / worker / lúc đồng bộ — không bao giờ trong lúc
   người dùng đang chờ HTTP. (Tách LKG theo kỳ và snapshot chi phí là hai việc thi hành
   luật này.)
3. **Trùng request thì gộp một (single-flight).** Mười lượt F5 cùng một câu hỏi = MỘT
   lần tính. `memoGet`/`singleFlight` đã có sẵn trong `routes.js` — mọi endpoint dựng
   tốn kém phải đi qua, không chừa cái nào.
4. **Khách bỏ đi thì ngừng nấu.** Bắt `req.on('close')`, truyền tín hiệu huỷ vào các
   việc dài hạn; request không còn ai nhận thì không được ăn thêm CPU.

## Trạng thái thi hành

| Việc | Thi hành luật | Trạng thái |
|---|---|---|
| Deploy `3a3a47d` (thôi nhai 377 MB ba lần, 60s→13,5s) | 2 | Qua Gate 1, chờ deploy |
| Snapshot chi phí (`SPEC_EMPLOYEE_COST_LOCAL_SNAPSHOT.md`) | 1+2 | Spec xong, bot dựng |
| Tách LKG theo kỳ (thiết kế của bot) | 2 | Dự án kế tiếp |
| Single-flight cho `/overview`, `/trend` và mọi endpoint dựng tốn kém | 3 | **Chưa làm** |
| `req.on('close')` + huỷ việc bị bỏ rơi | 4 | **Chưa làm** |
| Web: giữ bản gần nhất (localStorage) hiện ngay khi mở màn, làm tươi nền | 1 | **Chưa làm** |

## Trả lời câu "hay xoá làm lại từ đầu"

Bệnh nằm ở **một kiểu đường dữ liệu** (tính lúc xem + chờ mạng lúc xem), không nằm rải
rác khắp app. Phần đắt nhất của App Report là **logic nghiệp vụ đã được CEO chốt từng
quyết định** (thưởng/phạt v3.3, quy kỳ theo ngày giao, đối soát không-dòng-nào-biến-mất…)
— phần đó đúng và giữ nguyên. Làm lại từ đầu là vứt phần đúng để viết lại phần sai bằng
đúng số tuần mà lộ trình trên cần, nhưng thêm rủi ro sai lại logic tiền. Lộ trình trên
rẻ hơn và từng bước đều rollback được.
