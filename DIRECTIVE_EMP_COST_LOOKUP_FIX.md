# DIRECTIVE — SỬA GẤP: khóa lookup chi phí về (ĐƠN VỊ + MÃ HÀNG) — match sụt 2/222

> Claude Code giao Report Bot. Nhánh `review/employee-cost-templates-20260722` (`d0fd7c8`) gây regression match:
> T07 DN001 **2/222** (bản main đang chạy **170/183 = 92,9%**). Nguyên nhân = **khóa lookup**, KHÔNG phải DataHub.

## 1. NGUYÊN NHÂN GỐC
`d0fd7c8` đổi `buildCostLookup` sang **khóa CHỈ mã hàng (product-only)** + guard:
`if (signatures.size === 1 && rows.every(row => percentageSignature(row)))` → chỉ giữ mã hàng khi **mọi dòng chi
phí của mã đó có % giống hệt + đủ %**. Nhưng endpoint trả ~10.982 dòng/NV, mỗi mã hàng có nhiều dòng (khác đơn
vị/gói thầu), % không giống hệt → rớt gần hết → 2/222.

Bản main (170/183) ghép đúng theo **`unit` + `product`** (đơn vị + mã hàng).

## 2. SỬA (chỉ đụng lookup key)
- **Quay lại ghép (ĐƠN VỊ + MÃ HÀNG):** mỗi dòng doanh thu (đơn vị U × mã hàng P) → tra dòng chi phí đúng **(U, P)**
  → lấy % của dòng đó. **Bỏ guard "mọi dòng cùng product phải giống hệt".**
- Nếu vẫn muốn chặn nhập nhằng: chặn theo **(U, P)** — nhiều dòng chi phí cùng (U,P) khác % → **dòng đó `—`** (như
  main), KHÔNG rớt cả mã hàng.
- **Giữ nguyên** phần đã đúng: timeline % theo tháng (catalog V30.10), grain order-line, VAT trước, 2 mẫu
  (full-time 5 % / CTV chỉ C36), cột mới, hàm lượng 1 dòng, c44 tách, self-scope, C32/C47, công tắc, ghi chú C48.

## 3. NGHIỆM THU
1. **T07 DN001 khớp lại ~170/183 (≥90%)** — KHÔNG còn 2/222. DN021 (CTV) khớp hợp lý theo dữ liệu thật.
2. Thành tiền = doanh thu **trước VAT** × % (đối chiếu tay 1 dòng, khớp).
3. 2 mẫu đúng nhóm; cột/thứ tự/hàm-lượng-1-dòng giữ nguyên. Test cũ + test lookup PASS.
4. Push cùng nhánh review + dán match rate mới (DN001, DN021). Chưa deploy. Báo Claude review.

## 4. Ghi chú
- C48 (ghi chú) DataHub chưa có → cột Ghi chú tạm `—`, KHÔNG chặn nghiệm thu phần còn lại. (Task C48 giao DataHub Bot.)
