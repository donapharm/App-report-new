# SPEC — DATA HUB SMART APP (CEO-only) — build mới sạch

> Claude Code soạn (CEO duyệt 2026-07-09). Giao **bot build MỚI** app Data Hub theo phong cách **Smart App**
> (như App Report New làm lại từ app cũ), **chỉ CEO quản lý**, thay dần `data.donapharm.asia` hiện tại.
> File này để trong repo App Report New cho tiện version; **bot copy sang repo Data Hub mới** khi build.
> Đọc kèm khảo sát hiện trạng (bản đồ phụ thuộc) đã trao đổi: Report cũ đọc-ké-file `master_khachhang.json`;
> App Sale có DB hub song song; VAT không dính; App Report NEW **hiện chưa** đọc Hub.

## 1. MỤC TIÊU & PHONG CÁCH
- App **master data + kho dữ liệu chủ** của Donapharm, **SSOT** (nguồn gốc duy nhất) cho NV/đơn vị/khách hàng/
  nhà thầu/catalogs/mapping/quy đổi.
- **Smart App**: gọn, dễ dùng, mượt, responsive mobile/desktop; nhiều tính năng thông minh (validate/cảnh báo/
  gợi ý/AI). Backend quyết quyền; không bịa số; không hardcode PII/secret.
- **Chỉ CEO quản lý/theo dõi.** Phần chi phí là tài sản MẬT tuyệt đối.

## 2. NGUYÊN TẮC BẤT DI (bảo mật by-design)
1. **Quyền quyết ở backend.** Không tin client/LLM. NV thường không thấy route/tab/dữ liệu ngoài phạm vi.
2. **‼ COST KHÔNG BAO GIỜ CHẠM BỀ MẶT NHÂN VIÊN.** cost/điểm/%/margin + kết quả tính = **CEO-only**, tách store
   vật lý, không vào API dùng chung, không vào LLM facts, không export mặc định.
3. **Không commit số thật/PII/secret lên git.** Secret ở env/secret manager. PII (CCCD/SĐT/email/địa chỉ) chỉ
   ở store production, không lên repo.
4. **AI grounded**: số do backend tính; LLM chỉ diễn giải trên FACTS (CEO context), cấm chế số.
5. **Mọi thay đổi dữ liệu: preview → CEO duyệt → commit + audit.**

## 3. KIẾN TRÚC 2 TẦNG (tách bạch tuyệt đối)
**Tầng A — MASTER DATA (SSOT, phát API phân quyền):**
- Bảng: nhân viên, đơn vị, khách hàng, nhà thầu, danh mục bán hàng, QLNB/QĐTT, CST (bd/còn lại), quy đổi, mapping.
- Phát **API chính thức** cho Report/Sale/VAT tiêu thụ (thay việc đọc-ké-file). Read-only + phân quyền theo app-key.
- **KHÔNG chứa cột cost** ở tầng này.

**Tầng B — 🔒 CEO VAULT + COST ENGINE (CEO-only, khóa):**
- **CEO Vault**: CP Total/chi phí/điểm/rule chi phí/margin. Auth: password + **OTP thiết bị** + lock/unlock + audit.
- **Cost engine**: `revenue_snapshots` (kéo doanh thu từ Report/Sale) → `cost_vault_snapshots` → tính
  `cost_percent_results` per NV/đơn vị/QLNB/kỳ → **CEO-only view + export whitelist**.
- Modules tách rõ (không trộn catalog public): `revenue-sync/ · cost-vault/ · cost-engine/ · access-control/ · audit/`.
- API đều dưới `/api/ceo-vault/*` với guard CEO-only (≥ chặt hiện tại).
- Cột MẬT: `cp_total, cp_*, cost_*, chi_phi_*, diem_*, point_*, margin_*, percent_*, pct_*, ty_le_chi_phi,
  doanh_thu_goc(khi dùng tính cp), ket_qua_tinh_cp, rule_cp, audit_export_cp`.

## 4. ‼ BOUNDARY COST ↔ APP REPORT NEW (mấu chốt — CEO nhấn "hết sức cẩn trọng")
Tương lai App Report New lấy **vài cột chi phí** để tính chi phí/doanh thu per NV/đơn vị. App Report New có
**bot NLQ + email tới 17 NV** → nếu raw cost lọt vào kho chung của nó là **lộ lãi/lỗ toàn đội**. Bắt buộc:
- **Data Hub TỰ TÍNH** (có sẵn doanh thu snapshot + cost vault) → ra cost%/kết quả per NV/đơn vị.
- App Report New **KHÔNG giữ raw cost**. Chỉ nhận **kết quả đã tính** qua **API CEO-auth của Hub**.
- App Report New hiển thị kết quả **CHỈ trong khu CEO-only khóa riêng** (password/OTP), **store tách vật lý**
  khỏi dữ liệu doanh thu chung.
