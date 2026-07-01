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
- **🔒 Truy cập công khai ĐANG KHOÁ TẠM (403):** bot đổi ingress tunnel sang `http_status:403` để chặn người ngoài trong lúc chưa cấu hình được Cloudflare Access (dashboard Zero Trust vướng xác minh trên trình duyệt headless). Dữ liệu thật an toàn; local 3873 vẫn chạy.
- **Kế tiếp:**
  1. 🔴 Cấu hình **Cloudflare Access** đúng chuẩn (có thể cần CEO thao tác trên dashboard Zero Trust hoặc cấp API token), rồi bot đổi ingress về `http://localhost:3873`.
  2. Lấy **đủ dữ liệu từ 01/2026** bằng importer chế độ thư mục (đã sẵn sàng).
  3. Dev + bot: nối **OTP/SSO** thật + tắt demo-login (mỗi NV chỉ thấy phạm vi của mình).
  4. Nối nguồn thật cho **Cơ số thầu** (ORDS) + **Target** (DB) qua `.env`.

---

## 🗒️ LỊCH SỬ THAY ĐỔI (mới nhất trên cùng)

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
