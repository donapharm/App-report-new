# SPEC — Target đa nguồn (App Sale + AI đề xuất + Upload + sửa tay)

> Claude Code chốt thiết kế (CEO yêu cầu 2026-07-02). Bot triển khai; Claude review.
> Mục tiêu: target(NV, kỳ) cập nhật được từ **nhiều nguồn** mà KHÔNG đá nhau; **AI không tự chốt**; CEO là trọng tài cuối.

## Vấn đề
3 nguồn cùng muốn ghi vào 1 ô `target(emp_code, ky)`:
1. **App Sale** — đồng bộ tự động (nếu App Sale quản lý KPI theo NV/kỳ).
2. **AI đề xuất** — `smart.forecastTargets()` (đã có) tính theo xu hướng thật + mùa vụ.
3. **Upload file** — admin tải file target theo kỳ (như upload doanh thu).
+ **Sửa tay** — CEO chỉnh trực tiếp trong Target admin.

## Mô hình: nhiều ỨNG VIÊN + 1 RESOLVER chọn ACTIVE
```
target_entry = { emp_code, ky, value, source, status, note, set_by, set_at, locked }
  source: appsale | ai | upload | manual
  status: candidate | active | archived
```
- Mỗi (emp_code, ky) có **nhiều entry** (mỗi nguồn 1 entry mới nhất) nhưng **đúng 1 entry `active`**.
- Lưu `data/target_entries.json` (append + archive), có audit. `targets_real.json` cũ = **kết quả resolve** (giá trị active) để `getTargets()` đọc, hoặc `getTargets()` tự resolve từ entries.

## Luật ưu tiên (mặc định — CEO override từng NV được)
| Ưu tiên | Nguồn | Hành vi tự động |
|---|---|---|
| 1 | **manual** (CEO sửa tay) | set `locked=true` → sync sau KHÔNG đè; luôn thắng |
| 2 | **upload** | commit file → active (nếu ô đó chưa `locked`) |
| 3 | **appsale** | active mặc định NẾU (emp,ky) chưa có manual/upload |
| 4 | **ai** | **LUÔN chỉ `candidate`** — CEO duyệt mới thành active |

Resolver chọn active cho (emp,ky): nếu có `locked` manual → dùng nó; else theo ưu tiên cao nhất đang có; AI không bao giờ tự active.

## 3 nguyên tắc an toàn (bắt buộc)
1. **AI KHÔNG tự chốt.** `forecastTargets` chỉ ghi entry `source=ai, status=candidate`. UI có nút "Áp dụng đề xuất" → tạo entry `manual`(hoặc active hóa) do CEO bấm. Máy không tự đặt chỉ tiêu.
2. **Không đè ngầm.** Sync App Sale/upload KHÔNG ghi đè ô `locked` (đã CEO chốt). Nếu App Sale đổi số → thêm entry `candidate` mới + đánh dấu "App Sale vừa đổi" để CEO thấy, không tự thay.
3. **Audit đầy đủ.** Mỗi thay đổi ghi `set_by, set_at, source, giá trị cũ→mới`. Xem được lịch sử từng ô.

## UI — Tab Target admin (chỉ admin)
- Chọn **kỳ**. Bảng NV, mỗi hàng **4 cột giá trị**: `App Sale` | `AI đề xuất` | `Upload` | **`Đang dùng` (active + badge nguồn)**.
- Thao tác: bấm 1 cột để set active cho NV đó; ô nhập sửa tay (→ manual + lock); nút hàng loạt "Dùng App Sale cho tất cả", "Áp AI đề xuất cho các ô trống", "Bỏ khóa".
- Nút **AI đề xuất kỳ tới** (tái dùng forecast) đổ vào cột AI; hiện `reason` khi hover.
- Upload target: preview → validate (mã NV khớp, số hợp lệ) → commit (như `upload.js`), vào cột Upload.
- Cột chênh lệch: đánh dấu khi App Sale ≠ Đang dùng để CEO chú ý.

