# SPEC_DATASOURCE_CUTOVER — mục F crosswalk CL result

Read-only run: 2026-07-02T14:45:23.561Z. No App Sale/Lumos writes, no cutover.

## Counts after explicit crosswalk rules
- App Sale CL offering rows: 3002
- App Sale explicit keys: 2776
- Lumos/App Report CST keys: 2741
- Matched Lumos keys: 2731 (99.64%)
- Lumos-only: 10
- App-only: 45
- App duplicate explicit keys: 226
- App-only with valid allocation in App Sale cst_quota: 0
- App-only without allocation: 45

## Explicit crosswalk artifacts
- `artifacts/cutover_f/crosswalk_units.json`
- `artifacts/cutover_f/crosswalk_products.json`
- `artifacts/cutover_f/crosswalk_bidpkg.json`
- `artifacts/cutover_f/f_crosswalk_result.json`

## Blockers / GAP
### Lumos-only keys
```json
[
  {
    "key": "G1.GE.QĐ139.2622.N4.943|001|QĐ139",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "001.BVĐK Đồng Nai",
    "unit_name": "001.BVĐK Đồng Nai",
    "bid_package": "G1.L1.QĐ139/27.02.25",
    "hd_den_ngay": null,
    "remain_qty": 10000,
    "bid_qty_initial": 10000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|002|QĐ139",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "002.BVĐK Thống Nhất ĐN",
    "unit_name": "002.BVĐK Thống Nhất ĐN",
    "bid_package": "G1.L1.QĐ139/27.02.25",
    "hd_den_ngay": null,
    "remain_qty": 40000,
    "bid_qty_initial": 40000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "|108|",
    "classification": "SOURCE_MISSING_IIT_KEEP_STATIC_UNTIL_FIXED",
    "iit_code": "",
    "product_name": "Bividia 25",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": "108. BVĐK LONG AN",
    "bid_package": "",
    "hd_den_ngay": null,
    "remain_qty": 44000,
    "bid_qty_initial": 44000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|146|QĐ139",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "146.TTYT PHƯỚC LONG",
    "unit_name": "146.TTYT PHƯỚC LONG",
    "bid_package": "G1.L1.QĐ139/27.02.25",
    "hd_den_ngay": null,
    "remain_qty": 10000,
    "bid_qty_initial": 10000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ139.2622.N4.943|148|QĐ139",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ139.2622.N4.943",
    "product_name": "Asakoya",
    "unit_code": "148.TTYT ĐỒNG XOÀI",
    "unit_name": "148.TTYT ĐỒNG XOÀI",
    "bid_package": "G1.L1.QĐ139/27.02.25",
    "hd_den_ngay": null,
    "remain_qty": 5000,
    "bid_qty_initial": 5000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|173|QĐ1074",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "173. BV ĐÀ NẴNG",
    "unit_name": "173. BV ĐÀ NẴNG",
    "bid_package": "G1.L1.QĐ1074/06.10.25",
    "hd_den_ngay": null,
    "remain_qty": 120000,
    "bid_qty_initial": 120000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|174|QĐ1074",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "174. TTYT KV HOÀ VANG",
    "unit_name": "174. TTYT KV HOÀ VANG",
    "bid_package": "G1.L1.QĐ1074/06.10.25",
    "hd_den_ngay": null,
    "remain_qty": 11500,
    "bid_qty_initial": 11500,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|191|QĐ1074",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "191.BV ĐÀ NẴNG",
    "unit_name": "191.BV ĐÀ NẴNG",
    "bid_package": "G1.L1.QĐ1074/06.10.25",
    "hd_den_ngay": null,
    "remain_qty": 120000,
    "bid_qty_initial": 120000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ48.549.N4.549|191|QĐ48",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ48.549.N4.549",
    "product_name": "Valesto",
    "unit_code": "191.BVĐK TRẦN VĂN THỜI",
    "unit_name": "191.BVĐK TRẦN VĂN THỜI",
    "bid_package": "G1.L1.QĐ48/2026/SYT-CM",
    "hd_den_ngay": null,
    "remain_qty": 30000,
    "bid_qty_initial": 30000,
    "appsale_cst_quota_count": 0
  },
  {
    "key": "G1.GE.QĐ1074.2120.N4|192|QĐ1074",
    "classification": "GAP_ACTIVE_OR_UNKNOWN",
    "iit_code": "G1.GE.QĐ1074.2120.N4",
    "product_name": "Trifilip",
    "unit_code": "192.TTYT KV HOÀ VANG",
    "unit_name": "192.TTYT KV HOÀ VANG",
    "bid_package": "G1.L1.QĐ1074/06.10.25",
    "hd_den_ngay": null,
    "remain_qty": 11500,
    "bid_qty_initial": 11500,
    "appsale_cst_quota_count": 0
  }
]
```

