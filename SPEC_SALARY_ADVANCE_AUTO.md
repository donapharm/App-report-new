
---

# PHỤ LỤC — AI ĐỀ XUẤT TARGET TỰ ĐỘNG THEO THÁNG (CEO chốt 04/08/2026)

> CEO: *"AI đề xuất lại target cho tháng mới… khi có doanh số T07.2026 rồi thì AI dựa vào doanh thu T07.2026 để đề xuất target cho T08.2026, và cứ thế có doanh thu T08.2026 / kết thúc tháng là AI đề xuất target luôn cho tháng kế tiếp."*

## Đã làm (frontend)
- **Hiện HẾT nhân viên** — trước cắt còn 8 người, CEO không thấy phần còn lại mà vẫn bấm áp dụng cho tất cả.
- **Chọn/bỏ chọn + sửa số từng người**; nút ghi rõ `Áp dụng N/M NV`, kèm đếm số dòng CEO đã sửa. Số âm/không phải số bị chặn ngay tại màn, không đẩy sang backend.
- Chỉ gửi người **được chọn** với số **đã sửa**. Backend vẫn lọc lại theo roster — frontend không được tin.

## Còn phải làm (backend, chưa code)
1. **Tự sinh đề xuất khi kỳ khoá sổ.** Chạy **09:00 GMT+7 ngày 09 hằng tháng** (ngay sau khoá sổ ngày 8): neo vào doanh thu THỰC của kỳ vừa khoá → sinh đề xuất cho tháng kế tiếp → lưu dạng **đề xuất**, nhắn Telegram cho CEO *"AI đã đề xuất target MM/YYYY cho N nhân viên — mở app duyệt"*.
2. **‼ TUYỆT ĐỐI KHÔNG tự áp.** Target là tiền: chỉ CEO bấm mới ghi thành target thật. Giữ đúng câu đang hiện trên màn: *"AI chỉ đề xuất song song. CEO bấm áp dụng thì mới ghi thành target thật."*
3. **Không đè target đã giao.** Kỳ đã có target thì đề xuất nằm song song, hiển thị rõ `target hiện tại → AI đề xuất`, CEO tự quyết.
4. **Neo phải là kỳ ĐÃ KHOÁ SỔ**, không neo vào tháng đang chạy dở (doanh thu còn về tới ngày 8 ⇒ đề xuất sẽ thấp giả).
5. Nhắc lại nếu quá **3 ngày** chưa duyệt; duyệt xong thì thôi nhắc.
6. Mọi mốc theo **GMT+7**.

## Nghiệm thu
- Hết tháng, **không ai bấm gì**, sáng ngày 09 CEO đã có tin nhắn kèm đề xuất sẵn trong app.
- Đề xuất neo đúng doanh thu thật của kỳ vừa khoá sổ.
- CEO sửa số của một người → chỉ người đó đổi; bỏ chọn một người → người đó **không bị ghi** target.
- Không có đường nào ghi target mà thiếu thao tác duyệt của CEO.
