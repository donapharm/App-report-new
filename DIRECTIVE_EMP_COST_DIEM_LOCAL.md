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
- Giữ **cảnh báo sớm** (đang thiếu xu → dự kiến phạt) + dòng **"Cấn trừ do thiếu xu"** display-only, tách bạch chi phí
  (DataHub) — **không đổi** cách tách nguồn hiện có.

## 6. NGHIỆM THU
1. DN009 (và ≥3 NV khác) hiện **điểm > 0 khớp doanh thu** của họ (không còn 0·0); nhãn nguồn = **App Report**.
2. **Parity điểm App Report ↔ App VAT = 0 sai số** (khi App VAT đọc đúng doanh thu) — bằng chứng lưu artifact.
3. Xu vẫn khớp App VAT dashboard; App VAT hỏng chỉ mất **xu**, **điểm vẫn hiển thị**.
4. Self-scope 2 lớp giữ nguyên (NV chỉ thấy mình); **không** ghi payroll; **không** lộ token/PII; C32/C47 vẫn khóa.
5. Test server/web PASS; `git diff --check` PASS; CHANGELOG cập nhật.

## 7. GHI CHÚ / ĐỂ CEO CHỐT
- **Phạt** phụ thuộc điểm nên directive này cho App Report tính phạt "dự kiến" tại chỗ (CEO mới nêu rõ **điểm**; phạt suy
  ra). Nếu CEO muốn phạt vẫn **chỉ lấy con số App VAT** (để trùng tuyệt đối số thực trừ) → App Report chỉ tính **điểm**,
  còn **xu + phạt** đọc App VAT. **Đề xuất mặc định:** App Report tính điểm + phạt-dự-kiến, nhưng **gate bằng parity**
  (mục 4) để không lệch số thực trừ. Chờ CEO xác nhận 1 trong 2.
- Task kèm cho **App VAT Bot**: đọc đúng doanh thu (đồng bộ App Sale) để điểm nội bộ App VAT khớp App Report — nếu không,
  App VAT nên **tiêu thụ điểm từ App Report** làm SSOT thay vì tự tính từ bản doanh thu cũ.
