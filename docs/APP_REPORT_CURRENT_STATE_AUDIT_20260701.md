# APP REPORT — GÓI HIỆN TRẠNG ĐỂ CLAUDE ĐÁNH GIÁ / REBUILD

- Ngày đóng gói: 2026-07-01
- Phạm vi: App Report trong `webapp_donapharm`
- Mục tiêu tài liệu: mô tả đủ hiện trạng tính năng, công thức, luồng thao tác, nguồn dữ liệu/API, điểm rườm rà và khuyến nghị gom lại để Claude đánh giá nâng cấp/rebuild.
- Lưu ý bảo mật: tài liệu này **không đưa secret/token thật** và **không đưa dữ liệu doanh thu chi tiết/CP Total/PII nhân viên**. Khi đưa lên GitHub/Claude phải dùng repo private và dữ liệu mẫu đã ẩn danh.

---

## 1. Đường dẫn source chính

Repo/gốc đang kiểm tra:

```text
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/
```

Các file chính của App Report:

```text
webapp_donapharm/server.js
webapp_donapharm/public/report.html
webapp_donapharm/public/report-main.js
webapp_donapharm/public/report-main-v23.js
webapp_donapharm/public/report-extra.js
webapp_donapharm/public/report-v23.css
webapp_donapharm/data/report_lastUploadData.json
webapp_donapharm/data/report_lastUploadMeta.json
webapp_donapharm/data/report_uploadSlots.json
webapp_donapharm/data/report_upload_data_YYYYMMDD_YYYYMMDD.json
webapp_donapharm/sync_data/0917396668_report_lastUploadData.json
webapp_donapharm/sync_data/0917396668_report_upload_data_YYYYMMDD_YYYYMMDD.json
```

Các dữ liệu liên quan bên ngoài App Report:

```text
/home/osboxes/.openclaw/workspace-main/webapp_datahub/data/master_khachhang.json
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/dc_cache.json
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/dieu_chuyen.json
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/fleet.db
```

---

## 2. Kiến trúc hiện tại

App Report hiện là web app Node.js thuần, chạy server HTTP trong `server.js`, frontend HTML/JS/CSS thuần trong `public/`.

### 2.1 Server

- File chính: `server.js`
- Port app: `3860`
- Static public dir: `public/`
- Data dir: `data/`
- Sync dir: `sync_data/`
- Export dir: `public/exports/`
- Có dùng:
  - `better-sqlite3` cho một số phần VAT/Fleet đang nằm chung server.
  - `exceljs` để export Excel.
  - `pdfkit` để export PDF.
  - Proxy nội bộ sang backend ERP port `3848` cho OTP/device/face/admin/targets.
  - SSO verify nội bộ port `3862`.
  - ORDS/Lumos endpoint cho query SQL doanh thu/target/cơ số thầu.

### 2.2 Frontend

- `report.html`: layout, auth overlay, navbar/tab, load script/CSS.
- `report-main.js` / `report-main-v23.js`: logic chính App Report, hiện hai file có nội dung cùng dung lượng, khả năng là bản copy version.
- `report-extra.js`: tính năng phụ/mở rộng: target, thưởng, VAT, điều chuyển.
- `report-v23.css`: giao diện hiện tại.

### 2.3 Vấn đề kiến trúc nổi bật

Hiện App Report đang bị “phình” thành một mega-app:

1. Báo cáo doanh thu chính.
2. Upload/xử lý file doanh thu.
3. Target/thưởng 3P.
4. Kho dữ liệu/danh mục.
5. Cảnh báo cơ số thầu.
6. Điều chuyển nhân viên phụ trách.
7. VAT chứng từ.
8. Fleet/Drive.
9. AI chat.
10. Export Excel/PDF.

Một số tính năng thuộc phạm vi bot/app khác đang nằm chung App Report, gây rườm rà và rủi ro phân quyền.

---

## 3. Luồng đăng nhập, SSO, phân quyền

### 3.1 Đăng nhập

Các cơ chế đang có:

1. SSO token từ URL `?sso_token=...`.
2. Cookie `rpt_token`.
3. OTP qua backend nội bộ.
4. Session token client lưu localStorage.
5. Device heartbeat/concurrent device check.
6. Một phần face verify/device trusted.

Luồng đơn giản:

```text
Người dùng mở /report.html
→ server/SSO gate kiểm tra rpt_token hoặc sso_token
→ nếu chưa xác thực: hiện form số điện thoại
→ request OTP
→ verify OTP
→ nếu số có nhiều tài khoản: chọn mã NV
→ tạo session token
→ load App Report theo quyền
```

