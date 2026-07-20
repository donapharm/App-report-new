# DIRECTIVE — Thêm theme "MODERN" + bố cục thích ứng cho deck báo cáo (CEO chốt 2026-07-20)

> Claude Code giao bot. CEO duyệt phong cách HIỆN ĐẠI (chưa chỉnh màu). **Thêm** theme này (song song bản hiện có),
> KHÔNG đụng grounding/CEO-only/32-slide/lịch đã đạt. Mốc hình ảnh: `docs/report-samples/MODERN_THEME_MOCKUP.html`.

## 1. Thêm theme chọn được
- Deck hỗ trợ **chọn theme** khi build: `--theme=modern` (mặc định giữ theme hiện tại, hoặc CEO chọn).
- `deckHtml.js` tách phần **màu/typography ra token theme** (CSS variables) để đổi theme không phải viết lại slide.

## 2. Design tokens — THEME "MODERN" (đã kiểm CVD đạt)
```
Nền trang:  #e9edf4   Slide: #ffffff   Panel/thẻ: #f6f8fc  Viền: #e5eaf1
Chữ:        #0f172a   Phụ: #6b7a90
Accent gradient: linear-gradient(120deg,#4f46e5,#0ea5e9)   (tím→xanh)
Trạng thái: xanh #16a34a · đỏ #e11d6a
Biểu đồ (6 màu, thứ tự cố định): #4F46E5 #0EA5A4 #F59E0B #E11D6A #0EA5E9 #16A34A
Font: sans-serif hệ thống (Segoe UI/Inter). Số KPI đậm 800, letter-spacing âm.
```
Đặc trưng modern: thẻ trắng bo góc 12–16px + bóng nhẹ; số KPI **rất lớn** + **pill tăng/giảm** bo tròn; số hero
**gradient** cỡ đại; cột biểu đồ **bo tròn đầu**, nhãn số trực tiếp; header có gạch accent mảnh. (Xem mockup.)

## 3. ‼ BỐ CỤC THÍCH ỨNG theo mật độ nội dung (yêu cầu chính của CEO)
Mỗi slide **tự cân** theo lượng nội dung — không để trang trống hoặc tràn:
- **Trang NHIỀU chữ** (bảng dài + nhiều bullet): giảm cỡ chữ **1 bậc**, **chia 2–3 cột**, giãn dòng đều, ưu tiên
  bảng gọn → **vừa khung 16:9, không tràn, không rối**.
- **Trang ÍT chữ** (1–2 ý): **tăng cỡ chữ** (số hero cỡ đại) + **chèn HÌNH minh hoạ** (SVG icon/line-chart/biểu
  tượng nhẹ) để trang **sinh động, không trống**.
- Cơ chế gợi ý: tính "điểm mật độ" mỗi slide (số dòng bảng + số bullet + số ký tự) → chọn 1 trong các **preset
  bố cục** (dense / normal / hero). Không hardcode theo số slide — theo nội dung thực.
- **Hình minh hoạ dùng inline SVG** (không tải asset ngoài) để PPTX render qua Playwright vẫn nét.

## 4. GIỮ NGUYÊN (không phá)
- Grounding (số từ backend, không bịa), CEO-only, đủ **32 slide**, PPTX + HTML, lịch tuần ISO/tháng.
- Không hardcode PII/số. Theme chỉ đổi trình bày, KHÔNG đổi số.

## 5. NGHIỆM THU
1. `--theme=modern` → deck 32 slide đúng tông mockup, không vỡ 16:9.
2. Có ít nhất 1 trang "nhiều chữ" gọn vừa khung + 1 trang "ít chữ" có số lớn + hình minh hoạ.
3. Bản theme cũ vẫn build được (không hỏng). Test cũ vẫn PASS.
4. Ghi CHANGELOG; commit + push main; gửi CEO DRAFT bản modern để duyệt; báo Claude review.
