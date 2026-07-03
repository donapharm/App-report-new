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

## CĂN CỨ: dùng target T06/2026 (Lumos) làm mốc điền sẵn (CEO 2026-07-03)
CEO muốn lấy **target T06 Lumos (số cuối trước khi cắt)** làm căn cứ điền sẵn trong template để sửa rồi upload cho tháng mới. KHÔNG phá quyết định "chốt tại App Report" — vì CEO **sửa + upload** (nguồn `upload`), không auto-dùng Lumos.
- **Bước A — CHỐT GIỮ số T06 NGAY (trước khi cắt Lumos):** bot dump `V_TEM_TARGET_BONUS` kỳ **06.2026** cho 21 NV → lưu file căn cứ trong App Report (VD `data/target_baseline_202606.json`), backup. (Nếu legacy target 06 đã có sẵn thì đối chiếu cho khớp.) Nghiệm thu: đủ 21 mã, số khớp Lumos.
- **Bước B — Template điền sẵn theo căn cứ:** khi xuất template cho kỳ tương lai (VD 08.2026) mà kỳ đó **chưa giao target**, cột Target **điền sẵn số T06 Lumos** làm mốc, có nhãn cột ghi rõ "Căn cứ: target T06/2026". CEO **điều chỉnh** rồi upload → thành target kỳ đó (nguồn `upload`).
  - Nếu kỳ xuất **đã có target** → điền số hiện tại (như bản gộp ở trên); ưu tiên: target hiện tại của kỳ > căn cứ T06.
  - Có thể cho **chọn căn cứ** (dropdown khi xuất): "Trống" / "Theo T06/2026 (Lumos)" / "Theo kỳ gần nhất đã giao". Mặc định = **T06 Lumos**.
- **Không auto-áp:** số T06 chỉ là **mốc điền sẵn để CEO sửa**, KHÔNG tự thành target live nếu CEO không upload.

## File mẫu tham khảo
`templates/TARGET_TEMPLATE_MAU.csv` (21 NV) — định dạng cột; bản .xlsx bot sinh giống vậy + tên từ DB + target hiện tại.

## Nghiệm thu
- Bấm xuất → .xlsx đúng 21 NV, tên từ DB, kỳ đang chọn; ô Target = số hiện tại hoặc trống.
- Sửa vài ô rồi upload → preview thấy đúng ô đổi → commit; để trống = giữ nguyên; mã lạ bị loại; rollback được.
- Sửa tay 1 NV vẫn thắng. Số kế toán VN đầy đủ. Build OK.
