# DIRECTIVE — Xuất worklist "Đơn vị chưa gán tỉnh" để điền unit_province.json (CEO chốt 2026-07-22)

> Claude Code giao Report Bot. CEO chọn hướng **chuẩn 100%**: điền map `server/config/unit_province.json` (mã đơn vị → tỉnh),
> thay vì đoán tên. Bot xuất **worklist đơn vị chưa gán tỉnh** để CEO điền 1 lần. Làm cùng nhánh bảng UX / hoặc nhánh mới off main.

## 1. NGUỒN & CƠ CHẾ (đã có sau #146)
- `province.js` lấy tỉnh từ `row.province` **hoặc** `unit_province.json`; thiếu → "Chưa gán tỉnh".
- ⇒ Điền `unit_province.json` là App Report **tự áp** (đọc lại config, ~không cần deploy nếu chỉ đổi config; nếu cần thì restart nhẹ).

## 2. XUẤT WORKLIST (Excel, chuẩn VN #138 — CEO/ADMIN)
- Endpoint/nút: xuất **danh sách ĐƠN VỊ DUY NHẤT** đang "Chưa gán tỉnh" (chưa có ở `row.province` lẫn `unit_province.json`).
- Cột: **Mã đơn vị · Tên đơn vị · [Tuyến] · #NV liên quan · Doanh thu ảnh hưởng · cột trống "Tỉnh cần điền"**.
- **Xếp theo doanh thu ảnh hưởng giảm dần** → CEO điền đơn vị lớn trước.
- 1 dòng hướng dẫn đầu file: *"Điền cột 'Tỉnh cần điền' → nhập vào server/config/unit_province.json (mã→tỉnh) → App Report tự áp."*
- Chuẩn A4 ngang, số kế toán VN, font Unicode (như export hiện có).

## 3. (Tùy chọn) NHẬP NHANH
- Nếu tiện: cho **CEO/ADMIN dán/nhập** map tỉnh qua 1 màn admin nhỏ (ghi vào `unit_province.json` + audit) thay vì sửa file tay.
  KHÔNG bắt buộc đợt này — worklist Excel là đủ để bắt đầu.

## 4. RÀNG BUỘC
- Self-scope: worklist toàn roster = **CEO/ADMIN only**. Không lộ %/C32/C47 (chỉ mã/tên đơn vị/tuyến/doanh thu).
- Tỉnh điền là **nguồn chính thức** (người duyệt) — App Report **không đoán**. Đơn vị chưa điền vẫn "Chưa gán tỉnh" (trung thực).

## 5. NGHIỆM THU
1. Xuất Excel: đúng danh sách đơn vị "Chưa gán tỉnh", có cột trống "Tỉnh cần điền", xếp theo doanh thu ảnh hưởng.
2. Điền thử vài mã vào `unit_province.json` → mở app: các đơn vị đó ra đúng tỉnh; lọc Vùng/Tỉnh có tỉnh mới; số không đổi.
3. Self-scope + C32/C47 giữ. Test + build PASS. Push nhánh review; báo Claude; chưa deploy (trừ việc đã duyệt).