## Kết nối ngược (không vỡ nơi khác)
- `store.getTargets({ky,scope})` trả **giá trị active đã resolve** → `%đạt`, `buildAlerts` (NV chưa đạt), baseline `forecastTargets` tự dùng đúng, không sửa chỗ khác.
- Giữ gate cũ: khi có slot thật → không dùng target mẫu.

## Nguồn App Sale — CẦN XÁC NHẬN TRƯỚC
Khảo sát 2026-07-02 thấy đơn hàng + CST, **chưa thấy bảng target/KPI theo NV/kỳ** trong App Sale.
- **Bot xác nhận:** App Sale có quản lý **target giao cho NV theo kỳ** không? field gì, lấy qua API nào?
- **Có** → làm đủ 3 nguồn. **Chưa** → làm trước **AI + Upload + sửa tay** (2–3 nguồn), chừa sẵn adapter cắm App Sale sau (env-gated, không sửa kiến trúc).

## KỲ ĐANG CHẠY — pro-rate target theo ngày (CEO chốt PA A 2026-07-02)
**Vấn đề:** `latestKy` là tháng hiện tại (VD 07.2026) mới vài ngày → so doanh thu lũy kế với target CẢ THÁNG → % rất thấp, cảnh báo "chưa đạt" đỏ oan.
**Giải: chia target theo số ngày đã qua** cho tháng ĐANG CHẠY (tháng đã đóng giữ target đủ như cũ).

### Công thức
- Xác định "kỳ đang chạy" = kỳ trùng tháng dương lịch hiện tại (giờ VN UTC+7) và chưa hết tháng.
- `daysElapsed` = ngày trong tháng tính đến hôm nay (VD 02/07 → 2); `daysInMonth` = số ngày của tháng (VD 31).
- **`target_prorated = target_full × daysElapsed / daysInMonth`**.
- **`% đạt (nhịp) = revenue_before_vat / target_prorated × 100`** → so lũy kế với mốc-đến-hôm-nay (apples-to-apples, vì doanh thu cũng mới lũy kế tới nay).
- Cảnh báo "NV chưa đạt" cho kỳ đang chạy dùng NGƯỠNG cũ (<80%) nhưng so với `target_prorated`.

### Chỗ áp dụng (nhất quán)
- Overview KPI "% đạt target" + vòng tiến độ; Target (kỳ này) từng card NV; `smart.buildAlerts` nhóm target; digest khi báo tháng đang chạy.
- **Kỳ đã đóng (T06 trở về trước): GIỮ target đủ, KHÔNG pro-rate.**
- Forecast target kỳ tới KHÔNG đổi (vẫn dùng target đủ).

### Hiển thị (bắt buộc, cho rõ)
- Gắn nhãn **"Kỳ đang chạy · đến ngày 02/07 (2/31)"** ở T07 mọi nơi.
- Ghi rõ đang so **mốc nhịp**: VD "đạt 95% nhịp tháng · mốc đến ngày 2 · target cả tháng {short}". Không để NV tưởng đã đạt/thiếu so cả tháng.
- Doanh thu vẫn hiện lũy kế thật (không pro-rate doanh thu; chỉ pro-rate MỐC target để so).

### Lưu ý
- Giả định bán đều theo ngày (tuyến tính). Chấp nhận cho chỉ báo "nhịp"; có thể tinh chỉnh theo mùa vụ-trong-tháng sau nếu cần.

## Nghiệm thu
- 1 ô có cả 4 nguồn → resolver chọn đúng theo ưu tiên; CEO override 1 NV → khóa, sync sau không đè.
- AI chỉ ra ứng viên, không tự thành active tới khi CEO bấm áp dụng.
- Upload target theo kỳ: preview + commit + rollback; audit ai đổi.
- `%đạt`/cảnh báo/dự báo dùng đúng giá trị active. NV sale chỉ thấy target của mình.
