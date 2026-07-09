# DIRECTIVE — NLQ Mức 1: ĐÀO SÂU THEO THỰC THỂ (drill-down "ở/tại đơn vị/SP/NV")

> Claude Code giao (CEO chốt 2026-07-09, từ feedback NV thật). Bot triển khai `smart.js` + `nlqIntent.js`;
> Claude review. Mục tiêu: **NV hỏi về 1 đơn vị/sản phẩm/NV cụ thể thì bot lọc ĐÚNG, không liệt kê toàn địa bàn.**
> Yêu cầu CEO: **làm sao NV hỏi kiểu gì cũng trúng** (không chỉ 1 ca). Nếu Mức 1 chưa đủ → sau này bật Mức 2 (LLM).

## 0. Sự cố thật (feedback NV)
NV hỏi *"doanh thu chi tiết **ở** BVĐK Đồng Nai tháng 7"* → bot trả **danh sách 14 đơn vị toàn địa bàn**.
NV hỏi *"sản phẩm **ở** bv đồng nai"* → bot trả **sản phẩm toàn địa bàn**. → Bot hiểu "xem gì" nhưng **bỏ mất "lọc ở đâu"**.

## 1. Nguyên nhân
`nlqIntent.classify` bắt nhánh **breakdown/ranking generic** (thấy "doanh thu"+"bệnh viện" → "liệt kê theo đơn vị")
TRƯỚC khi tới nhánh `entity_lookup`. → Câu có **tên 1 đơn vị cụ thể** vẫn bị hiểu là "liệt kê tất cả".
Cốt lõi: chưa phân biệt **"THEO đơn vị"** (liệt kê tất cả) vs **"Ở đơn vị X"** (đào sâu 1 đơn vị).

## 2. Định tuyến mới (BẮT BUỘC) — ưu tiên thực thể cụ thể trước breakdown generic
Trong `answerQuestion` (smart.js): **TRƯỚC** khi xử lý `breakdown`/`ranking`, kiểm tra câu có nêu **1 thực thể
CỤ THỂ** không (dùng `lookupUnits`/`lookupProducts` sẵn có + mã NV):
- Có match tin cậy 1 thực thể → **ĐÀO SÂU theo thực thể đó** (mục 3), KHÔNG liệt kê toàn bộ.
- Không có thực thể cụ thể (chỉ có cue chung "đơn vị"/"sản phẩm") → giữ nguyên breakdown/ranking như cũ.
- Tín hiệu ưu tiên drill-down: có giới từ **"ở / tại / của / trong / bên"** + tên, HOẶC `lookupUnits/lookupProducts`
  trả match đủ mạnh (khớp ≥ 1 token đặc trưng của tên, không phải chỉ chữ "bệnh viện/phòng khám" chung chung).

## 3. Các dạng câu + kết quả mong đợi (dữ liệu ĐÃ CÓ trong lookupUnits/lookupProducts)
`lookupUnits` đã tính mỗi đơn vị: `revenue`, `prods` (SP tại đơn vị), `emps` (ai bán tại đơn vị), `cst`.
`lookupProducts` tương tự cho sản phẩm. → Chỉ cần **định tuyến + định dạng trả lời**, không đụng dữ liệu.

| NV hỏi (ví dụ) | Bot trả |
|---|---|
| doanh thu ở BVĐK Đồng Nai | Tổng DT đơn vị đó + **top sản phẩm** + **ai bán** tại đơn vị (tóm tắt drill-down) |
| sản phẩm (chi tiết) ở BVĐK Đồng Nai | **Chỉ** breakdown sản phẩm TẠI đơn vị đó (từ `u.prods`, sắp giảm dần) |
| ai bán / NV nào bán ở BVĐK Đồng Nai | NV bán tại đơn vị đó (từ `u.emps`) |
| cơ số / mã thầu còn ở BVĐK Đồng Nai | CST tại đơn vị đó (từ `u.cst`) |
| Vixcar bán ở đâu / đơn vị nào bán Vixcar | Đơn vị bán SP đó (từ lookupProducts) |
| ai bán Vixcar | NV bán SP đó |
| doanh thu SP X ở đơn vị Y | Lọc chéo SP × đơn vị |
| doanh thu của tôi ở BVĐK Đồng Nai | Phần của chính NV tại đơn vị đó (theo scope) |

