# SPEC — Đổi khung giờ + thêm thông báo Chi phí & Thưởng

Ngày: 2026-07-27 · CEO chốt trực tiếp · Người viết: Claude Code
Liên quan: `SPEC_REPORT_EMP_COST_SELFVIEW.md`, `SPEC_BONUS_P2_TOTAL_TARGET_GATE.md`

---

## 0. Bối cảnh — 2 điểm CEO đã được cảnh báo và đã quyết

### 0.1 Nhãn P1/P2 bị ngược so với cấu hình đang chạy
`config/employee_bonus_tiers.json` (bản `bonus-v3.1-auto-group-target-2026-07-r1`):

| %đạt | Thực tế |
|---|---|
| < 90 | không có thưởng |
| **90** | **P1 bắt đầu** — 0,1% |
| **100** | P1 lên bậc — 0,15% |
| **101** | **P2 bắt đầu** (`priorityThresholdPct: 101`) |
| **110** | P1 lên bậc — 0,18% |
| 130 | P1 lên bậc — 0,25% |

CEO nói "100% = P1, 110% = P2" → **sai nhãn**. **CEO chốt: nhắn đủ 4 mốc 90/100/101/110, gọi ĐÚNG tên.**

### 0.2 Số chi phí hiện còn TẠM TÍNH
Còn mã chưa được DataHub gán %. Khi đó `summary.reliable = false` và `summary.periodTotal = null`
(fail-closed), chỉ còn `summary.provisionalPeriodTotal`.
**CEO chốt: vẫn gửi số, nhưng BẮT BUỘC gắn nhãn TẠM TÍNH + nêu còn bao nhiêu mã chờ gán %.**

---

## 1. Khung giờ (giờ VN, GMT+7)

**CEO chốt: chỉ tin HẰNG NGÀY dời sang 07:30. Báo cáo THÁNG giữ buổi chiều**
(dời sáng thì chốt sổ khi tháng chưa xong).

| Luồng | Trước | Sau |
|---|---|---|
| Nhắc target theo mốc | 18:00 ngày · 13:00 T7 | **07:30 ngày** · 13:00 T7 |
| Digest tổng quan | 18:00 ngày · 13:00 T7 | **07:30 ngày** · 13:00 T7 |
| Báo cáo doanh thu NGÀY | 18:00 | **07:30** |
| Báo cáo doanh thu TUẦN | T7 13:00 | **giữ nguyên** |
| Báo cáo doanh thu THÁNG | 18:00 ngày cuối tháng | **giữ nguyên** |
| 🆕 Tổng chi phí TUẦN | — | **12:30 thứ Bảy** |
| 🆕 Tổng chi phí THÁNG | — | **17:30 ngày cuối tháng** |
| 🆕 Mốc thưởng | — | **07:30 ngày** (cùng nhịp nhắc target) |
| 🆕 Tổng thưởng THÁNG | — | **17:40 ngày cuối tháng** |

⚠ **07:30 báo số của ngày HÔM TRƯỚC** — đúng bản chất bản tin buổi sáng.
Hiện thực bằng `previousDay(day)` trong **riêng nhánh hằng ngày** của `startSalesReportScheduler`.
Tuần và tháng **giữ mốc chạy**, không lùi ngày.

> ‼ Bản đầu quên hiện thực chỗ này: code lấy `day` = hôm nay. Chạy 07:30 thì ngày đó
> chưa có đơn nào → rỗng → gặp chốt "không có dữ liệu thì không gửi" → **luồng báo cáo
> ngày câm vĩnh viễn**. Hai thay đổi đúng riêng lẻ, ghép lại thành hỏng. Đã vá 28/07.

### Gộp tin để không dồn cục
07:30 có thể vừa có mốc target vừa có mốc thưởng. **Gộp thành 1 tin/người**, không bắn 2 tin.

---

## 2. Thông báo TỔNG CHI PHÍ (mới)

### 2.1 Phạm vi — đây là NGOẠI LỆ CÓ KIỂM SOÁT
Kế thừa nguyên luật của `SPEC_REPORT_EMP_COST_SELFVIEW.md`:
- **Self-scoped tuyệt đối.** Mỗi NV chỉ nhận số CỦA CHÍNH MÌNH.
- **KHÔNG** gửi số người khác, **KHÔNG** gửi tổng payout toàn công ty cho bất kỳ ai.
- **KHÔNG** có bản digest tổng chi phí cho CEO/admin qua kênh này. Muốn xem tổng thì mở app.
- Số **do DataHub tính (SSOT)**. App Report chỉ hiển thị lại.

