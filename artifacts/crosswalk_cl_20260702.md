# Crosswalk CL-scope — App Sale New ↔ Lumos/App Report

Date: 2026-07-02 GMT+7. Read-only. No App Sale writes, no Lumos cutover.

## Rule tested
- Scope App Sale: `unit_offerings.route='CL'`.
- Product key: `products.qlnb_code ↔ CST.iit_code`.
- Unit key: 3-digit prefix; temporary rule maps `001.BVĐK Đồng Nai-KHU C → 001` because App Report CST baseline currently collapses this case.
- Bid key: **prefer QĐ extracted from QLNB code**, fallback to `unit_offerings.goi_code/products.goi_thau`. This is required because App Sale `goi_code` contains operational codes like QĐ37/QĐ802 while CST/Lumos uses QĐ139/QĐ141.

## Counts
| Metric | Value |
|---|---:|
| App Sale CL offering rows | 3002 |
| App Sale CL distinct source keys | 2775 |
| Lumos/App Report CST rows/keys | 2741 |
| Matched keys | 2731 |
| Match rate vs Lumos CST | 99.6% |
| App-only keys | 44 |
| Lumos-only keys | 10 |
| Duplicate App normalized keys | 227 |
| Duplicate due 001 + KHU C collapse | 226 |
| Other duplicate keys | 1 (`QD3231.19.N4.48`, unit prefix `107` maps two different units: Đức Huệ/Tân Thạnh) |

## Result
**Chưa đạt 1:1 hoàn toàn, nhưng gần xong nếu chốt 2 rule:**
1. Gói thầu cho CST adapter nên lấy từ QĐ trong `qlnb_code` khi có, không lấy mù `goi_code`. Match tăng lên 99.6% vs Lumos.
2. Cần CEO/Claude chốt rule `001.BVĐK Đồng Nai-KHU C`: map chung vào `001` và cộng doanh số vào một CST key, hay giữ thành đơn vị riêng. Hiện duplicate 227/227 đều do rule collapse 001+KHU C; không có duplicate khác.

## Remaining Lumos-only keys (need manual mapping/source fix)
```json
[
  {
    "key": "G1.GE.QĐ139.2622.N4.943|001|QĐ139",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "001.BVĐK Đồng Nai",
    "unit_name": "001.BVĐK Đồng Nai",
    "bid_package": "G1.L1.QĐ139/27.02.25"
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|002|QĐ139",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "002.BVĐK Thống Nhất ĐN",
    "unit_name": "002.BVĐK Thống Nhất ĐN",
    "bid_package": "G1.L1.QĐ139/27.02.25"
  },
  {
    "key": "|108|",
    "iit_code": "",
    "product_name": "Bividia 25",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": "108. BVĐK LONG AN",
    "bid_package": ""
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|146|QĐ139",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "146.TTYT PHƯỚC LONG",
    "unit_name": "146.TTYT PHƯỚC LONG",
    "bid_package": "G1.L1.QĐ139/27.02.25"
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|148|QĐ139",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "148.TTYT ĐỒNG XOÀI",
    "unit_name": "148.TTYT ĐỒNG XOÀI",
    "bid_package": "G1.L1.QĐ139/27.02.25"
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|173|QĐ1074",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "173. BV ĐÀ NẴNG",
    "unit_name": "173. BV ĐÀ NẴNG",
    "bid_package": "G1.L1.QĐ1074/06.10.25"
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|174|QĐ1074",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "174. TTYT KV HOÀ VANG",
    "unit_name": "174. TTYT KV HOÀ VANG",
    "bid_package": "G1.L1.QĐ1074/06.10.25"
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|191|QĐ1074",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "191.BV ĐÀ NẴNG",
    "unit_name": "191.BV ĐÀ NẴNG",
    "bid_package": "G1.L1.QĐ1074/06.10.25"
  },
  {
    "key": "G1.GE.QĐ48.549.N4.549|191|QĐ48",
    "iit_code": "G1.GE.QĐ48.549.N4.549",
    "product_name": "Valesto",
    "unit_code": "191.BVĐK TRẦN VĂN THỜI",
    "unit_name": "191.BVĐK TRẦN VĂN THỜI",
    "bid_package": "G1.L1.QĐ48/2026/SYT-CM"
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|192|QĐ1074",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "192.TTYT KV HOÀ VANG",
    "unit_name": "192.TTYT KV HOÀ VANG",
    "bid_package": "G1.L1.QĐ1074/06.10.25"
  }
]
```

