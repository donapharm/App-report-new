# DIRECTIVE — Ô KPI "Còn lại sau ứng lần 1" + đưa đấu nối App Salary về main (CEO chốt 2026-07-31)

CEO: *"ô ứng lần 1 đã lên KPI rồi, nhưng còn thiếu ô KPI tổng số tiền SAU KHI đã trừ số ứng lần 1."*

Claude review phát hiện: ô "Ứng lần 1" đã ra số thật trên production, **nhưng code đấu nối App Salary CHƯA có trên `main`** — `main` vẫn là placeholder `SalaryAdvanceKpi()` = "Chưa đấu nối app lương" (`web/src/pages/EmployeeCost.jsx:479`). ⇒ Phải xử gốc trước, rồi mới thêm ô mới.

---

## VIỆC 1 — ‼ ĐƯA ĐẤU NỐI APP SALARY VỀ `main` TRƯỚC (chống mất)

Production đang chạy code lấy "Ứng lần 1" từ App Salary mà repo không có. Lần deploy-from-main kế tiếp sẽ **xoá ô này về placeholder**.

1. Commit + push toàn bộ phần đấu nối App Salary (frontend ô "Ứng lần 1" + backend gọi App Salary + field trong payload employee-cost) lên `main`.
2. Ghi `CHANGELOG.md`: nguồn số ứng (App Salary, endpoint nào), self-scoped, trạng thái "dự kiến / chưa chốt".
3. **Nghiệm thu:** trên `main`, `EmployeeCost.jsx` KHÔNG còn chuỗi "Chưa đấu nối app lương"; có field ứng lần 1 self-scoped trong response `/api/employee-cost`.

**CỔNG CHẶN:** chưa push xong VIỆC 1 thì KHÔNG làm VIỆC 2 (build ô mới trên nền code chưa có = build mù).

---

## VIỆC 2 — Thêm ô KPI "Còn lại sau ứng lần 1"

**Công thức (backend tính, SSOT — KHÔNG để frontend tự trừ):**
```
cònLạiSauỨng = tổngChiPhíThángSauPhạt − ứngLần1
```
Ví dụ DN009: 336.334.260 − 59.736.053 = **276.598.207đ**.

**Vì sao backend tính, không phải frontend:**
- Cơ sở trừ là **"sau phạt"** (số thực nhận), KHÔNG phải "chi phí gốc". T07 hai số bằng nhau (chưa phạt), nhưng **từ 08/2026 phạt trừ vào C45 ⇒ base giảm** — backend phải trừ trên số đã-sau-phạt để ô "còn lại" tự đúng theo kỳ. Frontend tự trừ sẽ sai khi phạt thật.
- Một nguồn số duy nhất, tránh lệch làm tròn.

**FAIL-CLOSED bắt buộc (không được bịa/che số):**
1. Ứng lần 1 = `null` / chưa về từ App Salary ⇒ ô "còn lại" = **"—" (chưa đủ dữ liệu)**. TUYỆT ĐỐI không hiển thị nguyên tổng như thể chưa ứng đồng nào.
2. Trạng thái kế thừa đầu vào: cả hai đang "dự kiến / chưa chốt tới 08/08" ⇒ ô "còn lại" cũng ghi **"dự kiến"**. Sau khoá sổ mới thành "đã chốt".
3. Ứng > tổng sau phạt (đã ứng vượt) ⇒ hiển thị **số âm THẬT** + chú thích "đã ứng vượt — khấu trừ kỳ sau". Không kẹp về 0, không giấu.

**Vị trí + nhãn:**
- Đặt **ngay dưới ô "Ứng lần 1 tháng này"**.
- Nhãn: **"Còn lại sau ứng lần 1"**; `sub`: "Tổng sau phạt − ứng lần 1 · dự kiến · nguồn: App Salary + DataHub".
- Chế độ "tất cả NV" (CEO): ô này là **tổng hợp toàn đội** giống 4 ô KPI kia (cộng số đã tính từng NV, NV thiếu ứng đếm riêng — không coi là 0).

**Nghiệm thu:** đăng nhập DN009 → thấy ô "Còn lại sau ứng lần 1" = **276.598.207đ · dự kiến**. Thử 1 NV chưa có số ứng → ô hiện "—", KHÔNG hiện nguyên tổng.

---

## BÁO CÁO
1. SHA đã push đấu nối App Salary về main + xác nhận main hết placeholder.
2. Ảnh ô "Còn lại sau ứng lần 1" của DN009 = 276.598.207đ.
3. Xác nhận fail-closed: 1 NV thiếu ứng hiện "—".
