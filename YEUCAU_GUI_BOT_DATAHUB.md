# Yêu cầu gửi bot DataHub — dán thẳng đoạn dưới

> CEO chỉ cần copy phần trong khung, gửi cho bot bên DataHub. Không cần sửa gì.

---

**Việc: sửa khoá `vault-audit.lock` để nó tự lành. Ưu tiên cao.**

Bên App Report đã truy ra nguyên nhân và viết sẵn thuật toán đầy đủ. File chi tiết: `DIRECTIVE_DATAHUB_VAULT_LOCK_SELFHEAL.md` trong repo `donapharm/App-report-new` (nhánh `main`). Đọc file đó rồi làm theo. Tóm tắt để nắm ngay:

**Chuyện gì đang xảy ra**

DataHub bị PM2 khởi động lại do vượt ngưỡng RAM **đúng lúc đang giữ `vault-audit.lock`**, để lại **khoá mồ côi**. Mọi request `employee-cost` phải chờ ghi audit nên kẹt khoảng **10 giây**, vượt timeout 6,5 giây của App Report. Hậu quả đã xảy ra thật hai lần:

- **01/08:** 21 nhân viên hiện **0đ** trên app.
- **03/08:** vẫn còn, và **luân phiên** — DN004, DN007, DN008, DN009, DN011, DN017, DN019, DN024 lúc được lúc không, nên rất khó phát hiện.

**Vì sao phải sửa ở DataHub**

RAM còn vọt là còn bị khởi động lại. Tiến trình chết trong khi đang giữ khoá là **điều phải chịu được**, không thể xây hệ thống dựa trên giả định "đừng bao giờ chết". App Report đã làm hết phần của mình (dùng bảng tỷ lệ gần nhất kèm nhãn "số cũ" thay vì hiện 0đ oan; chặn cứng thời gian chờ ở 25 giây) — nhưng đó chỉ là **giảm đau**. Khoá vẫn mồ côi và mọi bên tiêu thụ khác vẫn dính.

**Phải làm gì**

Đổi khoá hiện tại (chỉ là "có file thì coi như đang bận") thành khoá **có chủ và có hạn**:

```jsonc
{ "pid": 12345, "host": "datahub-1", "at": "2026-08-04T07:12:03.114Z", "ttlMs": 15000 }
```

Khi muốn lấy khoá:
1. Chưa có file → ghi file tạm rồi `rename` (để nguyên tử) → được khoá.
2. Có file → đọc ra:
   - Chủ đã chết (`process.kill(pid, 0)` ném `ESRCH` và `host` trùng máy hiện tại) → **tự phá khoá**, ghi audit `LOCK_RECLAIMED_DEAD_OWNER`.
   - Quá hạn (`now - at > ttlMs`) → **tự phá khoá**, ghi audit `LOCK_RECLAIMED_EXPIRED`.
   - Còn sống và trong hạn → chờ tối đa `ttlMs` rồi thử lại.
3. Giữ khoá lâu thì **phải gia hạn** (cập nhật `at` mỗi khoảng 1/3 `ttlMs`) — việc chạy lâu không được bị hiểu nhầm là đã chết.
4. Thả khoá trong `finally`, và **chỉ thả đúng khoá của mình** (so `pid` + `at`) — tránh phá nhầm khoá của tiến trình khác vừa lấy được.

`ttlMs` đề xuất **15000** (gấp khoảng 2 lần thời gian ghi audit chậm nhất quan sát được). Để trong cấu hình, đừng ghi cứng trong code.

**Hai việc nhỏ làm luôn cùng lúc**

- Cache kết quả **lỗi** phải ngắn hơn nhiều cache kết quả tốt. Hiện lỗi bị giữ 6 giờ nên hỏng nửa ngày mới lộ. Đề xuất: tốt 6 giờ, **lỗi tối đa 2 phút**.
- **Ghi audit mỗi lần phá khoá.** Không có vết thì lần sau lại mất cả ngày để truy.

**Nghiệm thu — làm đủ 4 bước rồi báo lại**

1. `kill -9` tiến trình đang giữ khoá → request kế tiếp **tự phá khoá trong vòng `ttlMs`**, không kẹt tới timeout.
2. Chạy 21 mã nhân viên liên tiếp 3 vòng → **không mã nào** rơi vào trạng thái `unavailable`.
3. Nhật ký có dòng `LOCK_RECLAIMED_*` đúng bằng số lần đã dựng cảnh.
4. Một việc chạy lâu hơn `ttlMs` **không** bị tiến trình khác phá khoá (nhờ cơ chế gia hạn).