## App-only key groups (mostly units outside current CST baseline / new allocation candidates)
Top app-only units: `083:22, 122:4, 101:2, 106:2, 108:2, 124:2, 119:1, 121:1, 144:1, 148:1, 151:1, 155:1, 194:1, 195:1, 002:1`

Samples:
```json
[
  {
    "key": "G1.GE.QĐ139.2162.N4.624|002|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2162.N4.624",
    "product_name": "Befucid",
    "unit_code": "002.BVĐK Thống Nhất ĐN",
    "unit_name": "BVĐK Thống Nhất ĐN",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "02.AFP"
  },
  {
    "key": "G1.GE.QĐ139.1571.N3.799|021|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1571.N3.799",
    "product_name": "Sitaglo 100",
    "unit_code": "021.TTYT H. Xuân Lộc",
    "unit_name": "TTYT H. Xuân Lộc",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.1072.N2.80|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1072.N2.80",
    "product_name": "Cisse",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.1416.N3.500|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1416.N3.500",
    "product_name": "Kavasdin 10",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "14.ĐAI.P"
  },
  {
    "key": "G1.GE.QĐ139.1487.N3.691|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1487.N3.691",
    "product_name": "Agimoti",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.1652.N4.696|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1652.N4.696",
    "product_name": "Ocevesin DT",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "04.NGUYEN.P"
  },
  {
    "key": "G1.GE.QĐ139.1692.N4.169|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1692.N4.169",
    "product_name": "Iba-Mentin 1000mg/62,5mg",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.1753.N4.872|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1753.N4.872",
    "product_name": "Agihistine 24",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "03.TUE.N"
  },
  {
    "key": "G1.GE.QĐ139.1922.N4.97|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1922.N4.97",
    "product_name": "Rizintug 75",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "03.TUE.N"
  },
  {
    "key": "G1.GE.QĐ139.1943.N4.563|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.1943.N4.563",
    "product_name": "Ediwel",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "04.NGUYEN.P"
  },
  {
    "key": "G1.GE.QĐ139.2053.N4.699|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2053.N4.699",
    "product_name": "Ocedurin",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "14.ĐAI.P"
  },
  {
    "key": "G1.GE.QĐ139.2114.N4.578|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2114.N4.578",
    "product_name": "Trifilip",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "02.AFP"
  },
  {
    "key": "G1.GE.QĐ139.2116.N4.578|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2116.N4.578",
    "product_name": "Flezinox 150",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "03.TUE.N"
  },
  {
    "key": "G1.GE.QĐ139.2184.N4.946|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2184.N4.946",
    "product_name": "Acetakan 120",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "03.TUE.N"
  },
  {
    "key": "G1.GE.QĐ139.2204.N4.80|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2204.N4.80",
    "product_name": "Mongor 750",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "12.MINH.P"
  },
  {
    "key": "G1.GE.QĐ139.2409.N4.678|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2409.N4.678",
    "product_name": "Biviantac",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.2434.N4.48|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2434.N4.48",
    "product_name": "Meloxicam SPM",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "02.AFP"
  },
  {
    "key": "G1.GE.QĐ139.2522.N4.997|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2522.N4.997",
    "product_name": "Natri Clorid 0,9%",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.2694.N4.949|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2694.N4.949",
    "product_name": "Lifecita 800 DT.",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "02.AFP"
  },
  {
    "key": "G1.GE.QĐ139.2980.N4.1022|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2980.N4.1022",
    "product_name": "Vitamin AD",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "04.NGUYEN.P"
  },
  {
    "key": "G1.GE.QĐ139.2986.N4.1024|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2986.N4.1024",
    "product_name": "Vitamin 3B-PV",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "12.MINH.P"
  },
  {
    "key": "G1.GE.QĐ139.3004.N4.1029|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.3004.N4.1029",
    "product_name": "Pimagie",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.58.N1.501|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.58.N1.501",
    "product_name": "Amlodipine/Atorvastatin Normon 5mg/10mg film coated tablets",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "14.ĐAI.P"
  },
  {
    "key": "G1.GE.QĐ139.862.N2.1005|083|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.862.N2.1005",
    "product_name": "Calcicar 500 Tablet",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "03.TUE.N"
  },
  {
    "key": "G1.GE.QĐ139.2014.N4.37.G|101|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.2014.N4.37.G",
    "product_name": "Diclofenac",
    "unit_code": "101.BVĐK QUÂN Y 4",
    "unit_name": "BVĐK QUÂN Y 4",
    "goi_code": "QĐ236",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ139.3034.N5.599.G|101|QĐ139",
    "qlnb_code": "G1.GE.QĐ139.3034.N5.599.G",
    "product_name": "Akneyash",
    "unit_code": "101.BVĐK QUÂN Y 4",
    "unit_name": "BVĐK QUÂN Y 4",
    "goi_code": "QĐ789",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "QD3231.19.N4.48|106|QĐ3231",
    "qlnb_code": "QD3231.19.N4.48",
    "product_name": "Loxecam",
    "unit_code": "106.TTYT H. TÂN HƯNG",
    "unit_name": "TTYT H. TÂN HƯNG",
    "goi_code": "QĐ3231",
    "inferred_bid": "QĐ3231",
    "contractor_code": "01.DONA"
  },
  {
    "key": "QD789.4.N4.701|106|QĐ139",
    "qlnb_code": "QD789.4.N4.701",
    "product_name": "Opeverin",
    "unit_code": "106.TTYT H. TÂN HƯNG",
    "unit_name": "TTYT H. TÂN HƯNG",
    "goi_code": "QĐ139",
    "inferred_bid": "QĐ139",
    "contractor_code": "01.DONA"
  },
  {
    "key": "G1.GE.QĐ2047.21.N4|108|QĐ2047",
    "qlnb_code": "G1.GE.QĐ2047.21.N4",
    "product_name": "Loxecam",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": " BVĐK LONG AN",
    "goi_code": "QĐ2047",
    "inferred_bid": "QĐ2047",
    "contractor_code": "01.DONA"
  },
  {
    "key": "GE.QĐ3231.N4.1653|108|QĐ3231",
    "qlnb_code": "GE.QĐ3231.N4.1653",
    "product_name": "Bividia 25",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": " BVĐK LONG AN",
    "goi_code": "QĐ3231",
    "inferred_bid": "QĐ3231",
    "contractor_code": "01.DONA"
  }
]
```

