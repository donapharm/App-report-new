# HANDOFF — App Report New

Cập nhật: 2026-07-01. Người build: Claude (phiên với CEO). Người tiếp nhận: bot report / phiên Claude kế tiếp.

## Trạng thái: CHẠY ĐƯỢC, đã verify bằng preview trên cả mobile + PC.

### Đã xong ✅
- Kiến trúc React (Vite) + API Express tách riêng, **1 codebase responsive** (mobile bottom-nav, PC sidebar dashboard).
- Nhận diện Donapharm (logo SVG placeholder, tông xanh dược).
- **6 lõi:** Tổng quan + cảnh báo chủ động; Doanh thu drill-down (NV→ĐV→SP); Cơ số thầu (lọc/cảnh báo); Target (xem % đạt + **dự báo theo trend, có giải thích**); Export Excel (qua backend, có kiểm quyền); AI hỏi nhanh (code-first, hiểu không dấu).
- **Upload (admin):** parse+validate xlsx ở backend → preview → commit slot → audit log → rollback. Test với `server/data/sample_upload.xlsx`.
- **Phân quyền backend:** đã kiểm — NV Sale chỉ thấy dữ liệu của mình, không có tab Nhân viên/Upload, bị 403 khi gọi API admin.
- **LLM (AI diễn giải) grounded:** điểm cắm sẵn ở `llm.js`; chưa có key thì tự fallback code-first (đã test).

### Đã nối dữ liệu thật (một phần) ✅
- **Upload → Báo cáo (dây chính, đã test):** `store.js` đọc slot upload `active` làm nguồn doanh thu; upload 1 kỳ mới là báo cáo hiện kỳ đó ngay (không cần restart). Ưu tiên: slot upload → ORDS → mẫu.
- **ORDS fallback:** `ords.js` — code sẵn, TẮT mặc định, bật bằng env `ORDS_SQL_API` (chạy trên server nội bộ). Chưa test live.
- **OTP/SSO:** `auth.js` (`requestOtp/verifyOtp/verifySso`) + routes `/auth/otp/*`, `/auth/sso`, `/auth/mode` — code sẵn, TẮT mặc định, bật bằng env. Chưa test live.

### Chưa làm / việc tiếp theo (ưu tiên từ trên xuống)
1. **Bật + kiểm 2 dây còn lại TRÊN SERVER nội bộ** (máy ngoài mạng không test được):
   - ORDS: điền `ORDS_SQL_API`/`ORDS_AUTH`, xác nhận tên bảng/cột + format response (`ords.js` có ghi chú).
   - OTP/SSO: điền `OTP_BACKEND_URL`/`SSO_VERIFY_URL`, khớp path/response thật; **làm UI nhập SĐT→OTP ở frontend** (hiện demo dùng nút chọn tài khoản mẫu; gọi `GET /auth/mode` để biết chế độ).
   - Targets: fallback `V_TEM_TARGET_BONUS` khi kỳ chưa nhập target (`store.getTargets` có TODO).
2. **Logo Donapharm thật** thay placeholder trong `web/src/logo.jsx` (`// TODO(BRAND)`).
3. **Siết CORS** trong `server/src/index.js` về đúng domain (hiện mở cho demo).
4. **Session bền** (hiện lưu RAM `auth.js`) → chuyển sang store bền (Redis/KV) khi nhiều instance.
5. **Export PDF** (hiện chỉ Excel) nếu CEO cần.
6. Deploy theo `DEPLOY_CLOUDFLARE.md` (Pages + Tunnel + Access).

### Điểm cần biết
- Dữ liệu mẫu do `seed.js` sinh (ổn định, có PRNG hạt giống). `server/data/*.json` bị .gitignore (là dữ liệu sinh/runtime) → chạy `npm run seed` sau khi clone.
- Data contract chuẩn: xem `ReportRow` / `TenderQuotaRow` trong audit gốc mục 10.3; hiện thực trong `store.js`/`upload.js`.
- Không có secret thật trong repo. `.env` theo `.env.example`.

### Cách bàn giao cho bot report
Repo này tự chứa đủ ngữ cảnh: mở ra, đọc `CLAUDE.md` → `HANDOFF.md`, chạy `npm run setup && npm run dev`, rồi làm tiếp mục "việc tiếp theo".
