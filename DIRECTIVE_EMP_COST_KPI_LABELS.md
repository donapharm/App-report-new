# DIRECTIVE — Sửa nhãn KPI cho hết nhầm "dòng" (CEO hỏi 2026-07-22)

> Claude Code giao Report Bot. **Chỉ đổi CHỮ nhãn, KHÔNG đổi số/logic.** Làm **cùng nhánh UI** với KPI cards + thu gọn
> panel để deploy 1 lượt.

## 1. VẤN ĐỀ (CEO phát hiện)
Trang hiện có 2 ô đều ghi "dòng" nhưng đếm 2 thứ khác nhau → nhìn tưởng lệch:
- **"Số dòng" = 123** → đếm **dòng đơn hàng** (grain order-line: mỗi đơn × mặt hàng = 1 dòng) = `rows.length`.
- **"Khớp doanh thu" = 100/101 dòng** → đếm **cặp (đơn vị + mã hàng) DUY NHẤT** = `match.matchedRows/totalRows`.

123 dòng đơn gộp còn 101 cặp (1 mặt hàng bán cho 1 đơn vị qua nhiều đơn → nhiều dòng, 1 cặp). **Số ĐÚNG** — đo coverage
trên cặp duy nhất là cố ý (tránh order-line lặp làm méo ngưỡng 90%). Chỉ **nhãn trùng chữ "dòng"** gây nhầm.

## 2. SỬA (chỉ nhãn, cả KPI card lẫn dòng meta trong panel tháng)
- Ô KPI **"Số dòng"** → **"Số dòng đơn hàng"** (giá trị giữ nguyên = `rows.length`).
- Ô KPI **"Khớp doanh thu"** phần phụ: `100/101 dòng · ngưỡng 90%` → **`100/101 mã (đơn vị×mặt hàng) · ngưỡng 90%`**.
- Dòng meta trong panel tháng (`… khớp 99,0% (100/101 dòng)`) → **`… khớp 99,0% (100/101 mã đơn vị×mặt hàng)`**.
- (Tùy chọn) thêm tooltip/ghi chú nhỏ: *"Khớp đo trên số mặt hàng theo đơn vị (không theo từng đơn) — % chi phí gắn theo mã hàng × đơn vị."*

> CEO có thể đổi chữ (vd "cặp đơn vị–mã hàng" / "mã hàng theo đơn vị") — chọn 1 cách gọi rồi dùng nhất quán ở cả 2 chỗ.

## 3. GIỮ NGUYÊN
- **Không đổi số, không đổi công thức khớp/coverage.** `rows.length` vẫn là order-line; coverage vẫn đo trên cặp duy nhất.
- Không đụng C44, VAT-trước, self-scope, C32/C47, thu gọn panel, KPI cards.

## 4. NGHIỆM THU
1. KPI hiện "Số dòng đơn hàng 123" và "Khớp doanh thu 99,0% · 100/101 mã (đơn vị×mặt hàng)". Không còn 2 chữ "dòng" trùng.
2. Dòng meta panel tháng đồng bộ chữ. Số không đổi (123 / 100 / 101 / 99,0%).
3. Push cùng nhánh UI; test; báo Claude review; chưa deploy.
