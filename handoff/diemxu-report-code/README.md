# Handoff: Điểm/Xu + Doanh thu email report code

Branch target: `bot/diemxu-report-code`

This folder contains the current code/templates used by Office bot to generate the email reports CEO referenced, plus mapping notes for Claude to merge the flow into App Report-New.

## Exact templates CEO asked for

### Weekly DN001 `[TEST] Báo cáo doanh thu Tuần 26 (01/06–26/06/2026) – DN001`

- HTML: `templates/week26_dn001_test/DN001_TEST_Bao_cao_doanh_thu_Tuan_26_2026.html`
- TXT: `templates/week26_dn001_test/DN001_TEST_Bao_cao_doanh_thu_Tuan_26_2026.txt`
- Send log: `templates/week26_dn001_test/email_log.csv`
- Generator reference: `scripts/generate_weekly_employee_email_week26_deep.py`

Send log confirms:

- `sent_at`: `2026-06-26T22:12:16`
- `to`: `bietthubt7@gmail.com`
- `cc`: `trungdangxuan@gmail.com`
- `subject`: `[TEST] Báo cáo doanh thu Tuần 26 (01/06–26/06/2026) – DN001`

### Monthly DN001 `[TEST V10] Báo cáo doanh thu T06.2026 - DN001`

- HTML: `templates/t06_dn001_v10/DN001_TEST_V10_Bao_cao_doanh_thu_T06_2026.html`
- TXT: `templates/t06_dn001_v10/DN001_TEST_V10_Bao_cao_doanh_thu_T06_2026.txt`
- Send log: `templates/t06_dn001_v10/email_log.json`
- Generator reference: `scripts/generate_monthly_employee_email_v10.py`

Send log confirms:

- `to`: `bietthubt7@gmail.com`
- `subject`: `[TEST V10] Báo cáo doanh thu T06.2026 - DN001`

## Code included

| File | Purpose |
|---|---|
| `scripts/generate_weekly_employee_email_week26_deep.py` | Weekly per-employee HTML/TXT generator used for week 26 deep reports. |
| `scripts/generate_monthly_employee_email_v10.py` | Monthly V10 per-employee HTML/TXT generator for the 18-person batch. |
| `scripts/generate_monthly_ceo_summary_and_v3_reports.py` | Older V3 monthly per-employee + CEO summary generator. Use for CEO overview reference. |
| `scripts/send_email_cid_snippet.py` | Sanitized email MIME snippet for `cid:logo_dona` and `cid:qr_zalo`. |
| `scripts/vat_xu_reader_better_sqlite3.js` | Reference Node reader for xu from `vat.db` / `vat_bills`. |
| `docs/DATA_MAPPING_AND_FORMULAS.md` | Data source mapping, formulas, constants, and migration notes. |

## Important security note

No real SMTP password/API token should be committed. Any old sending script that had secrets was either not copied or sanitized. Load credentials from App Report-New env/secret manager.

## New integration direction from CEO

- Revenue + revenue points: App Report-New.
- Xu: `vat.db`, table `vat_bills`.
- Keep email layout/style close to the two exact templates in `templates/`.

See `docs/DATA_MAPPING_AND_FORMULAS.md` for the required function/source mapping.
