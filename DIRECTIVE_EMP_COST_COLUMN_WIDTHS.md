# DIRECTIVE — Tinh chỉnh ĐỘ RỘNG cột bảng chi phí + tên cột % đầy đủ (CEO 2026-07-22)

> Claude Code giao Report Bot. Thuần **CSS/hiển thị** — không đổi số/dữ liệu/quyền. Làm **cùng nhánh bảng UX**
> (`review/employee-cost-table-ux-20260722`) rồi **deploy chung với worklist #148** (đã Claude PASS) — 1 lần.

## 1. CỘT % C36/C41/C43/C44/C45 — HIỆN ĐỦ TÊN CỘT
- Bỏ rút gọn "C36" → **hiển thị đủ tên** (vd "C36 CP ctv/khác (%)", "C44 Lương cuối năm (%)"…). Header **cho xuống dòng
  (wrap) 2 dòng**, cột vẫn gọn vì **giá trị ngắn** (0.0 / 12.0). Giữ badge "cuối năm" ở C44.

## 2. THU HẸP các cột (đang chiếm rộng thừa)
- **Thành tiền xuất bán (trước VAT)** — số căn phải, `tabular-nums`, width vừa số; bỏ rộng thừa.
- **Hàm lượng** — **1 DÒNG + cắt `…` + tooltip đầy đủ** (như QĐ141 đã làm), width hẹp cố định, KHÔNG cho nở hàng.
- **Nhân viên** — gọn: mã đậm 1 dòng + tên nhỏ 1 dòng cắt `…` (tooltip tên đầy đủ); width hẹp.

## 3. NỚI RỘNG các cột (đang bị xuống dòng nhiều, khó đọc)
- **Đơn vị** — tăng `min-width` để tên đơn vị dài (vd "033.PKĐK AN NGÃ TƯ VŨNG TÀU") **ít xuống dòng** hơn (tối đa 2 dòng).
- **Nhà thầu** — tăng `min-width` để "Công Ty TNHH … Pharma" gọn 1–2 dòng thay vì 3–4 dòng.

## 4. CÁCH LÀM (gợi ý)
- Đặt **`min-width`/`max-width` theo class từng cột** (không dùng width cứng phá layout). Cột cắt chữ dùng
  `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` + `title`/tooltip.
- Giữ **sticky** cột STT + Tên hàng và **cuộn ngang** trong khung `overflow-x:auto` (không tràn body).
- Áp cho **cả 1-NV lẫn "Tất cả NV"** (cột Nhân viên chỉ hiện ở chế độ tất cả NV). Bảng cân đối, không cột nào quá rộng/hẹp.
- Export Excel/PDF: giữ layout riêng của export (đã fit A4 ngang) — chỉnh này **chủ yếu cho bảng web**; nếu export cũng
  lệch rộng thì căn lại cho dễ đọc.

## 5. GIỮ NGUYÊN
- Không đổi số/công thức/thứ tự cột/quyền. Self-scope + C32/C47 giữ. STT/lọc/tìm/pager/ngày không đổi hành vi.

## 6. NGHIỆM THU
1. C36–C45 hiện **đủ tên** (header wrap), cột vẫn gọn.
2. Thành tiền trước VAT · Hàm lượng (1 dòng + …+ tooltip) · Nhân viên: **hẹp gọn**. Đơn vị · Nhà thầu: **rộng hơn, ít xuống dòng**.
3. Bảng cân đối, cuộn ngang OK, sticky giữ; desktop + mobile không tràn. Số không đổi.
4. Test + build PASS. Push cùng nhánh; báo Claude; **deploy chung với worklist #148**.
