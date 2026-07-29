# DIRECTIVE — Sửa 4 lỗ hổng quy trình DEPLOY/ROLLBACK (NO-GO 2026-07-26)

> Claude Code (kiến trúc/review) thẩm định verdict NO-GO → **ĐỒNG Ý, không deploy tới khi sửa xong**.
> Các script bị nêu (`deploy_release.sh`, `prepare_result.txt`, `runtime_files_before.sha256`) **nằm trên server
> vận hành, không có trong repo App Report** ⇒ **bot là người sửa**; directive này là hợp đồng nghiệm thu.
> Phạm vi: CHỈ quy trình phát hành. **Không đụng code nghiệp vụ** — app đang chạy `be047e5` vẫn giữ nguyên.

## 0. Vì sao chặn (giải thích cho CEO)
Đây **không** phải lỗi tính năng — là lỗi **quy trình đưa hàng lên production**. Rủi ro thật:
- **Cái được duyệt và cái được chạy có thể là 2 thứ khác nhau** (P1-1, P1-2).
- **Lưới an toàn tự phá dữ liệu**: rollback xoá dữ liệu thật rồi mới phục hồi, không kiểm chứng, và **vẫn báo
  "rollback xong"** kể cả khi hỏng (P1-3). Đây là điểm **nguy hiểm nhất** — mất dữ liệu không có đường lùi.
- **Bằng chứng backup không đủ mạnh** để tin lúc cần (P2).
⇒ Thứ tự bắt buộc: **P1-3 trước** (lưới an toàn phải an toàn đã), rồi P1-1, P1-2, cuối cùng P2.

---

## P1-3 (LÀM TRƯỚC) — Rollback KHÔNG được phá dữ liệu trước khi chứng minh phục hồi được
**Hiện trạng:** xoá `$DATA` → giải nén thẳng đè → không kiểm checksum archive → không đối chiếu danh sách file phục
hồi → bỏ qua lỗi restore/start/smoke → vẫn in "rollback finished".

**Bắt buộc sửa — thứ tự cứng, sai bước nào dừng ngay (`set -Eeuo pipefail` + `trap` báo lỗi):**
1. **Kiểm checksum archive TRƯỚC KHI ĐỘNG VÀO DỮ LIỆU THẬT.** Sai/thiếu → **dừng, không xoá gì**.
2. **Giải nén ra STAGING** (`$DATA.restore.<ts>`), tuyệt đối không giải nén đè lên `$DATA`.
3. **Đối chiếu staging với `runtime_files_before.sha256`** (đủ file, đúng nội dung, đúng symlink/quyền). Lệch → dừng,
   `$DATA` vẫn nguyên vẹn.
4. **Đổi chỗ nguyên tử:** `$DATA` → `$DATA.bad.<ts>` (GIỮ LẠI, không xoá), rồi `mv` staging → `$DATA`.
   **Không dùng `rm -rf $DATA`** ở bất kỳ nhánh nào.
5. **Khởi động lại bản CŨ + health + smoke.** Bất kỳ bước nào fail → **exit != 0** và in rõ "ROLLBACK THẤT BẠI —
   dữ liệu cũ còn ở `$DATA.bad.<ts>`". **Cấm** in "rollback finished" khi chưa pass đủ.
6. Chỉ khi tất cả xanh mới in thành công + đường dẫn bản `$DATA.bad.<ts>` để dọn tay sau.

**Nghiệm thu (phải diễn tập thật, có log):**
- (a) archive hỏng cố ý → dừng ở bước 1, `$DATA` **không đổi 1 byte**.
- (b) archive thiếu file → dừng ở bước 3, `$DATA` nguyên vẹn.
- (c) start/health/smoke fail → exit != 0, thông báo đúng, dữ liệu cũ còn nguyên.
- (d) đường hạnh phúc → phục hồi đủ file/quyền/symlink, app cũ chạy, health 200.

---

## P1-1 — Chỉ deploy ĐÚNG thứ đã được duyệt (fail-closed toàn bộ trường)
**Hiện trạng:** `deploy_release.sh` chỉ xem `status=PASS` → duyệt 1 bản, chạy bản khác vẫn lọt.

