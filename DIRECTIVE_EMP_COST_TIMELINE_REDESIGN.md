# DIRECTIVE — REDESIGN model chi phí: % theo TIMELINE + danh sách dòng do App Report dẫn dắt

> Claude Code giao 2 bot. **CEO xác nhận model 2026-07-21.** Sửa lại một điểm gốc: bỏ phụ thuộc `sales_facts`.
> Ưu tiên cao — thay thế cách hiểu cũ (danh sách dòng lấy theo sales_facts của DataHub → T07=0). Nối tiếp
> `DIRECTIVE_EMP_COST_MASTER.md`.

## 1. MODEL ĐÚNG (CEO chốt — nền tảng)
1. **% chi phí = TIMELINE thường trực** ở CEO Vault, theo **mã hàng**. Mỗi lần đổi có **tháng hiệu lực**, áp **từ
   ngày đầu tháng đó**, và **carry** sang các tháng sau tới khi có đổi mới.
2. **Tra %(mã hàng P, tháng M)** = lần đổi mới nhất **hiệu lực ≤ ngày-đầu tháng M**. **KHÔNG gate theo `sales_facts`**
   của tháng M — bất kỳ tháng nào cũng tra được. Mỗi cột (`c36…c44`) có timeline riêng.
3. **Danh sách dòng hiển thị do App Report DẪN DẮT:** các **mã hàng NV thực sự bán trong tháng M** (App Report có
   doanh thu). Với mỗi mã → **tra % từ DataHub timeline** (hiệu lực cho M).
4. **Thành tiền dòng = doanh thu dòng (App Report, tháng M) × %(DataHub, hiệu lực M) ÷ 100.**
5. ⇒ **T07 PHẢI hiện** dù DataHub chưa nạp `sales_facts` T07 — vì dòng lấy từ doanh thu App Report, % lấy từ timeline.

Ví dụ Cerecaps: đổi chi phí tại T07.2026 → hiệu lực 01/07/2026. Hai đơn (05/07 và 21/07) đều dùng **mức % T07**;
Thành tiền mỗi dòng = doanh thu dòng × % T07.

## 2. DATAHUB BOT sửa
- Endpoint trả **% theo timeline**, KHÔNG theo `sales_facts`: input `(emp, from/to)` → trả, cho **từng mã hàng của
  NV** (theo catalog/cấu hình vault), **mức % hiệu lực tại tháng được hỏi** (tra timeline: lần đổi mới nhất ≤ ngày-đầu
  tháng). Kèm `ky/period` = tháng.
- Bất kỳ tháng nào (T07/T08…) cũng trả được, kể cả tháng chưa có giao dịch. Nếu không đổi giữa các tháng → cùng mức.
- Giữ bảo mật: self-scope theo `emp`, khóa cứng `C32/C47`, whitelist `C33–C46`, `x-assignment-key`.
- Báo lại Claude/Report Bot **shape + 1 mẫu** (ẩn danh) có trường hiệu lực/kỳ.

## 3. REPORT BOT sửa (trên nền `1a5cdd35`)
- **Đổi nguồn danh sách dòng:** dẫn dắt từ **doanh thu App Report** (mã hàng × đơn vị NV bán trong tháng M), **thay
  vì** từ rows `sales_facts` của DataHub.
- Với mỗi dòng doanh thu (đơn vị × mã hàng, tháng M): **tra % của mã hàng đó từ DataHub** (timeline, hiệu lực M) →
  Thành tiền = doanh thu × % ÷ 100. Ghép theo **mã** (đơn vị `c7` + mã hàng resolve từ `c16`/mã QLNB).
- **Giữ nguyên** phần đã đạt: xem theo ngày (cùng % tháng, Σ ngày = tháng), tổng tháng/tổng kỳ, **c44** tách cuối
  năm, hiển thị `%` dạng `8.0`, self-scope NV, `C32/C47`, công tắc bật/tắt.
- Dòng có doanh thu nhưng **thiếu % từ DataHub** → Thành tiền `—` + đếm vào tỉ lệ chưa khớp (không đoán).

## 4. NGHIỆM THU (số thật)
1. **T07 DN001:** hiện các mã hàng NV bán T07 (vd Cerecaps 3 dòng) với % lấy từ timeline; Thành tiền tính đúng —
   **KHÔNG còn "0 dòng"**.
2. T06 vẫn đúng. Dán vài dòng thật `đơn vị · mã hàng · % · doanh thu dòng · Thành tiền` + **tỉ lệ khớp %**.
3. Đổi mức chi phí một mã ở tháng X → các tháng ≥ X dùng mức mới; tháng < X giữ mức cũ (kiểm timeline/carry).
4. Push nhánh review lên **`donapharm/app-report-new`** để Claude soi. Ghi CHANGELOG; chưa deploy.
