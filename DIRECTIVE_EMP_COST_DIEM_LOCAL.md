# DIRECTIVE — Điểm tháng/quý do App Report TỰ TÍNH (không lấy App VAT); Xu vẫn từ App VAT

> **CEO chốt 2026-07-24:** *"điểm tháng/quý không phải lấy ở app vat nhé. điểm tháng/quý có ngay tại app report
> cần gì lấy ở đâu vậy. Hiểu đơn giản, không cần máy móc."*
> App Report **đã có doanh thu** → **tự tính điểm**, khỏi gọi App VAT lấy điểm. **Xu** (từ hóa đơn) vẫn là App VAT.
> Claude Code = kiến trúc + review; Report Bot = triển khai. Đọc `CLAUDE.md` + `CHANGELOG.md` trước khi code.

## 1. VÌ SAO ĐỔI (bằng chứng thực tế)
- Màn hình production hiển thị **"Điểm (tháng·quý): 0·0 — Nguồn: App VAT"** cho DN009, trong khi DN009 có
  **doanh thu 2.660.205.490đ** thật. ⇒ điểm App VAT trả về **0/sai** (App VAT đọc bản doanh thu cũ/không đồng bộ).
- **Điểm là hàm THUẦN của doanh thu**, mà **doanh thu sống ở App Report** (nguồn App Sale). Vậy nơi tính điểm đúng nhất
  là **App Report** — không phải App VAT (App VAT chỉ có 1 bản copy doanh thu, dễ lệch).
- ⇒ **App Report trở thành SSOT của ĐIỂM** (vì sở hữu doanh thu). **App VAT giữ SSOT của XU** (vì sở hữu hóa đơn/bill).

## 2. PHÂN CÔNG SỐ (rõ ràng — "hiểu đơn giản")
| Chỉ số | Ai tính (SSOT) | Công thức |
|---|---|---|
| **Điểm** tháng/quý | **App Report** (tự tính) | `Σ theo dòng ( doanh thu_dòng × hệ số ÷ 100.000.000 )`, làm tròn **2 số** |
| **Xu** tháng/quý | **App VAT** (giữ nguyên) | App VAT tính từ bill; App Report **chỉ đọc** |
| **Phạt** dự kiến | **App Report** tính (display-only) | `floor( max(điểm_quý − xu_quý, 0) ÷ 2 ) × 600.000đ` |

- **Điểm**: dùng đúng doanh thu App Report đã hiển thị (cùng nguồn với các KPI doanh thu hiện có) → NV thấy điểm **khớp
  ngay** với doanh thu của mình. Điểm tháng = tổng theo kỳ tháng; điểm quý = tổng 3 tháng của quý (self-scope).
- **Xu**: App Report **vẫn gọi App VAT** (`GET /api/khoan/dashboard`) **chỉ để lấy `xu_thang`/`xu_quy`/carry** — KHÔNG
  lấy `diem_*` từ App VAT nữa (bỏ qua trường điểm trong response, hoặc App VAT trả xu-only). Nếu App VAT hỏng/timeout →
  fail-closed cho **xu** (note "chưa lấy được xu kỳ này"); **điểm vẫn hiện** (vì App Report tự tính).
- **Phạt**: App Report ghép **điểm (của mình)** + **xu (App VAT)**. Chỉ là **"dự kiến/hiển thị"**, App Report **KHÔNG
  ghi payroll, KHÔNG phát lệnh trừ tiền** (giữ nguyên nguyên tắc cũ).

## 3. HỆ SỐ ĐIỂM (config, versioned theo giai đoạn — áp từ T05/2026)
| Tuyến / loại | Hệ số |
|---|---|
| CL (Chỉ làm) | **2.0** |
| NT (Nhà thuốc) | **2.0** |
| NCL — đơn vị **025, 026, 027, 028** | **2.0** |
| NCL — thường (còn lại) | **1.0** |

- Hệ số để **file config versioned** (không hardcode), ví dụ `server/config/employee_point_coeff.json`:
  `{ "version": "2026-05-r1", "effective_from": "2026-05", "default": 1.0, "by_route": {"CL":2.0,"NT":2.0},
  "ncl_units_2x": ["025","026","027","028"] }`. Đổi hệ số kỳ sau = thêm version, **không sửa kỳ đã đóng**.
