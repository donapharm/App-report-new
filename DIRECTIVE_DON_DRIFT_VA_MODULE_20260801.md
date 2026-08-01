# DIRECTIVE — Dọn drift → main=production, rồi build module "Thanh toán CP" GĐ1 (CEO chốt 2026-08-01, phương án A)

Làm đúng thứ tự. Bước 1 là CỔNG — chưa xong không nhảy bước 3.

---

## BƯỚC 1 — ‼ DỌN DRIFT: đưa production về đúng `main`

> **⏫ CEO NÂNG ƯU TIÊN (01/08 chiều):** bước này đang **chặn fix tháng mặc định** — CEO mở app vẫn thấy **T07** dù hôm nay 01/08, và mỗi lần mở lại thấy sai. **Làm dứt điểm Bước 1 TRƯỚC MỌI VIỆC KHÁC.** Xong là **báo ngay 2 SHA trùng** (đừng đợi gộp báo cáo cuối), rồi deploy fix tháng cùng lượt.
> Nếu reconcile vướng (conflict, commit mồ côi, không rõ commit nào đang chạy) ⇒ **báo ngay chỗ vướng**, đừng im lặng xử lâu — Claude gỡ cùng.

Hiện production chạy `97b87d6` (và có `5873806` Worklist, `640685c` KPI) — **không có trên `origin/main`** (`origin/main` đang ở đầu docs/spec của Claude + connector `e5a7df1`). Đây là lần thứ 3 deploy từ bản local. Phải chấm dứt.

1. **Reconcile:** gộp mọi commit ĐÃ DEPLOY (`97b87d6`, `5873806`, `640685c`, branch `feat/kpi-remaining-after-advance` = ô Còn lại + guard) **lên `origin/main`**. **GIỮ NGUYÊN** toàn bộ docs/spec/directive Claude đã push trên main (SPEC_*, DIRECTIVE_*) — không được rớt.
2. **Deploy lại TỪ `origin/main`.**
3. **CỔNG CHẶN (bắt buộc, dán bằng chứng):**
   - `git rev-parse origin/main` == commit đang chạy production (cùng SHA).
   - Không còn commit nào chạy trên server mà thiếu trên main.
   - Test nền XANH · `formulaVersion` không đổi · PID API không đổi (chỉ dist nếu chỉ đổi FE).
   - Từ đây: **CẤM deploy từ bản local — chỉ deploy đầu `origin/main`.**

Chưa đạt cổng này ⇒ DỪNG, báo. Không làm bước 3.

---

## BƯỚC 2 — Tin thưởng: giữ cờ TẮT, gửi SỐ CHỐT sau khoá sổ (không phải build)

Tin 20:00 tối 31/07 đã lỡ. **Quyết (Claude khuyến nghị, CEO duyệt phương án A):** BỎ bản "dự kiến", **gửi thẳng SỐ CHỐT sau khoá sổ 08/08**.
- `EMP_COST_NOTIFY=0`, `BONUS_NOTIFY=0` — **giữ nguyên TẮT** tới sau 08/08.
- Ngày **09/08** mới bật, qua đúng cổng DN008 **before-VAT (~124,21%)** như `DIRECTIVE_GO_BONUS_NOTIFY`. Không tự bật sớm.
- (Đây là mặc định an toàn, đảo được: CEO muốn gửi bản dự kiến sớm hơn thì báo.)

---

## BƯỚC 3 — Build module "Thanh toán CP của tôi" — GIAI ĐOẠN 1

**Chỉ làm sau khi BƯỚC 1 đạt cổng (main=production).** Theo `SPEC_THANH_TOAN_CP_SELFVIEW.md`. Xây trên nền `origin/main` sạch.

Phạm vi GĐ1:
- Màn **"Thanh toán CP của tôi"**: Tổng kỳ (DataHub) · **Lần 1** (App Salary) · **Lần 2/3 tính tại App Report** (60/40, sửa được) · **<60tr → 2 lần** (ngưỡng CONFIG) · **C44 sổ riêng cộng dồn T12**.
- **Sổ còn nợ = cộng dồn** các lần chưa nhận; trạng thái tĩnh hiện đủ tổng.
- **Timeline khoảng cách:** Lần 1 →45 ngày→ Lần 2 →15 ngày→ Lần 3; hiện "còn … ngày tới lần sau".
- **Self-scope NV** + **màn CEO tổng hợp** (khuôn aggregate hiện có; NV thiếu/nghi tách riêng, không thành 0).
- **CHƯA làm GĐ2** (ghi nhận đã trả lần 2/3, Telegram nhắc/quá hạn) — để đợt sau.
- Bất biến: tổng các lần (2 hoặc 3) = Tổng kỳ; C44 tách riêng. Lệch → cảnh báo, không show số chỏi.

**Cách giao (kỷ luật review):** build trên **branch review**, push, **Claude soi trước**, đạt thì merge main → deploy từ main. **KHÔNG cutover thẳng** (đây là màn tiền, tránh lặp vết drift).

---

## BÁO CÁO
1. Bước 1: SHA `origin/main` == production (dán cả 2) + xác nhận hết commit lạ.
2. Bước 2: xác nhận 2 cờ vẫn TẮT.
3. Bước 3: link branch review + ảnh màn DN001 (3 lần + timeline + còn nợ) để Claude soi.
