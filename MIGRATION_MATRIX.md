# MIGRATION_MATRIX — nguồn App Report đã cách ly → App Report

Cập nhật: 2026-07-02

Nguồn rà soát nguồn đã cách ly:
- `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/report.html`
- `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/report-main-v23.js`
- `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/report-extra.js`
- `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/kho-dulieu.html`
- Các bản report phụ: `report-cst-v20.html`, `report-force-v21.html`, `report-new.html`
- Thư viện biểu đồ cũ: `chart.min.js` (Chart.js 4.4.0)

Trạng thái:
- `done` = đã có dữ liệu + UI/API chính + test quyền/số liệu.
- `partial` = đã có nền hoặc phiên bản mới, nhưng chưa đủ parity với nguồn đã cách ly.
- `todo` = chưa chuyển sang App Report.

Nguyên tắc audit: nếu đối chiếu số liệu phát hiện lệch thì **dừng**, ghi rõ diff + nguồn, không làm tròn/ép số.

---

## 1. Tóm tắt điều hành

| Nhóm | Trạng thái | Ghi chú |
|---|---:|---|
| Login V2 | partial | Code + acceptance test đã xong; live Telegram đang chờ token BotFather thật của `@Reportdonapharm_bot`. Telegram login đang ẩn an toàn khi token chưa cấu hình. |
| Doanh thu 01→06/2026 | done | Đã đối chiếu nguồn đã cách ly ↔ App Report, tổng/dòng/sample rows khớp 100%. |
| CST | done | Đã khớp nguồn đã cách ly 2.741 dòng, giữ dòng thật thiếu mã QLNB theo chốt nghiệp vụ. |
| Bộ lọc kỳ tháng/quý/khoảng | done | Overview + API chính đã hỗ trợ tháng/quý/khoảng; CST là snapshot hiện tại theo đúng spec. |
| UI danh sách DT/SP/Target/CST | done/partial | Đã nâng cấp card grid responsive; chưa có PDF/print/mẫu xuất cũ. |
| Biểu đồ | todo | Chưa code theo yêu cầu. Đề xuất nằm ở mục 8, chờ CEO/Claude duyệt. |
| Tab Nhân viên / Kho dữ liệu master | todo/partial | App Report có danh bạ dùng cho auth/scope nhưng chưa có tab quản trị master như nguồn đã cách ly. |
| Đối chiếu/Điều chuyển | todo | Chưa chuyển vào App Report; nếu là nghiệp vụ Sale thì không nên đặt trong Report Bot/App Report trừ khi phục vụ báo cáo. |
| PDF/print | todo/partial | App Report hiện có Excel cơ bản; PDF/print/mẫu cũ chưa chuyển. |

---

## 2. Ma trận tab/menu chính nguồn đã cách ly

