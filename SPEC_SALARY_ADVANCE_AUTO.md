
---

# PHỤ LỤC — AI ĐỀ XUẤT TARGET TỰ ĐỘNG THEO THÁNG (CEO chốt 04/08/2026)

> CEO: *"AI đề xuất lại target cho tháng mới… khi có doanh số T07.2026 rồi thì AI dựa vào doanh thu T07.2026 để đề xuất target cho T08.2026, và cứ thế có doanh thu T08.2026 / kết thúc tháng là AI đề xuất target luôn cho tháng kế tiếp."*

## Đã làm (frontend)
- **Hiện HẾT nhân viên** — trước cắt còn 8 người, CEO không thấy phần còn lại mà vẫn bấm áp dụng cho tất cả.
- **Chọn/bỏ chọn + sửa số từng người**; nút ghi rõ `Áp dụng N/M NV`, kèm đếm số dòng CEO đã sửa. Số âm/không phải số bị chặn ngay tại màn, không đẩy sang backend.
- Chỉ gửi người **được chọn** với số **đã sửa**. Backend vẫn lọc lại theo roster — frontend không được tin.

## Còn phải làm (backend, chưa code)
1. **Tự sinh đề xuất NGAY ĐẦU THÁNG MỚI** *(CEO chốt 04/08: "target mới là đề xuất luôn ngay khi bắt đầu tháng mới, tức từ ngày 01")*.

   **Lần 1 — 08:00 GMT+7 NGÀY 01 hằng tháng.** Neo vào doanh thu tháng vừa kết thúc → sinh đề xuất cho tháng mới → nhắn Telegram: *"AI đã đề xuất target MM/YYYY cho N nhân viên — mở app duyệt"*. Đội có mục tiêu ngay từ ngày đầu, không phải chờ.

   **‼ Lần 1 neo vào số CHƯA CHỐT** — doanh thu kỳ trước còn về đến hết ngày 08, nên số ngày 01 luôn THẤP hơn số cuối cùng. Bắt buộc:
   - Ghi rõ trên từng dòng: **"Neo doanh thu MM/YYYY tính đến 01/MM+1 — CHƯA KHOÁ SỔ, còn về đến hết ngày 08"**.
   - **CẤM** hiển thị như số đã chốt.

   **Lần 2 — 08:00 GMT+7 NGÀY 09** (sau khoá sổ ngày 8, số đã chốt): tính lại bằng doanh thu THỰC đầy đủ.
   - CEO **chưa duyệt** ⇒ thay đề xuất cũ bằng số đúng, nhắn: *"Số kỳ MM/YYYY đã chốt — AI cập nhật lại đề xuất target"*.
   - CEO **đã duyệt** ⇒ **KHÔNG đè target đã giao**. Chỉ nhắn nếu lệch đáng kể: *"Target MM/YYYY đã giao theo số chưa chốt; số chốt cao hơn X% — có muốn điều chỉnh?"* CEO tự quyết.
2. **‼ TUYỆT ĐỐI KHÔNG tự áp.** Target là tiền: chỉ CEO bấm mới ghi thành target thật. Giữ đúng câu đang hiện trên màn: *"AI chỉ đề xuất song song. CEO bấm áp dụng thì mới ghi thành target thật."*
3. **Không đè target đã giao.** Kỳ đã có target thì đề xuất nằm song song, hiển thị rõ `target hiện tại → AI đề xuất`, CEO tự quyết.
4. **Nguồn neo:** doanh thu THỰC của tháng liền trước — lần 1 lấy số tại thời điểm ngày 01 (chưa chốt, phải ghi nhãn), lần 2 lấy số đã khoá sổ. **Không bao giờ neo vào tháng đang chạy dở.**
5. Nhắc lại nếu quá **3 ngày** chưa duyệt; duyệt xong thì thôi nhắc.
6. **‼ MỌI mốc thời gian theo GMT+7 (`Asia/Bangkok`)** — CEO nhắc lại 04/08. Cấm `toISOString()` để lấy "hôm nay"/"tháng này": server chạy UTC nên từ 00:00–07:00 giờ VN sẽ ra NGÀY HÔM QUA ⇒ lịch ngày 01 bắn nhầm sang ngày 31 tháng trước, và neo nhầm tháng. Dùng `employeeCost.vnToday()`.

## Nghiệm thu
- Hết tháng, **không ai bấm gì**, sáng ngày 09 CEO đã có tin nhắn kèm đề xuất sẵn trong app.
- Đề xuất neo đúng doanh thu thật của kỳ vừa khoá sổ.
- CEO sửa số của một người → chỉ người đó đổi; bỏ chọn một người → người đó **không bị ghi** target.
- Không có đường nào ghi target mà thiếu thao tác duyệt của CEO.
