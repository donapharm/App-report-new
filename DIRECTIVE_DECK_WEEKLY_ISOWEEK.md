# DIRECTIVE — SỬA kỳ "báo cáo TUẦN" của deck: tuần lịch ISO Thứ 2→Thứ 7 (KHÔNG lũy kế tháng)

> Claude Code giao bot (CEO chốt 2026-07-20). Deck báo cáo chuyên sâu đã ship (`728c734`) nhưng kỳ TUẦN đang chạy
> **lũy kế đầu tháng** (`salesReport.defaultRanges()`), khiến tuần ≈ tháng. CEO yêu cầu đổi sang **tuần lịch thật**.

## 1. QUYẾT ĐỊNH CEO (chốt)
- **Báo cáo TUẦN = 1 tuần lịch ISO**: **Thứ 2 → Thứ 7** (6 ngày; Chủ nhật không tính).
- Đánh số theo **tuần trong năm** (ISO week, năm ~52 tuần). **Hiện tại là tuần 30/2026.**
- **Báo cáo THÁNG giữ nguyên** (cả tháng / lũy kế trong tháng) — KHÔNG đổi.

## 2. VIỆC SỬA (chỉ ảnh hưởng `kind='week'`)
Trong `server/src/report/deckData.js` (hàm `build`) và/hoặc chỗ dựng `ranges`:
- Khi `kind='week'`: **range = tuần ISO chứa ngày chốt số** — `from` = **Thứ 2**, `to` = **Thứ 7** của tuần đó.
  - Nếu tuần hiện tại chưa đủ dữ liệu tới Thứ 7 (chạy giữa tuần/preview): `to` = min(Thứ 7, ngày data-as-of).
  - Lịch chạy chính thức **13h00 Thứ 7** ⇒ đúng lúc tuần Thứ 2→Thứ 7 vừa trọn.
- **So sánh (comparison):** tuần này vs **tuần ISO liền trước** (Thứ 2→Thứ 7 tuần trước), không phải "tháng trước".
- **Nhãn kỳ:** hiển thị `Tuần {ISO week}/{năm}` (vd **Tuần 30/2026**) + khoảng ngày `dd/mm–dd/mm`.
- `deckReport.fileStem` đã đặt tên theo `isoWeek(range.to)` → sau khi range đúng, tên file `..._TUAN_W30_2026_...`
  sẽ khớp tự nhiên. Kiểm lại hàm `isoWeek` cho ra **30** với ngày trong tuần hiện tại.
- `kysSpanning(from,to)` vẫn dùng để lấy dòng theo tháng chứa tuần; chỉ cần `applyFilters(dateFrom,dateTo)` cắt
  đúng Thứ 2→Thứ 7 (đã có sẵn trong `rowsInRange`). Số vẫn **grounded** — không đổi cách tính, chỉ đổi cửa sổ ngày.

## 3. KHÔNG được làm
- Không đụng kỳ THÁNG. Không đổi cách tính điểm/xu (xu vẫn theo QUÝ). Không hardcode "tuần 30" — phải suy từ ngày.
- Không phá 32-slide/CEO-only/grounding đã đạt.

## 4. NGHIỆM THU
1. `node server/src/report/deckReport.js --kind=week` → manifest `range.from`=Thứ 2, `range.to`=Thứ 7 (hoặc data-as-of),
   nhãn **Tuần 30/2026**, tên file `..._TUAN_W30_2026_...`.
2. So sánh trong deck tuần = **tuần trước** (không phải tháng trước); tổng doanh thu tuần **nhỏ hơn** tháng (không còn trùng).
3. `--kind=month` vẫn như cũ (cả tháng), không đổi.
4. 173 test vẫn PASS (thêm/chỉnh test kỳ tuần nếu cần). Ghi CHANGELOG; commit + push main; gửi lại CEO **DRAFT tuần** đã sửa để duyệt; báo Claude review.
