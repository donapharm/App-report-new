# DIRECTIVE — `vault-audit.lock` PHẢI TỰ LÀNH (gửi bên DataHub)

> **CEO duyệt 04/08/2026, nâng ưu tiên.** Đây là **thứ duy nhất cắt được vòng lặp** đang âm thầm làm mất dữ liệu chi phí.

## 1. Sự việc — đã xảy ra thật, hai lần

**01/08:** DataHub bị PM2 khởi động lại do vượt ngưỡng RAM **đúng lúc đang giữ `vault-audit.lock`** ⇒ để lại **khoá mồ côi**. Mọi request `employee-cost` phải chờ ghi audit ⇒ kẹt ~**10 giây** > timeout **6,5 giây** ⇒ App Report fail-closed ⇒ **21 nhân viên hiện 0đ**. Cache 6 giờ làm lỗi lộ muộn.

**03/08:** vẫn còn. Nhật ký cho thấy **DN004 · DN007 · DN008 · DN009 · DN011 · DN017 · DN019 · DN024** **luân phiên** mất nguồn — lúc được lúc không, nên rất khó phát hiện.

## 2. Vì sao phải sửa ở DataHub, không sửa được ở App Report

RAM còn vọt là còn bị khởi động lại. **Tiến trình chết trong khi đang giữ khoá là điều PHẢI chịu được** — không thể xây hệ thống dựa trên giả định "đừng bao giờ chết".

App Report đã làm phần của mình (`employeeCostRateSnapshot`, commit `7991d18`): nguồn kẹt thì dùng bảng tỷ lệ gần nhất kèm nhãn *"số cũ"* thay vì hiện 0đ oan. **Nhưng đó chỉ là giảm đau.** Khoá vẫn mồ côi, request vẫn kẹt, và mọi bên tiêu thụ khác vẫn dính.

## 3. Phải làm gì — thuật toán cụ thể

Khoá hiện tại chỉ là "có file thì coi như đang bận". Đổi thành khoá **có chủ và có hạn**:

```jsonc
// nội dung vault-audit.lock
{ "pid": 12345, "host": "datahub-1", "at": "2026-08-04T07:12:03.114Z", "ttlMs": 15000 }
```

**Khi muốn lấy khoá:**
1. Chưa có file ⇒ ghi (ghi file tạm rồi `rename` để đảm bảo nguyên tử) ⇒ **được khoá**.
2. Có file ⇒ đọc ra:
   - **Chủ đã chết** (`process.kill(pid, 0)` ném `ESRCH`, và `host` trùng máy hiện tại) ⇒ **tự phá khoá**, ghi audit `LOCK_RECLAIMED_DEAD_OWNER`.
   - **Quá hạn** (`now - at > ttlMs`) ⇒ **tự phá khoá**, ghi audit `LOCK_RECLAIMED_EXPIRED`.
   - Còn sống và trong hạn ⇒ chờ, tối đa `ttlMs`, rồi thử lại.
3. **Giữ khoá lâu thì phải gia hạn** (`at` cập nhật mỗi ~1/3 `ttlMs`) — việc chạy lâu không bị hiểu nhầm là chết.
4. **Thả khoá trong `finally`**, và chỉ thả **đúng khoá của mình** (so `pid` + `at`) — tránh phá nhầm khoá của tiến trình khác vừa lấy.

**Ngưỡng đề xuất:** `ttlMs = 15000` (gấp ~2 lần thời gian ghi audit chậm nhất quan sát được). Để trong cấu hình, đừng ghi cứng.

## 4. Cùng lúc, hai việc nhỏ nhưng đáng giá

- **Cache kết quả LỖI phải ngắn hơn nhiều cache kết quả tốt.** Hiện lỗi bị giữ 6 giờ ⇒ hỏng nửa ngày mới lộ. Đề xuất: tốt 6 giờ, **lỗi ≤ 2 phút**.
- **Ghi audit khi phá khoá.** Không có vết thì lần sau lại mất một ngày để truy.

## 5. Nghiệm thu

1. Giết tiến trình đang giữ khoá (`kill -9`) ⇒ request kế tiếp **tự phá khoá trong ≤ ttlMs**, không kẹt tới timeout.
2. Chạy 21 mã liên tiếp 3 vòng ⇒ **không mã nào** rơi vào `unavailable`.
3. Nhật ký có dòng `LOCK_RECLAIMED_*` đúng số lần đã dựng cảnh.
4. Việc chạy lâu hơn `ttlMs` **không** bị tiến trình khác phá khoá (nhờ gia hạn).

## 6. Ghi chú về việc tìm mã nguồn

Claude đã tra `donapharm/data-hub-smart-app` (`server/src/services` chỉ có `importService · schemas · sensitive · store`) — **không thấy** `vault-audit.lock` ở đó. Nhiều khả năng khoá nằm ở repo `donapharm/data-hub` hoặc do script vận hành trên máy chủ tạo ra. **Người nắm DataHub xác định đúng chỗ rồi áp thuật toán mục 3** — phần khó là quyết định, không phải là code, và quyết định đã nằm sẵn ở đây.
