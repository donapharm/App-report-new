# SPEC — Bản tin chủ động qua Telegram + Sửa phiên đăng nhập

> Claude Code chốt (CEO duyệt 2026-07-02). Bot triển khai; Claude review.
> Tận dụng bot @Reportdonapharm_bot + mapping telegram_id đã có. Mọi số theo scope + chỉ NV đã map & đang hoạt động.

## PHẦN A — Sửa phiên đăng nhập (ưu tiên, lỗi UX hằng ngày)
Vấn đề: cùng thiết bị vẫn bị hỏi OTP lại vì session 60' TUYỆT ĐỐI.
Sửa:
1. **Rolling session:** mỗi request có token hợp lệ → gia hạn `expires_at = now + IDLE_TTL`. Dùng liên tục không bị out.
2. **Thiết bị tin cậy hạn dài:** `IDLE_TTL` = **7 ngày** (env `SESSION_IDLE_DAYS`, mặc định 7) trên thiết bị đã đăng nhập OTP thành công. Re-OTP chỉ khi: quá hạn nhàn rỗi, thiết bị mới/lạ, hoặc đổi SĐT/mã NV/quyền (purgeUser giữ nguyên).
3. **deviceId ổn định:** frontend sinh `deviceId` ngẫu nhiên lưu `localStorage` (1 lần), gửi kèm MỌI request (header `x-device-id`). Kiểm: cùng máy → cùng deviceId (không tạo mới mỗi lần) → không bị coi là thiết bị thứ 4 oan.
4. Giữ: tối đa 3 thiết bị/NV, admin xem/xoá thiết bị, audit.
Nghiệm thu: đăng nhập rồi dùng liên tục > 1h KHÔNG bị hỏi OTP; đóng/mở lại trong 7 ngày trên cùng máy → vào thẳng; máy lạ → phải OTP.

## PHẦN B — Bản tin chủ động (Telegram)
Kênh: bot @Reportdonapharm_bot gửi tới `telegram_id` đã map (chỉ NV đang hoạt động; bỏ NV nghỉ).

### Loại tin
1. **Bản tin sáng — CEO/admin** (mặc định 07:30 hằng ngày):
   *"📊 DNPHARMA — Kỳ MM.YYYY: DT <x tỷ> (▲/▼ y% so kỳ trước). ⚠ <N> NV chưa đạt · <M> cơ số sắp cạn · <K> đơn vị giảm mạnh. Mở app: <link>"*
2. **Bản tin NV sale** (mặc định 07:30):
   *"Chào <tên>. Kỳ MM.YYYY: DT của bạn <x> · đạt <p>% target. <nhắc nếu <80%>. Mở app: <link>"*
3. **(Tùy chọn, sau)** Cảnh báo tức thời khi 1 sản phẩm/đơn vị của NV có cơ số < ngưỡng.

### Quy tắc
- Nội dung theo **scope**: CEO = toàn công ty; NV = phần mình (tái dùng `overviewKpis`/`buildAlerts` với scope theo emp_code).
- **Chỉ gửi cho NV đã map telegram_id + đang hoạt động** (có doanh thu kỳ gần nhất hoặc status active). Không map → không gửi.
- **Opt-out:** NV nhắn `/tat` cho bot để ngừng nhận; `/bat` để bật lại (lưu preference bền).
- **Chống trùng:** ghi log đã gửi (telegram_id + loại + ngày) → không gửi lặp trong ngày.
- Lịch chạy: cron (env `DIGEST_CRON`, mặc định `30 7 * * *`), múi giờ VN. Có lệnh admin gửi thử `/digest_test` (chỉ gửi cho chính admin).
- An toàn: không lộ số cho người chưa map/nghỉ; dùng `TELEGRAM_BOT_SECRET` nội bộ; secret không commit.

### Kỹ thuật
- Thêm vào worker `telegram-bot.js` (đang chạy) một scheduler, hoặc worker riêng `digest-worker.js`. Dùng cron nhẹ (tự tính giờ, không cần lib nặng).
- Backend hàm dựng nội dung tin theo scope (tái dùng smart/analytics). Không đụng app cũ.

