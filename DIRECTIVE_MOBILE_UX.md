# DIRECTIVE — Dựng lại bản hiển thị MOBILE (responsive) cho toàn app

> Claude Code giao (CEO phản ánh qua ảnh mobile 2026-07-03, tài khoản NV sale). Bot triển khai; Claude review. Ưu tiên cao — NV đi thị trường dùng điện thoại là chính. Không đụng app cũ 3860.

## Lỗi quan sát trên ảnh (≤414px)
1. **Giá trị bên phải bị CẮT/tràn mép** (VD "11 tr", "10 tr" ở Phân tích cụt mất) — cột số không đủ chỗ, bị đẩy ra ngoài viewport.
2. **Header xanh (logo + tên NV + Đăng xuất) ĐÈ lên dòng nội dung đầu tiên** ("23 tr" dính vào header).
3. **Thẻ/thanh "Cơ cấu tuyến/nhà thầu/UT" tràn ngang**, giá trị xa mép phải bị khuất; nhãn "UT" lạc dòng.
4. **Tên đơn vị/SP dài** (VD "Công Ty Tnhh Dược Phẩm Và Trang Thiết Bị Y Tế Đại Trường…") đẩy cột giá trị ra ngoài.
5. Có **cuộn ngang** (không nên có trên mobile).

## Yêu cầu (mobile-first, ≤414px)
1. **KHÔNG tràn ngang** — mọi thứ vừa bề rộng màn hình; không bao giờ cuộn ngang. `box-sizing: border-box`, `max-width:100%`, `overflow-wrap`.
2. **Dòng "tên — giá trị"**: dùng flex, **giá trị LUÔN hiện** (không co về 0, không bị cắt); **tên co giãn** và **xuống dòng hoặc … (ellipsis)** nếu dài. Ưu tiên giữ số bên phải đọc được.
3. **Header**: sticky nhưng **chừa khoảng cho nội dung** (không đè). Kiểm z-index + padding-top phần nội dung. Tên NV dài → ellipsis, không đẩy layout.
4. **KPI**: xếp **1 cột dọc full-width** (hoặc 2 cột nhỏ gọn nếu vừa), không tràn. Số lớn (VD "3.06 tỷ") không vỡ khung.
5. **Cơ cấu / thanh bar**: nhãn dài ellipsis; giá trị hiện gọn (tỷ/tr); thanh không vượt mép.
6. **Bộ lọc + combobox typeahead**: full-width, dễ chạm (nút/ô đủ lớn), dropdown không tràn màn hình.
7. **Biểu đồ (Recharts)**: `ResponsiveContainer` co đúng bề rộng; không tràn; nhãn trục gọn.
8. **Bottom-nav**: giữ, không che nội dung cuối (chừa padding-bottom).
9. Chữ/khoảng cách hợp mobile (không quá nhỏ/chật).

## Nguyên tắc
- Mobile = **1 cột dọc**; PC giữ layout Phân tích (nhiều cột) như chuẩn đã có.
- Dùng **breakpoint nhất quán** (VD ≤640px = mobile). Sửa ở CSS/khung dùng chung để **mọi trang** (Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, CST, Target, Hỏi nhanh, Login, Upload) cùng đúng — không sửa lẻ 1 trang.
- Không đổi số liệu/logic quyền — chỉ layout/CSS.

## Nghiệm thu
- Test thật ở **375 / 390 / 414px** (iPhone), CẢ tài khoản **CEO và NV sale**.
- Không còn cắt số, không đè header, không cuộn ngang ở mọi trang.
- Tên dài hiển thị ellipsis/wrap gọn; giá trị luôn đọc được.
- PC vẫn đúng như trước (không vỡ desktop). Build OK.
- Chụp lại vài màn mobile để đối chiếu trước/sau.
