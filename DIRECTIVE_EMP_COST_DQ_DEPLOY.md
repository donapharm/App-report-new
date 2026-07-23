# DIRECTIVE — DEPLOY Trung tâm Kiểm soát Dữ liệu (#141) — review PASS + xử "Lỗi máy chủ"

> Claude Code giao Report Bot. Nguồn: `review/employee-cost-dq-center-141` @ **`6ad9769`** — Claude review **PASS**.
> Read-only (chỉ phát hiện/cảnh báo), **không đổi tiền/không sửa dữ liệu**, self-scope + không lộ %/C32/C47 → rủi ro thấp.

## 0. ‼ "Lỗi máy chủ" trong ảnh CEO = CHƯA DEPLOY ĐỒNG BỘ (không phải lỗi code)
Tab "Kiểm soát Dữ liệu" hiện nhưng báo **"Lỗi máy chủ"** + 0 exception ⇒ endpoint `/employee-cost/data-quality` **chưa
reachable trên BE đang chạy**. Nguyên nhân khả dĩ (bot xác minh bằng `curl` xem mã thật):
- **404** → BE chưa nạp route (FE mới, **BE chưa restart/deploy**) — giống vụ "Tất cả NV" trống. **Fix: deploy FE+BE đồng bộ.**
- **503 `EMPLOYEE_COST_DQ_CONFIG_INVALID`** → thiếu/sai `server/config/employee_cost_data_quality.json` trên bản chạy. **Fix: deploy kèm config.**
- **502 `EMPLOYEE_COST_DQ_CATALOG_UNAVAILABLE`** → catalog kỳ chưa sẵn (DQ fail-closed để không phân loại sai). **Fix: đảm bảo catalog kỳ có.**
- **Kiểm:** `curl` `/employee-cost/data-quality?from=2026-07&to=2026-07` (session CEO) → phải **200** + JSON `summary`.

## 1. CÁC BƯỚC
1. Merge `6ad9769` → `main` (kèm `employee_cost_data_quality.json`).
2. `npm run build` web. **Deploy FE + RESTART BE đồng bộ.** Bảo đảm **config DQ có mặt** trên bản chạy + **catalog kỳ sẵn**.
3. Health + nghiệm thu §2. Ghi CHANGELOG. Báo Claude.

## 2. NGHIỆM THU SAU DEPLOY (dán cho Claude)
1. Tab "Kiểm soát Dữ liệu" **hết "Lỗi máy chủ"**; endpoint trả 200. Nếu T07 sạch → 0 exception là **đúng** (không phải lỗi);
   nên **test với dữ liệu có lỗi** (vd các mã gap "thiếu %", đơn vị UNALLOCATED 403tr) để thấy exception hiện + phân loại.
2. **5 rule** phân loại đúng (🔴 sai/nghi tiền: thiếu %, lệch mã QĐ, ĐVT lệch, giá thầu bất thường, phụ trách sai/UNALLOCATED;
   🟡 thiếu hiển thị). Mỗi lỗi có **nguyên nhân + hành động + nguồn sửa**; gộp theo mã gốc; xếp theo doanh thu ảnh hưởng.
3. **Chuông 🔔** hiện số lỗi đỏ chưa xử lý (badge); vượt ngưỡng → cảnh báo.
4. **Self-scope:** NV chỉ thấy lỗi của mình; **bell summary + trung tâm toàn cục = CEO/ADMIN** (NV không thấy toàn cục).
   **Không lộ %/C32/C47** ở API/export. Export VN chạy.
5. **Số chi phí không đổi** (DQ read-only). Config sai → 503, catalog thiếu → 502 (fail-closed, không báo bừa).

## 3. RỦI RO & ROLLBACK
- Read-only → rủi ro thấp. Bất thường → rollback về main trước deploy. Tab mở tải lại 1 lần.

## 4. GHI CHÚ
- Nhiều loại lỗi DQ (phụ trách sai/UNALLOCATED, thiếu %) sẽ **tự nhảy chuông** — thay việc điều tra thủ công. Đợt 2:
  trạng thái xử lý + gửi tóm tắt định kỳ (email/Telegram) — làm sau.
