# Trace mã NV rác #N/A / 83 — read-only

Generated: 2026-07-02T15:33:49.177Z

## Tổng hợp
| Mã rác | Số dòng | Dòng upload active | DT upload active | SL upload active | DT upload tất cả slot | CST bid_qty | CST sold_qty | CST sold_amount |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 83 | 10 | 0 | 0 | 0 | 0 | 460000 | 12000 | 21600000 |
| #N/A | 2 | 1 | 1575000 | 10 | 3150000 | 0 | 0 | 0 |

## Dòng chi tiết
| Source | Active | File/slot | Row | Kỳ | Mã rác | Raw/Sales | Đơn vị | SP | Gói | DT | SL bán/CST | Đề xuất |
|---|---|---|---:|---|---|---|---|---|---|---:|---:|---|
| upload | false | legacy_062026_mr266eqe | 1908 | 06.2026 | #N/A |  | 033.NT-PKĐK AN LONG KHÁNH | G1.GE.QĐ139.3054.N5.954  |  | 1575000 | 10 | UNALLOCATED_PENDING_REVIEW |
| upload | true | legacy_062026_mr26j8nb | 1908 | 06.2026 | #N/A |  | 033.NT-PKĐK AN LONG KHÁNH | G1.GE.QĐ139.3054.N5.954 Fortraget Inhaler 200mcg+6mcg | QĐ139 | 1575000 | 10 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2730 | CURRENT | 83 | 83 | 188.BV ĐKKV CÀ MAU | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 1000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2731 | CURRENT | 83 | 83 | 189.BVĐK CÁI NƯỚC | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 12000 | LIKELY_DN021_FOR_REVIEW |
| cst_real |  | server/data/cst_real.json | 2732 | CURRENT | 83 | 83 | 190.BVĐK NĂM CĂN | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 121000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2734 | CURRENT | 83 | 83 | 191.BVĐK TRẦN VĂN THỜI | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 30000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2735 | CURRENT | 83 | 83 | 192.BVĐK ĐẦM DƠI | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 8000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2737 | CURRENT | 83 | 83 | 193.BVĐK TRẦN VĂN THỜI | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 42000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2738 | CURRENT | 83 | 83 | 194.BVĐK VĨNH LỢI | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 20000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2739 | CURRENT | 83 | 83 | 195.BVĐK PHƯỚC LONG | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 38000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2740 | CURRENT | 83 | 83 | 196.BVĐK ĐÔNG HẢI | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 20000 | UNALLOCATED_PENDING_REVIEW |
| cst_real |  | server/data/cst_real.json | 2741 | CURRENT | 83 | 83 | 197.BV QUÂN DÂN Y BẠC LIÊU | G1.GE.QĐ48.549.N4.549 Valesto | G1.L1.QĐ48/2026/SYT-CM | 0 | 60000 | UNALLOCATED_PENDING_REVIEW |

## Kết luận an toàn
- Không remap chính thức trong file nguồn ở bước này; backend chuyển mã không hợp lệ sang nhóm `UNALLOCATED` / “Chưa phân bổ” để không lẫn vào danh sách NV thật.
- Tổng doanh thu không đổi vì chỉ đổi nhãn hiển thị runtime cho mã rác. Active upload thật của `#N/A` là 1 dòng, 1.575.000đ; dòng còn lại là slot 06 cũ inactive.
- `83` trong CST có 1 dòng `sales_emps=DN021`, các dòng còn lại cùng SP Valesto/gói QĐ48 Cà Mau-Bạc Liêu nên có khả năng thuộc DN021, nhưng cần Claude/CEO duyệt trước khi sửa dữ liệu nguồn.
- `#N/A` upload là 1 dòng Fortraget tại 033.NT-PKĐK AN LONG KHÁNH, chưa có raw NV đủ chắc để tự remap.