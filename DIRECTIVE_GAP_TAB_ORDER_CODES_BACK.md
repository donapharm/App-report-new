# DIRECTIVE — Tab "Mặt hàng thiếu %": THÊM MÃ ĐƠN HÀNG + NÚT QUAY LẠI (CEO 06/08/2026 23:16)

> CEO (xem tab Mặt hàng thiếu % T08, 4 mã · 6 cặp, lý do "Lệch mã QĐ/QLNB"):
> 1. *"đề nghị bổ sung mã đơn hàng để biết mã đơn hàng, yêu cầu kế toán/DN007/VP018
>    kiểm tra đúng mã đơn hàng và chỉnh sửa lại / hoặc ngăn đồng bộ qua."*
> 2. *"đề nghị có nút quay lại trang đang mở — hiện không có nút quay lại nên phải
>    bấm thao tác về chung."*

## 1. Mã đơn hàng trong từng dòng thiếu %

- **Backend** (`employeeCostGaps`): mỗi dòng gộp theo mã QLNB thêm `order_codes` —
  danh sách **distinct `source_order`** của các dòng doanh thu thuộc đúng các cặp
  (đơn vị × mã hàng) đó trong kỳ đang xem. Lấy từ **slot đang active** (dữ liệu đã
  có sẵn trong App Report) — KHÔNG truy vấn thêm nguồn ngoài, KHÔNG đổi cách gộp/đếm.
- **UI**: cột "Mã đơn hàng" hiện tối đa **3 mã + «+N nữa»** (bấm thì xổ đủ). Mã đơn là
  mã tra cứu, **KHÔNG bị con mắt che** (đúng luật SPEC_PRIVACY_EYE: chỉ che tiền/%/Xu).
- **Export Excel/PDF**: gồm **đủ** danh sách mã đơn từng dòng (không cắt 3).
- Mục đích ghi rõ trên UI (tooltip/chú thích): *"Đưa mã đơn cho kế toán / DN007 /
  VP018 tra và sửa tại nguồn, hoặc quyết ngăn đồng bộ."* App Report vẫn **chỉ phát
  hiện + gợi ý** — không tự sửa mã, không tự chặn đồng bộ (nguyên tắc sẵn có của tab).

## 2. Nút quay lại

- Tab **"Mặt hàng thiếu %"** và **"Kiểm soát dữ liệu"** thêm nút **"← Quay lại"** ở
  đầu khối: trở về tab **"Chi phí theo nhân viên"** (trạng thái bộ lọc/kỳ đang chọn
  giữ nguyên). Nếu người dùng vào bằng điều hướng sâu (drill từ màn khác) thì dùng
  `NavCtx.back` sẵn có — không dựng cơ chế điều hướng thứ hai.
- Mobile giữ cùng hành vi.

## Nghiệm thu

1. Mỗi dòng thiếu % có mã đơn; đếm distinct khớp số dòng doanh thu của cặp trong slot.
2. Con mắt ẩn số: tiền che, **mã đơn không che**.
3. Excel xuất đủ mã đơn; qua backend + kiểm quyền như cũ.
4. Nút "← Quay lại" trả đúng về tab Chi phí theo nhân viên, giữ nguyên kỳ + bộ lọc.
5. Không đổi số liệu nào khác của tab (coverage, số mã, số cặp giữ nguyên).

## Xếp hàng

Gộp vào **đợt kế tiếp cùng dự án `SPEC_CATALOG_COST_COLUMNS.md`** (cùng khu màn hình,
cùng đợt nghiệm thu) — sau khi đóng V-C/V-D của LENH_06082026.