### 3.2 Phân quyền hiện tại

Phân quyền dựa trên:

- `REPORT_USERS` hardcoded trong frontend.
- `ADMIN_PHONES`/CEO phone.
- Session role từ server.
- Logic frontend `getAllowedTabs()`, `canViewTab()`, `applyRoleTabPermissions()`.
- Một số API server tự kiểm session/role.

Quyền chính:

- CEO/admin: xem toàn bộ, upload, target, export, điều chuyển.
- Sale/NV: xem dữ liệu theo mã NV/phạm vi được phân công.
- Một số tab hoặc export bị chặn nếu không đủ quyền.

### 3.3 Rủi ro cần Claude chú ý

- User master/permission đang hardcode trong JS client, có PII và khó audit.
- Nhiều logic quyền nằm ở frontend, nên cần đưa về backend khi rebuild.
- Một số tính năng ngoài Report dùng chung session và có khả năng rò phạm vi nếu không tách module.
- DN001 là nhân viên thường, không được nhầm với CEO/admin.

---

## 4. Các mục/tab hiện đang có trong App Report

Dựa theo function chính trong source:

### 4.1 Tổng quan doanh thu — `tabTQ()`

Mục đích:

- Hiển thị KPI tổng quan kỳ đang chọn.
- Tổng doanh thu.
- Doanh thu trước VAT/sau VAT tùy công thức hiển thị.
- Target tổng/target NV.
- % đạt target.
- Ranking NV.
- Top đơn vị, top sản phẩm.
- Biểu đồ bằng Chart.js.

Tính năng phụ:

- Export ranking/top đơn vị/top sản phẩm sang Excel/PDF.
- Cảnh báo target chưa đủ.
- Tính thưởng/3P trong phần extra.

### 4.2 Doanh thu theo đơn vị — `tabDT()`

Mục đích:

- Xem doanh thu theo đơn vị/bệnh viện/khách hàng.
- Lọc theo kỳ, NV, tuyến, mã đơn vị, từ khóa.
- Với NV thường: chỉ xem dữ liệu trong phạm vi của mình.
- Có phân trang.
- Có export.

Cột dữ liệu thường dùng:

```text
EMP_NUMBER / ma_nv
DONVI / ma_dv
TEN_DV / ten_dv / ten_vt
TUYEN
REVENUE / tong_tien
IIT_CODE / mã QLNB
TEN_THUOC / tên sản phẩm
```

### 4.3 Doanh thu chi tiết/toàn bộ — `tabDTFull()`

Mục đích:

- Xem dữ liệu chi tiết theo dòng bán hàng từ file upload/DB.
- Có phân trang, lọc, export Excel/PDF.
- Quyền xem toàn bộ bị giới hạn; NV thường chỉ xem dòng thuộc mã NV của mình.

### 4.4 Sản phẩm / phân tích sản phẩm — `tabSP()` và `tabPT()`

Mục đích:

- Top sản phẩm theo doanh thu.
- Phân tích sản phẩm theo QLNB/IIT_CODE.
- Có tìm kiếm/fuzzy name.
- Có export top sản phẩm.

### 4.5 Cơ số thầu / cảnh báo CST — `tabCST()`

Mục đích:

- Hiển thị cơ số thầu ban đầu, số lượng bán, số lượng còn lại, tỷ lệ còn lại.
- Cảnh báo các dòng còn nhiều/còn ít theo ngưỡng.
- Lọc theo NV, đơn vị, sản phẩm, QĐ/gói thầu.
- Export Excel/PDF.

Công thức lõi:

```text
sl_ban = số lượng đã bán
cst_ban_dau = cơ số thầu ban đầu
sl_con_lai = cst_ban_dau - sl_ban
pct_con_lai = sl_con_lai / cst_ban_dau * 100
```

Các field thường thấy:

```text
iit_code
ten_thuoc
ham_luong
donvi
emp_number
cst_ban_dau
sl_ban
sl_con_lai
pct_con_lai
goi_thau
```

### 4.6 Nhân viên / profile — `tabNV()`

Mục đích:

- Hiển thị danh sách/profile nhân viên.
- Dữ liệu hiện có hardcoded trong JS và/hoặc upload từ file nhân viên.
- Có thông tin mã NV, tên, SĐT, email, bộ phận, chức danh, trạng thái.

Rủi ro:

- Không nên public/source-share bản đầy đủ vì có PII.
- Khi đưa Claude/GitHub cần ẩn danh hoặc chỉ giữ schema.

### 4.7 Upload dữ liệu — `tabUpload()`, `procFile()`

Mục đích:

- CEO/admin upload file Excel doanh thu.
- Parse dữ liệu bằng `xlsx` phía client.
- Chuẩn hóa/cảnh báo lỗi.
- Ghi dữ liệu vào sync/data thông qua `/api/sync`.
- Quản lý nhiều slot upload theo kỳ.

File dữ liệu chính:

```text
data/report_lastUploadData.json
data/report_lastUploadMeta.json
data/report_uploadSlots.json
data/report_upload_data_20260401_20260430.json
data/report_upload_data_20260501_20260529.json
data/report_upload_data_20260601_20260630.json
sync_data/0917396668_report_lastUploadData.json
sync_data/0917396668_report_upload_data_YYYYMMDD_YYYYMMDD.json
```

Ví dụ meta kỳ mới nhất đang thấy:

```text
ky: 06.2026
dateFrom: 2026-06-01
dateTo: 2026-06-30
totalRows: 2001
totalRevenue: 28,403,136,096
source: Excel Telegram tuần 27
```

### 4.8 Kho dữ liệu — `tabKho()`

Mục đích:

- Tra cứu/nhập các danh mục nền:
  - đơn vị/khách hàng;
  - quy đổi đơn vị tính;
  - hàng đặc biệt/cảnh báo;
  - nhân viên.

API liên quan:

```text
GET  /api/kho/donvi/import-json
GET  /api/kho/khachhang/import-json
POST /api/kho/khachhang/update-row
GET  /api/kho/quydoi/import-json
GET  /api/kho/hangdacbiet/import-json
POST /api/kho/upload-donvi
POST /api/kho/upload-quydoi
POST /api/kho/upload-hangdacbiet
POST /api/kho/upload-nhanvien
```

Rủi ro/phạm vi:

- Đây là Data Hub/master data, không nên để lẫn với App Report nếu mục tiêu là báo cáo gọn.
- Nên tách thành Data Hub/Admin module.

### 4.9 Target CEO nhập/sửa — `tabTarget()`

Nằm trong `report-extra.js`.

Mục đích:

- CEO/admin nhập target theo tháng/kỳ cho từng NV.
- Lưu qua backend target proxy.
- Có AI đề xuất target dựa trên kỳ trước.

API:

```text
GET  /api/targets?ky=MM.YYYY
GET  /api/targets/ky-list
POST /api/targets/save
POST /api/targets/delete
```

Logic AI đề xuất target:

```text
prevKY = tháng liền trước
prev2KY = tháng trước nữa
Lấy target + doanh thu kỳ trước
season factor theo tháng
Nếu % đạt >=120%: target mới = doanh thu kỳ trước * 1.05 * season
Nếu % đạt >=100%: target mới = target cũ * 1.05 * season
Nếu % đạt >=85%: target mới = target cũ * season
Nếu % đạt >0: target mới = target cũ * 0.95 * season
Nếu không có DT: giữ target cũ * season
Làm tròn theo 100 triệu
```

Hệ số mùa vụ đang hardcode:

```text
01:0.90, 02:0.88, 03:1.05, 04:1.02, 05:1.05, 06:1.08,
07:1.00, 08:1.02, 09:1.00, 10:1.05, 11:1.03, 12:1.10
```

### 4.10 Target cá nhân / thưởng 3P — `tabMyTarget()`

Mục đích:

- NV xem target của mình.
- CEO xem tổng hợp/xếp hạng.
- Tính doanh thu trước VAT để so target.
- Tính trạng thái đạt/chưa đạt.
- Xếp hạng quý.
- Có nút xuất/gửi email/Zalo khen thưởng, nhưng hiện cần kiểm lại trước khi bật thật.

Công thức đáng chú ý:

```text
doanh_thu_truoc_vat = doanh_thu_sau_vat / 1.05
pct_dat = doanh_thu_truoc_vat / target * 100
thieu_vuot = doanh_thu_truoc_vat - target
```

Hệ số thưởng thấy trong code:

```text
>=100% target: đạt target × 1.2
```

Cần Claude đánh giá lại vì phần thưởng/3P dễ thành nghiệp vụ riêng, không nhất thiết nằm trong App Report tối giản.

### 4.11 VAT chứng từ — `tabVAT()`

Mục đích hiện tại:

