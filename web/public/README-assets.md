# Ảnh thương hiệu chính thức — không tự vẽ hoặc thay thế

| File | Dùng ở đâu | Gợi ý |
|------|-----------|-------|
| `logo-dnpharma.png` | Logo chính thức dùng thống nhất tại login, header mobile và sidebar PC | 640×369; SHA-256 `c5d9986df442c45a8af1ef78550d026626435940a4fa4e8d3404c4066838134e` |
| `zalo-oa-qr.png`    | QR Zalo OA chính thức dùng thống nhất toàn ứng dụng | 420×418; SHA-256 `6cb1d84d853263c54d996742612b220d2aee21ad547959f2af55d0778b7986af` |

Lệnh build chạy `scripts/verify-brand-assets.mjs` và sẽ dừng nếu file, kích thước hoặc hash thay đổi. Khi ảnh không tải được, giao diện chỉ báo lỗi asset chính thức; **không sinh logo/QR thay thế**.
