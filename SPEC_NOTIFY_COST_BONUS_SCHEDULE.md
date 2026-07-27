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

## 5. Nghiệm thu
- Test đơn vị cho mốc thưởng (đọc ngưỡng từ config, 1 lần/kỳ, fail-closed khi thiếu cấu hình).
- Test đơn vị cho tin chi phí (bắt buộc có nhãn TẠM TÍNH khi `reliable === false`; không lộ số người khác).
- Test khung giờ: slot hằng ngày = 07:30, T7 = 13:00, chi phí T7 = 12:30, cuối tháng 17:30 / 17:40.
- Không đổi số nghiệp vụ hiện có: full server suite giữ đúng 7 fail baseline.
