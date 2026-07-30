# DIRECTIVE — DEPLOY bản v3.5 lên production (CEO duyệt 2026-07-30)

> **Cập nhật lần 3:** bản cần deploy giờ là **v3.5** — thêm **khoá sổ kỳ hết ngày 8 tháng sau** (CEO chốt 30/07).
> Nghiệm thu thêm 3 việc:
> - `GET /api/employee-cost?emp=DN00x&from=2026-07&to=2026-07` phải trả `periodClose.closed=false` và `periodClose.note = "doanh thu còn cập nhật đến hết ngày 08/08/2026"`; kỳ **T06** phải trả `closed=true`.
> - Màn Chi phí: ô **"Tổng chi phí tháng (chi phí gốc) · dự kiến"**, và nhãn phạt ghi **DỰ KIẾN** kèm ngày 08/08/2026. Kỳ đã khoá sổ thì ghi **ĐÃ CHỐT KỲ — số chính thức**.
> - `formulaVersion` phải là **`v3.5`** (không còn v3.4).

**Bot đọc file này SAU khi `git pull origin main`.** Chỉ deploy đúng commit ghi dưới đây.

---

## ✅ ĐÃ GỘP XONG — MỞ LẠI DEPLOY (cập nhật lần 2, 30/07)

Hai bản cấu hình phạt **đã gộp thành một đường duy nhất** trong merge commit **`22fe34e`** trên `main`.
Nhánh `feat/penalty-formula-editor-20260730` (`59dc9d3`) **đã được gộp vào**, không mất commit nào — **không cần** làm gì thêm với nhánh đó, và **KHÔNG** deploy trực tiếp từ nhánh đó.

**Chốt sau khi gộp:**
- Giữ **store phạt của bot** (`employeePenaltyPolicy.js`) + editor mô phỏng toàn đội + 3 nút duyệt + chữ ký nguồn Xu.
- **Xoá đường trùng của Claude**: đã kiểm chứng `penaltyPolicySnapshot` không còn dòng nào; `penaltyPolicyPreviews` chỉ còn **một** khai báo (của bot); `employeeBonusPolicy.js` chỉ còn 4 dòng `rawConfig` vốn đã có từ trước, không còn nhánh đè phạt.
- **Ghép thêm của Claude**: `penaltyDisplay.js` + hộp giải thích **"C45 (Lương tăng thêm)"** + bảng **4 ngữ cảnh** (việc số 1 của CEO) · **trần tỷ lệ 5%** + cảnh báo khi > 1%.
- **Vân tay công thức**: `v3.4`, `sourceHash 5323559326af…`, test XANH. Không nâng v3.5 vì production còn v3.3 — chưa ai từng thấy số v3.4.

**Deploy đúng đầu `main` (hiện `22fe34e` hoặc mới hơn).** In `git rev-parse HEAD` và dán vào báo cáo.

**Blocker vân tay bot từng báo: đã hết.** Nguyên nhân là hai nhánh cùng nâng v3.4 với nội dung khác nhau; sau khi gộp chỉ còn một vân tay.

## 0. Mục tiêu
Production đang chạy bản **cũ hơn `main`** (bot báo `17d8272`; trước đó ghi nhận `5c119a5` — lấy SHA thật tại cây production, xem mục DỪNG (4)). CEO mở app thật nên **chưa thấy**:
- panel "⚠ Cách tính Phạt" trong Quản target (và giờ **sửa được**),
- 4 ô KPI ở chế độ "Tất cả nhân viên" (tổng hợp toàn đội),
- nhãn "C45 (Lương tăng thêm)" + bảng "Khi nào bị phạt? (4 ngữ cảnh)".

