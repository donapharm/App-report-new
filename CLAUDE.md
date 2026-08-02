# CLAUDE.md — App Report (Donapharm)

Đọc file này đầu tiên khi tiếp nhận dự án. Đây là bản **build lại gọn** của nguồn App Report đã cách ly (mega `server.js` gom 10 nghiệp vụ) thành **smart app** chỉ giữ 6 nội dung cốt lõi.

## Mô hình phối hợp (CEO chốt 2026-07-02)
- **Bot server = người TRIỂN KHAI chính**: viết code app trên server (test được dữ liệu/OTP/CST/ORDS thật), build, commit/push. Là người "cầm code chính" để tránh 2 bên đụng repo.
- **Claude Code = KIẾN TRÚC + REVIEW**: soát lỗi/bảo mật, định hướng, không sửa+push code app song song (tránh xung đột) — chỉ sửa khi thống nhất việc cụ thể hoặc sửa tài liệu.
- Quy trình: bot đẩy 1 đợt → Claude pull review → báo duyệt/điểm cần sửa. Mọi thay đổi vẫn ghi `CHANGELOG.md`.
- **‼ BOT PHẢI `git pull origin main` (hoặc `git fetch && git reset --hard origin/main`) TRƯỚC MỖI ĐỢT LÀM** để có directive/spec mới nhất Claude push. Đã có vụ bot "không thấy file DIRECTIVE_*" vì làm trên bản cũ. Đọc CHANGELOG.md + các `DIRECTIVE_*.md`/`SPEC_*.md` mới nhất trước khi code.

## ‼ MÚI GIỜ — GMT+7, KHÔNG BAO GIỜ DÙNG UTC (CEO nhắc nhiều lần, 2026-08-03)
> CEO: *"tao làm việc theo giờ GMT+7, tao đã nói nhiều rồi, mày phải ghi nhớ lại — hèn chi cái vụ giờ giấc mày cứ lộn hoài, ảnh hưởng đến truy vấn đơn hàng/doanh thu."*

**Toàn bộ ngày/giờ nghiệp vụ chạy theo giờ Việt Nam (GMT+7 · `Asia/Bangkok`).**

1. **CẤM `new Date().toISOString().slice(0,10)`** để lấy "hôm nay". Nó trả ngày **UTC** ⇒ từ **00:00–07:00 sáng giờ VN** ra **NGÀY HÔM QUA**, làm lệch `asOf`, cắt mất doanh thu/chi phí trong ngày, chọn nhầm kỳ đầu tháng. Đây là lỗi đã xảy ra thật (`routes.js` `asOf`, `employeePenaltyPolicy` `currentMonth`).
2. **Dùng helper sẵn có:** `employeeCost.vnToday()` (server) · `revenueCoverage.bangkokToday()` / `PeriodFilter.currentKyVN()` (web). Cần mới thì bọc `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', ... })`.
3. **SQL:** ngày lấy từ cột timestamp phải `AT TIME ZONE 'Asia/Bangkok'` trước khi `::date`.
4. **Khi báo cáo cho CEO:** luôn ghi **giờ GMT+7**, không ghi UTC. Mốc lịch (20:00 tin nhắn, khoá sổ ngày 8, hạn 08/08…) đều là **giờ VN**.
5. Viết code mới có dính ngày/tháng ⇒ **mặc định GMT+7**, không hỏi lại.


```bash
npm run setup   # cài server+web, sinh dữ liệu mẫu ẩn danh
npm run dev     # API :3873 + web :5173  → mở http://localhost:5173
```
Đăng nhập demo: bấm tài khoản mẫu ở màn login (CEO / ADMIN / DN001..DN012).

## Phạm vi (đã chốt với CEO)
- **GIỮ:** Tổng quan (+cảnh báo chủ động), Doanh thu (drill-down NV→ĐV→SP), Cơ số thầu, Target (xem + dự báo theo trend), Export Excel, AI hỏi nhanh, Upload (admin).
- **ĐÃ CẮT:** VAT, Fleet/Drive, Kho master data, Điều chuyển NV, gửi thưởng tự động, face/device verify. (Thuộc app/bot khác.)
- **NGOẠI LỆ chi phí (CEO chốt 2026-07-20):** App Report có module **"Chi phí của tôi"** — mỗi NV xem **chi phí/hoa hồng CỦA CHÍNH MÌNH** (self-scoped, backend khóa quyền). Số **do DataHub tính (SSOT)**, App Report chỉ hiển thị qua service endpoint; **KHÔNG** dựng engine chi phí riêng, **KHÔNG** để lộ số người khác/tổng payout. Đây là ngoại lệ có kiểm soát của nguyên tắc "báo cáo không chứa chi phí". Spec: `SPEC_REPORT_EMP_COST_SELFVIEW.md`.

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
5. **Đổi cách tính thưởng ⇒ PHẢI nâng version** (CEO chốt 2026-07-29). Số hiệu công thức chỉ có 1 nguồn: `employeeBonus.FORMULA_VERSION`; file cấu hình, nhãn trên nút/hộp thoại đều lấy từ đó, cấm ghi thẳng "v3.x" vào JSX. Sửa công thức thì làm đủ: nâng `FORMULA_VERSION` → sửa `version`+`note` trong `config/employee_bonus_tiers.json` → ghi lại `version`+`sourceHash` vào `config/bonus_formula_lock.json` → ghi `CHANGELOG.md`. Quên bước nào thì `server/test/bonusFormulaVersion.test.js` đỏ.