### 2.2 Người nhận
Roster target, trừ: danh sách `EXCLUDED` của `diemXu`, mã trong `config/notify_optout.json`,
NV có cờ `no_auto_notify`, và NV đã opt-out Telegram. Gửi **Telegram + email nếu có** (`notifyChannels.deliver`).

### 2.3 Kỳ số liệu
- **Tuần (T7 12:30):** lũy kế **từ đầu tháng đến hôm nay**.
- **Tháng (ngày cuối tháng 17:30):** trọn tháng hiện tại.

### 2.4 Nội dung
```
💰 [Tháng 07] Nguyễn Văn A — tổng chi phí bán hàng bạn nhận
Lũy kế từ 01/07 đến 27/07: 46.878.505đ
```
Khi chưa chốt số (`reliable === false`) **bắt buộc** thêm:
```
⚠ TẠM TÍNH — còn 8 mã chưa được gán tỷ lệ %. Số cuối kỳ có thể thay đổi.
```

### 2.5 Fail-closed
- Không lấy được nguồn chi phí của NV đó → **KHÔNG gửi số**, gửi tin báo chưa lấy được dữ liệu.
- NV không có dòng chi phí nào → không gửi (tránh tin "0đ" gây hoang mang).
- Lỗi gửi 1 người **không** làm hỏng cả vòng.

### 2.6 Chống trùng
State theo `kind|kỳ|emp_code` trong `data/notif_cost_state.json`. Đã gửi thì thôi.

---

## 3. Thông báo THƯỞNG (mới)

### 3.1 Mốc — CEO chốt 4 mốc, gọi đúng tên

| Mốc | Nhãn đúng | Tin |
|---|---|---|
| **90%** | P1 bắt đầu | "Bạn đã bắt đầu có thưởng P1 (0,1%)" |
| **100%** | P1 lên bậc | "Đạt target! P1 lên 0,15%" |
| **101%** | **P2 bắt đầu** | "Bắt đầu có thêm thưởng ưu tiên P2 theo nhóm C10" |
| **110%** | P1 lên bậc | "P1 lên 0,18%" |

- Mỗi mốc **1 lần/kỳ/NV**, lưu `data/notif_bonus_state.json`.
- Ngưỡng đọc **từ cấu hình thật**, không hardcode: `baseTiers` cho mốc P1, `priorityThresholdPct` cho P2.
  Đổi cấu hình → mốc tự đổi theo. Không có ngưỡng hợp lệ → **không gửi gì** (fail-closed).

### 3.2 Tổng thưởng cuối tháng (17:40 ngày cuối tháng)
```
🏆 [Tháng 07] Nguyễn Văn A — thưởng dự kiến tháng
Đạt 112,4% target (…/…)
P1 (coach): 3.120.000đ
P2 (ưu tiên C10): 5.479.768đ
Tổng dự kiến: 8.599.768đ
ℹ Số DỰ KIẾN theo chính sách hiện hành, không phải bảng lương.
```

### 3.3 Bất biến
- **P1 KHÔNG ĐỤNG.** Chỉ đọc để hiển thị.
- P2 giữ nguyên v3.2: cổng tổng target, chia phần vượt theo tỷ trọng thực từng nhóm C10.
- Mọi con số do `employeeBonus` tính. Module thông báo **chỉ định dạng chữ**, không tự tính tiền.
- Nguồn chi phí thiếu (`sourceAvailable === false`) → **không gửi số thưởng**.

---

## 4. An toàn chung
1. Tất cả cờ bật **fail-closed**: chỉ chạy khi env đúng `"1"`.
   - `TARGET_NOTIFY=1` — mốc target + mốc thưởng
   - `EMP_COST_NOTIFY=1` — tổng chi phí (tuần + tháng)
   - `BONUS_NOTIFY=1` — mốc thưởng + tổng thưởng tháng
2. Chưa có `TELEGRAM_BOT_TOKEN` → no-op, không crash.
3. Tin **không bao giờ** chứa số của người khác, không chứa C32/C47.
4. Lỗi gửi được nuốt và ghi log; không làm hỏng nghiệp vụ hay vòng lặp.
5. Mỗi luồng có state chống trùng riêng, không dùng chung file.

## 5. Quyết định phát sinh KHI TRIỂN KHAI (bổ sung 28/07)

Những điều dưới đây **không có trong bản spec đầu**, phát sinh khi code và khi chạy thật.
Ghi lại để người sau không hiểu sai hệ thống.

### 5.1 Thêm dòng "Số tạm giữ cho cuối năm" — chỉ ở tin CUỐI THÁNG
CEO xin thêm sau khi xem tin mẫu. Lấy tổng các cột khai `annual` trong cấu hình
(mặc định **`c44` = "Lương cuối năm"**), đọc qua `summary.annualTotal` /
`provisionalAnnualTotal` — **không viết cứng tên cột**.
Cùng luật fail-closed; không có số hợp lệ thì **bỏ hẳn dòng**, không in `—` hay `0đ`.
Tin tuần **không** kèm dòng này.