**Deploy ĐẦU `main`, không deploy SHA cũ hơn.** Đầu `main` khi viết mục này là `9c93cea` (gồm `beb4ce7` + `d92807f` + `b71f3f1`).
Trước khi build, in `git rev-parse HEAD` và **dán vào báo cáo**. `main` có commit mới hơn thì deploy commit mới nhất.
**Đã gộp xong nên không còn điều kiện chặn nào — deploy được ngay theo §2–§6.**

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
Mức nền trên container của Claude (sau khi gộp): server **532/541** (9 đỏ = 3 fixture `authTrustedDevice` thiếu `phone`/`users.json` + 6 test PDF thiếu `pdfinfo`), web **87/87**.
Trên server thật nếu có `pdfinfo` thì **6 ca PDF phải XANH**. Đỏ khác mức nền ⇒ **DỪNG**, báo lại, không deploy.
Test `server/test/bonusFormulaVersion.test.js` phải **XANH** — nếu đỏ nghĩa là version/vân tay lệch, dừng ngay.

## 4. Nghiệm thu sau deploy — 6 bằng chứng, phải phân biệt được, không báo suông
1. `git rev-parse HEAD` tại cây deploy = SHA đã ghi ở §0.
2. `web/dist` **version/hash MỚI** (khác `4c34551`) + giờ build.
3. PID `app-report` **đổi** (có restart API). PID `app-report-tgbot` **không đổi** (không đụng bot tin nhắn).
4. Log khởi động vẫn in đúng **"Chi phí/Thưởng notify: TẮT"**.
5. `GET /api/admin/penalty-policies?period=2026-08` (token CEO) trả `canEdit: true`, `resolved.parameters` đủ 12 tham số, `minEffectiveMonth`.
   Với token **admin thường**: `canEdit: false` (chỉ CEO được sửa công thức phạt).
6. `GET /api/employee-cost?emp=DN00x&from=2026-07&to=2026-07` (token CEO) trả `penalty.c45Label = "C45 (Lương tăng thêm)"`, `penalty.tiers` đủ **4 bậc** có `range`/`effect`, và `penalty.modeText` nói rõ kỳ này chỉ cảnh báo.
7. `GET /api/employee-cost?emp=ALL&from=2026-07&to=2026-07` trả `penalty` tổng hợp với `employeeCount`/`contributors` là **số thật**; thiếu số thì `total` giữ `null` kèm `provisionalTotal`, **không** biến thành 0đ.
8. Thử preview với `lowerRatePct: 30` ⇒ phải bị chặn `Tỷ lệ phạt bậc thấp phải từ 0 đến 5`. Thử `3` ⇒ lưu được nhưng `rateWarnings` phải có câu "cao gấp … lần mức đang áp dụng".

## 5. Kiểm bằng mắt (chụp màn hình)
- Quản target → **⚠ Cách tính Phạt v3.4**: có ô nhập mốc %/tỷ lệ/ngày + nút **Mô phỏng** và **Lưu**; không còn thẻ "không sửa được bậc phạt ở đây".
- Chi phí → **Tất cả nhân viên**: 4 ô KPI hiện **số tổng hợp**, không còn chữ "Chọn 1 NV".
- Chi phí → chọn **1 NV** → bấm ô **Phạt dự kiến**: hộp giải thích ghi **"C45 (Lương tăng thêm)"** và có bảng **4 ngữ cảnh**, bậc NV đang đứng được tô đậm.

## 6. Thử một vòng cấu hình phạt trên production (KHÔNG bấm Duyệt)
Chỉ bấm **Mô phỏng toàn đội** rồi **Đóng** (không bấm ✅ Duyệt) để xác nhận preview trả bảng cũ→mới. **Không tự ý đổi mức phạt** — mức phạt chỉ CEO quyết.
Nếu muốn chứng minh chặn hồi tố: gọi preview với `penaltyEffectiveFrom` = `2026-06-01` và dán lại đúng thông báo lỗi `Không được áp phạt hồi tố…`. Preview **không ghi gì**, an toàn.

