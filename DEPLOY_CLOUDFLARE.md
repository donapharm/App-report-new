# Đưa App Report New lên tên miền reportnew.donapharm.asia

App Report cần lấy dữ liệu + đăng nhập từ **mạng nội bộ công ty** (ORDS, SSO/OTP).
Cách gọn nhất và an toàn nhất: **chạy 1 server Node duy nhất** (nó phục vụ CẢ giao diện lẫn API)
rồi đưa ra internet bằng **Cloudflare Tunnel** trỏ vào tên miền `reportnew.donapharm.asia`.
Không mở port, không phơi server ra ngoài.

```
[Người dùng] → https://reportnew.donapharm.asia → Cloudflare (Tunnel) → [Server công ty: node :3860] → ORDS/SSO nội bộ
                                              └── Cloudflare Access: chỉ nhân viên đăng nhập mới vào
```

> App đã cấu hình sẵn phục vụ cả frontend (`web/dist`) lẫn API trên cùng cổng 3860
> (`server/src/index.js`), nên **không cần tách Pages, không cần \_redirects, không lo CORS**.

---

## Điều kiện tiên quyết
1. Tên miền **donapharm.asia** đã được quản lý trên **Cloudflare** (nameservers trỏ về Cloudflare).
   - Kiểm tra: dash.cloudflare.com → nếu chưa thấy `donapharm.asia` thì **Add a site** → làm theo hướng dẫn đổi nameservers ở nơi mua tên miền.
2. Có **1 server chạy được Node 18+** và **thấy được mạng nội bộ** (ORDS/SSO). Thường là chính server Linux công ty.

---

## Bước 1 — Chạy app trên server
```bash
git clone https://github.com/donapharm/App-report-new.git
cd App-report-new
npm run setup          # cài + tạo dữ liệu mẫu
npm run build          # build giao diện vào web/dist
cp .env.example .env   # rồi sửa .env (xem phần "nối dữ liệu thật")
npm start              # chạy http://localhost:3860
# Nên chạy nền bằng pm2 để tự bật lại:
#   npm i -g pm2 && pm2 start server/src/index.js --name reportnew && pm2 save
```

## Bước 2 — Cloudflare Tunnel trỏ tên miền
```bash
# Cài cloudflared (Linux):
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

cloudflared tunnel login
cloudflared tunnel create reportnew
cloudflared tunnel route dns reportnew reportnew.donapharm.asia
```
File `~/.cloudflared/config.yml`:
```yaml
tunnel: reportnew
credentials-file: /root/.cloudflared/<id>.json
ingress:
  - hostname: reportnew.donapharm.asia
    service: http://localhost:3860
  - service: http_status:404
```
Chạy nền:
```bash
cloudflared tunnel run reportnew      # chạy thử
sudo cloudflared service install      # cài chạy nền tự động
```
→ Mở **https://reportnew.donapharm.asia** là thấy app.

## Bước 3 — Bảo vệ bằng Cloudflare Access (khuyến nghị)
Cloudflare **Zero Trust → Access → Applications → Add application** (Self-hosted):
- Domain: `reportnew.donapharm.asia`
- Policy: chỉ cho email công ty (`@donapharm...`) hoặc danh sách cụ thể.
→ Người ngoài biết link cũng không mở được.

---

## Nối dữ liệu thật (sửa `.env` ở Bước 1)
| Việc | Biến env | Ghi chú |
|------|----------|---------|
| Doanh thu | (không cần) | Đã chạy: CEO **Upload Excel** trong app là báo cáo cập nhật ngay |
| Doanh thu fallback | `ORDS_SQL_API`, `ORDS_AUTH` | Bật ORDS khi kỳ chưa upload (xem `server/src/ords.js`) |
| Đăng nhập | `OTP_BACKEND_URL`, `SSO_VERIFY_URL` | Bật OTP/SSO thật (xem `server/src/auth.js`); nhớ làm UI nhập SĐT→OTP ở frontend |
| Bảo mật | `SESSION_SECRET` | Đặt chuỗi ngẫu nhiên; siết CORS trong `server/src/index.js` về `reportnew.donapharm.asia` |

---

## Cách khác: tách Frontend lên Cloudflare Pages
Nếu sau này muốn giao diện chạy trên CDN Cloudflare (nhanh hơn) và backend riêng:
- Pages build từ repo: Root `web`, build `npm install && npm run build`, output `dist`.
- Backend vẫn qua Tunnel ở `api.reportnew.donapharm.asia`.
- Sửa `web/public/_redirects`: `/api/*  https://api.reportnew.donapharm.asia/api/:splat  200`.
Cách này nhiều bước hơn; chỉ nên dùng khi cần tối ưu tốc độ tải giao diện.

---

## Lưu ý bảo mật
- Repo **private**. `.gitignore` đã chặn `.env`, dữ liệu thật, `node_modules`.
- Đặt `SESSION_SECRET` ngẫu nhiên; `ANTHROPIC_API_KEY` (nếu bật AI) chỉ để ở server.
- Bật Cloudflare Access cho app nội bộ.