| Tab/menu nguồn đã cách ly | Tính năng/nút nguồn đã cách ly đã rà | App Report tương ứng | Trạng thái | Ghi chú/việc còn lại |
|---|---|---|---:|---|
| 📊 Tổng quan (`tq`) | KPI tổng quan; top NV; top đơn vị; top sản phẩm; biểu đồ nhà thầu/tuyến/doanh thu; export coach bar; nút `Excel/PDF xếp hạng NV`, `Excel/PDF Top ĐV`, `Excel/PDF Top SP` | `Overview` | partial | KPI 6 thẻ + cảnh báo smart + kỳ tháng/quý/khoảng đã xong. **Chưa chuyển biểu đồ, PDF, các export riêng Top ĐV/Top SP/xếp hạng NV theo mẫu cũ.** |
| 💰 DT theo ĐV (`dt`) | Ranking theo NV/ĐV/SP; drill-down; phân trang; chọn page size 10/20/30/50/100; nút `Excel trang này`, `PDF trang này`, `Excel tất cả`, `PDF tất cả` | `Revenue` | partial | Đã có breakdown theo NV/ĐV/SP/tuyến/UT/nhà thầu/gói + drill-down + Excel theo lọc. **Chưa có PDF, export page/all đúng mẫu cũ, page-size UI cũ.** |
| 🗂️ DT Chi tiết (`dtfull`) | Bảng chi tiết dòng bán hàng; phân trang; export Excel/PDF trang hiện tại hoặc tất cả | `RevenueFull` | partial | Đã có bảng chi tiết từng dòng, phân trang, Excel đầy đủ. **Chưa có PDF và mẫu page/all như cũ.** |
| 💊 SP chi tiết (`sp`) | Top/mã sản phẩm; tìm/lọc; phân trang; xuất Excel/PDF page/all; hiển thị thông tin hoạt chất/nhóm nếu có trong dữ liệu cũ | `Products` | partial | Đã có card top SP/mã QLNB + doanh thu/SL/độ phủ ĐV/NV/gói + Excel. **Chưa hoàn thiện hoạt chất/nhóm thuốc parity, PDF, page/all mẫu cũ.** |
| 📦 Cơ số thầu (`cst`) | Bảng ngang đầy đủ; cảnh báo & lời khuyên; trạng thái Hết CST/Chưa bán/Chưa khai thác/Còn nhiều/Đang bán; lọc tình trạng; export Excel/PDF page/all | `TenderQuota` | done/partial | **Dữ liệu + UI nghiệp vụ CST đã done** và khớp 2.741 dòng. Còn **PDF/page-all export mẫu cũ** nếu CEO cần. |
| 🧠 Phân tích (`pt`) | KPI phân tích; đơn vị biến động; SP cần đẩy mạnh; SP sắp hết CST; phân tích chuyên sâu; biểu đồ/cơ cấu; export Excel/PDF | `Analysis` | partial | Đã có so kỳ trước, tăng/giảm ĐV/SP, cơ cấu tuyến/nhà thầu/UT. **Chưa có biểu đồ, PDF, đủ các block chuyên sâu như nguồn đã cách ly.** |
| 👤 DS Nhân viên (`nv`) | Danh sách NV; thống kê; chart `chNV`; thông tin mã NV/họ tên/SĐT/email/bộ phận/chức vụ/tình trạng/CCCD/ngày sinh/thâm niên/biển số; lọc/search | Chưa có tab riêng | todo | App Report có `users.json`/auth mapping phục vụ đăng nhập và scope, nhưng **chưa có tab Nhân viên** cho CEO xem/quản trị như nguồn đã cách ly. |
| 📤 Upload (`upload`) | Upload & validate Excel; chọn loại báo cáo `Doanh thu tuần/Đặt hàng/Khác`; chọn khoảng ngày; preview lỗi/dòng mới; tải file lỗi; lịch sử upload; xóa mục lịch sử | `Upload` | partial | Đã tách `Import mới`, `Import cập nhật`, `Lịch sử & khôi phục`; validate backend; duplicate block; rollback slot. **Chưa có đủ loại báo cáo Đặt hàng/Khác, tải file lỗi theo mẫu cũ, biểu đồ preview upload cũ.** |
| 📚 Kho dữ liệu (`kho`) / `kho-dulieu.html` | Kho master Nhân viên + Đơn vị; lọc bộ phận/tình trạng/tuyến; search; tải lại; export JSON/Excel/PDF; upload master mới; chọn/sửa dòng đơn vị; gộp theo mã | `Upload` + auth data nội bộ | partial/todo | App Report có lịch sử slot doanh thu + rollback, nhưng **chưa có Kho dữ liệu master đầy đủ**: tab Nhân viên/Đơn vị, sửa dòng, export JSON/PDF, upload master, gộp theo mã. |
| 🎯 Target admin (`target`) | CEO nhập/sửa target theo kỳ; nút `Tải kỳ`, `Lưu tất cả`, `AI Đề xuất`; xóa target từng NV; hiển thị DT kỳ trước/% đạt/gợi ý | `Target` | partial | App Report xem target kỳ này + forecast, target thật 01→06. **Chưa có UI admin nhập/sửa/xóa target, AI đề xuất target theo kỳ như nguồn đã cách ly.** |
| 📊 Target NV (`mytarget`) | NV xem target tháng/quý/thưởng 3P; target fallback kỳ gần nhất; xếp hạng quý; nút gửi Zalo/Email khen thưởng; export Excel/PDF ranking | `Target` theo scope | partial | Sale scope đã xem target của mình trong tab Target. **Chưa có màn Target NV riêng, thưởng 3P/quý, gửi Zalo/Email, export ranking.** |
| 🔄 Điều chuyển NV (`dc`) | Bộ lọc % CST còn, đơn vị, gói; tab `Đề xuất điều chuyển`, `Lịch sử điều chuyển`; export Excel/PDF | Chưa có | todo | Đây là nghiệp vụ Sale/điều chuyển nhân viên, không nên tự chuyển trong Report Bot nếu không phục vụ App Report. Cần CEO/Claude quyết scope trước. |
| Đối chiếu | CEO yêu cầu theo dõi mục đối chiếu old↔new/mismatch | Chưa có màn riêng | todo | Hiện đối chiếu đang là tài liệu + script audit nội bộ, **chưa có tab UI Đối chiếu**. Nếu cần, đề xuất làm màn read-only cho CEO: kỳ, tab, dòng/tổng, diff, sample rows. |
| 🤖 Hỏi nhanh/AI | Nguồn đã cách ly có hỏi nhanh/AI trong luồng report; dữ liệu phục vụ tổng hợp | `AiChat` | partial | App Report có API `/ai/ask` + gợi ý câu hỏi. Cần test sâu theo doanh thu/CST/Target và bảo đảm scope. |