## Duplicate normalized keys
226/227 duplicate normalized keys are caused by App Sale having both `001.BVĐK Đồng Nai` and `001.BVĐK Đồng Nai-KHU C` while the temporary normalization maps both to `001`. The remaining duplicate is `QD3231.19.N4.48|107|QĐ3231`: App Sale has two different unit names sharing prefix `107` (`TTYT H. ĐỨC HUỆ` and `TTYT H. TÂN THẠNH`), so prefix-only mapping is unsafe for that case.

Samples:
```json
[
  {
    "key": "G1.GE.QĐ139.1.N1.777|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Bluecose"
  },
  {
    "key": "G1.GE.QĐ139.1037.N2.429|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Flavoxate Savi 100"
  },
  {
    "key": "G1.GE.QĐ139.1047.N2.932|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Fitrofu 100"
  },
  {
    "key": "G1.GE.QĐ139.105.N1.512|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "12.MINH.P"
    ],
    "product_name": "Bisoplus HCT 5/12.5"
  },
  {
    "key": "G1.GE.QĐ139.1054.N2.945|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Leminerg 4"
  },
  {
    "key": "G1.GE.QĐ139.1055.N2.945|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "SaVi Galantamin 8"
  },
  {
    "key": "G1.GE.QĐ139.1060.N2.946|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "15.THAI.N"
    ],
    "product_name": "Gikorcen"
  },
  {
    "key": "G1.GE.QĐ139.1072.N2.80|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Cisse"
  },
  {
    "key": "G1.GE.QĐ139.1080.N2.526|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "10.ĐAI.TS"
    ],
    "product_name": "Wright-F"
  },
  {
    "key": "G1.GE.QĐ139.1096.N2.490|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Isoday 20"
  }
]
```

## Recommendation before adapter
- Do **not** cut Lumos.
- Create env-gated crosswalk config with fields: `source_unit_id/source_unit_code/source_qlnb_code/source_bid_raw/inferred_bid/target_unit_code3/target_iit_code/target_bid/mapping_status`.
- Mark 001/KHU C as `needs_ceo_rule` unless Claude approves existing collapse.
- Exclude Lumos blank IIT row `|108|` from App Sale timeline matching; keep baseline row read-only until source code fixed.