## 7. Nếu có sự cố
Rollback về đúng SHA production đã ghi nhận TRƯỚC khi deploy (in `git rev-parse HEAD` và lưu lại trước khi làm gì) theo đúng quy trình ở `DIRECTIVE_DEPLOY_RELEASE_SAFETY.md`, rồi báo lại kèm log lỗi. Ghi 1 mục `CHANGELOG.md` cho cả deploy và rollback.

---

## 9. TRẢ LỜI 8 PHÁT HIỆN REVIEW (Claude soát trên `main`, 30/07)

Phân loại theo **áp cho bản nào**, để khi chốt đường không xử lý trùng và không bỏ sót.

| # | Phát hiện | Áp cho | Trạng thái trên `main` |
|---|---|---|---|
| 1 | Blocker: vân tay công thức không khớp | cây của bot | **Không xảy ra trên `main`**: `bonusFormulaVersion` XANH 7/7 (`v3.4` · `b598f1c5…`). Nguyên nhân là cây bot chưa pull `main`. Xem mục DỪNG (3). |
| 2 | High: preview dùng dữ liệu Xu từ `vat.db` nhưng chữ ký nguồn không ký | **bản của bot** | Không áp cho `main`: preview phạt của `main` **không đọc Xu** — chỉ trả bảng bậc + chế độ kỳ. `diemXu` chỉ dùng ở màn chi phí (chỗ `buildXuPenalty`), không nằm trong đường preview/save cấu hình. Bản nào hiển thị số Xu trong preview thì **phải** ký nguồn đó. |
| 3 | Medium: audit bị cắt còn 2.000 bản ghi | **CẢ HAI** | `employeeBonusPolicy.js` cũng cắt 2.000 (`slice(0, 2000)`). **Chưa sửa, có chủ ý**: file này nằm trong vân tay công thức nên sửa là buộc nâng version lần hai trong ngày cho một việc **không đổi cách tính tiền** — sai tín hiệu với CEO. **Phải sửa một lần duy nhất trong module được giữ, ngay sau khi chốt đường**: ghi lịch sử đầy đủ dạng append-only (JSONL), mảng JSON 2.000 bản chỉ để hiển thị. |
| 4 | Medium: `copiedFromVersion` không xác minh tham số | **bản của bot** | `main` không có tính năng copy-forward. Nếu giữ bản bot: phải so **từng tham số** với version nguồn, lệch thì từ chối hoặc **không** ghi là copy-forward. |
| 5 | Thiếu test HTTP thật (GET/preview/save · quyền CEO · session binding · preview một lần) | **CẢ HAI** | **ĐÃ LÀM trên `main`** (`b71f3f1`): `server/test/penaltyPolicyHttp.test.js` — 8 ca, gọi thật qua HTTP với middleware quyền thật. Đồng thời **siết session binding**: preview buộc theo **phiên** (`session.th`), không chỉ theo mã người dùng — phiên khác của cùng CEO cũng không lưu được; và lần gọi sai của người lạ **không "đốt" được** preview hợp lệ của CEO. |
| 6 | Thiếu test: `vat.db` đổi giữa preview/save phải làm preview hết hiệu lực | **bản của bot** | Không áp cho `main` (preview không đọc Xu). Giữ bản bot thì bắt buộc có test này. |
| 7 | Thiếu test: lỗi ghi audit/rollback hai file + chính sách lưu giữ > 2.000 | **CẢ HAI** | Làm cùng lúc với #3, trong module được giữ. |
| 8 | Thiếu test: gửi `copiedFromVersion` nhưng sửa tham số phải bị từ chối | **bản của bot** | Đi cùng #4. |

**Việc còn lại trước khi deploy (theo đúng thứ tự):**
1. Bot **push** `59dc9d3` (mục DỪNG (1)).
2. CEO chốt giữ **một** đường cấu hình phạt.
3. Trong module được giữ: xử lý #3 + #7, và nếu giữ bản bot thì thêm #2, #4, #6, #8.
4. Chạy **full** suite hai bên xanh về mức nền → deploy theo §3–§6.
