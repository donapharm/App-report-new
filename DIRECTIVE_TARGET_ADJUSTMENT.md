# DIRECTIVE — Điều chỉnh target theo lý do bất khả kháng (đứt hàng / công nợ)

> Claude Code giao (CEO 2026-07-03). Thuộc hệ Target (GĐ2 — lớp đánh giá công bằng). Bot triển khai; Claude review. Backend quyết quyền; NV chỉ thấy phần mình. Không đụng nguồn đã cách ly 3860.

## Mục tiêu
NV không đạt target do **yếu tố ngoài tầm** (đứt hàng, vướng công nợ) → cho **ghi nhận lý do + số tiền ảnh hưởng**, và **hạ target tháng đó tương ứng** để đánh giá công bằng.

## Model
`target_adjustment = { id, emp_code, ky, scope?, reason_type:'dut_hang'|'cong_no'|'khac', impact_amount, note, status:'pending'|'approved'|'rejected', by, at, approved_by, approved_at }`
- `impact_amount` = phần doanh thu bị mất vì lý do đó (đồng, trước VAT — cùng gốc với target).
- `scope?` = tùy chọn theo chiều (nếu điều chỉnh cho 1 nhóm/đơn vị/SP cụ thể); mặc định cả kỳ của NV.

## Luồng + DUYỆT (chống lạm dụng)
- NV/quản lý (hoặc CEO) **đề xuất** điều chỉnh (loại + số + ghi chú) → **CEO/admin DUYỆT** mới có hiệu lực. Chưa duyệt = `pending`, không ảnh hưởng số chính thức (chỉ hiện "đang chờ duyệt").
- Audit đầy đủ (ai đề xuất, ai duyệt, khi nào).

## Cách tính (CEO chốt: HẠ target)
- **Target điều chỉnh = Target gốc − Σ impact_amount (đã duyệt) của (emp, ky)** (không âm; sàn 0).
- **% đạt gốc** = DT trước VAT / Target gốc.
- **% đạt sau điều chỉnh** = DT trước VAT / Target điều chỉnh.
- Thẻ NV + KPI hiện **CẢ HAI**, kèm dòng "Đã trừ: đứt hàng {X}, công nợ {Y}". KPI Tổng có thêm dòng tổng đã trừ theo lý do.

## GỢI Ý TỰ ĐỘNG (đỡ nhập tay — CEO duyệt)
- **Đứt hàng:** nối cảnh báo **Hết CST / hàng đứt** (đã có) → gợi ý số tiền không bán được do hết cơ số của NV đó (giá thầu × phần thiếu). CEO xem, chỉnh, duyệt.
- **Công nợ:** nối phần **"còn nợ chưa giao"** (WEB partner) của NV → gợi ý số. CEO duyệt.
- Gợi ý chỉ là DRAFT; **không tự áp** — phải CEO duyệt.

## Phân tích điều hành
- Bảng tổng hợp theo kỳ/NV: **mất do đứt hàng bao nhiêu · do công nợ bao nhiêu · khác** → thấy nguyên nhân gốc để xử (nhập hàng / thu nợ).
- Không bịa: chỉ tính impact đã duyệt.

## Phạm vi + quyền
- CEO/admin: đề xuất/duyệt/xem toàn công ty. NV: xem điều chỉnh của mình (nếu cho đề xuất thì đề xuất phần mình).
- Áp cho target tổng + (khi có) target theo chiều.

## Nghiệm thu
- Ghi 1 điều chỉnh đứt hàng cho DN006 T07 (VD 200tr) → chờ duyệt → CEO duyệt → % đạt sau điều chỉnh tăng đúng (DT / (target−200tr)); thẻ ghi rõ "đã trừ đứt hàng 200tr".
- Chưa duyệt không ảnh hưởng số chính thức. Gợi ý tự động từ CST/công nợ ra draft đúng, không tự áp.
- Phân tích tổng hợp mất theo lý do đúng số; scope/quyền chuẩn; audit đủ. Build OK.