- **Tuyến/đơn vị không xác định** → dùng **default 1.0** (KHÔNG mặc định 2.0), và ghi cảnh báo DQ "dòng thiếu tuyến →
  hệ số mặc định" để đối soát — **không bịa** hệ số cao hơn (tránh thổi điểm → giảm phạt sai).
- **`rule_version` điểm** phải xuất ra cùng KPI (vd `point-local-2026-05-r1`) để truy vết.

## 4. ‼ RÀNG BUỘC VÀNG — "KHÔNG TRỪ OAN TIỀN NV" (bắt buộc)
Phạt cấn trừ **tiền thật**. Vì điểm giờ do App Report tính còn App VAT vẫn có logic điểm riêng (carry/target nội bộ),
**hai bên PHẢI ra CÙNG một số điểm** — nếu lệch, phạt hiển thị ở App Report có thể khác số App VAT thực trừ ⇒ trừ oan.
- **Bắt buộc:** App Report + App VAT dùng **cùng nguồn doanh thu** (App Sale) và **cùng bảng hệ số** (mục 3).
- **Nghiệm thu parity BẮT BUỘC trước deploy:** với ≥4 NV có doanh thu thật (vd DN009/DN016/DN024/DN001), đối chiếu
  **điểm App Report** với **điểm App VAT** *khi App VAT đã đọc đúng doanh thu*. Mục tiêu: **cùng số** (sai số 0).
- Nếu còn lệch: **KHÔNG deploy phạt**; hiển thị điểm/xu, ẩn/gắn cờ phạt "đang đối soát" cho tới khi khớp. Việc App VAT
  đọc đúng doanh thu để tự đồng bộ điểm là **task riêng App VAT** (xem mục 7) — nhưng SSOT điểm là App Report.

## 5. FRONTEND
- Ô KPI **Điểm (tháng·quý)**: đổi nhãn nguồn **"App VAT" → "App Report"** (và `rule_version` điểm local).
- Ô **Xu**: giữ nhãn nguồn **"App VAT"**. Ô **Phạt dự kiến**: nguồn "App Report (điểm) + App VAT (xu)".
- Giữ **cảnh báo sớm** (đang thiếu xu → dự kiến phạt) + dòng **"Cấn trừ do thiếu xu"**, tách bạch chi phí (DataHub).
- **Phân biệt trạng thái theo tháng trong quý (mục 8):** tháng chưa cuối quý → dòng cấn trừ ghi **"dự kiến — chưa trừ"**;
  **tháng cuối quý** (T03/T06/T09/T12) → **"chốt quý — cấn trừ"**. Cảnh báo tháng dùng giọng **nghiêm khắc**.

## 6. NGHIỆM THU
1. DN009 (và ≥3 NV khác) hiện **điểm > 0 khớp doanh thu** của họ (không còn 0·0); nhãn nguồn = **App Report**.
2. **Parity điểm App Report ↔ App VAT = 0 sai số** (khi App VAT đọc đúng doanh thu) — bằng chứng lưu artifact.
3. Xu vẫn khớp App VAT dashboard; App VAT hỏng chỉ mất **xu**, **điểm vẫn hiển thị**.
4. Self-scope 2 lớp giữ nguyên (NV chỉ thấy mình); **không** ghi payroll; **không** lộ token/PII; C32/C47 vẫn khóa.
5. Test server/web PASS; `git diff --check` PASS; CHANGELOG cập nhật.

## 7. GHI CHÚ
- **Phạt** phụ thuộc điểm → App Report tính **phạt dự kiến** tại chỗ (điểm của mình + xu App VAT), **gate bằng parity**
  (mục 4). App Report **KHÔNG tự thực hiện lệnh trừ tiền** — chỉ hiển thị + cảnh báo + gửi thông báo (xem mục 8).
- Task kèm cho **App VAT Bot**: đọc đúng doanh thu (đồng bộ App Sale) để điểm nội bộ App VAT khớp App Report — nếu không,
  App VAT nên **tiêu thụ điểm từ App Report** làm SSOT thay vì tự tính từ bản doanh thu cũ.

