# Đưa App Report New lên Cloudflare

App Report cần lấy dữ liệu + đăng nhập từ **mạng nội bộ công ty** (ORDS, SSO/OTP port 3848/3862).
Vì vậy dùng mô hình **Frontend trên Cloudflare + Backend giữ ở server công ty qua Cloudflare Tunnel**.
Không mở port ra ngoài, không phơi server công ty lên internet.

```
[Người dùng] → Cloudflare (Pages: giao diện) → Cloudflare Tunnel → [Server công ty: Node API] → ORDS/SSO nội bộ
                         └── Cloudflare Access chặn: chỉ người của công ty đăng nhập mới vào
```

---

## Phần 1 — Frontend lên Cloudflare Pages

1. Đẩy code lên GitHub (repo **private**).
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → chọn repo.
3. Cấu hình build:
   - **Root directory:** `report-new/web`
   - **Build command:** `npm install && npm run build`
   - **Build output directory:** `dist`
4. Sau khi deploy, Pages cho 1 tên miền dạng `app-report.pages.dev` (gắn tên miền riêng ở tab **Custom domains**, ví dụ `report.donapharm.one`).

> Frontend gọi API theo đường `/api/...`. Cần trỏ `/api` về backend — xem Phần 3.

---

## Phần 2 — Backend qua Cloudflare Tunnel (chạy trên server công ty)

Trên server đang chạy Node API (cổng 3860):

1. Cài `cloudflared`:
   ```bash
   # Windows: tải cloudflared.exe từ trang Cloudflare
   # Linux:
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
   chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
   ```
2. Đăng nhập + tạo tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create report-api
   ```
3. Trỏ tên miền API vào tunnel (ví dụ `api.report.donapharm.one`):
   ```bash
   cloudflared tunnel route dns report-api api.report.donapharm.one
   ```
4. File cấu hình `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: report-api
   credentials-file: /root/.cloudflared/<id>.json
   ingress:
     - hostname: api.report.donapharm.one
       service: http://localhost:3860
     - service: http_status:404
   ```
5. Chạy nền (dịch vụ hệ thống):
   ```bash
   cloudflared tunnel run report-api          # chạy thử
   sudo cloudflared service install            # cài chạy nền tự động
   ```

Backend Node vẫn chạy như thường (`npm start` trong `report-new/server`, đặt biến môi trường theo `.env.example`). Nên chạy qua `pm2` để tự bật lại.

---

## Phần 3 — Nối `/api` của frontend về backend

Trong `report-new/web` thêm file `public/_redirects` (Cloudflare Pages đọc file này):

```
/api/*  https://api.report.donapharm.one/api/:splat  200
```

Vậy khi giao diện gọi `/api/overview`, Cloudflare chuyển tới backend qua tunnel.

---

## Phần 4 — Bảo vệ bằng Cloudflare Access (khuyến nghị)

1. Cloudflare **Zero Trust** → **Access** → **Applications** → **Add application** → Self-hosted.
2. Domain: `report.donapharm.one` (và cả `api.report...`).
3. Policy: chỉ cho email công ty (`@donapharm...`) hoặc danh sách cụ thể.
→ Người ngoài không mở được app, kể cả biết link.

---

## Lưu ý bảo mật khi deploy
- Repo **private**. Không commit `.env`, dữ liệu doanh thu thật, token, DB.
- Đặt `SESSION_SECRET` ngẫu nhiên, `USE_SAMPLE_DATA=0` khi chạy thật.
- Siết CORS trong `server/src/index.js` về đúng domain (hiện demo mở CORS).
- `ANTHROPIC_API_KEY` (nếu bật AI) đặt ở biến môi trường server, KHÔNG để lộ ra frontend.

---

## Phương án thay thế (nếu sau này KHÔNG cần mạng nội bộ)
Nếu chuyển sang đẩy toàn bộ dữ liệu lên cloud, có thể viết lại backend thành **Cloudflare Workers + D1 (SQL) + R2 (file) + KV (session)** để chạy hoàn toàn trên edge, bỏ server công ty. Khi đó không dùng Tunnel nữa. Đây là hướng xa hơn, chỉ nên làm khi dữ liệu không còn phụ thuộc hệ thống nội bộ.