**Bắt buộc:** đọc `prepare_result.txt` và so **TỪNG trường**, khớp hết mới chạy:
- `status == PASS`
- `callback == OK_ECOST_0726` (đúng token của lần duyệt này)
- `base` == đúng base thật đang deploy
- `commit` == `git rev-parse HEAD` của cây sắp chạy
- `release` == đúng nhãn release đang cutover
Thiếu file / thiếu trường / sai giá trị / file cũ hơn lần prepare → **dừng, exit != 0**, in rõ trường nào lệch.
**Cấm** dùng giá trị mặc định khi trường vắng mặt. Token/`callback` **dùng 1 lần** (đã dùng → không nhận lại).

**Nghiệm thu:** sửa lệch từng trường (5 ca) → mỗi ca đều **chặn**, nêu đúng tên trường lệch.

---

## P1-2 — Bản đã chuẩn bị KHÔNG được đổi giữa chừng (chống TOCTOU)
**Hiện trạng:** chỉ kiểm `RELEASE_COMMIT`, `.env`, symlink data ⇒ source/asset build/`node_modules`/`ecosystem.config`
bị sửa sau prepare vẫn chạy được.

**Bắt buộc:**
1. **Sau build, sinh manifest ĐẦY ĐỦ** `release_manifest.sha256`: mọi file sẽ chạy — mã nguồn server, `web/dist`,
   `package.json` + `package-lock.json`, `ecosystem.config.*`, script khởi động. Ghi kèm quyền + đích symlink.
2. **Ngay TRƯỚC `pm2 start/reload`**, verify lại manifest. Lệch 1 file → **dừng, không cutover**.
3. Ghi `release_manifest.sha256` vào artifact/log của lần deploy để truy vết về sau.

**Nghiệm thu:** sau prepare, sửa thử lần lượt (a) 1 file server, (b) 1 file trong `web/dist`, (c) `ecosystem.config`,
(d) 1 file trong `node_modules` → **cả 4 đều bị chặn trước khi PM2 chạy**.

---

## P2 — Bằng chứng backup phải kiểm được NỘI DUNG, không chỉ đọc được
**Hiện trạng:** `tar -tzf` chỉ chứng minh archive đọc được.

**Bắt buộc:** khi tạo backup, ghi kèm manifest **nội dung + metadata** (đường dẫn, sha256 từng file, quyền,
uid/gid, đích symlink). Xác minh bằng cách **giải nén ra staging** rồi đối chiếu manifest — không tin `tar -tzf`.
Manifest + checksum của chính archive lưu cạnh archive.

**Nghiệm thu:** sửa 1 byte trong archive → xác minh **phát hiện được**; đổi quyền/symlink → **phát hiện được**.

---

## Ràng buộc chung (bất di)
1. **Fail-closed mọi nhánh:** không rõ ràng = dừng. Cấm `|| true`, cấm nuốt exit code, `set -Eeuo pipefail`.
2. **Không xoá dữ liệu thật** ở bất kỳ nhánh nào trước khi bản thay thế đã được chứng minh hợp lệ.
3. **Không bao giờ in "thành công/finished" khi chưa pass đủ điều kiện** — báo cáo sai còn nguy hiểm hơn lỗi.
4. Mỗi lần deploy/rollback ghi artifact: kết quả từng bước, manifest, checksum, exit code.
5. **Không đụng code nghiệp vụ** trong đợt này; app production giữ `be047e5`.