### App-only keys without/with allocation
```json
[
  {
    "key": "G1.GE.QĐ139.2162.N4.624|002|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2162.N4.624",
    "product_name": "Befucid",
    "unit_code": "002.BVĐK Thống Nhất ĐN",
    "unit_name": "BVĐK Thống Nhất ĐN",
    "target_unit": {
      "target_unit_code3": "002",
      "target_unit_label": "002.BVĐK Thống Nhất ĐN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1571.N3.799|021|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1571.N3.799",
    "product_name": "Sitaglo 100",
    "unit_code": "021.TTYT H. Xuân Lộc",
    "unit_name": "TTYT H. Xuân Lộc",
    "target_unit": {
      "target_unit_code3": "021",
      "target_unit_label": "021.TTYT H. Xuân Lộc",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1072.N2.80|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1072.N2.80",
    "product_name": "Cisse",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1416.N3.500|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1416.N3.500",
    "product_name": "Kavasdin 10",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1487.N3.691|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1487.N3.691",
    "product_name": "Agimoti",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1652.N4.696|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1652.N4.696",
    "product_name": "Ocevesin DT",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1692.N4.169|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1692.N4.169",
    "product_name": "Iba-Mentin 1000mg/62,5mg",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1753.N4.872|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1753.N4.872",
    "product_name": "Agihistine 24",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "03.TUE.N"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1922.N4.97|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1922.N4.97",
    "product_name": "Rizintug 75",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "03.TUE.N"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.1943.N4.563|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.1943.N4.563",
    "product_name": "Ediwel",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2053.N4.699|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2053.N4.699",
    "product_name": "Ocedurin",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2114.N4.578|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2114.N4.578",
    "product_name": "Trifilip",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2116.N4.578|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2116.N4.578",
    "product_name": "Flezinox 150",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "03.TUE.N"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2184.N4.946|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2184.N4.946",
    "product_name": "Acetakan 120",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "03.TUE.N"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2204.N4.80|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2204.N4.80",
    "product_name": "Mongor 750",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "12.MINH.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2409.N4.678|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2409.N4.678",
    "product_name": "Biviantac",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2434.N4.48|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2434.N4.48",
    "product_name": "Meloxicam SPM",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2522.N4.997|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2522.N4.997",
    "product_name": "Natri Clorid 0,9%",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2694.N4.949|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2694.N4.949",
    "product_name": "Lifecita 800 DT.",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2980.N4.1022|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2980.N4.1022",
    "product_name": "Vitamin AD",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2986.N4.1024|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2986.N4.1024",
    "product_name": "Vitamin 3B-PV",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "12.MINH.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.3004.N4.1029|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.3004.N4.1029",
    "product_name": "Pimagie",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.58.N1.501|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.58.N1.501",
    "product_name": "Amlodipine/Atorvastatin Normon 5mg/10mg film coated tablets",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.862.N2.1005|083|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.862.N2.1005",
    "product_name": "Calcicar 500 Tablet",
    "unit_code": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "unit_name": "BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
    "target_unit": {
      "target_unit_code3": "083",
      "target_unit_label": "083.BỘ CHỈ HUY QUÂN SỰ TỈNH ĐỒNG NAI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "03.TUE.N"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2014.N4.37.G|101|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2014.N4.37.G",
    "product_name": "Diclofenac",
    "unit_code": "101.BVĐK QUÂN Y 4",
    "unit_name": "BVĐK QUÂN Y 4",
    "target_unit": {
      "target_unit_code3": "101",
      "target_unit_label": "101.BVĐK QUÂN Y 4",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ236",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.3034.N5.599.G|101|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.3034.N5.599.G",
    "product_name": "Akneyash",
    "unit_code": "101.BVĐK QUÂN Y 4",
    "unit_name": "BVĐK QUÂN Y 4",
    "target_unit": {
      "target_unit_code3": "101",
      "target_unit_label": "101.BVĐK QUÂN Y 4",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ789",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QD3231.19.N4.48|106|QĐ3231",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QD3231.19.N4.48",
    "product_name": "Loxecam",
    "unit_code": "106.TTYT H. TÂN HƯNG",
    "unit_name": "TTYT H. TÂN HƯNG",
    "target_unit": {
      "target_unit_code3": "106",
      "target_unit_label": "106.TTYT H. TÂN HƯNG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ3231",
    "inferred_bid": {
      "bid": "QĐ3231",
      "rule": "FALLBACK_GOI_CODE"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QD789.4.N4.701|106|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QD789.4.N4.701",
    "product_name": "Opeverin",
    "unit_code": "106.TTYT H. TÂN HƯNG",
    "unit_name": "TTYT H. TÂN HƯNG",
    "target_unit": {
      "target_unit_code3": "106",
      "target_unit_label": "106.TTYT H. TÂN HƯNG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FALLBACK_GOI_CODE"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QD3231.19.N4.48|107_TAN_THANH|QĐ3231",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QD3231.19.N4.48",
    "product_name": "Loxecam",
    "unit_code": "107.TTYT H. TÂN THẠNH",
    "unit_name": "TTYT H. TÂN THẠNH",
    "target_unit": {
      "target_unit_code3": "107_TAN_THANH",
      "target_unit_label": "107.TTYT H. TÂN THẠNH",
      "rule": "MANUAL_107_PREFIX_COLLISION_GAP_NO_LUMOS_KEY_CONFIRMED"
    },
    "source_goi_code": "QĐ3231",
    "inferred_bid": {
      "bid": "QĐ3231",
      "rule": "FALLBACK_GOI_CODE"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ2047.21.N4|108|QĐ2047",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ2047.21.N4",
    "product_name": "Loxecam",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": " BVĐK LONG AN",
    "target_unit": {
      "target_unit_code3": "108",
      "target_unit_label": "108. BVĐK LONG AN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ2047",
    "inferred_bid": {
      "bid": "QĐ2047",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "GE.QĐ3231.N4.1653|108|QĐ3231",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "GE.QĐ3231.N4.1653",
    "product_name": "Bividia 25",
    "unit_code": "108. BVĐK LONG AN",
    "unit_name": " BVĐK LONG AN",
    "target_unit": {
      "target_unit_code3": "108",
      "target_unit_label": "108. BVĐK LONG AN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ3231",
    "inferred_bid": {
      "bid": "QĐ3231",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ273.N3.81|119|QĐ273",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ273.N3.81",
    "product_name": "Đại tràng nang Bà Giằng",
    "unit_code": "119.TTYT TP ĐÀ LẠT",
    "unit_name": "TTYT TP ĐÀ LẠT",
    "target_unit": {
      "target_unit_code3": "119",
      "target_unit_label": "119.TTYT TP ĐÀ LẠT",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ273",
    "inferred_bid": {
      "bid": "QĐ273",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ141.145.N3.133|121|QĐ141",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ141.145.N3.133",
    "product_name": "Cerecaps",
    "unit_code": "121.BV LAGI",
    "unit_name": "BV LAGI",
    "target_unit": {
      "target_unit_code3": "121",
      "target_unit_label": "121.BV LAGI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ141",
    "inferred_bid": {
      "bid": "QĐ141",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ141.108.N3.57|122|QĐ141",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ141.108.N3.57",
    "product_name": "Phong tê thấp",
    "unit_code": "122.TTYT HÀM TÂN",
    "unit_name": "TTYT HÀM TÂN",
    "target_unit": {
      "target_unit_code3": "122",
      "target_unit_label": "122.TTYT HÀM TÂN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ141",
    "inferred_bid": {
      "bid": "QĐ141",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ141.145.N3.133|122|QĐ141",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ141.145.N3.133",
    "product_name": "Cerecaps",
    "unit_code": "122.TTYT HÀM TÂN",
    "unit_name": "TTYT HÀM TÂN",
    "target_unit": {
      "target_unit_code3": "122",
      "target_unit_label": "122.TTYT HÀM TÂN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ141",
    "inferred_bid": {
      "bid": "QĐ141",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ141.18.N2.127|122|QĐ141",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ141.18.N2.127",
    "product_name": "Hoạt huyết dưỡng não HL",
    "unit_code": "122.TTYT HÀM TÂN",
    "unit_name": "TTYT HÀM TÂN",
    "target_unit": {
      "target_unit_code3": "122",
      "target_unit_label": "122.TTYT HÀM TÂN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ141",
    "inferred_bid": {
      "bid": "QĐ141",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G3.ĐY.QĐ141.277.N3.119|122|QĐ141",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G3.ĐY.QĐ141.277.N3.119",
    "product_name": "Hoàn xích hương",
    "unit_code": "122.TTYT HÀM TÂN",
    "unit_name": "TTYT HÀM TÂN",
    "target_unit": {
      "target_unit_code3": "122",
      "target_unit_label": "122.TTYT HÀM TÂN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ141",
    "inferred_bid": {
      "bid": "QĐ141",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2963.N4.549|124|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2963.N4.549",
    "product_name": "Valesto",
    "unit_code": "124.BV QUÂN DÂN Y SÓC TRĂNG",
    "unit_name": "BV QUÂN DÂN Y SÓC TRĂNG",
    "target_unit": {
      "target_unit_code3": "124",
      "target_unit_label": "124.BV QUÂN DÂN Y SÓC TRĂNG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "02.AFP"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QD284.49.N4.549|124|QĐ3231",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QD284.49.N4.549",
    "product_name": "Valesto",
    "unit_code": "124.BV QUÂN DÂN Y SÓC TRĂNG",
    "unit_name": "BV QUÂN DÂN Y SÓC TRĂNG",
    "target_unit": {
      "target_unit_code3": "124",
      "target_unit_label": "124.BV QUÂN DÂN Y SÓC TRĂNG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ3231",
    "inferred_bid": {
      "bid": "QĐ3231",
      "rule": "FALLBACK_GOI_CODE"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QĐ1572.1184.N3.755|144|QĐ1572",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QĐ1572.1184.N3.755",
    "product_name": "Medsolu 4mg",
    "unit_code": "144.BV CAO SU PHÚ RIỀNG",
    "unit_name": "BV CAO SU PHÚ RIỀNG",
    "target_unit": {
      "target_unit_code3": "144",
      "target_unit_label": "144.BV CAO SU PHÚ RIỀNG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": null,
    "inferred_bid": {
      "bid": "QĐ1572",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2816.N4.1018|148|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2816.N4.1018",
    "product_name": "Vigahom",
    "unit_code": "148.TTYT ĐỒNG XOÀI",
    "unit_name": "TTYT ĐỒNG XOÀI",
    "target_unit": {
      "target_unit_code3": "148",
      "target_unit_label": "148.TTYT ĐỒNG XOÀI",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ139",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ139.2295.N4.723|151|QĐ139",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ139.2295.N4.723",
    "product_name": "Atisyrup zinc",
    "unit_code": "151.TTYT CHƠN THÀNH",
    "unit_name": "TTYT CHƠN THÀNH",
    "target_unit": {
      "target_unit_code3": "151",
      "target_unit_label": "151.TTYT CHƠN THÀNH",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": "QĐ325",
    "inferred_bid": {
      "bid": "QĐ139",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "QĐ1572.1184.N3.755|155|QĐ1572",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "QĐ1572.1184.N3.755",
    "product_name": "Medsolu 4mg",
    "unit_code": "155.TTYT HỚN QUẢN",
    "unit_name": "TTYT HỚN QUẢN",
    "target_unit": {
      "target_unit_code3": "155",
      "target_unit_label": "155.TTYT HỚN QUẢN",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": null,
    "inferred_bid": {
      "bid": "QĐ1572",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ25000387599.2014.N4|194|QĐ25000387599",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ25000387599.2014.N4",
    "product_name": "Diclofenac",
    "unit_code": "194.BV PHỤ SẢN TIỀN GIANG",
    "unit_name": "BV PHỤ SẢN TIỀN GIANG",
    "target_unit": {
      "target_unit_code3": "194",
      "target_unit_label": "194.BV PHỤ SẢN TIỀN GIANG",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": null,
    "inferred_bid": {
      "bid": "QĐ25000387599",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  },
  {
    "key": "G1.GE.QĐ1246.131.N4|195|QĐ1246",
    "classification": "APP_ONLY_NO_ALLOCATION_HOLD",
    "qlnb_code": "G1.GE.QĐ1246.131.N4",
    "product_name": "Diclofenac",
    "unit_code": "195.BVĐK CAI LẬY",
    "unit_name": "BVĐK CAI LẬY",
    "target_unit": {
      "target_unit_code3": "195",
      "target_unit_label": "195.BVĐK CAI LẬY",
      "rule": "EXPLICIT_FROM_SOURCE_CODE"
    },
    "source_goi_code": null,
    "inferred_bid": {
      "bid": "QĐ1246",
      "rule": "FROM_QLNB"
    },
    "contractor_codes": [
      "01.DONA"
    ],
    "offering_count": 1,
    "cst_quota_count": 0,
    "allocation": null
  }
]
```

