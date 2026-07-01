# CHANGELOG & TIẾN TRÌNH — App Report New

> **QUY TRÌNH (đọc trước):** Đây là nhật ký DUY NHẤT ghi lại **mọi thay đổi của app** và **tiến trình hiện tại**.
> - Bot/người đọc repo hãy bắt đầu từ file này để nắm toàn cảnh, rồi đọc tiếp `CLAUDE.md` (bản đồ code) và `HANDOFF.md` (việc còn lại).
> - **Dev chính (Claude Code) BẮT BUỘC ghi 1 mục vào đây cho mỗi thay đổi** (mới nhất ở trên cùng), kèm ngày, việc đã làm, lý do, và trạng thái test.
> - Vai trò: Claude Code = dev chính; Bot server = hỗ trợ môi trường/deploy/tunnel. Tác vụ lớn ảnh hưởng hệ đang chạy phải hỏi bot server trước.

---

## 📍 TRẠNG THÁI HIỆN TẠI — 2026-07-01
- **Giai đoạn:** Đã có **bản demo hoàn chỉnh, chạy được** (dữ liệu mẫu ẩn danh). Đang chuẩn bị **deploy `reportnew.donapharm.asia`**.
- **GitHub:** `donapharm/App-report-new` — nhánh `main`, đồng bộ tới commit mới nhất.
- **Đã xong:** 6 lõi báo cáo (Tổng quan+cảnh báo, Doanh thu drill-down, Cơ số thầu, Target+dự báo, Export Excel, AI hỏi nhanh) · Responsive mobile+PC · Upload (validate/audit/rollback) · Phân quyền backend · Nhận diện DNPHARMA (logo+QR thật) · Nối Upload→Báo cáo (thật) · Adapter ORDS/OTP/SSO (code sẵn, env-gated, TẮT mặc định).
- **Đang chờ:** Bot server **deploy** lên `reportnew.donapharm.asia` (1 server Node :3860 + Cloudflare Tunnel). Sau đó **nối dữ liệu thật** (OTP/SSO cổng 3848/3862, ORDS) qua `.env`.
- **Việc dev kế tiếp (không đụng hệ đang chạy):** UI đăng nhập SĐT→OTP ở frontend; CORS theo env.

---

## 🗒️ LỊCH SỬ THAY ĐỔI (mới nhất trên cùng)

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Deploy demo `reportnew.donapharm.asia` thành công theo phương án không ảnh hưởng app cũ.** Vì các cổng `3860`/`3861`/`3863` đang được app hiện hữu sử dụng, App Report New chạy PM2 `reportnew` trên cổng trống `3873` với `USE_SAMPLE_DATA=1`; `curl http://localhost:3873/api/health` trả `{"ok":true,"service":"app-report-new",...}`. App cũ `dona-report` trên `3860` giữ nguyên.
- **Cloudflare Tunnel riêng cho Report New.** Đã login Cloudflare, tạo tunnel `reportnew` (`746c53e5-4098-43bd-848f-9b74e8a41f63`), route DNS `reportnew.donapharm.asia`, tạo config `~/.cloudflared/reportnew.yml` trỏ `http://localhost:3873`, chạy bằng PM2 `cloudflared-reportnew` để không restart tunnel chung. HTTPS `https://reportnew.donapharm.asia` trả `HTTP/2 200`.
- **Kiểm thử giao diện.** Mở `https://reportnew.donapharm.asia` thấy màn đăng nhập/logo DNPHARMA; bấm demo CEO đăng nhập được dashboard Tổng quan với dữ liệu mẫu. Lưu ý: chưa bật Cloudflare Access, OTP/SSO/ORDS/AI vẫn để trống theo yêu cầu demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Chuẩn bị deploy demo `reportnew.donapharm.asia` trên server.** Đã clone repo nhánh `main`, đọc đủ chỉ thị (`CHANGELOG.md`, `CLAUDE.md`, `HANDOFF.md`, `DEPLOY_CLOUDFLARE.md`, `DIRECTIVE_FOR_SERVER_BOT.md`, `.env.example`), chạy `npm run setup` và `npm run build` thành công. Đã tạo `.env` local an toàn: `PORT=3860`, `USE_SAMPLE_DATA=1`, `SESSION_SECRET` ngẫu nhiên, OTP/SSO/ORDS/AI để trống; không commit secret.
- **Blocker hạ tầng:** cổng `3860` hiện đang được PM2 process `dona-report` sử dụng (`/home/osboxes/.openclaw/workspace-main/webapp_donapharm/server.js`). Thử start PM2 `reportnew` bị lỗi `EADDRINUSE`; đã xoá process lỗi để tránh vòng restart. Vì không được ảnh hưởng webapp cũ đang chạy, chưa dừng/đổi `dona-report` và chưa trỏ Cloudflare Tunnel.
- **Cloudflare hiện trạng:** `cloudflared` đã cài (`2026.5.2`) nhưng chưa có origin cert/login trên user hiện tại; chưa có `cloudflared.service`; DNS `reportnew.donapharm.asia` chưa resolve. Cần CEO quyết phương án cổng/dịch vụ trước khi tiếp tục.

### 2026-07-01
- **Thêm `DIRECTIVE_FOR_SERVER_BOT.md`.** Chỉ thị cho bot server: vai trò/ranh giới (hạ tầng, không sửa code app), thứ tự đọc repo, nhiệm vụ deploy `reportnew.donapharm.asia`, nguyên tắc phối hợp với dev + ghi log. _Lý do: để bot server tiếp quản repo và phối hợp đúng vai với dev._
- **Lập CHANGELOG.md + quy trình ghi log.** Tạo file này làm nhật ký thay đổi/tiến trình chuẩn cho repo; đặt quy tắc dev ghi log mỗi thay đổi. _Lý do: để bot/người đọc repo nắm ngay tình hình._
- **Nối dữ liệu thật (một phần) + adapter hạ tầng.** `store.js` đọc slot upload `active` làm nguồn doanh thu (ưu tiên upload→ORDS→mẫu); upload 1 kỳ là báo cáo hiện ngay. Thêm `ords.js` (ORDS SQL API) và OTP/SSO trong `auth.js` + routes — đều **TẮT mặc định**, bật bằng env trên server. _Test: upload file → kỳ 07.2026 xuất hiện, doanh thu khớp file. ORDS/OTP/SSO chưa test live (cần mạng nội bộ)._
- **Hướng dẫn deploy `reportnew.donapharm.asia`.** Viết `DEPLOY_CLOUDFLARE.md` theo mô hình 1 server Node :3860 + Cloudflare Tunnel; cập nhật `_redirects`.
- **Gắn logo + QR Zalo OA THẬT của DNPHARMA.** Thêm `web/public/logo-dnpharma.png`, `logo-mark.png`, `zalo-oa-qr.png`; component logo dùng ảnh thật (fallback SVG). Thu nhỏ kích thước hiển thị cho cân đối (logo 96px, QR 76px ở màn login).
- **Nhận diện DNPHARMA (xanh–cam).** Đổi bộ màu thương hiệu; sửa tài liệu bàn giao `bot tender`→`bot report`; thêm `DIRECTIVE_FOR_BOT_REPORT.md`.
- **Dựng App Report New v2.0.** Kiến trúc React (Vite) + Express API tách riêng, **1 codebase responsive** (mobile bottom-nav / PC sidebar). 6 lõi báo cáo + Upload + AI + phân quyền backend + dữ liệu mẫu ẩn danh (`seed.js`). Kèm `README.md`, `CLAUDE.md`, `HANDOFF.md`. _Đã verify bằng preview trên cả mobile lẫn PC._