## 8. CƠ CHẾ PHẠT THEO QUÝ + CẢNH BÁO + THÔNG BÁO TRƯỚC KHI TRỪ (CEO chốt 2026-07-24)
**Nguyên tắc:** cảnh báo **hàng tháng** cho NV ý thức, nhưng **chỉ chốt trừ 1 lần vào cuối quý**. App Report gửi thông
báo trước; **không tự ghi payroll / không sửa chi phí DataHub**.

### 8.1 Cảnh báo hàng tháng (nghiêm khắc)
- Mỗi **cuối tháng**, nếu **xu tích lũy < điểm doanh thu** (đang thiếu) → hiển thị **cảnh báo NGHIÊM KHẮC** trên
  "Chi phí của tôi" + **đẩy Telegram/Email** cho NV: đang thiếu bao nhiêu xu, **dự kiến phạt** nếu hết quý vẫn thiếu, và
  **thời hạn khắc phục** (còn mấy tháng tới cuối quý). Mục tiêu: NV kịp chạy, không bị bất ngờ.
- Cảnh báo tháng = **CHƯA TRỪ TIỀN** (chỉ dự kiến). Ghi rõ "dự kiến — chưa cấn trừ".

### 8.2 Chốt trừ vào THÁNG CUỐI của quý
- Chốt tại **cuối tháng cuối quý** (T03 · T06 · **T09** · T12). Ví dụ đang **T07/2026** (quý 3 = T07–T09):
  cuối T07/T08 chỉ **cảnh cáo nghiêm khắc**; **đến cuối T09/2026** mới chốt.
- Điều kiện phạt tại chốt quý: **xu tích lũy cả quý KHÔNG cân bằng với điểm doanh thu quý** (xu_quý < điểm_quý → thiếu).
- Số phạt = `floor( max(điểm_quý − xu_quý, 0) ÷ 2 ) × 600.000đ` (mục 2) → **trừ vào chi phí bán hàng của NV** tại
  **tháng cuối quý** (T09), tách bạch dòng **"Cấn trừ do thiếu xu (chốt quý)"**.

### 8.3 ‼ THÔNG BÁO TRƯỚC KHI TRỪ (bắt buộc)
Trước khi con số phạt được cấn trừ, **gửi Telegram + Email** cho NV (self-scope, chỉ số của NV đó), gồm:
1. **Số liệu:** điểm_quý · xu_quý · **thiếu (điểm − xu)** · **số tiền phạt** · kỳ (quý/tháng chốt).
2. **Quy tắc tính điểm:** `điểm = Σ(doanh thu × hệ số ÷ 100.000.000)`; bảng hệ số (CL/NT/NCL 025–028 = 2.0; còn lại 1.0).
3. **Quy tắc tính xu:** `xu = tiền bill ÷ 500.000 × tỷ lệ` (1.3 từ T05/2026); target xu = điểm doanh thu quý; carry 1 quý.
4. **Công thức phạt:** `floor(điểm thiếu ÷ 2) × 600.000đ`, và **mốc thời gian** (đã cảnh báo các tháng trước).
- Thông báo phải đi **TRƯỚC** thời điểm cấn trừ đủ để NV nắm/đối chiếu (không trừ âm thầm). Ghi **audit** đã gửi
  (kênh · thời điểm · NV · kỳ), **không log token/PII**.

### 8.4 Ranh giới thực thi (không trừ oan)
- **App Report:** tính điểm (SSOT) · tính phạt dự kiến · cảnh báo tháng · **gửi Telegram/Email** · hiển thị dòng cấn trừ.
- **App Report KHÔNG:** ghi payroll, sửa số chi phí DataHub, tự phát lệnh chi/trừ. Việc **ghi cấn trừ thật** vào chi phí
  bán hàng do **chủ sở hữu chi phí (DataHub/quy trình tài chính) hoặc App VAT** thực hiện, dùng **đúng con số đã qua
  parity** — App Report chỉ cung cấp số + thông báo. **Cần CEO chốt đơn vị THỰC THI lệnh trừ** (đề xuất: nơi đang giữ
  "chi phí bán hàng" = DataHub, hoặc App VAT SSOT khoản) để 1 nơi duy nhất ghi, tránh trừ 2 lần / lệch số.
