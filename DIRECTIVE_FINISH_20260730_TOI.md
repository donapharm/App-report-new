# DIRECTIVE CHỐT NỐT — 2 việc còn treo (CEO chốt 2026-07-30 tối)

Bối cảnh: đợt deploy `abe0498` đã nghiệm thu tốt (v3.6, tin phạt DN018 đúng, dedupe PASS).
Claude soát lại còn **2 điểm treo**. Làm đúng 2 gạch, có cổng chặn. Xong gộp 1 báo cáo.

Ràng buộc chung giữ nguyên: cấm build trong cây production · auto-deploy khoá · không sửa `employee_bonus_tiers.json`/`bonus_formula_lock.json` · không ghi đè `server/data/*.json` · backup `.env` trước khi sửa · chỉ restart đúng dịch vụ nêu ở từng việc.

---

## VIỆC 1 — Redeploy frontend từ ĐẦU `main`, không phải từ `abe0498`

Hộp vàng giải thích màn Cấu hình Phạt (*"ℹ Phạt áp dụng CHUNG cho toàn bộ nhân viên"*) chỉ có ở **`main` tip** (`Target.jsx`), **KHÔNG có** trong `abe0498` đã deploy. Đây chính là chỗ CEO bị rối "không thấy chọn từng NV hay tất cả".

1. `git pull origin main` → `git rev-parse HEAD` phải ≥ `e23e8a0` (luôn build đầu `main`).
2. Build frontend ở cây riêng → đưa `dist` sang. **KHÔNG restart API** (giữ PID `app-report`).

**CỔNG CHẶN (kiểm bằng mắt):** mở màn Quản target → **Cấu hình Phạt** → đầu màn phải thấy **hộp vàng "ℹ Phạt áp dụng CHUNG cho toàn bộ nhân viên"**. Chưa thấy ⇒ dist chưa lên bản mới, DỪNG, báo.

---

## VIỆC 2 — ‼ CỔNG CHẶN TIỀN: chốt số DN008 rồi mới bật 2 cờ thưởng

Report chưa nêu `pct` DN008; `EMP_COST_NOTIFY`/`BONUS_NOTIFY` đang `=0`. CEO chọn **phương án A (bật cả 2)** — nhưng chỉ bật khi số đã đúng.

1. `GET /api/employee-cost?emp=DN008&from=2026-07&to=2026-07` (token CEO). Dán `bonus.month.pct` thật vào báo cáo.
2. Rẽ nhánh theo số:
   - `pct` ≈ **130,26%** ⇒ đã tính lại đúng slot mới ⇒ backup `.env` → `EMP_COST_NOTIFY=1`, `BONUS_NOTIFY=1` → **chỉ restart `app-report-tgbot`** (KHÔNG restart `app-report`).
   - `pct` ≈ **117,71%** (hoặc bất kỳ số nào ≠ 130,26%) ⇒ **DỪNG.** Tính lại thưởng T07 theo slot `rev_2src_072026_…` trước, rồi mới bật cờ. **Tuyệt đối không bật cờ khi số còn sai** — gửi sai cho toàn đội không rút lại được.

**Nghiệm thu (khi được bật):** PID `app-report-tgbot` ĐỔI · PID `app-report` KHÔNG đổi · log in đủ 4 mốc (20:00/20:10 × dự kiến/số chốt) · danh sách người nhận (chỉ mã + kênh, KHÔNG số tiền) — KHÔNG có DN021/DN023/VP004/VP018.

---

## BÁO CÁO — gộp 1 lần
1. SHA đã build lại + xác nhận **thấy hộp vàng** màn Cấu hình Phạt.
2. `pct` thật của DN008.
3. Nếu bật cờ: PID đổi/không đổi + 4 mốc + danh sách người nhận. Nếu DỪNG: nói rõ số sai bao nhiêu, cần gì để đi tiếp.
