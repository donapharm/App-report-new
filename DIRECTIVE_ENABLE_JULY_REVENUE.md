# DIRECTIVE — Bật đồng bộ DOANH THU tháng 07/2026 từ App Sale (LIVE, additive)

> Claude Code giao (CEO hỏi vì sao chưa thấy T07 2026-07-02). Bot triển khai; Claude review.
> Nguyên tắc: 01–06/2026 Lumos ĐÓNG BĂNG bất biến; chỉ THÊM kỳ 07.2026 từ App Sale. Không cắt Lumos, không sửa số cũ. Đọc kèm `SPEC_DATASOURCE_CUTOVER.md` mục A.

## Vì sao T07 chưa hiện (hiện trạng, không phải lỗi)
- Cầu nối App Sale→App Report mới ở mức **SHADOW** (đối chiếu), chưa bật LIVE.
- App Sale T07 gần trống (đầu tháng 02/07, ~2 đơn pending).

## Bước 1 — XÁC NHẬN 3 điểm từ App Sale API (:3970, read-only) → báo Claude
1. **VAT:** field doanh thu App Sale là **trước hay sau VAT**? (App Report: `revenue` sau VAT, `revenueBeforeVat = revenue / VAT_DIVISOR`). Nếu App Sale để trước VAT → phải quy đổi cho khớp định nghĩa.
2. **Kênh:** doanh thu báo cáo tính **CL+NCL+NT (tổng bán)** hay chỉ CL? (Mặc định đề xuất: **tổng bán như app cũ**; CST mới chỉ CL.) Xác nhận cách app cũ tính để khớp.
3. **Trạng thái = đã bán:** liệt kê trạng thái App Sale → chốt trạng thái nào tính doanh thu (đã duyệt/giao/xuất HĐ), loại `pending`/`CANCELLED`/`rejected` (net).

## Bước 2 — Adapter doanh thu LIVE (kỳ 07.2026)
- Kéo đơn App Sale từ `2026-07-01`, áp **crosswalk** (emp_code + đơn vị + SP đã dựng) → tổng hợp thành kỳ `07.2026`, **materialize như slot** trong `store.js` (giống cơ chế slot upload: kỳ 07 = nguồn App Sale, các kỳ khác giữ nguyên).
- **emp_code**: dùng crosswalk đã cập nhật (đã thêm DN021/VP004; còn VP019 kế toán bỏ qua). Đơn của mã lạ → gom "Chưa phân bổ", không bịa.
- Thêm `07.2026` vào `listPeriods` để bộ lọc kỳ + biểu đồ xu hướng có mốc T07.
- **Incremental**: dùng contract `/api/report-sync/changes?updated_since=` đã đề xuất; nếu chưa có endpoint thì tạm poll theo `updated_at` + cursor, idempotent (không cộng trùng).

## Bước 3 — Nghiệm thu trước khi bật cho CEO
- **01–06 KHÔNG đổi** (T06 vẫn 28.403.136.096). Chỉ thêm kỳ 07.
- Số kỳ 07 khớp App Sale (đối chiếu vài đơn: đúng NV/đơn vị/SP/tiền, đúng VAT, đúng net trạng thái).
- Đầu tháng T07 nhỏ/gần 0 là ĐÚNG (chưa phát sinh) — không coi là lỗi; số lớn dần theo ngày.
- Scope: NV sale chỉ thấy T07 của mình; CEO thấy toàn công ty.
- Chạy SHADOW đối chiếu 1–2 ngày nếu cần, rồi mới hiển thị chính thức. Ghi CHANGELOG + báo Claude review.

## Lưu ý
- Đây là DOANH THU. CST tháng 07 theo nhánh riêng (baseline + timeline, `SPEC_DATASOURCE_CUTOVER` mục B/E/F/G).
- Không đụng app cũ 3860; App Sale chỉ ĐỌC.
