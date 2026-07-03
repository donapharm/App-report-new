# DIRECTIVE — Bố cục "smart app": nội dung chính nổi bật, công cụ phụ gọn (toàn app)

> Claude Code giao (CEO 2026-07-03: Quản target công cụ phụ chiếm >1/2 màn hình). Bot triển khai; Claude review. Không đụng app cũ 3860.

## NGUYÊN TẮC (áp TOÀN APP)
1. **Nội dung CHÍNH chiếm sân khấu** (~70–80% màn hình), hiện NGAY khi mở tab.
2. **Công cụ/hành động phụ gom vào 1 THANH NÚT gọn** (1 hàng), không phơi form ra sẵn.
3. **Form nặng (upload/nhập nhiều ô/tùy chọn) mở trong MODAL/DRAWER** khi bấm nút; xong đóng. Không để 3–4 khung form choán màn hình.
4. **Chữ giải thích dài → icon ⓘ tooltip** (di chuột/chạm mới hiện), không chiếm dòng.
5. Ưu tiên: xem > thao tác. Người dùng vào là thấy DỮ LIỆU, cần mới mở công cụ.

## ÁP NGAY: trang QUẢN TARGET (ví dụ mẫu)
Hiện đang phơi: đoạn resolver dài + Kỳ target + Choose File + Căn cứ template + Xuất + Rollback + AI + cả khối "Nhập Quý" → đẩy danh sách 21 NV xuống đáy. **Sửa:**
- **Thanh nút gọn 1 hàng** (dưới period picker): `[⬇ Template] [⬆ Upload] [📅 Nhập theo Quý] [🤖 AI đề xuất] [↩ Rollback]`.
- Bấm mỗi nút → **mở modal/drawer** chứa form tương ứng (Upload + chọn "Căn cứ template"; Nhập Quý = Năm/Quý/textarea/chia; AI đề xuất; Rollback theo mã). Đóng lại sau khi xong.
- **Đoạn "Resolver đang dùng…"** → **icon ⓘ** cạnh tiêu đề, tooltip hiện nội dung.
- **Danh sách 21 NV lên ngay dưới thanh nút** — là nội dung chính, chiếm phần lớn màn hình.
- Giữ đủ chức năng (không bỏ tính năng nào) — chỉ **thu gọn cách bày**.

## ÁP DẦN các màn khác (cùng nguyên tắc)
- **Upload** (doanh thu): các khung hướng dẫn/tùy chọn dài → gom nút + modal; bảng preview là chính.
- **Bộ lọc** các trang: nếu panel lọc quá cao → cho **thu gọn/mở rộng** (nút "Bộ lọc" bung drawer), để danh sách chiếm màn hình.
- Bất kỳ màn nào **công cụ phụ > nội dung chính** → refactor theo nguyên tắc trên.

## Nghiệm thu
- Mở Quản target: thấy NGAY danh sách 21 NV; công cụ chỉ 1 hàng nút; form bung trong modal/drawer; ⓘ tooltip cho chữ dài.
- Đủ chức năng cũ (template/upload/quý/AI/rollback) — chỉ gọn hơn.
- Mobile: nút gọn, modal full-width dễ thao tác; không tràn.
- Áp nguyên tắc nhất quán; build OK. Chụp trước/sau đối chiếu.