## PHẦN B2 — DIGEST V2 (chi tiết có lớp) — Claude duyệt 2026-07-02
> Nâng bản tin 1 dòng hiện tại thành **báo cáo nhanh nhưng có top 3–5 từng mục**.
> **NGUYÊN TẮC SỐ 1 (bắt buộc):** KHÔNG tính lại trong bot. Tái dùng nguyên `A.overviewKpis()` + `smart.buildAlerts()` — 4 nhóm nó trả sẵn (`target` / `unit_down` / `cst_low` / `cst_high`) map thẳng vào 4 mục. Số digest = số app, không lệch.

### Nguồn dữ liệu → từng mục (map 1–1, không thêm hàm mới)
- **Mục 1 DOANH THU:** `k = overviewKpis({ky, scope})` → `k.revenue` (sau VAT) · `k.revenueBeforeVat` (trước VAT) · `k.momPct` (so kỳ trước) · `k.pctTarget` (%đạt).
- **Mục 2 TARGET NV:** `alerts.groups.find(g=>g.key==='target')` → `.total` (số NV chưa đạt) + `.items[]` (đã sort tăng theo %). Mỗi item: `name`, `pct`, `target`, `revenue_before_vat`. **Thiếu = `target - revenue_before_vat`** (chỉ hiện khi >0).
- **Mục 3 CƠ SỐ THẦU:** group `cst_low` → `.total` + `.items[]` (sort tăng theo `remain_pct`). Item: `product_name`, `unit_name`, `remain_pct`.
- **Mục 4 ĐƠN VỊ GIẢM MẠNH:** group `unit_down` → `.total` + `.items[]` (sort tăng theo `mom`). Item: `unit_name`, `prev`, `cur`, `mom`.
- **Mục 5 GỢI Ý:** sinh từ các `.total` > 0 (xem quy tắc rỗng bên dưới).

### 5 điểm tinh chỉnh BẮT BUỘC (Claude review)
1. **Theo scope — 2 khuôn khác nhau.** `buildAlerts`/`overviewKpis` đã nhận scope, nên chỉ khác phần TIÊU ĐỀ/cách xưng:
   - **CEO/admin:** "9 NV chưa đạt", "323 dòng CST", "25 đơn vị giảm" (toàn công ty).
   - **NV sale:** mục 1 = "DT của bạn … · đạt X% target"; mục 2 = **"Target của bạn: đạt X% · thiếu …"** (KHÔNG hiện "9 NV"); mục 3/4 = chỉ CST/đơn vị của mình (group đã tự lọc theo scope). Nếu NV không có đơn vị/CST nào → hiện dòng tích cực (điểm 2), tuyệt đối không lộ số người khác.
2. **Empty-state tích cực, không để trống.** Mỗi mục `.total === 0` → in 1 dòng khẳng định thay vì mục rỗng:
   - Target: `✅ Tất cả đạt target.` · CST: `✅ Không có CST sắp cạn.` · Đơn vị: `✅ Không có đơn vị giảm mạnh.`
   - Mục 5: nếu cả 3 total = 0 → `✅ Không có việc cần chú ý hôm nay.`
3. **Định dạng số kiểu VN (dấu phẩy thập phân).** Tỷ: `28,40 tỷ` (2 số lẻ, dấu **phẩy**). Triệu: `650tr` (làm tròn, không lẻ) hoặc `1,2 tỷ` nếu ≥1e9. %: `90,0%` / `▼ 6,6%`. Viết formatter riêng cho digest (đừng dùng `toFixed` ra dấu chấm rồi để nguyên).
4. **Giới hạn độ dài + top N.** Bản định kỳ 7h30 & `/digest_test`: **top 3** mỗi mục. `/digest_full`: **top 5**. Luôn để tổng `.total` ở tiêu đề mục ("323 dòng CST sắp cạn <10% · Top 3:") để thấy quy mô dù chỉ liệt kê vài dòng. Cắt tên đơn vị/SP quá dài (~40 ký tự). Đảm bảo < 3500 ký tự (giới hạn Telegram 4096).
5. **Gửi PLAIN TEXT (không `parse_mode`).** Tên đơn vị/SP có ký tự `_ * [ ]` sẽ vỡ Markdown → giữ `sendMessage` không kèm `parse_mode` như hiện tại. Emoji giữ được, an toàn.

