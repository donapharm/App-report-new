# DIRECTIVE — TẠM ẨN ô "Ứng lần 1" + "Còn lại sau ứng" (CEO chốt 2026-07-31)

CEO: *"Tạm ẩn để anh cho sửa lại đã."*

Lý do: App Salary endpoint `first-advance` **chiếu nhầm cột** — trả `MAX(0, AF + cơm + thưởng − BHXH)` (cột "ghi nhận"), KHÔNG phải số ứng thật. "Ứng trong tháng" thật = 0. ⇒ số "Ứng lần 1" đang SAI cho **toàn bộ NV** (DN006 lòi ra vì AF rác 600.000.007đ). App Report hiển thị đúng cái API trả — lỗi ở nguồn. CEO sẽ cho Finance/App Salary sửa. Trong lúc chờ: **ẩn**, không để số sai đánh lừa cả đội.

## PHẠM VI — chỉ ẩn giao diện, KHÔNG gỡ code nền

1. **Frontend `web/src/pages/EmployeeCost.jsx`:** ẩn 2 ô KPI **"Ứng lần 1 tháng này"** và **"Còn lại sau ứng lần 1"**.
   - Cách làm: 1 cờ build-time tường minh, vd `const SALARY_ADVANCE_UI = false;` (đặt gần đầu file, có comment "TẠM ẨN chờ App Salary sửa nguồn — CEO 31/07"). Khi `false` thì **không render** `<SalaryAdvanceKpi/>` và `<RemainingAfterAdvanceKpi/>`.
   - Bật lại sau này = đổi 1 dòng `false→true` + rebuild, KHÔNG phải viết lại code.
2. **GIỮ NGUYÊN, KHÔNG xoá:** connector `salaryAdvance.js`, route `/employee-cost/salary-advance`, field `salaryAdvance` trong payload, và branch `feat/kpi-remaining-after-advance` (guard suspect). Chỉ ẩn phần render.
3. **KHÔNG đụng backend, KHÔNG restart API, KHÔNG đổi `.env`/secret/config.** Chỉ build lại `dist` và đưa sang (giống lần deploy hộp vàng).

## NGHIỆM THU
- Đăng nhập **DN006** → **KHÔNG còn** ô "Ứng lần 1" (hết số 598.978.982đ sai) và không có ô "Còn lại".
- Đăng nhập **DN009** → cũng không còn 2 ô đó. Các ô khác (doanh thu, target, thưởng, phạt) **vẫn nguyên**.
- PID `app-report` (API) **KHÔNG đổi** · chỉ frontend lên bản mới.
- Xác nhận `formulaVersion` không đổi (đây là thay đổi UI thuần, không đụng công thức).

## KHI APP SALARY SỬA XONG (ghi để nhớ, chưa làm bây giờ)
Nguồn trả đúng trường "Ứng trong tháng" + dọn AF rác DN006 → đổi cờ `SALARY_ADVANCE_UI = true`, merge branch guard `feat/kpi-remaining-after-advance` (đã có chốt chặn ứng>tổng), QA lại DN006/DN009 rồi mới bật.

### Hành vi bắt buộc của ô "Ứng lần 1" khi bật lại (CEO chốt 31/07)
- **Chọn TẤT CẢ NV:** ô hiện **TỔNG số ứng của các NV CÓ ứng lần 1** (giống cách tổng hợp ô Thưởng/Phạt). Hiện kèm **"X/Y NV có ứng"**.
- **Chọn 1 NV:** ô tách về **đúng số ứng của NV đó**.
- **Kỷ luật fail-closed cho phép SUM:** NV **thiếu số** hoặc **nghi bất thường (suspect, ứng>tổng)** ⇒ **KHÔNG cộng vào tổng, KHÔNG coi là 0** — tách ra đếm riêng (`contributors` / `missingCount` / `suspectCount`). Còn NV chưa đủ nguồn thì tổng để **`null`/"tạm tính"**, không phải con số "hoàn chỉnh" giả.
- Dùng lại đúng khuôn `aggregateRemainingAfterAdvance` (đã có `contributors`/`missing`/`overAdvanceCount`) — không viết engine tổng hợp mới. ALL-mode fan-out App Salary giữ trong cổng concurrency hiện có.
- KHÔNG bật riêng phần SUM này khi cờ `SALARY_ADVANCE_UI` còn `false` — sum số nhầm cột = tổng rác (riêng DN006 ném vào ~599 triệu).