- **NLQ + email report của App Report New TUYỆT ĐỐI không đọc được** khu cost đó (guard + store riêng + không
  đưa vào LLM facts). Giữ guard "câu hỏi nhạy cảm → từ chối".
- Không đọc file chung; chỉ gọi API đã phân quyền. Mỗi lần kéo/tính: preview → CEO duyệt → commit + audit.

## 5. HỢP ĐỒNG API (2 nhóm tách biệt)
- **Public master-data API** (Report/Sale/VAT): `GET /api/hub/{employees|units|customers|contractors|catalogs|
  qlnb|cst|conversions}` — read-only, app-key phân quyền, **không cost**, có version/checksum để đồng bộ.
- **CEO-only API**: `/api/ceo-vault/*` (vault CRUD preview/commit) + `/api/ceo-vault/revenue-sync/*` +
  `/api/ceo-vault/cost-engine/*` + `/api/ceo-vault/cost-percent/rows|export`. Tất cả qua guard CEO + audit.

## 6. SMART FEATURES (chuẩn .com)
- **Import thông minh**: validate schema, phát hiện **lệch/trùng/mapping sai/thiếu**, cảnh báo chủ động trước commit.
- **Preview → CEO duyệt → commit**, rollback, **audit** (actor/kỳ/nguồn/checksum/số dòng/version).
- Tìm kiếm nhanh + gợi ý (mã NV/đơn vị/khách/nhà thầu/QLNB).
- **AI hỏi nhanh cho CEO** (grounded, CEO context — được hỏi cả cost vì chỉ CEO): "chi phí đơn vị X kỳ này?",
  "% chi phí NV nào cao nhất?" — số do engine tính, LLM chỉ diễn giải.
- **Trash/restore**, export (whitelist cột — mặc định chặn cost/%/margin).
- Responsive mobile/desktop, UX mượt.

## 7. BẢO MẬT CHI TIẾT
- Auth CEO: password (hash) + **OTP thiết bị tin cậy** + lock/unlock phiên; NV/app khác chỉ chạm tầng A qua app-key.
- Secret (bot token/internal key/API key) ở **env/secret manager**, không hardcode, không commit.
- **Audit** mọi xem/tải/export/tính lại cost. Export cost = CEO-only + whitelist + log.
- Không tính trên live chưa chốt — dùng **snapshot theo kỳ** để truy vết.

## 8. KỸ THUẬT & TRIỂN KHAI
- Stack như App Report New: **Node/Express + React/Vite**, quyền ở backend, AI grounded.
- **Repo riêng + phiên riêng** (build sạch, CEO-only). Port riêng; domain `data.donapharm.asia`; PM2 riêng.
- **Chạy song song** app Data Hub cũ; chuyển từng điểm; **SSOT = Data Hub mới**; các app khác chuyển đọc-file →
  API dần (lộ trình P0–P5 đã khảo sát). **Không big-bang.**
- Repo khảo sát/handoff: **schema-only** (không số thật/PII/secret) — đã áp cho `data-hub-schema-only`.

## 9. LỘ TRÌNH (giao bot)
- **P0** Chốt SSOT = Data Hub mới; dựng khung app + auth CEO (password/OTP) + tầng A master data.
- **P1** Import + Smart validate + preview/commit + audit cho master data; phát **public API** (bắt đầu customers/units).
- **P2** Chuyển Report cũ (+ Report New khi cần) từ **đọc-file → gọi API Hub**; test song song, rollback được.
- **P3** CEO Vault (cost) + OTP + audit + export whitelist (di trú cp-total hiện có).
- **P4** Cost engine: revenue-sync ← Report/Sale → cost% per NV/đơn vị → CEO-only view.
- **P5** Boundary API CEO-auth cho App Report New (khu cost khóa riêng) — theo mục 4.
- Mỗi P: `preview→duyệt→commit`, audit, không đụng số thật khi build/test (dùng sample giả).

## 10. NGHIỆM THU
Mỗi phase: build chạy, test bằng **dữ liệu giả**, không số thật/PII/secret lên git; auth CEO chặn đúng; public
API không lộ cost; NLQ/report App Report New không chạm được cost. Ghi CHANGELOG repo Data Hub. Báo Claude review.
