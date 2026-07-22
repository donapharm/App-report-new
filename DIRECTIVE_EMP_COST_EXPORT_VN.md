# DIRECTIVE — Export chuẩn VN (Excel + PDF, A4 ngang, số kế toán VN) — NV tự xuất phần mình (CEO 2026-07-22)

> Claude Code giao Report Bot. Áp cho **cả 2**: (1) **báo cáo "Chi phí của tôi"** (bảng chi phí), (2) **danh sách
> "Mặt hàng thiếu % chi phí"** (gap tool #137). **NV được TỰ XUẤT phần của mình** (self-scope). Làm cùng nhánh review gap tool.

## 1. AI XUẤT ĐƯỢC GÌ (self-scope, khóa ở backend)
- **NV** → xuất **của chính mình** (báo cáo chi phí + danh sách thiếu % của mình). Backend ép `emp = NV đăng nhập`,
  bỏ qua mọi `?emp=` khác.
- **CEO/ADMIN** → xuất NV bất kỳ / toàn roster.
- **Đi qua backend + kiểm quyền** (nguyên tắc #4). Audit mỗi lượt xuất. **Không** kèm dữ liệu NV khác; **C32/C47 không xuất**.

## 2. HAI ĐỊNH DẠNG: Excel + PDF
- Mỗi nút xuất cho chọn **Excel (.xlsx)** và **PDF**. Cùng nội dung/bố cục.
- **Excel:** số là **số thật** (SUM chạy được), gán **định dạng số** VN (mục 3); tiêu đề/nhãn tiếng Việt.
- **PDF:** App tự render nên **kiểm soát hiển thị 100%** — format số VN đúng tuyệt đối; **nhúng font Unicode đủ dấu tiếng
  Việt** (vd Times New Roman/DejaVu/Noto) — **cấm lỗi tofu/mất dấu**.

## 3. ‼ CHUẨN SỐ KẾ TOÁN VN
- **Phân cách hàng nghìn = dấu chấm; thập phân = dấu phẩy:** `41.144.556` ; `1.234.567,89`. Đơn vị **đồng** (đ).
- Cột số **căn phải**, `tabular-nums`. Số âm (nếu có) trong ngoặc đơn `(1.234)` theo lối kế toán.
- Ngày **dd/MM/yyyy**. %: hiển thị như trong app (vd `5,0` — dấu phẩy thập phân VN).
- Dòng **Tổng cộng in đậm**; **"Bằng chữ: … đồng"** cho tổng chi phí tháng (đọc số thành chữ tiếng Việt) — chuẩn chứng từ VN.
- **Excel:** dùng number format `#,##0` cho phần số (SUM được); PDF format chuỗi VN đúng như trên.

## 4. ‼ MẪU A4 QUAY NGANG (landscape) — in/xem đẹp
- Khổ **A4 ngang**, canh lề in hợp lý, **fit-to-width** (không tràn cột, bảng rộng co vừa 1 chiều ngang).
- **Đầu trang:** logo/tên **Công ty TNHH Dược phẩm Donapharm** · tiêu đề *"BÁO CÁO CHI PHÍ CỦA TÔI"* (hoặc *"DANH SÁCH
  MẶT HÀNG CHƯA CÓ % CHI PHÍ"*) · **kỳ** (Tháng/kỳ) · **Nhân viên** (mã · tên) · **Ngày xuất**.
- **Chân trang:** *"Nguồn số: DataHub (SSOT) · chỉ hiển thị chi phí của chính nhân viên"* · **số trang "Trang x/y"**.
- Ghi chú cuối bảng: **C44 = khoản cuối năm (tạm tính, chi trả T12), không tính vào tổng tháng**; dòng `—` = chưa có %.
- Header bảng **lặp lại mỗi trang** khi in nhiều trang; hàng tiêu đề nền nhấn, viền rõ.

## 5. NỘI DUNG THEO LOẠI
- **Báo cáo chi phí:** đúng cột như trên web (Ngày · Mã đơn · Tuyến · Đơn vị · Nhà thầu · Mã QLNB · Tên hàng · Hàm
  lượng · ĐVT · Giá trúng thầu · SL · Thành tiền trước VAT · các cột % + Thành tiền · Ghi chú) + **Tổng chi phí tháng**
  + **Khoản cuối năm (C44)** riêng. Hàm lượng QĐ141 rút gọn 1 dòng (như web). Mẫu full-time/CTV theo đúng nhóm.
- **Danh sách thiếu %:** gộp theo mã QLNB · tên hàng · #đơn vị · #NV · doanh thu ảnh hưởng · lý do · mã catalog gợi ý +
  cột trống **"% cần điền"** (như gap tool #137).

## 6. GIỮ NGUYÊN / RANH GIỚI
- Self-scope NV; số từ backend (không bịa); C32/C47 không xuất; audit. Export **đi qua backend**.
- App Report chỉ **xuất cái đang hiển thị/tính**; DataHub vẫn là SSOT của %.

## 7. NGHIỆM THU
1. NV đăng nhập → nút Xuất (Excel/PDF) ra **đúng của mình**; thử ép `?emp=` khác → vẫn của mình.
2. **Số kế toán VN:** `41.144.556`, thập phân dấu phẩy, đơn vị đồng, "Bằng chữ" cho tổng. Excel SUM chạy đúng.
3. **A4 ngang:** mở/in ra bảng gọn 1 chiều ngang, header lặp, có đầu/chân trang, **PDF không lỗi font tiếng Việt**.
4. Cả báo cáo chi phí + danh sách thiếu % đều xuất được 2 định dạng, đúng nhóm mẫu.
5. Không lộ NV khác/C32/C47; audit ghi. Test + build PASS. Push cùng nhánh review gap tool; báo Claude; chưa deploy.
