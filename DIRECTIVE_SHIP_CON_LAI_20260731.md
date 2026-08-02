# DIRECTIVE — SHIP ô "Còn lại sau ứng lần 1" (CEO chốt phương án A, 2026-07-31)

CEO xác nhận: **tiền ứng lần 1 là THẬT** (chuyển khoản cuối tháng), và **được trừ vào đúng "Tổng chi phí tháng" App Report đang hiện** (phương án A). ⇒ phép **"Còn lại = Tổng sau phạt − Ứng lần 1" đúng bản chất** → ship. Kết luận cũ "API nhầm cột" **HỦY** — công thức `AF+cơm+thưởng−BHXH` chính là cách tính tiền ứng thật.

## VIỆC 1 — Đưa ô "Còn lại" lên main + deploy TỪ main (chống drift)

- Rebase branch `feat/kpi-remaining-after-advance` (có `remainingAfterAdvance.js` + guard suspect) lên **đầu `origin/main` hiện tại** (`d9356e7`+), **merge vào main**.
- Deploy **TỪ `origin/main`**, KHÔNG từ commit local `640685c` (bản đó không có trên main — chính là lỗi drift lần trước). Sau deploy, `git rev-parse HEAD` của cây build phải = đầu `origin/main`.
- **Cả 2 ô HIỆN** ("Ứng lần 1" + "Còn lại"). Nếu còn cờ `SALARY_ADVANCE_UI` thì để **`true`**.
- **Không đụng** App Salary/payroll, **không restart API** (chỉ `dist`).

## VIỆC 2 — Tổng hợp chế độ chọn TẤT CẢ (CEO chốt trước đó)

Cho **CẢ HAI** ô "Ứng lần 1" và "Còn lại":
- **Chọn TẤT CẢ:** hiện **TỔNG** của các NV có số (dùng khuôn `aggregateRemainingAfterAdvance` sẵn có + fan-out App Salary trong cổng concurrency hiện tại). Kèm **"X/Y NV có số"**.
- **Chọn 1 NV:** tách về đúng số NV đó.
- **Fail-closed:** NV thiếu số hoặc **nghi bất thường (ứng > tổng)** ⇒ **KHÔNG cộng vào tổng, KHÔNG coi là 0** — đếm riêng (`contributors`/`missingCount`/`suspectCount`). Còn NV chưa đủ nguồn ⇒ tổng để **`null`/"tạm tính"**, không phải số "hoàn chỉnh" giả.

## GIỮ NGUYÊN guard (đã có, không gỡ)
Ứng > tổng ⇒ ô "Còn lại" hiện **"DỪNG TÍNH · NGHI BẤT THƯỜNG"**, KHÔNG hiện số âm. Guard này **giữ nguyên** (còn dùng cho ca tương lai), dù hiện tại không NV nào rơi vào.

## NGHIỆM THU (dán số thật)
- **DN009:** "Còn lại" = **276.598.207đ** (336.334.260 − 59.736.053).
- **DN006:** "Còn lại" = **393.462.331đ** (459.441.306 − 65.978.975). Số dương bình thường, **KHÔNG** còn cảnh báo ứng vượt.
- **Chọn TẤT CẢ:** cả "Ứng lần 1" và "Còn lại" ra **tổng đội**, kèm "X/Y NV có số"; NV thiếu/nghi không thành 0.
- Cây build = đầu `origin/main` · PID `app-report` KHÔNG đổi · `formulaVersion` KHÔNG đổi (đây là hiển thị, không đụng công thức).
- Test: server + web XANH (mức nền cũ), `bonusFormulaVersion` XANH.

## ✅ ĐÃ KHÉP — DN006 (CEO xác nhận 01/08)
Lỗi nằm ở **App Salary**, đã xử lý: AF cũ `600.000.007đ` (nghi gõ nhầm) → số ứng đúng là **65.978.975đ** (14,4% tổng — đúng dải bình thường như DN005 10% / DN009 18% / DN008 38%). **Không truy tiếp mục này.**
Ghi lại để nhớ: guard "ứng > tổng" chính là thứ đã **bắt được** con số sai này trước khi nó trôi vào sổ — giữ guard, đừng gỡ.
