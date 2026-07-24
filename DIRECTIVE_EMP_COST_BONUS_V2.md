# DIRECTIVE — Thưởng v2: 2 phần (cơ bản + nhóm ưu tiên) + config linh hoạt theo giai đoạn/đè-tầng + menu Target

> Claude Code giao Report Bot. Nâng cấp ô "Thưởng dự kiến" (#159/#160) → engine 2 phần, cấu hình được theo
> giai đoạn/NV/nhóm hàng/tuyến/đơn vị, chỉnh ngay trong **menu Cài đặt Target**. **Vẫn là THƯỞNG DỰ KIẾN** (App Report
> tính từ target + doanh thu sẵn có; KHÔNG payroll, KHÔNG gửi thưởng). CEO chốt 2026-07-23.

## 1. CÔNG THỨC
**Phần 1 — Cơ bản** (× doanh thu trước VAT theo % đạt target):
`<90%→0 · 90–<100%→0.10% · 100–<110%→0.15% · 110–<130%→0.18% · ≥130%→0.25%`.

**Phần 2 — Nhóm ưu tiên** — CHỈ khi **TỔNG % đạt target ≥ 101%**, cộng thêm mỗi nhóm `rate × doanh thu QLNB thuộc nhóm`:
`H.A*→1.0% · H.A→0.8% · H.B→0.5% · H.C→0.1% · H.D→0.1%`.

**Tổng thưởng dự kiến = Phần 1 + Phần 2.** Base tối đa 0.25% (không kẹp cap 0.5% cũ vào tổng); phần nhóm cộng riêng.
**Cap tổng** để cấu hình (mặc định không kẹp; CEO đặt trần an toàn nếu muốn).

## 2. NHÓM ƯU TIÊN (mã QLNB → nhóm) — nguồn: **CEO vault cột C10 (DataHub)** ‼ CEO chốt
- **Nguồn chính thức = `C10` trong CEO vault (DataHub)** — mỗi mã QLNB có nhóm `H.A*/H.A/H.B/H.C/H.D`. **App Report ĐỌC C10**
  từ catalog snapshot DataHub cấp; **KHÔNG tự phân loại, KHÔNG config tay.** C10 = SSOT phân loại.
- **Phụ thuộc DataHub:** DataHub phải **expose C10** vào catalog snapshot App Report đọc (task `TASK_DATAHUB_EXPOSE_C10_PRIORITY.md`,
  whitelist như C48, vẫn khóa C32/C47). **Bot xác minh** C10 đã có trong snapshot chưa; chưa có → chờ DataHub bổ sung.
- Mã có C10 rỗng (chưa phân nhóm) → **không cộng phần 2** cho mã đó (không bịa). C10 là thuộc tính sản phẩm (không per-NV).

## 3. CONFIG LINH HOẠT (điểm "thông minh" CEO yêu cầu)
- **Theo GIAI ĐOẠN (versioned):** mỗi kỳ/giai đoạn 1 bản config (hiệu lực từ ngày…); kỳ cũ tính đúng bản cũ, không mất lịch sử.
- **ĐÈ TẦNG (cụ thể thắng):** `mặc định → nhóm hàng → tuyến → đơn vị → NV`. Cho phép đặt riêng bậc/nhóm-rate cho 1 NV/tuyến/đơn vị
  mà không phá mặc định. (Giống mô hình công tắc hiển thị.)
- Tất cả **bậc %, nhóm-rate, ngưỡng ≥101%, cap** đều cấu hình được.

## 4. MENU CÀI ĐẶT (trong trang Target — CEO/ADMIN)
- Hiển thị **công thức đang áp** (bậc cơ bản + nhóm ưu tiên + phạm vi/giai đoạn).
- **CEO sửa trực tiếp** (thêm/xóa bậc, đổi rate nhóm, chọn phạm vi NV/tuyến/đơn vị/nhóm hàng, đặt giai đoạn) → ghi config + **audit** + version. KHÔNG sửa file tay.
- **Bảng MÔ PHỎNG (preview):** đặt config → hiện ngay "NV X đạt Y% → thưởng cơ bản A + nhóm B = C" **trước khi lưu** → tránh cài sai.
- Validate fail-closed: config sai/thiếu → giữ bản hợp lệ gần nhất hoặc "Chưa cấu hình", **không bịa**.

## 5. HIỂN THỊ (ô KPI + tách phần)
- Ô **"Thưởng dự kiến"**: tổng + tooltip **tách Phần 1 / Phần 2** (nhóm nào cộng bao nhiêu) + "% đạt target · giai đoạn áp".
- Nhãn **"dự kiến/tham khảo"**. Self-scope: NV của mình; CEO/ADMIN xem NV bất kỳ / tổng khi "Tất cả NV".
- Số doanh thu/target từ analytics sẵn có; phân loại nhóm từ §2. **Không** payroll, **không** gửi thưởng.

## 6. RANH GIỚI
- Thưởng = **dự kiến do App Report tính** (khác điểm/xu/phạt = App VAT). Không trộn engine. C32/C47 không lộ. Audit.

## 7. NGHIỆM THU
1. Đối chiếu tay 1 NV: Phần 1 (bậc đúng × DT) + Phần 2 (khi ≥101%, Σ rate×DT-nhóm) = đúng ô hiển thị; <90%→0; <101%→không phần 2.
2. Menu Target: CEO đổi bậc/nhóm-rate/phạm vi/giai đoạn → lưu + audit + version; **preview đúng trước khi lưu**; đè tầng đúng thứ tự.
3. Nhóm ưu tiên đọc đúng nguồn (§2); mã chưa phân nhóm → không cộng bừa. Fail-closed. Self-scope + C32/C47 giữ.
4. Test + build PASS. Push nhánh review; báo Claude; chưa deploy. (Có thể làm 2 pha: engine 2-phần trước, menu-config + đè-tầng sau.)
