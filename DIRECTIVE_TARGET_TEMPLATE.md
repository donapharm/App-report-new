# DIRECTIVE — Target: XUẤT ↔ SỬA ↔ UPLOAD (1 luồng khép kín) + sửa tay

> Claude Code giao (CEO 2026-07-03, gộp 2 yêu cầu làm 1). Bot triển khai; Claude review. Không đụng app cũ 3860.

## 1 LUỒNG DUY NHẤT: Xuất file → Sửa → Upload lại
CEO muốn 1 cơ chế **vừa làm template điền mới, vừa xuất để sửa lại**. → **Một nút xuất file** kéo ra **HIỆN TRẠNG target** (điền sẵn nếu đã có, để trống nếu chưa giao):

### Nút "⬇ Xuất / Tải template target" (admin, trong tab Quản target)
- Sinh file **Excel (.xlsx)** cho **kỳ đang chọn** (VD 08.2026 / Q3.2026), gồm **đúng 21 mã allowlist** (`target_roster.json`), cột:
  - **Mã NV | Tên nhân viên | Loại | Kỳ | Target hiện tại (đồng)**
  - **Tên lấy CHÍNH XÁC từ DB** (không hardcode).
  - Cột **Target điền sẵn giá trị đang dùng** của kỳ đó; **chưa giao → để trống** (⇒ file này vừa là "template điền mới", vừa là "bản để sửa").
- Sheet "Hướng dẫn": số nguyên đồng (có/không dấu chấm đều nhận); Kỳ `MM.YYYY` hoặc `Qx.YYYY` (quý → tách 3 tháng); **KHÔNG sửa cột Mã NV**; để trống Target = **giữ nguyên** NV đó (không xoá).

### Upload lại (đã có luồng upload)
- Tải file đã sửa → **preview** (dòng, kỳ, tổng target, cảnh báo mã lạ/kỳ sai, ô nào đổi) → **commit** → **batch/audit/rollback**.
- **Import theo MÃ NV** (tên tham khảo). Mã ngoài 21 → cảnh báo/loại. Kỳ ≥07 nguồn = `upload` (target chốt tại App Report).
- Ô để trống = giữ nguyên (không ghi đè về 0); muốn xoá target thì có quy ước riêng (VD nhập `0` hoặc cột "Xoá").

### Sửa tay lẻ (giữ nguyên)
- Chỉnh vài NV → nút **"Sửa tay"** trên thẻ (nguồn `manual`, ưu tiên cao nhất, khóa không bị đè). Không cần xuất/nhập cả file.

## File mẫu tham khảo
`templates/TARGET_TEMPLATE_MAU.csv` (21 NV) — định dạng cột; bản .xlsx bot sinh giống vậy + tên từ DB + target hiện tại.

## Nghiệm thu
- Bấm xuất → .xlsx đúng 21 NV, tên từ DB, kỳ đang chọn; ô Target = số hiện tại hoặc trống.
- Sửa vài ô rồi upload → preview thấy đúng ô đổi → commit; để trống = giữ nguyên; mã lạ bị loại; rollback được.
- Sửa tay 1 NV vẫn thắng. Số kế toán VN đầy đủ. Build OK.