- Form nhập chứng từ/bill cần lấy hóa đơn VAT.
- Upload ảnh chứng từ.
- Theo dõi trạng thái hóa đơn.
- Export Excel/PDF.
- Có SQLite `data/vat.db` và table `vat_bills`.

API:

```text
POST /api/vat/submit
GET  /api/vat/list
POST /api/vat/update
POST /api/vat/delete
POST /api/vat/image-upload
GET  /api/vat/summary
```

Đánh giá phạm vi:

- Đây là nghiệp vụ VAT Bot/VAT App, không nên nằm trong App Report rebuild nếu Sếp muốn gọn đúng mục báo cáo.

### 4.12 Fleet/Drive — `tabDrive()`, `tabFuelTrend()`, `tabFleetDocs()`

Mục đích hiện tại:

- Theo dõi xăng xe, sửa chữa, vi phạm, hồ sơ xe.
- Dùng SQLite `data/fleet.db`.

API:

```text
GET/POST/PUT/DELETE /api/fleet/fuel
GET/POST/DELETE     /api/fleet/repair
GET/POST/DELETE     /api/fleet/violation
GET/POST/DELETE     /api/fleet/attachments
GET                 /api/fleet/summary
GET/POST            /api/fleet/vehicle-info
POST/DELETE         /api/fleet/tire
POST/DELETE         /api/fleet/insurance
```

Đánh giá phạm vi:

- Đây là Drive Bot/Drive App, nên tách khỏi App Report.

### 4.13 Điều chuyển nhân viên phụ trách — `tabDieuChuyen()`

Mục đích hiện tại:

- Hiển thị đề xuất điều chuyển theo cơ số thầu còn lại.
- Lọc theo % còn lại, gói thầu QĐ139/QĐ141, đơn vị/NV.
- Ghi nhận lịch sử điều chuyển.
- Export Excel/PDF.

API:

```text
GET  /api/dieu-chuyen/list
GET  /api/dieu-chuyen/cache
POST /api/dieu-chuyen/rebuild-cache
POST /api/dieu-chuyen/save
GET  /api/dieu-chuyen/export
GET  /api/dieu-chuyen/export-pdf
```

File dữ liệu:

```text
data/dc_cache.json
data/dieu_chuyen.json
scripts/build_dieu_chuyen_cache.js
```

Đánh giá phạm vi:

- Đây là nghiệp vụ điều chuyển Sale, nên chuyển Sale Bot/App Sale xử lý.
- App Report chỉ nên đọc kết quả nếu cần báo cáo, không nên ghi nhận/sửa nghiệp vụ.

### 4.14 AI trợ lý báo cáo — `/api/ai-report-chat`

Mục đích:

- Chat hỏi nhanh doanh thu, NV phụ trách, đơn vị/sản phẩm.
- Có fast-path trả lời trực tiếp từ file upload `sync_data/0917396668_report_lastUploadData.json`.
- Nếu không trả lời được thì gọi LLM qua OpenClaw.

Logic bảo mật:

- Session bắt buộc.
- NV thường chỉ trả trong phạm vi mã NV của mình.
- Admin có thể hỏi tổng/toàn công ty.

Đánh giá:

- Nên giữ nếu rebuild, nhưng cần thiết kế lại thành “Query Engine” có API rõ, không phụ thuộc prompt dài/mega JS.

---

## 5. Nguồn dữ liệu và API đang dùng

### 5.1 Dữ liệu upload Excel doanh thu

Nguồn chính hiện App Report đang ưu tiên:

```text
report_upload_data_YYYY-MM-DD_YYYY-MM-DD.json
report_upload_data_YYYYMMDD_YYYYMMDD.json
report_lastUploadData.json
report_lastUploadMeta.json
report_uploadSlots.json
```

Cột doanh thu chuẩn theo quy tắc CEO đã chốt:

```text
tong_tien / REVENUE
```

Với T04/2026 đã chốt nguồn đúng:

```text
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_2026-04-01_2026-04-29.json
```

### 5.2 ORDS/Lumos

Frontend có cấu hình query SQL qua ORDS:

```text
https://ceo.donapharm.one/ords/donapharm_new/sql-api/run
```

Các bảng/view được thấy trong code:

```text
SALES_REPORT
PHARMA_NEW.V_TEM_TARGET_BONUS
PHARMA_NEW.SALES_REPORT
```

Dùng cho:

- fallback doanh thu khi chưa có upload data;
- target kỳ cũ;
- scope EMP/IIT/DONVI;
- cơ số thầu/điều chuyển/cache.