## 6-BIS. THỨ TỰ CUTOVER (gỡ 3 lỗi bot phát hiện khi tích hợp 2026-07-26)
Bot tự tìm ra 3 lỗi trong phần lắp ráp — GIỮ NO-GO là đúng. Chốt cách sửa (mẫu: `scripts/safe_pm2_cutover.sh`):
1. **Approval token 1-lần (lỗi #1):** `verify_approval.sh` chạy TRƯỚC mọi thứ; token đã dùng → chặn. Đã có, giữ nguyên.
2. **Bắt đúng exit code (lỗi #2):** wrapper phải `set -Eeuo pipefail` + `trap`; mỗi bước `|| die`, **cấm `|| true`/nuốt code**.
3. **‼ Backup TRƯỚC khi dừng service (lỗi #3 — nặng nhất):** thứ tự BẤT BIẾN = verify duyệt → verify manifest →
   **backup + kiểm chứng KHI SERVICE CÒN CHẠY** → mới reload. Ưu tiên `pm2 reload` (không gián đoạn) thay vì stop→start.
   **Trap bảo đảm:** nếu thoát giữa chừng sau khi đã động vào service → luôn cố `pm2 reload/restart` để app không chết
   âm thầm; không tự bật lại được thì **la lớn "CẦN CAN THIỆP TAY"**, không im lặng.
4. **KHÔNG hardcode release:** DataHub đang chạy release riêng (`data-hub-4295223`) — mọi id/base/commit/PM2 app truyền
   qua biến; script App Report **không đụng DataHub**. Đã rà: script Claude 0 hardcode (chỉ comment ví dụ).
- Diễn tập bổ sung: `scripts/test_release_safety.sh` giờ **28/28 ĐẠT**, gồm ca "backup lỗi → cutover dừng, service CHƯA bị đụng".

## P2-BIS — BACKUP NHẤT QUÁN khi App Report ghi dữ liệu liên tục (Claude shadow verdict eae1d1d)
**Blocker thật:** `manifest_create` đọc cây SỐNG rồi `tar` đọc lại → file đổi ở giữa (3 file) → manifest ≠ archive.
**Fix gốc (đã hiện thực trong `scripts/release_lib.sh`):**
1. Sao dữ liệu ra **1 bản TĨNH (staging)** đúng 1 thời điểm; **manifest VÀ tar cùng đọc staging** ⇒ manifest ≡ archive
   theo thiết kế, không còn lệch.
2. **Cổng ổn định:** chỉ nhận bản sao khi cây sống KHÔNG đổi trong suốt lúc sao (so `tree_state` trước/sau). Còn "nóng"
   sau `BACKUP_STAGE_MAX_TRIES` lần → **fail-closed**, KHÔNG tạo backup dở, KHÔNG để lại file archive nửa vời.
3. **Ưu tiên snapshot bất biến:** ops trỏ `BACKUP_SOURCE=<mount CoW/LVM>` (đã tĩnh) để bỏ qua cổng — khớp khuyến nghị
   verdict (CoW/LVM; nếu máy không hỗ trợ thì staging + cổng ổn định, quá nóng thì dừng fail-closed).
**Bất biến bắt buộc:** kết quả LUÔN là 1 trong 2 — *fail-closed (không archive)* **HOẶC** *archive nhất quán
(manifest≡archive)*; **tuyệt đối không ra bản chắp vá**. Diễn tập `test_release_safety.sh` giờ **34/34 ĐẠT**
(gồm: manifest≡archive; hết ngân sách→fail-closed không để bản dở; writer nóng→hoặc fail-closed hoặc nhất quán; nguội→thành công).
> ⚠ Container Claude không có `rsync` — bản mẫu dùng `cp -a` + cổng ổn định (portable). Trên server có `rsync`/LVM,
> ops nên ưu tiên snapshot CoW/LVM cho ảnh point-in-time thật; mẫu này là mức nền tối thiểu đã fail-closed đúng.

## P3 — CỨNG HOÁ theo read-only review của bot (2026-07-26) — bản reference nay 41/41
Bot review read-only (chưa exec) nêu 5 điểm; **phần lớn đúng, đã sửa trong reference `scripts/*`:**
1. **`cp` không được nuốt lỗi** (`release_lib.sh/stage_stable`): cp lỗi → bỏ bản dở + thử lại → hết lượt **fail-closed**.
2. **Token 1-lần phải NGUYÊN TỬ** (`verify_approval.sh`): claim bằng `mkdir` marker riêng token (`USED_TOKENS_DIR`), không còn khe check-rồi-write.
3. **Manifest phải có uid:gid + node_modules**: `manifest_create` ghi thêm `uid:gid`; `release_manifest.sh` gồm `server/node_modules` runtime.
4. **Verify manifest LẦN CUỐI sát trước `START_CMD`** (`safe_pm2_cutover.sh`) — đóng khe TOCTOU sau bước backup.
5. **Rollback chạy lệnh BẢN CŨ** qua `ROLLBACK_START_CMD` (`safe_rollback.sh`), không tái dùng `START_CMD` bản mới đang lỗi.
- Diễn tập `test_release_safety.sh` **41/41 ĐẠT** (thêm 7 ca khoá đúng 5 điểm trên). Bản reference sẵn sàng để bot **lắp thẳng** vào `deploy_release.sh` thật.
- ‼ **Vẫn CẦN bot diễn tập trên ĐƯỜNG THẬT** (real paths server, ưu tiên CoW/LVM) + nộp log → Claude review đường thật → GO. Reference xanh 41/41 KHÔNG thay cho diễn tập đường thật.

## Trình tự chốt
1. Bot sửa **P1-3 → P1-1 → P1-2 → P2** (+ P3 đã có bản reference), kèm **log diễn tập ĐƯỜNG THẬT** từng ca nghiệm thu.
2. Claude review lại; đủ bằng chứng đường thật mới đổi verdict sang GO.
3. **Chỉ khi GO** mới được cutover đợt tiếp theo.

## P4 — ‼ CẤM BUILD TRONG THƯ MỤC ĐANG PHỤC VỤ (CEO duyệt 2026-07-29, sau sự cố thật)

**Sự cố tối 29/07:** bản frontend nhánh `feat/bonus-penalty-v3.3` (`ccacba0`) **lên production ngoài ý muốn**.
Bot đã khôi phục về `4c34551` trong ~vài phút. Nhưng nguyên nhân mới là điều đáng nhớ.

**‼ Auto-deploy KHÔNG hề bị vượt qua.** `.auto-deploy.disabled` còn nguyên suốt, hoàn toàn vô can.
Bản build sai lên production vì **`npm run build` chạy ngay trong cây thư mục production**, ghi thẳng đè
`web/dist` đang phục vụ. Vite xoá + ghi lại `dist` là **live ngay lập tức**, không cần deploy, không cần
restart, không ai bấm nút nào.

⇒ **Khoá auto-deploy canh cửa trước; build tại chỗ là cửa sau — và cửa sau chưa có khoá nào.**
Mọi lớp bảo vệ P1–P3 ở trên đều **đứng ngoài** đường đi này.

**Hai thiệt hại đã xảy ra thật:**
1. Ba ô **"Phạt dự kiến" / "Phạt thiếu Xu" / "Ứng lần 1"** được vẽ **vô điều kiện** cho mọi NV mở
   "Chi phí của tôi" ⇒ nhân viên có thể đã thấy ô phạt **trước khi CEO công bố chính sách**.
2. Cây thư mục server bị bỏ lại ở **HEAD nhánh phạt** (`a5ad541`). PM2 không restart nên backend vẫn chạy
   code cũ **trong RAM** — nhưng **lần khởi động lại kế tiếp** (sập / reboot / cron) sẽ **tự nạp backend phạt**,
   không ai bấm gì. Quả mìn nằm im. Đã tháo lúc kéo workspace về `main@9cda0c4`.

### Quy tắc bắt buộc

1. **CẤM `npm run build` (hoặc bất kỳ lệnh build nào) trong cây thư mục production.**
   Build ở **worktree/thư mục staging riêng**, xong mới đổi chỗ nguyên khối (atomic swap) như P1/P2.
2. **`web/dist` đang phục vụ chỉ được thay bằng đúng một thao tác: đổi chỗ.** Không bao giờ ghi từng file vào đó.
3. **Sau MỌI thao tác trên server** — kể cả chỉ "build thử", "test nhanh", "xem chút" — phải trả cây thư mục
   về đúng nhánh/commit đang chạy production, rồi **kiểm bằng `git rev-parse HEAD` + `git status`**.
   PM2 PID không đổi **KHÔNG** chứng minh đĩa sạch: PID chỉ nói backend đang chạy code cũ trong RAM.
4. **Tài liệu an toàn phải được COMMIT, không để ở working tree.** Giữ ở working tree "cho khỏi lệch HEAD"
   là làm ngược: `git reset --hard` đợt sau **xoá sạch** đúng cái file luật này. Commit lên nhánh rồi PR.
5. **Muốn thử frontend nhánh khác thì dựng cổng riêng**, không đụng `web/dist` production.

### Nghiệm thu
- Chạy build trong cây production ⇒ script/hook **chặn**, báo lỗi rõ, không tạo được `web/dist`.
- Sau mỗi phiên làm việc trên server: `git rev-parse HEAD` **phải khớp** commit production đang chạy.
- `version.json` public **phải khớp** commit đó.
