# YÊU CẦU CỦA CEO — Báo cáo doanh số CHUYÊN SÂU (deck trình chiếu) tuần & tháng

> Đây là **bản yêu cầu gốc, đầy đủ** do CEO đặt ra (2026-07-13), Claude Code ghi lại để **bot đọc một lần là hiểu
> trọn vẹn và triển khai được ngay**. Chi tiết kỹ thuật xem kèm `SPEC_REPORT_DECK_CHUYENSAU.md` (ánh xạ số từng
> slide) và `DIRECTIVE_REPORT_DECK_KICKOFF.md` (5 pha + lệnh test). Mẫu chuẩn:
> `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html`.

---

## 1. CEO muốn gì (một câu)
Một **báo cáo doanh số bán hàng chi tiết, chuyên sâu** — dạng **deck trình chiếu 32 slide** giống hệt mẫu — được
**sinh tự động theo tuần và theo tháng**, xuất **cả PowerPoint (.pptx) và HTML**, **gửi cho CEO** qua **email và
Telegram**. Bot dựng **bản nháp (DRAFT) gửi CEO duyệt trước**, duyệt xong mới chạy chính thức theo lịch.

## 2. Ai đọc — dùng để làm gì (RẤT QUAN TRỌNG)
- **Chỉ gửi cho MỖI MÌNH CEO.** **Tuyệt đối KHÔNG gửi cho nhân viên**, không gửi ai khác.
- CEO dùng bản này để **trình chiếu trên màn hình LED** báo cáo trước **toàn thể nhân viên**.
- ⇒ Vì trình chiếu công khai trước toàn công ty, đây là bộ mặt điều hành của CEO. Chuẩn chất lượng phải **CAO CẤP**:
  1. **Chính xác tuyệt đối** — mọi con số phải đúng, khớp hệ thống. Sai một số là mất uy tín CEO trước toàn thể NV.
  2. **Tinh xảo, thẩm mỹ** — bố cục đẹp, sang, chuyên nghiệp; chữ đủ lớn đọc rõ từ xa trên màn LED; 16:9 không vỡ.
  3. **Thông minh** — nhận định sắc bén, đúng trọng tâm điều hành, có chiều sâu (không sáo rỗng, không liệt kê khô).

## 3. Loại báo cáo & LỊCH GỬI (chốt)
| Loại | Khi gửi | Kỳ số liệu |
|---|---|---|
| **Tuần** | **13h00 Thứ 7 hằng tuần** | tuần làm việc vừa qua (đặt trong bối cảnh lũy kế tháng, so kỳ trước như mẫu) |
| **Tháng** | **18h00 ngày cuối tháng** | cả tháng đó, so tháng liền trước |
- Múi giờ **Asia/Ho_Chi_Minh**. Ngày cuối tháng là **động** (28/29/30/31 tùy tháng).
- Kỳ tuần/tháng và cách so kỳ trước: **dùng lại logic sẵn có** `salesReport.defaultRanges()` + `comparisonMeta()`
  (đã xử lý cuộn kỳ theo slot doanh thu active). Nếu ranh giới tuần cần CEO chốt lại, hỏi CEO trước khi bật lịch.

## 4. Định dạng & kênh gửi
- **2 định dạng bắt buộc:** **HTML** (deck mở trên trình duyệt, điều hướng slide) **+ PowerPoint .pptx** (mở được
  trên PowerPoint/Google Slides để CEO trình chiếu LED).
- **2 kênh gửi cho CEO:** **email** (đính kèm cả .html + .pptx) **và Telegram** (gửi **file** .pptx + .html, kèm
  caption ghi rõ kỳ). Telegram phải gửi được **tệp** (hiện bot mới gửi text → **bổ sung gửi document**).

## 5. Quy trình DRAFT — duyệt trước (bắt buộc)
1. Bot dựng bản **DRAFT** (tuần + tháng), tiêu đề/caption ghi rõ **`[DRAFT — CHỜ CEO DUYỆT]`**.
2. Gửi DRAFT tới **email + Telegram của CEO**.
3. CEO xem, phản hồi (chỉnh nội dung/thẩm mỹ nếu cần) → bot sửa → gửi lại tới khi CEO **OK**.
4. CEO duyệt xong → bot **bật lịch tự động** (mục 3) chạy chính thức. **Trước khi được duyệt, không coi là bản
   chính thức, không gửi tự động.**