---

## 3. Ma trận tính năng/nút xuyên suốt

| Nhóm tính năng nguồn đã cách ly | Chi tiết nguồn đã cách ly | App Report | Trạng thái | Việc còn lại |
|---|---|---|---:|---|
| Bộ chọn kỳ | Nguồn đã cách ly chọn kỳ DB/upload, tự nhảy upload mới nhất, có logic `UPLOAD:<label>` | `PeriodFilter` + `/api/periods` | done | Overview hỗ trợ tháng/quý/khoảng; các tab list hiện vẫn chọn kỳ tháng qua filter chung. Nếu cần, mở rộng quý/khoảng cho Revenue/SP/Analysis sau. |
| Bộ lọc dữ liệu | NV/ĐV/SP/tuyến/UT/nhà thầu/gói/search | `/api/filters`, `RevenueFilters`, CST filters | done | Tiếp tục dùng backend scope; không lọc client cho dữ liệu nhạy cảm. |
| Phân quyền | CEO/admin/sale; sale chỉ thấy phạm vi | `issueToken` + `scopeOf` | done | Đã test CEO all, DN009 own rows. Login V2 live còn chờ token Telegram. |
| Excel export | Nguồn đã cách ly nhiều nút Excel theo từng bảng/page/all | `/api/export/*.xlsx` | partial | Đã có Excel cho revenue/revenue_full/products/cst theo filter. Thiếu các export chuyên biệt top NV/Top ĐV/Top SP, page/all, target ranking, kho master. |
| PDF export | Nguồn đã cách ly dùng jsPDF/autotable, có nút PDF ở hầu hết tab | Chưa có backend/frontend PDF chuẩn | todo | Cần thiết kế server-side PDF hoặc client PDF sau khi chốt mẫu. |
| Print | Nguồn đã cách ly/luồng cũ có nhu cầu in/PDF báo cáo | Chưa có | todo | Chưa chuyển. Nên làm cùng PDF để thống nhất mẫu. |
| Biểu đồ | Nguồn đã cách ly dùng Chart.js: line/bar/doughnut/pie ở Tổng quan, Phân tích, Upload, NV | Chưa có | todo | Xem kế hoạch mục 8; chưa code. |
| Pagination/page-size | Nguồn đã cách ly nhiều bảng có page-size 10/20/30/50/100 | Một số tab có pagination/card grid | partial | RevenueFull có pagination; Revenue/SP/CST đang card grid/load top/filter, chưa đủ page-size giống cũ. |
| Drill-down | Nguồn đã cách ly DT drill theo NV/ĐV/SP; top lists | `Revenue` | done | Đã verify drill NV → ĐV. |
| Cảnh báo smart | Nguồn đã cách ly có cảnh báo CST + phân tích biến động | `Overview alerts`, `TenderQuota` | done/partial | Dashboard V2 đã nhóm 4 loại; CST alerts done. Có thể bổ sung thêm cảnh báo cũ nếu CEO yêu cầu. |
| Upload validate | Nguồn đã cách ly validate client + preview lỗi + history | `Upload` backend validate | partial | Backend an toàn hơn; thiếu tải file lỗi và một số loại báo cáo cũ. |
| Kho/rollback | Nguồn đã cách ly có kho master + upload history; App Report có slot history/rollback doanh thu | `Upload history & khôi phục` | partial | Rollback doanh thu done; kho master Nhân viên/Đơn vị chưa chuyển. |
| Hoạt chất/nhóm thuốc | Nguồn đã cách ly CST/SP có trường hoạt chất/nhóm khi nguồn có | CST có; Products chưa đầy đủ | partial | CST hiển thị hoạt chất/nhóm; Products cần thêm hoặc xác nhận nguồn chuẩn cho hoạt chất/nhóm thuốc. |
| Target quản trị | Nhập/sửa/xóa/gợi ý target | Target view/forecast | partial | Cần tab admin target editor nếu CEO còn dùng. |
| Thưởng 3P/Zalo/Email target | Nguồn đã cách ly có nút gửi Zalo/Email khen thưởng, gated khi đủ target quý | Chưa có | todo | Đây là gửi ra ngoài; chỉ làm sau khi có quy trình duyệt 3 nút. |
| Điều chuyển NV | Nguồn đã cách ly có đề xuất/lịch sử/export | Chưa có | todo | Nghiệp vụ nhạy cảm/Sale; cần CEO/Claude quyết có đưa vào App Report không. |
| Thiết bị/phiên | Nguồn đã cách ly có quản lý phiên/thiết bị ở auth | Login V2 | partial | Code đã có session 60 phút, max 3 trusted devices; live Telegram cần token thật. |

