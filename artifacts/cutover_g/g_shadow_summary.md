# Cutover G — Adapter SHADOW CST + emp_code crosswalk

Generated: 2026-07-02T15:48:29.001Z. Read-only. No source cutover.

## emp_code crosswalk
- App Sale employees: 31
- App Report users: 37
- Matched by exact code: 30
- App Sale missing in App Report: 1
- App Report only: 7

Artifact: `crosswalk_emp_code.json`.

## CST shadow from App Sale CL timeline since 01/07
- Timeline rows: 2
- Grouped CST keys: 2
- Keys matched baseline: 2
- Keys without baseline/allocation: 0
- approvedLike qty total: 0
- orderedEligible qty total: 3000
- approvedLike amount total: 0
- orderedEligible amount total: 2940000

Top delta rows are in `cst_shadow_adapter_20260702.json`.

## Worklists
- `worklist_lumos_static.json`: 10 Lumos-only lines kept static for shadow.
- `worklist_appsale_allocation_hold.json`: 45 App-only keys held until allocation exists.

## API contract proposal
See `report_sync_contract_proposal.md`.