**Cần trả lời lại**

- Khoá `vault-audit.lock` nằm ở repo/thư mục nào? Bên App Report đã tra `data-hub-smart-app` nhưng không thấy, nên không xác định được đúng chỗ để áp.
- Sau khi sửa xong, chạy 4 bước nghiệm thu trên và gửi kết quả.

---

## Ghi chú cho CEO (không cần gửi)

- Đây là **thứ duy nhất cắt được tận gốc** việc nhân viên luân phiên mất số chi phí. Phía App Report đã làm xong phần chịu đựng: không mất số, không treo màn hình, không bắt chờ 25 giây.
- Nếu bot DataHub hỏi "có gấp không": **có** — mỗi ngày chưa sửa là mỗi ngày số chi phí của một nhóm nhân viên có thể sai mà không ai biết.


---

# ĐỢT 2 — trả lời báo cáo của bot DataHub (04/08, tối)

> Bot báo: lock mồ côi đã backup + cách ly an toàn, không restart · outbox còn **2.600 event chờ replay** · lượt nghiệm thu đầu bị 401 do script đọc sai định dạng key trong `.env` (không phải DataHub lỗi), đã dừng, chưa thử lặp auth.

**Dán tiếp đoạn dưới cho bot DataHub:**

---

Ghi nhận, phần dọn khoá mồ côi làm đúng và an toàn (backup + cách ly, không restart). Ba việc tiếp theo, theo thứ tự ưu tiên:

**1. Cách ly khoá mới là DẸP HẬU QUẢ, chưa phải SỬA NGUYÊN NHÂN.**

Lần này khoá mồ côi được gỡ tay. Lần sau PM2 khởi động lại đúng lúc đang giữ khoá thì **y nguyên sự cố cũ**. Cần trả lời rõ một câu: **thuật toán khoá tự lành đã code chưa?** — tức là khoá có `pid` + `host` + `at` + `ttlMs`, tự phá khi chủ đã chết hoặc quá hạn, **gia hạn** khi việc chạy lâu, và **chỉ thả đúng khoá của mình**. Nếu chưa thì đây vẫn là việc số 1; cách ly tay không tính là xong.

**2. ‼ TRƯỚC KHI REPLAY 2.600 EVENT — phải chốt: có event nào chạm kỳ ĐÃ KHOÁ SỔ không?**

**T06.2026 và T07.2026 là kỳ đã khoá sổ, số đã ghim, đổi một đồng là dừng:**

| Kỳ | Doanh thu ghim | Số dòng |
|---|---|---|
| 06.2026 | **28.403.136.096đ** | **2.001** |
| 07.2026 | **30.917.892.673đ** | **2.016** |

Replay là ghi lại lịch sử. Nếu trong 2.600 event có cái nào rơi vào hai kỳ trên thì tổng sẽ đổi mà **không ai biết**, kéo theo sai thưởng/phạt đã báo cho nhân viên. Đề nghị làm đúng thứ tự:

- **Trước khi drain:** lọc outbox theo kỳ, báo lại **có bao nhiêu event thuộc T06/T07**. Nếu > 0 thì **DỪNG, báo trước**, đừng replay rồi mới nói.
- **Sau khi drain:** chạy `node server/scripts/verify_frozen_periods.js` trong repo App Report. Mã thoát `0` = khớp, `1` = **LỆCH (dừng ngay)**, `2` = chưa đọc được số (chưa kết luận được là khớp). Gửi lại nguyên văn kết quả.

**3. Nghiệm thu vẫn còn nợ.** 401 do script đọc sai key thì đúng là không phải lỗi DataHub — nhưng nghĩa là **4 bước nghiệm thu chưa bước nào chạy được**. Sau khi sửa cách nạp key, chạy đủ 4 bước ở phần trên rồi gửi kết quả từng bước.

**Cần trả lời:** ① thuật toán tự lành đã code chưa · ② số event thuộc T06/T07 trong outbox · ③ kết quả 4 bước nghiệm thu · ④ khoá `vault-audit.lock` nằm ở repo/thư mục nào.