### 5.2 "Không có tin gì thì KHÔNG gửi" — áp cho CẢ BA luồng
CEO chốt. Mỗi luồng có đường thoát riêng nên phải chặn từng chỗ:
- **Doanh thu** (`salesReport.sendAll`): NV không có dòng nào → bỏ qua; cả kỳ không ai có
  dữ liệu → im lặng hoàn toàn, **không gửi cả bản tổng CEO**, và **không đánh dấu "đã gửi"**
  để dữ liệu về muộn vẫn gửi được đúng kỳ đó.
- **Chi phí**: không có số dùng được → `messageFor` trả `null`, bot bỏ qua.
- **Thưởng**: xem 5.3.

### 5.3 ‼ "Không có tiền" ≠ "số 0"
Dính **hai lần trong một ngày**, cùng một kiểu:
1. `Number(null) === 0` → tổng bị **khóa fail-closed (`null`)** biến thành **"0đ"** gửi cho NV.
2. Dưới ngưỡng thì `employeeBonus` trả `baseAmount = 0` — **số thật, không phải `null`** —
   nên nhánh kiểm `null` không chặn được; ~15/21 NV suýt nhận tin **"Tổng dự kiến: 0đ"**
   vào chiều cuối tháng.

**Luật:** mọi nơi đụng tiền phải phân biệt tường minh *chưa có số* với *số bằng 0*.
`monthEndMessage` trả `null` khi **tổng ≤ 0**; ai có tiền dù ít (đạt 95% → P1 0,1%) **vẫn gửi**.

### 5.4 Công tắc "Chi phí của tôi" quyết định ai nhận tin CHI PHÍ
- Công tắc TẮT → `employeeCostSummaryForNotify` trả `{skipped:'visibility_off'}` → **không gửi**.
- ‼ Công tắc này **KHÔNG** chi phối tin **target** và **mốc thưởng** — hai luồng đó đi theo
  roster + `notify_optout.json` + cờ `no_auto_notify`. Đừng nhầm hai thứ.
- CEO bật cho **18 NV** ngày 28/07: `DN001–DN012, DN016, DN017, DN018, DN019, DN022, DN024`.

### 5.5 Lý do bỏ qua phải HIỆN RA, không im lặng nuốt
Hai hàm dịch vụ trả `{skipped: 'no_session' | 'no_payload' | 'visibility_off'}` thay vì `null`
trơn; bot **in lý do vào log** từng NV. Nếu ngày chốt tháng cả công ty không nhận được gì,
phải biết **ngay** là vì đâu.

### 5.6 Log phải nói thật
- `salesReportDoneLine()` phân biệt *không có dữ liệu (đúng thiết kế)* với *gửi CEO thất bại*.
  Bản đầu in `ceo=fail` cho cả hai → lần chạy đúng cũng đọc như hỏng.
- Log mốc 07:30 đếm **riêng** mốc target và mốc thưởng. Bản đầu chỉ in số mốc target nên
  **không cách nào kiểm chứng** luồng thưởng có chạy hay không.
- **Luật:** thêm chốt bỏ qua thì phải sửa log tương ứng — nếu không, mọi lần bỏ qua hợp lệ
  đều trông như sự cố.

### 5.7 Bắt buộc DIỄN TẬP KHÔ trước ngày chốt tháng
`server/scripts/test_notify_dryrun.js` — chạy **y hệt** đường thật, **in ra tin sẽ gửi**,
**không gửi gì** (không import `notifyChannels`).
Lý do: hai đường lấy số cho tin cuối tháng chỉ chạy 12:30 T7 / 17:30 / 17:40, và bộ lịch
**nuốt lỗi rồi bỏ qua** — hỏng thì cả công ty không nhận được gì mà không ai biết.
Lần chạy đầu tiên đã **bắt được lỗi thật** ở 5.3 mục 2.

## 6. Nghiệm thu
- Test đơn vị cho mốc thưởng (đọc ngưỡng từ config, 1 lần/kỳ, fail-closed khi thiếu cấu hình).
- Test đơn vị cho tin chi phí (bắt buộc có nhãn TẠM TÍNH khi `reliable === false`; không lộ số người khác).
- Test khung giờ: slot hằng ngày = 07:30, T7 = 13:00, chi phí T7 = 12:30, cuối tháng 17:30 / 17:40.
- Không đổi số nghiệp vụ hiện có: full server suite giữ đúng 7 fail baseline.
