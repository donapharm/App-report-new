### 2026-07-24 — Claude Code (điều tra hiệu năng) — App Report chậm F5/đổi trang; "Chi phí của tôi" nặng nhất
- **CEO báo app tải rất chậm mỗi F5/đổi trang, riêng "Chi phí của tôi" chậm + hay lỗi.** Điều tra code production (`f560402`). Báo cáo: `BAO_CAO_HIEU_NANG_APP_REPORT.md`; task sửa: `TASK_REPORT_PERF_FIX.md` (giao Report Bot).
- **Nguyên nhân chính:** Trang Tổng quan bắn **~11 API/lần**, trong đó **7 endpoint nặng KHÔNG cache** (`/analysis`,`/alerts`,`/revenue`×2,`/cst`,`/filters`,`/targets`×2 — chỉ `/overview`,`/trend` có memoGet). Node 1 luồng → request nặng chặn event-loop → xếp hàng. `/alerts` lặp per-NV (O(NV×kỳ))+`cstTable`; `/analysis` bị kéo vào Tổng quan chỉ để hiện 1 hàng insights; `api.targets` gọi trùng 2 lần.
- **‼ "Chi phí của tôi" (nặng nhất):** chế độ "Tất cả NV" gọi App VAT `/api/khoan/dashboard` **qua mạng cho TỪNG NV (21 lần)**, timeout 5s+retry, concurrency 3 → ~7 đợt mạng; App VAT chậm → chạm timeout → "Lỗi máy chủ"/tải mãi.
- **KHÔNG phải nguyên nhân:** bundle JS đã cache immutable (F5 không tải lại code); tầng store đã cache `_allRows`/`_cstAll` tốt.
- **Hướng sửa (Report Bot, chỉ tốc độ — KHÔNG đổi số/quyền):** P0 thêm memoGet cho 5 route đọc nặng (key có empCode, TTL 30–60s, invalidate theo chữ ký slot) + bỏ gọi trùng; **P0-B** cache App VAT theo (empCode,period) + **lazy-load điểm/xu chỉ cho NV đang xem** (không chặn cả trang chờ 21 lượt App VAT) + ALL resilient (1 NV lỗi không sập trang); P1 bật `compression`. Nghiệm thu: đối chiếu số trước/sau TRÙNG + đo tốc độ lần 1 vs lần 2.

### 2026-07-24 — Report Bot — UI KPI Điểm/Xu/Thưởng/Phạt #170 DEPLOY PASS
- **Bố cục đã duyệt:** trong lưới KPI, `Thưởng dự kiến` đứng ngay cạnh `Phạt dự kiến`; `Xu tích lũy` được chuyển khỏi lưới KPI xuống đầu hàng cấn trừ theo đúng thứ tự `[Xu][Chi phí gốc] − [Cấn trừ] = [Còn lại]`. Desktop dùng 4 cột KPI/6 cột phương trình; mobile ép 1 cột, không tràn ngang. Nút Zalo OA nổi được ẩn riêng tại màn Employee Cost mobile để không che ô chi phí.
- **Màu/ngữ nghĩa:** cặp Điểm↔Xu dùng indigo `#4338ca` trên nền `#eef2ff`; Thưởng xanh `#047857`; Phạt đỏ `#b91c1c`. Nguồn Điểm chỉ hiện `App Report · point-local-2026-05-r1` khi rule local thực sự active, ngược lại fallback `App VAT`. Phạt vẫn ẩn số `—`, trạng thái `đang đối soát`; cấn trừ/còn lại không mở khi parity chưa exact-zero, không ghi DataHub/payroll.
- **Nghiệm thu UI tạm:** DN009 hiện `53,96 · 53,96`; desktop `1440×1400` và mobile `390×1200` đều PASS layout/màu/nguồn/rule/khóa phạt; visual review cuối PASS, không blocker. Evidence: `artifacts/employee-kpi-layout-ui170-acceptance.json`, `artifacts/employee-kpi-layout-ui170-desktop.png`, `artifacts/employee-kpi-layout-ui170-mobile.png`.
- **Gate trước deploy:** web **57/57**, focused **6/6**, Vite production build, `git diff --check`, frontend secret/forbidden-field scan đều PASS. Claude review độc lập commit `998dc8b`: **PASS, không blocker**.
- **Deploy sau CEO duyệt:** merge/push `main` tại **`a18c453`**, production version **`a18c453-20260724-120751-096`**. Health local/public PASS; asset JS/CSS public khớp byte-for-byte build local, đủ marker màu/nguồn/khóa phạt. Đây là UI-only nên không restart backend; PM2 `app-report` giữ online. Rollback: `backup/pre-ui-kpi-deploy-20260724-120734` + `backups/ui-kpi-deploy-20260724-120734`. Evidence: `artifacts/employee-kpi-layout-ui170-production-deploy.json`.

### 2026-07-24 — Report Bot — deploy production Điểm local #169 PASS, Phạt tiếp tục khóa
- Đã pull `origin/main`, tạo rollback `backup/pre-point-local-display-deploy-20260724-113003` + `backups/point-local-display-deploy-20260724-113003`, merge nhánh Claude review PASS vào `main` tại **`fbe0f6a`**, push/build và restart `app-report`. Production hiện phục vụ **`fbe0f6a-20260724-113018-363`**; health nội bộ/public HTTP 200.
- Nghiệm thu LIVE bằng phiên QA self-scope tạm: yêu cầu giả `emp=DN016` dưới phiên DN009 vẫn bị ép đúng DN009; Điểm tháng/quý **`53,96 · 53,96`**, nguồn `App Report`, rule `point-local-2026-05-r1`, local/public HTTP 200. Phiên QA đã xóa và restart dọn sạch sau nghiệm thu.
- **Khóa an toàn giữ nguyên:** `penalty_applied=null`, parity `available=false`, trạng thái `đang đối soát`; chưa xuất phạt, chưa cấn trừ, chưa gửi thông báo, không ghi DataHub/payroll. Evidence: `artifacts/employee-point-local-prod-acceptance-169.json`.

### 2026-07-24 — Report Bot — Điểm local/DataHub penalty endpoint + bảng 8 đơn vị UNALLOCATED (chưa deploy)
- **Hoàn tất endpoint chỉ đọc cho DataHub:** `GET /api/integrations/datahub/employee-quarter-penalty?emp=<MÃ_NV>&quarter=YYYY-Qn`. Endpoint chỉ nhận service token backend (`Authorization: Bearer` hoặc `x-app-report-service-token`), chỉ cho đúng 1 NV thuộc roster, không nhận `ALL`, không có route ghi. Payload xuất `emp_code · quarter · point_quarter · xu_quarter · missing_xu · phat_tien · rule_version`; App Report không ghi payroll/không sửa DataHub.
- **Gate phạt fail-closed theo đúng kỳ:** chỉ trả HTTP 200/số phạt khi parity `exact_zero=true` đồng thời khớp đúng tháng cuối quý, point rule, NV và đủ Xu/công thức; mọi trường hợp khác trả HTTP 409, `phat_tien=null`, trạng thái `đang đối soát`. Parity LIVE T07/2026 hiện **BLOCKED**: DN009 `53,96↔0`, DN016 `48,01↔0`, DN024 `21,70↔0`, DN001 `41,21↔0`; artifact `artifacts/employee-point-local-live-parity-169.json`. Vì vậy **không deploy** và chưa có số phạt nào được xuất để trừ thật.
- **Xuất bảng CEO 8 đơn vị UNALLOCATED:** snapshot phát hiện `rev_2src_072026_20260723020053.json` (run 185, data as of 23/07 09:00:46, DataHub roster v3.7) có đúng **8 đơn vị · 26 dòng · 15 đơn · 22 QLNB · 403.042.400đ** theo policy `ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP`. Đối soát snapshot active `rev_2src_072026_20260724030103.json` (run 201, data as of 24/07 10:00:55, roster v3.9): đủ 26/26 source line và hiện **UNALLOCATED = 0 đơn vị/0 dòng/0đ**. Excel 3 sheet + JSON/README evidence tại `artifacts/unallocated-8-units-20260724/`.
- **Gate kỹ thuật:** focused **69/69**, full server **327/327**, web **56/56**, Vite production build PASS; `git diff --check`, frontend secret scan, DataHub write-path scan, SHA-256/structure/tổng Excel đều PASS. Không gửi Telegram/email, không restart/deploy production.

### 2026-07-24 — Claude Code (review độc lập) — Điểm-local + endpoint phạt DataHub `95a41bf`: PASS code · blocker mở khóa phạt = App VAT
- **Đọc code thật + chạy độc lập test.** Nhánh `review/employee-point-local-169` (3e885e7→95a41bf). **VERDICT: PASS về code**, không lỗi chặn; **giữ deploy** (đúng thiết kế, phạt fail-closed).
- **Đã kiểm & xác nhận:** (1) **Điểm đúng công thức** `Σ(DT×hệ số÷100tr)` làm tròn 2 số; hệ số config `employee_point_coeff.json` CL/NT=2·NCL 025–028=2·default **1** (không rõ tuyến→1, có DQ warning, **không bịa 2**); loại `isExcluded` (không tính điểm cho UNALLOCATED). (2) **App VAT giờ xu-only** — `employeeVatKhoan.js` bỏ hết trường điểm/phạt/pct, chỉ còn xu/carry. (3) **Phạt fail-closed**: `parityStatus` chỉ mở khi gate `exact_zero_parity=true` + đúng rule+kỳ+NV; chưa đạt → `phat_tien=null`, "đang đối soát". (4) **Endpoint DataHub** `GET /integrations/datahub/employee-quarter-penalty` = **service-token-only** (`requireDataHubService`, chặn cookie user), **1 NV/quý**, read-only, **re-validate** `phạt===floor(max(điểm−xu,0)/2)×600k` (chống trừ oan), không payroll/không sửa DataHub. (5) **Thông báo = preview-only, CHƯA gửi thật** (`outcome=preview_only_send_disabled`), actor băm, đủ quy tắc điểm+xu+phạt. (6) Self-scope qua `resolveScopedEmployee` (NV ép own). **Chạy độc lập: 11/11 test điểm PASS.**
- **‼ PHÁT HIỆN KIẾN TRÚC (quan trọng):** parity artifact cho thấy **App Report tính điểm ĐÚNG** (DN009=53,96·DN016=48,01·DN024=21,70·DN001=41,21) nhưng **App VAT vẫn trả điểm = 0** → delta = chính số App Report, **exact_zero=false toàn bộ**. Cổng phạt so App Report ↔ App VAT nên **KHÔNG thể = 0 tới khi App VAT sửa** → **blocker mở khóa phạt nằm ở APP VAT** (phải tính điểm nội bộ từ ĐÚNG doanh thu App Sale làm oracle đối chiếu), **không phải App Report**. Đã làm rõ trong directive §4. App VAT vẫn xu-only cho hiển thị nhưng giữ điểm-nội-bộ làm oracle (defense-in-depth). Task: `TASK_APPVAT_DIEM_PARITY.md`.
- **Khuyến nghị deploy (tách 2 phần):** **(A) Điểm-local DISPLAY deploy được NGAY** — sửa đúng lỗi "Điểm 0·0", điểm nổi số thật + nhãn "App Report" + `point-local-*`; phạt vẫn "đang đối soát" (an toàn). **(B) Mở khóa phạt** chờ App VAT parity=0. CEO duyệt (A) trước để NV thấy điểm đúng; (B) sau.
- **Báo cáo 8 đơn vị (Excel):** số nội tại khớp — 26 dòng · 8 ĐV · **403.042.400đ** tại snapshot phát hiện (run #185, roster v3.7). **Snapshot hiện tại (run #201, roster v3.9) UNALLOCATED = 0** → roster mới đã gán 26 dòng về "NV hiện tại". ⇒ Không còn treo; nhưng **cần CEO xác nhận "NV hiện tại" của 8 ĐV có đúng phụ trách không** (trước đó gán lẫn nhiều NV). Đúng → khỏi cần Sale Bot remap.

### 2026-07-24 — Claude Code (CEO chốt) — Nút TRỪ tiền phạt đặt tại DATAHUB smart app (CEO bấm)
- **CEO chốt:** đơn vị **thực thi lệnh trừ** phạt thiếu-xu = **DataHub smart app** (chủ sở hữu "chi phí bán hàng"); **CEO bấm nút duyệt trừ** tại DataHub. Cập nhật `DIRECTIVE_EMP_COST_DIEM_LOCAL.md` §7 + §8.4.
- **Luồng chốt:** App Report tính điểm(SSOT)+phạt dự kiến (đã parity) → **xuất số phạt** cho DataHub qua service endpoint self-scope (per-NV/quý: `emp_code·quý·điểm·xu·thiếu·phat_tien·rule_version`) + gửi Telegram/Email báo NV kèm quy tắc → **CEO xem & bấm nút ở DataHub** → DataHub **ghi cấn trừ thật** vào chi phí bán hàng bằng đúng số App Report (1 nơi duy nhất ghi, versioned+audit) → App Report hiển thị "đã cấn trừ (DataHub)". **App Report KHÔNG tự trừ/không sửa chi phí.**
- Task giao **DataHub Bot**: `TASK_DATAHUB_PENALTY_DEDUCT.md` (dựng nút duyệt + đọc số phạt App Report + ghi cấn trừ + audit; **không tự tính lại** — dùng số SSOT đã parity). **Còn chờ:** Report Bot cần dựng service endpoint xuất số phạt (bổ sung vào việc điểm-local).

### 2026-07-24 — Claude Code (review độc lập) — Thưởng v2 (C10) nhánh `review/employee-cost-bonus-v2-166` `3c3dc9d`: PASS code, GIỮ deploy
- **Đọc code thật, không nhận PASS theo lời bot.** Engine `f373dfc` + menu/config/preview `18641fd`. **VERDICT: PASS về code** với 1 **BLOCKER hợp nhất** + 2 lưu ý nhỏ; **giữ deploy** tới khi DataHub expose C10 + parity.
- **Đã kiểm & xác nhận:** (1) **Chỉ đọc C10** từ catalog DataHub — `buildPriorityRevenue` không đọc `priority`/`tech_rank` App Sale (có test khẳng định); (2) **Fail-closed** phần nhóm ưu tiên = 0 khi C10 thiếu/rỗng/sai allowlist/xung đột (`sourceAvailable=false` hoặc mã đa nhóm → unclassified); (3) `catalogManagement`: C10 vào whitelist optional, **C32/C47 vẫn khóa vĩnh viễn**, DQ projection không lộ %/C32/C47; (4) **Self-scope + admin-only:** mọi route `/admin/bonus-policies*` là `requireAuth+requireAdmin`; **save bắt buộc preview cùng phiên** (one-time, 15', đúng actor) → có preview trước khi lưu + audit; ALL/aggregate chặn non-admin 403; (5) **Không payroll/không gửi thưởng/không sửa DataHub** — chỉ "Thưởng dự kiến". Base = doanh thu **trước VAT** (path production dùng override theo `segment.revenue` before-VAT). Cap base tier ≤0.25%. Config default đúng directive (tier 0/0.1/0.15/0.18/0.25; ngưỡng 101%; H.A*1·H.A0.8·H.B0.5·H.C0.1·H.D0.1). **Chạy độc lập 14/14 test bonus PASS.**
- **‼ BLOCKER (hợp nhất) — phải rebase trước khi merge:** nhánh cắt tại `a875c42` (trước #169/#170) → **thiếu `DIRECTIVE_EMP_COST_DIEM_LOCAL.md`**; merge nguyên trạng sẽ **xóa directive điểm-local + revert 2 mục CHANGELOG**. Yêu cầu `git rebase origin/main` (hoặc merge main vào nhánh) rồi push lại, xác nhận directive còn nguyên.
- **Lưu ý nhỏ (không chặn, display-only):** (a) path fallback không-override tính base theo `achieved` (KPI) thay vì tổng before-VAT — production dùng override nên không lệch live, nên đồng bộ về before-VAT cho nhất quán; (b) `totalCapPct` mặc định `null` = **không trần tổng tuyệt đối** (rate ưu tiên tới 1.0% không bị chặn cứng) — vì là "dự kiến" nên chấp nhận, khuyến nghị đặt 1 trần an toàn.
- **Deploy gate (bot đã tự giữ — đồng ý):** DataHub production **chưa expose C10** → phần nhóm ưu tiên fail-closed 0. Cần DataHub hoàn tất C10 + **parity** rồi mới xin CEO duyệt 3-nút. **Production hiện KHÔNG đổi.**

### 2026-07-24 — Claude Code (giao bot, bổ sung) — Cơ chế phạt theo QUÝ + cảnh báo tháng + thông báo trước khi trừ
- **CEO chốt cơ chế phạt.** Cập nhật `DIRECTIVE_EMP_COST_DIEM_LOCAL.md` §7–§8: (1) **Cảnh báo NGHIÊM KHẮC hàng tháng** khi thiếu xu (Telegram/Email) để NV kịp khắc phục — chưa trừ; (2) **Chốt trừ 1 lần vào tháng cuối quý** (T03/T06/T09/T12): ví dụ đang T07/2026 → cuối T07/T08 chỉ cảnh cáo, **cuối T09** mới cấn trừ vào chi phí bán hàng nếu xu quý < điểm quý; (3) **‼ Thông báo TRƯỚC khi trừ** qua Telegram+Email, **kèm quy tắc tính điểm + tính xu + công thức phạt + số liệu** để NV nắm rõ, không âm thầm.
- **Ranh giới:** App Report tính điểm (SSOT) + phạt dự kiến + cảnh báo + **gửi thông báo**; **KHÔNG** ghi payroll/không sửa chi phí DataHub/không tự phát lệnh trừ. **Việc ghi cấn trừ THẬT** vào chi phí bán hàng do **1 nơi** (DataHub/quy trình tài chính hoặc App VAT SSOT khoản) thực hiện bằng đúng số đã qua **parity** — tránh trừ 2 lần/lệch số. **Còn hỏi CEO:** đơn vị thực thi lệnh trừ. FE phân biệt "dự kiến — chưa trừ" (tháng thường) vs "chốt quý — cấn trừ" (tháng cuối quý).

### 2026-07-24 — Claude Code (giao bot) — Điểm tháng/quý: App Report TỰ TÍNH (không lấy App VAT); Xu vẫn App VAT
- **CEO chốt:** điểm tháng/quý **có sẵn ở App Report** (có doanh thu rồi) → **tự tính**, không gọi App VAT lấy điểm. Bằng chứng: production hiện **"Điểm 0·0 — Nguồn App VAT"** cho DN009 dù DN009 doanh thu thật **2.660.205.490đ** (App VAT đọc doanh thu cũ/lệch). Directive `DIRECTIVE_EMP_COST_DIEM_LOCAL.md`.
- **Phân công số:** **Điểm** = App Report tính `Σ(DT_dòng × hệ số ÷ 100tr)` làm tròn 2 số (App Report = **SSOT điểm** vì sở hữu doanh thu); **Xu** = App VAT giữ (SSOT xu từ bill); **Phạt** dự kiến = App Report ghép `floor(max(điểm_quý−xu_quý,0)÷2)×600k`, **display-only, không payroll**. Hệ số config versioned: CL=2.0·NT=2.0·NCL đơn vị 025–028=2.0·NCL thường=1.0 (T05/2026); tuyến không rõ → **default 1.0** (không bịa 2.0). App VAT hỏng chỉ mất **xu**, **điểm vẫn hiện**.
- **‼ Gate "không trừ oan tiền NV":** phạt là tiền thật → **bắt buộc parity điểm App Report ↔ App VAT = 0 sai số** (khi App VAT đọc đúng doanh thu) trước khi deploy phạt; lệch → ẩn/gắn cờ phạt "đang đối soát". FE đổi nhãn nguồn điểm **App VAT → App Report**. **Còn hỏi CEO:** phạt tính tại App Report (mặc định, có gate) hay vẫn chỉ đọc số App VAT.

### 2026-07-24 — Report Bot — hoàn tất nhánh review Thưởng v2 #166 (chưa deploy)
- Pha 1 `f373dfc`: engine 2 phần đúng directive — cơ bản theo mức đạt target và cộng nhóm ưu tiên từ **DataHub C10 duy nhất** khi tổng đạt `≥101%`; tổng cap mặc định tắt. Thiếu/rỗng/sai/xung đột C10 đều fail-closed về 0 phần 2 và trả coverage/note; code không đọc `App Sale priority/tech_rank`.
- Pha 2 `18641fd`: menu **Target → Cấu hình Thưởng v2** có version theo giai đoạn, bậc/rate/ngưỡng/cap, đè tầng `mặc định → nhóm C10 → tuyến → đơn vị → NV`, preview theo NV trước khi lưu, preview-id một lần/15 phút/cùng actor, audit nguyên tử. Menu không cho sửa mapping C10; kết quả vẫn là **dự kiến/read-only**, không payroll/không gửi thưởng.
- Catalog chỉ whitelist/project tùy chọn `c10`; khóa cứng `c32/c47` không đổi. Gate nhánh: server **313/313**, web **56/56**, build production và `git diff --check` PASS; quét source/diff không có fallback App Sale hoặc secret. **DEPLOY BLOCKED** vì DataHub production/LKG v3.9 vẫn chưa expose C10; chỉ push nhánh `review/employee-cost-bonus-v2-166` để review độc lập.

### 2026-07-24 — Report Bot — xác minh nguồn C10 cho Thưởng v2 #166/#167
- DataHub production catalog-management version `3.9` trả **27.719 catalog + 27.719 assignments**, nhưng chỉ expose `c3,c4,c5,c6,c7,c15,c16,c17,c25,c31`; **không có `c10/C10`**, vẫn khóa đúng `c32/c47`. LKG App Report cùng version cũng không có C10.
- App Sale production revision `8b42c07e` có `products.tech_rank` cho đủ **371/371 QLNB**: `H.A*=136`, `H.A=102`, `H.B=62`, `H.C=46`, `H.D=17`, ngoài directive còn `H.E=4`, `H.F=4`; không thiếu/trùng QLNB xung đột. Đây chỉ là bằng chứng đối chiếu, **không được dùng runtime** vì SSOT chính thức là C10 CEO vault/DataHub.
- Kết luận: phụ thuộc DataHub expose C10 đang **BLOCKED**. App Report tiếp tục làm engine/menu trên nhánh review với C10 strict và fail-closed; không fallback App Sale, không tự phân nhóm, chưa deploy. Evidence: `artifacts/employee-bonus-v2-c10-verification-166.md`.

### 2026-07-24 — Claude Code (nghiệm thu) — production reward `55f8bd0`: PASS
- **Kiểm tra độc lập trên main: PASS.** `employeeVatKhoan.js` + routes đọc App VAT trên main; **`VAT_SERVICE_TOKEN` KHÔNG ở FE** (chỉ backend, FE dùng session token user). Code deploy = bản review `0c1da00` + **parity 0 sai số** (điểm/xu/phạt App Report = App VAT). Self-scope 2 lớp, không lộ token (chỉ sid băm ở App VAT), số chi phí DataHub không đổi. Version live `55f8bd0-20260724-072611`.
- Ô **Thưởng dự kiến** live nhưng hiện "Chưa cấu hình" (chờ Thưởng v2 + C10). **Đã LIVE:** điểm/xu/phạt + dòng cấn trừ + cảnh báo.
- **Còn lại:** Thưởng v2 (chờ DataHub expose C10) + CEO điền bậc; các mục nguồn cũ (DataHub catalog V30.10/gap, Sale Bot 8 đơn vị, unit_province.json).

### 2026-07-24 — Report Bot (deploy + nghiệm thu production) — Thưởng dự kiến + Điểm/Xu/Phạt App VAT #162/#165 PASS
- Đã merge bản được CEO duyệt vào `main` tại `55f8bd0`, push GitHub, build/deploy frontend và restart đồng bộ backend + Telegram worker. Production `report.donapharm.asia` đang phục vụ version **`55f8bd0-20260724-072611-012`**; health nội bộ/public đều 200. Runtime cuối: `app-report` PID **652694**, `app-report-tgbot` PID **652702**, App VAT PID **542573**, DataHub online. Rollback: branch `backup/pre-reward-diemxu-deploy-20260724-072453` và backup `backups/reward-diemxu-deploy-20260724_072903/`.
- Nghiệm thu LIVE T06/2026 đối chiếu trực tiếp App Report ↔ `/api/khoan/dashboard`: **DN009 và DN016 khớp tuyệt đối toàn bộ điểm/xu/carry/%/thiếu-dư/phạt, sai số 0**, cùng `rule_version=khoan-ssot-v2026-05-r1`. DN009: điểm tháng/quý **58,64 / 163,31**; xu tháng/quý tổng **23,83 / 115,81**; carry **6,48**; đạt quý **70,91%**; thiếu **47,5 xu**; phạt **13.800.000đ**. Phiên DN009 cố hỏi `emp=DN016` vẫn bị ép trả đúng **DN009**; public proxy HTTPS cũng PASS.
- UI production PASS: ô **Thưởng dự kiến** hiện đúng **“Chưa cấu hình mức thưởng”** vì tiers đang để trống/fail-closed; cảnh báo sớm `<90%` hiển thị đúng số DN009; hàng **Chi phí gốc / Cấn trừ thiếu xu / Còn lại (display-only)** tách hai nguồn DataHub/App VAT và ghi rõ **không ghi DataHub/payroll**. T06 có coverage chi phí 0% nên số tiền chi phí/cấn trừ fail-closed thành `—`, không tự bịa hoặc sửa DataHub.
- Khóa DataHub trước/sau deploy không đổi: DN001 T07 giữ **10.982 dòng / 5 cột**, cùng SHA-256 nguồn `0afe9a2feca2d996d5fb161e18a54a782c7481e74efdf7f9f0f8134649ba19e3`. Quét toàn bộ log active App Report/App VAT và bundle production: **0 full token, 0 prefix 16 ký tự, 81 sid băm**, frontend không có `VAT_BASE`/`VAT_SERVICE_TOKEN`/URL upstream. Đã redaction tại chỗ đúng **3 prefix-only** lịch sử trước hardening (không từng có full token), giữ nguyên phần log còn lại; 2 phiên QA tạm đã xóa, không chiếm thiết bị/không còn hiệu lực.
- Gate: full server/web tests PASS; focused **13/13 + 5/5**; production build và `git diff --check` PASS. Evidence: `artifacts/employee-reward-diemxu-prod-acceptance-162.json`, `artifacts/employee-reward-diemxu-prod-ui-162.png`.

### 2026-07-24 — Claude Code review — LIVE parity Điểm/Xu/Phạt #162 PASS
- **VERDICT: PASS · DEPLOY_DECISION: READY_FOR_DEPLOY_APPROVAL.** Claude review read-only toàn bộ directive, backend/FE, self-scope hai lớp, fail-closed, audit, token backend-only, UI display-only và artifact production parity; xác nhận không còn blocker kỹ thuật.
- Bằng chứng production: App VAT `473de59`, health OK; T06/2026 `DN001/DN009/DN016/DN024` khớp tuyệt đối, sai số 0; DN009 phạt `13.800.000đ`; log chỉ sid băm, không full token/prefix. `.env` production đã có `VAT_BASE`/`VAT_SERVICE_TOKEN` backend-only; focused tests `13/13 + 5/5`, build PASS. Review lưu tại `artifacts/claude-review-employee-vat-khoan-162.md`. **Chưa deploy/restart App Report; chờ CEO duyệt deploy riêng.**

### 2026-07-23 — Claude Code (cập nhật) — Nguồn nhóm ưu tiên Thưởng v2 = C10 (CEO vault/DataHub)
- CEO chốt: nhóm ưu tiên (H.A*/H.A/H.B/H.C/H.D) = **cột C10 trong CEO vault (DataHub)**. App Report **đọc C10** từ catalog snapshot, không tự phân loại/không config tay. **Phụ thuộc DataHub expose C10** (task `TASK_DATAHUB_EXPOSE_C10_PRIORITY.md` — whitelist như C48, khóa C32/C47). Cập nhật §2 directive Thưởng v2.

### 2026-07-23 — Claude Code (giao bot) — Thưởng v2: 2 phần (cơ bản + nhóm ưu tiên) + config linh hoạt
- CEO nâng cấp thưởng. Directive `DIRECTIVE_EMP_COST_BONUS_V2.md`: **Phần 1** cơ bản (`<90→0·90–100→0.10·100–110→0.15·110–130→0.18·≥130→0.25` × DT trước VAT); **Phần 2** nhóm ưu tiên (khi TỔNG đạt ≥101%): `H.A*→1.0·H.A→0.8·H.B→0.5·H.C→0.1·H.D→0.1` × DT nhóm. Tổng = P1+P2.
- **Linh hoạt:** config theo **giai đoạn (versioned)** + **đè tầng** (mặc định→nhóm hàng→tuyến→đơn vị→NV) + **menu chỉnh trong Target** + **preview** trước khi lưu + audit. Nhóm QLNB→ưu tiên: đọc catalog nếu có, không thì config CEO khai. Vẫn "dự kiến", không payroll, self-scope, fail-closed. Còn hỏi CEO: nguồn phân loại nhóm + "1% = 1% doanh thu nhóm". Chưa deploy.
- **Điểm/xu/phạt (`0c1da00`) deploy độc lập ngay** (#165, parity PASS) — không chờ Thưởng v2.

### 2026-07-23 — Claude Code (duyệt deploy) — LIVE parity điểm/xu/phạt PASS 0 sai số → READY DEPLOY
- **LIVE production parity #162 PASS 4/4 NV, sai số điểm/xu/phạt = 0** (App Report hiển thị = App VAT dashboard). Bằng chứng `1d7e100`. Token không lộ (chỉ `sid` băm). ⇒ App Report đọc đúng, không lệch/không bịa — an toàn "không trừ oan tiền NV".
- **Duyệt deploy** 2 nhánh reward (đều review PASS): ô Thưởng dự kiến `467eb2e` + đọc điểm/xu/phạt `0c1da00`. Directive `DIRECTIVE_EMP_COST_REWARD_DEPLOY.md` (deploy FE+BE đồng bộ + `.env` VAT_BASE/VAT_SERVICE_TOKEN backend-only + nghiệm thu). Sau deploy: CEO điền `employee_bonus_tiers.json`; (tùy chọn) rotate token.

### 2026-07-23 — Claude Code (review) — App Report đọc điểm/xu/phạt `0c1da00`: PASS (chờ live parity)
- **Review `0c1da00`: PASS.** `employeeVatKhoan.getForSession`: token backend-only (`VAT_SERVICE_TOKEN`), **KHÔNG log token** (audit chỉ actor+emp); **self-scope** (NV ép own; kiểm response `emp_code===empCode` chống App VAT trả nhầm NV); fail-closed (token<16/emp sai/baseUrl thiếu→không gọi; 401/timeout→retry→note). FE: 3 KPI điểm/xu/phạt + dòng cấn trừ (display-only) + cảnh báo. Test 305/305, web 53/53.
- **App VAT gỡ token-logging** (`473de59`: thay bằng `sid=sha256[:12]`, scrub log cũ) → **live parity chạy được**. Đề nghị nhẹ: rotate VAT_SERVICE_TOKEN. **Còn lại:** Report Bot chạy live parity (đối chiếu số App Report ↔ App VAT dashboard) → rồi deploy. Chưa merge/deploy.

### 2026-07-23 — Report Bot (review branch, chưa deploy) — App Report đọc Điểm/Xu/Phạt App VAT SSOT #162
- Thêm proxy backend read-only `GET /employee-cost/diem-xu` → App VAT `/api/khoan/dashboard`: `VAT_BASE`/`VAT_SERVICE_TOKEN` chỉ ở backend, timeout 5 giây + retry hữu hạn, response allowlist/schema chặt, lỗi trả đúng `chưa lấy được điểm/xu kỳ này`, không tính/remap điểm-xu-phạt tại App Report.
- Self-scope hai lớp: Sale bỏ qua `?emp=` và chỉ gọi mã phiên; CEO/admin chọn từng NV. Chế độ ALL gọi từng NV với concurrency giới hạn rồi chỉ cộng projection hiển thị, không yêu cầu upstream view-all. Mỗi lượt ghi audit actor/NV/kỳ/outcome/`rule_version`, không ghi token hay body nguồn.
- Employee Cost có 3 KPI **Điểm · Xu tích lũy · Phạt dự kiến**, nguồn + `rule_version`, cảnh báo sớm dưới 90%, và dòng **Chi phí gốc − cấn trừ thiếu xu = còn lại** display-only; giữ tách biệt DataHub/payroll, không ghi dữ liệu hoặc phát lệnh chi/trừ.
- Gate nhánh: server **305/305**, web **53/53**, production build PASS, `git diff --check` PASS; timeout upstream hard-cap 5 giây bao phủ cả lúc đọc body, bundle frontend không có biến/token/URL upstream App VAT. Fixture contract kiểm projection đúng tuyệt đối (sai số 0; phạt khớp nguyên số), gồm `rule_version=khoan-ssot-v2026-05-r1`. UI không ghép phạt tháng kết thúc vào tổng chi phí nhiều tháng; chỉ hiện phép cấn trừ khi chọn một tháng.
- **LIVE parity #162 PASS (24/07/2026 06:49 GMT+7, chưa deploy):** App VAT production `dona-vat` PID `542573`, health OK, commit bảo mật `473de59`; gọi thật `/api/khoan/dashboard` bằng `VAT_SERVICE_TOKEN`, kỳ `06/2026`, 4 NV `DN001/DN009/DN016/DN024`. App Report projection khớp App VAT tuyệt đối ở toàn bộ điểm/xu/carry/%/thiếu-dư/phạt, sai số `0`, cùng `rule_version=khoan-ssot-v2026-05-r1`; ca phạt thật DN009 khớp `13.800.000đ`. Log mới 4 Bearer requests chỉ có sid băm, không có full token/prefix. Focused tests server `13/13`, web `5/5`, production build và `git diff --check` PASS. Bằng chứng: `artifacts/employee-vat-khoan-live-parity-162.json`. App Report `.env` đã cấu hình backend-only `VAT_BASE`/`VAT_SERVICE_TOKEN` (secret không commit). Sẵn sàng để Claude chốt deploy; Report Bot chưa restart/deploy App Report.


### 2026-07-23 — Claude Code (review) — ô "Thưởng dự kiến" `467eb2e`: PASS
- **Review `467eb2e`: PASS.** `amount = doanh thu (revenue_before_vat) × bonusPct ÷ 100`. **Cap 0.5% khóa 3 lớp** (`min(config,0.5)` + mỗi bậc `min(bonusPct,capPct,0.5)`). **Fail-closed:** config rỗng/sai → "Chưa cấu hình mức thưởng"; **thiếu target → không bịa** (`missing_target`); dưới bậc → 0. **Phát hiện tầng chồng lấn** (overlap → unconfigured). Self-scope (tính theo empCode đã khóa). Test 292/292, web 48/48. Trên main, chưa deploy.
- Tầng nấc `employee_bonus_tiers.json` để trống → CEO điền sau (0.2–0.5%). Nhãn "dự kiến", không payroll.

### 2026-07-23 — Claude Code (giao bot) — App Report ĐỌC điểm/xu/phạt từ App VAT SSOT (đã ổn định)
- **App VAT chốt SSOT xong** (`/api/khoan/dashboard`, service auth Bearer + bắt buộc emp_code + no view-all, bill/carry thống nhất, commit `365b0c5`, rule_version `khoan-ssot-v2026-05-r1`). Contract-level PASS (App VAT repo khác, không soi code trực tiếp — tin test + commit App VAT).
- Directive `DIRECTIVE_EMP_COST_DIEMXU_CONSUME.md`: App Report **proxy backend** đọc App VAT (VAT_SERVICE_TOKEN backend-only, self-scope 2 lớp, fail-closed, audit, không LLM); FE **3 KPI** (điểm/xu/phạt) + **dòng "cấn trừ do thiếu xu"** (tách khỏi chi phí DataHub, display-only, "chi phí gốc − cấn trừ = còn lại") + **cảnh báo sớm** khi pct<90%. App Report chỉ đọc, không tính/không payroll.

### 2026-07-23 — Report Bot điều tra App VAT + Claude chốt hướng — điểm/xu/phạt = App VAT SSOT, App Report đọc
- **Kết quả điều tra (Report Bot):** App VAT ĐÃ có + expose điểm/xu per-NV. **Điểm** = `DT × hệ số ÷ 100tr` (CL/NT/NCL đơn vị 025–028=2.0; NCL thường=1.0 từ T05). **Xu** = `bill ÷ 500.000 × tỷ lệ` (1.3 từ T05). **Target xu = điểm doanh thu quý**. **PHẠT** = `floor(điểm thiếu ÷ 2) × 600.000đ` (từ T05). API: `/api/khoan/dashboard` (đủ nhất) + `/api/vat/xu-stats` + `/xu-overview`; self-scope NV OK.
- **Chốt hướng:** App VAT = **SSOT điểm/xu/phạt**, App Report **chỉ đọc** (không dựng engine). **CHƯA tích hợp** — 4 chốt App VAT phải xử trước (vì phạt = tiền thật): (1) 2 API tính bill khác → chọn 1 endpoint SSOT; (2) carry/reset + tỷ lệ/cảnh báo bất nhất; (3) chưa có auth service-to-service cho DataHub; (4) code điểm/xu chưa commit Git baseline. Task đã gửi App VAT Bot (`TASK_APPVAT_DIEMXU_SSOT.md`). Sau khi App VAT chốt: App Report đọc → 3 KPI (điểm/xu/phạt) + dòng "cấn trừ do thiếu xu" + cảnh báo (display-only, không payroll).
- **Riêng ô "Thưởng dự kiến" (target-based #159/#160)** độc lập — App Report tự tính từ target, chạy song song, không chờ App VAT.

### 2026-07-23 — Claude Code (giao bot) — Công thức tầng nấc thưởng: % doanh thu 0.2–0.5% (bổ sung #159)
- CEO chốt: thưởng là **% DOANH THU** (không phải tiền cố định), **kịch trần 0.5% cho đạt XUẤT SẮC**, sàn **0.2% khi đạt target**. Directive `DIRECTIVE_EMP_COST_BONUS_TIERS.md`: `Thưởng = doanh thu trước VAT × bonusPct(% đạt target)`; config `employee_bonus_tiers.json` dùng **`bonusPct`** (100–110%→0.2 · 110–120%→0.3 · 120–130%→0.4 · ≥130%→0.5), `capPct:0.5` chặn trần; <100%→0. Tháng & quý tính riêng. tiers rỗng → "Chưa cấu hình". Nhãn "dự kiến". Cấu hình được, CEO đổi không sửa code.

### 2026-07-23 — Claude Code (giao bot) — Ô KPI "Thưởng dự kiến" theo mức đạt target (khung trước)
- CEO muốn thêm **ô KPI thưởng**; target đã có trong App Report, **tầng nấc mức thưởng CEO điền sau**. Directive `DIRECTIVE_EMP_COST_BONUS_KPI.md`: ô **"Thưởng dự kiến (theo mức đạt target)"** = `bậc(% đạt target sẵn có)` × **bảng tầng nấc cấu hình** `employee_bonus_tiers.json` (để trống → hiện "Chưa cấu hình mức thưởng", không bịa). Nhãn **"dự kiến/tham khảo"** (không phải lệnh chi; App Report không gửi thưởng). Self-scope; số target từ analytics sẵn có (không tính lại). Điểm/xu/phạt (payout DataHub/App VAT) là việc khác. Chưa deploy.

### 2026-07-23 — Claude Code (giao bot) — Điều tra App VAT: điểm doanh thu + xu chi tiêu (cho KPI điểm/xu/phạt)
- CEO muốn thêm KPI **điểm (từ doanh thu) · xu chi tiêu tích lũy tháng/quý · phạt** nếu không đủ xu → **cấn trừ vào chi phí** (kèm cảnh báo). **Ranh giới:** đây là **payout** → engine ở **DataHub (SSOT)**/App VAT, App Report **chỉ hiển thị** (không tự tính, tránh trừ sai tiền NV).
- CEO chốt: điểm/xu **đã có ở App VAT** → giao Report Bot **điều tra App VAT** lấy đúng công thức (directive `DIRECTIVE_INVESTIGATE_APPVAT_DIEMXU.md`): (1) cách tính điểm doanh thu; (2) cách tính xu tích lũy + target quý; (3) App VAT có **API expose điểm/xu per-NV** không (để đọc lại). Read-only, chưa code. Sau báo cáo: Claude soạn task DataHub (engine phạt + contract) + task App Report (hiển thị KPI + dòng cấn trừ + cảnh báo).

### 2026-07-23 — Claude Code (review hậu kỳ) — vá blocker migration trusted-device `d8bbc53`: PASS
- **Bot tự phát hiện + vá blocker** (backfill ghi trust trước khi validate audit → có thể để device trusted không audit). **Fix PASS:** validate cả devices+audit **trước mọi write**; ghi file tạm + **rollback** nếu lỗi → không còn trạng thái trusted-thiếu-audit; assertion đếm (EXPECT_UPDATED/TRUSTED); **idempotent** (chạy 2 lần = 0 đổi). Hardening kèm: user thiếu/trùng fail-closed, không fallback `device.phone` cũ, FE chỉ nhớ SĐT từ phiên OTP hợp lệ. Backfill 31 thiết bị (23×1 · 6×2 · 2×3-trusted); CEO [3,2,0], 1 thiết bị miễn OTP. Fingerprint sai/thiết bị lạ bị từ chối; phiên cũ giữ. Test 286/286, web 46/46. Không đụng phần chi phí.

### 2026-07-23 — Claude Code (review hậu kỳ) — trusted-device login `df3b809`: PASS (feature Report Bot tự làm)
- **Review hậu kỳ (đã deploy production `df3b809`): an toàn.** Device băm **HMAC-SHA256** (không lưu ID thô); bản ghi **khóa theo `emp_code`** (device tin của NV này không bỏ OTP cho NV khác); **ngưỡng 3 OTP** mới thành tin cậy + ghi fingerprint (chống replay) + tối đa 3 thiết bị/tài khoản + **30 ngày reverify**. **`scopeOf`/`isAdmin`/`requireAdmin` KHÔNG đổi** → self-scope chi phí + quyền giữ nguyên. 61 phiên giữ, 54 device migrate HMAC. Test 279/279, web 46/46.
- **Lưu ý:** thiết bị tin cậy **bỏ OTP 30 ngày** (đánh đổi "nhớ thiết bị"); mất máy → **thu hồi device** (có danh sách + xóa) là chặn. Chỉnh chặt hơn qua env `SESSION_TRUSTED_DEVICE_REVERIFY_DAYS`/`SESSION_TRUSTED_LOGIN_THRESHOLD`. Không đụng phần "Chi phí của tôi".

### 2026-07-23 — Claude Code (nghiệm thu) — DQ Center production `1ec3455`: PASS + lưu ý PRODUCT_MISSING
- **Kiểm tra độc lập trên main: PASS.** DQ code + config + 4 route đã live; endpoint 200 (hết "Lỗi máy chủ"). 13 lỗi (12 đỏ/1 vàng), doanh thu ảnh hưởng 125.776.100đ; chuông 12 đỏ alert=true. **Self-scope chắc** (DN016 ép emp=ALL vẫn chỉ 2 lỗi của mình); Excel/PDF không C32/C47; số chi phí không đổi. 3 commit perf (cache catalog): cold request 180s→~1s. Test 274/274, web 43/43.
- **⚠ Lưu ý:** **PRODUCT_MISSING ("thiếu %") đang fail-closed → chưa nhảy chuông** (không báo bừa khi gap chưa grounded). ⇒ 13 lỗi **không gồm ~34 mã thiếu %** (vẫn ở tab gap). Không phải blocker; **đợt 2 nên grounded PRODUCT_MISSING** để loại lỗi lớn nhất cũng vào chuông. Đừng hiểu bảng DQ ít lỗi là dữ liệu sạch.

### 2026-07-23 — Report Bot (deploy + production acceptance) — DQ Center #141
- Đã merge review `6ad9769` vào `main` tại `4847157`, deploy đồng bộ frontend/backend và config `employee_cost_data_quality.json`; release production cuối **`1ec3455-20260723-115405-094`**. Public health/version 200; `app-report` online PID **2743911**, restart **97**; worker Telegram không cần restart, vẫn PID **2385158** / restart **42**. Backup/rollback baseline: `backups/employee-cost-dq-deploy-20260723_113416/`, rollback `fcb6bf5`.
- Nghiệm thu đầu tiên phát hiện request admin bị nguồn gap unavailable + quét toàn file catalog LKG 285 MB làm timeout 180 giây. Hotfix `7354afa`/`f533d82`/`1ec3455`: core DQ không bị gap giữ, đọc snapshot kỳ đã kiểm định và duy trì projection DQ 11 MB do luồng catalog/materializer cập nhật. Cold request T07 còn khoảng **1,0 giây**, không chặn `/health`; catalog T07 v3.7/checksum `17b237e3c86b4a71d8f968bb60d2ab88a94153e2b58f3e0ffd3ccb2dc6fe939d`, **27.719 dòng**. `PRODUCT_MISSING` giữ fail-closed khi chưa có gap snapshot grounded, không báo thiếu giả.
- API CEO local + public HTTPS `/api/employee-cost/data-quality?from=2026-07&to=2026-07` đều **200**: **13 exception = 12 đỏ + 1 vàng**, doanh thu ảnh hưởng **125.776.100đ**, đỏ **33.800.900đ**; gồm **6 `PRODUCT_MISMATCH` + 6 `UOM_MISMATCH` + 1 `UNIT_UNKNOWN`**. Summary chuông: `redCount=12`, `alert=true`; mỗi item có nguyên nhân, hành động, nguồn sửa.
- Self-scope live: DN016 dù gửi `emp=ALL&employee=CEO` vẫn scope DN016, chỉ **2 lỗi đỏ / 11.975.000đ**, **0 item chéo nhân viên**. Excel **44.135 bytes** và PDF **59.044 bytes**, đều HTTP 200/PDF hợp lệ; quét API/XLSX/PDF không có `C32`/`C47`. DQ read-only: DN001 trước/sau giữ nguyên period total **41.196.670đ**, annual **1.210.470đ**, revenue **2.479.111.324đ**.
- Gate cuối: server **274/274**, web **43/43**, build PASS, `git diff --check` PASS. Evidence: `/tmp/dq-deploy-acceptance/`.

### 2026-07-23 — Claude Code (review PASS + giao deploy) — DQ center `6ad9769`; "Lỗi máy chủ" = chưa deploy
- **Review `6ad9769`: PASS.** Self-scope **2 lớp** (getRows scope ownEmp cho NV + filterDqItems ép ownEmp; bell summary requireAdmin). `publicDqItem` **không lộ %/C32/C47** (chỉ revenue), key hash. Fail-closed: config sai→503, catalog thiếu→502 (không báo bừa). 5 rule, dashboard, chuông, export VN, audit, tìm bỏ dấu, gộp theo mã, xếp severity+doanh thu. Server 274/274, web 43/43, build PASS. Read-only (không đổi tiền).
- **CEO thấy "Lỗi máy chủ" ở tab Kiểm soát Dữ liệu = CHƯA deploy đồng bộ** (FE có tab, BE chưa nạp route `/employee-cost/data-quality` — hoặc thiếu config/catalog), FE quy về "Lỗi máy chủ". **Không phải lỗi code.** Directive `DIRECTIVE_EMP_COST_DQ_DEPLOY.md`: deploy FE+BE đồng bộ + kèm config `employee_cost_data_quality.json` + catalog kỳ; `curl` DQ endpoint phải 200.

### 2026-07-23 — Report Bot (review, chưa deploy) — Trung tâm Kiểm soát Dữ liệu chi phí #141 đợt 1
- Thêm rule engine cấu hình được với đúng 5 loại public: `PRODUCT_MISSING`, `PRODUCT_MISMATCH`, `UOM_MISMATCH`, `BID_PRICE_INVALID`, `UNIT_UNKNOWN`; fail closed khi catalog không sẵn sàng, không sửa/đoán dữ liệu nguồn. `UNALLOCATED` được phản ánh trong rule đỏ `PRODUCT_MISMATCH`, không tạo loại thứ sáu.
- Thêm API self-scope, dashboard Việt hóa, bộ lọc, phân trang, nguyên nhân/hành động/nguồn sửa, Excel/PDF chuẩn Việt Nam và summary admin-only cho chuông cảnh báo. API/export/model đều whitelist, không đưa `C32`, `C47` hoặc tỷ lệ nhạy cảm ra ngoài.
- Trên active T07 hiện engine lõi bắt 32 nhóm trước phần gap tỷ lệ: 26 attribution `UNALLOCATED`, 5 ĐVT lệch, 1 đơn vị lạ; 31 đỏ + 1 vàng, xếp theo doanh thu ảnh hưởng. Gate nhánh review: server 274/274, web 43/43, build PASS. Chưa deploy; chờ Claude review.

### 2026-07-23 — Claude Code (nghiệm thu) — guard cách ly doanh thu sai phụ trách `9a4a432`: PASS
- **Review `9a4a432`: PASS.** `revenueAttributionGuard.quarantineRosterConflicts`: emp_code nguồn xung đột roster phụ trách → **UNALLOCATED, KHÔNG remap** (policy `ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP`); giữ `raw_emp_code` + audit; tổng công ty không đổi; có test khẳng định không tự gán NV mong đợi; chạy mỗi materialize → lỗi cũ không quay lại. Nguồn mới MISA run #185 (1.555 dòng / 23.778.161.153đ). DN023 còn đúng 1 dòng (140.BVĐK Bình Phước / 9.699.600đ). Test 265/265.
- **⚠ Còn treo (gốc ở App Sale):** 26 dòng / 8 đơn vị (142,145,147,149,151,152,153,154) / **403.042.400đ** đang UNALLOCATED — **chủ mới chưa thấy** cho tới khi **Sale Bot sửa mapping phụ trách + xuất lại** → App Report tự nhận đúng, bỏ cách ly (không cần deploy). App Report **không tự remap** (giữ nguyên tắc).

### 2026-07-23 — Report Bot (khẩn cấp) — cách ly doanh thu sai phụ trách, DN023 chỉ còn đơn vị 140
- Active T07 chuyển sang nguồn mới nhất CRM MISA run **#185** + APP WEB: **1.555 dòng / 23.778.161.153đ**. Giữ nguyên tổng doanh thu; không remap/đoán nhân viên tại App Report.
- Đối soát roster Data Hub **2026-07 v3.7**: **26 dòng / 8 đơn vị / 403.042.400đ** có `emp_code` nguồn xung đột được fail-safe về `UNALLOCATED`, giữ `raw_emp_code` và audit đầy đủ. **DN023 hiện chỉ còn 1 dòng / 9.699.600đ tại `140.BVĐK BÌNH PHƯỚC`**, không còn thấy BV Quân Dân Y 16, TTYT Bù Đốp hay đơn vị khác.
- Thêm attribution guard vào materializer để lịch tự động không ghi đè lỗi trở lại; snapshot roster thiếu/rỗng/trùng khóa thì fail closed. App Sale vẫn phải sửa mapping gốc `unit_product_employees` và xuất lại `emp_code`; khi nguồn đúng, guard tự ngừng cách ly.
- Gate: server **265/265 PASS**; active slot duy nhất `rev_2src_072026_20260723011949`; production health 200. Backup/audit trước xử lý: `backups/revenue-attribution-emergency-20260723_081713/`.

### 2026-07-23 — Claude Code (giao bot) — SỬA doanh thu gán SAI nhân viên phụ trách (nguồn App Sale)
- **CEO báo:** doanh thu lấy từ App Sale gán **không đúng NV phụ trách**. Chẩn đoán từ code: `store.js` gán NV theo **field `emp_code` trong nguồn** (`getRows` chỉ lọc `r.emp_code===empCode`); **App Report KHÔNG remap phụ trách** (điều chuyển NV đã cắt). ⇒ Sai attribution = **nguồn doanh thu active bị cũ/sai emp_code**, không phải lỗi tính.
- Directive `DIRECTIVE_EMP_COST_REVENUE_SOURCE_FIX.md`: bot xác định nguồn active (slot upload/ORDS `SALES_REPORT` + ngày), so phụ trách hiện tại, **nạp bản App Sale mới nhất** đúng emp_code; nếu nguồn vẫn sai → lỗi App Sale (không tự remap). emp_code không hợp lệ → `UNALLOCATED_EMP`, liệt kê. Cần CEO cho 1–2 ví dụ đơn vị/NV sai để truy chính xác.

### 2026-07-23 — Claude Code (nghiệm thu) — deploy #148 worklist + #150 độ rộng cột `e7c4fd5`: PASS
- **Kiểm tra độc lập trên main: PASS.** **Worklist #148 giờ đã LIVE** (lần trước thiếu): route `/employee-cost/province-worklist/export.xlsx` **requireAdmin** + audit; xuất 2 đơn vị / 103.588.300đ / 6 cột. Độ rộng cột #150 áp (C36–C45 đủ tên; thu hẹp Thành tiền/Hàm lượng/Nhân viên; nới Đơn vị/Nhà thầu; tooltip; sticky STT+Tên hàng). Server 261/261, web 39/39, build PASS.
- **Số không đổi:** DN001 41.144.556đ / C44 1.210.470đ / 171/184; ALL 2.391.033.447đ / C44 95.133.877đ. Self-scope (NV emp=ALL→403); C32/C47 không lộ (API/PDF/XLSX). Health 200; rollback sẵn.
- **Tiếp theo:** CEO điền `unit_province.json` từ worklist → Vùng/Tỉnh 100%. Còn: DQ center #141; DataHub %/alias.

### 2026-07-23 — Report Bot (deploy + nghiệm thu production) — #148 worklist + #150 độ rộng cột
- Claude Opus review commit `52339b2`: **PASS**, xác nhận thuần hiển thị và an toàn deploy chung. Đã merge vào `main` và deploy đồng bộ đúng **1 lần** tại release **`e7c4fd5`**, version **`e7c4fd5-20260723-074338-175`**; HTTPS/health 200. `app-report` PID **2287526** / restart **86**, `app-report-tgbot` PID **2287545** / restart **39**. Rollback: `backups/employee-cost-worklist-widths-deploy-20260723_074336/` (baseline `fe5da49`).
- Bảng web hiện đủ nhãn **C36/C41/C43/C44/C45** (header wrap, C44 badge **cuối năm**); thu gọn **Thành tiền trước VAT · Hàm lượng · Nhân viên**, nới **Đơn vị · Nhà thầu**; ellipsis/tooltip đúng. Chỉ STT/Tên hàng sticky, cuộn ngang desktop/mobile không tràn body. Live bundle kiểm đủ marker #148/#150.
- Khóa số production không đổi: DN001 tổng tháng **41.144.556đ**, C44 **1.210.470đ**, coverage **171/184 = 92,9%**; ALL tổng tháng **2.391.033.447đ**, C44 **95.133.877đ**. NV gọi `emp=ALL` → 403; ép DN001 hỏi DN016 vẫn resolve DN001. API/PDF/XLSX không hiển thị **C32/C47**.
- Worklist T07/2026 xuất đúng **2 đơn vị / 103.588.300đ**, đúng 6 cột: `175.BVĐK VŨNG TÀU` **91.975.200đ** và `135.HTNT-FPT LONG CHÂU` **11.613.100đ**; không %/chi phí/C32/C47. Gate: server **261/261**, web **39/39**, build/diff/render PASS. Evidence: `/tmp/app-report-worklist-widths-acceptance-e7c4fd5/acceptance.json`.

### 2026-07-22 — Claude Code (review #148 PASS + giao độ rộng cột) — worklist tỉnh `80a8c4c`
- **Review worklist #148 `80a8c4c`: PASS.** Route `/employee-cost/province-worklist/export.xlsx` = requireAdmin (CEO/admin), không nhận emp, **không %/C32/C47**; chỉ lấy tỉnh nguồn chính thức (loại catalog/inferred/guessed), xung đột tỉnh fail-closed. T07: **2 đơn vị** cần gán tỉnh (doanh thu ảnh hưởng 103.588.300đ). Audit đủ. Server 261/261, web 39/39, build + quét C32/C47 PASS.
- **CEO thêm: tinh chỉnh độ rộng cột** (thuần CSS): C36–C45 hiện **đủ tên** (header wrap); thu hẹp Thành tiền-trước-VAT · Hàm lượng (1 dòng+…+tooltip) · Nhân viên; **nới rộng Đơn vị · Nhà thầu**. Directive `DIRECTIVE_EMP_COST_COLUMN_WIDTHS.md`. Làm cùng nhánh → **deploy chung worklist #148 + độ rộng cột**. Không đổi số/quyền.

### 2026-07-22 — Report Bot (review, chưa deploy) — #148 worklist đơn vị chưa gán tỉnh
- Thêm endpoint CEO/admin-only `GET /api/employee-cost/province-worklist/export.xlsx?from=YYYY-MM&to=YYYY-MM` và nút **Xuất ĐV chưa gán tỉnh**. Backend luôn gom toàn roster, không nhận `emp`, không gọi DataHub tỷ lệ; audit metadata-only riêng và response `private, no-store`.
- Excel chỉ có 6 cột **Mã đơn vị · Tên đơn vị · Tuyến · #NV liên quan · Doanh thu ảnh hưởng · Tỉnh cần điền**; đơn vị duy nhất, tuyến/NV distinct, xếp doanh thu giảm dần, cột tỉnh để trống. Số thật/định dạng kế toán VN, A4 ngang, fit-to-width, lặp/freeze header, footer trang; không chứa %/chi phí/C32/C47.
- T07/2026 trên dữ liệu thật: **1.550 dòng / 21 NV → 2 đơn vị chưa gán tỉnh / 103.588.300đ**: `175.BVĐK VŨNG TÀU` **91.975.200đ** và `135.HTNT-FPT LONG CHÂU` **11.613.100đ**. File QA: `/tmp/employee-cost-province-worklist-2026-07.xlsx`.
- Sửa cache metadata tỉnh: `unit_province.json` có version/mtime trong cache revenue/CST; config CEO duyệt ưu tiên trước catalog fallback. Điền map sẽ tự áp mà không giữ dữ liệu enrich cũ; catalog/name inference vẫn không được dùng cho Employee Cost, xung đột vẫn fail closed. Không đổi công thức/tổng tiền.
- Gate nhánh review: server **261/261 PASS**, web **39/39 PASS**, production build/syntax/`git diff --check` PASS; chỉ warning chunk-size cũ. Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (nghiệm thu) — bảng UX production `3e29784`: PASS (worklist #148 CHƯA kèm)
- **Kiểm tra độc lập trên main: PASS.** Code khớp bản review `d0c6b56` (pageSize 20, filter `date`, Vùng/Tỉnh chỉ nguồn chính thức). **Số không đổi:** DN001 41.144.556đ / C44 1.210.470đ / 92,9%; ALL 2.391.033.447đ / C44 95.133.877đ. Self-scope chắc (NV emp=ALL→403; ép DN016→DN001); C32/C47 không lộ (API/PDF/XLSX). Pager pill 20 dòng trên/dưới; lọc kết hợp + tìm bỏ dấu + ngày + "Chưa gán tỉnh"=7 chạy đúng.
- **⚠ Worklist #148 ("Đơn vị chưa gán tỉnh") CHƯA có trên production** — grep main không có endpoint xuất; test vẫn 255/39 (y hệt d0c6b56). Bot deploy bảng UX mà bỏ qua worklist. **Còn treo:** bot làm nốt worklist để CEO điền `unit_province.json`.
- Còn tiếp: DQ center #141; DataHub %/alias → coverage 100%.

### 2026-07-22 — Report Bot (deploy + nghiệm thu production) — bảng UX chi phí `3e29784`
- Đã merge bản Claude PASS `d0c6b56` vào `main`, đồng bộ thêm commit directive đang có trên remote và chốt release **`3e29784`**; build/deploy FE và restart BE + Telegram bot cùng lượt. Production version **`3e29784-20260722-234418-225`**, HTTPS 200; `app-report` PID **1429817** / restart **85**, `app-report-tgbot` PID **1429825** / restart **38**. Rollback: `backups/employee-cost-tableux-deploy-20260722_234324/` (baseline `dc2f54c`).
- Gate release PASS: server **255/255**, web **39/39**, production build, syntax và `git diff --check`; chỉ còn warning chunk-size cũ.
- CEO `emp=ALL` PASS: template **TẤT CẢ NHÂN VIÊN**, đủ **21 NV / 1.550 dòng**, mặc định **20 dòng / 78 trang**, STT trang đầu 1–20. Phiên DN001 gọi `emp=ALL` trả **403 `EMPLOYEE_COST_ALL_FORBIDDEN`**; ép `emp=DN016` vẫn resolve về **DN001**.
- Lọc kết hợp production PASS: **Vùng/Tỉnh=ĐỒNG NAI · Nhóm mã=PKĐK · Tuyến=NCL · Ngày=01/07/2026** còn **159 dòng**; tìm bỏ dấu `y duc` còn **29 dòng**, trang 2 có 9 dòng STT 21–29. `Chưa gán tỉnh` trả đúng **7 dòng** từ đơn vị thiếu map. Excel/PDF xuất lại đủ 29 dòng sau lọc/tìm, không bị cắt theo trang; metadata filter, số thật/Unicode và `private, no-store` đều PASS.
- UI production PASS: pager pill có nút số/ellipsis, mặc định 20 và chỉ cho 20/50/100; pager trên + dưới đồng bộ, pager trên sticky. Smoke trang Tổng quan không lỗi.
- Khóa số/bảo mật không đổi: DN001 tổng tháng **41.144.556đ**, C44 cuối năm **1.210.470đ**, coverage **171/184 = 92,9%**; C36 **714.667đ**, C41 **7.687.500đ**, C43 **25.470.960đ**, C45 **7.271.429đ**. API/PDF/XLSX không lộ **C32/C47**; self-scope giữ. Toàn ALL hiện tổng tháng **2.391.033.447đ**, C44 **95.133.877đ**. Bằng chứng: `/tmp/app-report-tableux-acceptance-3e29784/acceptance.json`.

### 2026-07-22 — Claude Code (giao bot) — Worklist "Đơn vị chưa gán tỉnh" → điền unit_province.json
- CEO chốt hướng chuẩn 100%: điền map `unit_province.json` (mã ĐV → tỉnh). Directive `DIRECTIVE_EMP_COST_PROVINCE_WORKLIST.md`: bot xuất Excel (chuẩn VN, CEO/ADMIN) danh sách **đơn vị duy nhất "Chưa gán tỉnh"** (mã · tên · tuyến · #NV · doanh thu ảnh hưởng · cột trống "Tỉnh cần điền"), xếp theo doanh thu. Điền vào config → App Report tự áp (không đoán). Tùy chọn: màn admin nhập nhanh. Self-scope, không lộ %/C32/C47. Chưa deploy.

### 2026-07-22 — Claude Code (review PASS + giao deploy) — bảng UX trọn gói `d0c6b56`
- **Review `d0c6b56`: PASS.** Vùng/Tỉnh (#146): **bỏ hẳn đoán tên/viết tắt**, chỉ `row.province`/config, thiếu → "Chưa gán tỉnh", source trung thực. #145: pager **pill 20 dòng/trang** + cỡ trang 20/50/100 + **pager trên & dưới (sticky)** + **chọn ngày** (filter `date` validate ISO, chạy cả Tất cả NV). Day + các filter áp trên rows đã khóa quyền (self-scope); C32/C47 loại. Server 255/255, web 39/39, build PASS.
- Nhánh gom trọn #139 + search + #144 + #146 + #145, UI thuần (không đổi tiền). Directive `DIRECTIVE_EMP_COST_TABLEUX_DEPLOY.md`. Sau deploy: điền `unit_province.json`; DQ center #141; DataHub %/alias.

### 2026-07-22 — Report Bot (review, chưa deploy) — #145 pager pill/ngày doanh thu + #146 tỉnh chính thức
- Bảng chi phí self/ALL mặc định 20 dòng, chỉ nhận cỡ 20/50/100; pager pill có số trang/ellipsis/tới trang, đồng bộ sticky phía trên và phía dưới. Hai bảng gap dùng cùng pager, có STT theo toàn tập sau lọc.
- Thêm dropdown `Ngày doanh thu` gồm ngày ISO có thật + `Tất cả ngày`. Backend lọc ngày cùng tỉnh/nhóm/tuyến/search trước sort, STT, tổng, tổng phụ và phân trang; Excel/PDF chạy lại đúng cùng lát cắt không cắt theo trang.
- Bỏ toàn bộ suy tỉnh từ tên/huyện/viết tắt. Chỉ nhận tỉnh từ dòng doanh thu hoặc `server/config/unit_province.json`; thiếu nguồn được nhóm `Chưa gán tỉnh`. Công thức, self-scope, coverage lock và khóa C32/C47 giữ nguyên. Nhánh review, chưa deploy.

### 2026-07-22 — Claude Code (review #144 `0156c5d`) — filters PASS, SỬA Vùng/Tỉnh đoán-từ-tên
- **Review #144: all-fix "Tất cả NV" + lọc Nhóm mã ĐV (config) + Tuyến = PASS.** Scope an toàn (filter trên rows đã khóa quyền; C32/C47 loại khỏi search/facet). Server 253/253, web 38/38, build PASS.
- **⚠ Vùng/Tỉnh (`province.js`) đoán theo tên + viết tắt — trái directive, gán sai được** (`dn`→Đồng Nai nhưng ĐN cũng là Đà Nẵng; `tan phu` trùng Q.Tân Phú TP.HCM; nhãn `source:official` sai provenance). Không ảnh hưởng tiền (chỉ chiều lọc) nhưng lọc địa bàn lệch. **Sửa:** bỏ ABBR; tỉnh chỉ từ nguồn chính thức (`row.province`/`unit_province.json`), không có → "Chưa gán tỉnh"; giữ đoán-tên phải gắn cờ "tạm đoán" + source đúng. Khuyến nghị điền `unit_province.json`. Directive `DIRECTIVE_EMP_COST_PROVINCE_FIX.md`.
- **#145** (pager pill/dayview) CHƯA implement — làm tiếp.

### 2026-07-22 — Claude Code (giao bot) — Phân trang pill 20 dòng + pager lên đầu + xem theo ngày
- Ghi nhận: "Tất cả NV" **đã chạy** (restart BE #139 — 1.550 dòng, coverage 96,5%, tổng 2,39 tỷ); lọc Nhóm mã ĐV + Tuyến đã có.
- CEO thêm 3 UX: (1) phân trang **20 dòng/trang**, nút **bo tròn (pill)** + số trang bấm được; (2) **pager lên đầu bảng** (sticky, đồng bộ trên/dưới); (3) **chọn ngày** xem doanh thu theo ngày — **hoạt động cả chế độ Tất cả NV** (lọc rows theo ngày ở backend, kết hợp nhóm mã/tuyến/tìm kiếm/phân trang). Gợi ý: chọn cỡ trang 20/50/100. STT/đếm/export phản ánh; không đổi số; self-scope + C32/C47 giữ. Directive `DIRECTIVE_EMP_COST_PAGER_DAYVIEW.md`. Chưa deploy.

### 2026-07-22 — Report Bot (review) — Sửa ALL live + bộ lọc chi phí liên hoàn
- Đã đồng bộ/restart backend #139 với frontend đang chạy. Nghiệm thu HTTPS bằng phiên CEO: `emp=ALL&from=2026-07&to=2026-07` trả `template.label="TẤT CẢ NHÂN VIÊN"`, đủ **21 NV / 1.550 dòng** (trang đầu 100 dòng); phiên DN001 gửi `emp=ALL` nhận `403 EMPLOYEE_COST_ALL_FORBIDDEN`.
- Thêm lọc backend **Vùng/Tỉnh · Nhóm mã đơn vị · Tuyến** cho cả self và ALL. Ba facet kết hợp với kỳ/search/sort, dropdown động theo đúng tập đã scope và các facet còn lại; giá trị query không có trong tập scope không được phản chiếu thành option. STT, X/Y, tổng, tổng phụ, phân trang và Excel/PDF dùng cùng một pipeline backend.
- Tỉnh chỉ nhận provenance chính thức từ dòng bán/catalog/config; kết quả `provinceOf()` suy từ tên bị loại, xung đột cùng mã đơn vị fail closed. Nhóm mã đơn vị đọc `server/config/employee_cost_unit_groups.json`; mã chưa map chỉ rơi về đúng tiền tố của chính nó, không đoán nhóm nghiệp vụ. Audit lưu bộ lọc đã sanitize; C32/C47 vẫn khóa cứng và công thức/tiền không đổi.
- Gate: full server **251/251 PASS** trước guard facet cuối, targeted sau cùng **57/57 PASS**; web **38/38 PASS**; production build PASS; `git diff --check` + syntax PASS. Bộ lọc mới chỉ ở nhánh review, **chưa deploy** theo directive.

### 2026-07-22 — Report Bot (review) — Directive #139 bảng chi phí STT/ALL/search/sort
- Thêm cột STT đầu bảng và đầu Excel/PDF; STT được đánh lại sau lọc/sort trên toàn tập. CEO/admin có `Tất cả nhân viên` backend-lock, cột NV, tổng phụ theo NV/tổng chung và phân trang 100 dòng; NV thường gửi `emp=ALL` ở xem/xuất bị chặn 403 và vẫn self-scope.
- Search live toàn bảng hỗ trợ bỏ dấu, không phân biệt hoa/thường, viết tắt liền kiểu `dviet` → `Đức Việt`, nhiều từ AND, đếm X/Y, highlight/chip xóa nhanh; click header để sort. Chế độ ALL lọc/sort trước phân trang ở backend; export chạy lại cùng filter/search/sort không cắt trang.
- Cột % cố định hẹp, căn phải/tabular, header chỉ mã Cnn + tooltip nhãn đầy đủ; sticky header + STT + Nhân viên/Tên hàng. C32/C47 tiếp tục loại cứng, C44 vẫn tách khoản cuối năm và mọi số tiền giữ nguồn backend. #139 đã được đồng bộ/restart để sửa lỗi ALL live; thay đổi bộ lọc nối tiếp vẫn chưa deploy/merge main.

### 2026-07-22 — Claude Code (giao bot) — SỬA "Tất cả NV" trống + thêm lọc Vùng/Tỉnh · Nhóm mã ĐV · Tuyến
- **CEO báo "Tất cả nhân viên" hiện 0/0 (trống).** Chẩn đoán: bảng hiện **"Mẫu FULL-TIME 0/0"** thay vì template **"TẤT CẢ NHÂN VIÊN"** → **BE chưa nạp nhánh `emp=ALL`** (FE #139 lên nhưng BE chưa deploy/restart — lệch phiên bản, giống vụ 404). Bot: xác minh version (`curl ?emp=ALL` phải trả `template.label:"TẤT CẢ NHÂN VIÊN"`, rows>0) → deploy/restart BE #139; nếu vẫn trống → debug `employeeCostAllPayload`/`mergeEmployeeReports` + thêm test all-NV rows>0.
- **CEO thêm 3 ô lọc:** Vùng/Tỉnh (từ nguồn đơn vị, không suy đoán từ tên), Nhóm mã đơn vị (cấu hình được), Tuyến (cột sẵn có). Kết hợp nhau + tìm kiếm + kỳ; STT đánh lại; export phản ánh; dropdown động. Self-scope + C32/C47 giữ. Directive `DIRECTIVE_EMP_COST_ALLFIX_FILTERS.md`.

### 2026-07-22 — Claude Code (review PASS + giao deploy đợt 2) — #139 bảng UX `a3b4fd6`
- **Review `a3b4fd6`: PASS.** "Tất cả NV" **khóa 3 lớp** (view/all-payload/export đều 403 `EMPLOYEE_COST_ALL_FORBIDDEN` cho NV; NV ép own qua resolveScopedEmployee). Tìm kiếm **bỏ dấu chuẩn** (`normalizeVietnamese`: NFD + xóa dấu + đ→d, đa từ khóa, BLOCKED C32/C47 không lọt). STT + sort ổn định; cột chi phí regex c33–c46 (chặn C32/C47); phân trang; tổng phụ theo NV; sticky; cột % hẹp; export phản ánh lọc/tìm/sort/STT. Server 243/243, web 37/37, build PASS.
- UI/UX thuần, **không đổi số/tiền**, rủi ro thấp. Directive `DIRECTIVE_EMP_COST_139_DEPLOY.md` (deploy đợt 2). Sau đó: DQ center đợt 1 (#141) + DataHub điền %/alias.

### 2026-07-22 — Claude Code (nghiệm thu) — Deploy B (#137 gap tool + #138 export VN): PASS
- **Kiểm tra độc lập trên main: PASS.** `a539e5a` merge code đã review (`50e0c62`); `employeeCostGaps.js` + `employeeCostExport.js` + routes gaps/export có trên main. **#139 KHÔNG lẫn vào** (không cột STT / "Tất cả NV" / search bỏ dấu — chỉ có nhãn "Số dòng đơn hàng" của #134 đã live từ trước). Code khớp bản review PASS (self-scope 2 lớp export, gaps không lộ %, gợi ý mã không tự map, VN accounting + A4 landscape + font fail-closed).
- Bot nghiệm thu production PASS (không dẫn số mới trong report này). Chi phí cũ không đổi. *(Claude tự động server lỗi 401 — verdict do phiên Claude này cấp.)*
- **#139** (bảng UX) Report Bot đang làm trên **nhánh riêng** — deploy đợt 2. DataHub: điền %/alias song song → coverage 100%.

### 2026-07-22 — Report Bot — DEPLOY B + nghiệm thu production #137 gap tool / #138 export VN
- Đã merge đúng bản Claude PASS `50e0c62` vào `main` bằng release merge **`a539e5a`**; không đưa implementation #139 vào đợt này. Gate trước deploy: server **238/238 PASS**, web **34/34 PASS**, production build PASS, `git diff --check` sạch.
- Đã build/deploy frontend và restart đồng bộ `app-report` + `app-report-tgbot`; health HTTPS **200**. Main sau đó nhận thêm commit docs-only `7bf76fd` (#141), không thay đổi code release #137/#138.
- Nghiệm thu production T07/2026: DN001 đúng **13 cặp gap / 11 mã**, coverage **171/184 = 92,9%**; toàn roster **43 cặp / 34 mã**, coverage **1.175/1.218 = 96,5%**. UI CEO hiển thị tab gap, coverage và bộ lọc; UI DN001 chỉ hiển thị “13 mặt hàng chưa có %”, không có bộ lọc/chế độ toàn nhân viên.
- Self-scope PASS hai lớp: phiên DN001 cố truyền `emp=DN016` ở gap/cost/export vẫn bị backend ép về **DN001**; file/PDF không có dữ liệu DN016. Audit production ghi đủ `view`, `export_xlsx`, `export_pdf`, `gaps_view`, `gaps_export_xlsx`, `gaps_export_pdf` theo actor/scope; response dùng `Cache-Control: private, no-store`.
- Export Excel PASS: ô tiền là **số thật**, tổng dùng công thức `SUM`, định dạng kế toán VN; A4 landscape, fit-to-width, header lặp. Gap workbook đúng 2 sheet `Theo mã QLNB` + `Ánh xạ lệch mã`, cột `% cần điền` và `Xác nhận` để trống.
- Export PDF PASS: A4 landscape, nhúng font Unicode, đủ footer/số trang (**chi phí 9/9 trang; gap 2/2 trang**), không lỗi dấu/tofu/control character, không sinh trang trắng cuối. Bảng chi phí rộng nên mô tả dài có thể wrap/rút gọn theo cột, không ảnh hưởng số liệu.
- Bảo mật/số cũ PASS: gap payload/export không chứa tỷ lệ, tiền chi phí, **C32/C47**; chi phí DN001 giữ tổng tháng **41.144.556đ**, C44 cuối năm **1.210.470đ**, mẫu C44 **75.696đ**. Bằng chứng máy: `/tmp/app-report-prod-acceptance-a539e5a/acceptance.json`; rollback trước đợt: `backups/employee-cost-ui-deploy-20260722_173653/`.

### 2026-07-22 — Claude Code (giao bot) — Trung tâm Kiểm soát Dữ liệu Chi phí (auto bắt lỗi + chuông)
- CEO muốn tự bắt/lọc mọi mã không khớp khi lấy App Sale → tính chi phí (mã hàng/QLNB/đơn vị/tuyến/ĐVT/giá thầu), gộp mục riêng + **chuông cảnh báo** + **tự giải thích nguyên nhân** (khỏi điều tra thủ công). Directive `DIRECTIVE_EMP_COST_DQ_CENTER.md` — **mở rộng gap tool #137**.
- **Thông minh:** 2 nhóm mức (đỏ = sai/nghi ngờ tiền: PRODUCT_MISSING/MISMATCH, UOM_MISMATCH, BID_PRICE_INVALID, REVENUE_ANOMALY, DUPLICATE; vàng = thiếu hiển thị: UNIT_UNKNOWN, ROUTE_MISSING, CONTRACTOR_UNRESOLVED, HAMLUONG_MISSING). Mỗi lỗi có **nguyên nhân tự sinh + hành động đề xuất + nguồn cần sửa**; gộp theo mã gốc, xếp theo doanh thu ảnh hưởng; trạng thái xử lý; deep-link. **Chuông badge** = số lỗi đỏ chưa xử lý (ngưỡng cấu hình). Self-scope (NV của mình, CEO toàn bộ), không lộ %/C32/C47, không tự sửa/bịa. Reuse export VN #138. Đề xuất làm 2 đợt. Chưa deploy.

### 2026-07-22 — Claude Code (review PASS + giao deploy B) — gap tool #137 + export VN #138
- **Review nhánh `review/employee-cost-gap-tool-20260722` @ `50e0c62`:** #137 gap tool + #138 export VN = **PASS**.
  - Gap: self-scope (NV own, CEO roster/`?emp=`), **không lộ %**, gợi ý mã lệch QĐ (chỉ gợi ý, không tự map). DN001 13 cặp; roster 34 mã/96,5%.
  - Export: self-scope **2 lớp**; số kế toán VN (`#,##0`, "Bằng chữ"), **A4 landscape**, font Unicode **fail-closed** nếu thiếu; Excel số thật. Server 231/231, web 34/34, build PASS.
  - **#139 (bảng UX: STT/tất cả NV/cột % hẹp/tìm kiếm) CHƯA implement** (commit `1694f93` chỉ là directive doc).
- **CEO chốt B: deploy #137+#138 ngay** (`50e0c62`), #139 làm đợt 2. Directive `DIRECTIVE_EMP_COST_GAP_EXPORT_DEPLOY.md`. DataHub: điền % thiếu hẳn + alias lệch mã QĐ (task đã gửi) → coverage 100% không cần deploy.

### 2026-07-22 — Report Bot (review) — Export chi phí/gap chuẩn VN Excel + PDF
- Bổ sung 4 endpoint backend có auth/audit: `employee-cost/export.xlsx|pdf` và `employee-cost/gaps/export.xlsx|pdf`. NV luôn bị ép self-scope kể cả truyền `?emp=` khác; CEO/admin được chọn NV hoặc toàn roster. Không xuất C32/C47.
- Excel: số thật + công thức `SUM`, number format kế toán, ngày `dd/mm/yyyy`, tiêu đề tiếng Việt, A4 ngang, fit-to-width, lặp header, footer trang. Báo cáo chi phí có “Bằng chữ”, tổng tháng và C44 cuối năm tách riêng; gap giữ 2 sheet và cột `% cần điền`/`Xác nhận` trống.
- PDF: A4 ngang, nhúng Noto/DejaVu/Liberation Unicode fail-closed nếu thiếu font, đầu/chân trang, `Trang x/y`, bảng lặp header, số VN dấu chấm/dấu phẩy và không mất dấu tiếng Việt.
- UI cho cả NV/CEO có nút Excel + PDF ở báo cáo chi phí và gap. Chưa deploy; chờ Claude review trên cùng nhánh `review/employee-cost-gap-tool-20260722`.

### 2026-07-22 — Report Bot (review) — Gap chi phí self-scope + worklist Excel
- Thêm `GET /api/employee-cost/gaps` và `GET /api/employee-cost/gaps/export.xlsx`: NV bị ép self-scope; CEO/admin xem toàn roster hoặc chọn NV; nguồn catalog/tỷ lệ lỗi thì fail closed; truy cập/xuất đều audit và `private, no-store`.
- UI: NV có panel “Mặt hàng chưa có % chi phí”; CEO/admin có tab gộp theo mã QLNB, tìm/lọc NV/đơn vị/lý do, coverage progress và sắp xếp theo doanh thu ảnh hưởng.
- Excel có đúng 2 sheet `Theo mã QLNB` và `Ánh xạ lệch mã`; cột `% cần điền`/`Xác nhận` để trống. Gợi ý mã chỉ read-only, không tự ánh xạ/không ghi DataHub; payload không chứa tỷ lệ, tiền chi phí, C32/C47.
- Nghiệm thu live DN001 T07: **171/184 = 92,9%**, đúng **13 cặp gap**. Ứng viên cùng đơn vị+tên hàng: `QĐ1572.1699.N4.754 → QĐ1572.1699.N4.754.A`, `G1.GE.QĐ139.3004.N4.1029 → G1.GE.QĐ139.3269.N5.1029`, `G1.GE.QĐ139.2120.N4.578 → G1.GE.QĐ139.2114.N4.578`; chỉ gợi ý để DataHub xác nhận. Toàn roster còn phát hiện ca khác số quyết định `G1.GE.QĐ139.2963.N4.549 → G1.GE.QĐ48.549.N4.549`.
- Gate tại nhánh review: server/web test + build PASS; chưa deploy.
### 2026-07-22 — Claude Code (giao bot) — Bảng chi phí: STT + xem tất cả NV + cột % hẹp + tìm kiếm thông minh
- CEO yêu cầu 4 UX bảng "Chi phí của tôi". Directive `DIRECTIVE_EMP_COST_TABLE_UX.md`:
  1. **Cột STT** đầu bảng, tự nhảy theo dòng hiển thị (lọc/tìm → đánh lại), có trong Excel/PDF.
  2. **"Tất cả nhân viên"** (CEO/ADMIN only, backend khóa) — thêm cột NV + tổng phụ theo NV; NV thường chỉ của mình. Phân trang/virtualize.
  3. **Thu hẹp cột %** (rộng cố định vừa số, tiêu đề mã ngắn C36 + tooltip đầy đủ).
  4. **Ô tìm kiếm thông minh** toàn bảng — **bỏ dấu + không phân biệt hoa/thường** (tiện cho tiếng Việt), live + đếm X/Y + highlight, kết hợp lọc NV/kỳ.
- Ý thêm: sticky header/cột, sort cột, chip trạng thái lọc, export phản ánh lọc/tìm/sort/STT. Self-scope + C32/C47 giữ. Làm cùng nhánh review gap tool + export. Chưa deploy.

### 2026-07-22 — Claude Code (giao bot) — Export chuẩn VN (Excel+PDF, A4 ngang) + NV tự xuất
- CEO chốt: **NV được tự xuất** phần mình; **chuẩn số kế toán VN** (nghìn dấu chấm, thập phân dấu phẩy, đơn vị đồng, "Bằng chữ" cho tổng); **mẫu A4 quay ngang**; **2 định dạng Excel + PDF**. Directive `DIRECTIVE_EMP_COST_EXPORT_VN.md`.
- Áp cho **cả báo cáo chi phí lẫn danh sách thiếu %**. PDF **nhúng font Unicode đủ dấu tiếng Việt** (cấm tofu); A4 landscape fit-to-width, đầu/chân trang (Donapharm · kỳ · NV · ngày xuất · nguồn DataHub SSOT · số trang), header lặp mỗi trang. Excel số thật (SUM chạy) + number format VN. **Self-scope** (NV chỉ của mình), C32/C47 không xuất, qua backend + audit. Làm cùng nhánh review gap tool. Chưa deploy.

### 2026-07-22 — Claude Code (giao bot) — Công cụ "Mặt hàng thiếu % chi phí" + Export Excel gap
- CEO muốn xuất **tất cả cặp chưa lấy được %** ra Excel + **mục trong app** để CEO/NV lọc-tìm dễ. Directive `DIRECTIVE_EMP_COST_GAP_TOOL.md`.
- **Thông minh:** gộp theo **mã QLNB** (1 mã thiếu → ảnh hưởng nhiều đơn vị/NV, điền 1 lần khớp hàng loạt); **xếp theo doanh thu ảnh hưởng**; **phân loại lý do** (lệch mã QĐ → App Report **gợi ý mã catalog gần trùng** để DataHub ánh xạ / thiếu hẳn → nhập % mới); **NV thấy** mục "N mặt hàng chưa có % — chờ bổ sung, không phải lỗi"; **CEO** tab lọc/tìm + **coverage progress**; **Excel worklist** có cột trống "% cần điền".
- Endpoint `GET /employee-cost/gaps` self-scope (NV của mình / CEO toàn bộ), KHÔNG lộ %, không bịa. App Report phát hiện; **DataHub điền % / chuẩn hóa mã** (task riêng). Chưa deploy.

### 2026-07-22 — Claude Code (nghiệm thu) — gói UI chi phí production `c565ba6`: PASS
- **Kiểm tra độc lập trên main: PASS.** Bundle merged (`c565ba6`); code có `columnTotals` + `derivesFrom` + nhãn mới.
- **Số cộng tay khớp:** C36 714.667 + C41 7.687.500 + C43 25.470.960 + C45 7.271.429 = **41.144.556đ** (= tổng tháng). **C44 cuối năm 1.210.470đ tách riêng** (không cộng tháng). Mẫu C44 = 1.513.920 × 5% = **75.696đ**. Coverage 171/184=92,9%. Doanh thu chưa VAT 2.278.049.356đ.
- **UI/bảo mật:** KPI đủ (Doanh thu chưa VAT + 5 cột, C44 nổi bật + badge); nhãn "Số dòng đơn hàng" + "mã (đơn vị×mặt hàng)"; panel gập sẵn; self-scope + C32/C47 giữ; BE restart (PID 747857, restart 76); backup sẵn.
- **Còn treo (chờ DataHub Bot, không chặn):** DN021 lệch mã QĐ (`QĐ48…549` vs `QĐ139…549`); C48 ghi chú sidecar. 2 task đã gửi.

### 2026-07-22 — Report Bot (deploy + nghiệm thu production) — gói UI chi phí `c565ba6`
- Đã merge release candidate `a5ef765` vào `main` theo Plan A, build và deploy đồng bộ FE/BE; App Report chạy version `c565ba6-20260722-173400-024`, PM2 `app-report` online PID `747857`, restart `76`. Backup trước deploy: `backups/employee-cost-ui-deploy-20260722_173653/`.
- Gate release: server **224/224 PASS**, web **30/30 PASS**, production build PASS; health local và `report.donapharm.asia` đều OK.
- Nghiệm thu DN001 T07/2026: coverage **171/184 = 92,9%**; doanh thu chưa VAT **2.278.049.356,19đ**; C36 **714.667đ** + C41 **7.687.500đ** + C43 **25.470.960đ** + C45 **7.271.429đ** = tổng tháng **41.144.556đ**; C44 riêng cuối năm **1.210.470đ**. Mẫu khóa: C43 **1.513.920đ** × C44 **5%** = **75.696đ**.
- UI/permission PASS: KPI động đủ Doanh thu chưa VAT + 5 cột; C44 nổi bật/badge cuối năm; nhãn `Số dòng đơn hàng` và `mã (đơn vị×mặt hàng)`; panel quyền mặc định gập; self-scope giữ nguyên; payload không lộ C32/C47. C44 tiếp tục bị loại khỏi tổng tháng.

### 2026-07-22 — Claude Code (review PASS + giao deploy) — gói UI chi phí `a5ef765`
- **Review PASS toàn bộ 4 việc** trên nhánh `review/employee-cost-c44-derived-20260722` `a5ef765`:
  1. **C44** = tiền_C43 × %C44 (cột phái sinh cấu hình `c44:c43`, validate vòng lặp) — C44 tháng 1.210.470đ.
  2. **Thu gọn panel** — mặc định gập, localStorage theo admin, draft không mất, a11y.
  3. **KPI cards** — `summary.columnTotals` (gate <90%); FE render động Doanh thu chưa VAT + C36/C41/C43/C44/C45, **C44 nổi bật**.
  4. **Nhãn** — "Số dòng đơn hàng" + "…/… mã (đơn vị×mặt hàng)" (đổi chữ, số/coverage giữ nguyên).
- Server 224/224, web 29/29, build PASS. CEO chốt **deploy gộp (A)**. Directive `DIRECTIVE_EMP_COST_UI_DEPLOY.md`: merge→build→**FE+restart BE đồng bộ**→nghiệm thu. Còn treo (không chặn): DN021 mã QĐ + C48 sidecar (DataHub Bot).

### 2026-07-22 — Claude Code (review + giao bot) — C44 `b37a48f` PASS + KPI cards mới
- **Review C44 `b37a48f` (nhánh `review/employee-cost-c44-derived-20260722`): PASS.** `C44 = tiền_C43 × %C44` — bot làm đủ 3 chỗ: per-dòng (`base = amounts[derivesFrom]`), match/reliable (không cho fallback doanh thu khi derived null), residual/làm tròn (đối chiếu trên tổng tiền cột gốc). **Cột phái sinh cấu hình được** (`DEFAULT_DERIVED_BASES={c44:c43}`, env `EMPLOYEE_COST_DERIVED_BASE`, validate chặn tự-tham-chiếu/trùng/**vòng lặp**). Kèm `.env.example` + contract doc + config json + test. **Nghiệm thu:** C44 mẫu 75.696đ, **C44 tháng 1.210.470đ** (từ 35.157.098đ), tổng tháng vẫn 41.144.556đ, coverage 171/184. 224/224 + 25/25 + build PASS. *(Claude tự động trên server lỗi 401 — verdict do phiên Claude này cấp.)*
- **CEO yêu cầu thêm KPI cards:** Doanh thu chưa VAT + tổng CP từng cột C36/C41/C43/C44/C45, **C44 nổi bật**. Directive `DIRECTIVE_EMP_COST_KPI_CARDS.md`: backend thêm `summary.columnTotals` (gate <90% như tổng tháng); FE render **động từ columns[]**, ô annual (C44) nổi bật + badge cuối năm. Làm **cùng nhánh UI với thu gọn panel**, deploy 1 lượt.

### 2026-07-22 — Claude Code (giao bot) — Thu gọn panel công tắc chi phí (UI)
- CEO đề nghị **nút thu gọn** panel "Quản trị quyền tự xem chi phí" (dài, đẩy bảng chính xuống). Directive `DIRECTIVE_EMP_COST_VISIBILITY_COLLAPSE.md`: panel **mặc định thu gọn**, header + nút mở/gập, nhớ trạng thái (localStorage), logic quyền/lưu KHÔNG đổi. Làm **cùng nhánh review với fix C44** (deploy 1 lượt). Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (giao bot) — SỬA GẤP C44: gốc = tiền cột C43, không phải doanh thu
- **CEO phát hiện lỗi tiền nghiêm trọng (đang LIVE):** C44 tính `revenueBeforeVat × %C44` → gốc doanh thu → phình (35.157.098đ). **Đúng:** `C44 = tiền_C43 × %C44` (tiền_C43 = revenueBeforeVat × %C43). Dòng mẫu: 1.513.920 × 5% = **75.696đ** (không phải 630.800đ).
- Directive `DIRECTIVE_EMP_COST_C44_FIX.md`: cột "cuối năm" thành **cột phái sinh cấu hình được** (`c44←c43`, không hardcode); base = tiền cột gốc; sửa cả khối residual/làm tròn; C44 vẫn loại khỏi tháng/làm mờ/tách dòng cuối năm. **Tổng THÁNG (41.144.556đ) KHÔNG đổi** (C44 vốn ngoài tháng) — chỉ "Khoản cuối năm" giảm mạnh. Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (nghiệm thu) — production chi phí VAT-trước `050b9c2`: PASS
- **Kiểm tra độc lập trên main: PASS.** Code đã deploy = đúng code đã review (`buildCostLookup` khóa `unit␟product` dòng 536 + consumer 577; `loadConfig` try/catch → `{}`). Không bị đổi giữa review và deploy.
- **Số khớp tay:** VAT-trước `380.000÷1,05×0,5%=1.810đ` (xác nhận gốc trước-VAT); DN001 171/184=92,9% → **tổng tháng trước VAT 41.144.556đ** (thấp hơn bản có-VAT cũ 42.834.991đ, đúng hướng); **C44 tách 35.157.098đ** không cộng tháng.
- **Bảo mật/hành vi đúng:** C32/C47 không lộ; DN021 0/3 fail-closed (không tự ánh xạ mã QĐ); visibility 3 nhóm/21 NV; hết 404; BE restart đồng bộ FE (PID 549011, restart 73); token/artifact QA thu hồi; rollback sẵn.
- **Còn treo (đang chờ DataHub Bot):** DN021 đối chiếu mã QĐ (`QĐ48…549` vs `QĐ139…549`); C48 sidecar (điều kiện cứng "C48 thiếu ≠ kỳ thiếu"). 2 task đã gửi DataHub Bot.

### 2026-07-22 — Report Bot — DEPLOY + nghiệm thu production chi phí VAT-trước `050b9c2`
- Đã gộp nhánh review `d236496` vào `main`, build và kích hoạt đồng bộ FE/BE; production đang chạy version **`050b9c2-20260722-154110-131`**. `/version.json`, `/api/auth/mode`, health, hai GET quản trị visibility và trang App Report đều PASS; PM2 `app-report` online, không còn lệch route 404/“Lỗi máy chủ”, browser console không có lỗi.
- Nghiệm thu T07/2026 DN001: mẫu **FULL-TIME 19 cột** đúng thứ tự, đủ `C36/C41/C43/C44/C45`; lookup `(đơn vị + mã hàng)` đạt **171/184 = 92,9%**, tương ứng **211/224 order-line** có tỷ lệ. Tổng tháng VAT-trước (không gồm C44) **41.144.556đ**; C44 cuối năm tách riêng **35.157.098đ**. Spot-check: `380.000 ÷ 1,05 × 0,5% = 1.810đ`.
- DN021 hiển thị đúng mẫu **PART-TIME 15 cột, chỉ C36**; hiện **0/3**, tổng tháng/cuối năm bị ẩn và các ô giữ `—` do mã doanh thu `QĐ139…` chưa khớp timeline `QĐ48…` (fail-closed đúng thiết kế, không tự bắc cầu). C48 chưa có chỉ làm `Ghi chú = —`, không chặn tỷ lệ/số tiền ở dòng đã khớp.
- Bảo mật/kiểm soát PASS: payload production không có `C32/C47`; C44 không bị cộng vào tổng tháng; panel quản trị quyền tải đủ **3 nhóm/21 NV**, toàn phòng vẫn **Tắt** theo mặc định an toàn và phiên DN001 nhận payload `disabled` thay vì truy cập dữ liệu. Backup rollback: `backups/employee-cost-deploy-20260722_154018/`, baseline `008b8b4`.

### 2026-07-22 — Claude Code (giao bot) — DEPLOY bản chi phí cột mới + VAT-trước (CEO chốt A)
- **CEO chốt (A): deploy ngay** nhánh review `d236496` (review PASS). Directive: `DIRECTIVE_EMP_COST_DEPLOY.md`. Gộp: fix lookup 92,9% + 2 mẫu cột mới + **VAT-trước (đổi số có chủ ý)** + visibility route/hardening.
- **‼ Bắt buộc restart BE đồng bộ FE** (tránh lệch phiên bản 404 như sự cố trước). Nghiệm thu: hết "Lỗi máy chủ"; DN001 171/184 tổng VAT-trước mới; DN021 `—` (fail-closed, chờ đối chiếu mã QĐ); Ghi chú `—` (chờ C48); self-scope + C32/C47 giữ. Còn treo (không chặn): DN021 mã QĐ + C48 sidecar → 2 task DataHub Bot.

### 2026-07-22 — Claude Code (review) — hardening visibility `d236496`: PASS (nhánh review hoàn chỉnh)
- **Review `d236496`: PASS.** `loadConfig` try/catch → fallback `{}` + `console.warn` phía server (không lộ path ra FE; loadConfig KHÔNG còn throw → chặn nguồn rò path). 2 route GET `visibility`/`employees` bọc `asyncJsonRoute` → trả `{ error, code }` đúng chuẩn chung app. Test config-thiếu + lỗi-giả 2 GET PASS; 220/220 server · 25/25 web · build PASS.
- Lookup vẫn **92,9%** (dữ liệu mới: DN001 **171/184**, 210/223 order-line — nhích nhẹ do refresh, vẫn ≥90%).
- **Nhánh review `d236496` = bản release hoàn chỉnh:** fix lookup + 2 mẫu cột mới + VAT-trước + visibility hardening, tất cả review PASS. **Chưa deploy** — chờ CEO chốt: (1) thời điểm deploy (⚠ đổi số sang VAT-trước); (2) DN021 lệch mã QĐ (cùng thuốc?); (3) task C48 sidecar cho DataHub Bot.

### 2026-07-22 — Report Bot — KHÔI PHỤC FE production về main (hết "Lỗi máy chủ")
- **Giải quyết "Lỗi máy chủ" bằng cách bảo thủ:** đưa **FE public về đúng `origin/main` (c2abea1)** thay vì deploy bản mới. Bundle FE main **không còn gọi `/employee-cost/visibility`** (route chỉ có trên nhánh review), nên hết 404/"Lỗi máy chủ". **BE không restart** (PID/restart count giữ), **số chi phí không đổi**, nhánh review `6ef5e3c` giữ nguyên chưa deploy. Backup bundle review: `backups/frontend-review-dist-20260722_145601/dist`. (Tab cũ cần tải lại 1 lần.)
- Xác nhận chẩn đoán: sự cố là **lệch phiên bản FE mới / BE cũ**, không phải lỗi code. Panel "Quản trị quyền tự xem chi phí" là **tính năng chỉ có trên nhánh review**, đúng ra chưa vào production.

### 2026-07-22 — Claude Code (giao bot) — "Lỗi máy chủ" trang Chi phí: nguyên nhân THẬT = process cũ (404)
- CEO báo trang Chi phí "Lỗi máy chủ" + "Chưa có nhân viên" + bảng trống. Chẩn đoán ban đầu của Claude (loadConfig 500) **SAI cho lần này** — bot kiểm tra: config OK, `loadConfig()` OK, không stack; `curl` trả **404** không phải 500.
- **Nguyên nhân thật:** process production khởi động trước khi route `/employee-cost/visibility` được thêm → BE chưa nạp route; FE bản mới gọi → 404 → FE map về "Lỗi máy chủ". Lệch phiên bản, không phải lỗi code. **Fix = restart/deploy** (đã xử bằng revert FE về main, xem mục trên). Directive: `DIRECTIVE_EMP_COST_VISIBILITY_500_FIX.md` (#126) — loadConfig hardening hạ xuống **phòng-vệ-tùy-chọn**; giữ bọc route GET trả `{error}`; polish FE phân biệt 404 vs 500.

### 2026-07-22 — Claude Code (review) — vá lookup `6ef5e3c`: PASS + phát hiện lệch mã QĐ (DN021)
- **Review `6ef5e3c`: PASS.** `buildCostLookup` quay về khóa `unit␟product`; guard fail-closed **chỉ chặn đúng cặp (đơn vị+mã) nhập nhằng**. Phía tiêu thụ đổi `costLookup.get(unit␟product)`. **Điểm cộng:** coverage đo trên khóa (đơn vị+mã) duy nhất (170/183=92,9%), bảng giữ grain order-line (209/222). VAT spot-check `380.000÷1,05×0,5%=1.810đ` (trước VAT). Test 32/32 + 218/218 + 25/25 + build PASS. **DN001 nghiệm thu ĐẠT.**
- **DN021 CTV: layout PASS nhưng 0/3 do lệch mã QĐ** — catalog chi phí `QĐ48…549` vs doanh thu `QĐ139…549`; hệ thống **fail-closed để `—`** (đúng #3, KHÔNG tự bắc cầu). **Câu hỏi dữ liệu cho CEO/DataHub:** 2 mã có cùng mặt hàng? Cùng → DataHub chuẩn hóa mã ở nguồn; khác → 0/3 đúng thực tế. Ghi chú C48 = `—` tạm. Sidecar C48: CEO đã chốt ranh giới + điều kiện cứng "C48 thiếu ≠ kỳ thiếu".

### 2026-07-22 — Report Bot — Harden trang quản trị chi phí theo directive #126
- `employeeCostRoster.loadConfig()` nay fail-soft về `{}` khi file nhóm thiếu/hỏng/path sai, chỉ ghi cảnh báo phía server; picker vẫn dựng đủ NV với nhóm mặc định thay vì làm trang sập.
- Hai GET `/employee-cost/employees` và `/employee-cost/visibility` được bọc handler bắt lỗi, trả JSON `{error}` cụ thể khi có lỗi thật.
- Thêm regression cho config thiếu file, roster mặc định và lỗi giả ở cả hai GET. Chỉ cập nhật nhánh review, **không deploy/restart production**.

### 2026-07-22 — Report Bot — Vá regression lookup chi phí theo directive #125
- Quay khóa timeline từ `mã hàng` về đúng `(đơn vị + mã hàng)`; xung đột tỷ lệ chỉ làm fail-closed khóa đơn vị–mã hàng đó, không loại toàn bộ mã hàng ở các đơn vị khác.
- Độ phủ tiếp tục tính trên số khóa `(đơn vị + mã hàng)` duy nhất trong doanh thu, còn bảng chi tiết vẫn giữ grain order-line. Live-read T07 DN001 phục hồi đúng **170/183 = 92,9%** (209/222 order-line có tỷ lệ), tổng được phép hiển thị.
- DN021 hiện **0/3** do DataHub trả mã chi phí `G1.GE.QĐ48.549.N4.549` trong khi doanh thu là `G1.GE.QĐ139.2963.N4.549`; giữ fail-closed, không tự ánh xạ/bịa mã. C48 vẫn chưa có và hiển thị `—` theo directive.
- Thêm regression test khóa `(đơn vị + mã hàng)`, cô lập duplicate xung đột và coverage unique-key; chỉ push nhánh review, **chưa deploy/restart production**.

### 2026-07-22 — Report Bot — Hoàn thiện 2 mẫu “Chi phí của tôi” trên nhánh review
- Thêm cấu hình độc lập `server/config/employee_cost_templates.json`: nhóm **tính chi phí** part-time chỉ gồm `DN021/DN022/DN023` và dùng C36; còn lại full-time dùng C36/C41/C43/C44/C45. Cấu hình mẫu hiển thị tách khỏi cấu hình nhóm tính và không dùng `employee_cost_groups.json`.
- Backend giữ grain order-line/self-scope/C32-C47/công tắc, bổ sung Tuyến · tên Nhà thầu · Hàm lượng · Giá trúng thầu · doanh thu trước VAT · C48; đổi phép tính sang `doanh thu / VAT_DIVISOR × %`, vẫn tách C44 và ẩn tổng khi độ phủ dưới 90%.
- Frontend render đúng thứ tự mẫu **19 cột full-time / 15 cột part-time**, `Giá trúng thầu` đứng trước `Số lượng`, `Ghi chú` cuối; hàm lượng dài giữ một dòng có ellipsis + tooltip.
- Regression employee-cost **31/31**, frontend employee-cost/visibility **12/12**, toàn bộ server/web test và production build PASS. Chỉ push review, **chưa deploy/restart production**.

### 2026-07-22 — Claude Code (chẩn đoán + giao bot) — SỬA khóa lookup chi phí (match sụt 2/222)
- **Review `d0fd7c8` (nhánh templates): layout/công thức ĐÚNG** (VAT trước: 12.616.000×13%=1.640.080 full-time, ×8%=1.009.280 CTV; c44 loại; 2 mẫu đúng nhóm). **NHƯNG match sụt 2/222** (bản main 170/183).
- **Chẩn đoán: lỗi KHÓA LOOKUP** (không phải DataHub). `buildCostLookup` đổi sang product-only + guard "mọi dòng cùng mã phải % giống hệt" → endpoint ~10.982 dòng/NV % khác theo đơn vị → rớt gần hết. **Sửa: quay lại ghép (đơn vị + mã hàng)** như main. Directive: `DIRECTIVE_EMP_COST_LOOKUP_FIX.md`.

### 2026-07-22 — Claude Code (giao bot) — "Chi phí của tôi": 2 mẫu cột + VAT trước + ghi chú C48
- CEO gửi 2 mẫu Excel (full-time / part-time). Giao Report Bot: **2 layout** — full-time đủ 5 cột % (C36/C41/C43/C44/C45); **CTV part-time = DN021/DN022/DN023 chỉ C36**. **Nhóm CTV cho TÍNH TIỀN khác nhóm hiển thị** → config riêng `employee_cost_templates.json`.
- Cột mới: Tuyến · Nhà thầu (tên) · **Hàm lượng** (QĐ141 dài → **1 dòng + tooltip**) · **Giá trúng thầu** (CEO duyệt hiện) · **Thành tiền xuất bán (trước VAT)** thay "Doanh thu" · **Ghi chú từ DataHub C48**.
- **‼ VAT:** đổi gốc tính → chi phí % nhân **doanh thu TRƯỚC VAT** (÷ VAT_DIVISOR) — khác production hiện tại (đang có-VAT).
- Việc DataHub: **thêm C48 (ghi chú) vào payload** (ngoài dải %, vẫn khóa C32/C47). Directive: `DIRECTIVE_EMP_COST_TEMPLATES.md`; mẫu gốc: `docs/report-samples/CHIPHI_TEMPLATE_{FULLTIME,PARTTIME}.xlsx`.

### 2026-07-22 — Nghiệm thu PRODUCTION — "Chi phí của tôi" chạy thật (Claude xác nhận)
- **Đã deploy + nghiệm thu production.** Pipeline hoàn chỉnh: doanh thu (App Sale) × % (DataHub, catalog V30.10) = Thành tiền, self-scoped. Khớp doanh thu **170/183 = 92,9% ≥ 90%** → tổng hiển thị. **Tổng chi phí tháng (trừ c44) = 42.834.991đ** (c36 750.400 + c41 7.995.379 + c43 26.489.506 + c45 7.599.706 — Claude cộng lại khớp); **c44 tách riêng 36.659.958đ**. 199/199 test, health OK.
- **Theo dõi tiếp:** (1) 13/183 khóa chưa khớp % (7,1%) → dòng có doanh thu nhưng Thành tiền `—`, nên rà (mã hàng thiếu trong catalog?). (2) 4 cột mới (Tuyến/Nhà thầu/Giá trúng thầu/Ghi chú) + thứ tự cột: **đợt kế** (chờ CEO chốt thứ tự + duyệt giá trúng thầu + nguồn ghi chú). (3) Carry-forward nhiều tháng (T06→T07) tùy DataHub.

### 2026-07-21 — Claude Code (review) — grain order-line `807b5744`: ĐẠT
- **Review `review/emp-cost-line-grain-20260721` (`807b5744`): ĐẠT.** `rows = revenueLines.map(...)` — **mỗi dòng doanh thu = 1 dòng** (không gộp; `sourceLineId` giữ từng dòng thô); Cerecaps T06 DN001 = **2 dòng riêng** (13.246.800đ + 11.970.000đ); không bịa ngày/mã đơn (T06 cũ thiếu → `—`); % + Thành tiền `—` vì DataHub chưa xong (đúng); giữ tổng/kỳ, c44, self-scope, C32/C47, công tắc, Σ ngày = tháng. 236/236 test.
- 2 commit kèm (đều tốt): `7e1f32f` employee-bound key (token gán theo NV — bảo mật ↑); `b0231d7` bound OTP timeout (hardening auth, ngoài phạm vi cost nhưng có lợi). Chưa deploy.
### 2026-07-22 — Report Bot — “Chi phí của tôi” chuyển sang grain order-line
- Bỏ gộp doanh thu theo đơn vị × mã hàng: mỗi dòng doanh thu nguồn (mỗi đơn × mỗi mặt hàng) được giữ thành một dòng hiển thị, có mã đơn/ngày/số lượng/doanh thu dòng khi nguồn cung cấp.
- Timeline % được tra theo mã hàng × tháng rồi áp cho từng order-line; thiếu DataHub vẫn giữ đủ dòng doanh thu với `%`/`Thành tiền` là `—`.
- Giữ tổng tháng/kỳ, tách C44 cuối năm, self-scope, chặn C32/C47, công tắc và nhóm xem theo ngày với Σ ngày = tháng.
- Nghiệm thu dữ liệu thật T06 DN001: Cerecaps giữ 2 dòng riêng 13.246.800đ và 11.970.000đ; bổ sung test grain, full test và production build.

### 2026-07-21 — CEO Office — employee-bound key cho consumer chi phí
- Thay shared cost token bằng hai lớp tách biệt: `DATA_HUB_ASSIGNMENT_KEY` xác thực service và `APP_REPORT_EMPLOYEE_COST_KEYS` bind chính xác từng mã NV sau khi backend khóa scope từ session.
- Không fallback `APP_REPORT_COST_TOKEN`; thiếu/sai/trùng key, một NV có nhiều key xung đột, hai NV dùng chung key hoặc employee key trùng assignment key đều fail-closed trước khi gọi Data Hub.
- Key không đi qua frontend/log/audit/error; payload vẫn self-scoped, chặn C32/C47 và `private, no-store`.
- Cutover chỉ được phép khi mapping hai phía khớp đúng roster và hai tập key độc lập.

### 2026-07-21 — Claude Code (giao bot) — "Chi phí của tôi": grain = mỗi đơn × mỗi mặt hàng (không gộp)
- CEO chốt: mỗi mặt hàng trong đơn = 1 dòng; nhiều đơn cùng mã QLNB = mỗi đơn 1 dòng. ⇒ **bỏ gộp `(đơn vị×mã hàng)`, hiển thị theo dòng giao dịch (order-line)**. Vd Cerecaps T06 DN001 = **2 dòng riêng** (13.246.800đ + 11.970.000đ), không gộp 1. % tra timeline theo mã hàng+tháng (mọi dòng cùng mã/tháng cùng %). Giữ tổng/c44/scope/C32-C47/công tắc. Chạy được ngay, không phụ thuộc DataHub. Directive: `DIRECTIVE_EMP_COST_LINE_GRAIN.md`.

### 2026-07-21 — Claude Code (review) — REDESIGN timeline (revenue-driven) `60c8c9c`: ĐẠT
- **Review `review/employee-cost-timeline-redesign-20260721` (`60c8c9c`): ĐẠT.** Lõi chuyển đúng sang **doanh thu dẫn dắt** (`rows = revenueIndex.entries()`, DataHub chỉ là bảng tra %); thiếu %/trùng % → giữ dòng với `—`; ghép theo MÃ (byUnitCode/byCode, c5 confirm qua catalog, không tên trần); dimensions canonical; giữ daily Σ=tháng, c44, self-scope, C32/C47, công tắc; thêm alias env `DATA_HUB_BASE_URL`/`DATA_HUB_ASSIGNMENT_KEY`. 230/230 test.
- **2 phát hiện dữ liệu thật (bot không bịa — đúng):** (1) T07 DN001 chỉ **1 khóa Cerecaps** `038.PKĐK THIỆN NHÂN-CN2` 7.980.000đ (không phải 3 dòng) — do gom theo đơn vị×mã hàng / đơn 21/07 chưa vào snapshot; chờ CEO xác nhận cách hiển thị. (2) 🔴 **DataHub production vẫn trả 10.982 dòng, không `ky/period`, chưa áp `from/to`** — timeline fix CHƯA deploy → chưa tính được Thành tiền thật. Blocker duy nhất còn lại.

### 2026-07-21 — Claude Code (giao 2 bot) — REDESIGN model chi phí: % theo TIMELINE + dòng do App Report dẫn dắt
- **CEO xác nhận model đúng.** Sửa điểm gốc: % chi phí là **timeline thường trực** theo mã hàng (hiệu lực từ ngày-đầu-tháng, carry qua tháng), **KHÔNG** sinh từ `sales_facts`. **Danh sách dòng lấy từ doanh thu App Report** (mã hàng NV bán trong tháng), tra % từ DataHub timeline → **T07 hiện được dù DataHub chưa nạp sales_facts T07** (sửa cách hiểu cũ T07=0).
- Giao: **DataHub Bot** trả % theo timeline (không gate sales_facts); **Report Bot** dẫn dắt dòng từ doanh thu App Report + tra % từ DataHub. Directive: `DIRECTIVE_EMP_COST_TIMELINE_REDESIGN.md`; cập nhật `DIRECTIVE_EMP_COST_MASTER.md`.

### 2026-07-21 — Claude Code (review) — "Chi phí của tôi" mục 11 (công tắc bật/tắt): ĐẠT
- **Review `bbfc86c` (`review/emp-cost-visibility-toggle-20260721`): ĐẠT.** `employeeCostVisibility.js`: ưu tiên **cá nhân > nhóm > phòng**, mặc định **off**, **mã ngoài roster fail-closed** (kể cả phòng đang bật/override cũ). Route: toàn bộ fetch DataHub/doanh thu/catalog nằm **trong callback** — **OFF → trả `disabled`, KHÔNG chạy callback** (không đụng DataHub); **admin bypass** (CEO/admin xem NV bất kỳ). Admin routes GET/POST `requireAdmin`; validate chặt (chỉ roster, on/off/inherit); audit access_denied + đổi cấu hình (an toàn, không token/số chi phí). FE render cờ `disabled` từ backend, không tự quyết quyền. 227/227 test + build + quét bundle PASS.
- **Chưa deploy.** Còn blocker DataHub (self-scope + trường kỳ) + `.env` trước khi bật production.

### 2026-07-21 — Claude Code (review) — "Chi phí của tôi" MASTER + roster: ĐẠT (code trên main)
- **Review `ad2cd64` (period drilldown) + `504cbda` (roster/nhóm): ĐẠT.** Đã xác minh `employeeCost.js` trên main **byte-identical** với bản review. Điểm mạnh: xem theo ngày đảm bảo **Σ ngày = tổng tháng** (dồn phần lẻ vào ngày cuối); **chống cộng trùng** (nhiều dòng cùng đơn vị+SP → fail-closed); **Tổng cả kỳ** không gộp c44; **fail-closed khi DataHub trả range không có trường kỳ** (lá chắn lỗi 10.982 dòng); doanh thu lấy riêng từng kỳ + scope theo NV; nhóm CTV/CTV-đặc-biệt nằm ở **config JSON** (không hardcode); "Tất cả nhân viên" đã gỡ sạch (revert kiểm tra rỗng).
- **Chưa deploy** (đúng chủ đích). Chờ: (1) DataHub sửa self-scope + trường kỳ, (2) mục 11 công tắc/gửi riêng, (3) `.env` `DATAHUB_BASE`/`APP_REPORT_COST_TOKEN`.

### 2026-07-21 — Report Bot — Công tắc tự xem “Chi phí của tôi” theo phòng/nhóm/cá nhân
- Thêm cấu hình bền `employee_cost_visibility.json`, mặc định an toàn `department=off`; override nhóm/cá nhân dùng roster Sale 21 người và ưu tiên **cá nhân > nhóm > toàn phòng**. Mọi lần đổi được audit nguyên trạng trước/sau, actor, thời gian và từng path thay đổi.
- Backend khóa self-view trước mọi truy cập doanh thu/catalog/DataHub: NV bị tắt chỉ nhận `{ disabled:true, columns:[], rows:[] }`; CEO/admin bypass để quản trị. `/me` trả `employeeCostDisabled` để frontend ẩn tab theo quyết định backend.
- Thêm GET/POST `/api/employee-cost/visibility` có `requireAuth + requireAdmin`, validate `on/off/inherit`, trả panel động gồm toàn phòng/nhóm/NV cùng trạng thái hiệu lực và nguồn quyết định.
- Trang Chi phí của tôi có panel CEO/admin để bật/tắt toàn phòng, từng nhóm và từng cá nhân; không hardcode roster/nhóm trong bundle. Bổ sung API/model/CSS và test service, audit, input lỗi, route guard/thứ tự fail-closed, model/source/ẩn tab frontend.

### 2026-07-21 — Report Bot — "Chi phí của tôi": tự tính Thành tiền + tách khoản cuối năm
- App Report ghép dòng chi phí với doanh thu đã khóa scope theo **đơn vị + mã sản phẩm** (C16 được resolve qua catalog), tính `Thành tiền = doanh thu × tỷ lệ ÷ 100`; dòng không khớp giữ `—` và cảnh báo khi tỷ lệ khớp dưới 90%.
- Mỗi cột tỷ lệ có cột **Thành tiền**; tỷ lệ hiển thị số không kèm `%`. Cột cấu hình cuối năm (mặc định `c44`) được làm mờ, không cộng vào tổng tháng và có tổng T12 riêng.
- Giữ nguyên chặn C32/C47, token chỉ ở backend và audit theo scope; bổ sung test server/web cho phép tính, fail-closed, tổng tháng/cuối năm và định dạng hiển thị.
- Ô chọn nhân viên CEO/admin chỉ lấy **đúng roster Sale 21 người** và chọn từng người, không có lựa chọn “Tất cả”. Phân nhóm backend: 15 NV chính thức, CTV (`DN002/DN004/DN022`) và CTV đặc biệt (`DN021/DN023/VP004`) để sẵn sàng cho chế độ gửi riêng.
- Bổ sung bộ lọc **Từ tháng/Đến tháng** mặc định tháng hiện tại; backend kiểm `YYYY-MM`, khóa scope NV và truyền nguyên `from/to` xuống endpoint DataHub. Adapter nhận payload `periods`/`months` hoặc dòng có `period`, giữ tương thích payload cũ đúng một tháng và fail closed khi nguồn nhiều tháng mơ hồ.
- Doanh thu/catalog được lấy riêng đúng từng kỳ; UI tách mỗi tháng thành một khối có tổng tháng riêng và thêm **Tổng cả kỳ** không gồm cột cuối năm. Drill ngày chỉ mở khi mọi dòng doanh thu có ngày đúng kỳ và tổng Thành tiền ngày khớp tuyệt đối tổng tháng; thiếu/sai ngày giữ trạng thái rỗng an toàn.

### 2026-07-21 — Claude Code (review + giao bot) — "Chi phí của tôi": Thành tiền ĐẠT + công tắc bật/tắt
- **Review THẬT `b1a4cd0` (Thành tiền): ĐẠT.** Ghép doanh thu resolve `c16`→mã qua catalog (không dùng tên trần), scope doanh thu đúng NV+kỳ, `round(dt×%/100)`, <90% khớp → ẩn tổng + cảnh báo, c44 tách annual (cấu hình env), % hiện `8.0` không ký hiệu %, fail-closed/audit. Bản MASTER `ad2cd64` (lọc tháng/xem ngày/tổng kỳ) chưa push — chờ review tiếp.
- **Giao bot công tắc bật/tắt** (`DIRECTIVE_EMP_COST_VISIBILITY_TOGGLE.md`): CEO bật/tắt quyền NV tự xem chi phí ở 3 mức **toàn phòng / nhóm (vd CTV) / cá nhân**, ưu tiên cá nhân>nhóm>phòng, mặc định off, chốt quyền ở backend (OFF → `disabled`, không gọi DataHub), panel + route CEO-only + audit.
- **Blocker:** endpoint DataHub `employee-cost` trả 404 (chưa mở) → App Report fail-closed đúng; task dựng endpoint giao phiên DataHub.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": DIRECTIVE TỔNG gộp cho bot đọc 1 lần
- Gộp toàn bộ yêu cầu module "Chi phí của tôi" vào `DIRECTIVE_EMP_COST_MASTER.md` (nguyên tắc scope/C32-C47/token, cách lấy đúng cột khi khóa C32–C47, render động + hiển thị %, Thành tiền tự tính + C44 cuối năm, bộ lọc kỳ (C), xem theo ngày, lấy thử T07 thật, nghiệm thu). Để CEO copy cho bot; các directive rời vẫn giữ.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": chốt (C) + xem theo NGÀY + cách lấy đúng cột
- CEO chốt khoảng nhiều tháng = **(C)** tách từng tháng + dòng "Tổng cả kỳ" (không gộp c44). NV **bấm xem theo NGÀY**: `Thành tiền ngày = doanh thu ngày × %(tháng) ÷ 100` (App Report tự tách từ doanh thu ngày; Σ ngày = tháng).
- **Tư vấn cách lấy đúng cột khi DataHub khóa C32–C47:** không phá khóa/không đọc cột khóa trực tiếp; dùng endpoint dịch vụ + `x-assignment-key` làm cửa hợp lệ duy nhất — DataHub whitelist đúng cột CEO chỉ định (C33–C46), self-scoped theo NV, khóa cứng C32/C47; bot chỉ dùng endpoint. Directive: `DIRECTIVE_EMP_COST_ACCESS_DAYVIEW.md`.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": bộ lọc kỳ (Từ→Đến tháng) + lấy thử T07 thật
- Giao bot thêm **bộ lọc "Từ tháng → Đến tháng"** cho trang Chi phí của tôi (FE + backend truyền `from/to` xuống DataHub; vẫn khóa scope NV). Nhiều tháng = **tách từng tháng** (mỗi tháng có tổng riêng; c44 cuối năm tách như đã chốt). DataHub cần nhận thêm tham số kỳ (thêm tham số lọc, không phải thêm cột) — bot phối hợp phiên DataHub.
- **Lấy dữ liệu THẬT T07/2026 tính thử** (bot chạy trên server — Claude không có quyền dữ liệu thật): dán vài dòng + tổng chi phí tháng (trừ c44) + tỉ lệ dòng khớp doanh thu để CEO/Claude soi. Directive: `DIRECTIVE_EMP_COST_MONTH_FILTER.md`.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": App Report tự tính Thành tiền + cột cuối năm
- CEO chốt DataHub không mở thêm cột → **App Report tự thêm cột Thành tiền + tự tính**: `Thành tiền(dòng) = doanh thu dòng × % ÷ 100` (doanh thu dòng App Report tự lấy, ghép theo đơn vị+sản phẩm; không khớp → `—`).
- Hiển thị cột %: bỏ ký hiệu `%`, chỉ số (8,0%→`8.0`). Mỗi cột % có cột Thành tiền; **Tổng chi phí tháng** = Σ Thành tiền **trừ cột cuối năm**.
- **Cột cuối năm (mặc định `c44`)** thanh toán T12, không tính vào chi phí tháng: hiển thị **mờ + badge**, tách dòng "Khoản cuối năm (T12)" riêng + chú thích (Claude tư vấn). Directive: `DIRECTIVE_EMP_COST_THANHTIEN.md`; cập nhật `SPEC_REPORT_EMP_COST_SELFVIEW.md`.

### 2026-07-20 — Claude Code (thiết kế/giao bot) — Thêm theme "MODERN" + bố cục thích ứng cho deck
- CEO duyệt phong cách HIỆN ĐẠI (sạch/thoáng, accent gradient tím–xanh, KPI lớn). Giao bot **thêm theme chọn được** (song song bản hiện có) + **bố cục thích ứng theo mật độ nội dung** (trang nhiều chữ căn gọn vừa khung; trang ít chữ tăng cỡ chữ + chèn hình minh hoạ SVG).
- Mốc hình ảnh: `docs/report-samples/MODERN_THEME_MOCKUP.html`; directive: `DIRECTIVE_DECK_MODERN_THEME.md` (design tokens đã kiểm CVD, giữ grounding/CEO-only/32-slide).

### 2026-07-20 — Claude Code (review) — Module “Chi phí của tôi” (`6781517`): ĐẠT
- **Review DUYỆT.** Khóa scope NV (ép mã phiên; picker `requireAdmin`), chặn `C32/C47` cả backend+frontend, kiểm `empCode` 2 lần + strip field lạ, token chỉ ở backend/fail-closed/retry backoff/audit, FE render động không tự tính/cộng dồn chi phí, sẵn `type` %/money (phương án B). Test 177/177 server · 15/15 web · build + quét bí mật PASS. Không có điểm chặn.
- **Còn lại (ngoài code):** điền `.env` `DATAHUB_BASE`+`APP_REPORT_COST_TOKEN` rồi deploy; cột “Thành tiền” chờ phiên DataHub bổ sung (task contract-update đã giao) — khi có dải key sẽ ra directive nới allowlist cho App Report.

### 2026-07-20 — Report Bot — Module “Chi phí của tôi” self-scoped
- Thêm proxy S2S `GET /api/employee-cost`: backend dùng `auth.scopeOf`, ép NV về chính mã phiên; CEO/admin được chọn NV. Token DataHub chỉ đọc từ `.env` backend; payload được allowlist lại, chặn `c32`/`c47`, field ngoài hợp đồng và response sai `empCode`.
- Thêm timeout/retry backoff cho lỗi tạm thời, response rỗng an toàn khi nguồn lỗi/401, `Cache-Control: private, no-store` và audit mỗi lượt truy cập không ghi token/body nhạy cảm.
- Thêm tab “Chi phí của tôi”, bảng cột động, chiều `c5/c7/c16/c25` đứng trước, format `%` kiểu Việt; cột tiền chỉ hiển thị/format khi metadata DataHub khai báo rõ. App Report không tự tính/suy ra tiền và không tổng hợp tỷ lệ.
- Đồng bộ hợp đồng DataHub vào `docs/`, bổ sung biến `.env.example` và test scope/sanitize/retry + model bảng động.

### 2026-07-20 — Claude Code (tư vấn kiến trúc) — Thành tiền chi phí: chốt phương án B (DataHub tính, App Report view)
- CEO cần cột **Thành tiền** cho module "Chi phí của tôi". Tư vấn: **DataHub tính sẵn `%×base` tại nguồn** (SSOT), đưa vào `columns[]`; App Report **chỉ view** — vì bảng render động nên **tự hiện, không sửa code**. Tránh lệch số & join mờ, giữ nguyên tắc "App Report không tính chi phí".
- Yêu cầu nhỏ cho DataHub: mỗi cột trong `columns[]` thêm `type ∈ {percent, money}` để App Report format đúng (% không cộng dồn; money định dạng tiền, được phép tổng). Cập nhật `SPEC_REPORT_EMP_COST_SELFVIEW.md`.

### 2026-07-20 — Claude Code (review + giao bot) — Sửa kỳ TUẦN của deck + review 728c734
- **Review deck `728c734`: ĐẠT.** Grounding (deckHtml không số cứng, số từ analytics/diemXu, narrative từ facts đã tính), CEO-only 3 tầng (build/sendCeo/route requireAdmin), delivery (sendDocument + email attachments + PDF fallback, nhãn DRAFT, chống trùng, assert 32 slide) đều đúng spec.
- **DIRECTIVE sửa kỳ TUẦN** (`DIRECTIVE_DECK_WEEKLY_ISOWEEK.md`): CEO chốt báo cáo TUẦN = **tuần lịch ISO Thứ 2→Thứ 7** (hiện tuần 30/2026), KHÔNG lũy kế đầu tháng; so sánh vs tuần trước; nhãn "Tuần {ISO}/{năm}". Tháng giữ nguyên. Chỉ đổi cửa sổ ngày cho `kind='week'`, không đổi cách tính số.

### DRAFT — 2026-07-20 — deck CEO 32 slide: hoàn thiện 5 pha, lịch vẫn khóa
- Hoàn thiện module canonical `deckData.js`/`deckHtml.js`: nguồn hàng ưu tiên map live trong catalog, luôn đối soát đủ Group-Dona/Đối tác; cảnh báo “doanh số cao–xu thấp” dùng đúng doanh số quý; DRAFT và bản chính thức tách nhãn/key, không ảnh hưởng báo cáo per-NV trong `salesReport.js`.
- Chuyển renderer PPTX sang Playwright thật (`playwright-core`) → 32 PNG 1280×720 → `pptxgenjs` 16:9 full-bleed; thêm kiểm tra overflow từng slide và PDF fallback 32 trang nếu đóng gói PPTX lỗi.
- Delivery giữ CEO-only, email đính kèm và Telegram `sendDocument`; lưu tiến độ từng kênh để retry chỉ gửi lại tệp/kênh lỗi, DRAFT không chặn khóa chống trùng bản chính thức.
- Bổ sung CLI DRAFT mặc định/`--official`, route preview admin có PDF fallback, scheduler 13:00 Thứ 7 + 18:00 ngày cuối tháng theo Asia/Ho_Chi_Minh. Scheduler fail-closed bằng hai cờ `REPORT_DECK_SCHEDULER_ENABLED=false` và `REPORT_DECK_SCHEDULER_APPROVED=false`.
- QA: đối chiếu độc lập tổng doanh thu, Top đơn vị/sản phẩm và Điểm–Xu đều khớp backend; HTML/PPTX tuần + tháng đủ 32 slide, không overflow, PPTX ZIP hợp lệ 32 slide/16:9; toàn bộ 173 test PASS.
- Sau khi CEO duyệt, đã gửi riêng CEO bản DRAFT tuần và tháng qua email + Telegram, mỗi kỳ gồm `.html` + `.pptx`. Lịch tự động vẫn tắt; không deploy/restart.

### PRODUCTION — 2026-07-15 — App Report New chính thức tại report.donapharm.asia
- Chốt release `5df20e0`, build production và chạy PM2 `reportnew` trên `127.0.0.1:3873`; giữ `dona-report` cổng `3860` nguyên trạng để rollback nội bộ.
- Home SSO dùng `GET /api/sso/verify`, Report phát session riêng; CORS chỉ cho các origin DONAPHARM được duyệt và asset thiếu trả HTTP 404 thay vì SPA HTML.
- Tunnel chính chuyển `report.donapharm.asia` sang `3873`; gỡ public alias `tuan13`/`slides` tới app cũ. HTTPS health/version, Home SSO, API có quyền, desktop/mobile và console đều PASS.
- Cấu hình và source đã sao lưu trước cutover; không commit `.env`, secret hay artifact private.

### DRAFT — 2026-07-14 — CEO Deck V5D dùng ảnh CEO cung cấp + chuẩn hóa pháp nhân (38 slide/deck)
- Tạo bản độc lập `deckHtmlV5D.js`, `deckPptxV5D.js`, `deckReportV5D.js`; không ghi đè V5/V5C. Xuất tuần W28 và tháng 06/2026 tại `artifacts/sales-report/deck-v5d-ceo-photos/`, tên tệp kết thúc `_DRAFT_V5D_CEO_PHOTOS`.
- Chỉ dùng đúng 20 JPG CEO cung cấp `ceo-photo-74.jpg` → `ceo-photo-93.jpg`, xác minh SHA-256 theo `SOURCE_MANIFEST.json`; dùng đủ 20 ảnh trên đúng 18/38 slide mỗi deck, nhúng data URI tự chứa. Ảnh du lịch 74–79 chỉ nằm trong một collage văn hóa/kết thúc, không làm bằng chứng vùng/sản phẩm/QLNB. Không có URL ảnh từ xa hay tham chiếu asset AI V5C.
- Sửa chuẩn hóa nhà cung cấp không phân biệt hoa/thường/khoảng trắng, nhãn hiển thị ổn định. Tháng 06/2026: DONAPHARM **10.593.941.804đ**, AFP PHARMA **8.232.847.232đ**, Group-Dona **18.826.789.036đ**, đúng 2 pháp nhân; tổng công ty giữ **28.403.136.096đ**. Tuần: DONAPHARM **3.792.635.096đ**, AFP PHARMA **3.224.833.445đ**, Group-Dona **7.017.468.541đ**, đúng 2 pháp nhân.
- Giữ facts V5: 38 slide/deck; QLNB **2.741 / 122 / 44 / 9.440.828.476đ / 18 sản phẩm / đủ 44 dòng**; chỉ đào sâu Đồng Nai/Bình Phước; không tạo WoW giả. Slide 12 hiển thị đúng hai pháp nhân Group-Dona.
- Evidence tại `verification-screenshots/20260714-ceo-deck-v5d-ceo-photos/`: 76 PNG 1920×1080, contact sheets, photo-rich sheets, source-use manifest và QA ledger 76/76 slide. QA PASS: logo chính thức 38/38, PPTX ZIP 38/38, 0 geometry issue, 0 console error, 0 hash slide trùng trong từng deck; spot-audit full-resolution slide 6–8, 12, 14, 17, 35, 38 không còn lỗi cụ thể.
- V5D/V5/V4/CST regression đều PASS. Chưa gửi ngoài, chưa deploy/restart/commit/push, chưa bật lịch.

### REJECTED / NOT DELIVERED — 2026-07-14 — CEO Deck V5C Images tuần/tháng (38 slide, Premium Pharmaceutical)
- CEO từ chối vì V5C dùng hình AI thay vì ảnh công ty CEO đã cung cấp. Bản V5C là nháp bị loại, **không giao/không gửi**, không được tái sử dụng asset AI trong V5D.
- Tạo nhánh module/artifact/test độc lập `deckHtmlV5C.js`, `deckPptxV5C.js`, `deckReportV5C.js`, tái sử dụng `deckDataV5`; V5 Deep được giữ nguyên như bản lịch sử data-first, không ghi đè.
- Tích hợp 8/8 asset hình ảnh Premium Pharmaceutical đã duyệt bằng data URI tự chứa vào 18/38 slide mỗi deck; không URL ảnh từ xa. Dùng panel/crop/veil khác nhau cho bìa, vùng, khách hàng, NV, danh mục, QLNB, Điểm/Xu, rủi ro/kết luận; 5 trang chi tiết 44 dòng QLNB giữ thuần dữ liệu.
- Giữ toàn bộ facts V5: tuần **10.649.681.681đ**, tháng **28.403.136.096đ**; chỉ đào sâu Đồng Nai/Bình Phước; QLNB **2.741 / 122 / 44 / 9.440.828.476đ / 18 sản phẩm / đủ 44 dòng trong 5 trang**; không tạo WoW tuần giả.
- Xuất HTML/PPTX `_DRAFT_V5C_IMAGES` tại `artifacts/sales-report/deck-v5c-images/`; evidence 76 PNG 1920×1080, contact sheets, focused image-rich sheets và ledger 76/76 slide tại `verification-screenshots/20260714-ceo-deck-v5c-images/`.
- QA tự động: 38 slide/deck, logo chính thức 38/38, 18 slide ảnh/deck, đủ 8 asset, 0 geometry issue, 0 console error, 0 hash ảnh slide trùng trong từng deck, PPTX ZIP 38 slide/38 PNG, manifest/hash khớp. Đã spot-audit full resolution các slide rủi ro cao và chỉnh vùng bảng/crop; chưa gửi ngoài, chưa deploy/restart/commit/push/bật lịch.

### DRAFT — 2026-07-14 — CEO Deck V5 Deep tuần/tháng (37 slide, Premium Pharmaceutical)
- Tạo mới `deckDataV5.js`, `deckHtmlV5.js`, `deckPptxV5.js`, `deckReportV5.js`; xuất riêng 4 artifact HTML/PPTX DRAFT tuần W28 và tháng 06/2026, không sửa/ghi đè V4.
- Mở rộng có chủ đích từ 32 lên 37 slide theo chỉ đạo CEO: 18/18 sản phẩm QLNB được tách 2 slide đọc rõ; 44/44 dòng QLNB đang chờ được tách 4 slide chi tiết. Baseline khóa: 2.741 dòng nguồn, 122 nhóm multi-QLNB, 44 dòng đang chờ, 9.440.828.476đ, 18 tên sản phẩm không trùng đại diện.
- Đào sâu khu vực chỉ Đồng Nai và Bình Phước; mọi tỉnh khác chỉ nằm trong tổng công ty. Week: 10.649.681.681đ (Đồng Nai 8.891.523.316đ; Bình Phước 1.570.481.685đ). Month: 28.403.136.096đ (Đồng Nai 19.351.299.898đ; Bình Phước 2.062.499.760đ).
- Phân tích đủ tuyến, Group-Dona/đối tác, khách hàng/điều trị, NV/đơn vị/sản phẩm, Điểm/Xu quý, rủi ro/cơ hội/action board. Tuần giữ `Không đủ chuẩn WoW`, không nội suy kỳ trước; tháng so hai tháng hoàn chỉnh.
- Đã phân tích thêm toàn bộ 20 slide mẫu `PhanTich_DoanhSo_20Slide_TUAN24_2026_1...pptx` và chỉ tiếp thu hierarchy KPI-first, warning có bằng chứng, concentration/middle-tier, action owner/deadline, treatment trắng–xanh–cam; không copy số cũ hay nền so sánh giả.
- QA: 2 deck × 37 = 74 slide render 1920×1080; ledger thủ công đủ 74/74 PASS, DOM collision/console 0, logo chuẩn 37/37 mỗi deck, PPTX ZIP hợp lệ 37 slide/37 PNG, không ảnh trùng trong từng deck. Evidence tại `verification-screenshots/20260714-ceo-deck-v5-deep/`. Chưa gửi ngoài, chưa deploy/restart, chưa bật lịch.

### DRAFT — 2026-07-14 — Sửa trình tự nhiều QLNB trong CST (App Report New / CEO Deck V4B)
- Thêm classifier CST trung tâm theo đơn vị + tên sản phẩm chuẩn hóa + ĐVT chuẩn hóa; giữ nguyên dòng nguồn và gắn metadata mã hiện hành, mã kế tiếp, trạng thái chuyển tiếp.
- Tách QLNB `ĐANG CHỜ`/`CẦN XÁC NHẬN` khỏi danh sách chưa khai thác, cảnh báo hành động và nội dung dùng để đánh giá nhân viên; cập nhật Analysis, Overview, CST và AI/smart answers.
- CEO Deck V4B tuần/tháng đổi slide “3 cuộc gọi đầu tiên” sang trình bày trung lập, sequence-aware và bổ sung ghi chú nghiệp vụ bắt buộc. V4A/V3 giữ nguyên artifact lịch sử.
- Baseline hiện tại được khóa test chính xác: 2.741 dòng, 122 nhóm nhiều QLNB, 44 mã đang chờ với 9.440.828.476đ. Các nhãn ĐVT nguồn xung đột chỉ được canonicalize khi cùng hậu tố family QLNB cung cấp bằng chứng định danh; không tự ghép ĐVT tùy ý.

### 2026-07-14 — Report Bot — CEO Deck V4 dual-theme DRAFT + logo chuẩn 32/32 slide
- Tạo V4A giữ phong cách Luxury Editorial navy/ivory/gold và V4B Premium Pharmaceutical trắng–xanh DONAPHARM–cam, dùng chung nội dung/số liệu canonical V3; không đổi kỳ tuần W28 `06–11/07/2026` hay tháng `01–30/06/2026`.
- Thay logo tách nền bằng đúng asset chính thức `web/public/logo-dnpharma.png` 640×369, SHA-256 `c5d9986df442c45a8af1ef78550d026626435940a4fa4e8d3404c4066838134e`, màu chủ đạo `#005DAA/#F7A31C/#FFFFFF`; giữ tỷ lệ gốc, nền trắng và chèn đủ 32/32 slide.
- Thêm `deckHtmlV4.js`, `deckPptxV4.js`, `deckReportV4.js` cùng script npm `deck:v4:build`, `deck:v4:test`, `deck:v4:test-build`; xuất 8 tệp HTML/PPTX DRAFT tại `artifacts/sales-report/deck-v4/` và contact sheet/PNG tại `verification-screenshots/20260714-ceo-deck-v4/`.
- QA PASS: tổng số liệu canonical không đổi; 4 deck × 32 slide; logo chính thức 32/32 trong HTML và pixel-proof 32/32 trên ảnh nguồn PPTX; 0 browser console error, 0 overflow/collision; PPTX ZIP hợp lệ, 32 slide; manifest SHA-256 đầy đủ. Không deploy/restart/gửi ngoài/bật lịch.

### 2026-07-13 — Report Bot — DRAFT deck CEO 32 slide tuần/tháng
- Đồng bộ `origin/main` chứa PR #104 trước khi triển khai; giữ nguyên toàn bộ thay đổi App Report New đang chạy, không reset workspace.
- Thêm `server/src/report/deckData.js`: FACTS CEO scope cho tuần/tháng gồm tổng và kỳ đối chiếu, ngày, tuyến, nguồn hàng, loại khách hàng, nhóm điều trị, NV/đơn vị/sản phẩm, điểm & xu quý; thiếu map giữ “Chưa phân loại/Chưa phân nhóm”, không suy đoán.
- Thêm `deckHtml.js`, `deckPptx.js`, `deckReport.js`: dựng 32 slide 16:9 theo hệ navy `#071F47` + vàng `#F5C242`, nhúng asset chính thức, chụp Chromium 1280×720 và đóng gói PPTX 32 ảnh full-slide.
- Sinh DRAFT tuần + tháng tại `artifacts/sales-report/deck/`, mỗi loại có HTML, PPTX và manifest SHA-256; scheduler vẫn tắt và chưa gửi ra ngoài khi chưa có CEO duyệt riêng.
- Bổ sung email attachments và Telegram `sendDocument`; route `POST /api/report/deck/preview` + tải file được bảo vệ bằng quyền CEO/admin, tài khoản NV nhận 403.
- Nghiệm thu: tổng live `16.589.980.621đ`/1.066 dòng khớp backend; top NV/đơn vị/sản phẩm và điểm/xu đối chiếu độc lập; HTML/PPTX đủ 32 slide, không overflow 1280×720, PPTX ZIP hợp lệ.

### 2026-07-13 — Claude Code (kiến trúc/review) — Giao bot: báo cáo CHUYÊN SÂU (deck 32 trang)
- **Bản yêu cầu gốc đầy đủ cho bot** (`YEUCAU_BAOCAO_CHUYENSAU_CEO.md`): tự chứa, để bot đọc 1 lần hiểu trọn yêu cầu CEO — mục đích (CEO-only, trình chiếu LED, chuẩn cao cấp), lịch (T7 13h tuần / 18h ngày cuối tháng), 2 định dạng HTML+PPTX, 2 kênh email+Telegram (gửi tệp), quy trình DRAFT duyệt trước, 12 khối nội dung, nguyên tắc số liệu grounded, ranh giới, Definition of Done.
- **Bối cảnh:** CEO gửi mẫu chuẩn (HTML slide-deck + PPTX Tuần 26), yêu cầu báo cáo doanh số chi tiết tuần/tháng gửi email+Telegram cả PowerPoint + HTML. CEO đồng ý để **bot cầm code app**.
- **File giao bot (nhánh `claude/new-session-eifd44`):**
  - `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` — mẫu chuẩn (32 slide 16:9, navy #071F47 + vàng #F5C242) làm nguồn sự thật hình ảnh.
  - `SPEC_REPORT_DECK_CHUYENSAU.md` — ánh xạ 32 slide → nguồn số grounded (`analytics`/`diemXu`/helper `salesReport.js`), 4 bảng tra bổ sung (tuyến CL/NCL/NT, nguồn Group-Dona/đối tác, loại KH, nhóm điều trị), PPTX qua Playwright→`pptxgenjs`, `notifyChannels.sendDocument` (Telegram) + email attachments, nghiệm thu 6 bước.
  - `DIRECTIVE_REPORT_DECK_KICKOFF.md` — thứ tự 5 pha + lệnh test từng pha.
- **Lịch gửi CEO chốt:** TUẦN gửi **13h00 Thứ 7 hằng tuần**, THÁNG gửi **18h00 ngày cuối tháng** (giờ VN).
- **Yêu cầu CEO:** báo cáo **CHỈ gửi CEO** (không gửi NV) — CEO trình chiếu **màn hình LED** cho toàn thể NV ⇒ chuẩn cao cấp: chính xác tuyệt đối, tinh xảo/thẩm mỹ, narrative thông minh. Bắt buộc dựng bản **DRAFT `[DRAFT — CHỜ CEO DUYỆT]`** gửi CEO duyệt trước khi lịch chạy chính thức.
- Ranh giới: KHÔNG đụng render per-NV trong `salesReport.js`; giữ nguyên tắc #2/#3/#4. Trạng thái: chờ bot triển khai.

### 2026-07-20 — Claude Code (kiến trúc/review) — Giao bot: module "Chi phí của tôi" (self-scoped)
- **Bối cảnh:** DataHub CEO-only nên NV không vào được → CEO chốt cho NV **tự xem chi phí/hoa hồng CỦA CHÍNH MÌNH** trong App Report. Điều chỉnh chính sách §8-BIS DataHub (trước cấm hoa hồng tới bề mặt NV) → nay cho NV thấy **của riêng mình** (self-scoped, read-only). Ghi ngoại lệ vào `CLAUDE.md`.
- **Quyết định CEO:** NV thấy **số tiền + tỷ lệ**; tên UI **"Chi phí của tôi"**.
- **Hợp đồng tích hợp (CEO cấp):** `GET /api/integrations/app-report/employee-cost?emp=<mã>`, header `x-assignment-key`; response cột **động** `{empCode, columns[], rows[]}`. Ràng buộc: `C32`(tổng)/`C47`(đầu ra) **không bao giờ gửi**; chỉ cột `C33–C46` CEO bật (allowlist động → render theo `columns`, không hardcode); giá trị **% theo dòng, KHÔNG cộng dồn**. Lỗi: 401 sai key / 400 thiếu emp / 502 retry.
- **File giao bot:** `SPEC_REPORT_EMP_COST_SELFVIEW.md` — App Report gọi DataHub server-to-server (token chỉ ở `.env`/backend), khóa scope ở backend (NV chỉ thấy của mình; CEO/ADMIN xem bất kỳ), FE render bảng động, không hardcode PII/số/token, không đưa vào LLM/NLQ. DataHub = SSOT (App Report không dựng engine thứ 2). Trạng thái: chờ bot triển khai.

### 2026-07-11 — Bot triển khai (Report Bot) — Vá UI thẻ Target trên Tổng quan
- **Deploy bản vá review `4207800` cho 3 file UI:** `web/src/charts.jsx`, `web/src/pages/Overview.jsx`, `web/src/styles.css`. Gauge target nay dùng thang 0–100 nên 44,x% lấp đúng khoảng 44% vòng, không còn góc nhỏ do thang cũ.
- **Khôi phục caption dưới vòng:** tách 2 cụm “Đã đạt” và “Mục tiêu tháng”, mỗi cụm có nhãn, số in đậm; “Đã đạt” đổi màu theo mức target (<80% đỏ đậm), “Mục tiêu tháng” xám đậm.
- **Build/deploy:** `npm --prefix web run build` OK; reload PM2 `reportnew` OK; domain public đang phục vụ asset hash mới `index-Pk5r85JG.js` / `index-Bp3OXr0t.css`.
- **Xác minh live:** trang Tổng quan T07.2026 hiển thị 44,7% (dữ liệu cập nhật 12:30 11-07), vòng lấp gần nửa; caption “Đã đạt 14.158.741.270đ” màu đỏ đậm và “Mục tiêu tháng 31.710.318.669đ” màu xám đậm, đều in đậm.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ họ mã đơn vị 034 trả hẹp
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** hint mã trần như `034`/`034*` khi khớp nhiều đơn vị khác nhãn sẽ trả cả họ mã để liệt kê, không thu về một đơn vị doanh thu cao nhất và không hỏi lại oan.
- **Giữ phân biệt cụ thể/mơ hồ:** `034.PKĐK Y ĐỨC TRẢNG BOM` vẫn ra đúng một chi nhánh; `034.PKĐK Y ĐỨC` vẫn ra riêng mã cha; `Y ĐỨC` chung chung vẫn hỏi lại; mã đơn nhất/cùng nhãn như `001` vẫn ra một đơn vị.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test live T07 6/6 PASS cho họ mã 034, mã cụ thể, mã cha, mã 001 và câu mơ hồ.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ hỏi lại vô tận đơn vị cùng tiền tố 034.PKĐK Y ĐỨC
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** ưu tiên khớp cụ thể nhất trước khi hỏi lại; nếu câu chứa nguyên mã đơn vị thì chọn mã dài/cụ thể nhất, tránh mã cha `034.PKĐK Y ĐỨC` chen vào mọi chi nhánh `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE` và gây vòng lặp hỏi lại.
- **Giữ câu mơ hồ thật:** chỉ gõ “Y ĐỨC” vẫn hỏi lại danh sách chi nhánh để NV chọn, không tự đoán.
- **Bổ sung pending-clarify trong `server/telegram-bot.js`:** nhớ câu hỏi/options 2 phút theo user; nếu NV trả lời bằng mã/tên ngắn ở lượt kế, bot map thẳng về option đã chọn rồi hỏi lại engine, không re-plan mất ngữ cảnh.
- **Test:** `node --check server/src/nlqEngine.js` OK; `node --check server/telegram-bot.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test bot thật 6/6 PASS cho `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE`, mã cha `034.PKĐK Y ĐỨC`, và câu mơ hồ “Y ĐỨC”.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ chặn oan tên đơn vị có “Công ty”
- **Sửa guard phạm vi NV trong `server/src/nlqEngine.js`:** tách `empScopeAsk` và `companyScopeAsk`; chỉ chặn khi hỏi thật sự “toàn/cả/toàn bộ công ty”, “doanh thu công ty”, “công ty mình/tôi/chúng ta” hoặc “tất cả/nv khác”. Không còn bắt nhầm chữ “CÔNG TY” trong tên pháp nhân đơn vị như “CÔNG TY TNHH/CỔ PHẦN …”.
- **Bổ sung nhận diện alias đơn vị:** bỏ tiền tố “đơn vị” trong hint và map `PKĐK` → “phòng khám đa khoa” để câu hỏi theo tên đầy đủ/viết tắt đơn vị resolve đúng.
- **Nhãn quyền rõ ràng:** các breakdown/ranking khi NV hỏi trong scope sẽ ghi “của Anh/Chị” trên tiêu đề để tránh hiểu nhầm là tổng đơn vị/toàn công ty.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= node server/scripts/test_smart_nlq_regression.js` OK; test bot thật theo directive 10/10 PASS (2 câu qua, 5 câu vẫn chặn, 3 câu cũ không vỡ).

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ Mức 3:** thêm kiến trúc 3 tầng `nlqEngine` gồm PLANNER (Claude → JSON DSL), EXECUTOR tham số hóa chạy trên dòng doanh thu đã scope quyền, và NARRATOR tiếng Việt không tự tính số.
- Executor hỗ trợ lọc kỳ/ngày/nguồn/tuyến/thực thể, groupBy/topN theo đơn hàng/nguồn/đơn vị/sản phẩm/NV/nhà thầu/tỉnh/tuyến/ngày, split 5 MISA + 5 WEB, so sánh theo nhịp tháng trước, so hôm nay với hôm qua, và chặn NV hỏi ngoài phạm vi.
- Advisory dùng LLM chỉ trên FACTS đã tính: tổng, top sản phẩm/đơn vị/nguồn, đơn vị tăng/giảm theo nhịp; không gửi dòng thô và không để LLM bịa số.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Revenue rollover:** `salesReport.defaultRanges()` nay nhận diện slot doanh thu active mới nhất ngay cả khi kỳ mới chưa có dòng, dùng `data_as_of/dateFrom` để cuộn báo cáo sang tháng mới.
- **Revenue refresh:** tick scheduler ngày 01 tháng mới chốt sổ kỳ vừa đóng đúng 1 lần (`final_close:<ky>`) trước khi materialize kỳ hiện tại; trạng thái lưu `server/data/revenue_refresh_state.json` để restart không chạy lặp.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ fast-path cho câu chắc chắn.** Các intent rõ như `top`, `theo ...`, `overview`, target/comparison/revenue tổng chạy code-first ngay; chỉ gọi `llm.interpretQuery()` cho `unknown`/`entity_drilldown`/`entity_lookup` hoặc câu tự nhiên regex không chắc, giảm trễ cho câu đơn giản.
- **Bỏ hardcode kỳ trong interpretQuery.** `llm.interpretQuery(question, { currentPeriod })` nhận kỳ hiện tại từ App Report; tháng tiếng Anh/không năm suy ra theo năm của `currentPeriod`, không cố định `07.2026`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ LLM interpretQuery theo directive.** Thêm `llm.interpretQuery(question)` để Claude chỉ trả JSON ý định (`metric/dimension/unitHint/productHint/selfScoped/period/listAll`), không gửi số liệu/PII; App Report tự resolve thực thể, giữ scope và tính số bằng code Mức 1.
- **Fix ca NV hỏi tự nhiên/không dấu/tiếng Anh.** Các câu như “doanh thu tại mã đơn vị 001… tôi bán được bao nhiêu”, `001.bvdk dong nai`, và `how much did I sell at Dong Nai hospital in July` trả doanh thu của chính NV tại đơn vị 001; câu mơ hồ “benh vien dong nai” hỏi lại 001/025.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ drill-down mức 1 theo thực thể.** Ưu tiên câu có “ở/tại/của/trong/bên …” hoặc “ai/đơn vị nào bán …” để đào sâu đúng đơn vị/sản phẩm trước khi rơi vào breakdown/ranking chung.
- **Xử lý tên trùng/mơ hồ.** Câu “Đồng Nai/BVĐK Đồng Nai” hỏi lại mã 001/025 thay vì tự đoán; nếu có mã rõ như 001 thì trả chi tiết đúng đơn vị.
- **Giữ quyền & câu cũ.** NV thường chỉ thấy phần mình; “top 5 đơn vị”, “doanh thu theo sản phẩm” vẫn liệt kê toàn bộ như trước.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Tăng an toàn idempotent cho Sales Report.** Ngoài dấu batch theo kỳ/kind, ghi thêm dấu từng người theo `key#emp_code` ngay sau khi gửi thành công; nếu chạy lại sau lỗi giữa chừng sẽ bỏ qua người đã nhận, không gửi trùng hàng loạt.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Gộp kênh gửi Sales Report Email + Telegram.** Lệnh `send-all` và scheduler dùng `notify.deliver()` để gửi email và Telegram khi NV/CEO đã liên kết Telegram.
- **Dry-run recipients có trạng thái Telegram.** `node server/src/salesReport.js recipients` in đủ 17 NV + CEO, ai đã/chưa liên kết Telegram theo `listTelegramMap()`, kèm link `t.me/<bot>?start=<mã>` cho người chưa link.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Wire lịch gửi Sales Report vào Telegram worker.** Scheduler dùng cùng cách so giờ VN như digest hiện tại (`process.env.TZ=Asia/Ho_Chi_Minh`, `vnDate().getUTC*()`), log rõ mốc armed: tuần Thứ 7 13:00 và tháng 18:30 nếu là ngày cuối tháng; có thể tắt bằng `SALES_REPORT_NOTIFY=0`.
- **Thêm idempotent sales report.** Lưu dấu gửi theo `kind + kỳ + range`, restart worker không gửi trùng; CLI/scheduler dùng chung log.
- **Thêm lệnh tay gửi thật:** `node server/src/salesReport.js send-all [week|month]` gửi 17 NV KD + CEO digest, có `--force` nếu cần chạy lại có chủ đích.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa so sánh kỳ trước theo nhịp cho báo cáo điểm/xu.** `prevRange` vẫn lấy trọn tháng trước để đọc được dữ liệu tổng kỳ T01–T06, nhưng các chỉ tiêu so sánh giữa tháng/tuần quy đổi theo `ngày đã trôi / ngày trong tháng`; nhãn email đổi thành “So với nhịp cùng kỳ T06/2026”. Bản cuối tháng giữ full-vs-full.
- **Chạy lại mẫu DN001 sau sửa nhịp.** DN001 T07 đến 09/07: doanh thu `1.169.154.080đ`; T06 full `2.444.530.837đ`; nhịp T06 quy đổi `709.702.501đ`; chênh `+64,7%`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa mẫu email điểm/xu DN001 theo review CEO/Claude.** Email NV đã giấu tên hệ thống/API/bảng/file kỹ thuật; khung nguồn dữ liệu chuyển sang ngôn ngữ nghiệp vụ nội bộ DONAPHARM, bỏ cột “Xu tuần” bị trùng, thêm D/E/G trong mục 9 và chú thích dự báo tháng là sơ bộ/còn biến động.
- **Sửa so sánh kỳ trước không còn 0 giả.** Chẩn đoán `getRows(06.2026, DN001)` có 262 dòng / `2.444.530.837đ`; nguyên nhân do dữ liệu T06 là tổng kỳ, không lọc được ngày lẻ. `salesReport.js` nay dùng trọn tháng trước cho `prevRange` để so sánh không bị rỗng giả.
- **Gửi lại mẫu thật DN001 tuần + tháng cho CEO duyệt.** Đã xuất HTML mới và gửi email test CEO; chưa bật lịch, chưa gửi 17 NV.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Dựng `server/src/salesReport.js` theo directive điểm/xu.** Sinh báo cáo tuần/tháng từng NV KD + CEO digest, lọc người nhận bằng `targetRosterCodes()` và loại `DN021/DN022/DN023/VP004/VP018`; dùng `diemXu.js` cho điểm/xu, số live App Report, text thương hiệu `DONAPHARM`.
- **Nối mục I với nguồn CST App Sale đã duyệt.** Thêm `server/src/appSaleCst.js`: ưu tiên `GET /api/reports/tender-quota` có Bearer token; nếu API 401/chưa cấp token thì dùng cache materialized `server/data/cst_appsale_tender_quota.json` (runtime, không commit). Mục I dùng thẳng `slConLai`, lọc theo đơn vị NV, loại `la_ap_thau`, NCL hiển thị riêng là “dư địa vô hạn”.
- **Gửi mẫu thật DN001 cho CEO duyệt.** Đã xuất HTML tuần + tháng vào `artifacts/sales-report/` và gửi 2 email `[CEO DUYỆT]` tới `trungdangxuan@gmail.com`, SMTP trả OK. `node --check` và `npm --prefix web run build` OK. Chưa bật lịch, chưa gửi 17 NV.

# CHANGELOG & TIẾN TRÌNH — App Report New

> **QUY TRÌNH (đọc trước):** Đây là nhật ký DUY NHẤT ghi lại **mọi thay đổi của app** và **tiến trình hiện tại**.
> - Bot/người đọc repo hãy bắt đầu từ file này để nắm toàn cảnh, rồi đọc tiếp `CLAUDE.md` (bản đồ code) và `HANDOFF.md` (việc còn lại).
> - **Dev chính (Claude Code) BẮT BUỘC ghi 1 mục vào đây cho mỗi thay đổi** (mới nhất ở trên cùng), kèm ngày, việc đã làm, lý do, và trạng thái test.
> - Vai trò: Claude Code = dev chính; Bot server = hỗ trợ môi trường/deploy/tunnel. Tác vụ lớn ảnh hưởng hệ đang chạy phải hỏi bot server trước.

---

## 📍 TRẠNG THÁI HIỆN TẠI — 2026-07-01
- **Giai đoạn:** ĐÃ LIVE tại `https://reportnew.donapharm.asia` (cổng 3873, PM2 `reportnew` + `cloudflared-reportnew`); app cũ `dona-report` cổng 3860 giữ nguyên.
- **Dữ liệu DOANH THU đã THẬT:** import 04/05/06.2026 từ app cũ (T04 34.79 tỷ · T05 30.40 tỷ · T06 28.40 tỷ), đủ đơn vị/SP/nhà thầu/gói thầu. **Cơ số thầu + Target VẪN là dữ liệu mẫu** (nguồn riêng, chưa nối).
- **GitHub:** `donapharm/App-report-new` — nhánh `main`, đồng bộ.
- **✅ ĐĂNG NHẬP OTP THẬT ĐÃ CHẠY + PUBLIC MỞ:** đăng nhập bằng SĐT→OTP (backend nội bộ 3848), demo đã tắt. CEO (role backend `full`→admin) thấy toàn bộ; NV sale chỉ thấy phần mình. Site mở tại `https://reportnew.donapharm.asia` (bảo vệ bằng OTP; Cloudflare Access là tùy chọn phụ, chưa bật).
- **Kế tiếp:**
  1. **Đúng danh sách NV** (vừa fix: Target/Dự báo chỉ lấy NV có doanh thu thật) — bot pull + restart để áp.
  2. **Đồng bộ nốt số liệu từ app cũ:** target thật (`import_targets.js` — cần bot dump nguồn target) + **cơ số thầu** thật (hiện còn mẫu, cần nguồn ORDS/file).
  3. Lấy **đủ dữ liệu từ 01/2026** (importer thư mục đã sẵn).

---

## 🗒️ LỊCH SỬ THAY ĐỔI (mới nhất trên cùng)

### 2026-07-09 (ah) — Claude Code — CEO DUYỆT 2 bản mẫu Điểm/Xu (tuần+tháng) → chốt template + directive bot
- **CEO duyệt cả bản TUẦN và THÁNG** của DN001 (bản "thông minh", có mục 9 A–I). Chốt 2 sửa cuối:
  1. **BỎ câu "toàn công ty đang dư xu"** (câu cũ dư 944,87 xu) — tránh NV ỷ lại tưởng công ty không cần
     chi tiêu xu. Bản NV chỉ nói trạng thái xu **riêng NV**.
  2. **Bản TUẦN cũng có mục 9 "Phân tích thông minh"** (trước chỉ bản tháng có).
  3. Thêm dòng nhắc **"Xu chỉ tính theo QUÝ — sang quý mới reset về 0, không chuyển tiếp"** ở Nguồn dữ liệu.
- **Thêm template chuẩn đã duyệt:** `reference/diemxu_templates/APPROVED_tuan_DN001.html` +
  `APPROVED_thang_DN001.html` (giữ `cid:logo_dona`/`cid:qr_zalo` để bot render dữ liệu live vào).
- **Thêm `DIRECTIVE_SALES_REPORT.md`** giao bot dựng `server/src/salesReport.js` (email tuần/tháng per NV +
  bản CEO tổng hợp, tái dùng `analytics.js` + `diemXu.js`, mục 9 A–I, dự báo `targetPacingMeta`, khai thác
  `cstTable`) + gắn lịch (Thứ 7 13h00 tuần · ngày cuối tháng 18h30 tháng) gửi Telegram + email; loại 5 NV.
- **Cập nhật `SPEC_DIEM_XU_TICH_LUY.md`:** mục 4h (CEO duyệt + khoá layout), mục 5 (checklist triển khai bot),
  chỉnh query `vat.db` mục 4d (chỉ lọc `hidden_at`, **chưa khoá `trang_thai_hd`** tới khi Finance xác nhận).
- **Test:** render 2 bản mẫu (`node --check` generator OK); template giữ cid refs. Chỉ tài liệu +
  template — **không đụng code app đang chạy**. Bước sau: bot dựng `salesReport.js` → chạy mẫu THẬT DN001 →
  CEO duyệt lần cuối → bật gửi cả đội.

### 2026-07-09 (ag) — Claude Code — Đồng bộ MỨC email target với màu biểu đồ (thêm mốc XUẤT SẮC ≥120%)
- **CEO:** biểu đồ NV có mức "xuất sắc ≥120%" nhưng email chỉ có 50/90/100 → thêm mốc email cho khớp.
- **`MILESTONES = [50, 90, 100, 120]`** — thêm **120% = XUẤT SẮC** (mỗi mốc gửi 1 lần/kỳ/NV, chống spam).
- **Email + Telegram cho mốc 120:** màu **tím `#7c3aed`** (khớp biểu đồ), emoji 🌟, huy hiệu "Vượt 120%
  target — Xuất sắc", tiêu đề "Xuất sắc, {tên}!". Telegram: "🌟 XUẤT SẮC! … VƯỢT 120% target".
- **Digest CEO:** NV ≥120% hiện icon 🌟 + màu tím (đồng bộ).
- **Test:** `node --check` OK; render preview email xuất sắc. Chỉ logic app → bot restart (không materialize).


### 2026-07-09 (af) — Claude Code — Biểu đồ Top doanh thu đẹp hơn + bar NV tô màu theo % target
- **CEO giao thiết kế:** làm biểu đồ top đẹp mắt, và tab Nhân viên tô màu theo mức đạt target.
- **TopBarChart nâng cấp:** số **hạng** trước tên, **#1 nổi bật cam**, top 2–3 xanh đậm, còn lại gradient;
  **nhãn tiền + % ngay cuối mỗi thanh**; trục/ lưới nhẹ nhàng hơn; tooltip tiền đầy đủ.
- **Tab Nhân viên — màu theo % đạt target** (CEO gợi ý): `<50%` đỏ · `50–89%` cam · `90–99%` xanh nhạt ·
  `100–119%` xanh · **`≥120%` tím (xuất sắc)**; nhãn hiện **% TG** thay cho % tổng; có **chú thích màu**.
  % lấy từ `/targets` (per-NV) ghép theo `emp_code`. NV thường không mở tab này (chỉ admin).
- Overview + Analysis: truyền `dimension` + `totalRevenue`; gộp `pctTarget` khi tab NV.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ae) — Claude Code — KHÔI PHỤC Top 20 (Tổng quan) + tab "Nhân viên" trong biểu đồ (bị git reset xoá)
- **CEO phát hiện:** hôm qua đã có Top 20 ở Tổng quan + tab Nhân viên trong biểu đồ top, nay MẤT.
- **Điều tra:** Phân tích còn Top 20 (đã trên `main`), nhưng **Tổng quan tụt về Top 10** và **cả 2 trang mất
  tab Nhân viên**. Nguyên nhân: phần này bot làm **local trên server, CHƯA merge `main`** → mỗi lần
  `git reset --hard origin/main` (deploy đợt fix của Claude) **xoá sạch**. Code còn trong nhánh backup
  `origin/bot-server-local-2`.
- **Khôi phục (port sạch sang `main` hiện tại):** Overview lên **Top 20** (`topLimit`) + thêm tab **Nhân viên**
  (admin); Analysis thêm tab **Nhân viên**. `TopBarChart` đã sẵn `limit`/`label` nên render đủ.
- **‼ PHÒNG NGỪA:** bot PHẢI **commit + push (PR lên `main`)** mọi thay đổi app — KHÔNG để local, vì
  auto-deploy `git reset --hard` sẽ xoá. Đây là lần lặp lại của lỗi mất code local.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ad) — Claude Code — FIX thông báo target sai tháng (T06 → phải là THÁNG HIỆN TẠI T07)
- **CEO phát hiện:** bot + email nhắc target/doanh số **tháng 06** trong khi đang là **T07** → sai.
- **Gốc:** `targetNotify.evaluate` mặc định `store.lastCompleteKy()` = tháng hoàn thành gần nhất (T06).
  Scheduler (telegram-bot) gọi không truyền ky → gửi T06.
- **Sửa:** mặc định đổi sang **`store.currentKyByDate()`** (tháng hiện tại theo ngày) cho `evaluate`
  (áp cho mọi thông báo: scheduler, preview, gửi, gửi đích danh, digest CEO) + route `/targets/kpi`.
  Kiểm chứng: `evaluate().ky` = **07.2026** (trước 06.2026). Anti-spam theo key `ky|emp` nên mốc T07 là mới,
  gửi lại đúng.
- **Áp:** chỉ là logic app → **bot RESTART PM2** (reportnew + reportnew-tgbot), KHÔNG cần materialize.


### 2026-07-09 (ac) — Claude Code — Tên nhà thầu MISA ra ĐẦY ĐỦ (khoá join lệch code)
- **Gốc:** MISA dùng `legal_entity_code` dạng `01.DONA`/`02.AFP`, còn `legal_entities.code` là `DONAPHARM`/`AFP`
  → join `le.code = l.legal_entity_code` KHÔNG khớp → rớt về tên ngắn "DONAPHARM"/"AFP PHARMA".
- **Khoá khớp thực tế:** DONA → `legal_entity_name`="DONAPHARM"=`le.code`; AFP → `legal_entity_bucket`="AFP"=`le.code`.
- **Sửa:** thay join bằng **subquery dò `le.code` theo cả `legal_entity_name`/`bucket`/`code`** (LIMIT 1, ưu tiên
  name→bucket→code) → tránh nhân đôi dòng. Ra "Công ty TNHH Dược phẩm Donapharm" / "Công ty TNHH AFP Pharma".
- **Áp:** materialize đổi → **bot chạy lại materialize**. `node --check` OK.


### 2026-07-09 (ab) — Claude Code — Fill Hoạt chất/Hàm lượng/Giá thầu/Ưu tiên từ bảng `products` nguồn
- **Gốc:** 4 cột này trước lấy từ CST (mẫu/chưa đủ) → trống 27–37%. Bot gửi schema `products` có sẵn:
  `active_ingredient`, `strength`, `price`, `tech_rank`.
- **Sửa:** materialize (MISA + partner) lấy thẳng từ `products`: Hoạt chất←`active_ingredient`,
  Hàm lượng←`strength`, Giá trúng thầu←`price`, **Ưu tiên←`tech_rank`** (giả định — mã dạng "H.x" hợp với
  hạng kỹ thuật; **cần bot/CEO xác nhận** sau khi chạy lại: cột Ưu tiên có ra đúng "H.D/H.B" không, nếu sai
  đổi sang `tech_group`/`nhom_dieu_tri`).
- Các cột này gắn vào MỌI dòng doanh thu → không còn phụ thuộc CST mẫu; export điền đủ như Số QĐ.
- **Áp:** materialize đổi → **bot phải CHẠY LẠI materialize** (không chỉ restart). `node --check` OK.


### 2026-07-09 (aa) — Claude Code — Export Doanh thu đầy đủ: thêm cột "Số QĐ" + bỏ chặn Hoạt chất/Hàm lượng
- **CEO phản ánh** file xuất thiếu cột **Số QĐ**, và Hoạt chất/Hàm lượng/Ưu tiên/Giá trúng thầu trống nhiều.
- **Số QĐ:** thêm cột (key `qd`, đã có sẵn từ enrichProductMeta) — QĐ139/QĐ141… suy từ mã QLNB + gói thầu.
- **Hoạt chất/Hàm lượng (trống 37%):** trước bị **chặn chỉ hiện cho QĐ139**; nay ở FILE XUẤT bỏ chặn —
  có trong metaMap là hiện (trang web vẫn giữ như cũ để gọn).
- **CÒN LẠI — Ưu tiên + Giá trúng thầu (trống 27%):** lấy từ nguồn **Cơ số thầu (CST) — vẫn là dữ liệu
  mẫu/chưa nối đủ**; SP bán ra chưa có trong CST → trống. Sửa triệt để: cho materialize lấy từ bảng
  `products`/nguồn thầu (đang chờ schema `products` để wire đúng cột).
- **Test:** xuất file thật, đủ 22 cột, có "Số QĐ". `node --check` OK.


### 2026-07-09 (z) — Claude Code — Thiết kế lại EMAIL thông báo target (HTML + logo + QR Zalo OA)
- **CEO chê email cũ "cùi bắp"** (text trơn). Làm lại thành **email HTML** chỉn chu, an toàn client email
  (bảng + inline style): logo DONAPHARM đầu trang (nền trắng), **thanh tiến độ**, bảng số liệu (doanh thu
  đạt / target / % / còn thiếu / cần/ngày), màu brand **xanh dương** + cam nhấn, **QR Zalo OA** ở chân trang,
  footer "email tự động".
- **Ảnh nhúng kiểu CID** (Gmail chặn data-URI): `notifyChannels` đính kèm `web/public/logo-dnpharma.png` +
  `zalo-oa-qr.png` với cid `dnpharma-logo`/`dnpharma-zalo`; html tham chiếu `src="cid:..."`.
- **3 mẫu:** sự kiện milestone/behind (`emailHtmlFor`), trạng thái đích danh (`emailHtmlForStatus` qua
  `statusFor`), tổng hợp CEO (`ceoDigestHtml`). Telegram vẫn giữ TEXT (`messageFor` không đổi).
- `notifyChannels.sendEmail/deliver` thêm tham số `html`; routes + telegram-bot truyền html qua.
- **Cho dễ hiểu (CEO giao tự quyết):** thêm **huy hiệu kết quả** to rõ ("✓ Đã đạt 100%" / "Đã đạt 90%
  target" / "⚡ Cần tăng tốc") + **nút "Xem báo cáo chi tiết →"** mở thẳng app (`APP_PUBLIC_URL`, mặc định
  reportnew.donapharm.asia). Digest CEO có nút "Xem toàn bộ báo cáo".
- **Trạng thái:** `node --check` toàn bộ OK; đã render preview. CEO giao tự quyết → chốt bản này, merge deploy.


### 2026-07-08 (y) — Claude Code — Lọc tỉnh theo cột `units.province` + sửa tên đối tác partner
- **Lọc tỉnh/vùng (gốc lỗi):** `province.js` đoán tỉnh theo TÊN đơn vị → sai (vd "033.PKĐK AN NGÃ TƯ
  VŨNG TÀU" tên có "Vũng Tàu" nhưng `units.province` thật = **ĐỒNG NAI**). Sửa: materialize lấy
  `units.province` gắn vào từng dòng (MISA join `units ON u.code=l.unit_code`; partner đã có join units).
  Store ưu tiên `row.province` → lọc tỉnh giờ theo ĐÚNG mã tỉnh, không đoán tên nữa.
- **Tên đối tác (partner):** `legal_entities.name` của partner thường là nhóm rác **"Đối tác khác"** →
  ưu tiên **`contractors.name`** (tên đối tác thật): `COALESCE(NULLIF(NULLIF(le.name,''),'Đối tác khác'),
  NULLIF(c.name,''), '')`. (Đảo lại logic #78 vốn ưu tiên le.name.)
- **Tên MISA đầy đủ (đã xong):** `legal_entities` có cột `code` → join `le.code = l.legal_entity_code`,
  `contractor_name = COALESCE(NULLIF(le.name,''), l.legal_entity_name)` → ra "Công ty TNHH Dược phẩm
  Donapharm" thay vì "DONAPHARM". (Xác nhận: partner như Tự Đức/Tuệ Nam có `contractors.name` là tên đầy
  đủ, `legal_entity_id=4`="Đối tác khác" nên fix partner ưu tiên c.name là đúng.)
- **Test:** `node --check` OK. Cần bot chạy lại materialize để áp province + tên nhà thầu (MISA + partner).


### 2026-07-08 (x) — Claude Code — Tên pháp nhân đầy đủ cho nhà thầu WEB/đối tác (đưa fix của bot vào git)
- **Bối cảnh:** MISA đã có tên pháp nhân đầy đủ (`legal_entity_name`), nhưng nhánh WEB/partner chỉ lấy
  `contractors.name` (tên ngắn). Bot đã tìm đúng schema và sửa **trực tiếp trên server** rồi chạy lại T07
  (slot `rev_2src_072026_20260708234245`, tổng 13.528.199.293đ, **đối soát Sale-New ✅ KHỚP**).
- **Vì sao Claude commit vào git:** bot sửa ở BẢN LÀM VIỆC trên server; `main` chưa có → auto-deploy
  (`git reset --hard origin/main`) sẽ **xóa mất** đoạn sửa ở lần deploy kế. Đưa vào repo để giữ vĩnh viễn.
- **Fix (đúng schema bot xác nhận — DB KHÔNG có `c.legal_name`, `contractors` có `legal_entity_id`):**
  - `contractor_name`: `COALESCE(NULLIF(le.name,''), c.name, '')` — ưu tiên tên pháp nhân, fallback tên contractor.
  - Thêm `LEFT JOIN legal_entities le ON le.id=c.legal_entity_id`.
- **Trạng thái test:** `node --check` OK (không chạy DB ở đây). Bot đã xác nhận chạy thật T07 khớp.

### 2026-07-08 (w) — Claude Code — Export doanh thu: chốt bộ cột theo CEO
- Theo CEO chốt: **bỏ cột Đơn giá** (chỉ giữ "Giá trúng thầu"); **ĐVT → "Đơn vị tính"** (ghi rõ);
  giữ **STT** ở cột đầu; **thêm cột "Ghi chú" ở cuối** (để trống cho kế toán ghi tay).
- 21 cột: STT · Kỳ · Ngày · Mã NV · Tên NV · Tuyến · Mã đơn vị · Tên đơn vị · Mã QLNB · Sản phẩm ·
  Hoạt chất · Hàm lượng · Đơn vị tính · Mã nhà thầu · Tên nhà thầu · Gói thầu · Ưu tiên · Giá trúng thầu ·
  Số lượng · Doanh thu · Ghi chú. Vẫn giữ định dạng kế toán VN + in A4 ngang lề ~1.5cm.
- **Test:** xuất file thật, đọc lại: đúng 21 cột, STT đầu, không còn Đơn giá, có Đơn vị tính, Ghi chú cuối.

### 2026-07-08 (v) — Claude Code — Export doanh thu: thêm Đơn giá, tên nhà thầu đầy đủ, in A4 ngang lề sát
- **CEO bổ sung:** (a) tên nhà thầu phải **đầy đủ** (vd "Công ty TNHH Dược phẩm DONAPHARM"); (b) **thiếu cột
  Đơn giá**; (c) in ra **A4 ngang vừa đủ, lề ~1.5cm cho sát**.
- **(a)** Materialize MISA nay ghi `contractor_name = legal_entity_name` (tên pháp nhân đầy đủ) vào từng dòng;
  `contractorNameFor` ưu tiên tên có sẵn nên tên đầy đủ được giữ nguyên qua enrich. (Cần bot chạy lại
  materialize để dòng MISA có tên; dòng partner đã có tên từ bảng contractors.)
- **(b)** Thêm cột **"Đơn giá" (unit_price)** cạnh "Giá trúng thầu" — đơn giá bán thực tế mỗi dòng.
- **(c)** `styleAccountingSheet` set `pageSetup`: khổ **A4**, **ngang (landscape)**, co vừa **1 trang chiều
  ngang** (fitToWidth=1), **lề 0.59in (~1.5cm)** cả 4 phía, **lặp dòng tiêu đề** mọi trang, canh giữa ngang,
  đánh số trang ở footer.
- **Chờ CEO:** gửi thứ tự cột mong muốn → em sắp lại + tinh chỉnh độ rộng để in A4 ngang đọc rõ (bớt cột thừa
  thì chữ in càng to).
- **Test:** xuất file thật, đọc lại: có cột Đơn giá, `pageSetup` A4/landscape/fitToWidth/margin 0.59/printTitles OK.

### 2026-07-08 (u) — Claude Code — XUẤT EXCEL "Doanh thu đầy đủ": tên nhà thầu + nhiều NV + chuẩn kế toán VN
- **CEO phản ánh 3 điểm ở tab "Doanh thu đầy đủ":** (1) file Excel thiếu **tên nhà thầu**; (2) chỉ lọc/xuất
  được **1 NV**, muốn chọn **nhiều NV**; (3) muốn **định dạng chuẩn kế toán VN**.
- **(1) Tên nhà thầu:** export cũ dùng `store.getRows` thô + cột "Nhà thầu" chỉ ghi *mã*. Nay export
  **enrich giống hệt trang** (`contractorLookup` + `enrichContractorNames` + `enrichProductMeta`) → thêm cột
  **"Tên nhà thầu"** (kèm "Mã nhà thầu"), và bổ sung đủ trường: Ngày, Hoạt chất, Hàm lượng, ĐVT, Ưu tiên,
  **Giá trúng thầu**, STT. File xuất giờ khớp 100% dữ liệu đang xem trên trang.
- **(2) Nhiều NV:** ô lọc NV đổi từ chọn-đơn → **chọn-nhiều** (MultiSelect, chung `revenueFilters`); backend
  `applyFilters` nhận `emp` là danh sách nối `|` (1 hay nhiều mã đều được, để trống = tất cả NV). Đã test:
  `emp=DN001|DN002` → chỉ 2 NV; không lọc → đủ 12 NV.
- **(3) Chuẩn kế toán VN:** helper `styleAccountingSheet` — số nhóm nghìn `#,##0`, **âm trong ngoặc đỏ**,
  canh phải; tiêu đề đậm nền xanh + **freeze dòng tiêu đề** + **AutoFilter**; thêm dòng **TỔNG CỘNG** (in đậm)
  cộng Số lượng/Doanh thu.
- **Trạng thái test:** dựng server thật + xuất file, đọc lại bằng ExcelJS: đủ 20 cột, đúng numFmt, freeze,
  autofilter, tổng cộng, lọc nhiều NV đúng. Web build OK. (Tên nhà thầu trống trên dữ liệu MẪU vì mẫu chưa
  map tên NCC — trên production trang & file đều hiện tên như nhau.)

### 2026-07-08 (t) — Claude Code — CÔNG CỤ ĐỐI SOÁT Report-New ↔ Sale-New (tự phát hiện lệch)
- **Lý do (CEO yêu cầu sau vụ DN009):** không đợi NV báo mới biết mất dữ liệu — phải TỰ phát hiện lệch
  theo từng NV/kỳ.
- **`server/src/reconcile.js` (mới):** đối soát toàn vẹn 1 kỳ trên dữ liệu Report-New (KHÔNG cần DB), đọc
  file slot GỐC (trước khi kéo biên) để bắt đúng dấu vân tay lỗi:
  1) `dateOutOfBand` — dòng có ngày ngoài [dateFrom,dateTo] (đúng ca 01/07→30/06);
  2) `metaMismatch` — số dòng/doanh thu metadata ≠ thực tế file;
  3) `duplicateLines` — trùng `source_line_id`;
  4) `unitDrop` — theo từng NV, đơn vị có doanh thu kỳ trước nhưng biến mất kỳ này (cảnh báo sớm kiểu DN009).
- **API `GET /admin/reconcile?ky=` (admin):** trả JSON đối soát để hiển thị/đẩy cảnh báo.
- **Web:** thêm tab **“Đối soát dữ liệu”** trong trang Upload (admin) — chọn kỳ → xem lệch ngay.
- **`server/scripts/reconcile_revenue.js` (mới, chạy trên server bot):** Lớp 1 (như trên) + **Lớp 2** DỰNG
  LẠI doanh thu từ **nguồn Sale-New** bằng chính truy vấn của materialize (require lại, KHÔNG chạy
  materialize) rồi đối chiếu per (NV, đơn vị): thiếu ở Report-New / lệch doanh thu / dư ở Report-New.
  `materialize_july_revenue.js` được bọc `require.main===module` + export hàm để tái sử dụng an toàn.
- **Trạng thái test:** `node --check` toàn bộ OK; web build OK; test tái hiện DN009 (2 dòng 30/06 +
  meta lệch + dòng trùng) → tool bắt đủ. Lớp 2 cần chạy trên server bot có DB Sale-New.

### 2026-07-08 (s) — Claude Code — TÌM ĐÚNG GỐC LỖI NGÀY 01/07→30/06 (fix tại nguồn materialize)
- **Bối cảnh:** Sếp bác bỏ cách "kéo về biên kỳ" (mục r) vì đó chỉ là **vá triệu chứng**, yêu cầu tìm
  **đúng chỗ sinh ra ngày sai**. Dữ liệu Sếp cung cấp: 11 dòng 034 Y ĐỨC HEALTHCARE đều `source: CRM_MISA`,
  `date: "2026-06-30"`, nằm trong file `ky: 07.2026` (order DH479815515, MISA:16889…).
- **GỐC LỖI (đã chứng minh):** `server/scripts/materialize_july_revenue.js` dòng 39:
  `dateOnly(v) = new Date(v).toISOString().slice(0,10)`.
  - `misa_revenue_snapshot_lines.revenue_date` là kiểu **DATE = 01/07** (nên vẫn LỌT qua bộ lọc SQL
    `revenue_date >= '2026-07-01'::date` → có mặt trong file T07).
  - node-postgres đọc DATE thành **nửa đêm giờ máy** → trên server VN (GMT+7) là
    `2026-07-01T00:00:00+07` = `2026-06-30T17:00:00Z`.
  - `.toISOString()` quy về **UTC** rồi cắt 10 ký tự → ra **`2026-06-30`**. Vì DATE luôn là nửa đêm nên
    **TẤT CẢ** dòng bị lùi đúng 1 ngày (giải thích vì sao cả 11 dòng đều 30/06, không phải vài dòng).
  - Sau đó `store.js` lọc theo `dateFrom=01/07` → rớt sạch khỏi Report-New T07.
- **Đã sửa (tại nguồn):**
  1. `dateOnly()` lấy ngày theo **giờ VN** bằng `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok'})`,
     KHÔNG dùng `toISOString()`. Kiểm chứng: `pg DATE 01/07 → CŨ=2026-06-30, MỚI=2026-07-01` (đúng).
  2. Nhánh WEB partner: các cast `timestamptz::date` (`o.created_at`, `resp.responded_at`,
     `resp.updated_at`) đổi sang `(x AT TIME ZONE 'Asia/Bangkok')::date` để không lệch ngày với đơn
     đầu giờ sáng khi session DB chạy UTC.
- **Cách áp:** bot `git reset --hard origin/main` + chạy lại materialize (hoặc chờ scheduler) → dữ liệu
  MISA T07 sẽ mang đúng ngày 01/07. "Kéo về biên kỳ" (mục r) giữ lại làm **lưới an toàn có log**, gần như
  không còn phải kích hoạt sau fix này.
- **Trạng thái test:** `node --check` OK; unit-test tái hiện lỗi cũ + xác nhận fix trên máy TZ=Asia/Ho_Chi_Minh.
  Cần bot chạy lại materialize thật để xác nhận DN009 = 12 đơn vị.

### 2026-07-08 (r) — Claude Code — FIX MẤT DOANH THU: không bỏ dòng "ngày gán sai", kéo về biên kỳ
- **Triệu chứng (NV DN009 phát hiện):** DN009 tháng 7 chỉ ra 9 đơn vị thay vì 12; thiếu 034 Y ĐỨC
  HEALTHCARE + TRỊ AN. Sale-New CÓ, Report-New KHÔNG.
- **Điều tra:** file materialize T07 CÓ đủ các dòng đó (Healthcare 11, Trị An 6) nhưng **ghi ngày
  2026-06-30**. `store.js slotRows` (fix #70) lọc BỎ mọi dòng ngày < dateFrom(01/07) → rớt sạch.
  Mà **go-live 01/07 + NV xác nhận + Sale-New đều 01/07** → ngày 30/06 là **GÁN SAI ở nguồn** (lệch
  múi giờ), KHÔNG phải doanh thu tháng 6. Không có file materialize T06 → không lo tính trùng.
- **Sửa:** `slotRows` **KHÔNG bỏ dòng nữa** (mất doanh thu âm thầm là cực nguy hiểm) — thay bằng **KÉO
  ngày sai về đúng biên kỳ** (30/06 → 01/07) + **GHI LOG** số dòng đã kéo (minh bạch, không im lặng).
- **Còn lại (bot):** sửa GỐC ở **materialize** — chuẩn hoá ngày về **giờ VN (GMT+7)/ngày bán Sale-New**
  để nguồn không còn ngày lệch.
- **File:** `server/src/store.js`. Test: store nạp OK, số mẫu không đổi, regression PASS.


### 2026-07-08 (q) — Claude Code — TÍCH HỢP ROUTER NLQ (hết "bơi ngáo") + gỡ khóa cứng T07
- **Việc lớn:** thay mớ ~30 regex intent xếp chồng (dễ lạc ý, vá chỗ này lòi chỗ kia) bằng **router
  phân loại ý định** `nlqIntent.js` (bot server xây, đã review). Router quyết intent RÕ RÀNG trước
  (sensitive/ranking/breakdown/overview/target/comparison/revenue…) rồi mới tới tra cứu/help.
- **Sửa lỗi trong ảnh CEO:** "báo cáo chi tiết các **mã hàng** có doanh thu cao" nay ra **báo cáo sản
  phẩm** (trước bị nhầm thành "tra cứu 1 thuốc" → "không tìm thấy"). "lấy **tất cả** mã qlnb" cũng ra
  báo cáo (thêm "tất cả/toàn bộ" vào tín hiệu liệt kê của router).
- **GỠ khóa cứng T07:** `employeeRevenueLocked=false` — T07 đã đúng (gom nhóm chuẩn + fix lọc ngày slot)
  và đã có nhãn "dữ liệu tới ngày DD/MM". NV giờ xem được số T07 của mình.
- **GIỮ trọn** tính năng của Claude: tra cứu đích danh thuốc/đơn vị (web `/lookup` dùng), buildFacts giàu
  cho LLM, và 3 fix mới nhất được ghép lại: **#71** chống lặp nhãn đơn vị, **#72** báo "tháng chưa có số",
  **#73** nhãn "dữ liệu tới ngày".
- **Test:** `scripts/test_smart_nlq_regression.js` (viết lại, chạy được cả mẫu lẫn server) — PASS:
  top đơn vị/NV, báo cáo sản phẩm, chặn nội dung nhạy cảm, NV không xem NV khác, tháng chưa có số, NV
  xem số của mình. Các ca của Claude (tra cứu, cơ số, exports web) đều OK.
- **File:** `server/src/smart.js`, `server/src/nlqIntent.js` (mới), `server/scripts/test_smart_nlq_regression.js`.
- **Phân công từ nay:** bot server phát triển tiếp NLQ trên `nlqIntent.js`; Claude review + tích hợp.
  `bot-server-local` giữ làm mốc.


### 2026-07-08 (p) — Claude Code — Nhãn "dữ liệu tới ngày DD/MM" cho kỳ đang cập nhật (web + bot)
- **Mục đích:** chặn hiểu nhầm "thiếu đơn vị/số" khi kỳ đang xem là THÁNG ĐANG CHẠY (chưa đủ ngày).
  Nhìn phát biết kỳ đã đủ hay đang nạp tiếp.
- **Backend:** `store.periodFreshness(ky)` — tính dữ liệu tới ngày nào (chỉ với kỳ có dữ liệu THEO NGÀY;
  kỳ tổng-tháng coi như đủ). `/periods` trả kèm `throughDate/dayCovered/daysInMonth/complete`.
- **Web:** `PeriodFilter` hiện dòng "📅 Dữ liệu tới DD/MM · X/Y ngày — kỳ đang cập nhật" khi tháng chưa đủ.
- **Bot:** câu trả lời có số (top/báo cáo/doanh thu/chi tiết) tự thêm dòng "📅 Dữ liệu tới DD/MM (X/Y ngày)"
  khi kỳ chưa đủ. Kỳ đã đủ (tổng tháng) thì KHÔNG thêm (tránh nhiễu).
- **File:** `server/src/store.js`, `server/src/routes.js`, `server/src/smart.js`,
  `web/src/pages/PeriodFilter.jsx`, `web/src/styles.css`.


### 2026-07-08 (o) — Claude Code — FIX bot lặng lẽ trả kỳ khác khi hỏi tháng CHƯA có dữ liệu
- **Triệu chứng:** NV hỏi "doanh số từ đầu tháng 8 đến hôm nay" (T8 chưa có số) → bot **lặng lẽ lấy kỳ
  mới nhất (T7)** rồi trả danh sách → NV tưởng là số tháng 8, thấy "thiếu đơn vị" (thực ra là số T7).
- **Nguyên nhân:** `answerQuestion` dùng `resolveKyFromQuestion(q) || store.latestKy()` — khi tháng
  người hỏi không có dữ liệu thì rơi về kỳ mới nhất, không báo gì.
- **Sửa:** thêm `monthMention(q)` — nếu người hỏi **nêu rõ 1 tháng** mà kỳ đó **chưa có dữ liệu** →
  trả thẳng "Kỳ MM.YYYY chưa có dữ liệu" + liệt kê các kỳ đang có số. Câu không nêu tháng vẫn dùng kỳ
  mới nhất như cũ.
- **Test:** "tháng 8.2026"/"tháng 12" → báo chưa có dữ liệu; "tháng 6"/"kỳ này"/"top 10 đơn vị" → bình thường.
- **File:** `server/src/smart.js`.


### 2026-07-08 (n) — Claude Code — Fix nhãn đơn vị bị LẶP ĐÔI trên Telegram (data T07)
- **Triệu chứng:** bot ghi "002.BVĐK Thống Nhất ĐN**.BVĐK Thống Nhất ĐN**" (lặp 2 lần).
- **Nguyên nhân:** data T07 có `unit_code` chứa cả tên ("034.PKĐK Y ĐỨC") còn `unit_name` chỉ là tên
  ("PKĐK Y ĐỨC") → `unitText` backend ghép thành `code.name` bị lặp. (Frontend `util.js` ĐÃ có chống
  lặp; backend `smart.js` thiếu.)
- **Sửa:** thêm vào `unitText` (smart.js) đúng guard như frontend: `if (/^\d{3}\./.test(c) && c.includes(nm)) return c;`
- **LƯU Ý (không phải lỗi):** việc "thiếu đơn vị 034 ở T07" KHÔNG do lệch mã — `unit_code` T06=T07 giống
  nhau, gom nhóm ĐÚNG. Các ĐV đó **chưa bán ở T07** (đầu kỳ); màn web so là **T06 đã hoàn tất**.
- **File:** `server/src/smart.js`.


### 2026-07-08 (m) — Claude Code — Cherry-pick 2 fix DỮ LIỆU từ bot-server-local
- **Bối cảnh:** bot server làm song song 1 nhánh (`bot-server-local`, 5 commit). Sau khi soi + thống nhất
  với bot: **8b09419** trùng fix #68 (bỏ), **b1d29f6** khóa cứng T07 (KHÔNG merge — dễ chặn nhầm),
  router NLQ (50740f1/7da6b7c) để review sau. Chỉ lấy 2 fix dữ liệu thật sự còn thiếu:
  - **store.js `slotRows`:** lọc theo ngày của slot — chặn invoice 30/06 lọt nhầm vào materialize T07
    (đây là GỐC khiến số T07 sai; fix đúng chỗ này thì không cần khóa cứng tháng 7).
  - **llm.js:** thêm ràng buộc đơn vị tiền cho LLM (231.000.000đ = 231 triệu, KHÔNG phải 231 tỷ).
- **Kỹ thuật:** đã xác minh 2 file chỉ khác đúng phần fix (store.js 1 hunk `slotRows`, llm.js 1 dòng),
  không đụng memo-hoá/logic khác của main. `bot-server-local` giữ làm backup cho router NLQ.
- **File:** `server/src/store.js`, `server/src/llm.js`.


### 2026-07-08 (l) — Claude Code — Bot: "báo cáo chi tiết" ra nhiều phần + "tất cả mặt hàng" + từ "mặt hàng"
- **Báo cáo chi tiết:** câu "báo cáo doanh thu **chi tiết**" (không nêu chiều) trước chỉ ra **1 dòng tổng**
  → nay ra **nhiều phần**: doanh thu + %target + **top 5 sản phẩm** + **top 5 đơn vị** + gợi ý xem đầy đủ.
- **"Tất cả mặt hàng":** khi có "tất cả/toàn bộ/đầy đủ/chi tiết" thì liệt kê tới **50 mục** (thay 15),
  LUÔN kèm **tổng số** + gợi ý xuất Excel (tin Telegram giới hạn độ dài).
- **Fix từ khóa:** nhận diện **"mặt hàng"** (trước chỉ "sản phẩm/mã hàng").
- **File:** `server/src/smart.js`.
- **⚠ GHI CHÚ:** phát hiện bot server chạy **code KHÁC `main`** (bot ghi "15 **mục đầu**" + nhận "mặt hàng"
  — cả 2 KHÔNG có trong repo) → server có **sửa tay chưa commit** → cây git dirty → **auto-deploy bị chặn**
  → #64–#68 (kể cả fix "top 10") CHƯA lên. Cần đội bot **commit bản sửa tay vào main**.

### 2026-07-08 (k) — Claude Code — FIX bot: "top 10" bị hiểu nhầm thành tra cứu đơn vị "010"
- **Triệu chứng:** Hỏi "những đơn vị nào nằm trong top 10" → bot trả tra cứu đơn vị **010.BV Quân Y 7B**
  (0đ) thay vì danh sách top đơn vị.
- **Nguyên nhân:** intent tra-cứu-đích-danh (khớp "doanh thu…đơn vị") chạy trước "top đơn vị", rồi khớp
  nhầm đơn vị mã "010" vì câu có " 10 " (từ "top 10").
- **Sửa:** thêm cờ `rankingLike` — câu dạng xếp hạng/liệt kê (`top`, `nào`, `cao nhất`, `nhiều nhất`,
  `bán chạy`…) KHÔNG kích hoạt tra cứu đích danh (thuốc + đơn vị), nhường cho intent "top…". Bổ sung
  "bán chạy" vào mẫu "top đơn vị".
- **Giữ nguyên:** "BV007 ai bán", "đơn vị BV001 bán được bao nhiêu", "giá thầu B02", "doanh thu thuốc E05"
  vẫn ra tra cứu đích danh đúng (đã test).
- **File:** `server/src/smart.js`.

### 2026-07-08 (j) — Claude Code — Thông báo target: bảng "Trạng thái sẵn sàng" (biết còn thiếu gì để bật)
- **Việc:** Màn Quản target → Thông báo (xem trước) thêm card **⚙️ Trạng thái sẵn sàng gửi tự động**:
  - Tự động BẬT/TẮT (`TARGET_NOTIFY`), kênh **Telegram** sẵn sàng chưa, kênh **Email (SMTP)** sẵn sàng chưa.
  - Bao nhiêu NV **liên hệ được** (đã map Telegram / có email) trên tổng danh sách, bao nhiêu **bị chặn** (opt-out).
  - Nếu chưa NV nào liên hệ được → gợi ý cụ thể (NV nhắn bot để map / cấu hình SMTP).
- **Lý do:** Bật gửi tự động phụ thuộc 3 thứ cấu hình NGOÀI (env `TARGET_NOTIFY=1`, NV map Telegram, SMTP).
  Card này cho CEO thấy NGAY còn thiếu gì thay vì "bật rồi không ai nhận".
- **Backend:** `/admin/notifications/preview` trả thêm `readiness`.
- **File:** `server/src/routes.js`, `web/src/pages/Target.jsx`.
- **Còn lại (ops, ngoài code):** để gửi tự động chạy thật cần bot đặt `TARGET_NOTIFY=1`, NV nhắn bot để map
  Telegram, và (nếu gửi email) cấu hình SMTP. Gửi TAY ("Gửi ngay/Gửi thử/Gửi 1 NV") đã dùng được ngay
  cho ai đã có kênh.

### 2026-07-08 (i) — Claude Code — Cơ số thầu: sắp theo "cơ hội" + KPI tiền đang để trống
- **Việc:** Màn Cơ số thầu thêm:
  - Nút sắp xếp **💰 Cơ hội (TT còn)** — xếp theo TT còn (SL còn × giá thầu) lớn nhất, để CEO thấy ngay
    tiền đang để trống; ở chế độ gom-đơn-vị thì đơn vị có TT còn lớn nhất lên đầu.
  - KPI **💰 TT chưa khai thác** = tổng TT còn của các dòng CHƯA bán (sold=0) + số dòng chưa bán.
  - (Cột **Giá trúng thầu** và filter **Chưa bán** = còn 100% chưa khai thác đã có sẵn từ trước.)
- **File:** `web/src/pages/TenderQuota.jsx` (sortBy 'action'|'opportunity'|'none' + KPI untapped).
- **Test:** build web OK.

### 2026-07-08 (h) — Claude Code — Tra cứu nhanh TRÊN WEB (thuốc/mã QLNB/đơn vị) có thẻ kết quả
- **Việc:** Trang "Hỏi nhanh" thêm ô **🔎 Tra cứu nhanh** — gõ tên thuốc / mã QLNB / mã-tên đơn vị →
  hiện **thẻ kết quả có cấu trúc**: thuốc (doanh thu, giá thầu, cơ số còn lại, đơn vị đang bán),
  đơn vị (doanh thu, AI bán, top sản phẩm). Không phải đọc chat như trước.
- **Backend:** route `GET /lookup?q=&ky=` (scoped) tái dùng `smart.lookupProducts/lookupUnits` (đã export).
- **Quyền:** cùng `scope` — NV chỉ thấy phần của mình ("Bạn bán"); admin thấy tất cả.
- **File:** `server/src/smart.js` (export), `server/src/routes.js` (route `/lookup`), `web/src/api.js`,
  `web/src/pages/AiChat.jsx` (LookupPanel + thẻ), `web/src/styles.css`.
- **Test:** node harness lookup ra đúng + kín quyền; build web OK.

### 2026-07-08 (g) — Claude Code — DỨT ĐIỂM deploy kẹt: bỏ track output materialize
- **Việc:** `.gitignore` thêm `artifacts/*materialize*` + `git rm --cached` 4 file materialize doanh thu
  (bot tự sinh lại mỗi kỳ). Từ nay bot sinh file thoải mái, working tree KHÔNG dirty → auto-deploy
  không còn bị kẹt (đã 2 lần hôm nay phải `git stash` tay).
- **An toàn:** app KHÔNG đọc `artifacts/` (đã kiểm tra grep server/) — chỉ là output phân tích; file
  vẫn còn trên đĩa server, chỉ thôi track trong git.
- **File:** `.gitignore` (+ untrack 4 file materialize).

### 2026-07-08 (f) — Claude Code — Phân tích: Top 20 + biểu đồ tròn hiện số tiền rút gọn & %
- **Top doanh thu:** màn Phân tích nâng từ Top 10 → **Top 20** (Overview giữ Top 10). `TopBarChart`
  thêm prop `limit` (mặc định 20) để nâng trần mà không ảnh hưởng chỗ gọi khác.
- **3 biểu đồ tròn (Tuyến / Nhà thầu / Gói thầu):** hiện **% ngay trên lát bánh** (lát ≥7% cho đỡ rối)
  và **chú thích kèm số tiền rút gọn + %** (vd "NCL  1,23 tỷ · 62%") — đọc nhanh không cần rê chuột.
- **File:** `web/src/charts.jsx` (TopBarChart limit, DonutChart nhãn % + legend tiền/%) ,
  `web/src/pages/Analysis.jsx` (slice 20 + tiêu đề "Top 20").
- **Test:** build web OK.

### 2026-07-08 (e) — Claude Code — Phân tích: thêm 2 ô cho cân hàng dưới (chưa khai thác + biến động tuyến)
- **Việc:** Hàng panel dưới của màn Phân tích trước chỉ có 2 ô (SP cần đẩy mạnh, SP sắp hết CST) → trống
  2 ô. Bổ sung đúng 2 ô (theo gợi ý CEO):
  - **🆕 SP chưa khai thác (còn 100% CST):** mặt hàng đã trúng thầu nhưng kỳ này CHƯA bán viên nào
    (sold_qty=0, còn nguyên cơ số) — cơ hội để trống, sắp theo số lượng còn lại giảm dần.
  - **🛣️ Biến động theo tuyến (so kỳ trước):** mỗi tuyến tăng/giảm bao nhiêu so kỳ trước, sắp theo
    mức chênh lệch tuyệt đối lớn nhất.
- **Backend `/analysis`:** thêm `cstUntouched` (cstTable status=empty) + `routeDelta` (compareGroup theo
  route trên 2 kỳ so sánh). Cùng chịu bộ lọc + phạm vi quyền như phần còn lại.
- **File:** `server/src/routes.js`, `web/src/pages/Analysis.jsx`.
- **Test:** node harness — routeDelta ra đúng (Tuyến A +25.8%…); cstUntouched=0 trên dữ liệu MẪU vì seed
  không có mặt hàng chưa bán (đúng — server thật sẽ có). Build web OK.

### 2026-07-08 (d) — Claude Code — FIX Phân tích: "tăng mạnh/giảm mạnh" bị lẫn lộn tăng với giảm
- **Triệu chứng:** Màn Phân tích, mục "Đơn vị giảm mạnh" lại có dòng TĂNG (+37%, +117%…) và mục
  "Đơn vị tăng mạnh" lại lòi ra dòng GIẢM (−28%).
- **Nguyên nhân:** `/analysis` chỉ lọc `prevRevenue>0` rồi sort theo `delta` và lấy top 10. Khi số đơn
  vị giảm < 10, danh sách "giảm" lấy bù bằng đơn vị TĂNG (và ngược lại) → lẫn lộn.
- **Sửa:** lọc đúng chiều — "tăng mạnh" chỉ `delta > 0`, "giảm mạnh" chỉ `delta < 0` (áp cho cả đơn vị
  và sản phẩm). Đã test dữ liệu mẫu: 0 dòng lẫn ở cả 2 danh sách.
- **File:** `server/src/routes.js` (route `/analysis`).

### 2026-07-08 (c) — Claude Code — FIX bot đòi mã RP hoài (map Telegram lệch giữa 2 tiến trình)
- **Triệu chứng:** CEO nhắn hỏi bot nhưng bot chỉ trả "Gửi mã đăng nhập dạng RP-XXXXXX…", không
  trả lời — dù trước đó đã nhận được digest (tức đã từng có trong map).
- **Nguyên nhân gốc:** `auth.js` giữ map Telegram trong RAM (`let tgMap` nạp 1 lần lúc khởi động).
  Backend `reportnew` và worker `reportnew-tgbot` là **2 TIẾN TRÌNH riêng** → thêm map ở tiến trình
  này thì tiến trình kia KHÔNG thấy (worker cứ đòi mã RP; digest sót), và 2 bên có thể **ghi đè** map
  của nhau bằng bản RAM cũ (mất map).
- **Sửa:** map Telegram nay lấy **FILE `data/auth/telegram_map.json` làm nguồn sự thật** — đọc thẳng
  file mỗi lần `resolveTelegram/listTelegramMap`, và `add/removeTelegramMap` dùng read-modify-write.
  Không còn RAM lệch, không còn ghi đè. (Đã test: tiến trình A ghi → tiến trình B thấy ngay + không mất.)
- **UX:** khi tài khoản CHƯA liên kết, bot trả về **mã Telegram (id)** của người hỏi để CEO/admin
  liên kết nhanh (thay vì câu cụt "gửi mã RP").
- **File:** `server/src/auth.js`, `server/telegram-bot.js`.
- **Việc còn lại (ops):** nếu file map trên server đang trống, cần thêm lại 1 dòng cho CEO
  (`auth.addTelegramMap('<telegram_id>','<mã CEO>','ceo')` hoặc route `POST /api/admin/telegram-map`).
  Sau fix này worker **không cần restart** vẫn nhận map mới.

### 2026-07-08 (b) — Claude Code — Bot TRA CỨU ĐÍCH DANH ĐƠN VỊ (bán bao nhiêu + AI bán)
- **Việc:** Hỏi theo MỘT đơn vị cụ thể (mã hoặc tên): **bán được bao nhiêu**, **AI bán** (NV nào),
  **top sản phẩm tại đơn vị**, số dòng cơ số + số sắp cạn. Nhận diện đơn vị theo mã (BV007), theo
  số (kể cả bỏ số 0: "17"→"017") và theo từ đặc trưng của tên.
- **Sửa xung đột:** câu "đơn vị X bán được **bao nhiêu**" trước đây bị mẫu "top đơn vị" bắt nhầm
  (vì "bao **nhiêu**" khớp "nhiều") → đã đưa các intent TRA CỨU ĐÍCH DANH (thuốc + đơn vị) lên TRƯỚC
  các mẫu "top…".
- **Quyền:** "ai bán" chỉ liệt kê trong `scope` — NV thường chỉ thấy CHÍNH MÌNH ("Bạn bán"); admin
  thấy tất cả NV bán ở đơn vị đó. Cắm vào facts LLM (`tra_cuu_don_vi`).
- **File:** `server/src/smart.js` (`lookupUnits`, `sayUnitLookup`, intent + reorder + menu).
- **Test:** node harness — "đơn vị BV007 bán bao nhiêu ai bán", "phòng khám mẫu 17…", "đơn vị 19…"
  ra đúng; "top đơn vị / báo cáo theo đơn vị / đơn vị nào chưa bán / giảm mạnh / nhà thầu / doanh thu
  kỳ này" GIỮ NGUYÊN; NV DN001 chỉ thấy phần mình.

### 2026-07-08 — Claude Code — Bot TRA CỨU ĐÍCH DANH thuốc/mã QLNB (giá thầu + cơ số còn lại)
- **Việc:** Thêm khả năng hỏi bot theo MỘT thuốc cụ thể (theo TÊN hoặc MÃ QLNB), trả lời gọn:
  doanh thu, số lượng, **giá thầu**, **cơ số còn lại** (SL/tổng + %), và **đơn vị nào đang bán**.
  - Nhận diện thuốc bằng "từ điển sản phẩm" trong phạm vi quyền (khớp mã QLNB, tên thuốc, hoạt chất,
    và mã ngắn kiểu B02/E05) — không cần cú pháp cứng.
  - Ưu tiên đúng: "giá thầu / doanh thu thuốc X" trả lời theo SẢN PHẨM, không rơi vào doanh thu tổng;
    các mẫu tổng hợp cũ ("top sản phẩm", "báo cáo theo từng sản phẩm") giữ nguyên.
  - Cắm cả vào FACTS đưa LLM (`tra_cuu_san_pham`) để LLM diễn giải sâu hơn khi hỏi lắt léo.
- **Lý do:** Sếp kiểm tra "giá thầu / mã QLNB / tên thuốc… bot trả lời rành rọt chưa" — trước đây 2 loại
  này (giá thầu + tra cứu đích danh 1 thuốc) chưa được surface, trả lời yếu.
- **Quyền:** dùng `store.getRows/getCst` theo `scope` — NV sale CHỈ thấy phần của mình (đã test: DN001
  chỉ thấy số + đơn vị của mình, không lộ NV khác). Không thêm PII vào bundle FE.
- **File:** `server/src/smart.js` (thêm `lookupProducts`, `sayProductLookup`, 2 intent tra cứu + cắm vào
  facts LLM + cập nhật menu/gợi ý).
- **Test:** node harness với dữ liệu mẫu — tra cứu theo tên (E05/B02) + mã (QLNB105) ra đúng số; câu
  chung ("doanh thu kỳ này") KHÔNG bị bắt nhầm; "top/ báo cáo theo sản phẩm" giữ nguyên; NV scope kín.
  (Giá thầu chỉ hiện khi dữ liệu CST có `bid_price` — server thật có; bản mẫu local chưa có nên bỏ dòng đó.)

### 2026-07-07 — Claude Code — Mở rộng "bộ số" đưa LLM → bot trả lời sâu/nhiều ngữ cảnh hơn
- `buildFacts` (dữ liệu app đưa cho LLM) nay giàu hơn nhiều, VẪN theo quyền (NV chỉ thấy mình):
  thêm **con_thieu_target + cần bán/ngày + tiến độ thời gian**, **xu hướng doanh thu 6 kỳ**,
  **top nhà thầu / gói thầu / tỉnh**, **đơn vị tăng/giảm mạnh**, **cơ số chưa bán**, và (chỉ admin)
  **danh sách TỪNG NV** (mã/tên/doanh thu/target/%đạt) + **NV chưa đạt**.
- LLM vẫn KHÔNG bịa số — chỉ diễn giải trên bộ số này → trả lời được nhiều tình huống (phân tích
  từng NV, so xu hướng, hỏi nhà thầu/tỉnh…).
- **Test:** các mảnh dữ liệu chạy đúng cho cả admin lẫn NV; NV KHÔNG lộ danh sách người khác.

### 2026-07-07 — Claude Code — LLM ĐÃ BẬT (hỏi tự nhiên) + dọn markdown tin Telegram
- ✅ **ANTHROPIC_API_KEY đã vào `.env`, `llm.isEnabled()=true`** — bot hiểu ngôn ngữ tự nhiên,
  số vẫn do code tính (không bịa). Verified: hỏi "NV nào đang dẫn đầu t07" → trả lời đúng NV + doanh thu.
- `formatAnswerForTelegram`: **bỏ ký hiệu markdown** (`**đậm**`, `*`, `` `code` ``, `#`, `- ` → `• `)
  vì Telegram gửi text thô → hết cảnh hiện dấu sao thô quanh tên.
- **Test:** `node -c` pass; stripMd bỏ đúng `**...**` và đổi gạch đầu dòng thành `•`.

### 2026-07-07 — Claude Code — Thêm mẫu câu "báo cáo theo từng đơn vị/sản phẩm/tổng hợp"
- `smart.answerQuestion` thêm 3 mẫu: **báo cáo theo từng đơn vị** (vd "báo cáo bán hàng theo từng
  mã đơn vị"), **theo từng sản phẩm**, **báo cáo tổng hợp/tổng quan** → bớt "đơ" cho câu kiểu báo cáo.
- **Lưu ý (thẳng):** vẫn là khớp-mẫu; muốn hiểu **ngôn ngữ tự nhiên bất kỳ** thì BẮT BUỘC bật LLM
  (`.env` đang thiếu `ANTHROPIC_API_KEY`). Đây là giới hạn bản chất của bot khớp-mẫu.
- **Test:** 4 câu báo cáo kiểu tự nhiên trả đúng breakdown; `node -c` pass.

### 2026-07-07 — Claude Code — FIX gốc: auto-deploy restart bot worker + sửa giờ digest
- **🐛 GỐC "bot không đổi":** `auto-deploy.sh` **chỉ restart `reportnew`**, KHÔNG restart
  `reportnew-tgbot` → bot Telegram chạy CODE CŨ mãi (mọi thay đổi câu hỏi/LLM/thông báo không tới).
  Fix: auto-deploy nay **restart luôn `reportnew-tgbot`** (biến `PM2_WORKER`, bỏ qua nếu chưa chạy).
- **🐛 Báo cáo lúc 1h30 (lệch múi giờ):** `startDigestScheduler` trừ dư 7 tiếng → bắn sớm 7h.
  Fix: so THẲNG giờ VN. Mặc định `DIGEST_CRON` đổi sang **`0 0 * * *` (nửa đêm giờ VN)**.
- **Test:** `bash -n` + `node -c` pass; kiểm 17:00 UTC = 00:00 VN → khớp cron `0 0` (bắn đúng nửa đêm).
- **Cần thủ công 1 lần:** thêm `ANTHROPIC_API_KEY` thật vào `.env` + `pm2 restart reportnew reportnew-tgbot`
  (từ lần deploy sau, worker tự restart).

### 2026-07-07 — Claude Code — Bot múi giờ GMT+7 + mở rộng nhiều nhóm câu hỏi
- **Múi giờ:** đặt `process.env.TZ = 'Asia/Ho_Chi_Minh'` ở đầu `index.js` + `telegram-bot.js`
  (cho env override) → mọi mốc thời gian/log/lịch theo GMT+7.
- **Mở rộng hỏi–đáp (`smart.answerQuestion`)** — trước chỉ loanh quanh doanh thu; nay thêm:
  top **nhà thầu / gói thầu / tỉnh**, **đơn vị giảm mạnh/tăng mạnh**, **NV chưa đạt** (admin),
  **đơn vị chưa bán**, **còn thiếu bao nhiêu để đạt target (+ cần ~X/ngày)**, **so kỳ trước**,
  **chào hỏi**, **menu "giúp"**. Fallback đổi thành **gợi ý đầy đủ** thay vì "đơ".
- **Test:** ~13 kiểu câu hỏi trả đúng số (code-first); giúp/help/menu ra menu; câu vô nghĩa ra gợi ý;
  TZ in GMT+0700. Áp cho cả bot Telegram lẫn "Hỏi nhanh" trong app (chung 1 engine).

### 2026-07-07 — Claude Code — GĐ2 Email: kênh Gmail/Workspace + gửi 2 kênh (Telegram + email)
- Thêm dep **nodemailer**. `notifyChannels`: `sendEmail()` qua SMTP (Gmail/Workspace) gated bằng env
  `SMTP_HOST/PORT/USER/PASS/FROM`; `emailFor(emp)` đọc **`server/data/nv_emails.json`** (bot điền,
  gitignored) → fallback `user.email`; `deliver()` gửi **cả Telegram + email**, ok nếu ≥1 kênh thành công.
- Các nút/worker gửi qua `deliver` (2 kênh): `/admin/notifications/send`, `/send-one`, `runTargetMilestones`.
  Guard đổi sang `anyReady()` (có Telegram HOẶC email là gửi được). Vẫn tôn trọng danh sách CHẶN + no_auto_notify.
- `config/nv_emails.example.json` (committed): mẫu định dạng cho bot.
- **Test:** emailReady=false khi thiếu SMTP; emailFor đọc file + fallback + loại email sai định dạng;
  deliver không kênh → ok=false; build web PASS.
- **Cần bot cấp:** SMTP env (Gmail app password) + tạo `server/data/nv_emails.json` (trích lục email phòng KD).

### 2026-07-07 — Claude Code — Danh sách CHẶN thông báo (DN021/DN023/VP004) ở tầng engine
- **`config/notify_optout.json`** (CEO chốt, committed): `codes: [DN021, DN023, VP004]` — tuyệt đối
  không nhận thông báo (Telegram + email + mọi kênh sau này).
- `targetNotify.isMuted(emp)`: chặn nếu mã trong config **HOẶC** user có cờ `no_auto_notify`.
- `pendingEvents` bỏ qua NV bị chặn → mọi nút/lịch (Gửi ngay, tự động, email GĐ2) đều loại tự nhiên.
  Endpoint `send-one` chặn thẳng với thông báo rõ. (Vẫn có thể hiện trong bản tổng gửi CEO để CEO nắm.)
- **Test:** isMuted đúng cho DN021/DN023/VP004; dù vượt 100% vẫn KHÔNG có sự kiện gửi; DN001 vẫn có.

### 2026-07-07 — Claude Code — Gửi ĐÍCH DANH 1 NV (test DN001/DN007)
- `targetNotify.statusFor(emp, ky)`: dựng tin trạng thái hiện tại của 1 NV bất kỳ (đạt %/còn thiếu/cần
  ngày + đúng/chậm nhịp) — không cần vừa vượt mốc.
- Route `POST /admin/notifications/send-one` (admin): gửi tin đó qua Telegram; báo lỗi rõ nếu NV chưa
  giao target / chưa liên kết Telegram / tắt nhận / app thiếu token.
- Màn "🔔 Thông báo": thêm ô nhập **mã NV** + nút **👤 Gửi cho 1 NV này** (mặc định DN001).
- **Test:** statusFor render đúng cho DN001, mã lạ → null; build web PASS.

### 2026-07-07 — Claude Code — Nút "Gửi ngay" + "Gửi thử cho tôi" (gửi chủ động) trên màn Thông báo
- Làm rõ 2 cách gửi: **Tự động** (bot theo giờ, `TARGET_NOTIFY=1`) và **Chủ động** (CEO bấm).
- `src/notifyChannels.js`: `sendTelegram()` dùng `TELEGRAM_BOT_TOKEN` của app (fetch api.telegram.org).
- Route `POST /admin/notifications/send`: `testOnly=true` → gửi thử bản tổng cho chính CEO; ngược lại
  gửi tin từng NV (mốc/chậm nhịp) + bản tổng cho admin, **đánh dấu đã gửi** (chống trùng với lịch tự động).
  Thiếu token → báo lỗi gọn (không crash).
- Màn "🔔 Thông báo": thêm nút **🧪 Gửi thử cho tôi** + **📤 Gửi ngay (N)** + giải thích 2 cơ chế.
- **Test:** build web PASS; endpoint báo lỗi gọn khi app chưa có token.

### 2026-07-07 — Claude Code — Màn "🔔 Thông báo" (xem trước) trong app cho CEO
- Thêm tab **🔔 Thông báo** ở trang Target (admin): gọi `/admin/notifications/preview` (DRY-RUN)
  → hiện **bản tổng gửi CEO** + **danh sách tin sẽ gửi cho từng NV** (mốc 50/90/100 hoặc chậm nhịp),
  kèm banner nhắc "chưa gửi gì; bật thật bằng TARGET_NOTIFY=1".
- Không gửi, không đổi trạng thái — chỉ để CEO duyệt trực quan trước khi bật.
- **Test:** build web PASS (preview API đã test 200 ở PR trước).

### 2026-07-07 — Claude Code — GĐ1 Thông báo target chủ động (engine + preview + worker gated)
- **`src/targetNotify.js` (engine):** tính %đạt từng NV theo kỳ + nhịp thời gian; phát hiện sự kiện
  **vượt mốc 50/90/100%** (1 lần/mốc/kỳ) + **"đang chậm nhịp"** (%đạt < %thời gian − 15%, tối đa
  1 lần/tuần). Chống spam bằng `data/notif_state.json` (gitignored). Soạn nội dung tin (dùng chung
  Telegram/email) + **bản tổng theo từng NV cho CEO** (`ceoDigest`).
- **API (CEO duyệt trước):** `GET /admin/notifications/preview?ky=` — DRY-RUN xem chính xác tin sẽ
  gửi, KHÔNG gửi/không đổi trạng thái.
- **Worker `telegram-bot.js`:** `runTargetMilestones()` + scheduler (giờ VN `TARGET_NOTIFY_HOURS`,
  mặc định 8,20) — **TẮT mặc định**, chỉ chạy khi `TARGET_NOTIFY=1`. Gửi Telegram cho NV có map
  + tôn trọng `no_auto_notify`/opt-out; đẩy CEO digest cho admin.
- **Email:** để GĐ2 (chờ thu thập email NV sale + cấu hình SMTP). Engine đã soạn nội dung sẵn dùng lại.
- **Test:** engine phát hiện mốc 50 đúng, chống spam OK (lần 2 = 0), CEO digest render; preview API 200.

### 2026-07-07 — Claude Code — Đợt 2: bấm NV → trang phân tích chi tiết từng NV
- Ở "Kỳ này", **bấm card 1 NV** → mở trang chi tiết NV đó (breadcrumb Target › Kỳ này › Tên NV):
  dải KPI (tháng+quý+pacing) theo NV, **xu hướng Target vs Đã đạt theo từng tháng** (thanh
  xám target / thanh màu đạt), **Top sản phẩm** + **Top đơn vị** của NV trong kỳ.
- Backend: route `GET /employee/detail?emp=&ky=` (NV thường khoá theo chính mình qua scope;
  admin xem NV bất kỳ). Tái dùng `revenueBreakdown` (top SP/ĐV) + `targetKpiSummary` (thêm
  tham số danh sách mã để tính theo 1 NV) + resolver target theo từng tháng.
- **Test:** build web PASS; HTTP `/employee/detail?emp=DN001` trả đúng emp/kpi/monthly(04→06)/
  top SP(8)/top ĐV(2).

### 2026-07-07 — Claude Code — TỐI ƯU tốc độ: cache dòng doanh thu + CST (Phân công/catalog chậm)
- **Nguyên nhân chậm:** `store.allRows()` ĐỌC LẠI file slot upload + `enrich` (có `provinceOf`)
  MỖI LẦN gọi; `getRowsRange` gọi nó **1 lần/kỳ** → `catalog/sales?all=1` (mọi kỳ) đọc+enrich
  toàn bộ dòng **N lần/1 request**. `getCst` cũng đọc lại + merge + enrich mỗi lần.
- **Sửa:** cache `allRows()` theo chữ ký slot (id+kỳ+mtime); cache `getCstAll()` theo mtime
  `cst_real.json` + chữ ký slot; memo `provinceOf` theo (mã|tên). Cache tự hết hạn khi
  upload/kỳ đổi (mtime) hoặc `clearCache()`. KHÔNG đổi kết quả.
- **Test:** getCst/getRowsRange trả y hệt; province 4/4 đúng; đường dẫn cache 0,09ms/lần (demo).
  Lợi ích lớn trên server thật (nhiều dòng upload).

### 2026-07-07 — Claude Code — Dải KPI target ở "Kỳ này" + "Phân tích" + card NV giàu hơn
- Tách component chung `TargetKpiStrip` (tháng+quý+tiến độ thời gian), dùng ở **Quản target,
  Kỳ này, Phân tích** (đồng bộ 1 kiểu).
- Backend: `/targets` trả thêm `kpi`; thêm route `GET /targets/kpi` (theo scope) cho trang Phân tích.
- Card từng NV ở "Kỳ này": thêm dòng **"còn thiếu … · N ngày → cần ~X/ngày để kịp"** (theo pacing),
  hoặc **"✅ đã đạt/vượt"**.
- **Test:** build web PASS; HTTP `/targets/kpi` + `/targets` trả đúng kpi (quý Q2=04+05+06).

### 2026-07-07 — Claude Code — Dải KPI ở trang Quản target (target & đã đạt: tháng + quý)
- Đầu trang **Quản target** thêm 4 ô KPI: **Target giao tháng**, **Đã đạt trong tháng**
  (kèm % target + tiến độ thời gian ngày/tháng), **Target giao quý** (gộp 3 tháng của quý),
  **Đã đạt trong quý** (% target quý). Ô "đã đạt" đổi màu ok/warn theo việc %đạt có bắt
  kịp %thời gian đã trôi hay không.
- Backend: `/admin/targets` trả thêm `kpi` (targetKpiSummary: target tháng/quý từ resolver,
  doanh thu thực before-VAT của roster theo tháng/quý, pacing thời gian).
- **Test:** build web PASS; HTTP `/admin/targets` trả đúng `kpi`; đối chiếu quý Q2 = 04+05+06,
  đã đạt quý > tháng khớp số.

### 2026-07-07 — Claude Code — Nút "🗑️ Gỡ sửa tay" trên card target
- Mỗi NV nếu target đang dùng là **Sửa tay đè lên nguồn khác** (upload/nhân bản/AI) thì
  hiện nút **"🗑️ Gỡ sửa tay"** cạnh "Sửa tay". Bấm 1 phát → bỏ override → tự quay về
  nguồn kế, KHỎI phải nhờ bot rollback (như vụ DN001).
- Backend: `resolveTargets` thêm tuỳ chọn `excludeSources` để tính "nguồn thay thế";
  `overrideInfo` gắn cờ `manual_override` + nguồn/số sẽ quay về; `clearManualOverride`
  gỡ mọi entry manual active của NV/kỳ (audit `target_manual_clear`); route
  `POST /admin/targets/manual/clear`. `targetMatrix` trả kèm cờ cho UI.
- Xác nhận trước khi gỡ, nói rõ "sẽ quay về: Upload 2,3 tỷ".
- **Test:** build web PASS; smoke test: manual 0 đè upload 2,3 tỷ → gỡ → về upload 2,3 tỷ.

### 2026-07-07 — Claude Code — Nhân bản target sang kỳ sau + chặn Sửa tay ghi 0 nhầm
- **Nút "📤 Nhân bản target sang kỳ sau":** copy toàn bộ target đang dùng của kỳ nguồn
  sang kỳ đích (KHÔNG cần file), rồi Sửa tay vài NV là xong. Nguồn mới `carryover`
  (ngang upload, dưới manual — Sửa tay không bị đè). Backend `targetAdmin.carryOverTargets`
  + route `POST /admin/targets/carryover`; mặc định **chỉ điền NV kỳ đích chưa giao**
  (tick để ghi đè). Sau khi nhân bản tự chuyển sang kỳ đích để sửa tay. Test: nhân bản
  07→09 đúng số + nguồn carryover; chạy lại (không đè) skip đúng; rollback theo batch OK.
- **Chặn "Sửa tay" ghi target = 0 do bỏ trống (vụ DN001):** ô Sửa tay bỏ trống nay =
  HUỶ (không ghi đè về 0); nhập 0 phải xác nhận; số không hợp lệ báo lỗi. Trước đây xoá
  trắng rồi OK là ghi 0 → đè cả upload → NV thành "Chưa giao".
- **Nhãn nguồn dễ đọc:** `carryover→"Nhân bản kỳ trước"`, `upload→"Upload"`, `manual→"Sửa tay"`.
- **Test:** build web PASS; smoke test carryover + rollback. Chờ merge `main`.

### 2026-07-07 — Claude Code — 3 fix từ ảnh Sếp: đoán tỉnh viết tắt, chọn nhiều gói thầu, mã ĐV lặp
- **Fix 1 — "Không tìm thấy CST còn lại" (lọc tỉnh + đơn vị ra 0 dòng):** đơn vị thật
  hay viết tắt tỉnh ở đuôi tên (vd `011.BV Cao Su ĐN`) nên đoán tỉnh CŨ trả rỗng →
  lọc tỉnh Đồng Nai loại luôn đơn vị đó. `province.js`: nhận diện **viết tắt dạng
  token** (`ĐN`→Đồng Nai, `BP`→Bình Phước) + fallback đoán trên **mã đơn vị** khi tên
  trống. Test: `BV Cao Su ĐN`→Đồng Nai, `TTYT Bù Đăng BP`→Bình Phước; `DNA` KHÔNG dính.
- **Fix 2 — Chọn NHIỀU gói thầu:** thêm component `MultiSelect` (lưu chuỗi nối `|`,
  serialize params không đổi); thay ô chọn gói thầu 1-giá-trị ở **Cơ số thầu** và
  **Doanh thu/DT đầy đủ/Sản phẩm**. Backend `analytics.bidMatch` tách `|`, khớp nếu
  thuộc BẤT KỲ gói nào chọn (dùng ở `applyFilters` + `cstTable`). Test: 1 gói 45 dòng,
  2 gói 90 dòng, đều đúng.
- **Fix 3 — Mã đơn vị lặp 2 lần** (`011.BV Cao Su ĐN · 011.BV Cao Su ĐN`): `optionLabel`
  bỏ lặp khi mã đã chứa/bằng tên → chỉ hiện 1 lần.
- **Test:** build web PASS; smoke test analytics (province + multi-bid). Chờ merge `main`.

### 2026-07-07 — Claude Code — Lọc tỉnh cho CST + mở rộng đoán tỉnh + QR Zalo trong app
- **Mục 1 — Lọc tỉnh/thành cho Cơ số thầu (CST):** dòng CST nay được gắn `province`
  (giống dòng doanh thu) trong `store.getCst`; thêm lọc tỉnh ở `cstTable`, truyền
  param `province` ở route `/cst` và export CST; `/filters` gộp cả CST vào danh sách
  tỉnh. Frontend `TenderQuota.jsx` thêm ô chọn tỉnh + đếm lọc. **Test HTTP thật:**
  `/cst?province=Đồng Nai` → 34/34 dòng đúng tỉnh; `/filters` liệt kê Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu.
- **Mục 2 — Mở rộng đoán tỉnh theo tên đơn vị:** `province.js` thêm nhiều tỉnh miền
  Nam/lân cận (BR-VT, Bình Dương, TP.HCM, Long An, Tây Ninh, Lâm Đồng, Bình Thuận,
  Ninh Thuận, Đắk Nông, Đắk Lắk, Tiền Giang) — chỉ dùng TÊN TỈNH + TP/huyện KHÔNG
  trùng tên (tránh 'châu thành', 'tân châu'…). 14/14 case đúng, không hồi quy. ⇒ ít
  đơn vị rơi vào "Chưa gán tỉnh"; phần còn lại bot chạy `scripts/list_unmapped_provinces.js`
  trên server rồi điền `unit_province.json`.
- **Mục 3 — QR Zalo OA trong app + icon:** thêm `ZaloCard` (QR `zalo-oa-qr.png`) ở
  cuối trang Tổng quan (trước chỉ có ở màn Login). **Icon home-screen** đã là logo DP
  đúng (`app-icon-180/512.png`) — hình "chữ A" Sếp thấy trước đó là icon mặc định CŨ
  bị cache; nút "Có bản mới"/gỡ-thêm lại app 1 lần là hết.
- **Test:** `npm run build` web PASS; smoke test API trên cổng tạm 3899 (KHÔNG đụng
  3873/3860). Trạng thái: chờ merge `main`.

### 2026-07-07 — Claude Code — Auto-deploy TỰ GỠ KẸT khi working tree dirty (#37)
- **Vấn đề:** `scripts/auto-deploy.sh` có guard "tree dirty → BỎ QUA im lặng",
  kẹt **vô thời hạn** → Sếp thấy "không có thay đổi" trên iPhone dù đã merge code.
- **Đã xác minh:** KHÔNG có code app ghi vào file tracked lúc chạy (`targetAdmin.js`
  chỉ ghi `target_entries/target_audit.json` — gitignored; `target_baseline_202606`
  & `target_roster` chỉ ĐỌC). ⇒ tree dirty đến từ sửa tay/việc dở chưa commit.
- **Sửa:** (1) LUÔN ghi rõ file nào dirty vào log (`git status --short`); (2) cửa
  thoát: dirty > `STALE_SECS` (mặc định 15') coi là KẸT → `git stash` (khôi phục
  được) rồi deploy tiếp; (3) tree sạch → xoá mốc `.auto-deploy.dirty-since`.
- **Test:** `bash -n` pass. Bot tự áp bản mới ở lượt cron kế (tree đã sạch sau
  reset của Sếp). Trạng thái: đã merge `main` (ee62dd8).

### 2026-07-07 — Claude Code — Tiêu đề nổi bật + KPI thấp gọn + lọc mặc định ẩn
- **Tiêu đề trang** (crumb active): chip xanh gradient chữ trắng cho nổi bật (cả
  base lẫn media mobile). `styles.css .drill-crumbs button.active`.
- **Chiều cao ô KPI**: hạ padding (9→6px), thắt line-height label/value/delta +
  money-big, giảm value 19→18px → bớt dư chiều cao.
- **Bộ lọc mặc định ẨN** ở mọi màn có lọc: `useCollapse` (Phân tích, Cơ số thầu)
  + collapse nội bộ của `RevenueFilters` (Doanh thu, DT đầy đủ, Sản phẩm) đổi
  mặc định về đóng; nhấn "▾ Bộ lọc" mở, nhấn "▴ Thu gọn lọc" thu lại.
- Nghiệm thu: build OK; kiểm headless: tiêu đề chip xanh, KPI gọn hơn, filter-toggle
  hiện "▾ Bộ lọc" (đang ẩn) khi vào trang.

### 2026-07-07 — Claude Code — Bộ lọc TỈNH/THÀNH (Đồng Nai, Bình Phước, …)
- CEO cần lọc theo tỉnh. Dữ liệu chưa có trường tỉnh → thêm nguồn tỉnh:
  1) `row.province` nếu upload có cột "Tỉnh" (thêm alias trong upload.js);
  2) map chính thức `server/config/unit_province.json` (unit_code→tỉnh, bot điền);
  3) đoán theo tên đơn vị (`server/src/province.js` — Đồng Nai/Bình Phước + huyện).
- `store.enrich`: gắn `province` vào mỗi dòng. `analytics.applyFilters`: lọc theo
  `province`. `/filters`: trả `provinces`. `revenueFiltersFromQuery`: thêm province.
- Frontend: dropdown gọn "Tất cả tỉnh/thành" ở thanh lọc (Doanh thu, DT đầy đủ,
  Sản phẩm qua RevenueFilters; và Phân tích). `emptyRevenueFilters` thêm province.
- `scripts/list_unmapped_provinces.js`: liệt kê đơn vị chưa có tỉnh để bot điền nhanh.
- Demo: `server/config/unit_province.json` gán sẵn 20 đơn vị mẫu (Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu) để lọc chạy ngay.
- **‼ Trên dữ liệu THẬT:** nhiều đơn vị tự nhận tỉnh theo tên; đơn vị còn lại bot
  chạy `node scripts/list_unmapped_provinces.js` rồi điền vào `unit_province.json`
  (hoặc thêm cột "Tỉnh" vào file upload hàng tháng).
- Nghiệm thu: node --check backend OK, build OK, dropdown hiện 3 tỉnh + lọc chạy.

### 2026-07-07 — Claude Code — Nút gạt "Tháng liền trước ↔ Cùng kỳ năm ngoái" (làm sẵn)
- CEO muốn làm sẵn: sang 2027 thì so tăng/giảm với 2026 (cùng kỳ năm ngoái).
- `store.comparePeriods(kys, mode)`: thêm `mode='yoy'` — lấy cùng tháng năm trước
  (T06/2027→T06/2026). Nếu chưa có dữ liệu năm trước → `yoyMissing=true`.
- `/alerts` + `/analysis`: nhận `compareMode` (prev|yoy); note đổi theo mode
  ("So tháng liền trước…" / "So cùng kỳ năm ngoái…" / "Chưa có dữ liệu cùng kỳ…").
- Overview + Analysis: thêm nút gạt **[Tháng liền trước] [Cùng kỳ năm ngoái]**
  (nhớ lựa chọn qua localStorage `rpt_cmp_mode`). Mặc định "Tháng liền trước".
- Hiện data mới có 2026 → chọn "Cùng kỳ năm ngoái" báo rõ "chưa có dữ liệu 2025";
  khi bot nạp dữ liệu năm trước là tự chạy, không cần sửa code.
- Nghiệm thu: node --check backend OK, build OK, kiểm headless nút gạt + note YoY.

### 2026-07-07 — Claude Code — Nút "Có bản mới — bấm để cập nhật" (hết kẹt cache iOS)
- **Vấn đề:** iOS giữ cache PWA rất lì → sau deploy, NV cứ hỏi "sao dữ liệu chưa đổi",
  phải xoá–thêm lại app thủ công.
- **Giải pháp:** app tự phát hiện bản mới và mời cập nhật:
  - `vite.config.js`: plugin `emit-version-json` xuất `/version.json` (SHA + giờ build).
  - `index.js`: phục vụ `version.json` với `no-cache`.
  - `UpdateBanner` (components): định kỳ 60s + mỗi khi quay lại app, fetch
    `/version.json?_=ts` (no-store); nếu version khác `__BUILD_VER__` đang chạy →
    hiện nút xanh nổi **"🔄 Có bản mới — bấm để cập nhật"**. Bấm → `location.replace('?v=<ver>')`
    (đổi URL để phá cache iOS) → tải bản mới.
- Nghiệm thu: build ra `version.json` đúng SHA, header no-cache OK; test giả lập
  version khác → nút hiện; version trùng → không hiện.

### 2026-07-07 — Claude Code — So sánh tăng/giảm CÔNG BẰNG + ghi rõ mốc (①+②)
- **Vấn đề (CEO nêu):** "so kỳ trước" đang lấy CẢ kỳ này (tháng dở, mới vài
  ngày theo mốc "Cập nhật đến") so với CẢ tháng trước (đủ) → hầu hết đơn vị hiện
  "giảm 90–100%" ảo. (Bằng chứng: cập nhật thêm ngày thì % giảm nhỏ lại 82,6%→76,2%.)
- **② So công bằng:** thêm `store.comparePeriods(kys)` — nếu kỳ đang xem chạm
  THÁNG HIỆN TẠI (chưa đủ) thì tự lùi về **2 tháng đã HOÀN TẤT** gần nhất (vd
  T07 dở → so T06 với T05). Áp cho: nhóm tăng/giảm ở Tổng quan (`smart.js`) và
  bảng tăng/giảm ở Phân tích (`routes.js /analysis`).
- **① Ghi rõ mốc:** mỗi mục tăng/giảm hiện dòng chú thích "So sánh T06/2026 với
  T05/2026"; nếu phải lùi kỳ thì hiện cảnh báo vàng "⚠ Tháng đang xem chưa đủ
  ngày — đang so 2 tháng đã hoàn tất…". CSS `.alert-group-note(.warn)`.
- KPI "Doanh thu {kỳ}"/"So với {kỳ trước}" ở Phân tích GIỮ theo kỳ Sếp chọn
  (số thô trung thực); chỉ bảng tăng/giảm tự lùi kỳ cho đúng bản chất.
- Nghiệm thu: `node --check` store/smart/routes OK, build OK, kiểm headless thấy
  note trên cả Tổng quan lẫn Phân tích.

### 2026-07-07 — Claude Code — Thêm "Đơn vị tăng trưởng mạnh" + chip mũi tên
- **Tổng quan:** thêm nhóm cảnh báo `unit_up` "Đơn vị tăng trưởng mạnh (so kỳ
  trước)" (MoM ≥ +15%), đặt NGAY TRÊN nhóm "giảm mạnh"; viền xanh (tone `ok`),
  📈, mỗi dòng có chip xanh **▲ Tăng x%**. Thanh tóm tắt thêm "x đơn vị tăng".
  `count` (Cần chú ý) KHÔNG tính unit_up (tin vui, không phải cảnh báo); mục
  cảnh báo hiện khi có bất kỳ nhóm nào có dữ liệu.
- **Phân tích:** `DeltaRow` thêm chip **▲ Tăng %** (xanh) / **▼ Giảm %** (đỏ)
  cho từng dòng ở các block tăng/giảm (đơn vị + sản phẩm).
- `smart.js`: gom cả tăng & giảm trong 1 vòng; sort unit tăng giảm dần theo %.
- Nghiệm thu: `node --check` smart.js OK, build OK, kiểm headless thấy mục tăng
  trưởng + chip xanh trên cả Tổng quan lẫn Phân tích.

### 2026-07-05 — Claude Code — Dựng lại bản Tổng quan "màu chuẩn CEO" (đưa vào git)
- **Bối cảnh:** Bản Tổng quan nhiều màu + đồng hồ (bot làm trên server) **chưa từng
  push lên GitHub**. Các lệnh deploy `git reset --hard origin/main` (untrack-data +
  auto-deploy) ép giống main nên **xoá mất bản local đó** → về bản trắng. CEO gửi ảnh
  yêu cầu khôi phục.
- **Sửa (commit thẳng vào repo để KHÔNG mất lần nữa):**
  - `Kpi` thêm prop `variant` (blue/purple/green/red/amber) + `icon` (góc phải).
  - `Clock` mới: đồng hồ chạy giây (giờ VN) trên header mobile + topbar desktop.
  - Overview: 6 ô KPI tô màu đúng ảnh chuẩn (Doanh thu xanh dương ⚠️/📊 theo tăng-giảm,
    Trước VAT tím 🧾, Đạt target + NV đạt target xanh lá 🎯, Cơ số thầu đỏ ⚠️, Quy mô
    kỳ vàng 🗺️); số Doanh thu/Trước VAT hiện 2 dòng (gọn + đầy đủ) qua `MoneyBig`.
  - CSS: `.kpi.k-*` (viền trái đậm + nền tô nhạt + số theo màu), `.kpi-ic`, `.clock-pill`.
- Nghiệm thu: build OK; kiểm headless mobile 390px khớp 1:1 ảnh CEO (đồng hồ + 6 ô màu).
- **‼ Bài học:** mọi thay đổi giao diện của bot PHẢI push lên `main`, nếu không lần
  deploy kế tiếp (`reset --hard`/auto-deploy) sẽ xoá. Nay bản màu đã nằm trong git.

### 2026-07-03 — Claude Code — Auto-deploy (server tự cập nhật khi main đổi)
- Thêm `scripts/auto-deploy.sh` + hướng dẫn cron (mỗi 1 phút). Merge lên `main`
  là server tự: fetch → (fast-forward mới đi tiếp) → reset --hard → build → restart
  PM2. Hết cảnh copy-paste lệnh deploy.
- **An toàn:** flock chống chạy chồng; chỉ deploy khi HEAD là tổ tiên origin/main
  (không đè commit local chưa push của bot); bỏ qua nếu tree có thay đổi tracked
  chưa commit; **build ra thư mục tạm rồi mới tráo** — build lỗi thì giữ nguyên
  bản đang chạy, không restart. Cài lại deps nếu package(-lock).json đổi.
- `.gitignore`: thêm `web/dist.new/`, `web/dist.old/`, `.auto-deploy.lock`.
- Đường repo trên server: `~/.openclaw/workspace-report/App-report-new` (đặt qua
  biến REPO_DIR nếu khác). Log ghi ở `auto-deploy.log`.
- Nghiệm thu: `bash -n` OK; thử `build -- --outDir dist.new` tạo đủ dist (index +
  assets + manifest + icon). **Cần cài cron 1 lần trên server để kích hoạt.**

### 2026-07-03 — Claude Code — ‼ AN TOÀN DỮ LIỆU: gỡ 4 file runtime khỏi git
- **Vấn đề:** 4 file dữ liệu người dùng GHI lúc chạy vẫn bị track trong repo:
  `assignments.json`, `assignment_audit.json`, `target_adjustments.json`,
  `target_adjustment_audit.json`. Deploy dùng `git reset --hard origin/main`
  → mỗi lần deploy **ghi đè** chúng bằng bản cũ trong repo ⇒ nguy cơ **mất**
  phân công / điều chỉnh target người dùng vừa nhập.
- **Sửa:** `git rm --cached` 4 file (file vẫn nằm trên đĩa server). `.gitignore`
  đã có sẵn pattern `server/data/*.json` nên từ nay git không đụng chúng nữa;
  dữ liệu người dùng nằm yên trên server qua mọi lần deploy.
- **GIỮ track (chỉ đọc, cấu hình versioned):** `target_baseline_202606.json`,
  `target_roster.json`, `sample_upload.xlsx`.
- **‼ DEPLOY LẦN NÀY PHẢI THEO QUY TRÌNH AN TOÀN** (sao lưu → cập nhật → phục hồi
  → build → restart) vì cú `git reset --hard` kế tiếp sẽ xoá 4 file khỏi working
  tree (do commit này bỏ chúng khỏi index). Xem prompt deploy an toàn kèm theo.
  Từ deploy sau trở đi thì bình thường, không cần bước sao lưu nữa.

### 2026-07-03 — Claude Code — Dấu mốc bản build ở màn login (PR mới)
- **Vấn đề:** Sau deploy, khó biết bản web đang chạy là bản nào (bot `git pull` nhưng dist là artifact — không rebuild thì UI vẫn cũ; cộng cache PWA → "hình như vẫn bản cũ").
- **Sửa:** `vite.config.js` inject `__BUILD_VER__` (SHA commit, hoặc `BUILD_VER` env) + `__BUILD_AT__` (giờ build) lúc build; màn Login hiện dòng mờ `Bản <sha> · build <giờ>`. Mở site (kể cả chế độ Riêng tư) là biết ngay bản nào đang live, hết mơ hồ.
- Nghiệm thu: `npm run build` OK, kiểm headless thấy `Bản efc50d7 · build 22:39 03-07`.
- **‼ Nhắc bot:** `git pull` KHÔNG đủ để đổi UI — PHẢI `npm --prefix web run build` rồi `pm2 restart reportnew`. dist bị .gitignore nên không tự cập nhật theo git.

### 2026-07-03 — Claude Code — Mobile/PWA polish (PR #14)
- **Số lớn luôn hiện đủ:** bỏ cơ chế "chạm để đổi" (không đáng tin trên PWA khi kẹt cache) → `MoneyBig` luôn hiện số gọn (`4,76 tỷ`) kèm số đầy đủ (`4.758.211.000đ`) ngay bên dưới. File: `web/src/components.jsx`, `web/src/styles.css`.
- **Nút bottom-nav cao hơn đáy:** tăng padding đáy nav + cộng `safe-area-inset-bottom`, `.page` chừa thêm chỗ → icon dễ chạm hơn trên máy có gesture bar. File: `web/src/styles.css`.
- **Hết kẹt bản cũ (PWA cache):** `index.html` + `.webmanifest` trả `Cache-Control: no-cache, must-revalidate`; asset có hash tên (`/assets/*`) cache dài `immutable`. Sau deploy, PWA luôn lấy shell mới. File: `server/src/index.js`.
- Nhãn KPI "Trước VAT" ghi rõ `đã ÷ 1,05`. File: `web/src/pages/Overview.jsx`.
- Nghiệm thu: `node --check` index.js OK, `npm run build` OK, kiểm tra headless mobile 390px (số hiện đủ 2 dòng, header no-cache xác nhận). **Bot cần `git pull` + `npm --prefix web run build` + `pm2 restart reportnew` để áp.**

### 2026-07-03 — Bot triển khai (Report Bot) — TARGET_ADJUSTMENT GĐ2a
- Đã implement `DIRECTIVE_TARGET_ADJUSTMENT.md` GĐ2a, chưa làm GĐ2b multidimensional.
- Thêm module `server/src/targetAdjustment.js`, lưu `server/data/target_adjustments.json` + audit `target_adjustment_audit.json`: lý do `dut_hang`/`cong_no`/`khac`, số tiền ảnh hưởng, trạng thái `pending/approved/rejected`, người đề xuất/duyệt.
- API: `/target-adjustments`, `/admin/target-adjustments/:id/approve|reject`, `/admin/target-adjustments/suggestions`; chỉ adjustment `approved` mới hạ target chính thức.
- `/targets` trả thêm target gốc, target sau điều chỉnh, `% đạt gốc`, `% đạt sau điều chỉnh`, gap sau điều chỉnh, tổng giảm theo lý do.
- UI Target thêm tab `Điều chỉnh`: NV/admin ghi lý do, admin xem gợi ý Hết CST/còn nợ, duyệt/từ chối; thẻ target hiển thị 2 dòng % đạt và số đã trừ theo lý do.
- Gợi ý tự động: đứt hàng lấy draft từ CST hết/cạn; công nợ ghi rõ thiếu nguồn WEB partner nên tạo draft 0 để CEO nhập/duyệt, không tự áp.
- Nghiệm thu: `node -c` routes/targetAdjustment OK, `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — SỬA nhà thầu: chỉ 1 tên theo (mã QLNB + mã nhà thầu)
- CEO: thẻ đang nối HẾT tên biến thể của 1 mã nhà thầu (dài/rối/sai, VD Ediwel). → sửa: **thẻ chỉ hiện 1 TÊN**, khóa tra `(iit_code + contractor_code) → 1 tên` (ưu tiên contractor_name của dòng; else tên đại diện cặp); **không nối "/"**. Ô lọc giữ gom theo mã nhưng nhãn 1 tên đại diện. Áp mọi thẻ + Danh mục tổng (GĐ1). Ghi `DIRECTIVE_CARD_V2.md`.
- Soạn trước trong khi chờ GĐ1. → [`DIRECTIVE_TARGET_MULTIDIM.md`](DIRECTIVE_TARGET_MULTIDIM.md).
- **Cốt lõi:** các chiều là **kính lọc CHỒNG NHAU** (1 giao dịch tính vào nhiều target: tổng+nhóm+đơn vị+tuyến) → **KHÔNG cộng dồn %đạt**; target chi tiết là **tùy chọn** (đặt ở chiều muốn nhấn, còn lại roll-up tổng).
- Dùng `scope{type,value}`; nhập target chọn chiều + template thêm cột scope; %đạt lọc doanh thu theo chiều (`route/unit/iit/priority` đã có); special "hàng cần đẩy" resolve thành tập mã (CST/doanh số). Thẻ NV bung theo chiều đã đặt; cảnh báo lệch trong CÙNG chiều (không chéo).

### 2026-07-03 — Bot triển khai (Report Bot) — SPEC_TARGET_ASSIGNMENT GĐ1
- Đã `git pull origin main`, đọc `SPEC_TARGET_ASSIGNMENT.md`; chỉ làm GĐ1, chưa làm target chi tiết GĐ2/thưởng GĐ3.
- Thêm danh mục bán hàng tổng `/api/catalog/sales`: hợp nhất SP, hoạt chất/hàm lượng, nhóm UT, tuyến, gói, nhà thầu mã-tên, giá thầu, CST còn.
- Thêm model phân công `assignment{id, emp_code, type, value, from_ky, to_ky, active, note, by, at}` + `source`/`special_kind`, lưu `server/data/assignments.json`, audit `assignment_audit.json`; gieo mầm 1.687 phân công auto từ lịch sử 04-06/2026 hiệu lực từ 07.2026.
- Thêm API admin/mine/special: CEO xem-sửa-thêm-ngưng hiệu lực + audit; NV chỉ thấy `/assignments/mine` theo session; upload Excel backend cho phân công.
- Thêm UI Target: tab `Phân công` cho admin và `Tôi phụ trách` cho NV/admin; special `tồn nhiều`/`hàng ngách` auto, `cận date` và `sắp hết thầu-CST lớn` ghi rõ thiếu nguồn hạn dùng/hạn gói thầu để CEO chọn thủ công.
- Review độc lập sau GĐ1 yêu cầu bổ sung: đã thêm UI/client upload Excel phân công, nút Sửa nạp dòng hiện có vào form, hiển thị `hang_ngach` trong “Tôi phụ trách”, seed lại auto có thêm `all`/`group` (tổng 1.808 dòng: all 22, group 99, iit 1328, route 45, unit 314), và `/catalog/sales` lọc theo assignment cho NV thường.
- Nghiệm thu: `node -c` routes/assignmentAdmin OK, `npm run build` OK, restart `reportnew` OK, health local/public OK; API catalog/admin/mine/special/history OK; UI Phân công render catalog 342 mã + phân công auto.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec điều chỉnh target theo lý do (đứt hàng/công nợ)
- CEO: cần ghi lý do không đạt (đứt hàng/công nợ) để hạ tỷ lệ target tháng đó + phân tích. → [`DIRECTIVE_TARGET_ADJUSTMENT.md`](DIRECTIVE_TARGET_ADJUSTMENT.md) (thuộc Target GĐ2).
- Model `target_adjustment{emp_code,ky,reason_type,impact_amount,status,...}`; **CEO DUYỆT mới áp**. Target điều chỉnh = target gốc − Σ impact duyệt; thẻ hiện %đạt gốc + %đạt sau điều chỉnh + "đã trừ đứt hàng X/công nợ Y". Gợi ý tự động từ Hết CST (đứt hàng) + "còn nợ chưa giao" (công nợ), CEO duyệt. Phân tích tổng hợp mất theo lý do.
- CEO: làm luôn kế hoạch target chi tiết + danh mục NV phụ trách. → [`SPEC_TARGET_ASSIGNMENT.md`](SPEC_TARGET_ASSIGNMENT.md) (3 giai đoạn).
- **GĐ1 (làm trước):** Danh mục bán hàng tổng + bảng PHÂN CÔNG (`assignment{emp_code,type,value,hiệu lực}`) — **gieo mầm tự động từ lịch sử bán** (NV↔đơn vị/SP), CEO sửa tay; màn "Tôi phụ trách" cho NV. Không hồi tố + audit.
- **GĐ2:** Target theo CHIỀU (nhóm H.A*/tuyến/đơn vị/QLNB/đặc biệt) dùng field `scope` đã có; %đạt tính theo đúng chiều; kỳ đang chạy pro-rate.
- **GĐ3 (sau):** Thưởng bậc thang (duyệt mới gửi).
- **Chờ CEO chốt:** chiều phân công chính (đề xuất Đơn vị + Nhóm UT + Tuyến); gieo mầm từ lịch sử (04–06/2026)?
- Đã `git pull origin main`, đọc mục FIX trong `DIRECTIVE_CARD_V2.md`.
- Enrich metadata theo `iit_code` từ CST/filter vào thẻ: hoạt chất+hàm lượng cho QĐ139, giá trúng thầu, ưu tiên, nhà thầu mã-tên, tuyến/đơn vị/NV cho Sản phẩm · DT đầy đủ · Doanh thu.
- Frontend không ẩn field bắt buộc: nếu thật sự thiếu nguồn sẽ hiện `Thiếu nguồn ...`; kỳ T07 mẫu đã đủ giá/UT/hoạt chất.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Đã mở từng tab và chụp 1 thẻ: `verification-screenshots/card-v2-fix/products-card-8-fields.png`, `revenue-full-card-8-fields.png`, `revenue-card-8-fields.png`; manifest đối chiếu tại `card-v2-fix-manifest.json`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.

### 2026-07-03 — Bot triển khai (Report Bot) — Card V2 bổ sung nhà thầu MÃ-TÊN
- Bổ sung lookup dùng chung mã nhà thầu → tên đầy đủ từ dữ liệu filter/phân tích hiện có; hỗ trợ nguồn legacy có tên công ty nằm trong `contractor_code` và nguồn App Sale chỉ có mã ngắn như `AFP`/`DONA`.
- API `/filters`, `/revenue/full`, `/products`, `/cst` enrich `contractor_name`; thẻ tiếp tục dùng `pairText()` nên chỉ hiện mã trần khi thật sự không tìm được tên.
- Nghiệm thu live: `AFP - Công Ty Tnhh Afp Pharma`, `DONA - Công Ty Tnhh Dược Phẩm Donapharm` xuất hiện trong filter, DT đầy đủ và Sản phẩm; `npm run build` OK, restart `reportnew` OK, health local/public OK.

### 2026-07-03 — Bot triển khai (Report Bot) — Layout Smart: Quản target content-first
- Đã `git pull origin main`, đọc `DIRECTIVE_LAYOUT_SMART.md`; không đụng app cũ `dona-report` port 3860.
- Quản target đổi sang bố cục content-first: bỏ period card/form dài riêng, kỳ target nằm compact trong toolbar; danh sách 21 NV/CTV lên ngay dưới thanh công cụ.
- Gom công cụ phụ thành 1 toolbar: `Template`, `Upload`, `Nhập theo Quý`, `AI đề xuất`, `Rollback`; các form nặng mở modal/drawer và giữ đủ chức năng cũ.
- Đoạn resolver dài chuyển thành icon `ⓘ` tooltip. Thêm CSS modal/drawer và toolbar tái dùng được cho các màn khác khi áp nguyên tắc content-first tiếp.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Screenshot trước/sau: `verification-screenshots/layout-smart/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive bố cục "smart app" (nội dung chính nổi bật)
### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.
- CEO: Quản target công cụ phụ chiếm >1/2 màn hình, đẩy danh sách chính xuống đáy. → [`DIRECTIVE_LAYOUT_SMART.md`](DIRECTIVE_LAYOUT_SMART.md).
- **Nguyên tắc toàn app:** nội dung chính ~70–80% màn hình + hiện ngay; công cụ phụ gom **1 thanh nút gọn**; form nặng mở **modal/drawer** khi bấm; chữ dài → **icon ⓘ tooltip**.
- **Áp ngay Quản target:** thanh nút [Template][Upload][Nhập Quý][AI][Rollback] → form bung modal; resolver-info thành ⓘ; danh sách 21 NV lên trên, chiếm phần lớn. Giữ đủ chức năng. Áp dần Upload/bộ lọc các trang.

### 2026-07-03 — Bot triển khai (Report Bot) — Directive Card V2: lọc ngày + thẻ QĐ màu + giá trúng thầu
- Đã pull `main`, đọc `DIRECTIVE_CARD_V2.md` và xác nhận độ chi tiết ngày trước khi lọc:
  - T01–T06 legacy/Lumos: dòng upload không có ngày chi tiết, chỉ có `dateFrom/dateTo` cấp kỳ → không phân bổ giả theo ngày.
  - T07 `CRM_MISA_PLUS_APP_WEB`: dòng active có `date` + `source_order`, `data_as_of=2026-07-03T10:30:21+07:00` → lọc ngày/tuần/tháng/quý theo ngày dòng.
- Backend: `slotRows()` giữ ngày dòng thật nếu có, gắn `date_granularity`, `source_date_from/to`, API `/periods` trả `canFilterByDay`; `applyFilters()` thêm `dateFrom/dateTo` và chỉ nhận kỳ không có ngày khi range phủ trọn kỳ.
- UI bộ lọc doanh thu/Sản phẩm/DT đầy đủ: hiển thị “Cập nhật đến HH:mm GMT+7”, thêm date range + quick `Ngày/Tuần/Tháng/Quý`, ghi chú rõ kỳ nào chỉ có số theo tháng.
- Card V2: QĐ139 nền vàng/cam + badge cam, QĐ141 nền xanh + badge xanh; thay ô “Gói thầu” bằng **Giá trúng thầu**; thêm ô **Ưu tiên**; QĐ139 hiện hoạt chất+hàm lượng, QĐ141 không hiện hoạt chất; nhà thầu dùng mã-tên khi nguồn có tên. Áp Sản phẩm, DT đầy đủ, CST flat card.
- Nghiệm thu: `node -c` server OK, `npm run build` OK, `pm2 restart reportnew && pm2 save` OK, health OK. Screenshot: `verification-screenshots/card-v2/`. Old app `dona-report` port 3860 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive Thẻ V2: mã màu QĐ + giá trúng thầu + ưu tiên + lọc ngày
- CEO 2 ảnh (H1 chỉnh thẻ/lọc, H2 mẫu bảng + mã màu). → [`DIRECTIVE_CARD_V2.md`](DIRECTIVE_CARD_V2.md).
- **H1:** giờ đồng bộ "…GMT+7"; lọc Từ ngày→Đến ngày + Ngày/Tuần/Tháng/Quý; bỏ ô "Gói thầu 139" → **Giá trúng thầu**; tên+hoạt chất/hàm lượng (QĐ141 không); nhà thầu **`01.AFP - CÔNG TY TNHH AFP PHARMA`** (1 mã nhiều tên); thêm ô **Ưu tiên** (H.A*/H.A/H.B).
- **H2:** nền thẻ theo QĐ — **QĐ139 vàng/cam, QĐ141 xanh** + badge góc; bố cục bảng gọn theo ảnh mẫu.
- **Lưu ý:** lọc theo ngày chỉ đúng khi kỳ có ngày chi tiết (T07+ App Sale có; 01–06 Lumos theo tháng — bot xác nhận, không bịa phân bổ ngày).

### 2026-07-03 — Bot triển khai (Report Bot) — Nav chung Quay lại/Breadcrumb/Tải lại
- Đã `git pull origin main`, đọc `DIRECTIVE_NAV_BACK_RELOAD.md` trước khi làm.
- Thêm component/hook chung `web/src/drillNav.jsx`: thanh `← Quay lại` + breadcrumb bấm nhảy cấp + `↻ Tải lại`; reload refetch dữ liệu nhưng giữ filter/cấp drill.
- App-level navigation đẩy `history.pushState` cho chuyển tab; luồng drill Doanh thu dùng stack chung + browser/phone Back lùi đúng 1 cấp.
- Áp thanh chung cho các tab chính: Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, Cơ số thầu, Target, Hỏi nhanh, Upload. Cơ số thầu/Target/Upload có breadcrumb theo subview/filter; Doanh thu có drill NV→ĐV→SP.
- Nghiệm thu live: Doanh thu → Nguyễn Trọng Hiếu (DN006) → 027.BV QUỐC TẾ HOÀN MỸ ĐN → browser Back quay về danh sách đơn vị; `↻ Tải lại` giữ breadcrumb/filter `Doanh thu › Nguyễn Trọng Hiếu (DN006)`. Build OK, `pm2 restart reportnew && pm2 save` OK, health OK. Artifact: `verification-screenshots/final-0703-nav-back-reload/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive điều hướng: Quay lại + Breadcrumb + Tải lại (toàn app)
- CEO: drill sâu (DN006 → ĐV/SP) không có nút lùi, không có nút tải lại. → [`DIRECTIVE_NAV_BACK_RELOAD.md`](DIRECTIVE_NAV_BACK_RELOAD.md).
- 1 thanh điều hướng chung: **← Quay lại** (lùi 1 cấp drill) + **breadcrumb** (bấm cấp nhảy về) + **↻ Tải lại** (re-fetch giữ bộ lọc) + hỗ trợ **nút Back trình duyệt/điện thoại** (đẩy history). Component/hook dùng chung, áp mọi tab drill (Doanh thu/DT đầy đủ/Sản phẩm/CST/Phân tích/Target/Tổng quan).
- Đã `git pull origin main`, đọc `DIRECTIVE_TARGET_TEMPLATE.md` phần **CĂN CỨ**.
- Dump/chốt baseline target T06/2026 từ nguồn legacy `V_TEM_TARGET_BONUS` đã import trong `server/data/targets_real.json` cho đúng 21 mã allowlist CEO; lưu `server/data/target_baseline_202606.json` và backup trong `backups/target_baseline/`. Tổng baseline: **30.062.862.426đ**.
- Template target thêm dropdown căn cứ: `Theo T06/2026 (Lumos)` mặc định, `Trống`, `Theo kỳ gần nhất đã giao`. Khi kỳ tương lai chưa giao target, file `.xlsx` điền sẵn target T06 làm căn cứ; nếu kỳ đã có target thì ưu tiên target hiện tại; căn cứ không tự thành target live cho đến khi CEO upload/commit.
- API `/api/admin/targets` trả metadata baseline; `/api/admin/targets/template.xlsx?ky=08.2026&basis=t06` xuất 21 dòng, nhãn `Căn cứ: target T06/2026 Lumos`.
- Nghiệm thu: `node -c server/src/targetAdmin.js`, `node -c server/src/routes.js`, `npm run build` OK; `pm2 restart reportnew && pm2 save` OK; health OK. Verify live đọc ngược XLSX 08.2026: 21 dòng, tổng **30.062.862.426đ**, mismatch `[]`. Artifact: `verification-screenshots/final-0703-target-template-basis/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target: căn cứ T06 Lumos điền sẵn template (dump trước khi cắt)
- CEO muốn dùng target **T06/2026 Lumos** (số cuối trước khi cắt) làm căn cứ điền sẵn template → sửa → upload. → `DIRECTIVE_TARGET_TEMPLATE.md`.
- **Bước A:** bot **dump `V_TEM_TARGET_BONUS` kỳ 06.2026** (21 NV) NGAY, lưu `data/target_baseline_202606.json` + backup (trước khi ngắt Lumos).
- **Bước B:** template kỳ tương lai chưa giao → điền sẵn số T06 làm mốc (nhãn "Căn cứ: T06/2026"); có dropdown chọn căn cứ (Trống / T06 Lumos / kỳ gần nhất). CEO sửa rồi upload (nguồn `upload`). **Không auto-áp** — chỉ là mốc để sửa; không phá "target chốt tại App Report".
- CEO gộp 2 yêu cầu (template điền mới + xuất để sửa) thành **1 nút xuất file**. → [`DIRECTIVE_TARGET_TEMPLATE.md`](DIRECTIVE_TARGET_TEMPLATE.md) (đã gộp) + file mẫu `templates/TARGET_TEMPLATE_MAU.csv`.
- Nút **"⬇ Xuất/Tải template target"**: xuất .xlsx kỳ đang chọn, 21 NV (tên từ DB), **Target điền sẵn giá trị hiện tại — chưa giao thì trống** (vừa là template vừa là bản sửa). Upload lại → preview/commit/rollback theo MÃ NV; ô trống = giữ nguyên. Sửa tay lẻ vẫn ăn.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target chốt tại App Report (bỏ Lumos từ 07) + KPI dễ hiểu + ô Tổng
- CEO: ô KPI target khó hiểu (272% do chia nhịp 3/31; mượn target Lumos T06 cho T07). → [`DIRECTIVE_TARGET_KPI.md`](DIRECTIVE_TARGET_KPI.md).
- **A) Từ 07/2026 target CHỐT TẠI APP REPORT**, KHÔNG đồng bộ Lumos/app khác: resolver kỳ ≥07 chỉ `manual>upload>ai` (bỏ legacy Lumos + appsale); kỳ ≤06 giữ Lumos lịch sử. Chưa giao → "Chưa giao target", không mượn số.
- **B) Thẻ NV dễ hiểu:** số chính = đạt / **target CẢ THÁNG** (%) + vượt/thiếu (số & %); vòng = % so target tháng; "nhịp N/D" thành dòng phụ có nhãn rõ (không để 272% trần).
- **C) Thêm ô KPI TỔNG** trang Target: Σ target · Σ đạt · vượt/thiếu tổng (số & %), theo scope.
- CEO nêu tầm nhìn: target/thưởng theo nhiều chiều (nhóm H.A*/H.A/H.B, hàng đặc biệt, tuyến CL/NCL/NT, mã ĐV, mã QLNB) + danh mục bán hàng tổng + phân công NV. → [`SPEC_TARGET_BONUS_ROADMAP.md`](SPEC_TARGET_BONUS_ROADMAP.md).
- **Làm NGAY (chừa chỗ):** thêm field `scope` (mặc định `all`) vào `target_entry` → tương lai thêm target theo chiều không phải đập mô hình; hành vi hiện tại không đổi.
- **Làm SAU:** target đa chiều + %đạt theo chiều (dữ liệu route/unit/iit/UT đã có) + lớp Thưởng tách riêng (bậc thang, duyệt mới gửi) + danh mục+phân công (chính là module Phân công/Điều chuyển đã hoãn). Cập nhật scope: "thưởng" từ CẮT → SAU.
- **Xác nhận:** roster Target giờ ĐÚNG 21 mã (allowlist config, bỏ heuristic). ĐẠT.
- **CEO yêu cầu:** Quản target cho **nhập target kỳ tương lai** (T08/T09.2026…) + **theo QUÝ**. → `DIRECTIVE_TARGET_ADMIN.md` mục 0-TER: period picker sinh tháng tới (+12); chế độ Quý nhập 1 số → **tách 3 tháng (chia đều mặc định, chỉnh tay được)**, lưu tầng tháng để resolver/%đạt/forecast dùng chung; upload file nhiều kỳ. Audit/rollback giữ nguyên.
- CEO: ô "Tất cả nhà thầu" cho hiện **mã + tên đầy đủ**; **1 mã nhà thầu có nhiều tên** (VD `07.trieu.g`). → khóa lọc theo **MÃ**, chọn mã gom hết mọi tên. Áp chung mọi bộ lọc mã↔tên (nhà thầu/ĐV/SP/NV/gói/tuyến): luôn hiện mã+tên, khóa theo mã (tên chỉ là nhãn). Ghi `SPEC_ANALYSIS_CST_UX.md` mục C2.
- CEO bực: Target admin VẪN hiện 35 NV/CTV (còn VP002/003/006 văn phòng) → PHẢI đúng 21 mã allowlist (mục 0-BIS), bỏ heuristic. Bot chưa áp allowlist vừa push.
- **Lấy target TỰ ĐỘNG:** cột Nguồn trống/0đ → CEO chưa thấy target tham khảo. Bot xác định nguồn (target cũ Lumos `V_TEM_TARGET_BONUS` 01–06 và/hoặc App Sale) → kéo về nguồn `appsale`/`legacy` hiện số thật + nhãn nguồn; AI đề xuất ở nguồn `ai`. Ghi `DIRECTIVE_TARGET_ADMIN.md`.
- **H1:** khối Đơn vị tăng/giảm (Phân tích) + mọi nơi hiện tên ĐV phải kèm **mã số đầy đủ** `001.BVĐK Đồng Nai`. Ghi `DIRECTIVE_MULTICOLUMN_LAYOUT.md`.
- Tab Target lọt cả NV văn phòng (heuristic role sai). **Chốt allowlist CHÍNH THỨC 21 mã:** DN001–012, DN016–019, DN021–024, VP004. Ngoài danh sách = KHÔNG target (văn phòng/telesale VP018/nghỉ DN013-015/DN020). Dùng cờ `has_target`/config, không suy role. Ghi `DIRECTIVE_TARGET_ADMIN.md` mục 0-BIS.
- Phân nhóm (đều có target): CTV đặc biệt DN021/022/023/VP004 (no_auto_notify); CTV gần fulltime DN002/DN004; còn lại fulltime. Nghiệm thu: Target hiện đúng 21 mã, không dư/thiếu.
- CEO: khối danh sách PC vẫn 1 cột full-width (phí chỗ), yêu cầu **2–3 cột, áp mọi tab, làm triệt để**. → [`DIRECTIVE_MULTICOLUMN_LAYOUT.md`](DIRECTIVE_MULTICOLUMN_LAYOUT.md).
- PC ≥1024px = 2–3 cột; tablet 2; mobile 1. Liệt kê rõ khối phải sửa: Phân tích (tăng/giảm ĐV+SP, SP cần đẩy/sắp hết CST), Tổng quan (top+cảnh báo), Doanh thu/DT đầy đủ (ranking+chi tiết), Sản phẩm/CST/Target. Dùng `.list-grid` chung. Bot rà từng tab báo lại.
- Ghi chú soi thêm: "Đơn vị tăng mạnh" hiện toàn số ÂM do so T07(2 ngày) với T06(cả tháng) → xử cùng đợt kỳ-đang-chạy (so cùng số ngày).
- CEO phản ánh thẻ mobile thiếu/thừa. → [`DIRECTIVE_CARD_LAYOUT.md`](DIRECTIVE_CARD_LAYOUT.md): thêm **Giá thầu**; **tên thuốc IN ĐẬM** + nhãn "SP" ở tên thuốc, **mã QLNB nhạt** (không đậm); **bỏ tên đơn vị lặp** (giữ `002.BVĐK…`); **nhà thầu mã + tên đầy đủ**; **trùng tên → thêm hàm lượng** (trừ QĐ141); bố cục **dạng bảng, mobile 2 cột field ngắn**. Áp thẻ Doanh thu/DT đầy đủ + đồng bộ CST.
- CEO: Tổng quan vẫn hiện "2,67 tỷ" làm số lớn → SAI ý. **Số headline/KPI/thẻ phải ĐẦY ĐỦ `2.668.987.096đ`** (đổi `short()`→`money()`); chỉ trục biểu đồ mới được viết tắt `2,67 tỷ`. Cập nhật `DIRECTIVE_NUMBER_FORMAT_VN.md`. Bot sửa + build + restart reportnew.
- **Resolver target (`targetAdmin.resolveTargets`)**: ĐÚNG — chọn theo `PRIORITY manual(4)>upload(3)>appsale(2)>ai(1)>legacy(0)`, hòa thì lấy `at` mới nhất; giới hạn theo `targetRosterCodes` (allowed set) → **VP018/telesale không có target dù có entry**. Roster = `isActiveSalesUser` (role sale, không Nghỉ việc, type sale/ctv), neo toàn đội active → hết sót NV.
- **Idempotency auto-refresh (`materialize_july_revenue.js`)**: ĐÚNG — trước khi push slot mới, `s.active=false` cho MỌI slot cùng `ky` → **chỉ 1 slot active/kỳ, không double-count, không drift**. PA-A loại `DT-260630-0115` (WEB=550.673.600); kỳ đã đóng giữ nguyên.
- **Kết luận: DUYỆT, không có bug ở 2 điểm rủi ro.** Ghi chú nhỏ (không chặn): `VP018` đang hardcode fallback trong `employeeType` — nên chuyển sang field `employee_type` trong danh bạ khi tiện.
- Đọc lại `CHANGELOG.md` + 5 directive theo thứ tự. Không đụng app cũ `dona-report` port 3860.
- `DIRECTIVE_MOBILE_UX.md`: giữ bản mobile đã dựng; test lại Chrome headless CEO + DN001 tại 375/390/414px, 8 tab chính → `48/48` pass, không overflow/header overlap; cập nhật screenshots trong `artifacts/mobile_ux_20260703/`.
- `DIRECTIVE_NUMBER_FORMAT_VN.md`: chuẩn helper `web/src/util.js`: tiền `1.000.000đ`, rút gọn dùng phẩy VN (`2,67 tỷ`), `%` dùng `90,6%`; tooltip chart dùng tiền đầy đủ; Telegram/smart bỏ khoảng trắng trước `đ` và đổi `%` sang dấu phẩy.
- `DIRECTIVE_TARGET_ADMIN.md`: thêm service `server/src/targetAdmin.js` với resolver `manual > upload > appsale > ai > legacy`; `/targets` và forecast lấy toàn bộ đội sale/CTV active, neo forecast theo T06, loại VP018/telesale khỏi Target/Dự báo/cảnh báo; có pro-rate target kỳ đang chạy; thêm admin APIs upload preview/commit/rollback, sửa tay, AI propose/apply, history; UI Target thêm tab “Quản target”. Runtime `users.json` đã tag `employee_type`, code có fallback `VP018=telesale`.
- `DIRECTIVE_AUTO_REFRESH.md`: chạy lại materializer idempotent, T07 vẫn `2.668.987.096đ` (MISA `2.118.313.496đ` + WEB `550.673.600đ`), T06 giữ `28.403.136.096đ`; không drift về `2.670.947.096đ`.
- `reportnew-tgbot`: CEO đã duyệt, đã `pm2 restart reportnew-tgbot && pm2 save`; process online, unstable restarts 0; NLQ local trả T06/T07 đúng và format `-6,6%`, `-90,6%`.
- Nghiệm thu: `node --check` các file server touched OK, `npm run build` OK; API local `/targets`, `/targets/forecast`, `/admin/targets` đều 35 NV/CTV, không có VP018, forecast `next_ky=07.2026` neo `06.2026`.
- Chưa restart live `reportnew` cho phần code frontend/backend mới trong commit này; cần CEO duyệt riêng nếu muốn nạp lên production ngay.

### 2026-07-03 — CEO DUYỆT restart `reportnew` nạp scheduler auto-refresh
- CEO gửi `approve_restart_reportnew_scheduler`; đã chạy `pm2 restart reportnew && pm2 save` chỉ với app mới `reportnew`.
- Verify sau restart: `reportnew` online, health `http://localhost:3873/api/health` OK; log có `[revenue-refresh] scheduler armed` với `enabled=true`, timezone `Asia/Bangkok`, 60 phút, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`.
- Kiểm số code-first sau restart: T06 `28.403.136.096đ`, T07 `2.668.987.096đ` — không drift.
- Old app `dona-report` port 3860 vẫn online, không restart/không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — CEO chốt: telesale KHÔNG giao target
- **VP018 (telesale) KHÔNG giao target.** Loại telesale khỏi danh sách Target/Dự báo, %đạt, cảnh báo "chưa đạt", ranking theo target. Vẫn giữ danh bạ (loại `telesale`, active); doanh thu vẫn tính tổng công ty. Cập nhật `DIRECTIVE_TARGET_ADMIN.md`. Chờ CEO: danh sách telesale khác + xác nhận đội NV sale.
- CEO nhấn: **2.668.987.096đ mới đúng** (khớp app cũ). Rủi ro: scheduler chạy lại materialize mỗi giờ, nếu không áp PA-A → cộng lại 1,96tr → nhảy về 2.670.947.096 sai.
- **Chốt:** script materialize của scheduler PHẢI áp đủ (gán kỳ + PA-A + loại đơn khe), **idempotent tuyệt đối** → mỗi lần refresh T07 luôn = 2.668.987.096đ. Bot verify sau ≥1 chu kỳ auto-refresh; lệch thì dừng báo Claude. Ghi `DIRECTIVE_AUTO_REFRESH.md`.
- CEO: hiển thị số theo chuẩn kế toán VN (`1.000đ` / `1.000.000đ` / `2.670.947.096đ`, dấu chấm hàng nghìn). → [`DIRECTIVE_NUMBER_FORMAT_VN.md`](DIRECTIVE_NUMBER_FORMAT_VN.md).
- Bỏ kiểu US `2.67 tỷ` (chấm thập phân); nếu rút gọn dùng `2,67 tỷ` (phẩy). %: `90,6%`. Áp KPI/thẻ/bảng/CST/Target/Excel/bản tin/tooltip; trục chart rút gọn chuẩn VN. Chuẩn hóa ở helper chung; phối MOBILE để số không cắt mép. Chỉ đổi hiển thị.
- CEO phản ánh Target Dự báo **sai/thiếu**; VP018 là telesale lẫn vào NV sale; nhắc Target admin (file+tự động) chưa làm. → [`DIRECTIVE_TARGET_ADMIN.md`](DIRECTIVE_TARGET_ADMIN.md) (ưu tiên).
- **Sửa ngay:** danh sách Target/Dự báo lấy TOÀN BỘ đội sale active (neo theo T06 đủ, không dựa T07 dở → hết sót NV); thêm **loại NV** (sale/telesale/ctv/khác), tách telesale (VP018) khỏi NV sale.
- **Xây Target admin** (SPEC_TARGET_MULTISOURCE): nhập file (preview/commit/rollback) + tự động App Sale (nếu có) + AI đề xuất→CEO áp dụng + sửa tay; resolver manual>upload>appsale>ai; pro-rate kỳ đang chạy.
- **Chờ CEO:** telesale có target riêng hay không tính; danh sách telesale; đội NV sale đúng gồm mã nào.

### 2026-07-03 — Bot triển khai (Report Bot) — Dựng lại mobile responsive 375–414px
- Đọc `DIRECTIVE_MOBILE_UX.md`; sửa responsive ở `web/src/styles.css` theo mobile-first ≤640px, không đổi số liệu/quyền.
- Chống tràn ngang toàn app: `body/#root` khóa overflow-x, card/grid/chart/donut/list/filter full-width, KPI mobile 1 cột, tên dài wrap/ellipsis, giá trị `.amt` giữ `flex:none` để số bên phải không bị cắt.
- Header sticky không đè nội dung: siết chiều cao/padding, tên NV ellipsis; bottom-nav giữ trong viewport, 390px trở xuống ưu tiên icon để không chen vỡ.
- Bảng chi tiết mobile đổi sang dạng card dọc bằng CSS (`.data-table` block cards), không còn scroll ngang trong “DT đầy đủ”.
- Test Chrome headless local: CEO + DN001, viewport 375/390/414, 8 tab chính; kết quả `48/48` pass, không horizontal overflow, không header overlap. Artifact: `artifacts/mobile_ux_20260703/mobile_check.json` + screenshots Tổng quan/Phân tích/CST.
- Build OK: `npm run build`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — DUYỆT quy tắc gán kỳ + lưu ý khe cắt Lumos
- **Duyệt** rule bot: MISA theo ngày xuất HĐ (`revenue_date`); WEB Partner theo **kỳ đơn đặt `orders.created_at` (giờ VN)** rồi xét giao đủ — replicate app cũ. Đơn đặt cuối tháng trước, giao tháng sau KHÔNG kéo sang kỳ sau.
- **Lưu ý 1 (một lần, tại ranh giới):** đơn WEB đặt 30/6 giao 1/7 (`DT-260630-0115`, 1,96tr) rơi vào khe — T06 đóng băng Lumos không có, T07 loại theo ngày đặt. Negligible; nếu CEO muốn đủ tuyệt đối → carryover adjustment có duyệt (chưa làm).
- **Lưu ý 2 (lâu dài):** cần định nghĩa "khi nào 1 tháng CHỐT CỨNG" — nên để tháng vừa qua còn refresh vài ngày để bắt đơn giao trễ (đơn đặt cuối tháng, giao đầu tháng sau) rồi mới đóng. Bot đã có hướng carryover/kỳ-còn-mở; chốt mốc đóng kỳ khi làm scheduler.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive dựng lại bản MOBILE (CEO phản ánh)
- CEO gửi ảnh mobile (tài khoản NV): **giá trị bên phải bị cắt, header đè nội dung, cơ cấu tràn ngang, cuộn ngang**. → [`DIRECTIVE_MOBILE_UX.md`](DIRECTIVE_MOBILE_UX.md), ưu tiên cao (NV dùng điện thoại).
- Yêu cầu: ≤414px không tràn ngang; dòng "tên—giá trị" giá trị luôn hiện + tên ellipsis/wrap; header không đè; KPI 1 cột; combobox/chart/bottom-nav vừa màn hình. Sửa ở khung/CSS dùng chung cho MỌI trang; không đổi số/quyền. Test 375/390/414px cả CEO + NV.

### 2026-07-03 — Bot triển khai (Report Bot) — Scheduler auto-refresh doanh thu theo khung giờ CEO chốt
- Đọc `DIRECTIVE_AUTO_REFRESH.md` và dựng backend scheduler `server/src/revenueRefresh.js`: mặc định mỗi 60 phút, timezone `Asia/Bangkok`, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`; cấu hình env `REVENUE_REFRESH_MINUTES`, `REVENUE_REFRESH_WEEKDAY`, `REVENUE_REFRESH_SAT`, `REVENUE_REFRESH_SUN`, `REVENUE_REFRESH_ENABLED`.
- Scheduler chạy đúng kỳ đang chạy, có single-flight/in-flight guard, chống chạy trùng slot, ngoài khung thì skip không gọi MISA; lỗi thì giữ số cũ.
- Bổ sung hook snapshot MISA tùy cấu hình: `APPSALE_MISA_SYNC_COMMAND` hoặc `APPSALE_MISA_SYNC_URL` + `APPSALE_MISA_SYNC_TOKEN`; nếu chưa cấu hình thì dùng snapshot MISA success mới nhất trong DB, không để trắng số.
- Refactor `server/scripts/materialize_july_revenue.js` thành materializer theo `REVENUE_REFRESH_KY`/kỳ hiện tại, vẫn giữ rule 2 nguồn và rule WEB Partner theo kỳ đơn đặt; ghi `data_as_of` vào active slot.
- Thêm API admin `/api/admin/revenue-refresh/status` và `/api/admin/revenue-refresh/run`; Overview hiển thị “Cập nhật đến HH:MM ngày dd/mm” và nút admin “↻ Làm mới”.
- Nghiệm thu local: `node --check` OK, `npm run build` OK; chạy materializer T07 giữ đúng `2.668.987.096đ` (MISA `2.118.313.496đ`, WEB `550.673.600đ`), T06 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Chốt khung giờ auto-refresh (tiết kiệm token)
- CEO chốt khung giờ chạy (giờ VN): **T2–T6 07:30–18:30**, **T7 07:30–13:00**, **CN nghỉ**. Vẫn mỗi 60'. Ngoài khung không gọi MISA (giảm ~60% lần gọi). Cấu hình env. Cập nhật `DIRECTIVE_AUTO_REFRESH.md`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive tự cập nhật doanh thu mỗi 1 giờ (CEO chốt B)
- CEO chốt nhịp **B = mỗi 1 giờ** cho auto-refresh doanh thu kỳ đang chạy. → [`DIRECTIVE_AUTO_REFRESH.md`](DIRECTIVE_AUTO_REFRESH.md).
- Scheduler 60' (env `REVENUE_REFRESH_MINUTES`, khung giờ tuỳ chọn): chụp snapshot MISA → materialize kỳ đang chạy (MISA xuất HĐ + WEB đã giao đủ) → ghi `data_as_of`. Chỉ kỳ đang chạy; kỳ đã đóng giữ nguyên. Idempotent, lỗi thì giữ số cũ.
- Frontend: nhãn "Cập nhật đến HH:MM" + nút "↻ Làm mới" (admin). **NV không thao tác gì — mở app thấy số mới nhất trong 1 giờ, theo scope của mình.** MISA chỉ gọi ~1 lần/giờ.

### 2026-07-03 — Bot triển khai (Report Bot) — Restart tgbot + chốt rule gán kỳ doanh thu
- CEO duyệt restart Telegram worker: đã chạy `pm2 restart reportnew-tgbot` + `pm2 save`; process `reportnew-tgbot` online, backend `http://localhost:3873`, log mới không có error sau restart.
- Trả lời 3 câu rule gán kỳ trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`: CRM MISA theo `revenue_date`/ngày xuất HĐ; APP WEB Partner replicate app cũ theo kỳ đơn đặt `orders.created_at` (Asia/Bangkok), sau đó xét giao đủ/đã thực hiện; không kéo đơn cuối tháng trước sang kỳ sau chỉ vì `responded_at` nằm tháng sau.
- Làm rõ `DT-260630-0115/WEB:2188`: không tính T07 để khớp app cũ; không tự cộng ngược T06 vì 01–06 đang đóng băng Lumos. Nếu cần full carryover thì phải mở adjustment riêng có duyệt.
- Cập nhật `SPEC_DATASOURCE_CUTOVER.md` + `DIRECTIVE_ENABLE_JULY_REVENUE.md`; không đổi runtime revenue, T07 vẫn `2.668.987.096đ`.

### 2026-07-03 — Bot triển khai (Report Bot) — UI polish + Analysis/CST UX + typeahead toàn app
- Đọc `SPEC_ANALYSIS_CST_UX.md`, `DIRECTIVE_UI_POLISH_20260702.md`, `DIRECTIVE_TELEGRAM_NLQ.md`; T07 PA-A và Telegram NLQ đã kiểm lại vẫn đúng.
- Thêm combobox typeahead dùng chung cho bộ lọc Đơn vị/Sản phẩm/NV: tìm theo mã ĐV/tên ĐV, tên SP/mã QLNB/hoạt chất; option sản phẩm hiển thị chuỗi phân biệt QĐ/hoạt chất/hàm lượng/ĐVT/nhà thầu/giá thầu, value vẫn là `iit_code`.
- Backend `/api/filters` trả product option giàu metadata từ CST+revenue, lọc theo scope; `/products`, `/revenue?dimension=product`, export products/CST có thêm QĐ/thuộc tính phân biệt. CST export bỏ cột Giá bán.
- Tab CST: bỏ “Giá bán” trên card, thêm QĐ + hoạt chất/hàm lượng cho QĐ139, sửa “Nguồn” thành “Cập nhật đến kỳ/baseline + bán đến…”, thêm gợi ý hành động từng dòng, tiến độ đã bán/còn lại, ưu tiên dòng cần làm, chế độ gom theo Đơn vị + header tóm tắt.
- Tab Phân tích: thêm block `SP cần đẩy mạnh` và `SP sắp hết CST`; xuất artifact parity `artifacts/analysis_parity_20260703.md`.
- Tổng quan: đo hiệu năng artifact `artifacts/overview_perf_20260703.json`; tối ưu `/trend` từ ~10.064ms xuống ~545ms local bằng lightweight trend + memo 60s, KPI/số không đổi.
- Nghiệm thu: T06 `28.403.136.096đ`, T07 `2.668.987.096đ`, `node --check` OK, `npm run build` OK.

### 2026-07-03 — CEO DUYỆT restart Telegram worker (bật NLQ)
- **CEO đã DUYỆT** thao tác live: bot server `pm2 restart reportnew-tgbot` để nạp code NLQ + `pm2 save`. An toàn (login bot đang chạy, chỉ nạp code mới).
- Verify sau restart: `/start`, đăng nhập RP, `/digest_test` vẫn OK; hỏi tự nhiên "doanh thu tháng 6?" → trả lời đúng scope; user chưa map → chỉ hướng dẫn đăng nhập.
- Nhắc bot trả lời 3 câu **quy tắc gán kỳ** (ngày đặt vs ngày giao) trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`.


### 2026-07-03 — Bot triển khai (Report Bot) — Telegram NLQ + fix PA-A T07 đã chạy
- Đọc `DIRECTIVE_TELEGRAM_NLQ.md` và nối fallback Telegram vào `smart.answerQuestion` code-first: mã RP/lệnh `/start`, `/digest_test`, `/tat`, `/bat` giữ nguyên; user chưa map chỉ nhận hướng dẫn đăng nhập; user đã map được hỏi tự nhiên theo đúng scope Telegram → `emp_code` → `auth.scopeOf`.
- Bổ sung nhận diện kỳ trong câu hỏi nhanh (`tháng 6`, `T06`, `06.2026`...) để nghiệm thu CEO hỏi “doanh thu tháng 6” trả đúng kỳ thay vì mặc định latest.
- Chạy fix PA-A T07: re-materialize slot `07.2026`; WEB Partner còn `550.673.600đ` (67 rows/32 orders), CRM MISA `2.118.313.496đ` → Overview T07 `2.668.987.096đ` đúng chỉ đạo; T06 giữ nguyên `28.403.136.096đ`.
- Trace chênh `1.960.000đ`: loại khỏi T07 dòng `DT-260630-0115` / `WEB:2188` / Goutcolcin / DN008 / `164.PKĐK QUỐC TẾ HẠNH PHÚC` vì đơn tạo 30/06, phản hồi/giao 01/07; artifact `artifacts/july_revenue_paa_trace_20260702.json`.
- Nghiệm thu local: `node --check` OK; `smart.answerQuestion("doanh thu tháng 6")` CEO → `28.403.136.096đ`; DN008 hỏi T07 chỉ thấy scope DN008; `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec: ô lọc typeahead + phân biệt thuốc trùng tên
- CEO: 2 ô "Tất cả đơn vị"/"Tất cả sản phẩm" cho gõ tìm tiên đoán; thuốc trùng tên (VD "Alusi") cần phân biệt. → `SPEC_ANALYSIS_CST_UX.md` mục C2.
- **Gốc:** định danh sản phẩm = `iit_code` (mã QLNB), không phải tên; 1 tên ↔ nhiều mã QLNB (khác gói/QĐ, nhà thầu, ĐVT ml-gam/gói, giá).
- **Giải:** (A) combobox typeahead tìm theo tên+mã QLNB+hoạt chất; (B) mỗi option/thẻ hiện `tên · hoạt chất/hàm lượng · ĐVT · nhà thầu · QĐ · mã QLNB`, value = iit_code duy nhất; toggle "Gộp theo tên" ↔ "Tách theo mã QLNB".

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Telegram NLQ + nhắc fix T07 chưa chạy
- **Login bot mới LIVE** (`@DonaLoginReport_bot`, bot riêng tách agent) — `/digest_test` ra số OK, hết xung đột "gửi mã".
- **‼ Fix PA-A CHƯA CHẠY:** Overview T07 vẫn `2.670.947.096đ` (chưa loại 1,96tr đơn giao dở). Bot cần **re-materialize T07** (loại phần đã-giao đơn dở) → về `2.668.987.096đ`. Đang chờ bot chạy.
- **CEO yêu cầu bot hiểu ngôn ngữ tự nhiên** → [`DIRECTIVE_TELEGRAM_NLQ.md`](DIRECTIVE_TELEGRAM_NLQ.md): nối `smart.answerQuestion`/`/api/ai/ask` vào fallback `telegram-bot.js`. **Bảo mật: chỉ user đã map, scope đúng người hỏi (NV chỉ thấy mình), không bịa số.** Q&A = pull nên CTV ngoài được hỏi phần mình (guardrail chỉ chặn push).

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt PA A: pro-rate target kỳ đang chạy
- Kỳ đang chạy (VD T07 mới 2 ngày) so lũy kế với target cả tháng → đỏ oan. **Chốt chia target theo ngày:** `target_prorated = target_full × daysElapsed/daysInMonth`; `% đạt(nhịp) = DT trước VAT / target_prorated`. Kỳ đã đóng giữ target đủ.
- Áp: Overview %/vòng target, Target card NV, `buildAlerts` nhóm target, digest. Gắn nhãn "Kỳ đang chạy · đến ngày X (d/D)"; hiện rõ đang so mốc-nhịp + target cả tháng. Không pro-rate doanh thu. Ghi `SPEC_TARGET_MULTISOURCE.md`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt CHÍNH SÁCH: đơn giao dở KHÔNG tính (khớp app cũ)
- **CEO chốt PHƯƠNG ÁN A:** đơn giao dở dang → xếp trọn vào "còn nợ chưa giao", KHÔNG tính phần đã giao; chỉ đơn giao ĐỦ mới vào "đã thực hiện". Áp mọi kỳ.
- Bot sửa: loại phần đã-giao của đơn dở khỏi partner → T07 = **2.668.987.096đ** khớp app cũ 100% tại cùng snapshot (đơn 1,96tr được đưa về "còn nợ"). Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`. Nghiệm thu đối chiếu số app cũ, không ép số.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — MISMATCH T07: WEB dư 1.960.000đ (phải truy)
- CEO đồng bộ lại app cũ 23:42 (snapshot #27 official) → WEB **vẫn 550.673.600đ** → **bác bỏ** giả thuyết "phát sinh sau snapshot" của bot. Chênh 1,96tr là THẬT.
- **App Report WEB = 552.633.600 dư 1.960.000đ** so app cũ (550.673.600). MISA khớp tuyệt đối.
- **Nghi:** App Report tính SL ĐẶT thay vì **SL GIAO THỰC** cho đơn giao một phần, hoặc gộp nhầm "còn nợ chưa giao" (24,59tr, 1 đơn) vào "đã giao". Định nghĩa cũ: "đối tác đã thực hiện = SL giao thực × đơn giá", loại hủy + loại còn-nợ.
- **Áp nguyên tắc mismatch:** bot DỪNG, truy đúng đơn, sửa khớp định nghĩa → T07 phải = **2.668.987.096đ** tại cùng snapshot. KHÔNG ép số. Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bật doanh thu 07.2026 từ 2 nguồn MISA + APP WEB
- Đọc `DIRECTIVE_ENABLE_JULY_REVENUE.md` và điều tra lại code App Sale API: doanh thu App Report T07 phải dùng **CRM MISA đã xuất HĐ + APP WEB đối tác đã giao thực**, không dùng WEB ordered và không chỉ soi App Web :3970.
- Xác nhận công thức nguồn cũ: MISA đọc `misa_revenue_snapshot_lines` latest success run, `revenue_bucket in (official,pending)`, amount `invoice_export_amount`; Partner đọc latest `partner_order_line_responses`, amount `delivered_qty * order_items.price`, loại HOLD_GOLIVE/test/chưa giao.
- Thêm script idempotent `server/scripts/materialize_july_revenue.js` để materialize kỳ `07.2026` thành upload slot runtime, chỉ đọc DB App Sale/MISA snapshot và chỉ ghi data App Report New; 01–06 không đổi.
- Kết quả materialize hiện tại: CRM_MISA `2.118.313.496đ` (226 rows/66 orders) + APP_WEB_PARTNER `552.633.600đ` (68 rows/33 orders) = T07 `2.670.947.096đ`. Số MISA khớp ảnh CEO; **partner cao hơn ảnh `1.960.000đ` — Claude review: giả thuyết "tăng sau snapshot" đã bị CEO bác bỏ (re-sync 23:42 vẫn 550.673.600), cần truy đơn (mục MISMATCH trên).**
- Nghiệm thu: `store.listPeriods()` có `07.2026`, `latestKy=07.2026`, T06 vẫn `28.403.136.096đ`, T07 `2.670.947.096đ`, không có mã NV rác; `node --check` OK; `npm run build` OK. Artifacts: `artifacts/july_revenue_2source_investigation_20260702.md`, `artifacts/july_revenue_2source_materialize_20260702.md/json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — ĐÍNH CHÍNH: doanh thu có 2 nguồn (CRM MISA + APP WEB)
- CEO gửi ảnh "CRM MISA — Đối chiếu doanh thu đa chiều" (app Đặt hàng cũ): T07 tính đến 20:29 02/07 = **tổng đặt 3.175.523.336đ, đã thực hiện 2.668.987.096đ, 125 đơn**.
- **Đính chính khảo sát trước:** bot báo "T07 chỉ 2 đơn" vì **chỉ soi APP WEB (:3970), SÓT nguồn CRM MISA** (phần lớn ~80%). Doanh thu App Report = **CRM MISA (xuất HĐ) + APP WEB (đã giao)**.
- **Định nghĩa "doanh thu thực" đã rõ:** `đã thực hiện = MISA xuất HĐ + WEB đã xuất/giao` (loại chưa xuất HĐ/chưa phản hồi/còn nợ/HOLD/hủy) → đáp án cho câu "trạng thái nào = đã bán".
- Cập nhật `DIRECTIVE_ENABLE_JULY_REVENUE.md` (gộp 2 nguồn, điều tra lại MISA snapshot) + `SPEC_DATASOURCE_CUTOVER.md` mục A. Bot điều tra lại 2 nguồn → adapter kỳ 07 gộp cả hai → đối chiếu khớp báo cáo cũ.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive polish UI (CEO feedback qua ảnh)
- [`DIRECTIVE_UI_POLISH_20260702.md`](DIRECTIVE_UI_POLISH_20260702.md): **H1** Tổng quan CHẬM → đo API, cache tổng hợp theo kỳ, lazy-load chart (ưu tiên). **H2** DT/SP: thêm số QĐ; QĐ139 thêm hoạt chất+hàm lượng (QĐ141 không). **H3** CST: bỏ "Giá bán" (trùng Giá thầu), thêm số QĐ, QĐ139 thêm hoạt chất+hàm lượng. **Nguồn**: đang hiển thị `01-MAY-26` gây hiểu nhầm → đổi thành kỳ dữ liệu thực (VD "đến 06.2026").
- Live PASS 2 (bot, commit e869bb0): remap `#N/A`→DN019, `83`(10 dòng)→DN021; 6 CTV status Cộng tác; 4 CTV ngoài `no_auto_notify`; tổng T06 = 28.403.136.096 giữ nguyên. **Duyệt.**

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review trace mã rác + chốt remap + PASS 2 danh bạ
- Review `emp_junk_trace_20260702.md`. **Chốt remap:** `83` (10 dòng CST Valesto/QĐ48 Cà Mau-Bạc Liêu, 1 dòng đã `DN021`) → **remap DN021** (chờ CEO xác nhận DN021 phụ trách Cà Mau-Bạc Liêu). `#N/A` (1 dòng 1.575.000đ tại 033 An Long Khánh) → bot dò chủ ĐV 033 rồi remap; vô chủ thì giữ "Chưa phân bổ". Tổng T06 giữ nguyên.
- **PASS 2 danh bạ (bot làm nốt):** sửa `DN021` status → **Cộng tác** (commit b701dec set nhầm "Đang làm"); thêm/đổi `DN002`(Hằng Nga)/`DN004`(Ngọc Quyên) + `DN022`/`DN023`; áp `no_auto_notify=true` cho DN021/022/023/VP004 (DN002/004 email nội bộ — không áp). 6 CTV đều role sale/active/**có target tính đầy đủ**.
- Duyệt cách xử mã rác của bot (cách ly `UNALLOCATED`/"Chưa phân bổ", không xóa, tổng T06 = 28.403.136.096 giữ nguyên).

### 2026-07-02 — Bot triển khai (Report Bot) — PASS 2 emp master: remap #N/A/83 + CTV guardrail
- Đã làm mục 3/4 trong `DIRECTIVE_FIX_EMP_MASTER.md` bản mới. Remap dữ liệu runtime có backup artifact trước/sau, không đụng app cũ 3860.
- Remap `83 → DN021`: 10 dòng CST Valesto/QĐ48 tỉnh Cà Mau-Bạc Liêu, giữ nguyên `bid_qty_initial=460.000`, `sold_qty=12.000`, `sold_amount=21.600.000`, chỉ đổi chủ sang DN021 và lưu `raw_emp_code=83`.
- Remap `#N/A → DN019`: dòng Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu active T06 `1.575.000đ`, SL `10`, giữ nguyên số; cũng remap slot 06 inactive cũ để rollback không tái phát mã rác.
- PASS 2 danh bạ: `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` status `Cộng tác`, role `sale`, active/tính đủ doanh thu-target-cảnh báo-ranking. Áp `no_auto_notify=true` cho 4 CTV ngoài `DN021/DN022/DN023/VP004`; DN002/DN004 không khóa gửi tự động.
- Guardrail digest: `telegram-bot.js` bỏ qua user `no_auto_notify` trong bản tin/nhắc target chủ động; vẫn cho đăng nhập/xem dữ liệu pull.
- Nghiệm thu: T06 vẫn `28.403.136.096đ`; không còn `#N/A`, `83`, hoặc `UNALLOCATED` trong runtime; `DN019` nhận `1.575.000đ`; DN021 có 10 dòng CST remap; `node --check` OK; `npm run build` OK. Artifact: `artifacts/emp_master_pass2_20260702.md/json`, `artifacts/emp_master_pass2_20260702_before.json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive: thêm DN021/VP004 + truy mã rác #N/A, 83
- CEO phát hiện qua ảnh: dropdown lọc NV có `#N/A` và `83`; card Target hiện mã trần `DN021`, `VP004`. → [`DIRECTIVE_FIX_EMP_MASTER.md`](DIRECTIVE_FIX_EMP_MASTER.md).
- **Thêm 2 NV vào danh bạ:** `DN021` Lê Anh Đức (0906107109, ducluatsu98@yahoo.com.vn) role sale; `VP004` Trần Hoàng Trung (0378970463). Cập nhật danh bạ runtime + auth OTP + crosswalk emp_code.
- **VP004 = CỘNG TÁC VIÊN** (CEO chốt: chuyển qua làm cộng tác): status "Cộng tác" (active, vẫn tính doanh thu), scope phần mình; target chỉ tính khi CEO giao. Chuẩn hóa 3 trạng thái NV: Đang làm / Cộng tác / Nghỉ việc.
- **Danh sách CTV sale (CEO chốt):** `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` → status Cộng tác. Bot đổi status mã đã có; mã thiếu (`DN022`/`DN023`) chờ CEO cấp tên+SĐT để thêm + OTP.
- **CTV CÓ giao target (CEO chốt):** CTV tính ĐẦY ĐỦ như sale chính thức (doanh thu + target + % đạt + cảnh báo chưa đạt + ranking); chỉ khác NHÃN "Cộng tác". Bỏ quy tắc "target tùy chọn/không hiện đỏ" nêu trước đó.
- **⛔ GUARDRAIL (CEO chốt, bắt buộc):** KHÓA gửi tự động (email/Zalo/Telegram digest) thông báo đạt/thiếu target + nhắc thông tin cho 4 CTV ngoài `DN021`/`DN022`/`DN023`/`VP004` (`no_auto_notify=true`). Chỉ gửi khi CEO yêu cầu + duyệt trước. Họ vẫn đăng nhập xem phần mình (pull OK, push KHÓA). Ghi trong `DIRECTIVE_FIX_EMP_MASTER.md`.
- **Truy mã rác `#N/A`/`83`:** giả thuyết lỗi Excel + `raw_nv` chưa map. Bot truy nguồn (slot/dòng/tiền/đơn vị/raw_nv) → **remap về đúng NV, GIỮ tổng T06 = 28.403.136.096**, không xóa lặng; vô chủ → gom "Chưa phân bổ". Bộ lọc NV chỉ nhận mã hợp lệ `DN###/VP###`. Xuất artifact trace → Claude review trước khi remap.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix danh bạ NV + chặn mã rác #N/A/83
- Thực hiện `DIRECTIVE_FIX_EMP_MASTER.md`: thêm `DN021 — Lê Anh Đức` và `VP004 — Trần Hoàng Trung` vào `server/data/users.json` để card hiện tên và OTP tra được theo SĐT. `DN021` status `Đang làm`; `VP004` status `Cộng tác` nhưng vẫn role `sale`/active, target chỉ tính khi có target thật.
- Backend bổ sung chuẩn hóa mã NV runtime: chỉ `DN###`/`VP###` là mã NV thật; mã rác như `#N/A`, `83` được giữ dòng nhưng chuyển nhãn thành `UNALLOCATED` / `Chưa phân bổ`, không còn lẫn vào dropdown/card như nhân viên thật. Tổng doanh thu không đổi.
- Trace read-only mã rác: `artifacts/emp_junk_trace_20260702.md/json`. Active upload có 1 dòng `#N/A` kỳ 06.2026, Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu `1.575.000đ`; CST có 10 dòng `83` Valesto/QĐ48 Cà Mau-Bạc Liêu, bid_qty `460.000`, sold `12.000`, sold_amount `21.600.000`; 1 dòng có `sales_emps=DN021` nhưng chưa remap file nguồn trước khi Claude/CEO duyệt.
- Cập nhật lại artifact mục G `crosswalk_emp_code`: App Sale employees `31`, App Report users `37`, match exact code `30`; App Sale-only còn `1` là `VP019` kế toán. `DN021`/`VP004` hết blocker phân quyền 07.
- Nghiệm thu: `node --check` các file backend OK; `npm run build` OK; T06 vẫn `28.403.136.096đ`; runtime không còn mã NV `#N/A`/`83`, có nhóm `Chưa phân bổ`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Spec: parity Phân tích + CST dễ hiểu + lọc theo mã ĐV
- CEO yêu cầu 3 việc → ghi [`SPEC_ANALYSIS_CST_UX.md`](SPEC_ANALYSIS_CST_UX.md):
- **A) Phân tích parity:** bot trích full feature tab `pt` cũ (`report-main-v23.js`/`report-extra.js`) → bảng đối chiếu → bù thiếu (dự kiến: SP cần đẩy mạnh, SP sắp hết CST, phân tích chuyên sâu, PDF). Xuất artifact parity trước khi code.
- **B) CST dễ hiểu cho NV:** giữ tính năng + 4 lớp (gợi ý hành động từng dòng, gom theo ĐV rollup, tiến độ rõ + hạn hợp đồng, ưu tiên dòng cần làm). Độc lập nguồn — làm ngay.
- **C) Lọc theo TỪNG mã ĐV** (CEO nhấn mạnh): ô chọn ĐV nổi bật + tìm nhanh → header tóm tắt ĐV → danh sách CHỈ mã QLNB của ĐV đó; scope-aware (NV chỉ thấy ĐV của mình); áp CST+DT+Phân tích. Chủ yếu nâng UX, tái dùng param `unit`.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục G adapter SHADOW CST + crosswalk emp_code
- Đã chạy mục G ở chế độ **read-only/shadow**: không ghi App Sale, không ghi Lumos, không thay nguồn runtime App Report, không restart/deploy.
- Artifact mới: `artifacts/cutover_g/crosswalk_emp_code.json`, `cst_shadow_adapter_20260702.json`, `g_shadow_summary.md`, `worklist_lumos_static.json`, `worklist_appsale_allocation_hold.json`, `report_sync_contract_proposal.md`.
- Crosswalk `emp_code`: App Sale `31` employees, App Report `35` users; match exact code `28`; App Sale thiếu trong App Report `3` (`DN021`, `VP004` inactive, `VP019` kế toán); App Report-only `7` (`CEO`, `VP017`, `VP003`, `VP010`, `VP013`, `VP015`, `VP016`). Đây là blocker cần review trước sync doanh thu/phân quyền 07.
- CST shadow App Sale CL từ `2026-07-01`: timeline `2` order_item, gom `2` CST keys, cả `2/2` match baseline; approved-like qty `0` vì status hiện `PARTNER_RESPONDED_FULL|pending` và `HOLD_GOLIVE|pending`; ordered-eligible qty `3.000`, amount `2.940.000`. Chưa có key không match baseline trong timeline 07.
- Xuất 2 worklist theo quyết định mục G: `10` Lumos-only giữ STATIC để tổ thầu xác nhận hiệu lực; `45` App-only HOLD chờ nhập allocation/cst_quota. Đã đề xuất contract `/api/report-sync/changes?updated_since=` + service token, có cursor/idempotent/event_id.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt F + bật đèn xanh adapter SHADOW (mục G)
- Review kết quả F của bot (match **99,64%**, crosswalk tường minh, tách `107`, gộp KHU C). **Duyệt.** Ghi mục G vào `SPEC_DATASOURCE_CUTOVER.md`.
- **55 dòng lệch — không chặn shadow:** 9 Lumos-only chưa rõ hiệu lực → **giữ STATIC** (an toàn vì không có trong App Sale, không có gì trừ vào); 45 App-only thiếu allocation → **HOLD** (doanh thu vẫn tính, CST chờ tổ thầu nhập cơ số). → 2 **worklist cho tổ thầu** rà master allocation App Sale (song song).
- **Việc tiếp bot (read-only, chưa cắt Lumos):** (1) adapter SHADOW CST đối chiếu vs baseline; (2) **crosswalk `emp_code`** (chốt chặn cho sync doanh thu 07 + phân quyền); (3) xuất 2 worklist; (4) đề xuất contract `/api/report-sync/changes` + service token.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt quyết định crosswalk CL (mục F)
- Review crosswalk bot (khớp 99,6%, 2731/2741). **Duyệt rule "gói từ QĐ trong QLNB, fallback goi_code"** (goi_code mù chỉ 82,1%). Ghi mục F vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Nguyên tắc:** crosswalk = **bảng ánh xạ tường minh** (`crosswalk_units/products/bidpkg.json`), KHÔNG dùng chuẩn hóa chuỗi 3-số làm khóa runtime (thứ gây bug T06 + đụng 107).
- **4 quyết định:** (1) `001 + KHU C` → **gộp chung, CỘNG cơ số** (cùng BV, đúng app cũ; CEO xác nhận); (2) prefix `107` đụng 2 ĐV → tách tay trong bảng ánh xạ, không map bằng 3 số; (3) 10 key Lumos-only → phân loại hết hạn (giữ tĩnh) / còn hiệu lực (map hoặc flag GAP cho CEO); (4) 44 key App-only → gói mới App Sale, đưa vào nếu có allocation hợp lệ.
- **Trạng thái:** bot dọn 4 nhóm → mục tiêu ≈100% → mới viết adapter SHADOW (chưa cắt Lumos). Báo lại tỉ lệ + danh sách lệch để Claude review.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục F datasource cutover: crosswalk tường minh
- Đã pull/đọc `SPEC_DATASOURCE_CUTOVER.md` mục F và dựng artifact crosswalk tường minh read-only, không ghi App Sale/Lumos, không bật adapter/cutover.
- Tạo các bảng nháp: `artifacts/cutover_f/crosswalk_units.json`, `crosswalk_products.json`, `crosswalk_bidpkg.json`, cùng kết quả `f_crosswalk_result.json/md`. Runtime tương lai phải dùng bảng này, không dùng chuẩn hóa 3 số trực tiếp.
- Áp rule đã chốt: gói thầu lấy `QĐ` từ mã QLNB trước, fallback `goi_code`; `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` map chung target `001`; prefix `107` tách explicit thành `107_DUC_HUE` và `107_TAN_THANH` để tránh gộp sai.
- Kết quả sau explicit crosswalk: App Sale CL `3.002` offering rows / `2.776` explicit keys; Lumos CST `2.741` keys; match `2.731` = `99,64%`; còn `10` Lumos-only, `45` App-only, `226` duplicate App keys do 001/KHU C cần cộng timeline chung.
- Phân loại App-only: `0` key có allocation hợp lệ trong `cst_quota`, `45` key phải HOLD vì thiếu `cst_ban_dau_import/cst_chinh/cst_con_lai_import`. Lumos-only: `1` dòng thiếu IIT giữ static; `9` dòng còn lại chưa phân loại hết hạn/còn hiệu lực vì `cst_real.json` không có `hd_den_ngay` — cần nguồn allocation gốc/hiệu lực trước khi shadow adapter.

### 2026-07-02 — Bot triển khai (Report Bot) — Crosswalk CL-scope App Sale ↔ Lumos
- Đã đọc `SPEC_DATASOURCE_CUTOVER.md` mục C/E và chạy bước 1 **crosswalk CL-scope** read-only, không ghi App Sale, không cắt Lumos.
- Nguồn App Sale: `unit_offerings.route='CL'` join `units/products/contractors`; nguồn Lumos/App Report: CST baseline `store.getCst()`.
- Kết quả chính sau rule **lấy gói từ QĐ trong mã QLNB trước, fallback `goi_code`**: App Sale CL `3.002` offering rows, `2.775` key; Lumos CST `2.741` key; match `2.731` key = `99,6%` theo Lumos. Nếu lấy mù `goi_code`, match chỉ `82,1%`, nên không dùng `goi_code` trực tiếp cho CST adapter.
- Chưa đạt 1:1 hoàn toàn: còn `10` Lumos-only key, `44` App-only key; `227` duplicate App normalized key, trong đó `226` do `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` collapse về `001`, và `1` do prefix `107` trùng 2 đơn vị khác nhau. Artifact: `artifacts/crosswalk_cl_20260702.md`, `artifacts/crosswalk_cl_20260702_summary.json`, `artifacts/crosswalk_cl_20260702_variant_bid_from_iit.json`.
- Kết luận: **chưa bật adapter/cutover**; cần Claude/CEO chốt rule `001-KHU C` và xử lý các key thiếu trước khi viết adapter shadow.

### 2026-07-02 — Bot triển khai (Report Bot) — Biểu đồ Recharts theo kỳ + scope
- Cài `recharts@3.9.1`; thêm `GET /trend` trả `[{ky, revenue, revenueBeforeVat, targetTotal, pctTarget}]` cho mọi kỳ theo `scopeOf`.
- Tổng quan: thêm line chart doanh thu theo kỳ + overlay target, highlight kỳ đang chọn; thêm vòng tiến độ target theo bộ lọc Tháng/Quý/Khoảng; thêm bar chart Top 10 Đơn vị/Sản phẩm.
- Phân tích: chuyển sang dùng PeriodFilter Tháng/Quý/Khoảng; thêm Top 10 Đơn vị/Sản phẩm và 3 donut Tuyến / Nhà thầu / Gói thầu, top 6 + gộp `Khác`; backend `/analysis` bổ sung `byBidPackage`.
- Target: thêm PeriodFilter và vòng nhỏ % đạt trên từng card NV, màu xanh ≥100%, vàng 80–99%, đỏ <80%.
- Nghiệm thu kỹ thuật: `npm run build` OK; API check admin/sale OK (`/trend`, `/overview?from=04.2026&to=06.2026`, `/analysis`, sale DN016 chỉ thấy DN016). Bundle đã tách chunk: `index` gzip ~18,59KB, `recharts` gzip ~167,29KB; Vite còn cảnh báo chunk recharts >500KB minified nhưng build thành công.

### 2026-07-02 — Bot triển khai (Report Bot) — Guard rủi ro biên CST upload merge
- **Xác minh rủi ro baseline trễ nhiều kỳ:** baseline CST hiện có `source_from_date=01-MAY-26`, suy ra `baselineCoveredKy=05.2026`; sau guard chỉ merge các upload slot active có `ky > baselineCoveredKy`, hiện chỉ `06.2026`. Nếu sau này re-dump baseline mới hơn, slot `<= baselineCoveredKy` sẽ không bị cộng lại để tránh double-count; nếu baseline trễ >1 kỳ thì sẽ cộng tất cả slot sau mốc baseline, không chỉ latest.
- **Xác minh rủi ro khóa đơn vị 3 số:** đếm baseline CST theo key `normIit + normUnit` cho 2.741 dòng, duplicate key = `0`; upload receiver bị cộng vào >1 dòng = `0`. Đã thêm guard: nếu tương lai key CST baseline trùng >1 dòng thì bỏ merge key đó và phải điều tra/phân bổ riêng, không cộng cùng upload vào nhiều dòng.
- **Recheck:** RELIPOREX vẫn bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO vẫn bán `3.180`, còn `24`, `0,7%`. Artifact: `artifacts/cst_merge_guard_check_20260702.json`. `npm run build` OK.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt sync doanh thu 01/07 + thiết kế Target đa nguồn
- **CEO duyệt:** bot triển khai **đồng bộ doanh thu từ 01/07/2026** từ App Sale (không chỉ shadow). Ghi 4 điều bắt buộc vào `SPEC_DATASOURCE_CUTOVER.md` mục A: (1) crosswalk `emp_code` sống còn cho phân quyền; (2) liên tục thực thể xuyên kỳ cắt; (3) xác nhận VAT trước/sau; (4) kênh (CL+NCL+NT?) + net theo trạng thái.
- **Thiết kế Target đa nguồn** [`SPEC_TARGET_MULTISOURCE.md`](SPEC_TARGET_MULTISOURCE.md): 3–4 nguồn (App Sale auto / AI đề xuất / Upload / sửa tay) → mô hình **nhiều ứng viên + resolver chọn active**; ưu tiên manual>upload>appsale>ai; **AI chỉ ra ứng viên, không tự chốt**; không đè ngầm ô CEO đã khóa; UI Target admin 4 cột đối chiếu + audit.
- **Cần xác nhận:** App Sale có quản lý **target theo NV/kỳ** không (khảo sát mới thấy đơn hàng+CST). Có → 3 nguồn; chưa → làm AI+Upload+sửa tay trước, chừa adapter App Sale.
- **Trạng thái:** spec sẵn sàng cho bot; chưa cắt Lumos, sync 07 chạy khi crosswalk emp/ĐV/SP xong.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review khảo sát API App Sale + chốt Model A
- **Bot khảo sát read-only API App Sale (:3970)** (artifact `appsale_api_cutover_survey_20260702.md`). Claude review → ghi mục E vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Chốt Model = A (neo baseline Lumos):** App Sale CHƯA có đủ lũy kế bán trước 07/2026 → giữ baseline Lumos, App Sale chỉ trừ dần từ 01/07 (đính chính: bot ghi "Model B" nhưng mô tả đúng Model A).
- **Blocker phải xử trước:** (1) mã chưa khớp (SP 371/318, ĐV 195/108) → dựng crosswalk **chỉ trong phạm vi kênh CL**; (2) định nghĩa "net" bằng TRẠNG THÁI (approved/delivered/invoiced, loại CANCELLED/rejected); (3) cần App Sale bổ sung endpoint incremental `/api/report-sync/changes?updated_since=` + service token.
- **Thuận lợi:** App Sale đã có cột `cst_ban_dau_import/cst_con_lai_import` (nghi baseline từ Lumos) → cần đối chiếu; bán/timeline đủ ID/timestamp/trạng thái/cờ kênh CL/nối gói thầu.
- **Trạng thái:** KHÔNG cắt Lumos. Việc tiếp bot: crosswalk CL + đối chiếu cst_con_lai_import + đề xuất contract API + adapter SHADOW đối chiếu.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Thiết kế cutover nguồn dữ liệu Lumos → App Sale New
- **CEO đề xuất:** từ 07/2026 ngắt Lumos, đồng bộ trực tiếp từ **App Sale New** (public `appsaletest.donapharm.asia` → API `:3970`); doanh thu 01–06/2026 (Lumos) đóng băng backup; CST chốt 1 snapshot baseline tại 01/07/2026.
- **Viết spec** [`SPEC_DATASOURCE_CUTOVER.md`](SPEC_DATASOURCE_CUTOVER.md): tách DOANH THU (đóng băng lịch sử + live tương lai, rủi ro thấp) vs **CST** (baseline + trừ dần, rủi ro cao).
- **6 rủi ro CST chí mạng** phải xử lý trước khi cắt: (1) khóa khớp 2 hệ `IIT+đơn vị+gói thầu`; (2) chiều gói thầu QĐ139/141; (3) chỉ kênh CL; (4) **nguồn allocation gói mới sau 01/07**; (5) bán ròng (net trả hàng); (6) chống đếm trùng (ID duy nhất + cursor idempotent).
- **4 câu hỏi bot phải khảo sát API App Sale trước khi cắt** (mã có khớp Lumos? cờ kênh? ID giao dịch + incremental? có quản lý allocation?).
- **Thứ tự an toàn:** khảo sát API → adapter chạy SONG SONG đối chiếu → đóng băng T06 final + snapshot CST 01/07 → delta=0 → mới cắt Lumos. Không đụng app cũ 3860; App Sale chỉ đọc.
- **Trạng thái:** thiết kế + checklist sẵn sàng; **chờ bot trả lời 4 câu khảo sát API** để chốt hợp đồng API chi tiết.
- **CẬP NHẬT (CEO chốt):** Q4 = **CÓ** — App Sale quản lý gói thầu/allocation → nguồn cấp cơ số mới nằm ở App Sale. Kéo kiểu **timeline theo trạng thái thực**. Phát sinh **1 câu kiến trúc mới**: App Sale có đủ dữ liệu gói CŨ (allocation + lũy kế bán trước 07) không → quyết **Model B** (đọc thẳng, bỏ baseline Lumos) hay **Model A** (neo baseline Lumos 01/07 + trừ dần). Đã mở rộng brief khảo sát API (7 mục) cho bot chạy TRƯỚC khi cắt.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt spec Telegram Digest V2 (chi tiết)
- **Duyệt đề xuất Digest V2** (CEO + bot đề xuất): nâng bản tin 1 dòng → báo cáo nhanh có **top 3–5 từng mục** (Doanh thu / Target NV / CST sắp cạn / Đơn vị giảm mạnh / Gợi ý xử lý).
- **Viết spec chi tiết** vào `SPEC_TELEGRAM_DIGEST.md` (PHẦN B2) để bot triển khai: map 1–1 từng mục vào `smart.buildAlerts()` (4 nhóm sẵn) + `overviewKpis()` → **KHÔNG tính lại trong bot, số khớp app 100%**.
- **5 điểm review bắt buộc:** (1) 2 khuôn theo scope — NV sale ra "của bạn", không lộ số người khác; (2) empty-state tích cực (✅) không để mục trống; (3) định dạng số kiểu VN (phẩy thập phân, `28,40 tỷ` / `650tr`); (4) top N + giới hạn <3500 ký tự; (5) gửi PLAIN TEXT (không `parse_mode`) tránh vỡ Markdown do tên đơn vị/SP.
- **Lệnh:** `/digest_test` (chi tiết, mọi user map ra digest của mình theo scope), `/digest_short` (bản 1 dòng cũ), `/digest_full` (top 5); định kỳ 07:30 VN dùng bản V2 top 3.
- **Trạng thái:** spec sẵn sàng, **chờ bot triển khai + build/restart `reportnew-tgbot`** rồi Claude review số liệu. Chưa đụng code app (đúng phân vai).

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 Telegram go-live
- **Nhận token BotFather riêng cho `@Reportdonapharm_bot` và cấu hình runtime an toàn:** ghi `TELEGRAM_BOT_TOKEN` vào `.env` local/server (không commit), giữ `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot`, `TELEGRAM_BOT_SECRET` 64 ký tự, `APP_PUBLIC_URL=https://reportnew.donapharm.asia`.
- **Verify bot thật:** Bot API `getMe` trả `username=Reportdonapharm_bot`, `id=8471035818`. PM2 worker `reportnew-tgbot` đã start online và `pm2 save`.
- **Map CEO Telegram:** map `telegram_id=1748199545` → `CEO`; restart `reportnew` + `reportnew-tgbot` để nạp mapping bền.
- **Nghiệm thu Login V2 backend:** `/api/auth/mode` trả `{live:true,demo:false,telegram:true}`; flow `telegram/start → telegram/confirm(secret_bot, telegram_id CEO) → telegram/status` trả token; `/api/me` bằng token Telegram trả `emp_code=CEO`, `role=admin`, `isAdmin=true`.
- **Nghiệm thu bot gửi tin:** gửi message qua Bot API tới CEO thành công. Sếp có thể gửi `/digest_test` vào `@Reportdonapharm_bot` để test đúng handler digest chủ động từ Telegram update.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_CHARTS** (Recharts, CEO duyệt): 4 biểu đồ — (1) đường DT theo kỳ + overlay target (Tổng quan, backend mới GET /trend), (2) cột top đơn vị/SP (tái dùng /revenue), (3) donut cơ cấu tuyến/nhà thầu/gói (tái dùng /analysis), (4) vòng tiến độ target (Tổng quan + Target). Tất cả theo bộ lọc kỳ + scope. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Fix CST trừ thiếu upload kỳ mới nhất
- **Điều tra không ép số:** trace 2 ca CEO nêu cho thấy `cst_real.json` là baseline đã trừ SALES_REPORT DB đến trước kỳ upload mới nhất, nhưng App Report New chưa cộng phần upload `06.2026` giống app cũ. Lỗi là thiếu bước merge upload hiện tại theo khóa `IIT_CODE + DONVI chuẩn hóa`, không phải sai `GIVEN_QUANTITY`.
- **Sửa công thức CST runtime:** `store.getCst()` nay lấy baseline `cst_real.json` rồi cộng slot upload active mới nhất (hiện `06.2026`) cho tuyến CL theo khóa `IIT_CODE + mã đơn vị chuẩn hóa`; chuẩn hóa đơn vị xử lý cả dạng `002` và `002.BVĐK...`, giữ merge `001.BVĐK Đồng Nai-KHU C → 001.BVĐK Đồng Nai`. Cập nhật `sold_qty`, `remain_qty`, `% còn`, `sold_amount`, `remain_amount`; không sửa/ép file nguồn.
- **Sửa trạng thái UI:** CST còn `<=1%` được hiển thị `Hết CST` như app cũ (còn lẻ do quy cách/đóng gói), ngoài trường hợp còn `0`.
- **Nghiệm thu:** RELIPOREX 4000 IU @ `002.BVĐK Thống Nhất ĐN` từ baseline bán `31.600` + upload 06 `1.800` = bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO @ `001.BVĐK Đồng Nai` từ baseline bán `1.560` + upload 06 `1.620` = bán `3.180`, còn `24`, `0,7%` và UI `Hết CST`. Thêm 5 mẫu đối chiếu diff `0` trong `artifacts/cst_verify_after_upload_merge_20260702.json`. `npm run build` OK.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix múi giờ Telegram digest
- **Sửa scheduler digest theo giờ VN:** `DIGEST_CRON` vẫn hiểu là giờ Việt Nam (`Asia/Bangkok/Ho_Chi_Minh`), nhưng khi so với `Date#getUTCHours()` nay đổi sang `targetUtcHour = (cron.hour - 7 + 24) % 24`. Vì vậy `30 7 * * *` bắn đúng **07:30 VN** (= 00:30 UTC), không lệch sang 14:30 VN.
- **Log rõ giờ:** worker in cả giờ VN và giờ UTC tương ứng để dễ kiểm tra vận hành.
- **Test:** mô phỏng cron mặc định + cron phút kế tiếp theo giờ VN OK; `node --check server/telegram-bot.js` OK; `npm run build` OK. Chưa nghiệm thu live vì vẫn chờ `TELEGRAM_BOT_TOKEN` thật.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — REVIEW
- **Duyệt Phần A (rolling session)**: an toàn (chặn phiên hết hạn; deviceId đã có thì không cho đổi máy). Hết lỗi bắt OTP lại khi dùng cùng máy.
- **⚠ Phần B (digest) LỖI MÚI GIỜ:** DIGEST_CRON "30 7" là 7:30 VN nhưng scheduler so getUTCHours()===7 → bắn 14:30 VN. Cần đổi VN(UTC+7)→UTC: targetUtcHour=(hour-7+24)%24. Logic còn lại (scope/loại NV nghỉ/opt-out/chống trùng) OK.
- **Ghi SCOPE điều chuyển:** đặt trong App Report (khu Quản trị), làm SAU, không hồi tố lịch sử.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_TELEGRAM_DIGEST
- **Phần A — sửa phiên đăng nhập:** đổi session từ TTL tuyệt đối 60 phút sang rolling idle TTL `SESSION_IDLE_DAYS` ngày (mặc định 7). Mỗi request có token hợp lệ gia hạn `expires_at = now + IDLE_TTL`; backend đọc `X-Device-Id` trong `requireAuth`, bind cho session cũ chưa có deviceId và touch đúng thiết bị, tránh cùng máy bị tính thiết bị thứ 4 oan. Upload preview cũng gửi `X-Device-Id`.
- **Giữ kiểm soát thiết bị:** vẫn tối đa 3 thiết bị/NV, evict thiết bị cũ nhất, purge session/device khi đổi SĐT/quyền/xóa NV, admin vẫn xem/xóa thiết bị.
- **Phần B — bản tin Telegram chủ động:** thêm scheduler trong `server/telegram-bot.js` theo `DIGEST_CRON` (mặc định `30 7 * * *`, giờ VN). Bản tin sáng dùng số theo scope: CEO/admin toàn công ty, sale theo mã NV; chỉ gửi Telegram đã map và user còn active/có doanh thu kỳ mới nhất; lưu opt-out bền bằng `/tat`, bật lại `/bat`, chống trùng theo ngày; admin có `/digest_test` gửi thử cho chính mình.
- **Trạng thái live:** phần B vẫn chờ `TELEGRAM_BOT_TOKEN` thật của `@Reportdonapharm_bot` để worker chạy và nghiệm thu thực tế.
- **Nghiệm thu kỹ thuật:** test rolling/device bằng `AUTH_DATA_DIR` tạm OK; `node --check server/telegram-bot.js` OK; `npm run build` OK.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Duyệt báo cáo parity + chốt SCOPE_DECISIONS** (CEO quyết): LÀM = biểu đồ Recharts (4 chart), PDF/print, Target admin (nhập/sửa + AI đề xuất), Tab Nhân viên BẢN GỌN (+cờ nghỉ việc, không PII nhạy cảm), Tab Đối chiếu read-only, hoạt chất/nhóm thuốc. CẮT = Điều chuyển NV, thưởng 3P/gửi Zalo-Email, sửa kho master. SAU = export mẫu cũ/page-size, upload loại khác, AI nối sâu. Bot theo SCOPE_DECISIONS.md.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_PERIOD_FILTER Tổng quan
- **Pull spec:** đã pull `a30e0b7` và triển khai `SPEC_PERIOD_FILTER.md` cho Dashboard Tổng quan.
- **Bộ lọc kỳ mới:** thay chip tháng phẳng bằng `PeriodFilter` 3 chế độ Tháng/Quý/Khoảng, mặc định tháng mới nhất, có nút ‹/› tháng và nhãn rõ `Tháng 06.2026`, `Quý 2/2026 (04–06)`, `01.2026 → 06.2026`.
- **Backend range:** thêm `store.getRowsRange`, `getTargetsRange`, `periodRange`, `previousKys`; các API tổng hợp chính nhận `ky` hoặc `from+to`; MoM so kỳ liền trước cùng độ dài; target cộng theo range.
- **CST:** giữ snapshot hiện tại, không đổi theo kỳ/range; KPI và alert ghi rõ “hiện tại”.
- **Layout:** KPI Tổng quan PC 6 cột đều, màn vừa 3×2, mobile 2 cột; 4 nhóm cảnh báo luôn hiển thị cân đối 2×2 hoặc 4 cột, không còn card lẻ.
- **Nghiệm thu:** Q2/2026 doanh thu `93.596.229.347` = cộng tay 04+05+06, MoM `+11,7%`, CST cạn `288`; khoảng 01→06 doanh thu `177.386.533.614` = cộng tay 6 tháng, CST vẫn `288`. DN009 Q2 đúng scope: doanh thu `8.446.239.852`, `empCount=1`, CST cạn `10`. Build OK, live browser kiểm PC 1440: KPI 6 cột + alert 2×2; PC 1920: alert 4 cột; mobile 390: KPI 2 cột.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_TELEGRAM_DIGEST** (CEO duyệt): (A) SỬA phiên đăng nhập — rolling session gia hạn theo hoạt động + thiết bị tin cậy hạn 7 ngày (env SESSION_IDLE_DAYS) + deviceId ổn định (hết bắt OTP lại khi dùng cùng máy); (B) Bản tin Telegram chủ động (sáng CEO + sáng NV theo scope, chỉ NV đã map & đang hoạt động, opt-out /tat, chống trùng, cron). Bot triển khai.


### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_PERIOD_FILTER** (bộ lọc kỳ: Tháng/Quý/Khoảng, mặc định tháng mới nhất, ‹›lùi/tới; backend nhận ky HOẶC from-to gộp nhiều tháng; MoM so kỳ liền trước cùng độ dài; CST là snapshot không đổi theo kỳ) + cân đối dashboard (6 KPI đều hàng, 4 nhóm cảnh báo 2×2/4 cột không lẻ). Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — List UI theo mẫu Phân tích
- **CSS dùng chung:** thêm `.list-grid` + `.rank-card` để các danh sách tự opt-in thành lưới card 2–3 cột trên PC, mobile 1 cột; không đụng `.page-desktop`.
- **Doanh thu:** danh sách ranking chuyển sang card trong `.list-grid`, vẫn giữ hạng/tên/meta/bar/số tiền và drill-down NV → ĐV → SP.
- **Sản phẩm:** mỗi sản phẩm là card gọn gồm tên, mã QLNB, doanh thu, SL, độ phủ ĐV/NV/gói và bar.
- **Target:** cả tab “Kỳ này” và “Dự báo” chuyển thành lưới card NV 2–3 cột.
- **Cơ số thầu:** thay bảng ngang bằng card CST trong `.list-grid`, giữ thông tin chính app cũ: mã, thuốc, hoạt chất/hàm lượng/ĐVT, nhóm/UT, gói thầu, đơn vị, NV, giá, SL/TT bán-còn, % còn lại, ngày nguồn, trạng thái.
- **Test live:** build OK; PC 1440px hiển thị 2 cột đều, PC 1920px hiển thị 3 cột đều, mobile 390px hiển thị 1 cột; Revenue drill-down vẫn hoạt động.

### 2026-07-02 — Bot triển khai (Report Bot) — Overview mở rộng 6 KPI
- **Backend `overviewKpis`:** thêm `empTarget:{achieved,total}` tính theo NV đang bán trong kỳ và có target thật, đạt >=100% target trước VAT; thêm `cstLowCount` theo scope (`remain_pct < 10`). Giữ nguyên các KPI cũ.
- **Frontend Overview:** hàng KPI đổi thành 6 ô theo thứ tự CEO chốt: Doanh thu sau VAT + MoM, Trước VAT, Đạt target %, NV đạt target, Cơ số thầu sắp cạn, Quy mô kỳ. Ô “Cơ số thầu sắp cạn” tone đỏ và bấm được để nhảy sang tab CST lọc `<10%`.
- **Test:** build OK. CEO kỳ 06.2026: doanh thu `28.403.136.096`, trước VAT `27.050.605.806`, target `90%`, NV đạt target `7/20`, CST cạn `288`, quy mô `126 ĐV · 241 SP · 22 NV`. DN009 scope: target `108%`, NV đạt `1/1`, CST cạn `10`, quy mô `12 ĐV · 65 SP · 1 NV`.

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 guard khi chưa có token Telegram
- **Chuẩn bị go-live Login V2:** đã set `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot` trong `.env`; `TELEGRAM_BOT_SECRET` 64 ký tự giữ nguyên.
- **Siết an toàn `telegramConfigured()`:** chỉ trả `true` khi đủ `TELEGRAM_BOT_SECRET + TELEGRAM_BOT_USERNAME + TELEGRAM_BOT_TOKEN`; hiện token BotFather chưa được cung cấp nên `/api/auth/mode` trả `telegram:false`, màn login chỉ hiện OTP để tránh nút Telegram hỏng.
- **Build/restart:** `npm run build` OK, `pm2 restart reportnew` OK. Chờ CEO gửi token thật của @Reportdonapharm_bot để chạy `getMe`, start worker `reportnew-tgbot`, map CEO và nghiệm thu Login V2.

### 2026-07-02 — Bot triển khai (Report Bot) — Dashboard “Cần chú ý” V2 phân nhóm
- **Theo `SPEC_DASHBOARD_V2.md`:** backend `buildAlerts` đổi từ list phẳng sang `{ ky, summary, groups[] }`, tách nhóm `target`, `unit_down`, `cst_low`, `cst_high`, mỗi nhóm `total` + top 8.
- **Fix cảnh báo target:** chỉ duyệt `empCodesWithData(ky)` (NV đang bán), bắt buộc có target thật `>0`, bắt buộc resolve được tên trong danh bạ; loại NV nghỉ/không hợp lệ nên **DN014 không còn hiện “0% target”**.
- **Frontend Overview:** thêm strip tóm tắt “NV chưa đạt · đơn vị giảm · CST sắp cạn/tồn nhiều”, hiển thị các khối cảnh báo theo nhóm icon/màu riêng, top 5–8 dòng, nút “Xem tất cả” nhảy sang tab Target/Doanh thu/CST kèm lọc ban đầu. PC dùng `alerts-grid` nhiều cột; mobile giữ 1 cột.
- **Test:** build OK. CEO alerts: target `9`, unit_down `25`, cst_low `288`, cst_high `1533`, DN014 không xuất hiện; DN009 scope alerts chỉ còn phạm vi DN009 (`unit_down=3`, `cst_low=10`, `cst_high=30`, target `0`).

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_DASHBOARD_V2** (dashboard "Cần chú ý" smart): phân NHÓM (NV target / đơn vị giảm / CST cạn / CST tồn) thay danh sách phẳng 1857 dòng; mỗi nhóm top 5–8 + đếm + "Xem tất cả" nhảy tab lọc sẵn; **chỉ cảnh báo NV đang hoạt động** (có doanh thu trong kỳ) → loại NV nghỉ như DN014; luôn hiển thị tên (không resolve được → loại). buildAlerts đổi sang cấu trúc groups. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Đóng Bước 3 mục CST 2.741
- **Đóng mục 1/CST trong Bước 3 đối chiếu:** xác minh lại `store.getCst` app mới có **2.741 dòng**, `blankIit=1`, có dòng `Bividia 25 · 108. BVĐK LONG AN · DN001` với CST còn `44.000`, TT còn lại `79.200.000`.
- **Tổng CST khớp app cũ diff 0:** CST ban đầu `182.837.992`, SL đã bán `62.993.027`, SL còn `120.068.002`, TT còn lại `399.841.752.609`; DN009 vẫn **85 dòng** đúng scope.
- **Tài liệu:** cập nhật `MIGRATION_MATRIX.md` để đánh dấu CST 2.741 đã đóng theo chuẩn app cũ; artifact chuẩn vẫn là `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Upload tách Import mới / Import cập nhật
- **Xác minh LIVE sau pull/build/restart:** đăng nhập CEO/admin trên `https://reportnew.donapharm.asia` thấy mục **“⬆️ Upload”** trong navigation; code tab vẫn `adminOnly` và lọc bằng `me.isAdmin` từ `/api/me`.
- **Tách rõ 2 luồng Upload:** `Import mới (kỳ mới)` chỉ cho kỳ chưa có, nếu kỳ tồn tại thì chặn/gợi ý chuyển cập nhật; `Import cập nhật (kỳ hiện có)` chọn kỳ đang active và hiển thị cảnh báo thay dữ liệu kỳ hiện có bằng file mới, slot cũ giữ lại để rollback. Giữ tab `Lịch sử & khôi phục`.
- **Backend an toàn ghi đè:** preview vẫn parse/validate bằng backend, bổ sung `duplicateCount`; commit nhận `mode=new|update`, audit phân biệt `commit_new`/`commit_update`, lưu `replacedSlotId`, không xoá slot cũ. Rollback vẫn kích hoạt lại slot cũ cùng kỳ.
- **Test:** `npm run build` OK; test bằng backup/restore runtime: import mới kỳ thử tạo slot mới + phát hiện 1 dòng nghi trùng; import mới vào kỳ đã có bị chặn; import cập nhật kỳ 06.2026 tạo slot thay thế có `replacedSlotId`, audit đủ; rollback trả active về slot cũ. Sau test đã restore runtime upload slots/uploads/audit, không để lại dữ liệu thử.

### 2026-07-02 — Bot triển khai (Report Bot) — CST mismatch đã xử lý theo chốt giữ dòng thiếu mã QLNB
- **Theo chốt Claude/CEO:** giữ dòng CST thật thiếu `iit_code` (`Bividia 25` · `108. BVĐK LONG AN` · `DN001` · còn `44.000` · TT còn `79.200.000`) để chuẩn đối chiếu khớp app cũ **2.741 dòng**.
- **Sửa importer CST:** không còn đòi `iit_code`; filter CST chỉ còn điều kiện có `unit_code` và có số lượng thầu (`bid_qty_initial > 0`). Nguyên tắc chung: không loại dòng thật chỉ vì thiếu field phụ (`iit_code`...).
- **Downstream/UI:** mã QLNB rỗng hiển thị `—`; key dòng fallback bằng `product_name + unit + emp` để không gộp/đè; filter product theo `iit_code` không nhân đôi dòng rỗng, tìm kiếm vẫn thấy theo tên sản phẩm/đơn vị/NV.
- **Re-import + đối chiếu:** app mới CST **2.741 dòng**, tổng CST ban đầu **182.837.992**, SL đã bán **62.993.027**, SL còn **120.068.002**, TT còn lại **399.841.752.609** — khớp app cũ diff 0. DN009 vẫn **85 dòng**, `badScope=0`; build OK. Artifact: `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 mở rộng tạm DỪNG vì lệch CST
- **Đã bắt đầu đối chiếu mở rộng theo từng tab 01→06/2026** sau khi P0 CST đã push: Overview/Doanh thu/DT đầy đủ/Sản phẩm/Target/Phân tích đều đang khớp tổng kỳ ở phần đã kiểm.
- **DỪNG đúng quy tắc vì phát hiện lệch CST app cũ ↔ app mới:** nguồn app cũ `artifacts/cst_full_from_old.json` có **2.741 dòng**, app mới `server/data/cst_real.json` có **2.740 dòng**. Lệch đúng 1 dòng: `Bividia 25`, đơn vị `108. BVĐK LONG AN`, NV `DN001`, `iit_code` rỗng, CST ban đầu/còn lại **44.000**, giá thầu **1.800**, `TT còn lại` **79.200.000**. Importer hiện loại dòng này vì thiếu `iit_code`; chưa tự sửa/chưa ép khớp.
- **Artifact kiểm tra:** `artifacts/reconcile_tabs_until_cst_mismatch_20260702.json`. Chờ CEO/Claude quyết định: giữ dòng thiếu mã QLNB trong CST hay loại có chủ đích khỏi cả hai bên.

### 2026-07-02 — Bot triển khai (Report Bot) — P0 CST hoàn tất bảng + cảnh báo giống app cũ
- **Hoàn tất P0 CST theo ưu tiên CEO:** đổi tab CST từ card rút gọn sang **bảng ngang đầy đủ cột** kiểu app cũ: mã QL nội bộ, tên thuốc, hoạt chất, hàm lượng, ĐVT, nhóm, UT, gói thầu, đơn vị, NV phụ trách, giá thầu/giá bán, tổng TT, CST còn lại, % còn lại, tổng/SL đã bán, SL còn, TT đã bán, TT còn lại, ngày nguồn, trạng thái.
- **Cảnh báo/trạng thái CST theo logic app cũ:** Hết CST, ⚠️ Chưa bán, 🔴 Chưa khai thác, 🟡 Còn nhiều, ✅ Đang bán; thêm chip lọc nhanh “Chưa bán” + thống kê cảnh báo Sắp cạn/Hết CST, Chưa bán, Chưa khai thác/tồn nhiều ngay trên trang.
- **Backend/export:** `/api/cst` và export `cst.xlsx` nhận thêm `status=empty`; tìm kiếm CST bao gồm `sales_emps`; Excel CST xuất đủ cột nghiệp vụ. `import_cst.js` giữ thêm `raw_nv` và `sales_emps` từ artifact app cũ; đã re-import `server/data/cst_real.json` từ `artifacts/cst_full_from_old.json`.
- **Test:** `npm run build` OK. Kiểm số liệu trực tiếp: CEO CST **2.740 dòng**; DN009 CST **85 dòng**, `badScope=0`; CST `<10%` **291 dòng**; CST “Chưa bán” **1.228 dòng**. Chưa đụng app cũ `dona-report` cổng 3860.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 đối chiếu app cũ ↔ app mới
- **Đối chiếu doanh thu 01→06/2026 app cũ ↔ app mới: KHỚP 100%.** Đã ghi bảng vào `MIGRATION_MATRIX.md`: từng kỳ khớp số dòng, tổng tiền, số NV và dòng mẫu; diff toàn bộ = 0. Nguồn 01→03 là ORDS artifact đã dump theo logic app cũ, 04→06 là file upload app cũ. Không làm tròn/không tự chỉnh số.

### 2026-07-02 — Bot triển khai (Report Bot) — Mobile CSS P0
- **Chốt phần `styles.css` dở:** bổ sung padding đáy mobile có `safe-area`; test viewport ~375px sau khi scroll cuối trang còn hở **28px** trên bottom-nav, nội dung không bị nav che. _Build OK._

### 2026-07-02 — Bot triển khai (Report Bot) — LOGIN V2 (theo SPEC_LOGIN_V2)
- **Triển khai đủ màn đăng nhập V2: Telegram (chính) + Zalo OTP (dự phòng) + phiên 60' lưu bền + thiết bị tin cậy.**
- **Backend:**
  - `persist.js` (mới): lưu bền bằng file JSON atomic ở `server/data/auth/` (không thêm dependency). Chứa phiên/thiết bị/mapping/audit; đã thêm `server/data/auth/` vào `.gitignore`.
  - `auth.js`: phiên chuyển từ Map RAM → **lưu bền, TTL 60'** (lưu hash token, không lưu token thô), gắn `deviceId`; **tối đa 3 thiết bị tin cậy/tài khoản** — thiết bị thứ 4 tự đá thiết bị **cũ nhất** (`first_seen` cũ nhất) + audit + hủy phiên của nó; **tự hủy phiên+thiết bị khi đổi quyền/SĐT/xoá khỏi danh bạ** (kiểm tại `requireAuth`). Telegram login lifecycle với **4 quy tắc chống device-code phishing**: (1) bot hỏi ✅ mới confirm; (2) mã TTL 120s **dùng 1 lần**; (3) trình duyệt poll bằng `poll_secret` (không phải mã hiển thị) nên biết mã cũng không rút được token; (4) rate-limit tạo mã ≤5/phút/IP, poll ≥2s, `confirm` sai `secret_bot` → 403 + log. Mapping `telegram_id↔emp_code` **admin duyệt** trước.
  - `routes.js`: thêm `/auth/telegram/start|status|confirm`; admin `/admin/telegram-map` (GET/POST/DELETE), `/admin/devices` (GET, DELETE/:id); các route đăng nhập nhận `deviceId` (header `X-Device-Id`) + IP (Cloudflare) + UA; `/auth/mode` báo thêm `telegram`.
- **Frontend:** `Login.jsx` bố cục mới — tiêu đề *“Đăng nhập App Report”* + nút **Telegram (chính)** hiện mã `RP-XXXXXX` + link mở bot + đếm ngược 120s + poll `poll_secret` + cảnh báo chống phishing; **OTP Zalo dạng dự phòng** bên dưới (giữ nguyên luồng); giữ QR Zalo OA + demo. `api.js`: sinh `deviceId` bền (localStorage) gửi kèm mọi request, thêm `telegramStart/Status` + API admin thiết bị/mapping.
- **Worker:** `server/telegram-bot.js` (mới) — long-poll Bot API, nhận mã (kể cả deep-link `/start RP-...`), gửi nút **“✅ Xác nhận đăng nhập App Report lúc HH:MM”** + cảnh báo *“Không gửi mã này theo yêu cầu của người khác”*, chỉ khi bấm ✅ mới gọi `/auth/telegram/confirm` kèm `secret_bot`. `.env.example` thêm `TELEGRAM_BOT_SECRET/TOKEN/USERNAME` + `APP_BASE_URL` (không commit `.env`).
- **Nghiệm thu (HTTP thật trên instance tạm cổng 3899, KHÔNG đụng production 3873):**
  1. **Phân quyền:** CEO `admin`, `/overview 06.2026` = **28.403.136.096đ**; DN009 `sale`, `/cst` = **85 dòng** đúng scope; DN009 gọi `/admin/devices` → **403**. ✓
  2. **Telegram end-to-end:** start trả code+poll_secret+bot_link; confirm sai secret → **403**; telegram chưa map → **404 (“chưa được cấp quyền”)**; confirm đúng → ok; dùng lại mã → **409**; status bằng poll_secret → **confirmed + token**, `/me` = DN009; poll_secret sai → **expired**. ✓
  3. **Session bền:** kill process (port DOWN) → khởi động lại → **token cũ vẫn đăng nhập được** + mapping còn nguyên. ✓
  4. **Thiết bị:** đăng nhập 4 deviceId → còn **3**, thiết bị cũ nhất bị đá; admin xem/xoá được. ✓
  5. Build web OK; `node --check` toàn bộ file OK.
- **⚠ CÒN CHỜ để go-live Telegram:** cần **token bot RIÊNG qua @BotFather** (không dùng chung token bot OpenClaw) đặt `TELEGRAM_BOT_TOKEN` trong `.env` để chạy worker + test nút ✅ thật trên Telegram. Chưa deploy lên production 3873 (chờ CEO/Claude review). Zalo OTP giữ live-test riêng để tránh gửi OTP thật ngoài ý muốn.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **CEO chốt chuẩn UI desktop = trang "Phân tích"** (KPI ngang + panel 2–3 cột). Ghi vào `CLAUDE.md`. Việc tiếp cho bot: nâng các trang còn 1 cột dọc (Doanh thu, Sản phẩm, Target, CST) theo mẫu này trên PC; mobile giữ 1 cột.
- **Đồng bộ layout PC mọi trang (CEO yêu cầu).** Bỏ lưới auto-fill "tự chia cột" trên `.page-desktop` (nguyên nhân khung trắng trống + mỗi trang bể một kiểu khi bot thêm trang mới). Nay: mọi trang chảy dọc **full-width trong khung 1600px giữa màn**; phần nhiều cột khai báo tường minh — `.kpi-grid` (KPI 4 cột) và `.alerts-grid` mới (cảnh báo Overview, bọc trong `Overview.jsx`). _Test preview 1920px: Tổng quan/Doanh thu/DT đầy đủ/Sản phẩm/Phân tích/CST/Target tất cả card = 1536px đồng nhất, hết khung trống; mobile 375px giữ bottom-nav, 1 cột, không tràn ngang. ⚠ Bot: commit phần styles.css đang sửa dở TRƯỚC khi pull để tránh conflict._
- **Chốt SPEC màn đăng nhập V2** (`SPEC_LOGIN_V2.md`): Telegram login (chính, có chống device-code phishing: bot hỏi ✅ xác nhận, mã TTL 120s dùng 1 lần, poll bằng poll_secret, mapping telegram_id↔emp_code admin duyệt) + Zalo OTP (dự phòng, giữ nguyên) + **session 60' lưu bền (file/SQLite)** + **tối đa 3 thiết bị tin cậy/tài khoản** (thứ 4 đá cũ nhất, admin xem/xoá, tự hủy phiên khi đổi SĐT/quyền). Kèm tiêu chí nghiệm thu. _Bot server triển khai theo spec; Claude review sau khi push._

### 2026-07-02 — Bot triển khai (Report Bot)
- **Fix nhỏ P0/CST: đồng bộ lọc `filters.emp` trong `analytics.cstTable` với `store.getCst`.** `store.getCst` đã chuẩn hoá `.trim().toUpperCase()` cả mã NV trong scope lẫn mã NV trên từng dòng (dòng CST có thể chứa nhiều mã NV cách nhau dấu phẩy), nhưng `cstTable` lọc `filters.emp` lại so sánh nguyên văn → lệch hoa/thường thì trả 0 dòng. Nay `cstTable` chuẩn hoá cùng cách. Lý do: tránh NV/CEO lọc CST theo mã NV bị mất dòng chỉ vì khác hoa/thường. _Test: real data, `filters.emp="dn009"` (thường) và `"DN009"` (hoa) đều trả **85 dòng**, 100% dòng thuộc đúng scope DN009; `node --check` OK._

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Tiếp tục Đợt 2/P0: bổ sung “Doanh thu đầy đủ” + “Sản phẩm” + “Phân tích”.** Backend thêm API `/api/revenue/full` để xem từng dòng bán hàng có phân trang, `/api/products` để tổng hợp theo mã QLNB/sản phẩm, `/api/analysis` để so kỳ trước theo đơn vị/sản phẩm/tuyến/nhà thầu/UT. Export Excel thêm `revenue_full` và `products`, vẫn chạy qua backend và tôn trọng scope quyền.
- **Frontend thêm 3 tab nghiệp vụ:** `DT đầy đủ` hiển thị bảng chi tiết NV/tuyến/đơn vị/mã QLNB/sản phẩm/nhà thầu/gói/SL/doanh thu; `Sản phẩm` hiển thị top mã QLNB kèm độ phủ đơn vị/NV/gói thầu; `Phân tích` hiển thị tăng/giảm so kỳ trước và cơ cấu tuyến/nhà thầu/UT. Bộ lọc dùng chung với Doanh thu và chạy backend: kỳ/NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói/tìm kiếm.
- **Test:** `npm run build` OK. API smoke local: CEO kỳ `06.2026` `/revenue/full` thấy **2.001 dòng / 28.403.136.096đ**; DN009 thấy **130 dòng / 3.058.543.979đ** và kiểm 130/130 dòng đều `emp_code=DN009`; `/products` CEO thấy 241 mã, DN009 thấy 65 mã; `/analysis` CEO rowCount 2.001, DN009 rowCount 130. Export `revenue_full.xlsx` trả HTTP 200.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Bắt đầu Đợt 2/P0: thêm bộ lọc backend cho Doanh thu + CST và lập ma trận chuyển app cũ.** Thêm `MIGRATION_MATRIX.md` để theo dõi từng tab app cũ → app mới. API mới `/api/filters` trả danh sách NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói thầu theo quyền; `/api/revenue`, `/api/cst` và export Excel nay nhận bộ lọc backend (`emp`, `unit`, `product`, `route`, `priority`, `contractor`, `bid`, `q`). UI Doanh thu có bộ lọc kỳ/NV/ĐV/SP/tuyến/UT/nhà thầu/gói/tìm kiếm; UI CST có bộ lọc gói thầu/NV/ĐV/SP/UT/tìm kiếm và hiển thị thêm NV, giá thầu, TT đã bán, TT còn lại. Test: build OK, PM2 `reportnew` restart OK; public `/api/auth/mode` vẫn `{live:true,demo:false}`; API lọc DN009 kỳ 06 doanh thu trả **3.058.543.979đ**; CST DN009 `<10%` trả 10 dòng, sale scope không lộ dòng ngoài DN009.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn tất Đợt 1 nền dữ liệu để chuẩn bị sang Đợt 2.** Vì app cũ chỉ có file upload 04/05/06 trong `webapp_donapharm/data`, đã dump thêm 01/02/03.2026 trực tiếp từ ORDS `SALES_REPORT` theo logic app cũ rồi import bằng `server/scripts/import_legacy.js`. Kết quả active slots: 01.2026 `2.094` dòng / `21` NV / **32.509.346.732đ**; 02.2026 `1.308` dòng / `21` NV / **17.507.218.993đ**; 03.2026 `2.175` dòng / `21` NV / **33.773.738.542đ**; 04/05/06 giữ nguồn upload CEO đã chốt.
- **Target thật đã đủ 01→06.2026 trên server runtime.** Import 01/02/03 từ `erp-support-widget/server/nv-targets.json` (19 NV/kỳ, tổng **29.562.862.426đ**/kỳ); 04/05/06 dùng `PHARMA_NEW.V_TEM_TARGET_BONUS` kỳ 04 làm fallback app cũ (21 NV/kỳ, tổng **30.062.862.426đ**/kỳ).
- **Thêm importer CST thật và chuyển store sang ưu tiên `cst_real.json`.** Thêm `server/scripts/import_cst.js`; `store.getCst()` đọc `server/data/cst_real.json` nếu có, đồng thời lọc quyền NV kể cả dòng có nhiều mã NV phân tách dấu phẩy. Đã dump CST thật từ `V_TEMP_PHARMA` (`FROM_DATE` mới nhất <= tháng hiện tại, `TUYEN='CL'`, `GIVEN_QUANTITY>0`) + `SALES_REPORT` từ `DATE '2025-03-01'`, import được **2.740** dòng, **60** đơn vị, **301** sản phẩm, **19** NV; nguồn `source_from_date=01-MAY-26`. Test API: CEO `/cst` thấy 2.740 dòng; DN009 thấy 85 dòng, không có dòng ngoài DN009.
- **Kiểm API sau import:** `/periods` có 01→06.2026; `/overview?ky=01.2026` trả doanh thu **32.509.346.732đ**, `2.094` dòng, `21` NV; `/overview?ky=06.2026` vẫn **28.403.136.096đ**, `2.001` dòng, `22` NV; OTP live/demo off.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Rà nguồn TARGET/CST app cũ và import target thật theo logic fallback.** App cũ `webapp_donapharm` proxy `/api/targets` sang backend OTP `localhost:3848`; backend lưu local tại `erp-support-widget/server/nv-targets.json` với các kỳ `01.2026`→`04.2026`. Frontend cũ fallback DB `PHARMA_NEW.V_TEM_TARGET_BONUS`: `SELECT TEM_NUMBER, SUM(TARGET) TGT, MAX(TARGET_BONUS) TBONUS ... WHERE KY='<ky>' ... GROUP BY TEM_NUMBER`; nếu kỳ yêu cầu không có target thì chọn kỳ gần nhất `<= requested`. ORDS hiện không có `05.2026/06.2026`, kỳ mới nhất là `04.2026` (21 NV, tổng target **30.062.862.426đ**). Đã dump hiệu lực 04/05/06 theo fallback cũ vào `artifacts/targets_effective_202604_202606.json` và chạy `node server/scripts/import_targets.js`; `server/data/targets_real.json` local hiện có 63 bản ghi (21/kỳ cho 04–06).
- **Nguồn CST app cũ đã xác định cho dev viết importer.** Tab CST không dùng file cache chính; query ORDS trực tiếp: nguồn CST gốc từ `V_TEMP_PHARMA` với `FROM_DATE=(SELECT MAX(FROM_DATE) FROM V_TEMP_PHARMA WHERE FROM_DATE <= TRUNC(SYSDATE,'MM'))`, `TUYEN='CL'`, `GIVEN_QUANTITY>0`; lượng đã bán từ `SALES_REPORT` từ `DATE '2025-03-01'` group theo `(IIT_CODE, DONVI đã chuẩn hoá)`. Frontend tính `SL_CON = GIVEN_QUANTITY - SUM(QUANTITY)`, `% còn`, `TT_THẦU`, `TT_ĐÃ BÁN`, `TT_CÒN LẠI`; map NV CST bằng `NV`/`TEM_ID` qua `CST_NV_TO_EMP`. Đã dump mẫu 8 bản ghi tại `artifacts/cst_sample_from_old.json` cho dev đối chiếu importer.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Xác nhận OTP CEO sau bản `cbea728` và mở public `reportnew.donapharm.asia`.** Đã pull `cbea728` (map `full -> admin`), build, restart PM2 `reportnew` với `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`. Verify OTP thật số CEO trả `{ emp_code:"CEO", role:"admin" }`; `/api/me` trả `isAdmin:true`; `/api/overview?ky=06.2026` trả doanh thu toàn công ty **28.403.136.096đ**, `2001` dòng, `22` NV. Re-test scope sale bằng DN009: chỉ thấy **3.058.543.979đ**, `130` dòng, `empCount=1`. Sau khi đạt, đã đổi tunnel ingress `reportnew.donapharm.asia` từ `http_status:403` về `http://localhost:3873`, restart `cloudflared-reportnew`; public root/API trả 200, `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, browser thấy màn đăng nhập SĐT/OTP không có nút demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Pull lên commit `170e3be` và nạp danh bạ nhân viên thật cho OTP.** Nguồn danh bạ lấy từ `REPORT_USERS` của app cũ `webapp_donapharm/public/kho-dulieu.html`, xuất tạm sang JSON rồi chạy `node server/scripts/import_employees.js`; kết quả: **35 NV**, phân bố vai trò `admin: 1`, `sale: 34`, **thiếu SĐT: 0**, mẫu kiểm tra 2 NV OK. File tạm đã xoá; không commit PII/secrets.
- **Xác định chính xác API OTP nội bộ đang chạy ở port 3848.** App cũ `webapp_donapharm/server.js` chỉ proxy `POST /api/otp/request` và `POST /api/otp/verify` sang `127.0.0.1:3848`; backend thật là `erp-support-widget/server/index.js`. Gửi OTP: `POST http://localhost:3848/api/otp/request`, body tối thiểu `{ "phone": "<sdt>" }`, có thể thêm `{ "page": "Report", "deviceId": "<id>" }`; response thành công `{ ok:true, message:"..." }`. Xác thực: `POST http://localhost:3848/api/otp/verify`, body `{ "phone":"<sdt>", "code":"<otp>" }`; response đúng trả `{ ok:true, token, phone:<masked>, name, code, role, accounts, requireAccountChoice, expiresIn:86400 }`.
- **Bật OTP thật + tắt demo-login cho PM2 `reportnew` nhưng vẫn khóa public 403.** `.env` local đặt `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`; do backend chưa tự đọc dotenv, đã restart PM2 với env tương ứng và `pm2 save`. Kiểm tra local: `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, `/api/auth/otp/request` qua app mới trả `{ok:true}` với số CEO. Public `https://reportnew.donapharm.asia/` và `/api/health` vẫn **403**. **Còn chờ mã OTP nhận được để test `/api/auth/otp/verify` và kiểm quyền dữ liệu sau đăng nhập.**

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Kiểm thử Cloudflare Access cho `reportnew.donapharm.asia` chưa đạt, đã khóa lại public 403.** Sau khi CEO báo đã tạo Access app/policy email công ty, đã đổi tunnel ingress từ `http_status:403` về `http://localhost:3873` và restart PM2 `cloudflared-reportnew`; tuy nhiên kiểm bằng `curl` và browser vẫn vào thẳng App Report (`HTTP 200`, thấy màn login app), không xuất hiện màn Cloudflare Access. Để tránh lộ dữ liệu thật, đã rollback ingress về `http_status:403`; public root và `/api/health` hiện đều `403`, local `http://localhost:3873/api/health` vẫn OK.
- **Cần kiểm lại Cloudflare Zero Trust config trước khi mở lại:** Access application phải active đúng hostname `reportnew.donapharm.asia` (Self-hosted), policy allow email domain công ty, và không bị đặt sai team/account/path. Chỉ mở lại tunnel về `localhost:3873` sau khi public request bị redirect/chặn bởi Cloudflare Access.

### 2026-07-01 — Dev (Claude Code)
- **Target lọc NV theo ĐÚNG KỲ đang xem (sửa tiếp theo phản hồi bot).** `empCodesWithData` nhận `ky`: Target kỳ 06 chỉ hiện NV có bán KỲ 06 (DN014 bán 04 nhưng không bán 06 → không còn hiện ô 0 ở kỳ 06). Forecast dùng NV hoạt động ở kỳ gần nhất. _Test: NV kỳ 06 chỉ DN003, NV kỳ 04 có DN014._
- **Sửa Target lấy đúng danh sách NV + không dùng target mẫu khi có dữ liệu thật.** Trước đây Target/Dự báo liệt kê cả danh bạ công ty (nhiều NV target 0 không thuộc App Report). Nay: `store.empCodesWithData()` lấy NV **thực sự có doanh thu**; `/targets` và `forecastTargets` dùng danh sách này. `getTargets` khi có slot thật → chỉ dùng target thật (`targets_real.json`), chưa import thì target cũ = 0 (trung thực), không lấy target mẫu. Thêm `scripts/import_targets.js` để nạp target thật khi có. _Test: NV lấy từ dữ liệu, getTargets real-mode rỗng._
- **Sửa map vai trò: OTP backend trả `full` cho CEO/toàn quyền → nay map thành `admin`.** Trước đó `full` rơi về `sale` khiến CEO bị lọc như NV thường (doanh thu = 0). `normRole` thêm `full|admin|quan tri|manager|all → admin`. _Test: full→admin, sale→sale, Giám đốc→ceo. ⚠ Bot pull + restart rồi verify lại số CEO._
- **🔒 Khớp adapter OTP với backend thật + SỬA lỗ hổng.** Backend `/api/otp/verify` trả `{ok, code, name, role, accounts, requireAccountChoice}`. `verifyOtp` giờ **BẮT BUỘC kiểm `data.ok`** (trước chỉ kiểm HTTP → mã sai vẫn lọt!), dùng identity backend trả về (code/role/name), chuẩn hoá vai trò → ceo/admin/sale. Thêm bước **chọn tài khoản** khi 1 SĐT nhiều mã NV: route `/auth/otp/select` + verifiedPhones (TTL 5') + UI chọn ở Login. _⚠ Bot phải PULL bản này trước khi verify mã thật._
- **Công cụ nạp danh bạ nhân viên thật + chuẩn hoá SĐT.** Thêm `server/scripts/import_employees.js` (map linh hoạt mã NV/tên/SĐT/email/vai trò, chuẩn hoá SĐT +84/84→0, tự suy vai trò, backup users cũ). `auth.verifyOtp` tra cứu theo SĐT đã chuẩn hoá. _Test: "+84 917 396 668"→"0917396668", "Giám đốc"→ceo. Cần bot chạy trên file danh bạ thật._
- **UI đăng nhập OTP bằng SĐT (frontend).** `Login.jsx` đọc `/auth/mode`: nếu `live` → luồng SĐT → gửi OTP → nhập mã → vào (mỗi NV thấy phạm vi của mình); nếu `demo` → nút chọn tài khoản mẫu. api.js thêm `mode/otpRequest/otpVerify`. _Test: chế độ demo hiển thị đúng. Luồng OTP thật cần bot nối OTP backend + nạp danh bạ NV thật (đang chờ spec)._
- **Importer nạp CẢ THƯ MỤC (1 lệnh cho mọi kỳ).** `import_legacy.js` giờ nhận file HOẶC thư mục: quét mọi `report_upload_data_*<ngày>.json` (bỏ qua lastUpload/slots), nạp hết, in **bảng tổng từng kỳ** + cảnh báo kỳ trùng file. _Dùng để lấy đủ dữ liệu từ 01/2026: `node server/scripts/import_legacy.js <thư-mục-data-app-cũ>`. Test batch 01+02 OK._
- **⚠ Cảnh báo bảo mật + công tắc tắt demo-login.** Dữ liệu đã THẬT nhưng site chưa bật Cloudflare Access và đăng nhập còn là nút demo → nguy cơ lộ. Thêm env `ALLOW_DEMO_LOGIN` (mặc định 1): đặt `=0` để KHOÁ demo-login (`mockLogin` trả null, `/auth/demo-users` rỗng, `/auth/mode` trả `demo:false`). _Khuyến nghị: bot bật Cloudflare Access NGAY; khi có OTP thì đặt ALLOW_DEMO_LOGIN=0._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Khóa tạm public access cho `reportnew.donapharm.asia` để bảo vệ dữ liệu thật.** Khi yêu cầu bật Cloudflare Access, dashboard Zero Trust bị Cloudflare security verification trong browser headless nên chưa thao tác UI được ngay. Để chặn truy cập công khai lập tức, đã backup `~/.cloudflared/reportnew.yml` và đổi ingress `reportnew.donapharm.asia` sang `http_status:403`, restart PM2 `cloudflared-reportnew`. Kiểm tra public root và `/api/health` đều trả `HTTP/2 403`; local `http://localhost:3873/api/health` vẫn OK, PM2 `reportnew` vẫn online.
- **Còn cần bật Cloudflare Access đúng chuẩn trong Zero Trust.** Sau khi tạo Access application/policy cho domain `reportnew.donapharm.asia` (allow email domain công ty), đổi lại tunnel service về `http://localhost:3873` và restart `cloudflared-reportnew`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật importer và import lại dữ liệu thật 04/05/06 cho `reportnew`.** Đã `git pull` lên commit `f49f91d`, `npm run build`, import đúng các file chuẩn theo `report_uploadSlots.json` app cũ: `report_upload_data_20260401_20260430.json`, `report_upload_data_20260501_20260529.json`, `report_upload_data_20260601_20260630.json`. Sau import đã restart PM2 `reportnew`; health local và HTTPS đều OK. App cũ `dona-report` cổng `3860` chỉ đọc file, không sửa/xoá.
- **Kết quả import active:** 04.2026 — 2.282 dòng, 21 NV, tổng doanh thu `34.794.142.431đ`, slot `legacy_042026_mr26j8be`; 05.2026 — 1.600 dòng, 21 NV, tổng `30.398.950.820đ`, slot `legacy_052026_mr26j8h9`; 06.2026 — 2.001 dòng, 22 NV, tổng `28.403.136.096đ`, slot `legacy_062026_mr26j8nb`.
- **Kiểm mẫu dữ liệu sau import:** cả 3 kỳ đã có đủ `unit_name`, `product_name`, `contractor_code`, `bid_package`. Ví dụ 04: `001.BVĐK Đồng Nai` / `Vixcar` / `02.AFP PHARMA` / `QĐ139`; 05: `171.PKĐK NAM VIỆT` / `Cerecaps` / `Công Ty Tnhh Dược Phẩm Donapharm` / `QĐ141`; 06: `019.TTYT H. Vĩnh Cửu` / `Nadecin 10mg` / `Công Ty Tnhh Dược Phẩm Và Trang Thiết Bị Y Tế Đại Trường Sơn` / `QĐ139`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật server `reportnew` lên bản mới nhất.** Đã `git pull` tới commit `4935eb1` (`Migrate dữ liệu app cũ: import_legacy.js + sửa đọc số kiểu VN`), chạy `npm run build`, restart PM2 `reportnew` trên cổng `3873`; health local và HTTPS đều trả `{"ok":true,"service":"app-report-new",...}`. Không đụng app cũ `dona-report` cổng `3860`.
- **Import thử dữ liệu thật kỳ 06.2026 từ app cũ.** Nguồn đọc-only: `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_20260601_20260630.json`; kết quả import: 2.001 dòng hợp lệ / 2.001, 22 NV, tổng doanh thu `28.403.136.096đ`, slot active `legacy_062026_mr266eqe`. Đã restart `reportnew` sau import thử.
- **Dừng chưa import tiếp 04/05 do thiếu map alias tên cột.** Mẫu sau import chỉ có `unit_code`, `emp_code`, `iit_code`, `quantity`, `revenue`; thiếu `unit_name`, `product_name`, `contractor_code` vì file cũ dùng các cột `DONVI`, `ITEM_NAME`/`IIT_NAME`/`NAME`, `NHA_THAU`/`VEN_NAME`. Cần dev bổ sung alias trong `server/scripts/import_legacy.js` trước khi import các kỳ còn lại để báo cáo không mất tên đơn vị/tên thuốc/nhà thầu.

### 2026-07-01 — Dev (Claude Code)
- **Importer tự suy kỳ chắc hơn.** Suy `ky/dateFrom/dateTo` theo thứ tự: tham số > tên file (nhận CẢ `YYYY-MM-DD` lẫn `YYYYMMDD`) > nội dung dòng (`KY/FROM_DATE`). _Bot chỉ cần `node import_legacy.js <file>` cho mọi kỳ. Test: tên file nén → suy đúng 06.2026._
- **Bổ sung map cột ERP app cũ (theo mẫu bot gửi).** import_legacy + upload nhận thêm: `ITEM_NAME/IIT_NAME/NAME`→tên SP, `NHA_THAU/VEN_NAME`→nhà thầu, `TUYEN`→tuyến; fallback `unit_name=unit_code` (DONVI gộp mã+tên), và **tự trích gói thầu `QĐ139/QĐ141` từ mã IIT**. _Test: dòng mẫu ERP → đủ route/đơn vị/tên SP/nhà thầu/gói thầu. Doanh thu T06 đã khớp 28.403.136.096đ._
- **Công cụ migrate dữ liệu app cũ.** Thêm `server/scripts/import_legacy.js`: chuyển file `report_upload_data_*.json` của app cũ → slot của app mới (map linh hoạt tên cột, tự suy kỳ từ tên file, đánh dấu active, ghi audit, in tóm tắt để kiểm tra). _Chạy trên server nơi có file thật._
- **Sửa lỗi đọc số kiểu VN.** "22.500.000" (chấm ngăn nghìn) trước bị đọc thành 0 → thêm `toNum()` xử lý đúng cho cả `import_legacy.js` và `upload.js`. _Test: tổng 67.5tr đúng._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Deploy demo `reportnew.donapharm.asia` thành công theo phương án không ảnh hưởng app cũ.** Vì các cổng `3860`/`3861`/`3863` đang được app hiện hữu sử dụng, App Report New chạy PM2 `reportnew` trên cổng trống `3873` với `USE_SAMPLE_DATA=1`; `curl http://localhost:3873/api/health` trả `{"ok":true,"service":"app-report-new",...}`. App cũ `dona-report` trên `3860` giữ nguyên.
- **Cloudflare Tunnel riêng cho Report New.** Đã login Cloudflare, tạo tunnel `reportnew` (`746c53e5-4098-43bd-848f-9b74e8a41f63`), route DNS `reportnew.donapharm.asia`, tạo config `~/.cloudflared/reportnew.yml` trỏ `http://localhost:3873`, chạy bằng PM2 `cloudflared-reportnew` để không restart tunnel chung. HTTPS `https://reportnew.donapharm.asia` trả `HTTP/2 200`.
- **Kiểm thử giao diện.** Mở `https://reportnew.donapharm.asia` thấy màn đăng nhập/logo DNPHARMA; bấm demo CEO đăng nhập được dashboard Tổng quan với dữ liệu mẫu. Lưu ý: chưa bật Cloudflare Access, OTP/SSO/ORDS/AI vẫn để trống theo yêu cầu demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Chuẩn bị deploy demo `reportnew.donapharm.asia` trên server.** Đã clone repo nhánh `main`, đọc đủ chỉ thị (`CHANGELOG.md`, `CLAUDE.md`, `HANDOFF.md`, `DEPLOY_CLOUDFLARE.md`, `DIRECTIVE_FOR_SERVER_BOT.md`, `.env.example`), chạy `npm run setup` và `npm run build` thành công. Đã tạo `.env` local an toàn: `PORT=3860`, `USE_SAMPLE_DATA=1`, `SESSION_SECRET` ngẫu nhiên, OTP/SSO/ORDS/AI để trống; không commit secret.
- **Blocker hạ tầng:** cổng `3860` hiện đang được PM2 process `dona-report` sử dụng (`/home/osboxes/.openclaw/workspace-main/webapp_donapharm/server.js`). Thử start PM2 `reportnew` bị lỗi `EADDRINUSE`; đã xoá process lỗi để tránh vòng restart. Vì không được ảnh hưởng webapp cũ đang chạy, chưa dừng/đổi `dona-report` và chưa trỏ Cloudflare Tunnel.
- **Cloudflare hiện trạng:** `cloudflared` đã cài (`2026.5.2`) nhưng chưa có origin cert/login trên user hiện tại; chưa có `cloudflared.service`; DNS `reportnew.donapharm.asia` chưa resolve. Cần CEO quyết phương án cổng/dịch vụ trước khi tiếp tục.

### 2026-07-01
- **Sửa layout PC lấp đầy màn rộng.** `.page-desktop` chuyển sang lưới `auto-fill minmax(440px)` + max-width 1900px → màn ~1920px hiện 3 cột cảnh báo, hết khoảng trắng thừa bên phải. _Test: preview ở 1920px._
- **Thêm `DIRECTIVE_FOR_SERVER_BOT.md`.** Chỉ thị cho bot server: vai trò/ranh giới (hạ tầng, không sửa code app), thứ tự đọc repo, nhiệm vụ deploy `reportnew.donapharm.asia`, nguyên tắc phối hợp với dev + ghi log. _Lý do: để bot server tiếp quản repo và phối hợp đúng vai với dev._
- **Lập CHANGELOG.md + quy trình ghi log.** Tạo file này làm nhật ký thay đổi/tiến trình chuẩn cho repo; đặt quy tắc dev ghi log mỗi thay đổi. _Lý do: để bot/người đọc repo nắm ngay tình hình._
- **Nối dữ liệu thật (một phần) + adapter hạ tầng.** `store.js` đọc slot upload `active` làm nguồn doanh thu (ưu tiên upload→ORDS→mẫu); upload 1 kỳ là báo cáo hiện ngay. Thêm `ords.js` (ORDS SQL API) và OTP/SSO trong `auth.js` + routes — đều **TẮT mặc định**, bật bằng env trên server. _Test: upload file → kỳ 07.2026 xuất hiện, doanh thu khớp file. ORDS/OTP/SSO chưa test live (cần mạng nội bộ)._
- **Hướng dẫn deploy `reportnew.donapharm.asia`.** Viết `DEPLOY_CLOUDFLARE.md` theo mô hình 1 server Node :3860 + Cloudflare Tunnel; cập nhật `_redirects`.
- **Gắn logo + QR Zalo OA THẬT của DNPHARMA.** Thêm `web/public/logo-dnpharma.png`, `logo-mark.png`, `zalo-oa-qr.png`; component logo dùng ảnh thật (fallback SVG). Thu nhỏ kích thước hiển thị cho cân đối (logo 96px, QR 76px ở màn login).
- **Nhận diện DNPHARMA (xanh–cam).** Đổi bộ màu thương hiệu; sửa tài liệu bàn giao `bot tender`→`bot report`; thêm `DIRECTIVE_FOR_BOT_REPORT.md`.
- **Dựng App Report New v2.0.** Kiến trúc React (Vite) + Express API tách riêng, **1 codebase responsive** (mobile bottom-nav / PC sidebar). 6 lõi báo cáo + Upload + AI + phân quyền backend + dữ liệu mẫu ẩn danh (`seed.js`). Kèm `README.md`, `CLAUDE.md`, `HANDOFF.md`. _Đã verify bằng preview trên cả mobile lẫn PC._

### 2026-07-24 — Report Bot
- **Chuyển SSOT điểm tháng/quý sang App Report local, giữ xu ở App VAT.** Thêm `server/src/employeePointLocal.js` + `server/config/employee_point_coeff.json` để tính điểm từ dòng doanh thu App Report theo công thức `Σ(doanh thu × hệ số ÷ 100.000.000)` làm tròn 2 số; rule versioned `point-local-2026-05-r1`, mặc định hệ số 1, CL/NT = 2, NCL prefix `025-028` = 2. Tái dùng semantics từ `diemXu.js`, không để App VAT áp ngược điểm/phạt vào projection mới.
- **Fail-closed + DQ an toàn.** Thiếu route / thiếu prefix đơn vị ở dòng NCL không làm vỡ tính điểm: fallback hệ số 1 và ghi DQ audit `employee_point_local_dq` chỉ với metadata an toàn (emp/period/rule/outcome/signature), không lưu revenue/raw row/PII. Exclusion list cũ (`DN021/DN022/DN023/VP004/VP018`) vẫn khóa cứng.
- **Projection `/employee-cost/diem-xu` nay là local point + VAT xu.** `server/src/employeeVatKhoan.js` chỉ nhận/trả field xu (`xu_thang/xu_quy/xu_quy_tong/carry/xu_rule_version`) và bỏ qua toàn bộ `diem/pct/phat` upstream; `server/src/routes.js` ghép local point + VAT xu, tự tính `% tháng/quý`, thiếu/dư quý, penalty display-only `floor(thiếu quý/2)*600.000`. Nếu App VAT lỗi thì điểm local vẫn hiện, còn xu/phạt để `null` với note đúng `chưa lấy được xu kỳ này`.
- **Parity gate khóa cấn trừ quý.** Penalty chỉ mở khi có artifact/config parity exact-zero khớp `point_rule_version` và đúng NV bắt buộc; nếu chưa pass thì luôn trả trạng thái `đang đối soát`. Ngoài tháng 3/6/9/12 là `dự kiến — chưa trừ`; tháng chốt quý mới lên `chốt quý — cấn trừ` khi parity gate pass. Không ghi payroll/DataHub.
- **UI/source label cập nhật theo 2 nguồn.** `web/src/employeeVatKhoanModel.js` + `web/src/pages/EmployeeCost.jsx` đổi nhãn nguồn: điểm = App Report + rule version, xu = App VAT, penalty = App Report(point)+App VAT(xu); hiển thị rõ trạng thái parity/đối soát và giữ deduction ở chế độ display-only.
- **Chuẩn bị module preview/audit thông báo, chưa gửi thật.** Thêm `server/src/employeePointNotifications.js` và route admin-only preview `/admin/employee-point/notifications/preview`. Preview sinh nội dung Telegram+email theo kỳ/quý/công thức/rule/metrics, nhưng `send_enabled=false`; audit chỉ hash actor + emp code/channel/time/period/outcome, không lưu recipient/token/body/PII.
- **Bổ sung test cho local point / preview / frontend labels.** Thêm `server/test/employeePointLocal.test.js`, `server/test/employeePointNotifications.test.js`; cập nhật `server/test/employeeVatKhoan.test.js` và `web/test/EmployeeCost.diemXu.test.mjs` cho xu-only upstream, fallback VAT lỗi, parity statuses, DQ safety, nhãn App Report/App VAT.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn thiện tài liệu audit app cũ → app mới trong `MIGRATION_MATRIX.md`.** Đã rà các nguồn app cũ `report.html`, `report-main-v23.js`, `report-extra.js`, `kho-dulieu.html`, các bản `report-cst/report-force/report-new` và `chart.min.js`; cập nhật ma trận đầy đủ theo tab/nút/tính năng với trạng thái `done/partial/todo`.
- **Ghi rõ backlog chưa chuyển:** biểu đồ, tab Nhân viên, màn Đối chiếu, PDF/print, hoạt chất/nhóm thuốc ở Products, Kho dữ liệu master/rollback parity, Target admin editor, Target NV/thưởng 3P, Điều chuyển NV, export mẫu cũ và upload file lỗi.
- **Thêm kế hoạch biểu đồ — chưa code:** khuyến nghị Recharts thay vì Chart.js cho React/Vite; đề xuất 4 biểu đồ doanh thu theo kỳ, top ĐV/SP, donut cơ cấu tuyến/nhà thầu/gói thầu, target progress ring; nêu API/scope/period requirements, bundle-size impact và vị trí đặt ở Tổng quan/Phân tích/Target để CEO/Claude duyệt trước khi triển khai.

### 2026-07-24 — Report Bot
- **Sắp xếp lại UI “Chi phí của tôi” theo mockup v2 §3B.** Hàng trên bám đúng thứ tự `Nhân viên · Doanh thu chưa VAT · Điểm · Tổng chi phí tháng (chi phí gốc)`; số dòng gộp vào thẻ Nhân viên và không lặp `Chi phí gốc` trong khối cấn trừ. Chuyển `Phạt dự kiến` xuống cạnh `Xu tích lũy`, để hàng cấn trừ đọc liền `[Xu] [Phạt dự kiến] − [Cấn trừ thiếu xu] = [Còn lại]`; mobile tiếp tục một cột theo đúng thứ tự.
- **Giữ nguyên logic số/quyền và fail-closed.** `Phạt dự kiến` và `Cấn trừ thiếu xu` dùng cùng số backend; chỉ mở khi parity exact-zero PASS, nếu chưa đạt vẫn `đang đối soát / —`. Không sửa công thức, quyền, API, DataHub/payroll hay luồng notification. Áp đúng mockup: Điểm `#4338ca→#4f46e5`, Thưởng `#047857→#059669`, Phạt `#b91c1c→#dc2626`, Xu `#eef2ff` và thẻ chi phí gốc `#fffbeb`.
- **Production deploy sau CEO duyệt:** review `0729971` được merge vào `main` tại `2430f5d`; production version `2430f5d-20260724-144314-865`. Focused web `23/23`, full web `57/57`, targeted server regression `86/86`, build và `git diff --check` đều PASS. Public/local asset byte-parity PASS; triển khai frontend-only, PM2 PID/restart giữ nguyên, không restart backend.