### Duplicate App keys handling
```json
[
  {
    "key": "G1.GE.QĐ139.1.N1.777|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Bluecose",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1037.N2.429|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Flavoxate Savi 100",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1047.N2.932|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Fitrofu 100",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.105.N1.512|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "12.MINH.P"
    ],
    "product_name": "Bisoplus HCT 5/12.5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1054.N2.945|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Leminerg 4",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1055.N2.945|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "SaVi Galantamin 8",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1060.N2.946|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "15.THAI.N"
    ],
    "product_name": "Gikorcen",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1072.N2.80|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Cisse",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1080.N2.526|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "10.ĐAI.TS"
    ],
    "product_name": "Wright-F",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1096.N2.490|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Isoday 20",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1097.N2.490|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Vasotrate-30 OD",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1104.N2.162|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Pizar-3",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1115.N2.922|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Lamostad 25",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1122.N2.151|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Levetral",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1123.N2.151|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Levetral-750",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1129.N2.234|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Levofloxacin 750mg/150ml",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1130.N2.234|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Levofloxacin 250mg/50ml",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1134.N2.918|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Evaldez-50",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1193.N2.52|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "10.ĐAI.TS"
    ],
    "product_name": "SavNopain 500",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1222.N2.920|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Olanzap 10",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1225.N2.920|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Olanzap 5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1267.N2.543|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "SaViPerindo Plus 10mg/2.5mg",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1302.N2.545|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Ramistell 1.25",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1304.N2.545|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "product_name": "Ramifix 5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1307.N2.796|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Dasguto 2",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1311.N2.922|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "RisperSaVi 4",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1322.N2.637|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.K"
    ],
    "product_name": "Asosalic",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1374.N2.868|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "15.THAI.N"
    ],
    "product_name": "Travoprost/Pharmathen",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1376.N2.743|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Newbutin SR",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1380.N2.744|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "05.A&B"
    ],
    "product_name": "Uruso",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1393.N2.938|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Ventizam 75",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1400.N2.1024|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Solmelon",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1411.N2.906|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "08.BIN.B"
    ],
    "product_name": "Drexler",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1416.N3.500|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "product_name": "Kavasdin 10",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1419.N3.501|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Toduet 5mg/20mg",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.147.N1.183|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "13.NHAT.H"
    ],
    "product_name": "Cefimed",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1483.N3.563|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Vixcar",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1487.N3.691|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Agimoti",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.150.N1.189|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "11.TU.Đ"
    ],
    "product_name": "Cefoxitine Gerda 1g",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1502.N3.780|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "06.SONG.V"
    ],
    "product_name": "Glimet 500mg/2.5 tablets",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1516.N3.528|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "12.MINH.P"
    ],
    "product_name": "Bivitero 300",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1519.N3.490|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Vasotrate-30 OD",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1521.N3.735|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Ettaby",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1528.N3.534|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "11.TU.Đ"
    ],
    "product_name": "SaVi Losartan 100",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1533.N3.701|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Mebever MR 200mg Capsules",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1568.N3.583|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Crexor 10",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1571.N3.799|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Sitaglo 100",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1572.N3.799|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Bividia 25",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1573.N3.799|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Bividia 50",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1579.N3.433|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Xalgetz 0.4mg",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1588.N3.550|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "10.ĐAI.TS"
    ],
    "product_name": "SaVi Valsartan Plus HCT 80/12.5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1631.N4.34|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "15.THAI.N"
    ],
    "product_name": "Ecipa 50",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1652.N4.696|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "product_name": "Ocevesin DT",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1692.N4.169|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Iba-Mentin 1000mg/62,5mg",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1702.N4.169|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "11.TU.Đ"
    ],
    "product_name": "Vigentin 500/62,5 DT.",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1704.N4.169|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.K"
    ],
    "product_name": "Zorolab 1000",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1753.N4.872|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "03.TUE.N"
    ],
    "product_name": "Agihistine 24",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1765.N4.673|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Amebismo",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1779.N4.969|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Agi-Bromhexine 4",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1797.N4.1005|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Kitno",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1803.N4.1007|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Authisix",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1822.N4.514|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "05.A&B"
    ],
    "product_name": "Casathizid MM 32/12,5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1825.N4.514|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "product_name": "Ocedetan 8/12,5",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1832.N4.515|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "03.TUE.N"
    ],
    "product_name": "Usarcapri 50",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1841.N4.970|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Mahimox",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1859.N4.175|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Bicelor 375 DT.",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.187.N1.911|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "15.THAI.N"
    ],
    "product_name": "Clomedin tablets",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1895.N4.189|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Fisulty 2 g",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.191.N1.252|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "10.ĐAI.TS"
    ],
    "product_name": "Colistin TZF",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1943.N4.563|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "product_name": "Ediwel",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.1961.N4.77|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "03.TUE.N"
    ],
    "product_name": "Goutcolcin",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2014.N4.37|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "01.DONA"
    ],
    "product_name": "Diclofenac",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2029.N4.731|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "11.TU.Đ"
    ],
    "product_name": "Flaben 500",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2045.N4.663|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "05.A&B"
    ],
    "product_name": "Gynocare",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2053.N4.699|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "product_name": "Ocedurin",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2070.N4.521|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "04.NGUYEN.P"
    ],
    "product_name": "Zondoril 10",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2074.N4.522|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Aduzotil 20/6",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2114.N4.578|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "02.AFP"
    ],
    "product_name": "Trifilip",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.2116.N4.578|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "03.TUE.N"
    ],
    "product_name": "Flezinox 150",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  },
  {
    "key": "G1.GE.QĐ139.214.N1.37|001|QĐ139",
    "count": 2,
    "unit_codes": [
      "001.BVĐK Đồng Nai",
      "001.BVĐK Đồng Nai-KHU C"
    ],
    "unit_ids": [
      "1",
      "2"
    ],
    "contractor_codes": [
      "14.ĐAI.P"
    ],
    "product_name": "Elaria 100mg",
    "handling": "MERGE_001_KHU_C_SUM_TO_001"
  }
]
```

## Conclusion
Mục F rule applied, but not yet adapter-ready: remaining Lumos-only/App-only and duplicate explicit keys require review. Do not cut Lumos; next step is classify/fix GAP and then write SHADOW adapter only.
