# DIRECTIVE — Nút "Tải template target" + nhập file + sửa tay

> Claude Code giao (CEO 2026-07-03). Bot triển khai; Claude review. Luồng: CEO tải template có sẵn NV → điền target → upload → sửa tay khi cần.

## Nút "TẢI TEMPLATE" trong tab Quản target
- Thêm nút **"⬇ Tải template target"** (admin) → sinh file **Excel (.xlsx)** chứa sẵn:
  - Cột: **Mã NV | Tên nhân viên | Loại (NV/CTV) | Kỳ (MM.YYYY hoặc Qx.YYYY) | Target (đồng)**.
  - **Điền sẵn ĐÚNG 21 mã allowlist** (từ `target_roster.json`) với **TÊN CHÍNH XÁC lấy từ danh bạ** (không hardcode tên — lấy từ DB để luôn đúng).
  - Cột **Kỳ điền sẵn = kỳ đang chọn** trên bộ lọc (VD 08.2026); cột **Target để trống** cho CEO điền.
  - Sheet phụ "Hướng dẫn": điền số nguyên đồng (có/không dấu chấm đều nhận); Kỳ dạng `08.2026` hoặc `Q3.2026` (quý → tách 3 tháng); **KHÔNG sửa cột Mã NV**; để trống Target = không đổi NV đó.
- File mẫu tham khảo (định dạng cột): `templates/TARGET_TEMPLATE_MAU.csv` trong repo (CSV có sẵn 21 NV) — bot dựng bản .xlsx tương tự nhưng tên lấy từ DB.

## Nhập file (đã có luồng upload)
- Upload file đã điền → **preview** (số dòng, kỳ, tổng target, cảnh báo mã lạ/kỳ sai) → **commit** → có **batch/audit/rollback**.
- **Import theo MÃ NV** (tên chỉ tham khảo). Mã ngoài 21 allowlist → cảnh báo/loại, không nhận target cho người ngoài danh sách.
- Kỳ ≥ 07.2026 nguồn = `upload` (trong App Report, đúng quyết định "target chốt tại App Report").

## Sửa tay (đã có)
- Khi cần chỉnh vài NV → nút **"Sửa tay"** trên từng thẻ (nguồn `manual`, ưu tiên cao nhất, khóa không bị sync đè). Giữ nguyên.

## Nghiệm thu
- Bấm "Tải template" ra .xlsx đúng 21 NV + tên chính xác từ DB + kỳ đang chọn.
- Điền target rồi upload → preview + commit đúng; sai mã/kỳ bị cảnh báo; rollback được.
- Sửa tay 1 NV vẫn ăn (manual thắng). Số kế toán VN. Build OK.
