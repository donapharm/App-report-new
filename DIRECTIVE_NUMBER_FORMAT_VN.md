# DIRECTIVE — Chuẩn hiển thị SỐ theo kế toán Việt Nam (toàn app)

> Claude Code giao (CEO yêu cầu 2026-07-03). Bot triển khai; Claude review. Không đụng app cũ 3860. Chỉ đổi HIỂN THỊ, không đổi số/logic.

## ‼ ĐÍNH CHÍNH (CEO 2026-07-03): SỐ CHÍNH = ĐẦY ĐỦ, KHÔNG viết tắt "tỷ"
CEO phản ánh Tổng quan vẫn hiện **"2,67 tỷ"** làm số lớn. **SAI ý.** Yêu cầu:
- **Số headline/KPI/thẻ = ĐẦY ĐỦ theo kế toán VN:** `2.668.987.096đ` (KHÔNG phải "2,67 tỷ").
- Bot đang dùng `short()` ("2,67 tỷ") cho số lớn → **đổi sang `money()` đầy đủ**. Bỏ dòng phụ trùng lặp "…đ sau VAT" hoặc đổi thành nhãn khác (VD "trước VAT: …đ").
- **CHỈ được viết tắt (`2,67 tỷ`) ở TRỤC BIỂU ĐỒ** (chỗ quá chật). Mọi số đọc chính khác = đầy đủ.
- Cỡ chữ số lớn có thể giảm nhẹ để `2.668.987.096đ` vừa thẻ; phối `DIRECTIVE_MOBILE_UX.md` để không cắt trên điện thoại (xuống dòng nếu cần, không cụt).

## Chuẩn số tiền
- **Ngăn cách hàng nghìn = dấu CHẤM `.`**, số nguyên đồng (không lẻ), đuôi **`đ`**.
  - `1.000đ` · `1.000.000đ` · `10.000.000đ` · `2.670.947.096đ`.
- Dùng `toLocaleString('vi-VN')` (đã cho ra dấu chấm) + hậu tố `đ`. Bỏ kiểu viết tắt US `2.67 tỷ` (dấu chấm thành thập phân, sai chuẩn VN).
- Số âm (giảm): `-1.960.000đ` hoặc `▼ 1.960.000đ`, vẫn dấu chấm.

## Phạm vi áp dụng — TOÀN APP
- KPI, thẻ, bảng, danh sách, drill-down, cảnh báo, Target, CST, Phân tích, Tổng quan, Hỏi nhanh, **bản tin Telegram**, **Export Excel**.
- **Tooltip biểu đồ**: hiện **đầy đủ** theo chuẩn trên.
- **Trục biểu đồ (chart axis)**: được phép rút gọn cho đỡ chật, NHƯNG nếu rút gọn phải dùng **chuẩn VN**: `2,67 tỷ` / `352 tr` (**dấu PHẨY thập phân**, không phải `2.67`). Ưu tiên full ở nơi có chỗ.

## Số khác (không phải tiền)
- **Số lượng/đơn/dòng:** cũng dấu chấm hàng nghìn kiểu VN (`12.180`, `2.741`), không đuôi đ.
- **Phần trăm:** dấu phẩy thập phân VN (`90,6%`, `26,1%`).

## Lưu ý phối hợp MOBILE
- Số đầy đủ dài hơn → phối với `DIRECTIVE_MOBILE_UX.md`: **giá trị luôn hiện, không cắt mép**; canh phải, cỡ chữ hợp lý; tên dài thì ellipsis nhường chỗ cho số. Nếu 1 số quá dài trên mobile → cho xuống dòng riêng, KHÔNG cắt cụt.

## Kỹ thuật
- Chuẩn hóa ở **helper dùng chung** (`util.js` `money()`/format) → sửa 1 nơi, toàn app đồng bộ. Rà bỏ các chỗ tự format lẻ (`short()` kiểu `2.67 tỷ` US).

## Nghiệm thu
- Mọi số tiền toàn app + Excel + bản tin: dấu chấm hàng nghìn, đuôi đ, không lẻ (VD `2.670.947.096đ`).
- Không còn `2.67 tỷ` (chấm thập phân); nếu rút gọn thì `2,67 tỷ` (phẩy).
- % dùng phẩy (`90,6%`). Mobile không cắt số. Build OK; số liệu không đổi.
