# SPEC (LỘ TRÌNH) — Target + Thưởng ĐA CHIỀU (thiết kế chừa chỗ, làm sau)

> Claude Code chốt hướng (CEO nêu tầm nhìn 2026-07-03). **Chưa làm đầy đủ bây giờ** — chỉ CHỪA CHỖ đúng để tương lai không đập lại. Bot áp điểm "làm ngay" bên dưới; phần còn lại làm khi CEO yêu cầu.

## Tầm nhìn (CEO)
Target + **thưởng** giao theo NHIỀU CHIỀU: nhóm ưu tiên hàng (H.A*/H.A/H.B…), hàng đặc biệt, tuyến (CL/NCL/NT), mã đơn vị, mã QLNB. Có **danh mục bán hàng tổng** + **mỗi NV biết mình phụ trách hàng gì, target bao nhiêu**.

## ✅ LÀM NGAY (rẻ, tránh đập lại) — bot áp vào target hiện tại
- **Thêm trường `scope` vào mỗi target_entry**, mặc định `all`:
  ```
  scope: { type: 'all'|'group'|'route'|'unit'|'iit'|'special', value: '' }
  ```
  - Hiện tại: mọi target `scope={type:'all'}` → hành vi Y HỆT bây giờ (target tổng/tháng).
  - Resolver + %đạt hiện chỉ xử `all`; nhưng schema đã sẵn để tương lai thêm target có scope cụ thể mà KHÔNG đổi mô hình.
- **Không** tính %đạt theo scope cụ thể ở bước này (chỉ `all`) — chỉ để chừa field. Ghi rõ trong code là "reserved for multi-dim".

## 🔜 LÀM SAU (khi CEO yêu cầu)
1. **Target đa chiều:** cho nhập target có `scope` cụ thể (nhóm/tuyến/đơn vị/SP/hàng đặc biệt). Một NV có thể có nhiều dòng target theo chiều khác nhau + 1 target tổng.
2. **%đạt theo chiều:** tái dùng dữ liệu doanh thu đã có `route/unit/iit_code/UT(nhóm)` → tính đạt theo đúng scope của target. Không cần đổi backend lõi.
3. **Lớp THƯỞNG (tách khỏi target):** policy bậc thang `{ngưỡng %đạt → mức thưởng}`, có thể theo chiều. Tính thưởng = f(%đạt, policy). Audit + duyệt. Gửi ra ngoài (Zalo/Email) giữ guardrail: **chỉ khi CEO duyệt**.
4. **Danh mục bán hàng tổng + PHÂN CÔNG:** bảng `{emp_code, đơn vị|SP|nhóm|"all", hiệu lực_từ/đến, trạng thái}` → mỗi NV thấy "mình phụ trách hàng gì". **Chính là module Phân công/Điều chuyển đã hoãn** (`SCOPE_DECISIONS`) — làm chung khi tới bước này. Nguyên tắc: điều chuyển chỉ áp tương lai, không hồi tố, lưu lịch sử.

## Nguyên tắc kiến trúc (giữ xuyên suốt)
- **Target ≠ Thưởng** (2 lớp riêng).
- **Định danh theo MÃ** (nhóm/tuyến/đơn vị/QLNB) — nhất quán nguyên tắc "mã là định danh".
- **Backend quyết quyền**; NV chỉ thấy phần/danh mục mình phụ trách.
- Cập nhật `SCOPE_DECISIONS`: "thưởng" từ CẮT → chuyển sang **SAU** (đưa lại lộ trình); gửi ra ngoài vẫn cần duyệt.

## Nghiệm thu bước "làm ngay"
- target_entry có field `scope` (mặc định `all`); hành vi hiện tại không đổi; build OK; %đạt vẫn đúng như trước.
