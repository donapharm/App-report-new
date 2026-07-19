# DIRECTIVE — Doanh thu TỰ CUỘN sang tháng mới (mọi tháng, không vá tay)

> Claude Code giao (CEO 2026-07-09). Mục tiêu: **qua bất kỳ tháng mới nào (T8, T9, T10…) doanh thu tự nạp**,
> NLQ + báo cáo tự dùng kỳ mới — KHÔNG phải sửa code từng tháng. Bot triển khai/kiểm; Claude review.

## 0. HIỆN TRẠNG (đã có — chỉ cần xác minh + gia cố)
Hạ tầng cuộn tháng ĐÃ tồn tại, KHÔNG viết mới:
- `server/scripts/materialize_july_revenue.js`: `PERIOD.ky = REVENUE_REFRESH_KY || MATERIALIZE_KY || defaultKy()`
  → kỳ **động** (không cứng July, dù tên file gây hiểu nhầm). Chỉ tạo/replace slot **kỳ hiện tại**; **kỳ đóng đông cứng**.
- `server/src/revenueRefresh.js`: scheduler (`start()` gọi trong `index.js`) — mỗi 60s kiểm `isDue()`, trong giờ
  hành chính chạy `runOnce({ ky: currentKy() })` → materialize kỳ **hiện tại động** (Asia/Bangkok).
- NLQ (`smart.js`): kỳ mặc định = `latestKy()`/`currentKyByDate()` (động); LLM nhận `CURRENT_PERIOD` động.
- Báo cáo (`salesReport.js`): `latestDataDate()`/`defaultRanges` (động).
→ Về lý thuyết mọi tầng đã động. Việc còn lại: **CHỨNG MINH nó thật sự cuộn qua ranh giới tháng + gia cố**.

## 1. VIỆC BOT LÀM
**A. Xác nhận scheduler đang bật + armed (process app-report đang chạy):**
- Kiểm log có `[revenue-refresh] scheduler armed` + `enabled()`=true + in `config()`. Nếu đang tắt → bật
  (env bật refresh) + `pm2 restart app-report --update-env`. Báo lại config (cửa sổ giờ, tần suất).

**B. TEST cuộn tháng (bắt buộc, dán kết quả):**
- Giả lập kỳ mới, chạy tay:
  `REVENUE_REFRESH_KY=08.2026 REVENUE_DATA_AS_OF=... node server/scripts/materialize_july_revenue.js`
  → phải tạo slot `rev_2src_082026_*`, set **active cho 08.2026**; slot **07.2026 vẫn còn** (đông cứng, không mất).
- Kiểm chuỗi đọc: `store.getRows({ky:'08.2026'})` có dòng; `periodKys()` có `08.2026`.
- NLQ: hỏi *"doanh thu tháng 8"* → trả số T8 (không phải "chưa có dữ liệu"); *"doanh thu tháng 7"* vẫn ra T7.
- Báo cáo: `salesReport.defaultRanges()` với data tới T8 → `monthRange`/`monthKy` nhảy sang 08.2026.

**C. Ranh giới đầu tháng (quan trọng):**
- Xác nhận **tick đầu tiên trong giờ hành chính ngày 01 tháng mới** tạo slot tháng mới (không kẹt `lastSlot`
  của tháng cũ chặn). Nếu `isDue()`/`lastSlot` cần reset theo ky → gia cố để đổi tháng là chạy ngay.

**D. Gia cố "chốt sổ" tháng vừa đóng (nên có):**
- Đầu tháng mới, cho **materialize LẦN CUỐI kỳ vừa đóng** (hoá đơn về trễ vài ngày) rồi mới đông cứng — tránh
  T7 thiếu vài đơn phát sinh cuối tháng. (Cơ chế: chạy `REVENUE_REFRESH_KY=<kỳ vừa đóng>` 1 lần đầu tháng.)

**E. Dọn tên gây hiểu nhầm (tùy chọn, không gấp):**
- Đổi `materialize_july_revenue.js` → `materialize_revenue.js` (cập nhật tham chiếu trong `revenueRefresh.js`),
  giữ alias/symlink nếu nơi khác gọi. Thuần dọn dẹp, không đổi logic.

## 2. NGUYÊN TẮC (giữ)
- **Kỳ đóng ĐÔNG CỨNG** — không tự sửa số quá khứ (trừ lần chốt sổ ở D). Chỉ slot kỳ hiện tại được replace.
- Mọi mốc thời gian **Asia/Bangkok**. Không bịa số. Không đụng dữ liệu/số kỳ cũ khi tạo kỳ mới.

## 3. NGHIỆM THU
Dán: log `scheduler armed` + config; kết quả TEST cuộn tháng (B) — slot T8 tạo, T7 còn, NLQ + report nhảy T8;
xác nhận C (đầu tháng chạy). `node --check` OK. Ghi CHANGELOG. Commit + push. Báo Claude review.
Sau đó: qua T8 thật, theo dõi log ngày 01/08 xem slot T8 có tự tạo — báo Sếp.
