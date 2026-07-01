# HANDOFF — App Report New

Cập nhật: 2026-07-01. Người build: Claude (phiên với CEO). Người tiếp nhận: bot tender / phiên Claude kế tiếp.

## Trạng thái: CHẠY ĐƯỢC, đã verify bằng preview trên cả mobile + PC.

### Đã xong ✅
- Kiến trúc React (Vite) + API Express tách riêng, **1 codebase responsive** (mobile bottom-nav, PC sidebar dashboard).
- Nhận diện Donapharm (logo SVG placeholder, tông xanh dược).
- **6 lõi:** Tổng quan + cảnh báo chủ động; Doanh thu drill-down (NV→ĐV→SP); Cơ số thầu (lọc/cảnh báo); Target (xem % đạt + **dự báo theo trend, có giải thích**); Export Excel (qua backend, có kiểm quyền); AI hỏi nhanh (code-first, hiểu không dấu).
- **Upload (admin):** parse+validate xlsx ở backend → preview → commit slot → audit log → rollback. Test với `server/data/sample_upload.xlsx`.
- **Phân quyền backend:** đã kiểm — NV Sale chỉ thấy dữ liệu của mình, không có tab Nhân viên/Upload, bị 403 khi gọi API admin.
- **LLM (AI diễn giải) grounded:** điểm cắm sẵn ở `llm.js`; chưa có key thì tự fallback code-first (đã test).

### Chưa làm / việc tiếp theo (ưu tiên từ trên xuống)
1. **Nối dữ liệu thật** (3 dây `// TODO(LIVE)` trong CLAUDE.md): OTP/SSO, nguồn doanh thu ORDS + slot upload active, targets DB.
   - Cụ thể: cho `store.getRows()` đọc slot `active` trong `upload_slots.json` thay vì `report_rows.json` mẫu.
2. **Logo Donapharm thật** thay placeholder trong `web/src/logo.jsx` (`// TODO(BRAND)`).
3. **Siết CORS** trong `server/src/index.js` về đúng domain (hiện mở cho demo).
4. **Session bền** (hiện lưu RAM `auth.js`) → chuyển sang store bền (Redis/KV) khi nhiều instance.
5. **Export PDF** (hiện chỉ Excel) nếu CEO cần.
6. Deploy theo `DEPLOY_CLOUDFLARE.md` (Pages + Tunnel + Access).

### Điểm cần biết
- Dữ liệu mẫu do `seed.js` sinh (ổn định, có PRNG hạt giống). `server/data/*.json` bị .gitignore (là dữ liệu sinh/runtime) → chạy `npm run seed` sau khi clone.
- Data contract chuẩn: xem `ReportRow` / `TenderQuotaRow` trong audit gốc mục 10.3; hiện thực trong `store.js`/`upload.js`.
- Không có secret thật trong repo. `.env` theo `.env.example`.

### Cách bàn giao cho bot tender
Repo này tự chứa đủ ngữ cảnh: mở ra, đọc `CLAUDE.md` → `HANDOFF.md`, chạy `npm run setup && npm run dev`, rồi làm tiếp mục "việc tiếp theo".
