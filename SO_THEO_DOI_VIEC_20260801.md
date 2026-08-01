# SỔ THEO DÕI VIỆC — rà toàn bộ (01/08/2026)

CEO: *"cứ làm rồi để đó tao cũng quên luôn, coi như làm nửa chừng bỏ đó thành công cốc"*.
Rà bằng git thật (branch/commit/code), không nhớ mò. Cập nhật mỗi khi có việc đóng/mở.

---

## 🔴 A. BỎ QUÊN — CEO ĐÃ DUYỆT, BOT LÀM XONG, KHÔNG AI MERGE

Branch **`fix/dn022-separate-formula-20260731`** (2 commit, chưa merge, chưa deploy). Bot ghi *"chờ test và Claude review SHA mới trên PR #231"* — Claude chưa review, việc chìm luôn từ 31/07.

**A1. VP018 là Telesaler — fail-closed phân bổ doanh thu**
CEO duyệt `APP_REPORT_VP018_POLICY_PUSH_CLAUDE_APPROVE`. VP018 **không phải Sale** ⇒ không được phân bổ doanh thu C6/`emp_code`, không nhận thưởng/phạt/báo cáo doanh số. Nguồn gán nhầm ⇒ chuyển `UNALLOCATED` + `NON_SALES_ROLE_QUARANTINED` (giữ nguyên doanh thu toàn công ty). Chốt ở materializer + slot/upload + ORDS fallback.

**A2. v3.7 — tách DN022 khỏi công thức tiền hiện tại**
CEO duyệt `APP_REPORT_DN022_SEPARATE_FORMULA_APPROVE`. DN022 **không** tính thưởng P1/P2, **không** phạt target/C45, **không** nhận tin thưởng/phạt tiền — giao diện ghi rõ *đang chờ công thức riêng của CEO*. Điểm/Xu tách độc lập (DN002, DN004, DN022 trong phạm vi phạt thiếu Xu). Nâng khoá công thức **v3.6 → v3.7**.

### ‼ VÌ SAO GẤP — dính mốc 09/08
Ngày **09/08** sẽ bật 2 cờ tin thưởng. Nếu 2 việc trên **chưa merge**:
- **VP018** (telesaler) vẫn bị phân bổ doanh thu → có thể nhận tin thưởng/phạt sai.
- **DN022** vẫn bị tính theo công thức không áp dụng cho mình → nhận **số tiền sai**.
Gửi sai tiền cho NV **không rút lại được**. ⇒ **Phải merge + deploy TRƯỚC 09/08.**

**Việc cần làm:** bot rebase branch lên `origin/main` sạch (sau khi dọn drift) → Claude review → merge → deploy. Lưu ý version nhảy **v3.6 → v3.7**, phải khớp `bonus_formula_lock.json`.

---

## 🟠 B. ĐANG DỞ — có người đang làm

| Việc | Ai | Trạng thái |
|---|---|---|
| **P0 · DataHub ngưng trả chi phí** (21 mã / 1.465 cặp kỳ 07 = 0đ) | Bot | Đang xử. `DIRECTIVE_SUCO_DATAHUB_CHIPHI_20260801.md` |
| **P0 · Dọn drift** (`main` ≠ production `97b87d6`) | Bot | Chưa xong — đang chặn mọi deploy |
| **Fix tháng mặc định** (app đứng T07 dù đã 01/08) | Claude ✅ code xong | Branch `claude/fix-default-month-20260801` (`b5b5619`), test server 587/596 (9 lỗi nền) · web 93/93. **Chờ bot merge + deploy** |
| **Data Hub trusted-device** (CEO phải nhập OTP lại) | Bot | Cổng 1 PASS (841 test). Chờ **Cổng 2**: exact origin SHA + duyệt deploy riêng |

---

## 🟡 C. CHỜ LỊCH / CHỜ NGƯỜI NGOÀI

| Việc | Chờ gì |
|---|---|
| **Bật 2 cờ tin thưởng** (`EMP_COST_NOTIFY`, `BONUS_NOTIFY`) | Mốc **09/08** (sau khoá sổ 08/08), qua cổng DN008 **before-VAT ~124,21%**. Hiện đang TẮT = an toàn |
| **Module "Thanh toán CP của tôi"** (3 lần + sổ nợ + C44) | Spec + bản mẫu PowerPoint XONG. **Chưa code dòng nào.** Là Bước 3, sau dọn drift |

---

## ✅ D. ĐÃ XONG — đang chạy production
Phạt v3.3+ (C45, 4 bậc, cảnh báo sớm) · Cấu hình phạt CEO sửa được + hộp vàng giải thích · 4 ô KPI tổng hợp "Tất cả NV" · Khoá sổ kỳ ngày 8 · Tin phạt `PENALTY_NOTIFY=1` (cảnh báo, chưa trừ tiền) · Công tắc NV tự xem chi phí · Nâng 2.000→4.000 dòng · Connector "Ứng lần 1" (App Salary) · Ô "Còn lại sau ứng lần 1" · Cảnh báo đồng bộ + chặn trùng đơn + đơn >50tr.

## ✅ E. ĐÃ KHÉP — không truy tiếp
- **AF DN006** `600.000.007đ` → App Salary sửa, ứng đúng **65.978.975đ** (14,4%).
- **Ẩn/hiện ô Ứng lần 1** → CEO chốt **HIỆN**, directive ẩn đã thu hồi.

## 🗑 F. BRANCH CHẾT — nội dung ĐÃ có trên main, bỏ được
`claude/penalty-in-target` · `claude/kpi4-always-visible` (4 ô KPI + Phạt trong Quản target đã lên main qua đợt merge khác).