---

## 4. Đối chiếu dữ liệu đã hoàn tất

### 4.1 Doanh thu 01→06/2026

Kết luận 2026-07-02: **KHỚP 100%**, không có kỳ lệch số. Đối chiếu tính trực tiếp từ file nguồn, không làm tròn.

Nguồn đối chiếu:
- 01→03/2026: artifact ORDS đã dump theo logic nguồn đã cách ly tại `artifacts/revenue_ords_202601_202603/`.
- 04→06/2026: file upload nguồn đã cách ly tại `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_*.json`.
- App Report: `store.getRows({ ky, scope:{ empCode:null } })` sau import slot active.

| Kỳ | Nguồn nguồn đã cách ly | Dòng cũ | Tổng cũ | Dòng mới | Tổng mới | Chênh dòng | Chênh tiền | NV | Dòng mẫu đã khớp |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 01.2026 | ORDS artifact `report_upload_data_20260101_20260131.json` | 2.094 | 32.509.346.732 | 2.094 | 32.509.346.732 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Crexor 10 · SL 220.000 · 187.000.000 |
| 02.2026 | ORDS artifact `report_upload_data_20260201_20260228.json` | 1.308 | 17.507.218.993 | 1.308 | 17.507.218.993 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 19.980 · 17.382.600 |
| 03.2026 | ORDS artifact `report_upload_data_20260301_20260331.json` | 2.175 | 33.773.738.542 | 2.175 | 33.773.738.542 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 49.980 · 43.482.600 |
| 04.2026 | Nguồn đã cách ly `report_upload_data_20260401_20260430.json` | 2.282 | 34.794.142.431 | 2.282 | 34.794.142.431 | 0 | 0 | 21 | DN001 · 001.BVĐK Đồng Nai · Vixcar · SL 79.980 · 69.582.600 |
| 05.2026 | Nguồn đã cách ly `report_upload_data_20260501_20260529.json` | 1.600 | 30.398.950.820 | 1.600 | 30.398.950.820 | 0 | 0 | 21 | DN001 · 171.PKĐK NAM VIỆT · Cerecaps · SL 4.980 · 13.246.800 |
| 06.2026 | Nguồn đã cách ly `report_upload_data_20260601_20260630.json` | 2.001 | 28.403.136.096 | 2.001 | 28.403.136.096 | 0 | 0 | 22 | DN003 · 019.TTYT H. Vĩnh Cửu · Nadecin 10mg · SL 1.000 · 2.600.000 |

### 4.2 CST — đóng mục 2.741 dòng, cập nhật merge upload kỳ mới nhất

