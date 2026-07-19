# SPEC — Target chi tiết đa chiều + Danh mục NV phụ trách (phân công)

> Claude Code chốt thiết kế (CEO 2026-07-03: làm luôn). Bot triển khai theo GIAI ĐOẠN; Claude review từng GĐ. Xây trên `SPEC_TARGET_BONUS_ROADMAP` (field `scope` đã có). Backend quyết quyền; NV chỉ thấy phần mình. Không đụng nguồn đã cách ly 3860.

## THỨ TỰ TRIỂN KHAI (Claude chốt, CEO "theo ý em" 2026-07-03)
1. **GĐ1** — Danh mục bán hàng tổng + Bảng PHÂN CÔNG (gieo mầm 04–06) + màn "Tôi phụ trách". *(nền tảng, đang làm)*
2. **GĐ2a** — **Điều chỉnh target theo lý do** (đứt hàng/công nợ) — `DIRECTIVE_TARGET_ADJUSTMENT.md`. Làm SỚM vì độc lập + giá trị quản lý ngay, chạy được trên target hiện tại.
3. **GĐ2b** — Target chi tiết theo CHIỀU (nhóm/tuyến/đơn vị/QLNB/special) + %đạt theo chiều.
4. **GĐ3** — Thưởng bậc thang.
Mỗi GĐ: bot làm → push → Claude review → CEO xem → mới sang GĐ sau.

## Nguyên tắc chung
- **Định danh theo MÃ** (đơn vị/nhóm/QLNB/tuyến). Tên chỉ là nhãn.
- **Không hồi tố:** phân công/điều chuyển chỉ áp từ kỳ hiệu lực; lịch sử giữ nguyên. Lưu **audit** đầy đủ.
- **Target ≠ Thưởng** (2 lớp). GĐ này làm target + phân công; thưởng để GĐ3.
- Gieo mầm từ dữ liệu thật (giảm nhập tay).

---

## GIAI ĐOẠN 1 — DANH MỤC + PHÂN CÔNG (làm trước)

### 1A) Danh mục bán hàng tổng (master catalog)
- Hợp nhất từ dữ liệu đã có: `iit_code · tên · hoạt chất · hàm lượng · nhóm UT (H.A*/H.A/H.B…) · tuyến (CL/NCL/NT) · gói thầu · nhà thầu(mã-tên) · giá thầu · (CST còn nếu có)`.
- Xem/tìm được (tái dùng typeahead + bộ lọc). Có thể dùng chính tab Sản phẩm làm "Danh mục", thêm chế độ xem toàn danh mục (không chỉ theo kỳ bán).

### CHIỀU PHÂN CÔNG (CEO chốt 2026-07-03: đủ 5 chiều + nhóm "hàng cần đẩy")
`type ∈`:
- `unit` — đơn vị/bệnh viện (chiều chính).
- `group` — nhóm ưu tiên hàng (H.A*/H.A/H.B…).
- `route` — tuyến (CL/NCL/NT).
- `iit` — mã QLNB cụ thể.
- `all` — toàn bộ phần của NV (mặc định).
- **`special` — HÀNG CẦN ĐẨY (CEO nhấn mạnh)**, gồm sub-loại (`special_kind`):
  - `can_date` — **cận date** (cần dữ liệu hạn dùng; nếu nguồn chưa có → dùng danh sách CEO chọn, ghi rõ "thiếu nguồn hạn dùng").
  - `ton_nhieu` — **tồn nhiều**: suy TỰ ĐỘNG từ CST còn cao (tái dùng `cst_high` >85% đã có ở smart.js).
  - `sap_het_thau_cst_lon` — **sắp hết hạn thầu NHƯNG CST còn lớn**: gói thầu gần `hd_den_ngay` + `remain_pct` cao → nguy cơ mất cơ số. (Cần hạn gói thầu; thiếu thì ghi rõ.)
  - `hang_ngach` — **hàng ngách**: doanh số thấp / độ phủ hẹp, hoặc danh sách CEO tự chọn.
  → Nhóm `special` phần lớn **auto-tính từ CST/doanh số** (đỡ nhập tay), CEO chỉnh/duyệt; giao NV phụ trách đẩy + đặt target riêng cho nhóm này ở GĐ2.

