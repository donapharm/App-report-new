# DIRECTIVE — GĐ2b: Target chi tiết theo CHIỀU + %đạt theo chiều

> Claude Code chốt thiết kế (CEO 2026-07-03: triển khai GĐ2). Bot làm SAU GĐ1 + GĐ2a; Claude review. Dùng field `scope` đã có. Backend quyết quyền; NV chỉ thấy phần mình. Không đụng app cũ 3860.

## Ý tưởng cốt lõi: các chiều là "KÍNH LỌC CHỒNG NHAU", không phải chia ô
- 1 giao dịch (VD DN006 bán H.A* ở BV 027 tuyến CL) đồng thời tính vào: target **tổng** + target **nhóm H.A*** + target **đơn vị 027** + target **tuyến CL**.
- ⇒ Target theo chiều là **nhiều lăng kính độc lập** trên cùng doanh thu. **KHÔNG cộng dồn %đạt các chiều** (chúng trùng nhau).
- Target chi tiết là **TÙY CHỌN/CHỌN LỌC**: CEO chỉ đặt ở chiều muốn nhấn (VD giao riêng target nhóm "hàng cần đẩy"); còn lại roll-up vào target tổng.

## Model (đã có field scope)
`target_entry = {emp_code, ky, target, source, scope:{type, value}, ...}`
- `type ∈ all|group|route|unit|iit|special`; `value` = mã nhóm/tuyến/đơn vị/QLNB/loại special.
- 1 (emp, ky) có: 1 entry `all` (tổng) + nhiều entry chi tiết theo chiều. Resolver chọn active theo (emp,ky,scope): manual>upload>ai (kỳ≥07 không Lumos).

## Nhập target theo chiều (mở rộng Quản target)
- Trong modal nhập target: thêm **chọn CHIỀU** (Tổng / Nhóm / Tuyến / Đơn vị / Mã QLNB / Hàng cần đẩy) → chọn giá trị (typeahead) → nhập số.
- **Template/upload**: thêm cột `scope_type`, `scope_value` (trống = `all`). File có thể trộn nhiều chiều.
- Điều chỉnh theo lý do (GĐ2a) cũng nhận `scope` (điều chỉnh cho 1 chiều cụ thể được).

## %ĐẠT theo chiều (backend)
- Với target `scope={type,value}`: **lọc doanh thu của NV theo đúng chiều đó** rồi chia:
  - `group` → lọc `priority=value`; `route` → `route=value`; `unit` → `unit_code=value`; `iit` → `iit_code=value`; `special` → lọc theo tập mã của loại special (xem dưới); `all` → toàn bộ.
- `%đạt(chiều) = DT_trước_VAT(lọc theo chiều) / target(chiều)`. Kỳ đang chạy: pro-rate target theo ngày (đã chốt).
- Dữ liệu đã có `route/unit/iit_code/priority` → không cần đổi backend lõi, chỉ thêm filter + endpoint tổng hợp.

## Nhóm SPECIAL "hàng cần đẩy" (nối GĐ1)
- `special_kind ∈ ton_nhieu | sap_het_thau_cst_lon | can_date | hang_ngach` → mỗi loại resolve thành **tập mã QLNB** (từ CST/doanh số như SPEC_TARGET_ASSIGNMENT): tồn nhiều = `cst_high`; sắp hết thầu-CST lớn = gói gần hết hạn + remain cao; hàng ngách/cận date = danh sách (auto/CEO).
- Target `scope={special, special_kind}` → %đạt = DT của NV trên tập mã đó / target. Giúp đo "NV đẩy hàng cần đẩy tới đâu".

## Hiển thị
- **Thẻ NV**: dòng chính = target TỔNG + %đạt (gốc + sau điều chỉnh GĐ2a). **Bung ra** = danh sách target theo chiều đã đặt, mỗi dòng: chiều · giá trị · target · %đạt.
- **Không** hiện chiều nào CEO chưa đặt target (tránh rối). Chỉ hiện chiều có target.
- **Cảnh báo lệch (tùy chọn):** nếu CEO đặt target cho NHIỀU giá trị CÙNG 1 chiều (VD target từng đơn vị) → so `Σ target các đơn vị` vs `target tổng` cùng NV, lệch thì báo (KHÔNG tự ép). Không so chéo giữa các loại chiều (vì trùng nhau).

## NV view
- NV thấy: target tổng của mình + các target theo chiều của mình + %đạt từng chiều + điều chỉnh lý do (nếu có). Chỉ phần mình.

## Nghiệm thu
- Đặt target nhóm H.A* cho DN006 T08 → %đạt nhóm = DT H.A* của DN006 / target, đúng số; đặt target đơn vị 027 → %đạt đơn vị đúng; 2 cái độc lập, không cộng dồn.
- Target special "tồn nhiều" cho 1 NV → %đạt tính trên đúng tập mã tồn nhiều.
- Thẻ NV bung ra thấy các chiều đã đặt; chiều chưa đặt không hiện. NV chỉ thấy của mình.
- Kỳ đang chạy pro-rate; kỳ≥07 không Lumos. Build OK; số target tổng/đã chốt không đổi.
