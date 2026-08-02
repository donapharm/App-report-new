# ‼ SỰ CỐ — DataHub NGƯNG trả dữ liệu chi phí (CEO phát hiện 01/08 16:53)

Màn "Chi phí của tôi" chế độ **Tất cả NV**, kỳ **07/2026** báo: *"nguồn chi phí DataHub chưa trả dữ liệu"* cho **21 mã** (DN001–DN012, DN016–DN019, DN021–DN024, VP004) — **1.465 cặp**. Kéo theo Tổng chi phí, C36/C41/C43/C44/C45 đều **0đ**, "Tổng sau phạt" = *Chưa đủ dữ liệu*.

**App Report đang fail-closed ĐÚNG** (không bịa số) — lỗi nằm ở **nguồn**. Không sửa App Report.

## Bằng chứng đây là sự cố MỚI (không phải trạng thái bình thường)
- **Sáng nay 01/08** cùng kỳ 07/2026: DN006 = **459.441.306đ**, DN009 = **336.334.260đ** → chi phí CÓ dữ liệu.
- **Chiều nay 16:53**: 21 mã đều không lấy được.
⇒ DataHub **mới ngưng trả trong ngày**.

## Nghi vấn hàng đầu
Bot vừa **đo bộ nhớ DataHub** (B1 mở phiên/Vault, đỉnh 548,5 MiB; nền cuối 346,2 MiB) và đang làm Worklist archive. Nghi service bị **restart / degrade / hết phiên** trong lúc đo. (Cùng nghi vấn với việc CEO bị bắt nhập **OTP lại** trên Data Hub — có thể chung một nguyên nhân mất phiên.)

## VIỆC CẦN LÀM (song song với dọn drift, đây là sự cố dữ liệu)
1. **Kiểm DataHub còn phục vụ endpoint chi phí không** — gọi thử đúng endpoint App Report dùng, cho 1 mã (vd DN006, kỳ 2026-07). Dán nguyên văn kết quả (200/timeout/401/500).
2. **Nếu lỗi phiên/token** (401/hết hạn) ⇒ khôi phục, nêu rõ vì sao mất (có phải do restart lúc đo bộ nhớ?).
3. **Nếu DataHub sống mà trả rỗng** ⇒ dữ liệu chi phí kỳ 07/2026 có còn trong DataHub không? Ai/việc gì làm mất?
4. **Kiểm luôn OTP Data Hub:** có "thiết bị tin cậy" như App Report (`auth.js`: OTP đúng 3 lần → nhớ máy, 30 ngày mới hỏi lại) chưa? Chưa có thì làm theo mẫu đó.

## NGHIỆM THU
- Mở "Chi phí của tôi" → **Tất cả NV** → kỳ 07/2026: **hết banner vàng**, Tổng chi phí ra **số thật** (không còn 0đ).
- Chọn DN006 → chi phí trở lại ~**459.441.306đ** như sáng nay.
- Nêu rõ nguyên nhân gốc + đã làm gì để không lặp lại.

## KHÔNG ĐƯỢC LÀM
- **Không** sửa App Report để "điền tạm" số cho hết banner. Banner đang báo đúng sự thật; che nó đi là giấu lỗi nguồn.
- **Không** gỡ cảnh báo fail-closed.