## 6. Nội dung báo cáo phải có (bám mẫu 32 slide — nhóm theo mối quan tâm điều hành)
Mẫu chuẩn là **nguồn sự thật hình ảnh + nội dung**. Bot đổ số thật vào đúng bố cục mẫu. Các khối chính:
1. **Bìa + Nguồn dữ liệu & phương pháp** — kỳ, ngày chốt số, logo/QR; ghi rõ số nội bộ, **không** giá vốn/lợi
   nhuận; **xu tính theo QUÝ** (sang quý về 0, không chuyển tiếp).
2. **Tóm tắt điều hành** — Hứa hẹn / Rủi ro / Cơ hội (3 khối), rút từ số liệu thật.
3. **Tổng doanh số kỳ này vs kỳ trước** + chỉ số kỳ (tổng, chênh lệch, %).
4. **Doanh thu theo ngày** (biểu đồ cột).
5. **So sánh theo tuyến** CL · NCL · NT (bảng + đào sâu từng tuyến).
6. **Theo nguồn hàng** — Group-Dona (Donapharm + AFP Pharma) vs Đối tác (xếp hạng + tỷ trọng + chi tiết).
7. **Theo loại khách hàng** (BVĐK · TTYT · PKĐK) và **theo nhóm điều trị**.
8. **Nhân viên** — phân tầng hiệu suất, bảng xếp hạng doanh số, ai kéo lên/xuống so kỳ trước, doanh số cao nhưng
   tích xu thấp.
9. **Đơn vị/khách hàng** — top, tăng/giảm mạnh, dư địa khai thác nhóm hạng giữa.
10. **Sản phẩm** — top & cơ cấu danh mục, tăng/giảm/sản phẩm mới, định hướng danh mục.
11. **Điểm doanh số & tích xu Quý** — tổng quan, theo tuyến, chi tiết NV, cảnh báo xu (đúng luật: xu theo quý).
12. **Rủi ro & Cơ hội tổng hợp → Khuyến nghị hành động cụ thể → Kết luận điều hành cho CEO.**

## 7. Nguyên tắc số liệu (không thương lượng)
- **Mọi con số do hệ thống backend tính** (`analytics.js` / `diemXu.js` / helper trong `salesReport.js`). Slide
  nhận định/khuyến nghị **không được chứa số nào không rút ra từ dữ liệu đã tính**.
- **AI/LLM (nếu bật) chỉ diễn giải trên FACTS đã tính — CẤM tự chế số.** LLM tắt thì dùng câu theo ngưỡng, vẫn chạy.
- **Không hardcode PII/nhân viên/số của một kỳ cụ thể** trong template — mọi số đổ động theo kỳ.
- Trước khi gửi DRAFT, **đối chiếu tay** vài số chốt (tổng doanh thu, top đơn vị/SP, điểm/xu) với hệ thống.

## 8. Những gì KHÔNG làm (ranh giới)
- Không gửi báo cáo này cho nhân viên (chỉ CEO). Deck toàn công ty ⇒ quyền nhận **CEO/ADMIN**, kiểm ở backend.
- Không đụng báo cáo email per-NV hiện có trong `salesReport.js` (khác loại) — chỉ tách/dùng lại helper.
- Không phát giá vốn/lợi nhuận/PII ra ngoài. Xuất/gửi phải **đi qua backend + kiểm quyền**.

## 9. Xong là như thế nào (Definition of Done)
1. Sinh được deck **32 slide** cho kỳ tuần và kỳ tháng, **HTML + PPTX**, bố cục/màu **khớp mẫu**, 16:9 không vỡ.
2. Số ở các slide chính **khớp** hệ thống (đối chiếu tay 1 kỳ live).
3. Gửi tới **email + Telegram CEO**, nhận **đủ 2 tệp**, caption/tiêu đề đúng kỳ và có nhãn `[DRAFT]` ở bản nháp.
4. Có lịch **13h00 Thứ 7 (tuần)** và **18h00 ngày cuối tháng (tháng)**, chống gửi trùng, restart không chạy lại.
5. Ghi `CHANGELOG.md`; commit + push `main`; **gửi DRAFT cho CEO duyệt**; báo Claude review.

---
**Tài liệu kèm:** `SPEC_REPORT_DECK_CHUYENSAU.md` (số từng slide + PPTX + delivery) ·
`DIRECTIVE_REPORT_DECK_KICKOFF.md` (5 pha + test) · `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` (mẫu).
