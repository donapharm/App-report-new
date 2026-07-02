# SPEC — Dashboard "Cần chú ý" V2 (smart, phân nhóm)

> Claude Code (kiến trúc) chốt từ phản hồi CEO 2026-07-02. Bot triển khai; Claude review.
> Không đụng app cũ; mọi query qua scopeOf.

## Vấn đề hiện tại (ảnh CEO)
- 1857 cảnh báo dồn 1 danh sách phẳng, **lẫn lộn** NV / đơn vị / cơ số thầu.
- **NV đã nghỉ (DN014) vẫn hiện "0% target"**; vài dòng hiện MÃ (DN014, VP004) thay vì tên → tài khoản nghỉ/không còn trong danh bạ vẫn bị cảnh báo.
- Quá nhiều, không ưu tiên → không dùng được để ra quyết định.

## Nguyên tắc "smart"
1. **Ưu tiên + tóm tắt, không đổ hết.** Mỗi nhóm chỉ hiện top 5–8 + số tổng + "Xem tất cả".
2. **Phân NHÓM rõ ràng**, mỗi nhóm icon/màu riêng (không trộn).
3. **Chỉ cảnh báo NV ĐANG HOẠT ĐỘNG** = có doanh thu trong kỳ (`empCodesWithData(ky)`). NV nghỉ / 0 doanh thu → KHÔNG vào cảnh báo target.
4. **Luôn hiển thị TÊN.** Nếu không resolve được tên (không có trong danh bạ) → coi là tài khoản không hợp lệ, loại khỏi cảnh báo.
5. **Bấm cảnh báo / "Xem tất cả" → nhảy tới tab liên quan có lọc sẵn** (CST cạn → tab Cơ số thầu lọc <10%; NV chưa đạt → tab Target; đơn vị giảm → Doanh thu theo đơn vị).

## Backend — `buildAlerts` trả cấu trúc PHÂN NHÓM (đổi từ list phẳng)
```
{
  ky,
  summary: { emp_below_target, units_down, cst_low, cst_high },
  groups: [
    { key:'target',   icon:'🎯', title:'NV chưa đạt target',        total, items:[{emp_code,name,pct,revenue_before_vat,target,severity}] },
    { key:'unit_down', icon:'📉', title:'Đơn vị giảm mạnh (so kỳ trước)', total, items:[{unit_name,prev,cur,mom,severity}] },
    { key:'cst_low',  icon:'📦', title:'Cơ số thầu sắp cạn (<10%)',  total, items:[{product_name,unit_name,remain_pct,bid_package}] },
    { key:'cst_high', icon:'🟡', title:'Cơ số thầu tồn nhiều (>85%)', total, items:[...] },
  ]
}
```
Quy tắc từng nhóm:
- **target:** duyệt `empCodesWithData(ky)` (đang bán), tính pct = DT trước VAT / target; chỉ lấy pct < 80 (severity: <50 cao, <80 vừa). BỎ NV không có target thật (target=0 → không tính %), BỎ NV không resolve được tên. **Không** duyệt theo danh bạ/targets để tránh NV nghỉ.
- **unit_down:** so kỳ trước, MoM ≤ -15% (≤ -30% = cao).
- **cst_low / cst_high:** như hiện tại, tách 2 nhóm.
- Mỗi nhóm: sort nặng→nhẹ, `items` tối đa 8, kèm `total` (tổng thực).

## Frontend — Overview
- Giữ hàng KPI.
- Khối "Cần chú ý": đầu tiên là **strip tóm tắt** ("X NV chưa đạt · Y đơn vị giảm · Z cơ số cạn"), rồi các **KHỐI NHÓM** — mỗi khối: tiêu đề + icon + đếm, top 5–8 dòng, nút **"Xem tất cả (N) ›"** mở tab tương ứng (lọc sẵn).
- PC: bố cục nhiều cột theo mẫu trang **Phân tích**; mobile 1 cột.
- Mỗi nhóm màu viền riêng để không lẫn NV/đơn vị/CST.

## Khuyến nghị bước sau (không bắt buộc đợt này)
- Thêm field **status/active** trong danh bạ (`import_employees`): NV nghỉ → loại ở MỌI nơi (target, forecast, alerts, ranking). Chuẩn hơn heuristic "có doanh thu". Cần nguồn danh bạ có cột trạng thái.
