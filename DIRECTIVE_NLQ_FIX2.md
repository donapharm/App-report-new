# DIRECTIVE — Sửa 3 lỗi NLQ khiến bot "ngáo" (CEO feedback 2026-07-09)

> Claude Code giao (từ 3 ảnh CEO). Bot sửa `smart.js`/`analytics.js`/`llm.js`; Claude review.
> 3 lỗi thật, ưu tiên theo mức "ngáo".

## P1 — [NGÁO NHẤT] Bỏ số "-49,3% so kỳ trước" ẢO cho kỳ ĐANG CẬP NHẬT
**Lỗi:** hỏi doanh thu công ty → *"14,4 tỷ (-49,3% so kỳ trước)"*. Đó là so **9 ngày đầu T7** với **cả tháng T6**
(30 ngày) → nhìn như sụt 49%, hoàn toàn sai. (Đúng lỗi "partial vs full" đã sửa cho báo cáo, chưa sửa ở NLQ.)
**Sửa:** khi kỳ hiện tại **chưa đủ tháng** (`periodFreshness().complete === false`):
- **KHÔNG hiển thị `momPct` thô** so cả tháng trước. Thay bằng **so THEO NHỊP**: `prevNhịp = DT_kỳ_trước × (ngày
  đã trôi / ngày trong tháng)`, rồi `%= (DT_hiện_tại − prevNhịp)/prevNhịp`. Nhãn rõ: *"so nhịp cùng kỳ T06"*.
- Hoặc nếu không muốn suy đoán: **ẩn %**, chỉ ghi *"kỳ đang cập nhật, mới 9/31 ngày"* (đã có nhãn freshness).
- Áp cho MỌI câu overview/doanh thu tổng (và cân nhắc web overview cùng logic). Kỳ ĐÃ đủ tháng → so full-vs-full như cũ.

## P2 — Hiểu "HÔM NAY" / theo NGÀY (data đã có `date` theo ngày)
**Lỗi:** hỏi *"doanh số hôm nay"* → bot trả **cả tháng**. Không lọc theo ngày.
**Sửa:**
- LLM `interpretQuery` thêm field **`day`**: `"today" | "YYYY-MM-DD" | null` (bắt "hôm nay/today/ngày DD/DD-MM").
- App: `day="today"` → dùng **ngày dữ liệu mới nhất** (`latestDataDate`, KHÔNG phải ngày lịch nếu data chưa tới);
  lọc `rows.filter(r => r.date === day)` rồi tính. Trả *"Doanh thu ngày DD/MM: … (X% tổng tháng)"*.
- Regex path cũng bắt "hôm nay/hôm qua/ngày N" cho câu đơn giản.
- Nếu ngày đó chưa có dữ liệu → báo *"Ngày DD/MM chưa có dữ liệu (mới tới …)"*, không bịa.

## P3 — Hiểu "TOP N ĐƠN HÀNG" + tách nguồn Misa / Web
**Lỗi:** *"10 đơn hàng doanh thu cao nhất, 5 Misa 5 web"* → bot đi **hỏi lại mã đơn vị 002/017** (LLM bắt nhầm
thành drill-down đơn vị). Sai hẳn.
**Sửa:**
- Dữ liệu có: `source` (`CRM_MISA` | `APP_WEB_PARTNER`), `source_order` (số đơn), `date`, `revenue`.
- LLM `interpretQuery` thêm `metric:"orders"` (hoặc `listOrders:true`) + `sourceSplit:true` khi hỏi "đơn hàng
  cao nhất/lớn nhất, theo nguồn". **KHÔNG được emit `unitHint`** cho câu kiểu này (đừng biến thành drill-down đơn vị).
- Handler mới: gom theo `source_order` (trong ngày/kỳ được hỏi), tổng revenue, sắp giảm dần, lấy top N. Nếu
  `sourceSplit` → **top 5 mỗi nguồn** (CRM_MISA + APP_WEB_PARTNER). Mỗi dòng: số đơn · nguồn · đơn vị · doanh thu.
- Giữ quyền: NV thường chỉ đơn của mình.

## Gia cố interpretQuery (chống bắt nhầm)
- Prompt LLM: nếu câu hỏi **liệt kê/top/đơn hàng/tổng hợp** mà KHÔNG nêu tên 1 đơn vị/SP cụ thể → `unitHint=null`,
  `productHint=null`, `listAll`/`listOrders` phù hợp. Chỉ emit hint khi có tên thực thể RÕ.
- Nếu `disambiguateEntity` sắp hỏi lại mà câu vốn là "top/đơn hàng/liệt kê" → **đừng hỏi lại đơn vị**, chạy list.

## Test bắt buộc (bot chạy, dán kết quả)
1. `doanh số toàn công ty hôm nay` → doanh thu NGÀY mới nhất (không phải cả tháng), % so tổng tháng.
2. `doanh thu công ty tháng này` → tổng tháng, **KHÔNG còn "-49% so kỳ trước" ảo** (ẩn hoặc "so nhịp").
3. `10 đơn hàng doanh thu cao nhất hôm nay, 5 Misa 5 web` → 5 đơn CRM_MISA + 5 đơn APP_WEB, **không hỏi lại đơn vị**.
4. `doanh thu tháng 6` (kỳ đã đủ) → vẫn so full-vs-full bình thường (không vỡ).
5. Câu cũ (top đơn vị / doanh thu ở BVĐK Đồng Nai / tôi bán bao nhiêu) → vẫn đúng.

## Nghiệm thu
`node --check` OK; dán 5 kết quả test; ghi CHANGELOG; commit + push; báo Claude review. Giữ: không bịa số, quyền,
giờ Asia/Bangkok.
