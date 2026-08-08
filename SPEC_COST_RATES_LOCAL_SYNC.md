# SPEC — KÉO % CHI PHÍ VỀ APP REPORT + NÚT ĐỒNG BỘ (CEO chốt 08/08/2026)

> CEO: *"Nếu mình kéo các cột % chi phí về đây rồi thì dù DataHub có chết cũng không
> bị ảnh hưởng — dữ liệu đang nằm bên này rồi. Trừ khi đồng bộ mới thì DataHub đang
> chết nên không làm tươi được."* — đúng, và đó là toàn bộ triết lý của spec này.

Bối cảnh: 08/08 DataHub chết diện rộng (19×503, 2×unavailable) ⇒ 0/21 NV có chi phí,
màn Chi phí trắng toàn bộ %. Cơ chế bị động sẵn có (`employeeCostRateSnapshot`) không
cứu được vì kỳ mới chưa từng lấy sạch + lỗ hổng nhánh `not_configured` bỏ qua restore.

## Bốn quyết định CEO chốt 08/08

1. **Kéo C33–C46 (tỷ lệ %) về App Report** — nguồn số vẫn là DataHub, App Report giữ
   BẢN SAO có mốc thời gian; hết phụ thuộc nguồn sống từng giờ.
2. **C32 · C47 (thành tiền) — MENU RIÊNG BIỆT**, không nằm chung màn nào có sẵn.
   Bốn cột: **C32 chưa VAT · C32 có VAT · C47 chưa VAT · C47 có VAT**.
   *Lý do CEO:* giảm rủi ro lộ lọt — lỡ có lỗ hổng code/quyền ở màn NV thì hai cột
   tiền tổng không nằm cùng chỗ để bị vạ lây.
3. **TẤT CẢ C32–C47 đều có công tắc TẮT/MỞ theo từng NV** — mô hình như
   `employeeCostVisibility` đang dùng ở "Chi phí của tôi"/"Thanh toán CP"
   (cá nhân > nhóm > toàn phòng, backend quyết, có audit). % dùng grants cột đã có;
   C32/C47 dùng công tắc riêng của menu riêng.
4. **Nút "🔄 Đồng bộ % chi phí" — chỉ CEO bấm.** Bình thường không cần bấm; chỉ bấm
   khi DataHub đổi % / đổi danh mục.

## Kiến trúc

### Kho tỷ lệ cục bộ (mở rộng `employeeCostRateSnapshot` → kho theo KỲ)
- `cost_rates_local` (persist): mỗi kỳ một bản: `{ period, fetchedAt, fetchedBy,
  pairs: [{unit, qlnb, c33..c46}], sourceMeta }`. Đây là **bản sao đóng dấu thời gian**,
  không phải nguồn mới: App Report **không có UI sửa %**, sửa vẫn ở DataHub.
- Thứ tự đọc khi màn hình cần %: **nguồn sống → kho cục bộ (gắn nhãn) → '—'**.
  Nhãn bắt buộc khi dùng kho: *"Số đồng bộ lúc HH:MM dd/mm"* — cấm hiện số cũ mà
  không nói. Không TTL chết cứng như snapshot cũ (45 ngày) — thay bằng nhãn tuổi số
  + cảnh báo vàng khi > 7 ngày.

### Nút đồng bộ (CEO-only, `requireCeo`)
- Kéo toàn bộ bảng tỷ lệ của kỳ cho 21 NV; **transaction kiểu all-or-nothing một kỳ**:
  kéo đủ mới ghi đè, kéo hụt/nguồn chết ⇒ báo lỗi, **giữ nguyên bản tốt đang có**.
- Ghi audit: ai bấm, lúc nào, bao nhiêu cặp, chênh gì so bản trước (đếm cặp đổi %).
- Hiện kết quả: "Đã đồng bộ 662 cặp · 5 cột · thay đổi 3 cặp so bản 06/08".

### Vá lỗ hổng (làm cùng đợt, không chờ)
- `getForSession`: nhánh `not_configured` hiện bỏ qua `rateSnapshot.restore` — vá để
  mọi kiểu nguồn kẹt đều rơi về kho cục bộ trước khi fail-closed.

### Menu riêng C32/C47 (CEO đặt tên sau, tạm: "Thành tiền chi phí")
- Tab riêng trong App, **mặc định chỉ CEO thấy**; NV chỉ thấy khi công tắc riêng bật.
- 4 cột tiền: C32 chưa/có VAT · C47 chưa/có VAT, theo cặp (đơn vị × mã hàng) và tổng
  theo NV. VAT dùng đúng `VAT_DIVISOR` hiện hành (÷1,05) — một nguồn hằng số, cấm
  hardcode 1.05 chỗ mới.
- Nguồn số: **tính từ % cục bộ × doanh thu slot** (không kéo tiền tổng từ DataHub —
  giữ nguyên luật `CATALOG_PERMANENT_FIELD_BLOCKED` cho payload danh mục; menu riêng
  có endpoint riêng + quyền riêng, không đi qua catalog).
- Con mắt ẩn số phủ; export qua backend + kiểm quyền.

## Không làm (cố ý)
- Không UI nhập/sửa % tại App Report — hai nguồn số là bệnh cũ.
- Không tự động đồng bộ nền theo lịch (đợt này): CEO chủ động bấm; cân nhắc lịch sau
  khi dùng ổn.
- Không nới `assertCatalogFieldPolicy` — C32/C47 vẫn cấm trong payload danh mục.

## Nghiệm thu then chốt
1. Đồng bộ khi nguồn khoẻ → tắt DataHub → màn Chi phí + Danh mục vẫn đủ %, kèm nhãn
   "số đồng bộ lúc …"; KHÔNG còn trắng 0/21 như 08/08.
2. Bấm đồng bộ khi nguồn chết → báo lỗi rõ, bản cũ còn nguyên, audit ghi lần thất bại.
3. NV bị tắt công tắc ⇒ không thấy cột tương ứng; C32/C47 mặc định chỉ CEO.
4. Số C47 = Σ(% × doanh thu) khớp đối chiếu tay 3 dòng bất kỳ; VAT chia đúng 1,05.

## Lộ trình
- **Đợt 1 (~1 ngày):** kho cục bộ + nút đồng bộ + vá lỗ hổng restore. → hết cảnh trắng %.
- **Đợt 2 (~1 ngày):** menu danh mục đủ cột C33–C46 (xem/lọc/xuất).
- **Đợt 3 (~1 ngày):** menu riêng C32/C47 bốn cột VAT + công tắc riêng.
