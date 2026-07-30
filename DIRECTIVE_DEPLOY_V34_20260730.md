# DIRECTIVE — DEPLOY bản v3.4 lên production (CEO duyệt 2026-07-30)

**Bot đọc file này SAU khi `git pull origin main`.** Chỉ deploy đúng commit ghi dưới đây.

## 0. Mục tiêu
Production đang chạy `5c119a5` — **cũ 4 commit**. CEO mở app thật nên **chưa thấy**:
- panel "⚠ Cách tính Phạt" trong Quản target (và giờ **sửa được**),
- 4 ô KPI ở chế độ "Tất cả nhân viên" (tổng hợp toàn đội),
- nhãn "C45 (Lương tăng thêm)" + bảng "Khi nào bị phạt? (4 ngữ cảnh)".

**Commit phải deploy: `d92807f` (đầu `main` lúc viết directive này).**
Trước khi build, in ra `git rev-parse HEAD` và **đối chiếu đúng `d92807f`**. Nếu `main` đã có commit mới hơn thì deploy đầu `main` và **ghi rõ SHA thật đã deploy** — tuyệt đối không deploy SHA cũ hơn.

## 1. Nội dung bản này (để biết cần nghiệm thu gì)
- `beb4ce7` — nhãn C45 + bảng 4 ngữ cảnh phạt; 4 ô KPI tổng hợp toàn đội ở "Tất cả NV".
- `d92807f` — **cấu hình phạt CEO sửa được** qua tầng đè (preview → lưu → audit); **nâng `FORMULA_VERSION` v3.3 → v3.4**.
  Cách tính tiền **KHÔNG đổi** so với v3.3 — v3.4 chỉ mở quyền sửa mức.

## 2. Ràng buộc BẮT BUỘC (không được nới)
1. **‼ CẤM `npm run build` trong cây thư mục đang phục vụ production** — xem `DIRECTIVE_DEPLOY_RELEASE_SAFETY.md` §P4. Build ở cây riêng rồi mới đưa `dist` sang.
2. **Hai cờ thông báo GIỮ NGUYÊN TẮT**: `EMP_COST_NOTIFY=0`, `BONUS_NOTIFY=0`. Deploy này **không** được bật lại.
3. **Auto-deploy vẫn khoá** (`.auto-deploy.disabled` giữ nguyên).
4. **Không sửa** `server/config/employee_bonus_tiers.json` và `server/config/bonus_formula_lock.json` trên server. CEO sửa mức phạt **qua giao diện**, ghi vào tầng đè (`server/data/employee_bonus_policies.json`), không đụng file gốc.
5. `server/data/employee_bonus_policies.json` trên production là **dữ liệu thật** — **KHÔNG ghi đè, KHÔNG reset**. Backup trước khi restart.

## 3. Chạy test trên server trước khi deploy
Chạy **TOÀN BỘ** suite, không chạy chọn lọc:
```
cd server && node --test "test/*.test.js"
cd web    && node --test "test/*.test.mjs"
```
Mức nền trên container của Claude: server **517/526** (9 đỏ = 3 fixture `authTrustedDevice` thiếu `phone` + 6 test PDF thiếu `pdfinfo`), web **87/87**.
Trên server thật nếu có `pdfinfo` thì **6 ca PDF phải XANH**. Đỏ khác mức nền ⇒ **DỪNG**, báo lại, không deploy.
Test `server/test/bonusFormulaVersion.test.js` phải **XANH** — nếu đỏ nghĩa là version/vân tay lệch, dừng ngay.

## 4. Nghiệm thu sau deploy — 6 bằng chứng, phải phân biệt được, không báo suông
1. `git rev-parse HEAD` tại cây deploy = SHA đã ghi ở §0.
2. `web/dist` **version/hash MỚI** (khác `4c34551`) + giờ build.
3. PID `app-report` **đổi** (có restart API). PID `app-report-tgbot` **không đổi** (không đụng bot tin nhắn).
4. Log khởi động vẫn in đúng **"Chi phí/Thưởng notify: TẮT"**.
5. `GET /api/admin/bonus-policies?period=07.2026` (token CEO) trả:
   - `formulaVersion` = **`v3.4`**,
   - `penalty.c45Label` = **`C45 (Lương tăng thêm)`**,
   - `penalty.tiers` đủ **4 bậc** với `range`/`effect`,
   - `penalty.earliestEffectiveFrom` có giá trị.
6. `GET /api/employee-cost?emp=ALL&from=2026-07&to=2026-07` (token CEO) trả `penalty.aggregate = true` và **`counted`/`employees` là số thật** (ví dụ `12/12`), kèm `penalty.atRisk` liệt kê NV đang ở bậc bị phạt.

## 5. Kiểm bằng mắt (chụp màn hình)
- Quản target → **⚠ Cách tính Phạt v3.4**: có ô nhập mốc %/tỷ lệ/ngày + nút **Mô phỏng** và **Lưu**; không còn thẻ "không sửa được bậc phạt ở đây".
- Chi phí → **Tất cả nhân viên**: 4 ô KPI hiện **số tổng hợp**, không còn chữ "Chọn 1 NV".
- Chi phí → chọn **1 NV** → bấm ô **Phạt dự kiến**: hộp giải thích ghi **"C45 (Lương tăng thêm)"** và có bảng **4 ngữ cảnh**, bậc NV đang đứng được tô đậm.

## 6. Thử một vòng cấu hình phạt trên production (KHÔNG lưu)
Chỉ bấm **Mô phỏng** rồi **Đóng** (không bấm Lưu) để xác nhận preview trả bảng cũ→mới. **Không tự ý đổi mức phạt** — mức phạt chỉ CEO quyết.
Nếu muốn chứng minh chặn hồi tố: gọi preview với `penaltyEffectiveFrom` = `2026-06-01` và dán lại đúng thông báo lỗi `Không được áp phạt hồi tố…`. Preview **không ghi gì**, an toàn.

## 7. Nếu có sự cố
Rollback về `5c119a5` (bản production hiện tại) theo đúng quy trình ở `DIRECTIVE_DEPLOY_RELEASE_SAFETY.md`, rồi báo lại kèm log lỗi. Ghi 1 mục `CHANGELOG.md` cho cả deploy và rollback.
