# DIRECTIVE — NLQ Mức 2: LLM hiểu NGÔN NGỮ TỰ NHIÊN (có/không dấu · Việt/Anh)

> Claude Code giao (CEO duyệt 2026-07-09). Bot triển khai `smart.js` + `llm.js`; Claude review.
> Lý do: Mức 1 (từ khóa cứng) thua câu tự nhiên. NV hỏi *"doanh thu tại mã 001, tháng 7 **tôi bán được bao
> nhiêu**"* / gõ **không dấu** / **tiếng Anh** → bot không hiểu. CEO yêu cầu: **hiểu ngôn ngữ tự nhiên, kể cả
> có dấu/không dấu, tiếng Việt/tiếng Anh.**

## 0. Nguyên tắc BẤT DI (giữ nguyên)
- **AI KHÔNG bịa số.** Mọi con số do `analytics.js`/`lookupUnits`/`lookupProducts` tính ở SERVER. LLM chỉ
  **hiểu ý + (nếu cần) diễn giải**, không tự chế số.
- **Quyền quyết ở backend.** NV sale chỉ thấy phạm vi mình (`scope.empCode`). LLM KHÔNG được nới quyền —
  app luôn áp `scope` khi tính.

## 1. Kiến trúc CHỌN: LLM trích Ý ĐỊNH → tái dùng Mức 1 (số ở lại server)
Thêm hàm mới trong `llm.js`, vd `interpretQuery(question)`, gọi Claude với **system prompt yêu cầu TRẢ JSON
cấu trúc** (không kèm số liệu):
```json
{
  "metric": "revenue" | "points" | "xu" | "target" | "cst" | "movement" | "overview" | "unknown",
  "dimension": "unit" | "product" | "emp" | "contractor" | "bid_package" | "province" | null,
  "unitHint":  "chuỗi tên/mã đơn vị người dùng nhắc (vd 'đồng nai', '001', 'bvdk dong nai') | null",
  "productHint": "tên/mã thuốc | null",
  "empHint": "mã/tên NV | null",
  "selfScoped": true|false,          // 'tôi', 'của tôi', 'I', 'my' → true
  "period": "MM.YYYY" | "current" | null,
  "listAll": true|false,             // 'top', 'liệt kê', 'theo đơn vị' → true (không drill-down)
  "needClarify": "câu hỏi lại nếu quá mơ hồ | null"
}
```
- **CHỈ gửi câu hỏi thô cho API** (để hiểu ý) — **KHÔNG gửi doanh thu/PII**. Entity do APP resolve.
- Sau khi có JSON: **app dùng lại code Mức 1**:
  - `unitHint`/`productHint` → `lookupUnits`/`lookupProducts` (fuzzy, đã có) → resolve + disambiguation.
  - `selfScoped` → ép `scope.empCode` của chính người hỏi.
  - `metric`+`dimension`+`listAll` → gọi handler tương ứng (drilldown / breakdown / ranking / overview / target / cst).
  - `period` → chọn kỳ.
- **Số + format + quyền: y như Mức 1** — chỉ thay "hiểu câu" từ regex sang LLM. → số KHÔNG rời server.

## 2. Định tuyến (hybrid, tiết kiệm)
- `llm.isEnabled()` (có `ANTHROPIC_API_KEY`):
  1. Thử `nlqIntent.classify` (regex) trước — nếu **chắc chắn** (intent rõ, không mơ hồ) → xử lý luôn (nhanh, 0 phí).
  2. Nếu regex **không chắc / trả 'unknown' / câu tự nhiên** → gọi `interpretQuery` (LLM) → xử lý theo §1.
- **Không có key → Mức 1 nguyên trạng** (không vỡ). (Đây là fallback bắt buộc.)
- (Tùy chọn, cờ `LLM_EXPLAIN_FACTS`=1) với câu **phân tích mở** ("nhận xét giúp tôi…") mới dùng `callLlm(facts)`
  sẵn có (gửi **số tổng hợp trong scope**) để LLM diễn giải. Mặc định TẮT để số không rời server.

## 3. Phải hiểu được (bộ ca test bắt buộc — bot chạy, dán kết quả)
Tất cả trả ĐÚNG như hỏi bằng câu chuẩn:
1. `doanh thu tại mã đơn vị 001, từ đầu tháng 7 đến giờ tôi bán được bao nhiêu` → **doanh thu CỦA CHÍNH NV** tại
   001 (đúng biến thể 001.BVĐK; nếu 001 khớp nhiều đơn vị thì hỏi lại gọn).
2. `001.bvdk dong nai` (KHÔNG dấu, gõ lại để chọn) → resolve về 001.BVĐK Đồng Nai, trả số.
3. `how much did I sell at Dong Nai hospital in July` (tiếng Anh) → doanh thu của NV tại 001 kỳ 07.
4. `san pham ban o benh vien dong nai` (không dấu) → SP tại đơn vị (hỏi lại 001/025 nếu mơ hồ).
5. `ai ban vixcar` / `who sells Vixcar` → NV bán SP đó (NV thường: chỉ mình).
6. `thang 7 toi dat bao nhieu phan tram target` → % target của NV.
7. Câu cũ vẫn đúng: `top 5 đơn vị`, `doanh thu theo sản phẩm` → liệt kê (listAll).
8. Quyền: NV thường hỏi "doanh thu công ty / NV khác" → chặn như cũ.

## 4. Kỹ thuật
- **ENV:** `ANTHROPIC_API_KEY=sk-ant-...` (bắt buộc bật) · `LLM_MODEL` mặc định `claude-haiku-4-5-20251001`
  (rẻ, nhanh — đủ cho trích ý; nâng `claude-sonnet-5` nếu cần chính xác hơn). Sau khi thêm key → `pm2 restart app-report-tgbot`.
- **Chi phí:** chỉ gửi câu hỏi ngắn → token nhỏ, đội ~17 người hỏi lẻ → phí không đáng kể.
- **An toàn:** `interpretQuery` phải **parse JSON chắc** (lỗi/format sai → fallback Mức 1, KHÔNG vỡ). Timeout ngắn.
- **Không lộ kỹ thuật** trong câu trả lời NV (giữ như Mức 1).
- **Disambiguation gọn** (kèm luôn): hiển thị `mã — tên ngắn` (vd `001 — BVĐK Đồng Nai`), bỏ phần tên lặp/pháp nhân dài.

## 5. Nghiệm thu
`node --check` OK; chạy 8 ca §3 dán kết quả (nhấn: không dấu + tiếng Anh + "tôi bán được bao nhiêu"); ghi
CHANGELOG; commit + push; báo Claude review. Sau đó CEO cho NV test thực tế.