Artifacts kiểm tra:
- Mismatch ban đầu: `artifacts/reconcile_tabs_until_cst_mismatch_20260702.json`.
- Sau xử lý/đóng mục thiếu mã QLNB: `artifacts/reconcile_cst_resolved_20260702.json`.
- Trace lỗi trừ thiếu upload hiện tại: `artifacts/cst_trace_cases_20260702.json`.
- Verify sau sửa merge upload: `artifacts/cst_verify_after_upload_merge_20260702.json`.
- Guard rủi ro biên baseline/duplicate key: `artifacts/cst_merge_guard_check_20260702.json`.

Kết luận: CST App Report giữ **2.741 dòng**; dòng thiếu mã QLNB `Bividia 25 · 108. BVĐK LONG AN · DN001` được giữ và UI hiển thị mã QLNB là `—`. Công thức runtime hiện khớp nguồn đã cách ly: baseline `cst_real.json` + các slot upload active có kỳ **sau mốc baseline** theo khóa `IIT_CODE + DONVI chuẩn hóa`; không ép số vào file nguồn. Baseline hiện `source_from_date=01-MAY-26` → `baselineCoveredKy=05.2026`, nên chỉ merge `06.2026`; nếu re-dump baseline mới hơn, slot cũ hơn/bằng mốc sẽ không double-count.

| Nguồn | Dòng | Tổng CST ban đầu | Tổng SL đã bán | Tổng SL còn | Tổng TT còn lại | Chênh |
|---|---:|---:|---:|---:|---:|---:|
| Baseline nguồn đã cách ly `artifacts/cst_full_from_old.json` | 2.741 | 182.837.992 | 62.993.027 | 120.068.002 | 399.841.752.609 | — |
| Baseline App Report `server/data/cst_real.json` | 2.741 | 182.837.992 | 62.993.027 | 120.068.002 | 399.841.752.609 | 0 |
| Runtime App Report sau merge upload `06.2026` | 2.741 | 182.837.992 | 67.311.919 | 115.850.462 | 385.797.655.411 | xem artifact verify |

Dòng thiếu mã QLNB đã được giữ:

| Trường | Giá trị |
|---|---|
| `source_from_date` | `01-MAY-26` |
| `unit_code_name` | `108. BVĐK LONG AN` |
| `product_name` | `Bividia 25` |
| `iit_code` | *(rỗng; UI hiển thị `—`)* |
| `emp_code` | `DN001` |
| `cst_ban_dau` / `sl_con_lai` | `44.000` / `44.000` |
| `gia_thau` / `tt_con_lai` | `1.800` / `79.200.000` |
| `raw_nv` | `284` |

---

## 5. Những gì CHƯA chuyển / còn thiếu rõ ràng

Các mục này cần được coi là backlog chính thức, không được hiểu nhầm là đã hoàn tất:

1. **Biểu đồ:** chưa có chart trong App Report.
2. **Tab Nhân viên:** chưa có tab DS Nhân viên/master employee như nguồn đã cách ly.
3. **Đối chiếu:** chưa có màn UI đối chiếu old↔new; hiện mới là tài liệu/script audit nội bộ.
4. **PDF/print:** chưa chuyển bộ PDF/print/mẫu cũ; App Report chủ yếu mới có Excel.
5. **Hoạt chất/nhóm thuốc:** CST đã có trường, nhưng tab Sản phẩm chưa parity đầy đủ hoạt chất/nhóm thuốc như kỳ vọng nguồn đã cách ly.
6. **Kho dữ liệu master:** chưa chuyển đầy đủ `kho-dulieu.html` gồm Nhân viên/Đơn vị, sửa dòng, gộp mã, export JSON/PDF, upload master.
7. **Rollback:** rollback slot doanh thu đã có; rollback/master data parity nguồn đã cách ly chưa đủ.
8. **Target admin editor:** chưa có nhập/sửa/xóa target + AI đề xuất như nguồn đã cách ly.
9. **Target NV/thưởng 3P:** chưa có màn riêng, ranking quý, gửi Zalo/Email khen thưởng.
10. **Điều chuyển NV:** chưa chuyển; cần quyết định phạm vi vì đây là nghiệp vụ Sale, không phải lõi Report Bot.
11. **Export chi tiết theo mẫu cũ:** thiếu page/all cho từng tab, Top NV/Top ĐV/Top SP, target ranking, kho master.
12. **Upload file lỗi:** chưa có tải file lỗi Excel theo kiểu nguồn đã cách ly.
13. **Biểu đồ preview upload:** chưa có top ĐV/tuyến/nhà thầu/month chart trong preview upload như nguồn đã cách ly.