## 3 "dây cắm LIVE" khi lên server thật (tìm `// TODO(LIVE)`)
1. `auth.js` → OTP (port 3848) + SSO verify (port 3862).
2. `store.js` → đọc slot upload active + fallback ORDS (`SALES_REPORT`), targets (`V_TEM_TARGET_BONUS`).
3. `.env` → `ANTHROPIC_API_KEY` để bật AI diễn giải.

## Chuẩn UI desktop (CEO chốt 2026-07-02)
- **Trang "Phân tích" là CHUẨN MẪU bố cục PC:** hàng thẻ KPI ngang trên cùng → các panel nhiều cột (2–3 cột) tận dụng chiều ngang, trong khung `.page-desktop` 1600px căn giữa.
- KHÔNG dùng lưới tự chia trên `.page-desktop` (đã bỏ). Trang tự quản lý layout nội bộ bằng class tường minh (vd `.mini-columns`, `.kpi-grid`, `.alerts-grid`).
- Trang mới/duyệt lại trang cũ trên PC: theo mẫu Phân tích; mobile giữ 1 cột dọc.

## Quy trình ghi log (BẮT BUỘC)
- **Mọi thay đổi app phải ghi 1 mục vào `CHANGELOG.md`** (mới nhất trên cùng): ngày, việc đã làm, lý do, trạng thái test.
- Đọc repo lần đầu: mở `CHANGELOG.md` trước để nắm toàn cảnh + tiến trình hiện tại.

## Tài liệu liên quan
- `CHANGELOG.md` — **đọc đầu tiên**: nhật ký thay đổi + trạng thái hiện tại.
- `SPEC_BONUS_PENALTY_V33.md` — **Phạt v3.3** (CEO chốt 2026-07-29): trừ vào **cột C45 "Lương tăng thêm"** — **≥90% không phạt**, 70–90% trừ 0,2%, 50–70% trừ 0,3%, **≤50% mất trắng C45** (không cộng vào tổng chi phí nhận); trần phạt = chính tiền C45. Cộng phạt thiếu Xu (dùng lại `xuPolicy.js`, không viết lại). **Tất cả NV xem được phạt của chính mình + công thức** (self-scoped). Phạt là trường RIÊNG, KHÔNG trộn vào `amount`, KHÔNG ghi đè số DataHub. Thêm 4 ô KPI + **cảnh báo sớm** ("mất trắng … nếu không thêm … trước VAT"). **T07.2026 chỉ cảnh báo; tự trừ thật từ 01/08/2026** theo `penaltyEffectiveFrom` — không có bước bật cờ tay. Chưa đụng tin nhắn. Ship = nâng version lên v3.3.
- `SPEC_REVENUE_DELIVERY_PERIOD.md` — **Quy kỳ doanh thu theo NGÀY THỰC GIAO** (CEO chốt 2026-07-29). Truy ra 382,6 triệu biến mất vì **bộ lọc kép ngày** làm đơn rơi khỏi CẢ HAI kỳ. Kỳ **khoá sổ hết ngày 5 tháng sau**; **KHÔNG hồi tố**, không đòi lại thưởng đã báo, không phạt hồi tố.
- `SPEC_REVENUE_SYNC_EXCEPTIONS.md` — **Màn "Chưa đồng bộ"** (CEO chốt 2026-07-29). Nguyên tắc: **KHÔNG dòng nào được biến mất lặng lẽ**. Lấy toàn bộ → phân loại → 2 kết quả; bất biến `Σ(đưa vào)+Σ(loại)==Σ(nguồn)`, lệch thì DỪNG. Mỗi mã lý do phải đủ **nghĩa · ai xử lý · làm gì**. Cấm App Report tự đoán ngày.
- `README.md` — chạy + tổng quan.
- `HANDOFF.md` — trạng thái hiện tại + việc còn lại (đọc trước khi code tiếp).
- `DEPLOY_CLOUDFLARE.md` — deploy Pages + Tunnel + Access.
- `../APP_REPORT_CURRENT_STATE_AUDIT_20260701_*.md` — hiện trạng app CŨ (để đối chiếu).
