# DIRECTIVE — App mặc định nhảy theo THÁNG LỊCH hiện tại (CEO chốt 2026-08-01, phương án 1)

**Bug:** hôm nay 01/08/2026 mà Tổng quan vẫn đứng ở **T07.2026**. Vì mặc định lấy **tháng data mới nhất** (`latest`), T08 chưa có đơn nên đứng ở T07.

**Root:** `web/src/pages/Overview.jsx:212` → `setPeriodSel(defaultPeriodSelection(p.periods, p.latest))`, mà `p.latest = store.latestKy()` (tháng có data cuối). `defaultPeriodSelection` (`PeriodFilter.jsx:29`) chỉ lấy `latest || periods.at(-1)`. → nhảy theo data, không theo lịch.
Đối chiếu: `EmployeeCost.jsx` đã dùng `currentMonthValue()` (theo lịch) — nên sửa cho **nhất quán**.

## Sửa (phương án 1 — thông minh)

1. **Mặc định = tháng LỊCH hiện tại theo giờ VN** (Asia/Bangkok), không phải `latest`. Dùng helper VN sẵn có (`revenueCoverage.bangkokToday` / `currentMonthValue`) → ky dạng `MM.YYYY` (01/08 → `08.2026`). Áp cho **Tổng quan** (và Doanh thu nếu cùng dùng `defaultPeriodSelection(..., latest)`).
2. **Tháng hiện tại phải CHỌN ĐƯỢC** dù chưa có data: thêm tháng lịch hiện tại vào danh sách `periods` (backend `/api/periods` nên trả thêm `currentMonth` VN + đảm bảo có trong list — làm SSOT ở server, đừng để mỗi trang tự chế). Trang xử lý period rỗng phải fail-mềm (hiện 0/—, không vỡ).
3. **Dòng nhắc khi tháng mới còn ít data + tháng trước chưa khoá sổ:** khi tháng đang xem = tháng lịch hiện tại VÀ tháng trước **chưa tới ngày khoá sổ 8** (dùng lại `employeeCost.isPeriodClosed`/`PERIOD_CLOSE_DAY`), hiện banner:
   > *"T08 mới bắt đầu · T07 đang chốt tới 08/08 — bấm để xem"*
   Bấm vào → chuyển period về **tháng trước** (T07). Tháng/ngày trong câu lấy động, không ghi cứng.

## Nghiệm thu
- Mở Tổng quan ngày 01/08 → mặc định **T08.2026** (không còn T07).
- Ô tháng chọn được T08 (dù data ~0); các ô KPI hiện 0/— gọn, không vỡ.
- Có banner "T07 đang chốt tới 08/08 — bấm để xem", bấm nhảy về T07 đúng.
- Sang ngày/tháng khác: câu chữ (T08/T07, 08/08) đổi theo, không hardcode. Sau khi T07 khoá sổ (>08/08) thì banner tự tắt.
- Không đụng công thức (`formulaVersion` không đổi).

## Cách giao
Fix nhỏ, thuần UI + 1 field server. Làm trên nền `origin/main` sạch (sau Bước 1 dọn drift), branch review → Claude soi → deploy từ main. Có thể gộp cùng đợt module GĐ1 nếu tiện.