---

## 6. Backlog đề xuất theo ưu tiên hiện tại

Ưu tiên CEO đã chốt: **Login V2 go-live > bộ lọc kỳ + cân đối KPI > báo cáo hoàn thiện > biểu đồ**.

| Ưu tiên | Việc | Trạng thái/điều kiện |
|---:|---|---|
| P0 | Go-live Login V2 Telegram | Chờ token thật BotFather cho `@Reportdonapharm_bot`; sau đó verify `getMe`, start worker, map CEO, test live. |
| P0 | Giữ số liệu đúng | Đã done doanh thu 01→06 và CST; mọi mismatch mới phải dừng xử lý. |
| P1 | Hoàn thiện báo cáo parity | PDF/print, export mẫu cũ, tab Nhân viên/Kho, Target admin, Đối chiếu read-only. |
| P1 | Hoạt chất/nhóm thuốc cho Products | Cần xác định nguồn master chuẩn để tránh hiển thị thiếu/sai. |
| P2 | Biểu đồ | Chỉ làm sau khi CEO/Claude duyệt kế hoạch mục 8. |
| P2 | Điều chuyển NV | Chỉ làm nếu CEO xác nhận vẫn thuộc App Report; nếu là nghiệp vụ Sale thì chuyển Sale Bot. |

---

## 7. Kiểm soát bảo mật/phân quyền cần giữ