## 4. ‼ ĐỊNH HƯỚNG TÊN TRÙNG (disambiguation) — bắt buộc, ca thật đã gặp
Tên mơ hồ khớp NHIỀU đơn vị. VD **"đồng nai"** khớp cả `001.BVĐK Đồng Nai` VÀ `025.BVĐK ĐỒNG NAI -2`
(có trong ảnh NV gửi). Xử lý:
- **Nhiều match (2–5):** hỏi lại/liệt kê để NV chọn: *"Ý bạn là: **001.BVĐK Đồng Nai** hay **025.BVĐK Đồng Nai-2**?
  Nhắn kèm mã (001/025) giúp em."* — KHÔNG tự đoán 1 cái.
- **1 match rõ:** trả thẳng.
- **> 5 match:** gợi ý gõ cụ thể hơn / kèm mã.
- **Không match:** *"Chưa tìm thấy đơn vị/SP tên '…' có doanh thu kỳ này"* + gợi ý (vd top vài đơn vị gần đúng).

## 5. Quyền & kỳ (GIỮ NGUYÊN, không nới)
- **NV sale chỉ thấy phạm vi mình** (`scope.empCode`). "Ai bán ở đơn vị X" với NV thường → chỉ phần của họ,
  hoặc báo "Anh/Chị chỉ xem được dữ liệu của mình". CEO/admin xem tất cả. Dùng lại guard quyền đang có.
- Tôn trọng **tháng được hỏi** (`resolveKyFromQuestion`); kèm nhãn "📅 Dữ liệu tới DD/MM" như hiện tại.

## 6. Không bịa số & ngôn ngữ
- Mọi con số từ `getRows`/`getCst` (đã vậy). Không đủ tự tin hiểu câu → **hỏi lại**, không đoán bừa.
- Trả lời **gọn, tiếng Việt**, kèm **mã + tên** đơn vị/SP. Không lộ chi tiết kỹ thuật (tên hàm/DB/field).

## 7. Không được làm vỡ câu cũ (backward-compat)
Các câu "liệt kê/xếp hạng" vẫn phải chạy như cũ:
- "top 5 đơn vị doanh thu", "doanh thu theo sản phẩm", "top 10 mặt hàng", "ai dẫn đầu" → vẫn liệt kê toàn bộ.
- Chỉ chuyển sang drill-down khi có **tên thực thể cụ thể** (mục 2).

## 8. TEST BẮT BUỘC (bot chạy thử, dán kết quả cho Claude review)
1. `doanh thu chi tiết ở bệnh viện đa khoa đồng nai tháng 7` → DT của ĐÚNG đơn vị (kèm hỏi lại 001/025 nếu mơ hồ),
   KHÔNG phải danh sách 14 đơn vị.
2. `sản phẩm ở bv đồng nai` (sau khi chọn mã) → SP TẠI đơn vị đó.
3. `ai bán ở BVĐK Đồng Nai` → NV tại đơn vị đó (NV thường: chỉ phần mình).
4. `đơn vị nào bán Vixcar` → đơn vị bán SP đó.
5. `đồng nai` (mơ hồ) → hỏi lại 001 hay 025.
6. Câu cũ: `top 5 đơn vị`, `doanh thu theo sản phẩm` → vẫn liệt kê tất cả (không vỡ).
7. Quyền: NV thường hỏi "ai bán ở đơn vị X" → không lộ NV khác.

## 9. Nghiệm thu
`node --check` OK; chạy 7 test mục 8 dán kết quả; ghi CHANGELOG; commit + push; báo Claude review.
Sau khi chạy thật, CEO đánh giá NV đã thỏa mãn chưa — nếu chưa đủ → cân nhắc Mức 2 (LLM `llm.js` + `ANTHROPIC_API_KEY`,
số vẫn do analytics tính, không bịa).
