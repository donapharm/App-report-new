# DIRECTIVE — BẬT LẠI 2 CÔNG TẮC THÔNG BÁO (CEO chốt phương án A, 2026-07-30)

**Làm SAU khi deploy v3.5 xong** (`DIRECTIVE_DEPLOY_V34_20260730.md`). Hai việc là hai bước riêng, không gộp.

## 0. CEO quyết gì
CEO chọn **phương án (a)**: bật cả hai công tắc **ngay hôm nay**, để **20:00 ngày 31/07** hệ thống gửi tin tháng 7 cho NV (số **DỰ KIẾN**), và **20:00/20:10 ngày 09/08** gửi lại **SỐ CHỐT**.

Hai công tắc: `EMP_COST_NOTIFY=1` (tin chi phí) và `BONUS_NOTIFY=1` (tin thưởng). Hiện đang `=0`.

## 1. ‼ CỔNG CHẶN — KIỂM TRƯỚC KHI BẬT, KHÔNG ĐƯỢC BỎ QUA

Hai cờ này bị tắt tối 29/07 vì số tháng 7 còn sai (thiếu 382 triệu doanh thu; DN008 sai bậc thưởng ~1,92 triệu). Doanh thu đã sửa, **nhưng phải chứng minh số thưởng đã tính lại theo bản doanh thu mới**.

**Kiểm bằng API, dán số thật vào báo cáo:**
```
GET /api/employee-cost?emp=DN008&from=2026-07&to=2026-07   (token CEO)
```
- `bonus.month.pct` phải là **≈130,26%** → ĐÃ tính lại ⇒ được bật.
- Nếu còn **≈117,71%** → **CHƯA** tính lại ⇒ **DỪNG, KHÔNG BẬT**. Tính lại thưởng T07 theo slot doanh thu mới (`rev_2src_072026_…`, tổng `28.957.771.643đ`) trước, rồi kiểm lại.

**Kiểm thêm:** `formulaVersion` phải là `v3.5`. Nếu chưa phải thì chưa deploy xong — làm deploy trước.

Bật khi số còn sai là gửi sai cho toàn bộ NV và **không rút lại được**. Đây là lý do có cổng chặn này.

## 2. Cách bật
1. **Backup `.env`** trước khi sửa (ghi lại tên file backup vào báo cáo).
2. Đổi `EMP_COST_NOTIFY=0` → `1` và `BONUS_NOTIFY=0` → `1`.
3. **CHỈ restart `app-report-tgbot`.** **KHÔNG** restart `app-report` (không đụng API/web).

## 3. Nghiệm thu — 5 bằng chứng, dán số thật, không báo suông
1. `bonus.month.pct` của DN008 = **130,26%** (cổng chặn §1 đã qua).
2. Nội dung `.env` sau khi sửa: 2 dòng `EMP_COST_NOTIFY=1`, `BONUS_NOTIFY=1` + tên file backup.
3. **PID `app-report-tgbot` ĐỔI** (có restart bot) · **PID `app-report` KHÔNG đổi** (không đụng API).
4. Log khởi động bot phải in **đủ 4 mốc**, dán nguyên dòng:
   ```
   ✔ Chi phí/Thưởng scheduler: chi phí 12:30 thứ 7 + 20:00 ngày cuối tháng (dự kiến) + 20:00 ngày 9 (sau khoá sổ) (số chốt); thưởng tháng 20:10 ngày cuối tháng (dự kiến) + 20:10 ngày 9 (sau khoá sổ) (số chốt) GMT+7
   ```
   Nếu log vẫn in `TẮT` thì cờ chưa ăn — dừng, kiểm lại `.env`.
5. **Danh sách người sẽ nhận** (chỉ mã NV + kênh, KHÔNG số tiền): dán ra để CEO soát trước 20:00. Phải **KHÔNG có** 4 mã trong `config/notify_optout.json`: **DN021, DN023, VP004, VP018**.

## 4. Sau 20:00 ngày 31/07 — báo lại
- Số tin: **gửi / bỏ qua / lỗi** cho cả hai loại (chi phí, thưởng), kèm lý do từng ca bỏ qua (log đã in sẵn).
- **Dán nguyên văn 1 tin thật đã gửi** (chọn 1 NV). Tin phải có đủ:
  - `thưởng DỰ KIẾN tháng` (không phải "CHỐT"),
  - `Số DỰ KIẾN, CHƯA CHỐT (doanh thu còn cập nhật đến hết ngày 08/08/2026)`,
  - `Sau khi khoá sổ hệ thống gửi lại số chốt`.
- Nếu tin thật **thiếu** một trong ba câu trên ⇒ báo ngay, đừng chờ hết đợt.

## 5. Ngày 09/08 — lượt SỐ CHỐT
Không phải làm gì thêm, lịch đã tự có. Nhưng **ngày 09/08 phải báo lại**:
- Tin chốt đã gửi, có `thưởng CHỐT tháng` + `Số CHÍNH THỨC của kỳ (đã khoá sổ hết ngày 08/08/2026)`, **không còn chữ DỰ KIẾN**.
- Số tin gửi/bỏ qua/lỗi.
- **Nếu ngày 09/08 không có tin nào đi** ⇒ báo ngay. Nguyên nhân hay gặp nhất: khoá chống-gửi-trùng không tách theo lượt (đã sửa: khoá mang `|provisional` và `|final`) hoặc bot bị restart mất lịch.

## 6. Những thứ KHÔNG được đụng trong đợt này
- Không bật/đổi bất kỳ cờ thông báo nào khác (`TARGET_NOTIFY`, `DIGEST_NOTIFY`, `PENALTY_NOTIFY`…). Chỉ đúng 2 cờ ở §2.
- **`PENALTY_NOTIFY` giữ nguyên TẮT** — tin nhắn về PHẠT chưa được CEO duyệt gửi.
- Không sửa mức thưởng/phạt, không sửa `employee_bonus_tiers.json`, không sửa `bonus_formula_lock.json`.
- Auto-deploy vẫn khoá.

## 7. Nếu có sự cố
Đổi 2 cờ về `0`, restart lại **chỉ** `app-report-tgbot`, rồi báo kèm log. Ghi 1 mục `CHANGELOG.md` cho cả lần bật và lần tắt.
