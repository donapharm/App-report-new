# DIRECTIVE — App Report ĐỌC điểm/xu/phạt từ App VAT SSOT + hiển thị KPI + dòng cấn trừ + cảnh báo

> Claude Code giao Report Bot. **App VAT đã chốt SSOT** (`/api/khoan/dashboard`, service auth, commit `365b0c5`,
> rule_version `khoan-ssot-v2026-05-r1`). App Report **CHỈ ĐỌC + HIỂN THỊ** — KHÔNG tự tính, KHÔNG ghi payroll.

## 1. BACKEND — proxy đọc App VAT (như mẫu DataHub employee-cost)
- Route mới (session token của user), backend gọi **server-to-server** App VAT:
  `GET {VAT_BASE}/api/khoan/dashboard?month=&year=&emp_code=<emp ĐÃ scope>`
  Header: `Authorization: Bearer {process.env.VAT_SERVICE_TOKEN}`.
- **Scope quyền (bắt buộc):** `auth.scopeOf(session)` — NV sale → **ép emp = mã chính mình** (bỏ mọi `?emp=`); CEO/ADMIN → truyền emp bất kỳ.
  App VAT cũng bắt buộc emp_code + không cho service xem all → **khóa 2 lớp**.
- **`VAT_SERVICE_TOKEN` + `VAT_BASE` chỉ ở backend** (`.env`, `// TODO(LIVE)`), **KHÔNG ra FE, KHÔNG log token.**
- **Xử lý lỗi (fail-closed, không bịa):** 401→"chưa cấu hình nguồn điểm/xu" + log admin; 400→ép emp nên không xảy ra, gặp thì trả rỗng;
  502/timeout→retry backoff rồi trả rỗng; mọi lỗi→`{ note:"chưa lấy được điểm/xu kỳ này" }`.
- **Không** đưa điểm/xu/phạt vào LLM/NLQ public. **Audit** mỗi lượt (ai, emp, kỳ, rule_version).
- Trả FE: `diem_thang/quy · xu_thang/quy · carry · pct · thieu_du · thieu_xu · du_xu · **phat_du_kien** · rule_version` — **chỉ của emp được phép**.

## 2. FRONTEND — 3 KPI + dòng cấn trừ + cảnh báo
- **3 ô KPI mới:** `Điểm (tháng · quý)` · `Xu tích lũy (tháng · lũy kế quý, kèm carry)` · `Phạt dự kiến` (badge đỏ nếu >0).
- **Dòng "Cấn trừ do thiếu xu chi tiêu (quý)"** trong bảng/summary "Chi phí của tôi": hiển thị **`phat_du_kien`** (số âm, làm nổi),
  **TÁCH BẠCH** với chi phí gốc (DataHub). Hiển thị **"Chi phí gốc − Cấn trừ thiếu xu = Còn lại"** (display-only). App Report
  **KHÔNG sửa số chi phí DataHub, KHÔNG ghi payroll** — chỉ trình bày 2 nguồn cạnh nhau.
- **Cảnh báo giải thích (đúng ý CEO):** tooltip/banner *"Quý X: cần Y xu (= điểm doanh thu quý), bạn đạt Z xu, thiếu W →
  phạt = floor(điểm thiếu ÷2) × 600.000đ = … đ, cấn trừ vào chi phí"*. **Cảnh báo SỚM** khi `pct < 90%` giữa quý → NV kịp chạy.
- Nhãn rõ **nguồn: App VAT** + `rule_version`. Self-scope: NV thấy của mình; CEO/ADMIN xem NV bất kỳ / tổng khi "Tất cả NV".

## 3. RANH GIỚI (giữ chặt — tránh trừ oan tiền)
- **App VAT = SSOT điểm/xu/phạt.** App Report chỉ đọc & hiển thị số App VAT; **không tự tính, không remap.**
- Chi phí (DataHub) và phạt (App VAT) là **2 nguồn khác nhau** → hiển thị cạnh nhau, không trộn engine.
- C32/C47 không lộ; service token backend-only; audit; số khớp rule_version.

## 4. NGHIỆM THU
1. NV đăng nhập → KPI điểm/xu/phạt **đúng của mình**; thử `?emp=` khác → vẫn của mình (App Report ép + App VAT chặn).
2. Đối chiếu 1 NV với App VAT dashboard (cùng month/year): điểm/xu/phạt **khớp số App VAT** (App Report không lệch).
3. Dòng cấn trừ hiện `phat_du_kien`, tách khỏi chi phí gốc; "Chi phí gốc − cấn trừ = còn lại" đúng; cảnh báo sớm khi pct<90%.
4. Thiếu/sai `VAT_SERVICE_TOKEN` → fail-closed "chưa lấy được điểm/xu", **không lộ token, không bịa**. grep bundle FE: không token/không số tĩnh.
5. Self-scope + C32/C47 + audit giữ. Test + build PASS. Push nhánh review; báo Claude; chưa deploy.
