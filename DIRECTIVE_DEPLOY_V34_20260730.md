# DIRECTIVE — DEPLOY bản v3.4 lên production (CEO duyệt 2026-07-30)

**Bot đọc file này SAU khi `git pull origin main`.** Chỉ deploy đúng commit ghi dưới đây.

---

## ‼ TẠM DỪNG DEPLOY — ĐỌC MỤC NÀY TRƯỚC (cập nhật 30/07, sau báo cáo commit `59dc9d3`)

**1) VIỆC CẦN LÀM NGAY — CỨU CODE CỦA BOT TRƯỚC KHI PULL.**
Commit `59dc9d3e140610cd7cfbf16dc6e50c140f7865f4` **CHƯA được push** — trên repo không có commit này, Claude không đọc được để review.
Directive này (và mọi quy trình cũ) có bước `git pull` / `git reset --hard origin/main`. **Chạy bước đó bây giờ là XOÁ MẤT commit `59dc9d3`.**

Việc đầu tiên, trước mọi việc khác:
```
git push -u origin <nhánh-đang-làm>      # đẩy đúng commit 59dc9d3 lên, KHÔNG reset, KHÔNG rebase
git log --oneline -1                      # dán lại SHA để đối chiếu
```

**2) DỪNG deploy cả hai bản cho tới khi chốt MỘT đường.**
Hiện có **HAI bản cấu hình phạt** làm cùng một yêu cầu của CEO:
- **Bản trên `main`** (`d92807f`, Claude): sửa phạt qua **tầng đè dùng lại của Thưởng** (`employeeBonusPolicy`) — một sổ audit duy nhất, endpoint `/admin/penalty-policies`.
- **Bản của bot** (`59dc9d3`, chưa push): module **riêng** `server/src/employeePenaltyPolicy.js` — sổ policy + sổ audit thứ hai, có thêm copy-forward.

Deploy cả hai = **hai nguồn sự thật** cho câu hỏi "ai đã đổi mức phạt", đúng thứ phải tránh nhất. **Không deploy bản nào** cho đến khi CEO chốt giữ đường nào; sau khi chốt thì phần cứng hoá của bản kia được **ghép vào** bản được giữ.

**3) Blocker vân tay công thức là do lệch nền, không phải lỗi test.**
Trên `main` hiện tại `server/test/bonusFormulaVersion.test.js` **XANH 7/7** với `FORMULA_VERSION = v3.4` và `sourceHash = b598f1c5…`.
Bot báo đỏ vì cây của bot **chưa có** bản v3.4 trên `main` (hoặc đã sửa file trong vân tay mà chưa làm đủ 4 bước). Cách xử lý: **push xong** ở bước (1) → `git pull origin main` → chạy lại full suite → nếu vẫn đỏ thì làm đủ 4 bước ở `CLAUDE.md` mục 5 (nâng `FORMULA_VERSION` → sửa `version`+`note` → ghi lại `sourceHash` → ghi `CHANGELOG`). **Vân tay còn đỏ thì tuyệt đối không deploy.**

**4) Ghi nhận đúng số production.** Bot báo production đang ở `17d8272`; directive này ban đầu ghi `5c119a5`. Cả hai đều **cũ hơn** `main`. Khi deploy, lấy SHA thật bằng `git rev-parse HEAD` tại cây production và **dán vào báo cáo**, không dùng lại số trong văn bản.

---

## 0. Mục tiêu
Production đang chạy bản **cũ hơn `main`** (bot báo `17d8272`; trước đó ghi nhận `5c119a5` — lấy SHA thật tại cây production, xem mục DỪNG (4)). CEO mở app thật nên **chưa thấy**:
- panel "⚠ Cách tính Phạt" trong Quản target (và giờ **sửa được**),
- 4 ô KPI ở chế độ "Tất cả nhân viên" (tổng hợp toàn đội),
- nhãn "C45 (Lương tăng thêm)" + bảng "Khi nào bị phạt? (4 ngữ cảnh)".

**Deploy ĐẦU `main`, không deploy SHA cũ hơn.** Đầu `main` khi viết mục này là `9c93cea` (gồm `beb4ce7` + `d92807f` + `b71f3f1`).
Trước khi build, in `git rev-parse HEAD` và **dán vào báo cáo**. `main` có commit mới hơn thì deploy commit mới nhất.
**Nhưng chỉ deploy sau khi xong 4 việc ở mục DỪNG.**

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
Mức nền trên container của Claude (cập nhật sau khi thêm test HTTP): server **525/534** (9 đỏ = 3 fixture `authTrustedDevice` thiếu `phone`/`users.json` + 6 test PDF thiếu `pdfinfo`), web **87/87**.
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
