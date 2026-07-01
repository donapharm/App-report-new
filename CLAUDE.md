# CLAUDE.md — App Report New (Donapharm)

Đọc file này đầu tiên khi tiếp nhận dự án. Đây là bản **build lại gọn** của App Report cũ (mega `server.js` gom 10 nghiệp vụ) thành **smart app** chỉ giữ 6 nội dung cốt lõi.

## Chạy nhanh
```bash
npm run setup   # cài server+web, sinh dữ liệu mẫu ẩn danh
npm run dev     # API :3860 + web :5173  → mở http://localhost:5173
```
Đăng nhập demo: bấm tài khoản mẫu ở màn login (CEO / ADMIN / DN001..DN012).

## Phạm vi (đã chốt với CEO)
- **GIỮ:** Tổng quan (+cảnh báo chủ động), Doanh thu (drill-down NV→ĐV→SP), Cơ số thầu, Target (xem + dự báo theo trend), Export Excel, AI hỏi nhanh, Upload (admin).
- **ĐÃ CẮT:** VAT, Fleet/Drive, Kho master data, Điều chuyển NV, gửi thưởng tự động, face/device verify. (Thuộc app/bot khác.)

## Bản đồ code
```
server/                      Backend Express (QUYẾT ĐỊNH QUYỀN Ở ĐÂY)
  src/index.js               khởi động, phục vụ web/dist ở production
  src/auth.js                session + login + phân quyền (scopeOf/requireAdmin)   ← TODO(LIVE): OTP/SSO
  src/store.js               nguồn dữ liệu (đọc data/*.json)                       ← TODO(LIVE): upload thật/ORDS
  src/analytics.js           tổng hợp doanh thu/CST/target (mọi con số tính ở đây)
  src/smart.js               cảnh báo chủ động + dự báo target + AI code-first
  src/llm.js                 điểm cắm LLM (Claude), grounded, tắt nếu chưa có key
  src/upload.js              parse+validate xlsx, slot, audit, rollback
  src/routes.js              toàn bộ REST API (+ kiểm quyền từng route)
  seed.js                    sinh dữ liệu mẫu; scripts/make_sample_xlsx.js sinh file test
web/                         Frontend React (Vite) — chỉ render dữ liệu backend trả
  src/App.jsx                responsive: mobile bottom-nav / desktop sidebar
  src/pages/*                Overview, Revenue, TenderQuota, Target, AiChat, Upload, Login
  src/api.js                 client gọi /api (đính token)
```

## Nguyên tắc bất di bất dịch
1. **Quyền quyết ở backend.** Mọi query đi qua `auth.scopeOf(session)`; NV sale chỉ thấy `emp_code` của mình. Frontend KHÔNG tự lọc quyền.
2. **Không hardcode PII/nhân viên trong bundle frontend.**
3. **AI không bịa số:** số do `analytics.js`/`smart.js` tính; LLM (nếu bật) chỉ diễn giải trên FACTS đã tính, cấm chế số.
4. **Export đi qua backend** + kiểm quyền.

## 3 "dây cắm LIVE" khi lên server thật (tìm `// TODO(LIVE)`)
1. `auth.js` → OTP (port 3848) + SSO verify (port 3862).
2. `store.js` → đọc slot upload active + fallback ORDS (`SALES_REPORT`), targets (`V_TEM_TARGET_BONUS`).
3. `.env` → `ANTHROPIC_API_KEY` để bật AI diễn giải.

## Tài liệu liên quan
- `README.md` — chạy + tổng quan.
- `HANDOFF.md` — trạng thái hiện tại + việc còn lại (đọc trước khi code tiếp).
- `DEPLOY_CLOUDFLARE.md` — deploy Pages + Tunnel + Access.
- `../APP_REPORT_CURRENT_STATE_AUDIT_20260701_*.md` — hiện trạng app CŨ (để đối chiếu).