### 1B) Bảng PHÂN CÔNG (assignment)
- **Model:** `assignment = { id, emp_code, type:'unit'|'group'|'route'|'iit'|'special'|'all', value, from_ky, to_ky|null, active, note, by, at }`.
  - `type='all'` = NV phụ trách toàn bộ phần của mình (mặc định hiện tại).
  - VD: `{emp_code:'DN006', type:'unit', value:'027'}` = DN006 phụ trách BV Hoàn Mỹ; `{type:'group', value:'H.A*'}` = phụ trách nhóm H.A*.
- **GIEO MẦM tự động:** suy từ lịch sử bán (các kỳ gần nhất): NV ↔ đơn vị/SP/nhóm đã bán → tạo **bản phân công gợi ý** (nguồn `auto`). CEO xem, **chỉnh tay** (thêm/bớt), chốt (nguồn `manual` khóa).
- **Màn Phân công (admin):** chọn NV → xem danh mục phụ trách (đơn vị/nhóm/SP) → thêm/bớt + đặt hiệu lực (từ kỳ). Hỗ trợ **upload file** phân công (như target). Audit + lịch sử điều chuyển.
- **Màn "Tôi phụ trách" (NV):** NV đăng nhập thấy **danh mục mình phụ trách** (đơn vị/nhóm/SP) — chỉ phần mình.
- Nghiệm thu GĐ1: gợi ý phân công đúng theo lịch sử; CEO sửa + lưu có audit; NV thấy đúng phần mình; không hồi tố.

---

## GIAI ĐOẠN 2 — TARGET CHI TIẾT (đa chiều)

### 2A) Nhập target theo CHIỀU
- Dùng `target_entry.scope = {type, value}` đã có. `type ∈ all|group|route|unit|iit|special`.
- 1 NV có thể có: **1 target tổng** (`scope=all`) + **nhiều target chi tiết** (theo nhóm/tuyến/đơn vị/SP/hàng đặc biệt).
- Nhập: mở rộng Quản target — chọn NV → chọn chiều (nhóm H.A*/tuyến CL/đơn vị/…) → nhập target. Upload file có cột `scope_type, scope_value`.
- Resolver theo (emp, ky, scope): manual>upload>ai (kỳ ≥07 không Lumos, đã chốt).

### 2B) %ĐẠT theo CHIỀU
- Với target `scope={type,value}`: **doanh thu lọc đúng chiều đó** (dữ liệu đã có `route/unit/iit_code/priority`) / target → %đạt theo chiều.
- Thẻ NV: target tổng (số chính) + **bung ra chi tiết theo chiều** (nhóm/tuyến/đơn vị) với %đạt từng chiều.
- Đối chiếu: cảnh báo nếu **Σ target chi tiết ≠ target tổng** (để CEO biết, không tự ép).

### 2C) Kỳ đang chạy
- Pro-rate theo ngày như đã chốt; áp cho cả target chi tiết.
- Nghiệm thu GĐ2: nhập target nhóm H.A* cho DN006 → %đạt nhóm H.A* tính đúng (doanh thu H.A* của DN006 / target); NV chỉ thấy chiều của mình.

---

## GIAI ĐOẠN 3 — THƯỞNG (sau, khi CEO yêu cầu)
- Policy bậc thang `{ngưỡng %đạt → mức thưởng}`, có thể theo chiều. Tính thưởng = f(%đạt, policy). Audit + **duyệt mới gửi** (Zalo/Email giữ guardrail). Chưa làm ở đợt này.

## ĐÃ CHỐT (CEO 2026-07-03)
1. **Chiều phân công:** ĐỦ 5 chiều `unit · group(UT) · route · iit · special(hàng cần đẩy)` + `all`.
2. **Gieo mầm phân công tự động: CÓ**, từ lịch sử bán **04–06/2026** (3 kỳ) → NV↔đơn vị/SP/nhóm đã bán → bản gợi ý, CEO chỉnh.
3. Nhóm `special` (hàng cần đẩy) auto-tính từ CST/doanh số (tồn nhiều, sắp hết thầu-CST lớn, hàng ngách) + CEO chỉnh; cận date cần nguồn hạn dùng (thiếu thì dùng danh sách CEO).

## Nghiệm thu tổng
- GĐ1: danh mục tổng + phân công (gợi ý + sửa tay + NV xem phần mình) chạy, có audit, không hồi tố.
- GĐ2: target theo chiều + %đạt theo chiều đúng số; scope/quyền chuẩn.
- Build OK; số liệu không đổi phần đã chốt.
