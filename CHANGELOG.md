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

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn thiện tài liệu audit app cũ → app mới trong `MIGRATION_MATRIX.md`.** Đã rà các nguồn app cũ `report.html`, `report-main-v23.js`, `report-extra.js`, `kho-dulieu.html`, các bản `report-cst/report-force/report-new` và `chart.min.js`; cập nhật ma trận đầy đủ theo tab/nút/tính năng với trạng thái `done/partial/todo`.
- **Ghi rõ backlog chưa chuyển:** biểu đồ, tab Nhân viên, màn Đối chiếu, PDF/print, hoạt chất/nhóm thuốc ở Products, Kho dữ liệu master/rollback parity, Target admin editor, Target NV/thưởng 3P, Điều chuyển NV, export mẫu cũ và upload file lỗi.
- **Thêm kế hoạch biểu đồ — chưa code:** khuyến nghị Recharts thay vì Chart.js cho React/Vite; đề xuất 4 biểu đồ doanh thu theo kỳ, top ĐV/SP, donut cơ cấu tuyến/nhà thầu/gói thầu, target progress ring; nêu API/scope/period requirements, bundle-size impact và vị trí đặt ở Tổng quan/Phân tích/Target để CEO/Claude duyệt trước khi triển khai.
