# DIRECTIVE — NLQ Mức 3: CỖ MÁY TRUY VẤN TỔNG QUÁT (LLM hiểu MỌI khía cạnh, không vá từng câu)

> Claude Code giao (CEO chốt 2026-07-09). **CEO yêu cầu cốt lõi:** đừng sửa theo từng câu hỏi — phải sửa theo
> TOÀN NGỮ CẢNH để NV hỏi được **mọi khía cạnh**. Đã trả phí LLM thì để LLM làm **bộ não lập truy vấn**, không
> phải router vào vài handler cứng. Bot triển khai; Claude review. Thay cách tiếp cận "vá từng ca" (bỏ lối FIX2).

## 1. NGUYÊN TẮC KIẾN TRÚC
Thay "regex/LLM → chọn 1 trong N handler cứng" bằng **3 tầng tổng quát**:
1. **PLANNER (LLM):** câu hỏi bất kỳ (Việt/Anh, có/không dấu) → **1 JSON kế hoạch truy vấn** (DSL bên dưới). KHÔNG trả số.
2. **EXECUTOR (code, grounded):** chạy kế hoạch trên **toàn bộ dòng doanh thu trong phạm vi quyền** → ra bảng kết quả.
   MỌI con số ở đây. Luôn áp `scope` (NV chỉ thấy của mình). Đây là **1 cỗ máy tham số hóa**, không phải N hàm rời.
3. **NARRATOR:** diễn giải kết quả thành câu trả lời tiếng Việt (LLM trên FACTS đã tính, hoặc template) — **không bịa số**.

→ Vì Executor tham số hóa theo **mọi trường dữ liệu**, NV hỏi khía cạnh nào cũng trả được, không cần thêm handler.

## 2. DSL KẾ HOẠCH (PLANNER trả JSON đúng schema)
```json
{
  "answerType": "aggregate|breakdown|ranking|orders|comparison|advisory",
  "metric": "revenue|quantity|count|points|xu",
  "groupBy": "unit|product|emp|contractor|bid_package|province|route|source|day|order|null",
  "filters": {
    "unitHint": "string|null", "productHint": "string|null", "empHint": "string|null",
    "contractorHint": "string|null", "route": "CL|NCL|NT|null",
    "provinceHint": "string|null", "source": "CRM_MISA|APP_WEB_PARTNER|null"
  },
  "period": "MM.YYYY|current|null",
  "day": "today|yesterday|YYYY-MM-DD|null",
  "topN": "number|null",
  "splitBySource": true,
  "sort": "desc|asc",
  "selfScoped": true,
  "compare": "prev|none",
  "needClarify": "string|null"
}
```
Prompt PLANNER: nhận `CURRENT_PERIOD` + `LATEST_DATA_DATE` động. Hiểu "hôm nay/today"→day; "đơn hàng/order"→
answerType=orders/groupBy=order; "5 Misa 5 web"→splitBySource=true; "của tôi/I/my"→selfScoped; "so tháng trước"→
compare=prev. **Chỉ điền *Hint khi có tên thực thể RÕ**; câu liệt kê/tổng/đơn hàng → Hint=null (không tự bịa đơn vị).

## 3. EXECUTOR (code — nguồn số DUY NHẤT)
Trường dòng doanh thu có sẵn: `date, ky, emp_code, emp_name, unit_code, unit_name, route, iit_code, product_name,
contractor_code, contractor_name, bid_package, province, source(CRM_MISA|APP_WEB_PARTNER), source_order, revenue, quantity`.
Trình tự:
1. Chọn kỳ (`period`/`current` → latestKy) + phạm vi quyền (`scope` từ session; `selfScoped`/NV → ép empCode).
2. Lọc `filters` (resolve *Hint qua lookupUnits/lookupProducts…; mơ hồ → clarify gọn; route/source lọc trực tiếp).
3. `day` → lọc theo ngày (today = `latestDataDate`); ngày chưa có data → báo, không bịa.
4. `groupBy` → gộp `metric`. `order` → gộp theo `source_order`. `day` → theo ngày. `source` → theo nguồn.
5. `sort`+`topN`. `splitBySource` → topN **mỗi nguồn** (Misa + Web).
6. `compare=prev`: nếu **kỳ hiện tại CHƯA đủ tháng** → so **THEO NHỊP** (`prev × ngày đã trôi/ngày trong tháng`),
   nhãn "so nhịp T{trước}". **Tuyệt đối không hiện %ảo** kiểu 9 ngày vs cả tháng. Kỳ đủ tháng → full-vs-full.
7. Kèm nhãn freshness "📅 dữ liệu tới DD/MM" khi kỳ đang cập nhật.

## 4. NARRATOR
Trả lời gọn, tiếng Việt, kèm mã+tên. Nếu dùng LLM diễn giải: chỉ đưa **kết quả đã tính** (FACTS trong scope),
cấm chế số/đổi sai đơn vị tiền. Câu **tư vấn/phân tích** (advisory) → LLM trên facts tổng hợp như đã có.

## 5. QUYỀN & AN TOÀN (giữ tuyệt đối)
- **Quyền ở Executor**, không tin PLANNER: NV thường luôn bị ép `scope.empCode`; hỏi NV khác/công ty → chặn như cũ.
- Không bịa số; PLANNER lỗi/JSON sai → fallback code Mức 1 (không vỡ). Giờ Asia/Bangkok.

## 6. MA TRẬN TEST (rộng, không chỉ 3 câu — bot chạy, dán kết quả)
Nhóm theo khía cạnh để chứng minh "hỏi gì cũng được":
- **Thời gian:** "doanh thu hôm nay" · "doanh thu tháng này" (không %ảo) · "tháng 6" · "hôm nay so hôm qua".
- **Đơn hàng/nguồn:** "10 đơn hàng cao nhất hôm nay, 5 Misa 5 web" · "doanh thu từ Misa tháng này" · "web bán bao nhiêu".
- **Chiều:** "top 5 sản phẩm" · "doanh thu theo tuyến" · "top nhà thầu" · "doanh thu theo tỉnh".
- **Drill-down:** "doanh thu ở BVĐK Đồng Nai" · "sản phẩm ở 001" · "ai bán Vixcar".
- **Tự thân:** "tôi bán được bao nhiêu hôm nay" · "how much did I sell in July".
- **So sánh:** "tháng này so tháng trước" (theo nhịp) · "đơn vị nào giảm mạnh".
- **Tư vấn:** "tháng 7 ổn không" · "nên ưu tiên gì".
- **Quyền:** NV thường hỏi "doanh thu công ty / NV khác" → chặn.
Mỗi câu: đúng số (khớp analytics), đúng phạm vi, không %ảo, không hỏi lại sai.

## 7. NGHIỆM THU
`node --check` OK; dán kết quả ma trận §6 (theo nhóm); ghi CHANGELOG; commit + push; báo Claude review.
Sau đó CEO cho NV test tự do mọi khía cạnh — mục tiêu: **hỏi gì cũng trả đúng, hết ngáo**.
