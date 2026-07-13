# Data mapping + formulas for App Report-New revenue/points/xu reports

## Runtime checked on server

```bash
node -v
# v22.22.0
```

Current `server/package.json` has no SQLite library. Recommended options:

1. `better-sqlite3` (simple sync API, native dependency; choose a version supporting Node 22), or
2. Node 22 `node:sqlite` / `DatabaseSync` if Claude accepts experimental/core SQLite API.

## New source-of-truth requested by CEO

From now on:

- **Revenue + revenue points**: App Report-New data.
- **Xu**: `vat.db`, table `vat_bills`.

Legacy scripts in this handoff used Excel snapshots because those were the sources available when the emails were generated. When integrating into App Report-New, replace those file reads with App Report-New services + `vat_bills` reader.

## Revenue fields used in the existing email scripts

Existing monthly/weekly generators aggregate rows with these fields:

| Metric | Legacy field(s) | New App Report-New source |
|---|---|---|
| Employee code | `EMP_NUMBER` / `ma_nv` | normalized App Report-New employee code |
| Date | `DATE` | App Report-New sale date |
| Route | `TUYEN` / `tuyen` | route dimension: `CL`, `NCL`, `NT` |
| Unit/customer | `DONVI` / `ten_vt` / `donvi` | unit/customer dimension |
| Item/product | `ITEM_NAME` / `IIT_NAME` / `NAME` / `ten_hang` | product dimension |
| Vendor | `NHA_THAU` / `VEN_NAME` / `ten_nha_thau` | vendor/contractor dimension |
| Quantity | `QUANTITY` | quantity |
| Revenue | `REVENUE` / `tong_tien` | net sales revenue used by App Report-New |

Existing generated sections:

- employee total revenue
- route split CL/NCL/NT
- top units
- top products
- top vendors when needed
- same-period comparison: current period vs previous month period
- unit/product increases and decreases
- revenue by day

## Existing function locations

### Weekly employee email

`handoff/diemxu-report-code/scripts/generate_weekly_employee_email_week26_deep.py`

Key functions:

- `load_sales(path, start_month, end_day)` — reads Excel sales rows; replace with App Report-New revenue query.
- `aggregate(rows, code)` — employee totals + route/unit/product/day aggregates.
- `sum_by(rows, key)` — generic group by revenue.
- `compare_top(cur, prev, n, positive)` — increase/decrease vs same-period previous month.
- `report_html(code)` — builds HTML email.
- `report_txt(code)` — builds plaintext email.

### Monthly employee email V10

`handoff/diemxu-report-code/scripts/generate_monthly_employee_email_v10.py`

Key functions:

- `filt(rows, code)` — filter by employee.
- `agg(rows, key)` — group by revenue.
- `cnt(rows, key)` — count unique units/products/vendors.
- `comp(cur, old, limit)` — increases/decreases vs T05.
- HTML body block in loop over `allowed` employee list — V10 email template.

### CEO summary / older V3 monthly report

`handoff/diemxu-report-code/scripts/generate_monthly_ceo_summary_and_v3_reports.py`

This generated:

- per-employee V3 emails
- `summary_t06_employee_reports.json`
- `BAO_CAO_PHAN_TICH_NV_T06_2026.md`

Use only as reference if a CEO overview report is needed.

## Revenue point formula

Confirmed business rule from T05/2026 onward:

- Normal `NCL`: `100,000,000đ = 1.0 point`.
- `CL` and `NT`: `100,000,000đ = 2.0 points`.
- NCL exception unit codes `025`, `026`, `027`, `028`: `100,000,000đ = 2.0 points`.
- Before T05/2026: keep old formula if historical reports are regenerated.

Suggested implementation:

```js
const POINT_EFFECTIVE_FROM = '2026-05-01';
const POINT_EXCEPTION_UNIT_CODES = new Set(['025', '026', '027', '028']);

function unitPrefix(unitCodeOrName = '') {
  const m = String(unitCodeOrName).trim().match(/^(\d{3})[.\-\s_]/);
  return m ? m[1] : '';
}

function pointMultiplier(row) {
  const route = String(row.route || row.TUYEN || '').toUpperCase();
  const prefix = unitPrefix(row.unit_code || row.DONVI || row.unit || '');
  if (route === 'CL' || route === 'NT') return 2;
  if (route === 'NCL' && POINT_EXCEPTION_UNIT_CODES.has(prefix)) return 2;
  return 1;
}

function revenuePoints(row) {
  const revenue = Number(row.revenue ?? row.REVENUE ?? 0);
  return revenue / 100_000_000 * pointMultiplier(row);
}
```

