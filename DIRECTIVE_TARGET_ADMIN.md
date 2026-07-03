# DIRECTIVE — Target admin (nhập file + tự động + AI + tay) + sửa danh sách NV + tách telesale

> Claude Code giao (CEO phản ánh Target sai/thiếu 2026-07-03). **Ưu tiên cao** — CEO đã yêu cầu từ trước nhưng chưa triển khai. Bot làm; Claude review. Theo `SPEC_TARGET_MULTISOURCE.md`. Không đụng app cũ 3860.

## 0-BIS) ‼ DANH SÁCH NV CÓ TARGET — CEO CHỐT CHÍNH THỨC 2026-07-03 (dùng làm CHUẨN)
Ô Target đang **lọt cả NV văn phòng** (heuristic role/status sai). **Bỏ đoán — dùng ĐÚNG allowlist 21 mã dưới đây** làm roster target (cờ `has_target`/danh sách cấu hình, KHÔNG suy từ role):

**21 mã có target:** `DN001, DN002, DN003, DN004, DN005, DN006, DN007, DN008, DN009, DN010, DN011, DN012, DN016, DN017, DN018, DN019, DN021, DN022, DN023, DN024, VP004`.

- **KHÔNG có target:** mọi mã ngoài danh sách (văn phòng, telesale VP018, đã nghỉ DN013/014/015, DN020…). Không hiện trong tab Target/Dự báo/cảnh báo.
- **Phân nhóm trong 21 mã (để gắn nhãn "chú ý", tất cả VẪN có target):**
  - **CTV đặc biệt cần chú ý:** `DN021, DN022, DN023, VP004` (đúng nhóm `no_auto_notify` — khóa gửi tự động).
  - **CTV gần mức NV fulltime:** `DN002, DN004`.
  - **NV fulltime:** các mã còn lại.
- Lưu allowlist thành **cấu hình/field trong danh bạ** (dễ CEO thêm/bớt sau), không hardcode rải rác. Resolver + forecast + %đạt + cảnh báo đều dựa allowlist này.
- **Nghiệm thu:** tab Target/Dự báo hiện **ĐÚNG 21 mã này, không dư không thiếu**; không còn NV văn phòng.

## ‼‼ NHẮC LẠI (CEO bực 2026-07-03) — VẪN CHƯA ĐÚNG
- Màn Target admin vẫn hiện **"35 NV/CTV"** gồm cả VP002/VP003/VP006 (văn phòng). **SAI.** PHẢI hiện **ĐÚNG 21 mã allowlist** ở mục 0-BIS, **không dư 1 mã văn phòng nào**. Bot rà lại `isActiveSalesUser`/roster → thay bằng allowlist cứng.
- **LẤY TARGET TỰ ĐỘNG (CEO muốn có số để tham khảo):** hiện cột "Nguồn" trống, "Target đang dùng 0đ" toàn bộ → CEO CHƯA thấy target tự động. Bot phải:
  1. **Xác định nguồn target thật** để kéo về làm số tham khảo: (a) target cũ app Report/Lumos `V_TEM_TARGET_BONUS` (01–06 từng có target thật); và/hoặc (b) App Sale nếu có bảng target/KPI theo NV/kỳ. Xác nhận nguồn.
  2. **Kéo về thành nguồn `appsale`/`legacy`** → thẻ hiện số thật (không phải 0đ), nhãn "Nguồn" ghi rõ lấy từ đâu.
  3. **AI đề xuất** hiện ở nguồn `ai` để CEO đối chiếu.
  → Mục tiêu: CEO mở tab Quản target thấy **21 mã, mỗi mã có số target tham khảo (từ nguồn tự động) + đề xuất AI**, rồi chọn/sửa.

## 1) SỬA "SAI/THIẾU" NGAY (không chờ Target admin)
- **Thiếu NV:** danh sách Target/Dự báo hiện lấy NV có bán trong kỳ mới nhất (T07 đang chạy dở → sót). **Sửa: lấy TOÀN BỘ đội sale đang hoạt động** (NV sale + CTV sale, status active), và **neo "target cũ"/xu hướng theo THÁNG ĐỦ GẦN NHẤT (T06)**, không dựa tháng đang chạy dở.
- **Tách TELESALE khỏi NV sale thị trường:** `VP018` (và telesale khác) là **telesale**, không phải NV sale thị trường. Thêm **loại NV** trong danh bạ: `sale` (thị trường) · `telesale` · `ctv` · `văn phòng`/khác. Danh sách target NV sale **chỉ gồm sale + ctv sale**; telesale tách nhóm riêng (xem câu hỏi CEO bên dưới).
- Kết quả: Dự báo hiện **đủ đội sale thật**, không lẫn telesale.

## 2) XÂY TARGET ADMIN (theo SPEC_TARGET_MULTISOURCE.md) — CEO chờ lâu
Cho CEO/admin quản target theo kỳ, **3 đường nhập**:
1. **Nhập bằng FILE (upload):** mẫu Excel `{emp_code, ky, target}`; preview + validate (mã NV hợp lệ, số hợp lệ) + commit + rollback (như `upload.js`). → nguồn `upload`.
2. **Tự động từ App Sale** (nếu App Sale có bảng target/KPI theo NV/kỳ — bot xác nhận; chưa có thì để hook, làm 2 đường kia trước). → nguồn `appsale`.
3. **AI đề xuất → CEO ÁP DỤNG:** forecast đã có; CEO bấm "Áp dụng" mới thành target thật (AI không tự chốt). → nguồn `ai`.
4. **Sửa tay:** CEO nhập/sửa từng ô. → nguồn `manual`, khóa không bị sync đè.
- Resolver chọn target active theo ưu tiên `manual > upload > appsale > ai` (SPEC_TARGET_MULTISOURCE). `store.getTargets` trả target active đã resolve → %đạt/cảnh báo/dự báo dùng đúng.
- Pro-rate target kỳ đang chạy theo ngày (đã chốt PA A) áp luôn.

## 3) TELESALE — CEO CHỐT 2026-07-03: KHÔNG giao target
- **Telesale (VP018…) KHÔNG có target.** → **Loại telesale khỏi:** danh sách Target/Dự báo, chấm % đạt, cảnh báo "chưa đạt", xếp hạng theo target. Không hiện đỏ, không tính vào "NV chưa đạt".
- Telesale vẫn **giữ trong danh bạ** (loại `telesale`, active); doanh thu của họ (nếu có) **vẫn tính vào tổng công ty** như thường — chỉ **không đánh giá target**.
- Tag `VP018 = telesale` ngay. **Còn chờ CEO:** danh sách telesale khác (ngoài VP018) để tag đủ; và xác nhận đội NV sale thị trường (hoặc bot suy từ status active + loại `sale`, CEO liếc lại).

## Nghiệm thu
- Dự báo/Target hiện **đủ đội sale thật**, không lẫn telesale; số NV khớp danh sách CEO xác nhận.
- CEO nhập target bằng file → lên app; AI đề xuất → bấm áp dụng → thành target; sửa tay được; có audit.
- %đạt/cảnh báo dùng target thật; kỳ đang chạy pro-rate theo ngày. Scope đúng; NV chỉ thấy mình.
