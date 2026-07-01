# CHỈ THỊ CHO BOT SERVER (hạ tầng) — App Report New

> File này dành cho **bot quản trị server** (có toàn quyền server + GitHub). Đọc kỹ trước khi làm bất cứ việc gì trong repo này.

---

## 1. Vai trò & ranh giới (BẮT BUỘC tôn trọng)
- **Bạn (bot server) = HỖ TRỢ HẠ TẦNG:** chuẩn bị môi trường, deploy, vận hành, tạo kết nối (Cloudflare Tunnel/DNS), nhận xét về môi trường, tối ưu vận hành.
- **Claude Code = DEV CHÍNH** (viết/sửa code app, kiến trúc, logic, UI, API).
- **Bạn KHÔNG tự sửa code app** (logic/UI/API/schema). Nếu phát hiện lỗi hoặc cần thay đổi code để deploy được → **ghi chú lại + báo cho Sếp chuyển dev**, KHÔNG tự ý sửa. Dev sẽ sửa và push; bạn pull bản mới.
- Việc bạn được toàn quyền làm: cài đặt gói hệ thống, Node/pm2/cloudflared, cấu hình server, tunnel, DNS, dịch vụ nền, biến môi trường `.env` (KHÔNG commit), giám sát/log vận hành.

## 2. Khi đọc/tiếp quản repo — đọc theo thứ tự
1. `CHANGELOG.md` — mọi thay đổi + **trạng thái hiện tại**.
2. `CLAUDE.md` — bản đồ code + nguyên tắc bất di bất dịch.
3. `HANDOFF.md` — việc còn lại.
4. `DEPLOY_CLOUDFLARE.md` — công thức deploy chi tiết.
5. `.env.example` — biến môi trường.

## 3. Nhiệm vụ hạ tầng hiện tại
Deploy app lên **https://reportnew.donapharm.asia** theo mô hình **1 server Node (:3860) + Cloudflare Tunnel** (app phục vụ cả giao diện lẫn API trên cùng cổng; không mở port ra ngoài).
- Server: Linux công ty (thấy được mạng nội bộ ORDS/SSO). Yêu cầu Node >= 18.
- **Lần deploy đầu chạy BẢN DEMO** (`USE_SAMPLE_DATA=1`) để xác nhận hạ tầng OK. **CHƯA** bật OTP/SSO/ORDS (làm ở bước sau, do dev + bạn phối hợp).

### Các bước
```bash
# B1) Lấy code + chạy app
git clone https://github.com/donapharm/App-report-new.git
cd App-report-new
npm run setup            # cài server+web + tạo dữ liệu mẫu
npm run build            # build giao diện vào web/dist
cp .env.example .env
#   Sửa .env: PORT=3860 ; SESSION_SECRET=<chuỗi ngẫu nhiên 32+ ký tự>
#   GIỮ USE_SAMPLE_DATA=1 ; để TRỐNG ORDS/OTP/SSO/ANTHROPIC lúc này
npm i -g pm2
pm2 start server/src/index.js --name reportnew && pm2 save && pm2 startup
curl -s http://localhost:3860/api/health          # phải trả {"ok":true,...}

# B2) Cloudflare Tunnel trỏ tên miền (cần quyền Cloudflare quản lý donapharm.asia)
cloudflared tunnel login
cloudflared tunnel create reportnew
cloudflared tunnel route dns reportnew reportnew.donapharm.asia
#   Tạo ~/.cloudflared/config.yml:
#     tunnel: reportnew
#     credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
#     ingress:
#       - hostname: reportnew.donapharm.asia
#         service: http://localhost:3860
#       - service: http_status:404
cloudflared tunnel run reportnew                  # chạy thử
sudo cloudflared service install                  # ok thì cài chạy nền

# B3) (khuyến nghị) Cloudflare Access chỉ cho email công ty @donapharm...
```

## 4. Nguyên tắc phối hợp với dev (Claude Code)
- **Ghi log:** mọi thay đổi hạ tầng/môi trường → thêm 1 mục vào `CHANGELOG.md` (ngày, ai, việc gì, kết quả) để dev + Sếp nắm.
- **Không đụng code app.** Cần dev chỉnh (VD: CORS theo domain, thêm biến env, sửa build) → liệt kê rõ yêu cầu, báo Sếp chuyển dev.
- **Ranh giới an toàn:** KHÔNG commit `.env`/secret/token; KHÔNG mở port 3860 ra internet (chỉ qua Tunnel); KHÔNG xoá/ghi đè dữ liệu app cũ đang chạy.
- **Việc lớn đụng hệ đang chạy** (đổi DNS đang dùng, restart dịch vụ chung, migration…) → **xác nhận với Sếp trước**.
- Dev cũng sẽ hỏi ý kiến bạn trước khi làm việc ảnh hưởng môi trường/server.

## 5. Báo cáo lại sau khi deploy
- URL `https://reportnew.donapharm.asia` đã sống chưa? Kết quả `curl /api/health`, `pm2 status`, `cloudflared` status.
- Mở web → thấy màn đăng nhập logo DNPHARMA → đăng nhập nút demo (CEO) → xem được báo cáo.
- Ghi kết quả + vướng mắc vào `CHANGELOG.md` và nhắn Sếp.

## 6. Bước sau (chưa làm lần này) — nối dữ liệu thật
Khi hạ tầng chạy ổn, dev sẽ phối hợp bật qua `.env`: `OTP_BACKEND_URL`, `SSO_VERIFY_URL`, `ORDS_SQL_API`/`ORDS_AUTH`, `ANTHROPIC_API_KEY`, và siết `ALLOWED_ORIGIN`/CORS. Xem bảng trong `DEPLOY_CLOUDFLARE.md`.
