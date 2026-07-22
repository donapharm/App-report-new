# DIRECTIVE — Thêm KPI cards chi phí (doanh thu chưa VAT + tổng từng cột %, C44 nổi bật) — CEO 2026-07-22

> Claude Code giao Report Bot. Làm **cùng nhánh UI với thu gọn panel** (`DIRECTIVE_EMP_COST_VISIBILITY_COLLAPSE.md`)
> để deploy 1 lượt. Số **do backend tính** (nguyên tắc #3), FE chỉ hiển thị.

## 1. YÊU CẦU (CEO)
Hàng KPI hiện có: `Nhân viên · Số dòng · Khớp doanh thu · Tổng chi phí tháng`. **Thêm** các ô:
- **Tổng doanh thu (chưa VAT)** — từ `summary.revenueBeforeVatTotal` (đã có sẵn).
- **Tổng CP mỗi cột %**: C36 · C41 · C43 · C44 · C45 (mỗi cột 1 ô = Σ Thành tiền của cột đó).
- **‼ Ô C44 làm NỔI BẬT** (màu/viền khác + badge "cuối năm") vì là khoản cuối năm (T12), tách khỏi tổng tháng.

## 2. BACKEND (server/src/employeeCost.js) — thêm tổng theo cột
- Trong `summary`, thêm **`columnTotals`**: Σ `amounts[col.key]` theo TỪNG cột %, cho mọi cột trong `columns`.
  ```js
  columnTotals: (!hasGroundedRows || low) ? null
    : Object.fromEntries(columns.map((c) => [c.key, rows.reduce((s, r) => s + (r.amounts[c.key] || 0), 0)])),
  ```
- **Gate như `monthlyTotal`:** match < ngưỡng (90%) → `columnTotals = null` (ẩn, không hiện số thiếu).
- `revenueBeforeVatTotal` đã có — dùng lại, không tính lại ở FE.
- **Không** cộng C44 vào `monthlyTotal` (giữ nguyên); `columnTotals.c44` chỉ là tổng riêng của cột C44.

## 3. FRONTEND (web/src) — render ĐỘNG, không hardcode cột
- KPI mới dựng **động từ `columns[]`**: 1 ô "Doanh thu chưa VAT" + lặp `columns` tạo 1 ô/cột (label = `col.label`,
  số = `summary.columnTotals[col.key]`). **KHÔNG viết cứng c36/c41…** → mẫu CTV (chỉ C36) tự chỉ hiện 1 ô CP.
- **Ô cột `annual` (C44):** style **nổi bật** (vd viền/nền nhấn) + badge "cuối năm". Dùng `summary.annualColumnKeys`
  để biết cột nào annual (không hardcode "c44").
- `columnTotals == null` (match thấp) → các ô CP hiện "—" hoặc ẩn số như tổng tháng hiện tại (đồng nhất cơ chế <90%).
- **Bố cục:** hàng KPI **wrap** nhiều dòng cho gọn (10 ô: 4 cũ + doanh thu + 5 cột). Desktop dàn ngang wrap;
  mobile xếp dọc. Bám mẫu trang "Phân tích".

## 4. GIỮ NGUYÊN
- Số từ backend; FE không tính lại (nguyên tắc #3). Self-scope, C32/C47 khóa, VAT-trước, grain, công tắc — không đổi.
- Tổng chi phí tháng vẫn **41.144.556đ** (không gồm C44). C44 fix (`c44=c43×%`) đã ở nhánh review C44.

## 5. NGHIỆM THU
1. NV full-time: hiện đủ ô **Doanh thu chưa VAT + C36/C41/C43/C44/C45**; **C44 nổi bật + badge cuối năm**.
   Σ C36+C41+C43+C45 (4 ô, trừ C44) = **Tổng chi phí tháng** (đối chiếu khớp). C44 ô riêng = "Khoản cuối năm".
2. NV CTV (DN021): chỉ hiện ô **C36** (+ doanh thu) — dynamic đúng, không vỡ.
3. Match < 90% (vd DN021 0/3): các ô CP ẩn/"—" như tổng tháng.
4. Số các ô = backend `columnTotals`/`revenueBeforeVatTotal`; grep bundle FE không có số tĩnh.
5. Desktop wrap gọn; mobile dọc. Push cùng nhánh UI (kèm thu gọn panel); test; báo Claude review; chưa deploy.