### Lệnh (mọi user đã map đều tự lấy digest của MÌNH — scope bảo vệ dữ liệu)
- `/digest_test` → **bản chi tiết V2** (top 3), gửi cho chính người gõ. Bỏ giới hạn chỉ-admin: NV sale gõ ra digest của họ (scope tự giới hạn), CEO ra toàn công ty. `force:true` bỏ qua chống-trùng.
- `/digest_short` → **bản 1 dòng cũ** (giữ nguyên `digestTextFor` hiện tại, đổi tên thành renderShort).
- `/digest_full` → **bản đầy đủ** (top 5 mỗi mục).
- Định kỳ **07:30** (`DIGEST_CRON`) → dùng **bản chi tiết V2 (top 3)**. Giữ `/tat` `/bat` opt-out, chống trùng theo ngày+kind, chỉ NV đang hoạt động + đã map.

### Khuôn mẫu (CEO/admin — tham chiếu, số lấy từ hàm)
```
📊 DNPHARMA — Báo cáo ngày {dd/mm/yyyy}
Kỳ: {ky}

1) DOANH THU
- DT sau VAT: {money k.revenue}
- DT trước VAT: {money k.revenueBeforeVat}
- So kỳ trước: {▲/▼ k.momPct}
- Target: đạt {pct k.pctTarget}

2) TARGET NHÂN VIÊN
- {target.total} NV chưa đạt target   (hoặc: ✅ Tất cả đạt target.)
Top cần chú ý:
1. {name}: đạt {pct} · thiếu {money gap}
…(top 3)

3) CƠ SỐ THẦU
- {cst_low.total} dòng CST sắp cạn <10%   (hoặc: ✅ Không có CST sắp cạn.)
Top nguy cơ:
1. {product_name} · {unit_name} · còn {remain_pct}%
…(top 3)

4) ĐƠN VỊ GIẢM MẠNH
- {unit_down.total} đơn vị giảm so kỳ trước   (hoặc: ✅ …)
Top giảm:
1. {unit_name}: {money prev} → {money cur} · giảm {|mom|}%
…(top 3)

5) GỢI Ý XỬ LÝ
- (chỉ in dòng cho mục có total>0; nếu tất cả 0 → ✅ Không có việc cần chú ý.)

Mở app: {PUBLIC_URL}
```

### Nghiệm thu V2
- `/digest_test` (CEO): ra đủ 5 mục, top 3, số khớp trang Tổng quan/CST/Target cùng kỳ (đối chiếu vài điểm).
- `/digest_test` (1 NV sale): mục 1 & 2 nói "của bạn", mục 3/4 chỉ dữ liệu NV đó, **không lộ NV/đơn vị khác**.
- Mục có 0 việc → in dòng ✅ (không để trống); NV không CST/đơn vị nào → không rò số người khác.
- Số định dạng VN (phẩy thập phân); tin < 3500 ký tự; gửi plain text không lỗi Markdown.
- Định kỳ 07:30 VN ra bản V2 (giờ đã fix UTC-7). `/digest_short` vẫn ra bản 1 dòng.

## Nghiệm thu tổng
- Phiên: dùng liên tục >1h không hỏi OTP; 7 ngày trên cùng máy vào thẳng; máy lạ hỏi OTP.
- Digest: gửi thử `/digest_test` cho CEO ra đúng số toàn công ty; 1 NV sale ra đúng số của mình; NV chưa map/nghỉ không nhận; `/tat` ngừng nhận.