### 5.3 Backend nội bộ port 3848

Server Report proxy sang backend nội bộ:

```text
/api/otp/request
/api/otp/verify
/api/device/*
/api/admin/*
/api/face/*
/api/targets/*
```

### 5.4 SSO nội bộ port 3862

```text
/api/sso/verify
```

Dùng để verify token từ portal/domain chung.

### 5.5 DataHub/master data

```text
webapp_datahub/data/master_khachhang.json
webapp_donapharm/data/kho_donvi_import_20260420.json
webapp_donapharm/data/kho_quydoi_import_20260427.json
webapp_donapharm/data/kho_hangdacbiet_import_20260427.json
```

---

## 6. Công thức và logic tính toán chính

### 6.1 Doanh thu

Nguồn ưu tiên:

```text
Dữ liệu upload App Report → report_upload_data_*.json
```

Công thức tổng:

```text
doanh_thu = SUM(tong_tien hoặc REVENUE)
```

Theo NV:

```text
doanh_thu_nv = SUM(REVENUE) WHERE EMP_NUMBER/ma_nv = mã NV đăng nhập
```

Theo đơn vị:

```text
doanh_thu_don_vi = SUM(REVENUE) GROUP BY DONVI/ma_dv/ten_dv
```

Theo sản phẩm:

```text
doanh_thu_san_pham = SUM(REVENUE) GROUP BY IIT_CODE/ten_thuoc
```

Doanh thu trước VAT:

```text
doanh_thu_truoc_vat = doanh_thu_sau_vat / 1.05
```

### 6.2 Target

```text
pct_dat = doanh_thu_truoc_vat / target * 100
thieu_vuot = doanh_thu_truoc_vat - target
```

Target load theo thứ tự:

```text
1. /api/targets?ky=MM.YYYY
2. fallback DB PHARMA_NEW.V_TEM_TARGET_BONUS
3. fallback kỳ gần nhất trước đó có target
```

### 6.3 Cơ số thầu

```text
sl_con_lai = cst_ban_dau - sl_ban
pct_con_lai = sl_con_lai / cst_ban_dau * 100
```

Cảnh báo theo ngưỡng phần trăm còn lại, ví dụ lọc `pct_con_lai >= X%`.

### 6.4 Fuzzy match

Frontend có các hàm normalize/fuzzy cho:

- tên đơn vị;
- mã đơn vị;
- tên thuốc/sản phẩm;
- mã QLNB/IIT_CODE.

Khuyến nghị rebuild: gom thành backend search API để dễ test và kiểm quyền.

---

## 7. Luồng thao tác vận hành hiện tại

### 7.1 Luồng CEO upload dữ liệu doanh thu

```text
CEO đăng nhập App Report
→ vào tab Upload
→ chọn file Excel doanh thu tuần/tháng
→ frontend parse file bằng xlsx
→ kiểm header/cột bắt buộc/tổng tiền/dòng trùng
→ preview lỗi/cảnh báo
→ ghi dữ liệu vào sync/data slot
→ cập nhật report_lastUploadData/report_lastUploadMeta/report_uploadSlots
→ reload tab Tổng quan/Doanh thu/CST
```

### 7.2 Luồng NV xem báo cáo

```text
NV đăng nhập bằng SĐT/SSO
→ xác định mã NV từ session/user master
→ load kỳ mặc định/latest upload
→ lọc dữ liệu theo EMP_NUMBER của NV
→ chỉ hiển thị tab được phép
→ NV tra doanh thu/đơn vị/sản phẩm/cơ số thầu trong phạm vi
```

### 7.3 Luồng CEO xem tổng hợp

```text
CEO/admin đăng nhập
→ có thể chọn kỳ/slot upload
→ xem tổng doanh thu toàn công ty
→ xem top NV/top đơn vị/top sản phẩm
→ xem target/toàn bộ/cơ số thầu
→ export Excel/PDF nếu cần
```

### 7.4 Luồng AI chat

```text
User nhập câu hỏi
→ /api/ai-report-chat kiểm session
→ load upload data mới nhất
→ nếu câu hỏi đơn giản: trả lời fast-path bằng code
→ nếu phức tạp: gọi LLM với dữ liệu tóm tắt/phạm vi
→ trả kết quả
```

---

## 8. Những tính năng nên giữ khi rebuild

Em đề xuất App Report V2 nên giữ lõi này:

1. Đăng nhập SSO/OTP chuẩn và phân quyền backend.
2. Chọn kỳ báo cáo/slot upload.
3. Tổng quan doanh thu.
4. Doanh thu theo NV.
5. Doanh thu theo đơn vị/bệnh viện.
6. Doanh thu theo sản phẩm/mã QLNB.
7. Cơ số thầu/còn lại/tỷ lệ còn lại.
8. Target cá nhân và target tổng, nếu Sếp vẫn muốn giữ trong Report.
9. Export Excel/PDF các báo cáo chính.
10. AI hỏi nhanh báo cáo, nhưng chỉ sau khi query dữ liệu nền trực tiếp.

---

## 9. Những tính năng nên tách/bỏ khỏi App Report V2

Nên tách khỏi App Report để tránh rườm rà:

1. VAT chứng từ → chuyển VAT Bot/VAT App.
2. Fleet/Drive → chuyển Drive Bot/Drive App.
3. Kho dữ liệu chỉnh sửa master → chuyển DataHub/Admin module.
4. Điều chuyển nhân viên phụ trách → chuyển Sale Bot/App Sale.
5. Gửi email/Zalo thưởng tự động → nên để CEO Office/Sale workflow riêng.
6. Face verify/device management quá chi tiết → nếu cần thì dùng SSO gateway chung, App Report không tự gánh.
7. Service worker/cache update phức tạp → rebuild nên đơn giản hóa.

---

## 10. Đề xuất cấu trúc App Report V2 cho Claude đánh giá

### 10.1 Module backend

```text
/apps/report-api
  auth/
  permissions/
  reports/
  uploads/
  targets/
  cst/
  exports/
  ai-query/
```

### 10.2 Module frontend

```text
/apps/report-web
  pages/
    Overview
    RevenueByEmployee
    RevenueByUnit
    RevenueByProduct
    TenderQuota
    Target
    UploadAdmin
  components/
    FilterBar
    KpiCards
    DataTable
    ExportButtons
```

### 10.3 Data contract tối thiểu

```ts
type ReportRow = {
  ky: string;
  date: string;
  emp_code: string;
  emp_name?: string;
  unit_code?: string;
  unit_name?: string;
  route?: string;
  iit_code?: string;
  product_name?: string;
  quantity?: number;
  revenue: number;
  contractor_code?: string;
  bid_package?: string;
};

type TenderQuotaRow = {
  ky?: string;
  emp_code: string;
  unit_code: string;
  unit_name: string;
  iit_code: string;
  product_name: string;
  bid_qty_initial: number;
  sold_qty: number;
  remain_qty: number;
  remain_pct: number;
};
```

### 10.4 Nguyên tắc bảo mật V2

- Không hardcode danh sách nhân viên/PII trong frontend bundle.
- Backend quyết định quyền, frontend chỉ render dữ liệu được trả về.
- Mọi export phải đi qua backend permission check.
- Dữ liệu nhạy cảm CP Total/lợi nhuận/margin không nằm trong App Report thường.
- GitHub chỉ dùng `.env.example`, không commit `.env`, DB thật, session, token, file doanh thu thật.

---

## 11. Checklist gửi Claude

Claude cần đánh giá:

1. App hiện có quá nhiều nghiệp vụ nằm chung không?
2. Những tab nào nên giữ trong App Report chuẩn?
3. Có nên tách Report API khỏi mega `server.js` không?
4. Có nên chuyển toàn bộ permission sang backend không?
5. Cách chuẩn hóa data upload: schema, validation, audit, rollback.
6. Cách thiết kế query doanh thu nhanh, đúng nguồn App Report.
7. Cách giữ AI chat nhưng không để LLM tự đoán số liệu.
8. Cách refactor export Excel/PDF.
9. UI/UX mobile-first cho CEO và nhân viên Sale.
10. Lộ trình migration không làm gián đoạn app đang chạy.

---

## 12. Kết luận sơ bộ

App Report hiện đang chạy được và có rất nhiều tính năng, nhưng đang bị gom lẫn nhiều nghiệp vụ ngoài phạm vi Report. Nếu rebuild, nên đi theo hướng:

```text
App Report = Báo cáo doanh thu + sản phẩm + đơn vị + cơ số thầu + target + export + AI hỏi nhanh có kiểm quyền
```

Các phần VAT/Drive/DataHub/Điều chuyển nên tách sang app/bot chuyên trách, App Report chỉ đọc dữ liệu tổng hợp nếu thật sự cần hiển thị báo cáo.
