# App Report New — Smart Report App (Donapharm)

Bản build lại **gọn** của App Report cũ. Chỉ giữ 6 nội dung cốt lõi và làm chúng "thông minh":

1. **Tổng quan (Overview)** — KPI + **Cảnh báo chủ động** (việc CEO cần chú ý hôm nay).
2. **Doanh thu (Revenue)** — drill-down: Tổng → Nhân viên → Đơn vị → Sản phẩm.
3. **Cơ số thầu (Tender Quota)** — còn lại / tỷ lệ / cảnh báo cạn–tồn.
4. **Target** — xem % đạt + **dự báo target kỳ tới theo xu hướng** (chỉ xem, không gửi thưởng tự động).
5. **Export** — xuất Excel/CSV có kiểm quyền (qua backend).
6. **AI hỏi nhanh** — số liệu do **code tính, không bịa**; nhân viên chỉ thấy phạm vi của mình.

> Các nghiệp vụ **VAT / Fleet-Drive / Kho master data / Điều chuyển NV / gửi thưởng tự động** đã được **cắt bỏ** khỏi Report — thuộc app/bot khác.

---

## Chạy thử trên máy (1 lần duy nhất để xem app)

Yêu cầu: Node.js 18+ (đang test trên Node 24).

```bash
# 1. Cài đặt + sinh dữ liệu mẫu
npm run setup

# 2. Chạy app (mở 2 tiến trình: API + web)
npm run dev
```

Sau đó mở trình duyệt: **http://localhost:5173**

Đăng nhập thử bằng các tài khoản mẫu (bấm nút có sẵn trên màn login):
- **CEO** — xem toàn công ty, upload, target, export.
- **Nhân viên Sale** — chỉ xem dữ liệu trong phạm vi của mình.

> Đây là dữ liệu **ẩn danh/mẫu**. Không có số liệu thật, không có PII thật.

---

## Kiến trúc (để dev của Anh nắm nhanh)

```
report-new/
  server/        # Backend API (Express) — QUYẾT ĐỊNH QUYỀN Ở ĐÂY
    src/
      auth.js        # session + login (điểm CẮM SSO/OTP thật)
      store.js       # nguồn dữ liệu (điểm CẮM ORDS/upload thật)
      smart.js       # cảnh báo + dự báo + AI-query (code-first)
      routes.js      # toàn bộ REST API + kiểm quyền từng route
    data/            # dữ liệu mẫu ẩn danh (do seed.js sinh ra)
    seed.js
  web/           # Frontend React (Vite) — chỉ render dữ liệu backend trả
    src/pages/       # Overview, Revenue, TenderQuota, Target, AiChat
```

**Nguyên tắc bảo mật (khác app cũ):**
- KHÔNG hardcode danh sách nhân viên/PII trong bundle frontend.
- Backend quyết định quyền; frontend chỉ hiển thị dữ liệu được trả.
- Mọi export đi qua backend + kiểm quyền.

---

## Khi mang lên server thật — "cắm 3 dây"

Toàn bộ điểm cần thay được đánh dấu bằng `// TODO(LIVE)` trong code:

| Dây | File | Việc cần làm |
|-----|------|--------------|
| 1. Đăng nhập | `server/src/auth.js` | Thay `mockLogin` bằng gọi OTP (port 3848) + verify SSO (port 3862). |
| 2. Nguồn doanh thu | `server/src/store.js` | Thay đọc JSON mẫu bằng đọc file upload thật + fallback ORDS/Lumos. |
| 3. Target | `server/src/store.js` (`getTargets`) | Nối `/api/targets` backend thật + fallback `V_TEM_TARGET_BONUS`. |

Xem thêm `.env.example` cho biến môi trường.
