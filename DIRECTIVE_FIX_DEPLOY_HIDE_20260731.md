# DIRECTIVE SỬA GẤP — bản 640685c deploy SAI, phải ẩn lại ô "Ứng lần 1" (2026-07-31)

Bot vừa deploy release `640685c` **HIỆN** ô "Ứng lần 1" (DN016 = 51.851.347đ) và ô "Còn lại". **ĐIỀU NÀY NGƯỢC** với CEO chốt *"tạm ẩn"*. `640685c` không có trên origin/main và **không chứa** directive ẩn `f936f65` ⇒ bot deploy bản cũ, chưa `git pull origin main`.

Số "Ứng lần 1" đang là **cột sai** (App Salary chiếu `MAX(0, AF+cơm+thưởng−BHXH)`, không phải ứng thật). NV đang thấy số sai như thật ⇒ **gỡ ngay.**

## LÀM ĐÚNG THỨ TỰ

1. **`git pull origin main`** → `git rev-parse HEAD` phải ra **`e7218fe`** (hoặc mới hơn). ‼ TUYỆT ĐỐI không build/deploy từ nhánh KPI cũ nữa.
2. Xác nhận `web/src/pages/EmployeeCost.jsx` có cờ **`SALARY_ADVANCE_UI = false`** và cờ này **ẩn cả** `<SalaryAdvanceKpi/>` lẫn `<RemainingAfterAdvanceKpi/>` (theo `DIRECTIVE_HIDE_SALARY_ADVANCE_20260731.md`). Nếu bản trên main chưa có cờ này thì thêm đúng như directive ẩn, commit vào main.
3. Build lại `dist` từ đầu `main` → deploy. **Không restart API**, không đụng `.env`/App Salary.

## CỔNG CHẶN (nghiệm thu — bắt buộc)
- Đăng nhập **DN016** → **KHÔNG còn** ô "Ứng lần 1" (hết số 51.851.347đ) và không có ô "Còn lại".
- Đăng nhập **DN006/DN009** → cũng không còn 2 ô đó. Các ô khác nguyên.
- `git rev-parse HEAD` của cây build = đầu `origin/main` (`e7218fe`+). Xác nhận production KHÔNG còn chạy commit lạ ngoài main (`640685c` phải được thay).
- PID `app-report` KHÔNG đổi.

## GHI NHỚ
- Từ giờ **mỗi đợt phải `git pull origin main` TRƯỚC khi build/deploy** — lần này lỡ vì deploy nhánh cũ.
- Ô "Ứng lần 1"/"Còn lại" chỉ được bật lại khi App Salary sửa nguồn (trả đúng "Ứng trong tháng" + dọn AF rác DN006), theo directive ẩn.