## Xu from `vat.db` / `vat_bills`

SQLite database checked:

`/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db`

Table: `vat_bills`

Relevant columns:

| Purpose | Column | Notes |
|---|---|---|
| Employee code | `emp_code` | e.g. `DN001` |
| Employee name | `emp_name` | display only |
| Bill date | `ngay` | existing xu report used this date basis |
| Fallback amount | `so_tien` | legacy amount |
| Invoice total | `tong_tien` | prefer this when non-zero |
| Status | `trang_thai_hd` | e.g. `co_hd_vat`; do not hard-code unless business confirms |
| Bill kind | `bill_kind` | e.g. `vat_invoice` |
| Hidden/deleted | `hidden_at` | exclude when non-empty |

Recommended active bill filter:

```sql
WHERE IFNULL(hidden_at, '') = ''
  AND date(ngay) BETWEEN date(?) AND date(?)
```

Amount mapping:

```sql
COALESCE(NULLIF(tong_tien, 0), so_tien, 0)
```

Xu formula confirmed:

- `500,000đ = 1.3 xu`
- `xu = amount / 500000 * 1.3`

Suggested SQL for monthly/quarterly xu:

```sql
SELECT
  emp_code,
  emp_name,
  COUNT(*) AS bill_count,
  SUM(COALESCE(NULLIF(tong_tien, 0), so_tien, 0)) AS amount,
  SUM(COALESCE(NULLIF(tong_tien, 0), so_tien, 0)) / 500000.0 * 1.3 AS xu
FROM vat_bills
WHERE IFNULL(hidden_at, '') = ''
  AND date(ngay) BETWEEN date(?) AND date(?)
GROUP BY emp_code, emp_name
ORDER BY emp_code;
```

If Finance/VAT later confirms only certain `trang_thai_hd` count for xu, add:

```sql
AND trang_thai_hd IN ('co_hd_vat')
```

Do **not** add that filter until business confirms, because previous reports counted active records from `vat_bills` without requiring a stricter status in this handoff context.

## Carry xu from previous quarter

Existing Excel column names used by legacy scripts:

- `Xu tháng`
- `Xu quý`
- `Xu dư quý trước`
- `Xu tổng quý`
- `Thiếu xu`
- `Dư xu`
- `Tỷ lệ quý %`
- `Truy thu nếu xét cá nhân <90%`

Suggested App Report-New calculation:

```js
const xuMonth = vatXu(periodStart, periodEnd, empCode);
const xuQuarterCurrent = vatXu(quarterStart, periodEnd, empCode);
const carryXu = getCarryXuPreviousQuarter(empCode, quarterStart); // persisted snapshot/closing table
const xuTotalQuarter = xuQuarterCurrent + carryXu;
const pointQuarter = sumRevenuePoints(quarterStart, periodEnd, empCode);
const diff = xuTotalQuarter - pointQuarter;
const missingXu = Math.max(0, -diff);
const surplusXu = Math.max(0, diff);
const quarterRatePct = pointQuarter ? xuTotalQuarter / pointQuarter * 100 : 0;
```

Carry source does not currently exist in `vat.db`; it came from the Excel point/xu workbook. Claude should create a persistent carry/quarter closing table or import the latest closing balance.

## Penalty constants

- Warning threshold: individual quarter xu/point `< 90%`.
- Penalty reference: `2 points = 600,000đ`.
- Suggested penalty amount if strictly applied: `ceil(missingPoints / 2) * 600000` or business-defined exact rounding. Legacy workbook already had the result column, so confirm rounding with CEO before automating penalties.

## Employee exclusion / target list seen in code

V10 batch allowed list:

```python
allowed = [
  'DN001','DN002','DN003','DN004','DN005','DN006','DN007','DN008','DN009','DN010','DN011','DN012',
  'DN016','DN017','DN018','DN019','DN024','VP004'
]
```

Office memory has a separate Sale standard list used for notifications:

```text
DN001, DN002, DN003, DN004, DN005, DN006, DN007, DN008, DN009, DN010, DN011, DN012,
DN016, DN017, DN018, DN019, DN024, VP018
```

If generating real employee emails from App Report-New, ask CEO whether to include/exclude `DN002`, `DN004`, `VP018` every time, per Office rule.

## Email image embedding

Existing code uses:

- `cid:logo_dona`
- `cid:qr_zalo`

Paths used by App Report scripts:

```text
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/logo_dona.png
/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/qr_zalo_oa_dona.png
```

See `scripts/send_email_cid_snippet.py` for sanitized MIME attach code.