- Không dùng dữ liệu nguồn đã cách ly `dona-report` port `3860` theo kiểu ghi/sửa; chỉ đọc để audit.
- App Report phải luôn đi qua `issueToken` + `scopeOf`.
- Telegram login phải ẩn nếu thiếu `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, hoặc `TELEGRAM_BOT_SECRET`.
- `TELEGRAM_BOT_SECRET`/`TELEGRAM_BOT_TOKEN` chỉ ở `.env`, không commit.
- Export/PDF/chart/API phải tôn trọng scope CEO/admin/sale.
- Các hành động gửi ra ngoài như Zalo/Email khen thưởng phải có duyệt CEO 3 nút trước khi bật.

---

## 8. Kế hoạch biểu đồ — đề xuất trước, CHƯA CODE

### 8.1 Thư viện khuyến nghị

**Khuyến nghị: Recharts.**

Lý do:
- Phù hợp React/Vite hiện tại, viết component chart rõ ràng, dễ truyền props theo `period filter + scope`.
- Responsive tốt hơn cho layout PC/mobile mới.
- Dễ custom tooltip/legend theo tiếng Việt và màu DNPHARMA.
- Dễ tách chart thành component nhỏ, ít rủi ro đụng logic dữ liệu.

Phương án thay thế: **Chart.js**.
- Ưu điểm: giống nguồn đã cách ly, các loại line/bar/doughnut đã dùng quen.
- Nhược điểm: trong React cần wrapper hoặc tự quản lifecycle canvas; dễ phát sinh lỗi destroy/re-render, tooltip/responsive cần xử lý thủ công hơn.

Kết luận đề xuất: dùng **Recharts** cho App Report; chỉ dùng Chart.js nếu CEO/Claude ưu tiên giống kỹ thuật nguồn đã cách ly hơn tính React-native.

### 8.2 Bundle size dự kiến

| Thư viện | Tác động bundle | Nhận xét |
|---|---:|---|
| Recharts | Khoảng vài trăm KB minified trước gzip, tùy tree-shaking; sau gzip thường nhẹ hơn đáng kể | Chấp nhận được cho trang quản trị nội bộ; nên lazy-load chart components nếu cần. |
| Chart.js + react-chartjs-2 | Chart.js khoảng 200KB+ minified trước gzip, wrapper nhỏ | Có thể nhẹ hơn một số case, nhưng cần quản lý đăng ký components/lifecycle. |

Biện pháp kiểm soát:
- Chỉ import chart components cần dùng.
- Có thể lazy-load phần biểu đồ ở `Overview/Analysis/Target` nếu build tăng quá nhiều.
- Sau khi code phải chạy `npm run build` và ghi nhận kích thước bundle trong CHANGELOG.

### 8.3 Bốn biểu đồ đề xuất

| # | Biểu đồ | Loại | Nơi đặt | Dữ liệu/API cần | Scope/kỳ |
|---:|---|---|---|---|---|
| 1 | Đường doanh thu theo kỳ | Line chart | `Tổng quan` dưới KPI hoặc đầu `Phân tích` | Doanh thu theo tháng trong range; nếu chọn tháng thì hiển thị xu hướng các kỳ gần nhất 6 tháng | Tôn trọng period filter; sale chỉ thấy doanh thu của mình. |
| 2 | Cột Top đơn vị / Top sản phẩm | Bar chart ngang | `Phân tích` và có thể một block nhỏ ở `Tổng quan` | Top N đơn vị hoặc sản phẩm theo doanh thu/SL; toggle Đơn vị/Sản phẩm | Theo tháng/quý/khoảng + toàn bộ filters/scope. |
| 3 | Donut cơ cấu tuyến / nhà thầu / gói thầu | Donut chart | `Phân tích` | Group doanh thu theo `route`, `contractor_code`, `bid_package`; toggle 3 chế độ | Theo period filter + scope; không lộ nhà thầu/gói ngoài phạm vi sale. |
| 4 | Target vòng tiến độ | Progress ring / radial bar | `Target` và KPI nhỏ ở `Tổng quan` | Target, doanh thu trước VAT/logic target, % đạt, còn thiếu/vượt | Theo kỳ/range; sale chỉ target của mình, CEO thấy tổng và list NV. |

### 8.4 API/chart data đề xuất

Không nên để frontend tự tính chart từ toàn bộ rows lớn. Đề xuất thêm API tổng hợp backend:

- `GET /api/charts/revenue-trend?ky=...` hoặc `from/to`: trả `[{ ky, revenue, revenueBeforeVat, target }]`.
- `GET /api/charts/top?kind=unit|product&from/to...`: trả top N theo scope/filter.
- `GET /api/charts/mix?kind=route|contractor|bid&from/to...`: trả cơ cấu doanh thu.
- `GET /api/charts/target-progress?from/to...`: trả tổng hoặc từng NV theo scope.

Tất cả route phải dùng `auth.requireAuth`, `loginCtx(req)`, `periodCtx(req.query)`, `store.getRowsRange/getRows` và `scopeOf` như các API hiện tại.

### 8.5 Điều kiện nghiệm thu trước khi code chart

- CEO/Claude duyệt thư viện và vị trí đặt.
- Có API tổng hợp backend, không kéo full rows ra frontend.
- Tất cả chart test bằng CEO và DN009 để đảm bảo scope.
- Build OK, không làm vỡ mobile 390px và PC 1440/1920px.
- CHANGELOG ghi rõ bundle impact.

---

## 9. Lịch sử mốc đã hoàn tất

### Login V2
- Đã implement Telegram code TTL 120s, one-time use, poll by `poll_secret`, reject bad `secret_bot`, reject unmapped Telegram.
- Session 60 phút bền qua restart.
- Max 3 trusted devices, thiết bị thứ 4 evict oldest.
- Đã harden: Telegram login ẩn nếu thiếu token.
- Blocker live: `TELEGRAM_BOT_TOKEN` chưa có giá trị thật.

### Dashboard/period/UI
- Dashboard “Cần chú ý” V2 đã nhóm smart alerts: target, unit_down, cst_low, cst_high.
- KPI strip đã mở thành 6 thẻ.
- List pages đã chuyển sang analysis-style card grids responsive.
- Bộ lọc kỳ tháng/quý/khoảng đã xong; MoM/range-over-range theo cùng độ dài kỳ; CST là snapshot hiện tại.

### Upload
- Đã tách luồng `Import mới`, `Import cập nhật`, `Lịch sử & khôi phục`.
- Update kỳ hiện có tạo slot mới, giữ slot cũ để rollback; không xóa dữ liệu cũ.

---

## 10. Nguyên tắc xử lý mismatch từ nay

Nếu bất kỳ tab nào tiếp tục đối chiếu và phát hiện lệch:
1. Dừng coding/tối ưu liên quan tab đó.
2. Ghi nguồn cũ, nguồn mới, kỳ, scope, tổng cũ/mới, dòng cũ/mới, sample row lệch.
3. Không làm tròn, không sửa số để khớp giả.
4. Báo CEO/Claude quyết định nguồn chuẩn trước khi tiếp tục.
